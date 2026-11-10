// @vitest-environment node
/**
 * escaleraVariantsClosure — regresión de "variantes verificadas" para la
 * familia escalera no-recta (CS-45, CS-90, TS, XS).
 *
 * Patrones cubiertos: CS-45, CS-90, TS, XS. Todos comparten:
 *   - `variationRule.kind === 'ala-independent'`
 *   - `variationRule.provenance === 'estimated'` (hipótesis visual)
 *   - `variationRule.varies === ['ancho', 'ala']`
 *   - Catálogo SAMET publica ancho ∈ {150,300,450,600} × ala ∈ {65,90,115,150}.
 *
 * Objetivo: demostrar que las variantes se enumeran como `estimated` (no como
 * `requires-master`) y que la proyección geométrica es correcta para
 * (ancho, ala) ≠ (300, 65):
 *
 *   V1. Base (300×65) clasifica `base`.
 *   V2. Ancho ≠ 300 clasifica `estimated` (regla + provenance).
 *   V3. Ala ≠ 65 clasifica `estimated`.
 *   V4. Scale factors: X=Z=ancho/300, Y=ala/65 (uniform-xz + ala-independent).
 *   V5. Puertos proyectados con `centerMm` y `normal` unitarios, centro Y=ala/2.
 *   V6. El polígono real producido por la receta escalera tiene bocas de ancho
 *       ≈ ancho_mm pedido (no 298.9 base, no 150, no 334).
 *   V7. Warning explícita: "regla estimada (hipótesis visual sin segundo STEP)".
 *   V8. Herencia de modelFrame: override en el BASE se propaga a la variante
 *       sin copiar centros absolutos.
 *
 * NO cubre: fidelidad geométrica contra un STEP real a ancho≠300 (no existe;
 * por eso `provenance=estimated`). Para subir a `measured` hay que incorporar
 * un segundo STEP de SAMET.
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
import { findMasterById, findMasterForProduct } from '../masterModels';
import { enumerateVariantsForMaster } from '../masterVariants';
import {
  buildCS45Recipe,
  buildCS90Recipe,
  buildTSRecipe,
  buildXSRecipe,
} from '../../parametric/geometry/escaleraRecipes';
import type { Product } from '../../tray/model';

function makeProduct(partial: Partial<Product> & { producto_id: string; sku: string }): Product {
  return {
    descripcion_original: '',
    tipo_pieza: 'curva horizontal',
    ancho_nominal_mm: 300,
    ...partial,
  } as Product;
}

function unitLen(v: readonly [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

// ─── Enumeración de variantes ────────────────────────────────────────────────

describe('escaleraVariantsClosure — enumeración CS-45', () => {
  it('base + variantes 300×90, 450×65, 450×90 clasifican base/estimated', () => {
    const master = findMasterById('master:escalera:curva_horizontal_45')!;
    expect(master.variationRule.kind).toBe('ala-independent');
    expect(master.variationRule.provenance).toBe('estimated');
    expect(master.variationRule.varies).toEqual(['ancho', 'ala']);

    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_CS-300-45-065-18-Z',
        sku: 'CS-300-45-065-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 65,
        angulo_grados: 45,
      } as any),
      makeProduct({
        producto_id: 'SAM_CS-300-45-090-18-Z',
        sku: 'CS-300-45-090-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 90,
        angulo_grados: 45,
      } as any),
      makeProduct({
        producto_id: 'SAM_CS-450-45-065-18-Z',
        sku: 'CS-450-45-065-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 65,
        angulo_grados: 45,
      } as any),
      makeProduct({
        producto_id: 'SAM_CS-450-45-090-18-Z',
        sku: 'CS-450-45-090-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 90,
        angulo_grados: 45,
      } as any),
    ];

    const vs = enumerateVariantsForMaster(master, productos);
    const byId = new Map(vs.map((v) => [v.productId, v]));

    expect(byId.get('SAM_CS-300-45-065-18-Z')!.origin).toBe('base');
    expect(byId.get('SAM_CS-300-45-090-18-Z')!.origin).toBe('estimated');
    expect(byId.get('SAM_CS-450-45-065-18-Z')!.origin).toBe('estimated');
    expect(byId.get('SAM_CS-450-45-090-18-Z')!.origin).toBe('estimated');

    // ningún requires-master debe aparecer para los anchos/alas del catálogo.
    for (const v of vs) {
      expect(v.origin).not.toBe('requires-master');
    }
  });

  it('scale.x=scale.z=ancho/300 (uniform-xz); scale.y=ala/65', () => {
    const master = findMasterById('master:escalera:curva_horizontal_45')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_CS-450-45-090-18-Z',
        sku: 'CS-450-45-090-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 90,
        angulo_grados: 45,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    expect(v.scale.x).toBeCloseTo(1.5, 3);
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    expect(v.scale.y).toBeCloseTo(90 / 65, 3);
  });

  it('warning explícita "regla estimada" para variantes no-base', () => {
    const master = findMasterById('master:escalera:curva_horizontal_45')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_CS-450-45-065-18-Z',
        sku: 'CS-450-45-065-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 65,
        angulo_grados: 45,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    expect(v.warnings.join('\n')).toMatch(/regla estimada/i);
  });
});

describe('escaleraVariantsClosure — enumeración CS-90, TS, XS', () => {
  it('CS-90 450×65: origin=estimated, scale.x=scale.z=1.5, scale.y=1', () => {
    const master = findMasterById('master:escalera:curva_horizontal_90')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_CS-450-90-065-18-Z',
        sku: 'CS-450-90-065-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 65,
        angulo_grados: 90,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    expect(v.origin).toBe('estimated');
    expect(v.scale.x).toBeCloseTo(1.5, 3);
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    expect(v.scale.y).toBeCloseTo(1, 3);
  });

  it('TS 300×90: scale.y=90/65, Y del puerto = ala/2 = 45', () => {
    const master = findMasterById('master:escalera:derivacion_lateral')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_TS-300-090-18-Z',
        sku: 'TS-300-090-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'T',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 90,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    expect(v.origin).toBe('estimated');
    expect(v.scale.y).toBeCloseTo(90 / 65, 3);
    for (const p of v.ports) {
      expect(p.centerMm).toBeTruthy();
      expect(p.centerMm![1]).toBeCloseTo(45, 1);
    }
  });

  it('XS 600×150: scale.x=scale.z=2, scale.y=150/65; normales unitarias', () => {
    const master = findMasterById('master:escalera:cruz')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_XS-600-150-14-Z',
        sku: 'XS-600-150-14-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'X',
        ancho_nominal_mm: 600,
        ala_nominal_mm: 150,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    expect(v.origin).toBe('estimated');
    expect(v.scale.x).toBeCloseTo(2, 3);
    expect(v.scale.z).toBeCloseTo(2, 3);
    expect(v.scale.y).toBeCloseTo(150 / 65, 3);
    for (const p of v.ports) {
      expect(p.normal).toBeTruthy();
      expect(unitLen(p.normal!)).toBeCloseTo(1, 6);
    }
  });
});

// ─── Polígonos reales con `ancho_mm` objetivo ────────────────────────────────
//
// `enumerateVariantsForMaster` reporta la POSICIÓN proyectada de los puertos.
// El polígono mismo lo construyen las recetas en `escaleraRecipes.ts`. Aquí
// validamos que el ancho útil de las bocas reales coincida con `ancho_mm`
// pedido — el bug 150/334 arreglado en e276778 está blindado para variantes.

describe('escaleraVariantsClosure — ancho real de bocas en la receta', () => {
  it('CS-45 ancho=450: ambas bocas tienen ancho_mm ≈ 450', () => {
    const r = buildCS45Recipe({ ancho_mm: 450, ala_mm: 65 });
    for (const p of r.ports) {
      expect(p.ancho_mm).toBeGreaterThan(448);
      expect(p.ancho_mm).toBeLessThan(452);
    }
  });

  it('CS-90 ancho=600 ala=150: bocas ≈ 600 y height ≈ 150', () => {
    const r = buildCS90Recipe({ ancho_mm: 600, ala_mm: 150 });
    for (const p of r.ports) {
      expect(p.ancho_mm).toBeGreaterThan(598);
      expect(p.ancho_mm).toBeLessThan(602);
    }
    expect(r.height).toBeCloseTo(150, 3);
  });

  it('TS ancho=150 ala=65: 3 bocas de ancho ≈ 150', () => {
    const r = buildTSRecipe({ ancho_mm: 150, ala_mm: 65 });
    expect(r.ports).toHaveLength(3);
    for (const p of r.ports) {
      expect(p.ancho_mm).toBeGreaterThan(148);
      expect(p.ancho_mm).toBeLessThan(152);
    }
  });

  it('XS ancho=450 ala=90: 4 bocas de ancho ≈ 450, height ≈ 90', () => {
    const r = buildXSRecipe({ ancho_mm: 450, ala_mm: 90 });
    expect(r.ports).toHaveLength(4);
    for (const p of r.ports) {
      expect(p.ancho_mm).toBeGreaterThan(448);
      expect(p.ancho_mm).toBeLessThan(452);
    }
    expect(r.height).toBeCloseTo(90, 3);
  });
});

// ─── Herencia de modelFrame base → variante (sin copy absoluto) ──────────────

const CS90_BASE = 'SAM_CS-300-90-065-18-Z';
const CS90_VARIANT = 'SAM_CS-450-90-065-18-Z';

describe('escaleraVariantsClosure — herencia de modelFrame base → variante', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
    setProductCatalogIndex([
      {
        producto_id: CS90_BASE,
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 65,
        sku: 'CS-300-90-065-18-Z',
        angulo_grados: 90,
      } as any,
      {
        producto_id: CS90_VARIANT,
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'curva horizontal',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 65,
        sku: 'CS-450-90-065-18-Z',
        angulo_grados: 90,
      } as any,
    ]);
    setMasterResolver((p) => {
      const product = {
        producto_id: p.producto_id,
        sku: p.sku ?? null,
        familia_id: p.familia_id ?? null,
        tipo_pieza: p.tipo_pieza ?? 'curva horizontal',
        ancho_nominal_mm: p.ancho_nominal_mm ?? null,
        ala_nominal_mm: p.ala_nominal_mm ?? null,
        angulo_grados: p.angulo_grados ?? null,
      } as unknown as Parameters<typeof findMasterForProduct>[0];
      const m = findMasterForProduct(product);
      if (!m) return null;
      return { id: m.id, baseParams: m.baseParams };
    });
  });

  afterEach(() => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
  });

  it('modelFrame.rz_deg=90 en el base → variante lo hereda; centros escalan por ancho', () => {
    setPortMappingOverrides({
      [CS90_BASE]: {
        productId: CS90_BASE,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    const baseRecipe = buildCS90Recipe({ ancho_mm: 300, ala_mm: 65 });
    const variantRecipe = buildCS90Recipe({ ancho_mm: 450, ala_mm: 65 });
    const resolvedBase = resolveRecipeForProduct(baseRecipe, CS90_BASE);
    const resolvedVariant = resolveRecipeForProduct(variantRecipe, CS90_VARIANT);

    expect(resolvedBase.isIdentity).toBe(false);
    expect(resolvedVariant.isIdentity).toBe(false);

    // La variante NO lee centros del base; proyecta su propio polígono y luego
    // aplica el modelFrame heredado. La magnitud de los centros en la variante
    // debe superar en ~1.5× la del base (la receta es 1.5× más grande).
    const baseSpan = Math.max(
      ...resolvedBase.recipe.ports.flatMap((p) => [
        Math.abs(p.center[0]),
        Math.abs(p.center[2]),
      ]),
    );
    const variantSpan = Math.max(
      ...resolvedVariant.recipe.ports.flatMap((p) => [
        Math.abs(p.center[0]),
        Math.abs(p.center[2]),
      ]),
    );
    expect(variantSpan / baseSpan).toBeCloseTo(450 / 300, 2);
  });

  it('al limpiar overrides, variante vuelve a la receta cruda escalada', () => {
    setPortMappingOverrides({
      [CS90_BASE]: {
        productId: CS90_BASE,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    clearPortMappingOverrides();
    const resolved = resolveRecipeForProduct(
      buildCS90Recipe({ ancho_mm: 450, ala_mm: 65 }),
      CS90_VARIANT,
    );
    expect(resolved.isIdentity).toBe(true);
    // Puertos con ancho ≈ 450 preservados.
    for (const p of resolved.recipe.ports) {
      expect(p.ancho_mm).toBeGreaterThan(448);
      expect(p.ancho_mm).toBeLessThan(452);
    }
  });
});
