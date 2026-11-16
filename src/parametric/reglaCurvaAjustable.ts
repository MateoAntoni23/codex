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
 *   - RANGO del producto de 0° a 90° (operador, 2026-11-15; ya no provisional):
 *     es lo que la pieza admite de fábrica;
 *   - una pieza COLOCADA necesita más de 0°: a 0° la curva no gira ni aporta
 *     longitud (eje 0, la boca de salida coincide con la de entrada), así que no es
 *     una pieza; para un tramo sin giro va un tramo recto. Se rechaza al colocar y
 *     al corregir, con ese motivo, y así ninguna CAS a 0° llega al motor (que exige
 *     longitud de eje > 0).
 *
 * Pendiente del operador: si un codo ajustable totalmente cerrado se usa en obra
 * como pieza recta de paso, a 0° tendría una longitud física propia que el catálogo
 * no publica y habría que declararla. Hasta que conteste, rige el rechazo a 0°.
 *
 * A diferencia de la CUS, el código no lleva cantidad de eslabones: es una pieza
 * por código, sin regla de eslabones. Cómputo: 1 código por curva.
 */

export const RECETA_CURVA_AJUSTABLE = 'escalera:curva_ajustable';
export const PATRON_CURVA_AJUSTABLE = 'master:escalera:curva_ajustable';

export const ANGULO_AJUSTABLE_POR_DEFECTO = 90;
/** Rango del producto, declarado por el operador (2026-11-15). La pieza colocada necesita > MIN. */
export const ANGULO_AJUSTABLE_MIN = 0;
export const ANGULO_AJUSTABLE_MAX = 90;

export const PROCEDENCIA_CURVA_AJUSTABLE =
  'declarado por el operador (2026-11-14): radio interior = ancho, radio del eje = interior + ancho/2, ángulo por instancia (90° por defecto); rango del producto 0°–90° (2026-11-15), pieza colocada con más de 0°; el catálogo no declara ángulo ni radio';

/** Texto del rango del producto, para los motivos y la interfaz. */
export const RANGO_AJUSTABLE_TEXTO = `de ${ANGULO_AJUSTABLE_MIN}° a ${ANGULO_AJUSTABLE_MAX}° (declarado por el operador)`;
/** Lo que acepta una pieza colocada. */
export const RANGO_AJUSTABLE_COLOCADA_TEXTO = `más de ${ANGULO_AJUSTABLE_MIN}° y hasta ${ANGULO_AJUSTABLE_MAX}°`;

export const MOTIVO_AJUSTABLE_CERO =
  'ángulo 0°: a 0° la curva ajustable no gira ni aporta longitud (la boca de salida coincide con la de entrada); para un tramo sin giro va un tramo recto';

/**
 * null si el ángulo sirve para una pieza colocada (más de 0° y hasta 90°); si no, el
 * motivo. 0° está dentro del rango del producto pero no es una pieza: motivo propio.
 */
export function motivoAnguloAjustable(anguloDeg: number): string | null {
  if (!Number.isFinite(anguloDeg)) return `ángulo inválido: la curva ajustable acepta ${RANGO_AJUSTABLE_TEXTO}`;
  if (anguloDeg < ANGULO_AJUSTABLE_MIN || anguloDeg > ANGULO_AJUSTABLE_MAX) {
    return `ángulo ${anguloDeg}° fuera de rango: la curva ajustable acepta ${RANGO_AJUSTABLE_TEXTO}`;
  }
  if (anguloDeg === ANGULO_AJUSTABLE_MIN) return MOTIVO_AJUSTABLE_CERO;
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
