/**
 * Cambiar el ángulo de una curva con ÁNGULO POR INSTANCIA ya colocada: eslabonadas
 * (EPS, CUS) y ajustable de escalera (CAS, 2026-11-14). Cada una con su rango
 * (`motivoAnguloInstancia`).
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
import { eslabonesPara, motivoAnguloEslabonada, planoDeGiro } from '../../parametric/reglaEslabones';
import { PATRON_CURVA_AJUSTABLE, RECETA_CURVA_AJUSTABLE } from '../../parametric/reglaCurvaAjustable';
import { motivoAnguloInstancia } from '../../parametric/anguloInstancia';

export function esCurvaEslabonada(entrada: TrayInput | null | undefined, piece: Piece): boolean {
  const placed = placedOf(entrada, piece);
  return !!placed && PATRONES_CURVA_ESLABONADA.has(placed.def.patron);
}

/** Plano en que gira una pieza colocada de dos bocas (por las direcciones de P1 y P2). */
export function planoDePieza(piece: Piece) {
  const a = piece.puertos.P1?.direccion;
  const b = piece.puertos.P2?.direccion;
  return a && b ? planoDeGiro(a as number[], b as number[]) : null;
}

/** Curva ajustable de escalera (CAS) colocada con su definición. */
export function esCurvaAjustable(entrada: TrayInput | null | undefined, piece: Piece): boolean {
  return placedOf(entrada, piece)?.def.patron === PATRON_CURVA_AJUSTABLE;
}

export function anguloDe(entrada: TrayInput | null | undefined, piece: Piece): number | null {
  const a = placedOf(entrada, piece)?.def.params.angulo_deg;
  return typeof a === 'number' ? a : null;
}

export type CambioAngulo =
  | {
      ok: true; entrada: TrayInput;
      /** Eslabones de la curva eslabonada; null en la ajustable (una pieza por código). */
      eslabones: number | null;
      unionesQueNoCumplen: string[];
    }
  | { ok: false; motivo: string };

/** Cambiar el ángulo de una curva eslabonada (EPS, CUS). Ver `cambiarAnguloInstancia`. */
export function cambiarAnguloEslabonada(entrada: TrayInput, productos: ReadonlyMap<string, Product>, piezaId: string, anguloDeg: number): CambioAngulo {
  return cambiarAnguloInstancia(entrada, productos, piezaId, anguloDeg, 'eslabonada');
}

/** Cambiar el ángulo de una curva ajustable de escalera (CAS). Ver `cambiarAnguloInstancia`. */
export function cambiarAnguloAjustable(entrada: TrayInput, productos: ReadonlyMap<string, Product>, piezaId: string, anguloDeg: number): CambioAngulo {
  return cambiarAnguloInstancia(entrada, productos, piezaId, anguloDeg, 'ajustable');
}

function cambiarAnguloInstancia(
  entrada: TrayInput, productos: ReadonlyMap<string, Product>, piezaId: string, anguloDeg: number, clase: 'eslabonada' | 'ajustable',
): CambioAngulo {
  const idx = entrada.piezas.findIndex((p) => p.instancia_id === piezaId);
  const piece = entrada.piezas[idx];
  if (!piece) return { ok: false, motivo: `la pieza ${piezaId} no existe` };
  const placed = placedOf(entrada, piece);
  const esDeLaClase = !!placed && (clase === 'eslabonada' ? PATRONES_CURVA_ESLABONADA.has(placed.def.patron) : placed.def.patron === PATRON_CURVA_AJUSTABLE);
  if (!placed || !esDeLaClase) return { ok: false, motivo: clase === 'eslabonada' ? 'la pieza no es una curva eslabonada' : 'la pieza no es una curva ajustable' };
  // Eslabonada: el motivo depende del plano en que gira ESTA pieza (vertical u horizontal).
  const fueraDeRango = clase === 'eslabonada'
    ? motivoAnguloEslabonada(anguloDeg, planoDePieza(piece) ?? 'vertical')
    : motivoAnguloInstancia(RECETA_CURVA_AJUSTABLE, anguloDeg);
  if (fueraDeRango) return { ok: false, motivo: fueraDeRango };
  const product = productos.get(piece.producto_id);
  if (!product) return { ok: false, motivo: `producto ${piece.producto_id} no está en el catálogo` };
  const d = clase === 'eslabonada'
    ? definicionEfectiva(product, { angulo_deg: anguloDeg, sentido_vertical: placed.def.params.sentido_vertical === 1 ? 'sube' : 'baja' })
    : definicionEfectiva(product, { angulo_deg: anguloDeg });
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
  return {
    ok: true, entrada: next,
    eslabones: clase === 'eslabonada' ? eslabonesPara(anguloDeg) : null,
    unionesQueNoCumplen: invalidConnections(next, new Set([piezaId])),
  };
}
