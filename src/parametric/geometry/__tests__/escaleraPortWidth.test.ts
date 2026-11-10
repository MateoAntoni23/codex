/**
 * escaleraPortWidth — regresión del bug de "bocas ancho 150 en lugar de 300".
 *
 * Contexto:
 *   El usuario reportó durante la revisión de patrones escalera (XS-300,
 *   TS-300-065-14-G, CAS-300) que las bocas aparecían con ancho ≈150 mm en
 *   vez de 300. La causa raíz quedó localizada en `scaleFactorsFromOutline`
 *   (`src/parametric/geometry/escaleraRecipes.ts`), que usaba
 *   `outline.bbox_local.z_max` como "ancho base" del polígono medido. Para
 *   TRES (rectangular) z_max coincide con el ancho útil (≈298.9), pero para
 *   las piezas no rectangulares (CS-45, CS-90, TS, XS) z_max representa la
 *   EXTENSIÓN TOTAL del polígono (1187, 1189, 744, 652 mm) — resultado: el
 *   factor de escala era ancho_objetivo/extensión_total, muy inferior a 1, y
 *   las bocas terminaban con `ancho_mm` del orden de 75–137 mm.
 *
 * Qué defiende este test:
 *   Para cada maestro escalera con regla uniform-xz, al construir la receta a
 *   ancho_mm=300, la longitud de la arista de cada boca operativa (que es
 *   también `port.ancho_mm`) debe ser ≈ 300 mm (dentro de ±2 mm de tolerancia
 *   por el medido 298.9 nominal 300). Para TRES, la boca debe mantenerse en
 *   ≈ 300 (su z_max ya era el ancho).
 *
 * Qué NO cubre (deliberadamente):
 *   - RIS: su receta no usa `scaleFactorsFromOutline` (polígono fijo, sólo
 *     escala la ala), así que el bug no lo afecta.
 *   - Variantes con ancho_mm ≠ 300: la hipótesis uniform-xz sigue siendo una
 *     hipótesis visual; sólo exigimos consistencia dimensional en el base
 *     (ancho_mm=300), que es el patrón calibrable.
 */
import { describe, expect, it } from 'vitest';
import { buildRecipeByKey } from '../recipes';

const EPS_ANCHO_MM = 2; // tolerancia: medidas STEP son 298.9 (nominal 300).

describe('escalera — bocas operativas mantienen ancho ≈ 300 al generarse a 300', () => {
  it('CS-45 (curva horizontal 45°): P1 y P2 a ancho 300', () => {
    const recipe = buildRecipeByKey('escalera:curva_horizontal', {
      ancho_mm: 300,
      ala_mm: 65,
      angulo_deg: 45,
    });
    expect(recipe.ports).toHaveLength(2);
    for (const p of recipe.ports) {
      expect(
        Math.abs(p.ancho_mm - 300),
        `CS-45 ${p.name} ancho_mm=${p.ancho_mm}, esperado ≈ 300`,
      ).toBeLessThan(EPS_ANCHO_MM);
    }
  });

  it('CS-90 (curva horizontal 90°, incluye CAS por dispatcher default): P1 y P2 a ancho 300', () => {
    const recipe = buildRecipeByKey('escalera:curva_horizontal', {
      ancho_mm: 300,
      ala_mm: 65,
      angulo_deg: 90,
    });
    expect(recipe.ports).toHaveLength(2);
    for (const p of recipe.ports) {
      expect(
        Math.abs(p.ancho_mm - 300),
        `CS-90 ${p.name} ancho_mm=${p.ancho_mm}, esperado ≈ 300`,
      ).toBeLessThan(EPS_ANCHO_MM);
    }
  });

  it('CAS (curva sin angulo_grados → dispatcher default a 90°): P1 y P2 a ancho 300', () => {
    // CAS se diferencia de CS en la UI porque el producto no publica
    // `angulo_grados`. El dispatcher `buildRecipeByKey` aplica default
    // angulo_deg=90 en ese caso — el resultado efectivo es CS-90.
    const recipe = buildRecipeByKey('escalera:curva_horizontal', {
      ancho_mm: 300,
      ala_mm: 65,
      // sin angulo_deg: defaultea a 90 (ver recipes.ts:142).
    });
    expect(recipe.ports).toHaveLength(2);
    for (const p of recipe.ports) {
      expect(
        Math.abs(p.ancho_mm - 300),
        `CAS ${p.name} ancho_mm=${p.ancho_mm}, esperado ≈ 300`,
      ).toBeLessThan(EPS_ANCHO_MM);
    }
  });

  it('TS (derivación lateral): P1, P2, P3 a ancho 300', () => {
    const recipe = buildRecipeByKey('escalera:derivacion_lateral', {
      ancho_mm: 300,
      ala_mm: 65,
    });
    expect(recipe.ports).toHaveLength(3);
    for (const p of recipe.ports) {
      expect(
        Math.abs(p.ancho_mm - 300),
        `TS ${p.name} ancho_mm=${p.ancho_mm}, esperado ≈ 300`,
      ).toBeLessThan(EPS_ANCHO_MM);
    }
  });

  it('XS (cruz): P1, P2, P3, P4 a ancho 300', () => {
    const recipe = buildRecipeByKey('escalera:cruz', {
      ancho_mm: 300,
      ala_mm: 65,
    });
    expect(recipe.ports).toHaveLength(4);
    for (const p of recipe.ports) {
      expect(
        Math.abs(p.ancho_mm - 300),
        `XS ${p.name} ancho_mm=${p.ancho_mm}, esperado ≈ 300`,
      ).toBeLessThan(EPS_ANCHO_MM);
    }
  });

  it('TRES (tramo recto, baseline): bocas a ancho 300 (ya era correcto)', () => {
    const recipe = buildRecipeByKey('escalera:tramo_recto', {
      ancho_mm: 300,
      ala_mm: 65,
      longitud_mm: 3000,
    });
    expect(recipe.ports).toHaveLength(2);
    for (const p of recipe.ports) {
      expect(
        Math.abs(p.ancho_mm - 300),
        `TRES ${p.name} ancho_mm=${p.ancho_mm}, esperado ≈ 300`,
      ).toBeLessThan(EPS_ANCHO_MM);
    }
  });
});
