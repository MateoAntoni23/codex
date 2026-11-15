/**
 * Recetas con ÁNGULO POR INSTANCIA: el ángulo no lo declara el producto sino la
 * pieza colocada (entra en la definición y en la huella). Cada receta tiene su
 * regla, declarada por el operador:
 *   - curvas eslabonadas (EPS, CUS): 90° por defecto, más de 22,5° y hasta 180° (reglaEslabones.ts);
 *   - curva ajustable de escalera (CAS): 90° por defecto, 1°–90° provisional
 *     (reglaCurvaAjustable.ts).
 */
import { ANGULO_ESLABONADA_POR_DEFECTO, motivoAnguloEslabonada, RECETAS_ESLABONADAS } from './reglaEslabones';
import { ANGULO_AJUSTABLE_POR_DEFECTO, motivoAnguloAjustable, RECETA_CURVA_AJUSTABLE } from './reglaCurvaAjustable';

export const RECETAS_ANGULO_INSTANCIA: ReadonlySet<string> = new Set([...RECETAS_ESLABONADAS, RECETA_CURVA_AJUSTABLE]);

export function tieneAnguloInstancia(recipeKey: unknown): boolean {
  return RECETAS_ANGULO_INSTANCIA.has(String(recipeKey));
}

/** Ángulo por defecto de la receta (el de la pieza recién elegida). */
export function anguloPorDefecto(recipeKey: unknown): number {
  return String(recipeKey) === RECETA_CURVA_AJUSTABLE ? ANGULO_AJUSTABLE_POR_DEFECTO : ANGULO_ESLABONADA_POR_DEFECTO;
}

/** null si el ángulo es aceptable para la receta; si no, el motivo con el rango. */
export function motivoAnguloInstancia(recipeKey: unknown, anguloDeg: number): string | null {
  if (String(recipeKey) === RECETA_CURVA_AJUSTABLE) return motivoAnguloAjustable(anguloDeg);
  return motivoAnguloEslabonada(anguloDeg);
}
