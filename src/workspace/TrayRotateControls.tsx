/**
 * B-4 — gizmo de rotación de piezas de bandeja ("Rotar tramo").
 *
 * TransformControls de drei en modo `rotate` (anillos por eje, espacio mundo)
 * sobre un proxy invisible ubicado en el pivote (centro de la pieza o una de
 * sus bocas). Igual que el gizmo de mover:
 *   - durante el arrastre la pieza se actualiza con `setEntradaRaw` (fuera del
 *     historial) a partir de la entrada previa, girando bocas y pose a la vez;
 *   - al soltar, si ninguna unión deja de cumplir se confirma como UNA entrada
 *     del historial (deshacer/rehacer); si alguna deja de cumplir, se pide
 *     confirmación con el mismo aviso que al mover (aceptar descarta esas
 *     uniones; cancelar restaura). Nunca quedan uniones inválidas registradas.
 *   - paso de 15° por defecto; con Shift apretado el giro es libre.
 *
 * La rotación numérica del inspector usa `aplicarRotacion`, el mismo camino.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useTrayStore } from '../tray/store';
import type { TrayInput } from '../tray/model';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useTrayMoveState } from './useTrayMoveState';
import { useTrayRotateState } from './useTrayRotateState';
import {
  EJES_MUNDO, ejeMundoDe, mmAVisor, PASO_ROTACION_DEG, puntoPivote, resolverRotacion, rotacionVisorAMm, rotarEnTrazado,
  type EjeMundo, type PivoteRotacion, type V3,
} from './trayRotation';

/**
 * Cierra una rotación: `post` ya está (o se pone) en el store. Sin uniones que
 * dejen de cumplir → una entrada en el historial. Con uniones rotas → pide
 * confirmación (BrokenConnectionsModal del inspector).
 */
export function confirmarRotacion(snapshot: TrayInput, post: TrayInput, pieceId: string): 'confirmada' | 'pide_confirmacion' {
  const tray = useTrayStore.getState();
  const r = resolverRotacion(post, pieceId);
  useWorkspaceStore.getState().markDirty();
  if (r.tipo === 'confirmar') {
    tray.setEntradaRaw(snapshot);
    tray.edit(post);
    return 'confirmada';
  }
  tray.setEntradaRaw(post);
  useTrayMoveState.getState().requestConfirm({ pieceId, snapshot, brokenConexionIds: r.rotas });
  return 'pide_confirmacion';
}

/** Rotación numérica (inspector): `deg` sobre el eje mundial `eje` por el pivote elegido. */
export function aplicarRotacion(pieceId: string, eje: EjeMundo, deg: number, pivote: PivoteRotacion): 'confirmada' | 'pide_confirmacion' | null {
  const entrada = useTrayStore.getState().entrada;
  const piece = entrada?.piezas.find((p) => p.instancia_id === pieceId);
  if (!entrada || !piece || !Number.isFinite(deg) || Math.abs(deg) < 1e-9) return null;
  const pv = puntoPivote(piece, pivote);
  if (!pv) return null;
  const snapshot = structuredClone(entrada);
  return confirmarRotacion(snapshot, rotarEnTrazado(entrada, pieceId, EJES_MUNDO[eje], deg, pv), pieceId);
}

type ControlsLike = THREE.Object3D & {
  addEventListener: (ev: string, fn: (e: { value?: boolean }) => void) => void;
  removeEventListener: (ev: string, fn: (e: { value?: boolean }) => void) => void;
  dispatchEvent: (e: { type: string; value?: boolean }) => void;
};

