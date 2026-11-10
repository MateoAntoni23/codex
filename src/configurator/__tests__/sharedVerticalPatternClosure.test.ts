// @vitest-environment node
/**
 * sharedVerticalPatternClosure — regresión del patrón vertical compartido.
 *
 * El "patrón vertical compartido" entre perforada y escalera se refiere al
 * modelo ascendente/descendente del catálogo:
 *
 *   PERFORADA
 *     CUPS-{050..600}-A-Z  tipo_pieza="curva vertical interior"  (ascendente)
 *     CUPS-{050..600}-D-Z  tipo_pieza="curva vertical exterior"  (descendente)
 *
 *   ESCALERA
 *     CUS-*  tipo_pieza="curva vertical articulada" — pieza articulada de 5
 *     tramos. SAMET no publica STEP; el master escalera-vertical aún no está
 *     declarado. Esta regresión cubre sólo perforada; la aparición futura del
 *     master escalera queda señalada por `declaredVariantSkus=[]` en el maestro
 *     correspondiente.
 *
 * Propiedades a verificar (perforada):
 *   SV1. Los dos masters (curva_vertical_interior y curva_vertical_exterior)
 *        declaran la regla `depth-only` con `provenance=derived`.
 *   SV2. Las 6 variantes A-Z declaradas se resuelven al master interior.
 *   SV3. Las 6 variantes D-Z declaradas se resuelven al master exterior.
 *   SV4. La distinción comercial A↔D se preserva: aunque la geometría generada
 *        es la misma, los masters son disjuntos y no comparten producto_id.
 *   SV5. Para cada ancho objetivo ∈ {50,100,150,200,300,450,600}: la boca útil
 *        resuelta en la receta tiene `ancho_mm` IGUAL al ancho objetivo.
 *        Esto demuestra la convención de escala documentada en el header del
 *        módulo: aunque el inspector muestre factor nominal = ancho/300, el
 *        pipeline garantiza boca útil = ancho objetivo porque `buildCUPSRecipe`
 *        pasa `ancho_mm` directamente al puerto (sin pasar por el factor
 *        medido 298.9 que sí usa escalera).
 *   SV6. La geometría XY del polígono es idéntica entre A y D del mismo ancho
 *        (comparten patrón geométrico), y el polígono es `ancho`-dependiente
 *        sólo en el eje Z vía `translate` y `height` (regla depth-only).
 *
 * Esta regresión NO demuestra fidelidad medida: sólo demuestra consistencia de
 * propagación. Para auditoría con planos SAMET, habría que marcar cada variante
 * como pendiente de STEP individual.
 */
import { describe, it, expect } from 'vitest';
import { buildCUPSRecipe } from '../../parametric/geometry/outlines';
import { findMasterById, findMasterForProduct } from '../masterModels';

const CUPS_ANCHOS = [50, 100, 150, 200, 300, 450, 600] as const;

function productFor(ancho: number, variante: 'A' | 'D') {
  const tipo =
    variante === 'A' ? 'curva vertical interior' : 'curva vertical exterior';
  const skuAncho = String(ancho).padStart(3, '0');
  return {
    familia_id: 'SAM-STP-Z',
    tipo_pieza: tipo,
    ala_nominal_mm: 50,
    ancho_nominal_mm: ancho,
    sku: `CUPS-${skuAncho}-${variante}-Z`,
    producto_id: `SAM_CUPS-${skuAncho}-${variante}-Z`,
  };
}

