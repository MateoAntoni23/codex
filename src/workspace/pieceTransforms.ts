/**
 * pieceTransforms — transformaciones rígidas sobre piezas del trazado.
 *
 * Aplica rotación y traslación a TODOS los puertos de una pieza (posición y
 * dirección) preservando la coherencia geométrica interna. Las conexiones y
 * soportes NO se modifican aquí: si la pieza está conectada, rotarla romperá
 * el ajuste con la vecina — esa validación corresponde al llamante.
 *
 * Convenciones:
 *   - mm, Z-up global. Rotaciones expresadas como grados sobre un eje mundial.
 *   - El pivote puede ser un punto arbitrario o derivarse del centroide de
 *     puertos (`centroid`) o de un puerto específico (`P1`/`P2`/`P3`/…).
 *   - Las direcciones son vectores unitarios: tras rotar se re-normalizan
 *     para evitar deriva numérica.
 */
import type { Piece } from '../tray/model';
import { quatFromAxisAngle, transformPose } from './placement/placementCore';

/**
 * A-8: mover y rotar transforman la POSE (rotación + posición) además de las
 * bocas, con la misma transformación rígida.
 */
function withPose(piece: Piece, next: Piece, q: readonly number[], pivot: readonly number[], delta: readonly number[]): Piece {
  const c = piece.colocacion;
  if (!c || c.estado !== 'resuelta') return next;
  return { ...next, colocacion: { ...c, pose: transformPose(c.pose, q, pivot, delta) } };
}

