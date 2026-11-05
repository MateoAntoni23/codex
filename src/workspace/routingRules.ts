/**
 * Pure functions for interactive tray routing.
 * No side effects — all functions are deterministic and testable.
 */
import type { Piece, Product } from '../tray/model';

export type Point3 = [number, number, number];

export interface FreePort {
  pieceId: string;
  portName: string;
  pos: Point3;
  dir: Point3;
}

export interface CompatibilityResult {
  ok: boolean;
  needsReduction: boolean;
  reason: string;
}

type Connection = { conexion_id: string; a: [string, string]; b: [string, string] };

/** Returns a set of "pieceId:portName" keys for all ports already in a connection. */
export function getOccupiedPorts(conexiones: Connection[]): Set<string> {
  const occupied = new Set<string>();
  for (const c of conexiones) {
    occupied.add(`${c.a[0]}:${c.a[1]}`);
    occupied.add(`${c.b[0]}:${c.b[1]}`);
  }
  return occupied;
}

/** Returns all ports that are not part of any connection. */
export function getFreePorts(pieces: Piece[], conexiones: Connection[]): FreePort[] {
  const occupied = getOccupiedPorts(conexiones);
  const free: FreePort[] = [];
  for (const piece of pieces) {
    for (const [portName, port] of Object.entries(piece.puertos)) {
      if (!occupied.has(`${piece.instancia_id}:${portName}`)) {
        free.push({
          pieceId: piece.instancia_id,
          portName,
          pos: port.posicion_mm as Point3,
          dir: port.direccion as Point3,
        });
      }
    }
  }
  return free;
}

/** Snaps a direction to the nearest principal axis (±X, ±Y, ±Z). */
export function snapDirectionToAxis(dir: Point3): Point3 {
  const ax = Math.abs(dir[0]);
  const ay = Math.abs(dir[1]);
  const az = Math.abs(dir[2]);
  if (ax >= ay && ax >= az) return [Math.sign(dir[0]) as 1 | -1, 0, 0];
  if (ay >= ax && ay >= az) return [0, Math.sign(dir[1]) as 1 | -1, 0];
  return [0, 0, Math.sign(dir[2]) as 1 | -1];
}

/** Computes the endpoint of a continuation from a port. */
export function computeEndpoint(pos: Point3, dir: Point3, lengthMm: number): Point3 {
  return [
    pos[0] + dir[0] * lengthMm,
    pos[1] + dir[1] * lengthMm,
    pos[2] + dir[2] * lengthMm,
  ];
}

/**
 * Checks whether two catalog products can be connected directly
 * (same family + same nominal width). Returns whether a reduction is needed.
 */
export function checkDirectCompatibility(
  existingProduct: Product,
  newProduct: Product,
): CompatibilityResult {
  const famA = (existingProduct as Record<string, unknown>).familia_id as string | null | undefined;
  const famB = (newProduct as Record<string, unknown>).familia_id as string | null | undefined;
  const wA = existingProduct.ancho_nominal_mm;
  const wB = newProduct.ancho_nominal_mm;

  if (!famA || !famB) {
    return {
      ok: false,
      needsReduction: false,
      reason: 'Sin familia_id en el catálogo — no se puede verificar compatibilidad.',
    };
  }
  if (famA !== famB) {
    return {
      ok: false,
      needsReduction: false,
      reason: `Familias distintas (${famA} ≠ ${famB}) — incompatibles.`,
    };
  }
  if (wA == null || wB == null) {
    return {
      ok: false,
      needsReduction: false,
      reason: 'Ancho no declarado en el catálogo — no se puede verificar compatibilidad.',
    };
  }
  if (wA !== wB) {
    return {
      ok: false,
      needsReduction: true,
      reason: `Ancho distinto (${wA} ≠ ${wB} mm) — se requiere reducción.`,
    };
  }
  return { ok: true, needsReduction: false, reason: 'Compatibles por ancho y familia.' };
}

/**
 * Finds reduction products compatible with the existing piece port.
 * Reductions whose ancho_nominal_mm (major port) matches the existing piece width
 * and share the same familia_id.
 */
export function findReductionCandidates(
  existingProduct: Product,
  allProducts: Product[],
): Product[] {
  const famA = (existingProduct as Record<string, unknown>).familia_id as string | null | undefined;
  const wA = existingProduct.ancho_nominal_mm;
  if (!famA || wA == null) return [];
  return allProducts.filter((p) => {
    if (p.tipo_pieza !== 'reducción') return false;
    const fam = (p as Record<string, unknown>).familia_id as string | null | undefined;
    return fam === famA && p.ancho_nominal_mm === wA;
  });
}

/** Returns the first CON-NNN identifier not in existingIds. */
export function generateConnectionId(existingIds: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `CON-${String(n).padStart(3, '0')}`;
    if (!existingIds.has(id)) return id;
  }
}