describe('sharedVerticalPatternClosure — perforada CUPS A/D', () => {
  it('SV1. ambos masters declaran regla depth-only derivada', () => {
    const interior = findMasterById('master:perforada:curva_vertical_interior');
    const exterior = findMasterById('master:perforada:curva_vertical_exterior');
    expect(interior).toBeTruthy();
    expect(exterior).toBeTruthy();
    expect(interior!.variationRule.kind).toBe('depth-only');
    expect(interior!.variationRule.provenance).toBe('derived');
    expect(exterior!.variationRule.kind).toBe('depth-only');
    expect(exterior!.variationRule.provenance).toBe('derived');
  });

  it('SV2. las 6 variantes A-Z declaradas resuelven al master interior', () => {
    for (const ancho of CUPS_ANCHOS) {
      if (ancho === 300) continue;
      const master = findMasterForProduct(productFor(ancho, 'A'));
      expect(master, `CUPS-${ancho}-A-Z master`).toBeTruthy();
      expect(master!.id).toBe('master:perforada:curva_vertical_interior');
    }
  });

  it('SV3. las 6 variantes D-Z declaradas resuelven al master exterior', () => {
    for (const ancho of CUPS_ANCHOS) {
      if (ancho === 300) continue;
      const master = findMasterForProduct(productFor(ancho, 'D'));
      expect(master, `CUPS-${ancho}-D-Z master`).toBeTruthy();
      expect(master!.id).toBe('master:perforada:curva_vertical_exterior');
    }
  });

  it('SV4. A y D son masters disjuntos (preservan distinción comercial)', () => {
    const interior = findMasterById('master:perforada:curva_vertical_interior');
    const exterior = findMasterById('master:perforada:curva_vertical_exterior');
    expect(interior!.id).not.toBe(exterior!.id);
    expect(interior!.catalogMatch.catalogTipoPieza).toBe('curva vertical interior');
    expect(exterior!.catalogMatch.catalogTipoPieza).toBe('curva vertical exterior');
    // Comparten STEP source: misma hipótesis geométrica.
    expect(interior!.source.stepHashShort).toBe(exterior!.source.stepHashShort);
    expect(interior!.source.stepFile).toBe(exterior!.source.stepFile);
    // No comparten declaredVariantSkus (SKUs no se cruzan).
    for (const skuA of interior!.declaredVariantSkus) {
      expect(exterior!.declaredVariantSkus).not.toContain(skuA);
    }
    for (const skuD of exterior!.declaredVariantSkus) {
      expect(interior!.declaredVariantSkus).not.toContain(skuD);
    }
  });

  it('SV5. boca útil de la receta = ancho_mm objetivo para los 7 anchos (convención de escala)', () => {
    for (const ancho of CUPS_ANCHOS) {
      const recipe = buildCUPSRecipe({ ancho_mm: ancho, ala_mm: 50 });
      // Ambos puertos de CUPS: P1_horizontal (boca bandeja) y P2_vertical
      // (boca tramo). El polígono es cuadrado — ambos deben tener ancho_mm
      // exacto, no multiplicado por 298.9/300.
      for (const portName of ['P1_horizontal', 'P2_vertical']) {
        const port = recipe.ports.find((p) => p.name === portName);
        expect(port, `${portName} @ ancho=${ancho}`).toBeTruthy();
        expect(port!.ancho_mm, `${portName} @ ancho=${ancho}`).toBeCloseTo(ancho, 6);
      }
    }
  });

  it('SV6. A y D comparten polígono XY; Z escala con ancho (depth-only)', () => {
    // Al compartir masters de STEP source, generar la receta base idéntica
    // debe producir la misma geometría XY para ambos. (El "sentido" asc/desc
    // es orientación en escena, no polígono.)
    for (const ancho of CUPS_ANCHOS) {
      const recipe = buildCUPSRecipe({ ancho_mm: ancho, ala_mm: 50 });
      // height = ancho (profundidad del canal en Z).
      expect(recipe.height).toBe(ancho);
      // translate.z = -ancho (CUPS se apoya en z=0).
      expect(recipe.translate[2]).toBe(-ancho);
      // XY del polígono: independiente del ancho (perfil XY fijo).
      const recipe300 = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });
      expect(recipe.polygon.length).toBe(recipe300.polygon.length);
      for (let i = 0; i < recipe.polygon.length; i++) {
        expect(recipe.polygon[i][0]).toBeCloseTo(recipe300.polygon[i][0], 6);
        expect(recipe.polygon[i][1]).toBeCloseTo(recipe300.polygon[i][1], 6);
      }
    }
  });

  it('SV7. documentación: escalera-vertical (CUS) aún no tiene master declarado', () => {
    // Cuando SAMET publique CUS STEP (o se acepte una regla estimada basada en
    // CS-45/CS-90 adaptados), se declarará master:escalera:curva_vertical_articulada.
    // Hasta entonces, este test deja constancia de la ausencia.
    const cusMaster = findMasterById(
      'master:escalera:curva_vertical_articulada' as never,
    );
    expect(cusMaster).toBeNull();
  });
});