const AXIS_VEC: Record<'X' | 'Y' | 'Z', [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

export type AxisKey = 'X' | 'Y' | 'Z';
export type Vec3 = [number, number, number];
export type PivotRef = { kind: 'centroid' } | { kind: 'port'; name: string } | { kind: 'point'; mm: Vec3 };

const EPS = 1e-9;

function addV(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function subV(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function normV(a: readonly number[]): Vec3 {
  const L = Math.hypot(a[0], a[1], a[2]);
  if (L < EPS) return [0, 0, 0];
  return [a[0] / L, a[1] / L, a[2] / L];
}

/** Matriz de rotación 3×3 alrededor del eje mundial `axis` por `rad` radianes. */
function rotMatrix(axis: AxisKey, rad: number): readonly [Vec3, Vec3, Vec3] {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  if (axis === 'X') {
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ];
  }
  if (axis === 'Y') {
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c],
    ];
  }
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function applyMatrix(M: readonly [Vec3, Vec3, Vec3], v: readonly number[]): Vec3 {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

/** Resuelve el pivote a un punto absoluto (mm). */
export function resolvePivot(piece: Piece, pivot: PivotRef): Vec3 | null {
  if (pivot.kind === 'point') return [...pivot.mm];
  if (pivot.kind === 'port') {
    const p = piece.puertos[pivot.name];
    if (!p) return null;
    return [p.posicion_mm[0], p.posicion_mm[1], p.posicion_mm[2]];
  }
  // centroide: promedio de posiciones de puertos
  const ports = Object.values(piece.puertos);
  if (ports.length === 0) return null;
  let sx = 0, sy = 0, sz = 0;
  for (const p of ports) {
    sx += p.posicion_mm[0];
    sy += p.posicion_mm[1];
    sz += p.posicion_mm[2];
  }
  return [sx / ports.length, sy / ports.length, sz / ports.length];
}

/**
 * Devuelve una copia de la pieza con todos sus puertos (posición y dirección)
 * rotados `angleDeg` grados alrededor del eje mundial `axis` respecto al punto
 * `pivot`. No altera `producto_id`, `longitud_mm` ni identificadores.
 */
export function rotatePiece(piece: Piece, axis: AxisKey, angleDeg: number, pivot: PivotRef): Piece {
  const pivotMm = resolvePivot(piece, pivot);
  if (!pivotMm) return piece;
  const rad = (angleDeg * Math.PI) / 180;
  if (Math.abs(rad) < EPS) return piece;
  const M = rotMatrix(axis, rad);

  const newPorts: Record<string, { posicion_mm: Vec3; direccion: Vec3; orientacion_seccion_ws?: Vec3 }> = {};
  for (const [portId, port] of Object.entries(piece.puertos)) {
    const relative = subV(port.posicion_mm, pivotMm);
    const rotatedRel = applyMatrix(M, relative);
    const newPos = addV(pivotMm, rotatedRel);
    const newDir = normV(applyMatrix(M, port.direccion));
    const entry: { posicion_mm: Vec3; direccion: Vec3; orientacion_seccion_ws?: Vec3 } = {
      posicion_mm: newPos,
      direccion: newDir,
    };
    if (port.orientacion_seccion_ws) {
      entry.orientacion_seccion_ws = normV(applyMatrix(M, port.orientacion_seccion_ws));
    }
    newPorts[portId] = entry;
  }

  return withPose(piece, { ...piece, puertos: newPorts as Piece['puertos'] }, quatFromAxisAngle(AXIS_VEC[axis], angleDeg), pivotMm, [0, 0, 0]);
}

function crossV(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dotV(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function scaleV(a: readonly number[], s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * Rota un vector `v` alrededor del eje unitario `k` por `rad` radianes
 * usando la fórmula de Rodrigues: v·cosθ + (k×v)·sinθ + k·(k·v)·(1-cosθ).
 * Si `k` no está normalizado, se normaliza internamente.
 */
function rodrigues(v: readonly number[], k: readonly number[], rad: number): Vec3 {
  const kN = normV(k);
  if (kN[0] === 0 && kN[1] === 0 && kN[2] === 0) return [v[0], v[1], v[2]];
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const kxv = crossV(kN, v);
  const kdv = dotV(kN, v);
  const term1 = scaleV(v, c);
  const term2 = scaleV(kxv, s);
  const term3 = scaleV(kN, kdv * (1 - c));
  return [
    term1[0] + term2[0] + term3[0],
    term1[1] + term2[1] + term3[1],
    term1[2] + term2[2] + term3[2],
  ];
}

/**
 * Rota una pieza alrededor de un eje arbitrario (no necesariamente X/Y/Z)
 * que pasa por el punto `pivotMm`. Preserva la unitariedad de las
 * direcciones de puertos. Si `axis` es casi nulo o `angleDeg` es cero,
 * devuelve la pieza sin cambios.
 *
 * Uso típico: rotar alrededor del eje de una boca conectada pasándole
 * como `axis` la `direccion` del puerto y como `pivotMm` su `posicion_mm`.
 * Este es el único modo que preserva la pose de un puerto al 100%
 * (posición y dirección), permitiendo rotar el resto de la pieza sin
 * romper esa unión.
 */
export function rotatePieceAroundAxis(
  piece: Piece,
  axis: readonly number[],
  angleDeg: number,
  pivotMm: readonly number[],
): Piece {
  const rad = (angleDeg * Math.PI) / 180;
  if (Math.abs(rad) < EPS) return piece;
  const axisN = normV(axis);
  if (axisN[0] === 0 && axisN[1] === 0 && axisN[2] === 0) return piece;

  const newPorts: Record<string, { posicion_mm: Vec3; direccion: Vec3; orientacion_seccion_ws?: Vec3 }> = {};
  for (const [portId, port] of Object.entries(piece.puertos)) {
    const relative = subV(port.posicion_mm, pivotMm);
    const rotatedRel = rodrigues(relative, axisN, rad);
    const newPos: Vec3 = [
      pivotMm[0] + rotatedRel[0],
      pivotMm[1] + rotatedRel[1],
      pivotMm[2] + rotatedRel[2],
    ];
    const newDir = normV(rodrigues(port.direccion, axisN, rad));
    const entry: { posicion_mm: Vec3; direccion: Vec3; orientacion_seccion_ws?: Vec3 } = {
      posicion_mm: newPos,
      direccion: newDir,
    };
    if (port.orientacion_seccion_ws) {
      entry.orientacion_seccion_ws = normV(rodrigues(port.orientacion_seccion_ws, axisN, rad));
    }
    newPorts[portId] = entry;
  }

  return withPose(piece, { ...piece, puertos: newPorts as Piece['puertos'] }, quatFromAxisAngle(axisN, angleDeg), pivotMm, [0, 0, 0]);
}

/**
 * Traslada una pieza por `delta_mm`. Las direcciones no cambian.
 */
export function translatePiece(piece: Piece, deltaMm: Vec3): Piece {
  const newPorts: Record<string, { posicion_mm: Vec3; direccion: Vec3; orientacion_seccion_ws?: Vec3 }> = {};
  for (const [portId, port] of Object.entries(piece.puertos)) {
    const entry: { posicion_mm: Vec3; direccion: Vec3; orientacion_seccion_ws?: Vec3 } = {
      posicion_mm: addV(port.posicion_mm, deltaMm),
      direccion: [port.direccion[0], port.direccion[1], port.direccion[2]],
    };
    if (port.orientacion_seccion_ws) {
      entry.orientacion_seccion_ws = [
        port.orientacion_seccion_ws[0],
        port.orientacion_seccion_ws[1],
        port.orientacion_seccion_ws[2],
      ];
    }
    newPorts[portId] = entry;
  }
  return withPose(piece, { ...piece, puertos: newPorts as Piece['puertos'] }, [0, 0, 0, 1], [0, 0, 0], deltaMm);
}

/** Normaliza un ángulo libre a (-180, 180]. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
