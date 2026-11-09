/**
 * WorkspaceScene — unified R3F scene combining equipment and tray objects.
 * Equipment objects are rendered using PreviewSceneObjects patterns.
 * Tray objects are rendered by TrayObjects.
 */
import { useCallback, useEffect, useMemo, useRef, useState as useReactState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { elementToRenderProps } from '../scene/v2-adapter';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import { useTrayMoveState } from './useTrayMoveState';
import {
  pieceCentroid,
  translatePiece,
  findBrokenConnections,
} from './trayMovement';
import { TrayObjects } from './TrayObjects';
import { RoutingObjects } from './RoutingObjects';
import type { ElementRenderProps } from '../scene/v2-adapter';
import type { EquipmentElement } from '../types/domain-v2';
import type { TrayInput } from '../tray/model';

type Q4 = [number, number, number, number];

const CATEGORY_COLOR: Record<string, string> = {
  electrical_panel: '#5577aa',
  motor:            '#778866',
  pump:             '#6688aa',
  sensor:           '#aa7733',
  process_valve:    '#8866aa',
  solenoid_valve:   '#aa6688',
  actuator:         '#668899',
  luminaire:        '#aaaa44',
  pushbutton:       '#aa6644',
  terminal_block:   '#888888',
  manifold:         '#7788aa',
  pneumatic_panel:  '#5599aa',
  infrastructure:   '#445566',
};

function EquipmentObject({
  rp,
  isSelected,
  moveActive,
  onSelect,
  meshRef,
}: {
  rp: ElementRenderProps;
  isSelected: boolean;
  moveActive: boolean;
  onSelect: () => void;
  meshRef?: React.Ref<THREE.Object3D>;
}) {
  const { positionViewer, rotationViewer, sizeViewer, geometryKind, category, name } = rp;
  if (!positionViewer) return null;

  const color    = CATEGORY_COLOR[category] ?? '#888888';
  const emissive = moveActive ? '#44aa66' : isSelected ? '#223366' : '#000000';
  const emissiveIntensity = moveActive ? 2.5 : isSelected ? 2 : 0;
  const quat     = (rotationViewer ?? [0, 0, 0, 1]) as Q4;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  // Cursor pointer al hover sobre el equipo (selección directa en canvas);
  // en modo mover el cursor indica "mover" sobre la geometría del gizmo (drei
  // lo administra). Esto da descubribilidad en escena sin pop-ups.
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };
  const handlePointerOut = () => {
    document.body.style.cursor = '';
  };

  if (geometryKind === 'box' && category === 'infrastructure') {
    return (
      <mesh
        ref={meshRef as React.Ref<THREE.Mesh>}
        position={positionViewer}
        quaternion={quat}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshBasicMaterial color={isSelected ? '#aabbcc' : '#8899aa'} wireframe />
      </mesh>
    );
  }

  if (geometryKind === 'box' || geometryKind === 'asset') {
    return (
      <mesh
        ref={meshRef as React.Ref<THREE.Mesh>}
        position={positionViewer}
        quaternion={quat}
        castShadow
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  if (geometryKind === 'cylinder') {
    const [dx, dy] = sizeViewer ?? [0.3, 1, 0.3];
    return (
      <mesh
        ref={meshRef as React.Ref<THREE.Mesh>}
        position={positionViewer}
        quaternion={quat}
        castShadow
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <cylinderGeometry args={[dx / 2, dx / 2, dy, 24]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  // No geometry / unknown: placeholder
  return (
    <group ref={meshRef as React.Ref<THREE.Group>} position={positionViewer}>
      <mesh onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial color="#eeaa00" emissive="#ff8800" emissiveIntensity={moveActive ? 3.5 : isSelected ? 3 : 1.5} wireframe />
      </mesh>
      <Html center distanceFactor={8} style={{ pointerEvents: 'none' }} position={[0, 0.45, 0]}>
        <div style={{ background: 'rgba(0,0,0,0.5)', color: '#ffcc44', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
          {name}
        </div>
      </Html>
    </group>
  );
}

/**
 * Convierte la posición de un Object3D (viewer: Y-up, metros) a positionMm (domain: Z-up, mm).
 *   domain.x = viewer.x * 1000
 *   domain.y = -viewer.z * 1000
 *   domain.z = viewer.y * 1000
 * (inverso de elementToRenderProps).
 */
function viewerPosToDomainMm(obj: THREE.Object3D): { x: number; y: number; z: number } {
  return {
    x:  obj.position.x * 1000,
    y: -obj.position.z * 1000,
    z:  obj.position.y * 1000,
  };
}

/**
 * TransformControls sobre el elemento seleccionado para mover libremente en escena.
 * - Gated a elementos sin parentId (no manejamos locales con padre rotado todavía).
 * - mode='translate', muestra ejes XYZ para que el usuario distinga el movimiento
 *   de los controles de cámara (OrbitControls queda inhibido automáticamente durante drag).
 * - Un único checkpoint de historial al iniciar drag; updates transientes durante el drag.
 */
function EquipmentDragControls({
  targetElement,
  targetObject,
}: {
  targetElement: EquipmentElement;
  targetObject: THREE.Object3D;
}) {
  const controlsRef = useRef<THREE.Object3D & { addEventListener: (ev: string, fn: (e: { value?: boolean }) => void) => void; removeEventListener: (ev: string, fn: (e: { value?: boolean }) => void) => void; }>(null);
  const beginCheckpoint = useWorkspaceStore((s) => s.beginEquipCheckpoint);
  const updateTransient = useWorkspaceStore((s) => s.updateElementTransient);
  const elementRef = useRef(targetElement);
  elementRef.current = targetElement;

  const onObjectChange = useCallback(() => {
    const el = elementRef.current;
    if (el.placementStatus !== 'placed') return;
    const nextPos = viewerPosToDomainMm(targetObject);
    const prev = el.transform.positionMm;
    if (Math.abs(prev.x - nextPos.x) < 0.01 && Math.abs(prev.y - nextPos.y) < 0.01 && Math.abs(prev.z - nextPos.z) < 0.01) return;
    updateTransient({ ...el, transform: { positionMm: nextPos, rotation: el.transform.rotation } });
  }, [targetObject, updateTransient]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onDraggingChanged = (e: { value?: boolean }) => {
      if (e.value) beginCheckpoint();
    };
    controls.addEventListener('dragging-changed', onDraggingChanged);
    controls.addEventListener('objectChange', onObjectChange);
    return () => {
      controls.removeEventListener('dragging-changed', onDraggingChanged);
      controls.removeEventListener('objectChange', onObjectChange);
    };
  }, [beginCheckpoint, onObjectChange]);

  // @ts-expect-error — drei TransformControls accepts a ref + object prop; types are permissive at runtime.
  return <TransformControls ref={controlsRef} object={targetObject} mode="translate" size={0.8} />;
}

/**
 * Convierte centroide (mm, Z-up) → posición viewer (m, Y-up).
 */
function centroidMmToViewer(mm: readonly [number, number, number]): [number, number, number] {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}
/** Inverso de `centroidMmToViewer`. */
function viewerToCentroidMm(obj: THREE.Object3D): [number, number, number] {
  return [obj.position.x * 1000, -obj.position.z * 1000, obj.position.y * 1000];
}

/**
 * TrayDragControls — gizmo XYZ para trasladar una pieza de bandeja completa.
 *
 * Una pieza NO tiene transform propio: su posición está codificada en los
 * `posicion_mm` de sus puertos. Por eso el gizmo opera sobre un proxy
 * invisible anclado inicialmente al centroide; en cada `objectChange`
 * convertimos la pose del proxy a mm, calculamos el delta vs el centroide
 * pre-drag, y aplicamos `translatePiece` a la entrada mediante
 * `setEntradaRaw` (bypass del history — las posiciones intermedias no entran).
 *
 * Al soltar:
 *   - Si no hay uniones rotas → commit atómico (restaura snapshot y llama
 *     `edit(post)` para que la history guarde una sola entrada).
 *   - Si hay rotas → se expone `pending` en `useTrayMoveState` para que el
 *     inspector pinte el modal con Aceptar/Cancelar.
 */
function TrayDragControls({ pieceId }: { pieceId: string }) {
  const [proxy, setProxy] = useReactState<THREE.Object3D | null>(null);
  const controlsRef = useRef<THREE.Object3D & {
    addEventListener: (ev: string, fn: (e: { value?: boolean }) => void) => void;
    removeEventListener: (ev: string, fn: (e: { value?: boolean }) => void) => void;
  }>(null);
  // Snapshot de la entrada al iniciar el drag — restaurar aquí si se cancela,
  // o pushear a history al confirmar.
  const snapshotRef = useRef<TrayInput | null>(null);
  // Centroide (mm) del momento inicial — base para calcular el delta aplicado.
  const startCentroidMmRef = useRef<[number, number, number] | null>(null);
  // Guarda si hubo movimiento real: evita confirmar/restaurar cuando el usuario
  // toca el gizmo sin arrastrarlo.
  const didMoveRef = useRef(false);

  const attachProxy = useCallback((obj: THREE.Object3D | null) => {
    if (!obj) { setProxy(null); return; }
    const entrada = useTrayStore.getState().entrada;
    const piece = entrada?.piezas.find((p) => p.instancia_id === pieceId);
    if (!piece) { setProxy(null); return; }
    const c = pieceCentroid(piece);
    const [vx, vy, vz] = centroidMmToViewer(c);
    obj.position.set(vx, vy, vz);
    setProxy(obj);
  }, [pieceId]);

  const onObjectChange = useCallback(() => {
    if (!proxy) return;
    const snapshot = snapshotRef.current;
    const startMm = startCentroidMmRef.current;
    if (!snapshot || !startMm) return;
    const newMm = viewerToCentroidMm(proxy);
    const delta: [number, number, number] = [
      newMm[0] - startMm[0],
      newMm[1] - startMm[1],
      newMm[2] - startMm[2],
    ];
    if (Math.abs(delta[0]) < 1e-3 && Math.abs(delta[1]) < 1e-3 && Math.abs(delta[2]) < 1e-3) return;
    didMoveRef.current = true;
    const next = translatePiece(snapshot, pieceId, delta);
    useTrayStore.getState().setEntradaRaw(next);
    useWorkspaceStore.getState().markDirty();
  }, [proxy, pieceId]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !proxy) return;
    const onDraggingChanged = (e: { value?: boolean }) => {
      if (e.value) {
        const entrada = useTrayStore.getState().entrada;
        if (!entrada) return;
        const piece = entrada.piezas.find((p) => p.instancia_id === pieceId);
        if (!piece) return;
        snapshotRef.current = structuredClone(entrada);
        startCentroidMmRef.current = pieceCentroid(piece);
        didMoveRef.current = false;
      } else {
        const snapshot = snapshotRef.current;
        const postDrag = useTrayStore.getState().entrada;
        snapshotRef.current = null;
        startCentroidMmRef.current = null;
        if (!snapshot || !postDrag || !didMoveRef.current) return;
        const broken = findBrokenConnections(postDrag, pieceId);
        if (broken.length === 0) {
          // Commit atómico: restaurar snapshot y luego edit(post) empuja
          // snapshot a history dejando entrada en post.
          useTrayStore.getState().setEntradaRaw(snapshot);
          useTrayStore.getState().edit(postDrag);
        } else {
          // Dejar entrada en post; el inspector mostrará un modal con
          // Aceptar/Cancelar que termina de resolver via useTrayMoveState.
          useTrayMoveState.getState().requestConfirm({
            pieceId,
            snapshot,
            brokenConexionIds: broken,
          });
        }
      }
    };
    controls.addEventListener('dragging-changed', onDraggingChanged);
    controls.addEventListener('objectChange', onObjectChange);
    return () => {
      controls.removeEventListener('dragging-changed', onDraggingChanged);
      controls.removeEventListener('objectChange', onObjectChange);
    };
  }, [proxy, pieceId, onObjectChange]);

  return (
    <>
      <group ref={attachProxy}>
        <mesh visible={false}>
          <boxGeometry args={[0.001, 0.001, 0.001]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>
      {proxy && (
        // @ts-expect-error — drei TransformControls accepts a ref + object prop; types are permissive at runtime.
        <TransformControls ref={controlsRef} object={proxy} mode="translate" size={0.8} />
      )}
    </>
  );
}

/**
 * Mensaje flotante sobre la pieza mientras el modo mover tramo está activo.
 * Replica la UX del hint de equipos.
 */
function TrayMoveHint({ pieceId }: { pieceId: string }) {
  const entrada = useTrayStore((s) => s.entrada);
  const piece = entrada?.piezas.find((p) => p.instancia_id === pieceId);
  if (!piece) return null;
  const [cx, cy, cz] = pieceCentroid(piece);
  return (
    <Html
      position={[cx / 1000, cz / 1000 + 1.2, -cy / 1000]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div
        data-testid="tray-move-mode-hint"
        style={{
          background: 'rgba(80, 60, 20, 0.92)',
          color: '#ffe0aa',
          fontSize: 11,
          padding: '4px 8px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}
      >
        ✥ Mover tramo · arrastrá los ejes XYZ · Esc para salir
      </div>
    </Html>
  );
}

export function WorkspaceScene() {
  const elements         = useWorkspaceStore((s) => s.elements);
  const selectedEquipId  = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedTrayId   = useWorkspaceStore((s) => s.selectedTrayId);
  const selectEquip      = useWorkspaceStore((s) => s.selectEquip);
  const layers           = useWorkspaceStore((s) => s.layers);
  const moveMode         = useWorkspaceStore((s) => s.moveMode);
  const setMoveMode      = useWorkspaceStore((s) => s.setMoveMode);
  const trayMoveMode     = useWorkspaceStore((s) => s.trayMoveMode);
  const setTrayMoveMode  = useWorkspaceStore((s) => s.setTrayMoveMode);

  const allRenderProps = useMemo(
    () => elements.map((el) => elementToRenderProps(el, elements)),
    [elements],
  );

  const selectedElement = selectedEquipId
    ? elements.find((e) => e.id === selectedEquipId) ?? null
    : null;
  // Drag gizmo: elemento placed y sin padre (jerarquía compuesta no se maneja aún).
  // Infrastructure se mueve igual — el usuario puede recolocar paredes/estructuras
  // libremente; antes lo bloqueábamos por accidente.
  const canDragSelected = Boolean(
    selectedElement
      && selectedElement.placementStatus === 'placed'
      && selectedElement.parentId === null,
  );

  // Mesh del seleccionado para engancharle el gizmo. El ref callback dispara
  // un re-render al montar/desmontar; NO reseteamos `meshReady` desde un
  // useEffect dependiente de selectedEquipId porque el effect corre DESPUÉS
  // de la fase de refs y pisa el `true` recién puesto por el nuevo ref —
  // era por eso que el gizmo nunca aparecía al seleccionar un equipo.
  const selectedMeshRef = useRef<THREE.Object3D | null>(null);
  const [meshReady, setMeshReady] = useReactState(false);
  const attachMesh = useCallback((obj: THREE.Object3D | null) => {
    selectedMeshRef.current = obj;
    setMeshReady(Boolean(obj));
  }, []);

  // Si se apaga moveMode con Esc o cambia la selección, el gizmo se desmonta.
  // Esc global: UX estándar para salir del modo mover.
  useEffect(() => {
    if (!moveMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoveMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveMode, setMoveMode]);

  useEffect(() => {
    if (!trayMoveMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTrayMoveMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trayMoveMode, setTrayMoveMode]);

  // Si el elemento seleccionado pierde elegibilidad (deja de estar placed, se
  // borra, cambia a infraestructura con padre), apagar el modo mover para no
  // dejar un gizmo huérfano.
  useEffect(() => {
    if (moveMode && !canDragSelected) setMoveMode(false);
  }, [moveMode, canDragSelected, setMoveMode]);

  const showGizmo = moveMode && canDragSelected && !!selectedElement && meshReady && !!selectedMeshRef.current;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} castShadow />

      {/* Equipment objects */}
      {allRenderProps.map((rp) => {
        if (!rp.placed) return null;
        const isInfra = rp.category === 'infrastructure';
        if (isInfra && !layers.infrastructure) return null;
        if (!isInfra && !layers.equipment) return null;
        const isSelected = selectedEquipId === rp.id;
        return (
          <EquipmentObject
            key={rp.id}
            rp={rp}
            isSelected={isSelected}
            moveActive={isSelected && moveMode}
            onSelect={() => selectEquip(rp.id)}
            meshRef={isSelected && canDragSelected ? attachMesh : undefined}
          />
        );
      })}

      {showGizmo && selectedElement && (
        <EquipmentDragControls
          targetElement={selectedElement}
          targetObject={selectedMeshRef.current!}
        />
      )}

      {/* Indicación on-screen: aparece sobre el equipo en modo mover. */}
      {showGizmo && selectedElement?.placementStatus === 'placed' && (
        <Html
          position={[
            selectedElement.transform.positionMm.x / 1000,
            selectedElement.transform.positionMm.z / 1000 + 1.2,
            -selectedElement.transform.positionMm.y / 1000,
          ]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            data-testid="move-mode-hint"
            style={{
              background: 'rgba(20, 80, 40, 0.92)',
              color: '#aaffcc',
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            }}
          >
            ✥ Modo mover · arrastrá los ejes XYZ · Esc para salir
          </div>
        </Html>
      )}

      {/* Tray objects — TrayObjects reads useTrayStore and useWorkspaceStore for layers/selection */}
      <TrayObjects />

      {trayMoveMode && selectedTrayId && (
        <>
          <TrayDragControls pieceId={selectedTrayId} />
          <TrayMoveHint pieceId={selectedTrayId} />
        </>
      )}

      {/* Routing objects — port markers + preview mesh when routing tool is active */}
      <RoutingObjects />
    </>
  );
}
