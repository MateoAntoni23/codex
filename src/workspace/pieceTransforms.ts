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

  const newPorts: Record<string, { posicion_mm: Vec3; direccion: Vec3 }> = {};
  for (const [portId, port] of Object.entries(piece.puertos)) {
    const relative = subV(port.posicion_mm, pivotMm);
    const rotatedRel = applyMatrix(M, relative);
    const newPos = addV(pivotMm, rotatedRel);
    const newDir = normV(applyMatrix(M, port.direccion));
    newPorts[portId] = { posicion_mm: newPos, direccion: newDir };
  }

  return {
    ...piece,
    puertos: newPorts as Piece['puertos'],
  };
}

/**
 * Traslada una pieza por `delta_mm`. Las direcciones no cambian.
 */
export function translatePiece(piece: Piece, deltaMm: Vec3): Piece {
  const newPorts: Record<string, { posicion_mm: Vec3; direccion: Vec3 }> = {};
  for (const [portId, port] of Object.entries(piece.puertos)) {
    newPorts[portId] = {
      posicion_mm: addV(port.posicion_mm, deltaMm),
      direccion: [port.direccion[0], port.direccion[1], port.direccion[2]],
    };
  }
  return {
    ...piece,
    puertos: newPorts as Piece['puertos'],
  };
}

/** Normaliza un ángulo libre a (-180, 180]. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
