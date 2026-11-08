/**
 * portFrameDiag — overlay diagnóstico (opt-in via ?diag=ports) que rendera
 * los frames de cada boca paramétrica: center + normal (rojo) + u_dir (verde) +
 * v_dir (azul) con flechas visibles en el viewer. También imprime en consola
 * los datos efectivos de colocación (SKU, ala/ancho usados, chirality,
 * posiciones de puertos world) para que podamos comparar preview vs pieza
 * confirmada.
 *
 * Opt-in explícito: no afecta render normal. Activar con ?diag=ports.
 */
import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PlacedRecipe, Vec3 as BridgeVec3 } from './parametricBridge';

export function isPortDiagEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const v = params.get('diag');
  return v === 'ports' || v === 'all';
}

export function logPlacement(
  tag: string,
  info: {
    sku: string;
    ala_mm: number | null;
    ancho_mm: number | null;
    chirality: string;
    startPosMm: BridgeVec3;
    entryDir: BridgeVec3;
    placedP1Mm: BridgeVec3;
    placedP2Mm: BridgeVec3;
    storedP1Mm?: BridgeVec3;
    storedP2Mm?: BridgeVec3;
  },
): void {
  if (!isPortDiagEnabled()) return;
  const d3 = (v: BridgeVec3) =>
    `(${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)})`;
  const delta = info.storedP2Mm
    ? [
        info.placedP2Mm[0] - info.storedP2Mm[0],
        info.placedP2Mm[1] - info.storedP2Mm[1],
        info.placedP2Mm[2] - info.storedP2Mm[2],
      ]
    : null;
  const deltaMag = delta ? Math.hypot(...delta) : null;
  // eslint-disable-next-line no-console
  console.log(
    `%c[diag/ports] ${tag}`,
    'color:#ff9955;font-weight:bold',
    {
      sku: info.sku,
      ala_mm: info.ala_mm,
      ancho_mm: info.ancho_mm,
      chirality: info.chirality,
      startPos_mm: d3(info.startPosMm),
      entryDir: d3(info.entryDir),
      placed_P1_mm: d3(info.placedP1Mm),
      placed_P2_mm: d3(info.placedP2Mm),
      stored_P1_mm: info.storedP1Mm ? d3(info.storedP1Mm) : null,
      stored_P2_mm: info.storedP2Mm ? d3(info.storedP2Mm) : null,
      delta_placed_vs_stored_P2_mm: delta ? d3(delta as BridgeVec3) : null,
      delta_mag_mm: deltaMag !== null ? deltaMag.toFixed(4) : null,
    },
  );
}

/** mm (Z-up) → viewer m (Y-up). */
function toViewer(v: BridgeVec3): [number, number, number] {
  return [v[0] / 1000, v[2] / 1000, -v[1] / 1000];
}

/** Flecha gruesa coloreada: desde `at` en dirección `dir` largo `lengthMm`. */
function FrameArrow({
  at, dir, lengthMm, color,
}: {
  at: BridgeVec3;
  dir: BridgeVec3;
  lengthMm: number;
  color: string;
}) {
  const start = toViewer(at);
  const end = toViewer([
    at[0] + dir[0] * lengthMm,
    at[1] + dir[1] * lengthMm,
    at[2] + dir[2] * lengthMm,
  ]);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([...start, ...end], 3),
    );
    return g;
  }, [start[0], start[1], start[2], end[0], end[1], end[2]]);
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} linewidth={3} />
    </line>
  );
}

/**
 * Marca una boca con 3 flechas (normal=rojo, u_dir=verde, v_dir=azul) y un
 * HTML con el center en mm. Tamaño de flecha fijo en mm para que escale
 * razonable a cualquier zoom de la bandeja.
 */
export function PortFrame({
  label, center, normal, uDir, vDir, color, lengthMm = 200,
}: {
  label: string;
  center: BridgeVec3;
  normal: BridgeVec3;
  uDir: BridgeVec3;
  vDir: BridgeVec3;
  color?: string;
  lengthMm?: number;
}) {
  const tag = color ?? '#ffcc00';
  return (
    <group>
      <FrameArrow at={center} dir={normal} lengthMm={lengthMm} color="#ff4444" />
      <FrameArrow at={center} dir={uDir}   lengthMm={lengthMm} color="#44ff66" />
      <FrameArrow at={center} dir={vDir}   lengthMm={lengthMm} color="#66aaff" />
      <mesh position={toViewer(center)}>
        <sphereGeometry args={[0.012, 10, 10]} />
        <meshBasicMaterial color={tag} />
      </mesh>
      <Html
        position={toViewer(center)}
        center
        distanceFactor={6}
        style={{ pointerEvents: 'none' }}
      >
        <span
          style={{
            background: 'rgba(0,0,0,0.85)',
            color: tag,
            fontSize: 9,
            padding: '2px 5px',
            borderRadius: 2,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
          }}
        >
          {label} ({center[0].toFixed(1)}, {center[1].toFixed(1)}, {center[2].toFixed(1)})
        </span>
      </Html>
    </group>
  );
}

/**
 * Renderiza los PortFrame de ambas bocas (P1/P2) de un PlacedRecipe.
 * Color distinto por rol (P1 vs P2) para cruzar visualmente contra el frame
 * de la boca gemela de la pieza vecina.
 */
export function PlacedRecipePortFrames({
  tag, placed,
}: {
  tag: string;
  placed: PlacedRecipe;
}) {
  if (!isPortDiagEnabled()) return null;
  // u_dir/v_dir no viven en PlacedPort; los calculamos consultando la receta.
  // Para simplicidad acá sólo mostramos center + normal (que SÍ están en
  // PlacedPort) con colores por rol; el usuario puede comparar los centros y
  // normales de dos piezas vecinas directamente.
  const p1 = placed.p1;
  const p2 = placed.p2;
  // Perpendicular en plano XY para ejes aux: construimos un u_dir ortogonal
  // al normal en XY, y v_dir = (0,0,1).
  const perpXY = (n: BridgeVec3): BridgeVec3 => {
    // Rota normal XY 90° CCW: (nx, ny) → (-ny, nx)
    return [-n[1], n[0], 0];
  };
  const vDir: BridgeVec3 = [0, 0, 1];
  return (
    <group>
      <PortFrame
        label={`${tag}.P1`}
        center={p1.pos}
        normal={p1.outwardNormal}
        uDir={perpXY(p1.outwardNormal)}
        vDir={vDir}
        color="#ffcc00"
      />
      <PortFrame
        label={`${tag}.P2`}
        center={p2.pos}
        normal={p2.outwardNormal}
        uDir={perpXY(p2.outwardNormal)}
        vDir={vDir}
        color="#00ccff"
      />
    </group>
  );
}
