/**
 * Regla de la CURVA AJUSTABLE de escalera (CAS-{ancho}-{ala}-{espesor}-{G|Z}),
 * declarada por el operador (2026-11-14). Es aritmética, no geometría: la usan
 * la receta (geometry/curvaAjustable.ts), la longitud de eje, la validación del
 * ángulo al colocar y al corregir, y la ficha.
 *
 * El catálogo NO declara ángulo ni radio: «Ángulo ajustable: rango no declarado.
 * Radio no declarado para esta pieza». Todo lo de acá es del operador:
 *   - radio INTERIOR de giro = ancho de la bandeja; el radio del EJE es el
 *     interior más medio ancho (R_eje = 1,5 × ancho). Bocas y longitud de eje van
 *     sobre el eje;
 *   - ángulo por instancia, 90° por defecto;
 *   - rango de 1° a 90°, PROVISIONAL.
 *
 * A diferencia de la CUS, el código no lleva cantidad de eslabones: es una pieza
 * por código, sin regla de eslabones. Cómputo: 1 código por curva.
 */

export const RECETA_CURVA_AJUSTABLE = 'escalera:curva_ajustable';
export const PATRON_CURVA_AJUSTABLE = 'master:escalera:curva_ajustable';

export const ANGULO_AJUSTABLE_POR_DEFECTO = 90;
export const ANGULO_AJUSTABLE_MIN = 1;
/**
 * PROVISIONAL (operador, 2026-11-14). Elegido corto a propósito: rechazar un ángulo
 * válido se ve en el momento; aceptar uno imposible recién se descubre en obra. Si el
 * operador necesita un ángulo mayor, el rango se amplía cambiando ESTE valor.
 */
export const ANGULO_AJUSTABLE_MAX = 90;

export const PROCEDENCIA_CURVA_AJUSTABLE =
  'declarado por el operador (2026-11-14): radio interior = ancho, radio del eje = interior + ancho/2, ángulo por instancia (90° por defecto), rango 1°–90° provisional; el catálogo no declara ángulo ni radio';

/** Texto del rango, para los motivos y la interfaz. */
export const RANGO_AJUSTABLE_TEXTO = `de ${ANGULO_AJUSTABLE_MIN}° a ${ANGULO_AJUSTABLE_MAX}° (provisional, declarado por el operador)`;

/** null si el ángulo está en el rango; si no, el motivo con el rango. */
export function motivoAnguloAjustable(anguloDeg: number): string | null {
  if (!Number.isFinite(anguloDeg)) return `ángulo inválido: la curva ajustable acepta ${RANGO_AJUSTABLE_TEXTO}`;
  if (anguloDeg < ANGULO_AJUSTABLE_MIN || anguloDeg > ANGULO_AJUSTABLE_MAX) {
    return `ángulo ${anguloDeg}° fuera de rango: la curva ajustable acepta ${RANGO_AJUSTABLE_TEXTO}`;
  }
  return null;
}

export interface MedidasCurvaAjustable {
  readonly anguloDeg: number;
  readonly radioInteriorMm: number;
  readonly radioEjeMm: number;
  readonly radioExteriorMm: number;
  /** Longitud de eje: el arco de radio R_eje y ángulo θ. */
  readonly longitudEjeMm: number;
}

export function medidasCurvaAjustable(anchoMm: number, anguloDeg: number): MedidasCurvaAjustable {
  const motivo = motivoAnguloAjustable(anguloDeg);
  if (motivo) throw new Error(motivo);
  const radioInteriorMm = anchoMm;
  const radioEjeMm = radioInteriorMm + anchoMm / 2;
  return {
    anguloDeg,
    radioInteriorMm,
    radioEjeMm,
    radioExteriorMm: radioInteriorMm + anchoMm,
    longitudEjeMm: (radioEjeMm * anguloDeg * Math.PI) / 180,
  };
}
