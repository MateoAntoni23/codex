/**
 * Pure logic for creating tray supports from the UI.
 * No side effects — all functions are deterministic and testable.
 */
import type { Support, Piece } from '../tray/model';

export type Point3 = [number, number, number];

/** Euclidean length of a piece in mm from its P1/P2 ports. Returns 0 if ports missing. */
export function pieceLength(piece: Piece): number {
  const p1 = piece.puertos['P1']?.posicion_mm as Point3 | undefined;
  const p2 = piece.puertos['P2']?.posicion_mm as Point3 | undefined;
  if (!p1 || !p2) return 0;
  return Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
}

/**
 * Returns an error message if the support inputs are invalid, or null if valid.
 * piezaLen is the computed length of the target piece (used to bound distancia).
 */
export function validateSupportInput(
  instanciaId: string,
  productoId: string,
  sistemaSoporteId: string,
  distancia: number,
  piezaLen: number,
): string | null {
  if (!instanciaId) return 'Seleccioná una pieza.';
  if (!productoId) return 'Seleccioná un producto de soporte.';
  if (!sistemaSoporteId.trim()) return 'El sistema de soporte no puede estar vacío.';
  if (!Number.isFinite(distancia)) return 'La distancia debe ser un número finito.';
  if (distancia < 0) return 'La distancia no puede ser negativa.';
  if (piezaLen > 0 && distancia > piezaLen) {
    return `La distancia excede la longitud de la pieza (${piezaLen.toFixed(0)} mm).`;
  }
  return null;
}

/** Returns the first "SUP-N" identifier not in existingIds. */
export function generateSupportId(existingIds: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `SUP-${n}`;
    if (!existingIds.has(id)) return id;
  }
}

/** Builds the Support object from validated inputs. */
export function buildSupport(
  soporteId: string,
  instanciaId: string,
  productoId: string,
  sistemaSoporteId: string,
  distanciaMm: number,
): Support {
  return {
    soporte_id:            soporteId,
    instancia_id:          instanciaId,
    producto_id:           productoId,
    sistema_soporte_id:    sistemaSoporteId,
    distancia_desde_P1_mm: distanciaMm,
  };
}
