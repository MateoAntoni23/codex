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
import { TrayObjects } from './TrayObjects';
import { RoutingObjects } from './RoutingObjects';
import type { ElementRenderProps } from '../scene/v2-adapter';
import type { EquipmentElement } from '../types/domain-v2';

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
  onSelect,
  meshRef,
}: {
  rp: ElementRenderProps;
  isSelected: boolean;
  onSelect: () => void;
  meshRef?: React.Ref<THREE.Object3D>;
}) {
  const { positionViewer, rotationViewer, sizeViewer, geometryKind, category, name } = rp;
  if (!positionViewer) return null;

  const color    = CATEGORY_COLOR[category] ?? '#888888';
  const emissive = isSelected ? '#223366' : '#000000';
  const emissiveIntensity = isSelected ? 2 : 0;
  const quat     = (rotationViewer ?? [0, 0, 0, 1]) as Q4;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  if (geometryKind === 'box' && category === 'infrastructure') {
    return (
      <mesh ref={meshRef as React.Ref<THREE.Mesh>} position={positionViewer} quaternion={quat} onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshBasicMaterial color={isSelected ? '#aabbcc' : '#8899aa'} wireframe />
      </mesh>
    );
  }

  if (geometryKind === 'box' || geometryKind === 'asset') {
    return (
      <mesh ref={meshRef as React.Ref<THREE.Mesh>} position={positionViewer} quaternion={quat} castShadow onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  if (geometryKind === 'cylinder') {
    const [dx, dy] = sizeViewer ?? [0.3, 1, 0.3];
    return (
      <mesh ref={meshRef as React.Ref<THREE.Mesh>} position={positionViewer} quaternion={quat} castShadow onClick={handleClick}>
        <cylinderGeometry args={[dx / 2, dx / 2, dy, 24]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  // No geometry / unknown: placeholder
  return (
    <group ref={meshRef as React.Ref<THREE.Group>} position={positionViewer}>
      <mesh onClick={handleClick}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial color="#eeaa00" emissive="#ff8800" emissiveIntensity={isSelected ? 3 : 1.5} wireframe />
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

export function WorkspaceScene() {
  const elements         = useWorkspaceStore((s) => s.elements);
  const selectedEquipId  = useWorkspaceStore((s) => s.selectedEquipId);
  const selectEquip      = useWorkspaceStore((s) => s.selectEquip);
  const layers           = useWorkspaceStore((s) => s.layers);

  const allRenderProps = useMemo(
    () => elements.map((el) => elementToRenderProps(el, elements)),
    [elements],
  );

  // Drag gizmo sólo para el seleccionado, placed y sin padre rotado/compuesto.
  const selectedElement = selectedEquipId
    ? elements.find((e) => e.id === selectedEquipId) ?? null
    : null;
  const canDragSelected = Boolean(
    selectedElement
      && selectedElement.placementStatus === 'placed'
      && selectedElement.parentId === null
      && selectedElement.category !== 'infrastructure',
  );
  const selectedMeshRef = useRef<THREE.Object3D | null>(null);
  // Dispara re-render cuando el mesh seleccionado se monta para que TransformControls pueda engancharse.
  const [meshReady, setMeshReady] = useReactState(false);
  const attachMesh = useCallback((obj: THREE.Object3D | null) => {
    selectedMeshRef.current = obj;
    setMeshReady(Boolean(obj));
  }, []);
  useEffect(() => {
    setMeshReady(false);
  }, [selectedEquipId]);

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
            onSelect={() => selectEquip(rp.id)}
            meshRef={isSelected && canDragSelected ? attachMesh : undefined}
          />
        );
      })}

      {canDragSelected && selectedElement && meshReady && selectedMeshRef.current && (
        <EquipmentDragControls
          targetElement={selectedElement}
          targetObject={selectedMeshRef.current}
        />
      )}

      {/* Tray objects — TrayObjects reads useTrayStore and useWorkspaceStore for layers/selection */}
      <TrayObjects />

      {/* Routing objects — port markers + preview mesh when routing tool is active */}
      <RoutingObjects />
    </>
  );
}
