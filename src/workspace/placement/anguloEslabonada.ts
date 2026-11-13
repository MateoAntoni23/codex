/**
 * Cambiar el ángulo de una curva ESLABONADA ya colocada (EPS, CUS).
 *
 * El ángulo es de la instancia (por defecto 90°, declarado por el operador). Al
 * cambiarlo se recalculan la definición (bocas, polígono), la longitud de eje y
 * los eslabones. La pieza se vuelve a colocar desde su BOCA DE ENTRADA, que no se
 * mueve; la otra boca cambia. Las uniones que dependen de esa boca no se tocan:
 * si ya no cumplen, quedan a la vista con su motivo (A-7: nunca se mueven
 * piezas para tapar un hueco) y se devuelven para informarlas.
 */
import type { Piece, Product, TrayInput } from '../../tray/model';
import { definicionEfectiva, placedOf, withDefinition } from './definitions';
import { placeDefinition, puertosFromWorld, type V3 } from './placementCore';
import { conLongitudesEje, PATRONES_CURVA_ESLABONADA } from './longitudesEje';
import { invalidConnections } from './joins';
import { ANGULO_ESLABONADA_MAX, ANGULO_ESLABONADA_MIN, eslabonesPara } from '../../parametric/reglaEslabones';

export function esCurvaEslabonada(entrada: TrayInput | null | undefined, piece: Piece): boolean {
  const placed = placedOf(entrada, piece);
  return !!placed && PATRONES_CURVA_ESLABONADA.has(placed.def.patron);
}

export function anguloDe(entrada: TrayInput | null | undefined, piece: Piece): number | null {
  const a = placedOf(entrada, piece)?.def.params.angulo_deg;
  return typeof a === 'number' ? a : null;
}

export type CambioAngulo =
  | { ok: true; entrada: TrayInput; eslabones: number; unionesQueNoCumplen: string[] }
  | { ok: false; motivo: string };

export function cambiarAnguloEslabonada(entrada: TrayInput, productos: ReadonlyMap<string, Product>, piezaId: string, anguloDeg: number): CambioAngulo {
  const idx = entrada.piezas.findIndex((p) => p.instancia_id === piezaId);
  const piece = entrada.piezas[idx];
  if (!piece) return { ok: false, motivo: `la pieza ${piezaId} no existe` };
  const placed = placedOf(entrada, piece);
  if (!placed || !PATRONES_CURVA_ESLABONADA.has(placed.def.patron)) return { ok: false, motivo: 'la pieza no es una curva eslabonada' };
  if (!(anguloDeg >= ANGULO_ESLABONADA_MIN && anguloDeg <= ANGULO_ESLABONADA_MAX)) {
    return { ok: false, motivo: `el ángulo tiene que estar entre ${ANGULO_ESLABONADA_MIN}° y ${ANGULO_ESLABONADA_MAX}°` };
  }
  const product = productos.get(piece.producto_id);
  if (!product) return { ok: false, motivo: `producto ${piece.producto_id} no está en el catálogo` };
  const sentido = placed.def.params.sentido_vertical === 1 ? 'sube' : 'baja';
  const d = definicionEfectiva(product, { angulo_deg: anguloDeg, sentido_vertical: sentido });
  if (!d.ok) return { ok: false, motivo: d.motivo };

  // La boca de entrada queda donde está (posición, dirección y "arriba" de sección).
  const c = placed.colocacion;
  const boca = c.boca_entrada ?? 'P1';
  const actual = piece.puertos[boca];
  if (!actual) return { ok: false, motivo: `la pieza no tiene la boca de entrada ${boca}` };
  const n = actual.direccion as V3;
  const pl = placeDefinition({
    def: d.def, huella: d.huella, mano: c.mano, entryPortName: boca,
    startPos: actual.posicion_mm as V3,
    entryDir: [-n[0], -n[1], -n[2]],
    ...(actual.orientacion_seccion_ws ? { sectionUp: actual.orientacion_seccion_ws as V3 } : {}),
  });
  const { longitud_eje_mm: _l, ...sinLongitud } = piece;
  const nueva = conLongitudesEje({ ...sinLongitud, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as Piece, d.def);
  let next: TrayInput = withDefinition({ ...entrada, piezas: [...entrada.piezas] }, d.huella, d.def);
  next.piezas[idx] = nueva;
  next = { ...next };
  return { ok: true, entrada: next, eslabones: eslabonesPara(anguloDeg), unionesQueNoCumplen: invalidConnections(next, new Set([piezaId])) };
}
