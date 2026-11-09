// @vitest-environment node
/**
 * variantsClosure — regresión de la dimensión "variantes verificadas" del cierre.
 *
 * Qué prueba: configurar el producto base del maestro (con un `modelFrame`
 * desde el Configurador) produce el mismo marco corregido al resolver una
 * VARIANTE del mismo maestro en el workspace, sin copiar coordenadas absolutas
 * del producto base. Es la cadena "configurador → preview/confirmado" vista
 * desde el contrato de resolución geométrica.
 *
 * Patrón piloto: TRPS (perforada, regla `ancho-only-z`, variante declarada
 * TRPS-450-22-Z). Elegido por:
 *   - regla de variación derivada (no estimada);
 *   - variante declarada en el catálogo (no hipotética);
 *   - escala NO uniforme (ancho ≠ ala) → caso más sensible para detectar
 *     regresiones de "copia absoluta" (donde la variante leería el centro
 *     absoluto del maestro en vez del centro escalado de su propia receta).
 *
 * Invariantes verificados:
 *   V1. Sin overrides → variante devuelve receta cruda escalada por la regla.
 *   V2. Override `modelFrame.rz_deg=90` SÓLO en el base del maestro → la
 *       variante hereda ese modelFrame y sus ports quedan rotados 90°.
 *   V3. La herencia NO copia centros absolutos: el |z| de la variante rotada
 *       corresponde a 225 mm (ancho/2 escalado) vista desde su propio marco,
 *       no a los 150 mm del maestro base.
 *   V4. Si la variante tiene override DIRECTO, ése gana sobre la herencia.
 *   V5. Al limpiar el override del base, la variante vuelve a la receta cruda
 *       (no quedan restos pegajosos del master.base).
 *
 * No ejercita UI; opera sobre los módulos puros `resolveRecipeForProduct` +
 * `catalogPortMapping`. La cadena interactiva completa está cubierta por los
 * Playwright `configuratorCalibrationChain` y `entregaFinalUserChain`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearPortMappingOverrides,
  setPortMappingOverrides,
  setProductCatalogIndex,
  clearProductCatalogIndex,
  setMasterResolver,
} from '../../workspace/catalogPortMapping';
import { resolveRecipeForProduct } from '../../workspace/resolvedPortGeometry';
import { buildTRPSRecipe } from '../../parametric/geometry/outlines';
import { findMasterById, findMasterForProduct } from '../masterModels';

const BASE_ID = 'SAM_TRPS-300-22-Z';
const VARIANT_ID = 'SAM_TRPS-450-22-Z';
const BASE_RECIPE = () => buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 2200 });
const VARIANT_RECIPE = () => buildTRPSRecipe({ ancho_mm: 450, ala_mm: 50, longitud_mm: 2200 });

const EPS = 1e-6;

function near(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}

function seedCatalogAndResolver() {
  setProductCatalogIndex([
    {
      producto_id: BASE_ID,
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
      sku: 'TRPS-300-22-Z',
    },
    {
      producto_id: VARIANT_ID,
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      sku: 'TRPS-450-22-Z',
    },
  ]);
  setMasterResolver((p) => {
    const product = {
      producto_id: p.producto_id,
      sku: p.sku ?? null,
      familia_id: p.familia_id ?? null,
      tipo_pieza: p.tipo_pieza ?? 'recta',
      ancho_nominal_mm: p.ancho_nominal_mm ?? null,
      ala_nominal_mm: p.ala_nominal_mm ?? null,
      angulo_grados: p.angulo_grados ?? null,
    } as unknown as Parameters<typeof findMasterForProduct>[0];
    const m = findMasterForProduct(product);
    if (!m) return null;
    return { id: m.id, baseParams: m.baseParams };
  });
}

describe('variantsClosure — pilot TRPS 300 → 450', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
    seedCatalogAndResolver();
  });

  afterEach(() => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
  });

  it('precondición: el maestro TRPS tiene la variante 450 declarada y regla ancho-only-z', () => {
    const master = findMasterById('master:perforada:tramo_recto');
    expect(master).toBeTruthy();
    expect(master!.variationRule.kind).toBe('ancho-only-z');
    expect(master!.variationRule.provenance).toBe('derived');
    expect(master!.declaredVariantSkus).toContain('TRPS-450-20-Z');
  });

  it('V1. sin overrides: variante devuelve receta cruda escalada (|z|=225, no 150)', () => {
    const resolved = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    expect(resolved.isIdentity).toBe(true);
    const absZ = Math.max(...resolved.recipe.ports.map((p) => Math.abs(p.center[2])));
    expect(absZ).toBeCloseTo(225, 1); // 450 / 2 — escala de la regla, no del maestro base
  });

  it('V2. modelFrame declarado en el base se hereda en la variante (ports rotados 90°)', () => {
    setPortMappingOverrides({
      [BASE_ID]: {
        productId: BASE_ID,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    const resolvedBase = resolveRecipeForProduct(BASE_RECIPE(), BASE_ID);
    const resolvedVariant = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);

    expect(resolvedBase.isIdentity).toBe(false);
    expect(resolvedVariant.isIdentity).toBe(false);

    // TRPS raw: P1 center (0, 25, -w/2), normal (-1, 0, 0).
    // rz=90° → (x, y, z) ↦ (-y, x, z); normal ↦ (0, -1, 0).
    // Base (w=300): center (-25, 0, -150), variante (w=450): center (-25, 0, -225).
    const p1Base = resolvedBase.recipe.ports.find((p) => p.name === 'P1')!;
    const p1Variant = resolvedVariant.recipe.ports.find((p) => p.name === 'P1')!;

    expect(near(p1Base.center[0], -25, 1e-3)).toBe(true);
    expect(near(p1Base.center[1], 0, 1e-3)).toBe(true);
    expect(near(p1Base.center[2], -150, 1e-3)).toBe(true);
    expect(near(p1Variant.center[0], -25, 1e-3)).toBe(true);
    expect(near(p1Variant.center[1], 0, 1e-3)).toBe(true);
    expect(near(p1Variant.center[2], -225, 1e-3)).toBe(true);

    // Normal rotada igual en ambos — es invariante a la escala.
    expect(near(p1Base.normal[0], 0, 1e-3)).toBe(true);
    expect(near(p1Base.normal[1], -1, 1e-3)).toBe(true);
    expect(near(p1Variant.normal[0], 0, 1e-3)).toBe(true);
    expect(near(p1Variant.normal[1], -1, 1e-3)).toBe(true);
  });

  it('V3. herencia NO copia centros absolutos del maestro base', () => {
    setPortMappingOverrides({
      [BASE_ID]: {
        productId: BASE_ID,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    const resolvedVariant = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    const p1Variant = resolvedVariant.recipe.ports.find((p) => p.name === 'P1')!;
    // Si la variante leyera los centers absolutos del maestro base rotados,
    // z sería -150. Si proyecta su propio center escalado y luego rota, -225.
    expect(Math.abs(p1Variant.center[2] - -150)).toBeGreaterThan(50);
    expect(Math.abs(p1Variant.center[2] - -225)).toBeLessThan(1);
  });

  it('V4. override directo de la variante gana sobre la herencia del base', () => {
    setPortMappingOverrides({
      [BASE_ID]: {
        productId: BASE_ID,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
      [VARIANT_ID]: {
        productId: VARIANT_ID,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 180 },
      },
    });
    const resolved = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1')!;
    // Para rz=180°: (x, y, z) ↦ (-x, -y, z); normal (-1,0,0) ↦ (1,0,0).
    // Variante w=450: center raw (0, 25, -225) → (0, -25, -225).
    expect(near(p1.center[0], 0, 1e-3)).toBe(true);
    expect(near(p1.center[1], -25, 1e-3)).toBe(true);
    expect(near(p1.center[2], -225, 1e-3)).toBe(true);
    expect(near(p1.normal[0], 1, 1e-3)).toBe(true);
    expect(near(p1.normal[1], 0, 1e-3)).toBe(true);
  });

  it('V5. al limpiar overrides, la variante vuelve a la receta cruda', () => {
    setPortMappingOverrides({
      [BASE_ID]: {
        productId: BASE_ID,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    clearPortMappingOverrides();
    const resolved = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    expect(resolved.isIdentity).toBe(true);
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1')!;
    // Sin override: center raw de la variante (0, 25, -225).
    expect(near(p1.center[0], 0, 1e-3)).toBe(true);
    expect(near(p1.center[1], 25, 1e-3)).toBe(true);
    expect(near(p1.center[2], -225, 1e-3)).toBe(true);
    expect(near(p1.normal[0], -1, 1e-3)).toBe(true);
  });

  it('cobertura: la regla ancho-only-z sólo escala Z (X=1, Y=1); |ala|=50 preservado', () => {
    const base = resolveRecipeForProduct(BASE_RECIPE(), BASE_ID).recipe;
    const variant = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID).recipe;
    // |ala|=50 → P1 center Y = 25 en ambos (sin override). height=50 también.
    expect(base.height).toBe(50);
    expect(variant.height).toBe(50);
    // X-span de la receta no cambia por ancho — depende de longitud=2200 fija.
    expect(base.bboxMax[0] - base.bboxMin[0]).toBeCloseTo(2200, 1);
    expect(variant.bboxMax[0] - variant.bboxMin[0]).toBeCloseTo(2200, 1);
  });
});
