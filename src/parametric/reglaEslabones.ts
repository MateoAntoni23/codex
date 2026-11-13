/**
 * Regla de las curvas ESLABONADAS (EPS, CUS), declarada por el operador
 * (2026-11-13). Es aritmética, no geometría: la usan la receta
 * (geometry/curvaEslabonada.ts), la longitud de eje, el cómputo y el cambio de
 * ángulo. Ver la procedencia y las contradicciones con el catálogo en
 * geometry/curvaEslabonada.ts.
 */

/** Recetas de curva eslabonada (perforada y escalera): ángulo por instancia. */
export const RECETAS_ESLABONADAS: ReadonlySet<string> = new Set(['curva_eslabonada', 'escalera:curva_eslabonada']);

export const GRADOS_POR_ARTICULACION = 22.5;
export const ANGULO_ESLABONADA_POR_DEFECTO = 90;
/** Rango aceptado del ángulo por instancia (el catálogo no lo declara). */
export const ANGULO_ESLABONADA_MIN = 1;
export const ANGULO_ESLABONADA_MAX = 180;

export const PROCEDENCIA_ESLABONADA =
  'declarado por el operador (2026-11-13): radio = ancho, 22,5° por articulación, N = techo(θ/22,5°)+1, eje = polígono de N−1 cuerdas; el catálogo no declara ángulo y su radio aproximado es otro (gráfico por cantidad de eslabones)';

/** Eslabones de una curva de θ grados: techo(θ/22,5°) + 1. */
export function eslabonesPara(anguloDeg: number): number {
  if (!(anguloDeg >= ANGULO_ESLABONADA_MIN && anguloDeg <= ANGULO_ESLABONADA_MAX)) {
    throw new Error(`ángulo ${anguloDeg}° fuera de rango (${ANGULO_ESLABONADA_MIN}–${ANGULO_ESLABONADA_MAX}°)`);
  }
  // Tolerancia numérica para que 45 / 22,5 dé 2 y no 2,0000000001.
  return Math.ceil(anguloDeg / GRADOS_POR_ARTICULACION - 1e-9) + 1;
}

export interface MedidasEslabonada {
  readonly anguloDeg: number;
  readonly radioMm: number;
  readonly eslabones: number;
  readonly articulaciones: number;
  /** Giro de cada articulación (≤ 22,5°). */
  readonly gradosPorArticulacion: number;
  readonly cuerdaMm: number;
  /** Longitud de eje: N−1 cuerdas. */
  readonly longitudEjeMm: number;
}

export function medidasEslabonada(anchoMm: number, anguloDeg: number): MedidasEslabonada {
  const eslabones = eslabonesPara(anguloDeg);
  const articulaciones = eslabones - 1;
  const alfa = anguloDeg / articulaciones;
  const radioMm = anchoMm;
  const cuerdaMm = 2 * radioMm * Math.sin((alfa * Math.PI) / 360);
  return { anguloDeg, radioMm, eslabones, articulaciones, gradosPorArticulacion: alfa, cuerdaMm, longitudEjeMm: articulaciones * cuerdaMm };
}

