/**
 * Pure logic for creating straight tray segments.
 * No side effects — all functions are deterministic and testable.
 */
import type { Piece } from '../tray/model';

export type Point3 = [number, number, number];

/**
 * Returns an error message if the inputs are invalid, or null if valid.
 * Checks: all coordinates finite, P1 ≠ P2 (min 1 mm apart).
 */
export function validateSegmentInput(p1: Point3, p2: Point3): string | null {
  for (const v of [...p1, ...p2]) {
    if (!Number.isFinite(v)) return 'Las coordenadas deben ser números finitos.';
  }
  const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  if (dist < 1) return 'P1 y P2 deben estar al menos 1 mm separados.';
  return null;
}

/**
 * Returns the first "SEG-N" identifier not in existingIds.
 */
export function generateSegmentId(existingIds: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `SEG-${n}`;
    if (!existingIds.has(id)) return id;
  }
}

/**
 * Builds the Piece object for a straight segment.
 *
 * Port directions point outward from each end:
 *   dir(P1) = normalize(P1 − P2)   (away from P2 side)
 *   dir(P2) = normalize(P2 − P1)   (away from P1 side)
 *
 * longitud_mm is the Euclidean distance between P1 and P2.
 * Both are required by the motor for capacity calculations.
 */
export function buildSegmentPiece(
  instanciaId: string,
  productoId: string,
  p1: Point3,
  p2: Point3,
): Piece {
  const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  const dir1: Point3 = [
    (p1[0] - p2[0]) / dist,
    (p1[1] - p2[1]) / dist,
    (p1[2] - p2[2]) / dist,
  ];
  const dir2: Point3 = [
    (p2[0] - p1[0]) / dist,
    (p2[1] - p1[1]) / dist,
    (p2[2] - p1[2]) / dist,
  ];
  return {
    instancia_id: instanciaId,
    producto_id:  productoId,
    longitud_mm:  dist,
    puertos: {
      P1: { posicion_mm: [...p1] as Point3, direccion: dir1 },
      P2: { posicion_mm: [...p2] as Point3, direccion: dir2 },
    },
  };
}
