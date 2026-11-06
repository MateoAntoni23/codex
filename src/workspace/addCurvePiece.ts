/**
 * Pure logic for creating horizontal curve tray pieces.
 * No side effects — all functions are deterministic and testable.
 *
 * Coordinate system: mm, Z-up (same as all tray geometry).
 *
 * Arc parametrization (θ from 0 to angleDeg·π/180):
 *   point(θ) = P1 + R·sin(θ)·entryDir + R·(1−cos(θ))·turnPerp
 *   tangent(θ) = cos(θ)·entryDir + sin(θ)·turnPerp  (unit vector)
 *
 * turnPerp = cross([0,0,1], entryDir) for left; negated for right.
 * Both ports carry outward normals (away from the piece body).
 */
import type { Piece } from '../tray/model';

export type Point3 = [number, number, number];

/** Returns the first "CRV-N" identifier not in existingIds. */
export function generateCurveId(existingIds: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `CRV-${n}`;
    if (!existingIds.has(id)) return id;
  }
}

function cross(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Point3): Point3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-10) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Returns the perpendicular direction toward the arc center in the horizontal plane.
 *   left  = cross([0,0,1], entryDir)   — CCW turn viewed from +Z
 *   right = negated left               — CW turn
 */
export function computeTurnPerp(entryDir: Point3, turnDirection: 'left' | 'right'): Point3 {
  const left = normalize(cross([0, 0, 1], entryDir));
  return turnDirection === 'left' ? left : ([-left[0], -left[1], -left[2]] as Point3);
}

export interface CurveExitPort {
  pos: Point3;
  dir: Point3;
}

/**
 * Computes the P2 position and exit direction (outward normal at P2) for a curve.
 * radiusMm is the centerline radius (interior_mm + ancho_nominal_mm / 2).
 */
export function computeCurveExitPort(
  p1: Point3,
  entryDir: Point3,
  turnPerp: Point3,
  angleDeg: number,
  radiusMm: number,
): CurveExitPort {
  const θ = (angleDeg * Math.PI) / 180;
  const sinT = Math.sin(θ);
  const cosT = Math.cos(θ);

  const p2: Point3 = [
    p1[0] + radiusMm * sinT * entryDir[0] + radiusMm * (1 - cosT) * turnPerp[0],
    p1[1] + radiusMm * sinT * entryDir[1] + radiusMm * (1 - cosT) * turnPerp[1],
    p1[2] + radiusMm * sinT * entryDir[2] + radiusMm * (1 - cosT) * turnPerp[2],
  ];

  // Tangent at θ is already unit when entryDir and turnPerp are unit and orthogonal
  const exitDir: Point3 = normalize([
    cosT * entryDir[0] + sinT * turnPerp[0],
    cosT * entryDir[1] + sinT * turnPerp[1],
    cosT * entryDir[2] + sinT * turnPerp[2],
  ]);

  return { pos: p2, dir: exitDir };
}

/**
 * Builds the Piece object for a horizontal curve.
 *
 * Port conventions (outward normals, away from the piece body):
 *   P1.direction = −entryDir  (points back along entry axis)
 *   P2.direction = exitDir    (points forward along exit axis)
 *
 * longitud_eje_mm = arc length = radiusMm × θ_rad
 * No longitud_mm (that field is for straight segments only).
 */
export function buildCurvePiece(
  instanciaId: string,
  productoId: string,
  p1: Point3,
  entryDir: Point3,
  turnPerp: Point3,
  angleDeg: number,
  radiusMm: number,
): Piece {
  const θ = (angleDeg * Math.PI) / 180;
  const { pos: p2, dir: exitDir } = computeCurveExitPort(p1, entryDir, turnPerp, angleDeg, radiusMm);

  return {
    instancia_id: instanciaId,
    producto_id: productoId,
    longitud_eje_mm: radiusMm * θ,
    puertos: {
      P1: { posicion_mm: [...p1] as Point3, direccion: [-entryDir[0], -entryDir[1], -entryDir[2]] as Point3 },
      P2: { posicion_mm: [...p2] as Point3, direccion: exitDir },
    },
  };
}