export function TrayRotateControls({ pieceId }: { pieceId: string }) {
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null);
  const controlsRef = useRef<ControlsLike>(null);
  const pivote = useTrayRotateState((s) => s.pivote);
  const libre = useTrayRotateState((s) => s.libre);
  const entrada = useTrayStore((s) => s.entrada);
  const piece = entrada?.piezas.find((p) => p.instancia_id === pieceId);
  const pivotMm = piece ? puntoPivote(piece, pivote) : null;
  const dragRef = useRef<{ snapshot: TrayInput; pivotMm: V3; movio: boolean } | null>(null);

  // Proxy en el pivote, sin rotación, mientras no se arrastra.
  const px = pivotMm?.[0], py = pivotMm?.[1], pz = pivotMm?.[2];
  useEffect(() => {
    if (!proxy || px === undefined || dragRef.current) return;
    const [vx, vy, vz] = mmAVisor([px, py!, pz!]);
    proxy.position.set(vx, vy, vz);
    proxy.quaternion.identity();
    proxy.updateMatrixWorld();
  }, [proxy, px, py, pz]);

  // Shift = giro libre; Esc = salir.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') useTrayRotateState.getState().setLibre(true);
      if (e.key === 'Escape') useWorkspaceStore.getState().setTrayRotateMode(false);
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') useTrayRotateState.getState().setLibre(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      useTrayRotateState.getState().setLibre(false);
    };
  }, []);

  const onObjectChange = useCallback(() => {
    const d = dragRef.current;
    if (!proxy || !d) return;
    const q = proxy.quaternion;
    const { eje, deg } = rotacionVisorAMm([q.x, q.y, q.z, q.w]);
    if (Math.abs(deg) < 1e-9) return;
    d.movio = true;
    useTrayStore.getState().setEntradaRaw(rotarEnTrazado(d.snapshot, pieceId, eje, deg, d.pivotMm));
    const st = useTrayRotateState.getState();
    const k = ejeMundoDe(eje);
    if (k) st.setEje(k);
    st.setAngulo(Math.round(deg * 1e6) / 1e6);
  }, [proxy, pieceId]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !proxy) return;
    const onDragging = (e: { value?: boolean }) => {
      if (e.value) {
        const ent = useTrayStore.getState().entrada;
        const p = ent?.piezas.find((x) => x.instancia_id === pieceId);
        const pv = p ? puntoPivote(p, useTrayRotateState.getState().pivote) : null;
        if (!ent || !pv) return;
        proxy.quaternion.identity();
        dragRef.current = { snapshot: structuredClone(ent), pivotMm: pv, movio: false };
        return;
      }
      const d = dragRef.current;
      dragRef.current = null;
      proxy.quaternion.identity();
      if (!d || !d.movio) return;
      const post = useTrayStore.getState().entrada;
      if (post) confirmarRotacion(d.snapshot, post, pieceId);
    };
    controls.addEventListener('dragging-changed', onDragging);
    controls.addEventListener('objectChange', onObjectChange);
    // Puente de pruebas (E2E): reproduce un arrastre del anillo con los MISMOS
    // eventos del control — dragging-changed / objectChange — sin depender de
    // la posición en pantalla de los anillos.
    const w = window as unknown as { __codex?: Record<string, unknown> };
    if (!w.__codex) w.__codex = {};
    w.__codex.trayRotateGizmo = {
      montado: true,
      paso: () => (useTrayRotateState.getState().libre ? null : PASO_ROTACION_DEG),
      arrastrar: (ejeVisor: [number, number, number], deg: number) => {
        controls.dispatchEvent({ type: 'dragging-changed', value: true });
        proxy.quaternion.setFromAxisAngle(new THREE.Vector3(...ejeVisor).normalize(), (deg * Math.PI) / 180);
        controls.dispatchEvent({ type: 'objectChange' });
        controls.dispatchEvent({ type: 'dragging-changed', value: false });
      },
    };
    return () => {
      controls.removeEventListener('dragging-changed', onDragging);
      controls.removeEventListener('objectChange', onObjectChange);
      delete w.__codex?.trayRotateGizmo;
    };
  }, [proxy, pieceId, onObjectChange]);

  return (
    <>
      <group ref={setProxy}>
        <mesh visible={false}>
          <boxGeometry args={[0.001, 0.001, 0.001]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>
      {proxy && (
        <TransformControls
          ref={controlsRef as never}
          object={proxy}
          mode="rotate"
          space="world"
          size={0.8}
          rotationSnap={libre ? null : THREE.MathUtils.degToRad(PASO_ROTACION_DEG)}
        />
      )}
      {pivotMm && (
        <Html position={mmAVisor([pivotMm[0], pivotMm[1], pivotMm[2] + 1200])} center style={{ pointerEvents: 'none' }}>
          <div
            data-testid="tray-rotate-mode-hint"
            style={{ background: 'rgba(30, 60, 90, 0.92)', color: '#cfe6ff', fontSize: 11, padding: '4px 8px', borderRadius: 4, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}
          >
            ⟳ Rotar tramo · arrastrá un anillo · paso {PASO_ROTACION_DEG}° ({libre ? 'libre' : 'Shift: libre'}) · Esc para salir
          </div>
        </Html>
      )}
    </>
  );
}
