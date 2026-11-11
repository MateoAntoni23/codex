/**
 * PlacedMesh — malla de una pieza a partir de definición + mano + pose.
 *
 * La usan el preview (colocación recién calculada) y la pieza confirmada
 * (colocación guardada): mismo cálculo de geometría y misma matriz. La matriz
 * del objeto es la pose (rotación + traslación) pasada a metros del visor; la
 * mano y la calibración del modelo van horneadas en la geometría.
 *
 * `estilo='escalera'`: largueros + planta desde la misma definición (B-2), en
 * lugar del prisma macizo. Misma matriz, mismas bocas.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { buildDefinitionGeometry, poseMatrix, worldPorts, type Mano, type Pose, type StoredDefinition } from './placementCore';
import { buildLadderDefinitionGeometry } from './ladderDefinitionGeometry';

/** mm (Z arriba) → visor m (Y arriba). */
export const MM_TO_VIEWER = new THREE.Matrix4().set(
  1 / 1000, 0, 0, 0,
  0, 0, 1 / 1000, 0,
  0, -1 / 1000, 0, 0,
  0, 0, 0, 1,
);

export function placedMeshMatrix(pose: Pose): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(MM_TO_VIEWER, poseMatrix(pose));
}

export function PlacedMesh({
  def, huella, mano, pose, userData, color, opacity, onClick, depthWrite = true, estilo = 'macizo',
}: {
  def: StoredDefinition;
  huella: string;
  mano: Mano;
  pose: Pose;
  userData: Record<string, unknown>;
  color: string;
  opacity: number;
  onClick?: () => void;
  depthWrite?: boolean;
  estilo?: 'macizo' | 'escalera';
}) {
  const geom = useMemo(
    () => (estilo === 'escalera' ? buildLadderDefinitionGeometry(def, mano) : buildDefinitionGeometry(def, mano)),
    [huella, mano, estilo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const matrix = useMemo(() => placedMeshMatrix(pose), [pose]);
  const ref = useRef<THREE.Mesh | null>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.matrix.copy(matrix);
    m.matrixWorldNeedsUpdate = true;
    const ports = worldPorts(def, mano, pose);
    m.userData.codex = {
      ...userData,
      huella,
      mano,
      mirrored: false, // la pose es siempre una rotación; la mano vive en la definición
      chirality: mano === 'espejo' ? 'mirrored' : 'native',
      pose,
      placedPorts: ports.map((p) => ({ name: p.name, pos: p.pos, outwardNormal: p.normal, vDir: p.vDir })),
      placedP1: (ports.find((p) => p.name === 'P1') ?? ports[0])?.pos,
      placedP2: (ports.find((p) => p.name === 'P2') ?? ports[1] ?? ports[0])?.pos,
    };
  }, [matrix, def, mano, pose, huella, userData]);
  useLayoutEffect(() => () => { geom.dispose?.(); }, [geom]);
  return (
    <mesh
      ref={ref}
      matrixAutoUpdate={false}
      onClick={onClick ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); } : undefined}
    >
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={depthWrite} side={estilo === 'escalera' ? THREE.DoubleSide : THREE.FrontSide} />
    </mesh>
  );
}
