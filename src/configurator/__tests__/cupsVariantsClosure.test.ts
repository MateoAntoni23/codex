// @vitest-environment node
/**
 * cupsVariantsClosure — regresión de "variantes verificadas" para CUPS.
 *
 * Piloto: CUPS 300 → CUPS 450, regla `depth-only`.
 *
 * `depth-only` es la regla menos restrictiva de las derivadas: el perfil XY
 * queda fijo (polígono medido del STEP único de SAMET) y sólo la profundidad Z
 * escala con `ancho_mm`. Para variantes se cumple:
 *
 *   base (ancho=300):     port.center.z = -150
 *   variante (ancho=450): port.center.z = -225
 *   port.center.(x,y)                    idéntico (polígono XY invariante)
 *
 * Invariantes verificados:
 *   V1. Sin overrides → variante devuelve receta cruda con Z escalado por ancho.
 *   V2. `modelFrame.rz_deg=90` en el BASE del maestro → variante hereda el frame
 *       (normales rotadas 90° alrededor de Z, XY del centro también rota).
 *   V3. La herencia NO copia centros absolutos: el |z| de la variante es 225 mm
 *       (ancho/2 escalado), no 150 mm del base.
 *   V4. Override directo en la variante gana sobre la herencia del base.
 *   V5. Al limpiar overrides, la variante vuelve a la receta cruda.
 *   V6. Cobertura: regla depth-only sólo escala Z (XY de centros idéntico).
 *
 * Comparado con `variantsClosure.test.ts` (TRPS, `ancho-only-z`):
 *   - TRPS escala Z del centro de un prisma Y-up (polígono XZ).
 *   - CUPS escala Z del centro de un prisma Z-up (polígono XY).
 *   Las normales locales difieren (perforadas horizontales vs verticales) pero
 *   la invariante de herencia es la misma: el override del master.base aporta
 *   el `modelFrame`, no los centros.
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
import { buildCUPSRecipe } from '../../parametric/geometry/outlines';
import { findMasterById, findMasterForProduct } from '../masterModels';

const BASE_ID = 'SAM_CUPS-300-A-Z';
const VARIANT_ID = 'SAM_CUPS-450-A-Z';
const BASE_RECIPE = () => buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50, sentido: 'baja' });
const VARIANT_RECIPE = () => buildCUPSRecipe({ ancho_mm: 450, ala_mm: 50, sentido: 'baja' });

const EPS = 1e-6;

function near(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}

function seedCatalogAndResolver() {
  setProductCatalogIndex([
    {
      producto_id: BASE_ID,
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'curva vertical interior',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
      sku: 'CUPS-300-A-Z',
    },
    {
      producto_id: VARIANT_ID,
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'curva vertical interior',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      sku: 'CUPS-450-A-Z',
    },
  ]);
  setMasterResolver((p) => {
    const product = {
      producto_id: p.producto_id,
      sku: p.sku ?? null,
      familia_id: p.familia_id ?? null,
      tipo_pieza: p.tipo_pieza ?? 'curva vertical interior',
      ancho_nominal_mm: p.ancho_nominal_mm ?? null,
      ala_nominal_mm: p.ala_nominal_mm ?? null,
      angulo_grados: p.angulo_grados ?? null,
    } as unknown as Parameters<typeof findMasterForProduct>[0];
    const m = findMasterForProduct(product);
    if (!m) return null;
    return { id: m.id, baseParams: m.baseParams };
  });
}

describe('cupsVariantsClosure — pilot CUPS 300 → 450 (depth-only)', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
    seedCatalogAndResolver();
  });

  afterEach(() => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
  });

  it('precondición: el maestro CUPS tiene la variante 450 declarada y regla depth-only', () => {
    const master = findMasterById('master:perforada:curva_vertical_interior');
    expect(master).toBeTruthy();
    expect(master!.variationRule.kind).toBe('depth-only');
    expect(master!.variationRule.provenance).toBe('derived');
    expect(master!.declaredVariantSkus).toContain('CUPS-450-A-Z');
  });

  it('V1. sin overrides: variante devuelve receta cruda con |z|=225, X/Y idénticos al base', () => {
    const baseResolved = resolveRecipeForProduct(BASE_RECIPE(), BASE_ID);
    const variantResolved = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    expect(variantResolved.isIdentity).toBe(true);

    const baseP1 = baseResolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const varP1 = variantResolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;

    // XY del centro invariante al escalar ancho (polígono XY fijo en depth-only)
    expect(near(baseP1.center[0], varP1.center[0], 1e-6)).toBe(true);
    expect(near(baseP1.center[1], varP1.center[1], 1e-6)).toBe(true);
    // Z del centro = -ancho/2. Base: -150. Variante: -225.
    expect(baseP1.center[2]).toBeCloseTo(-150, 3);
    expect(varP1.center[2]).toBeCloseTo(-225, 3);
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
    const baseResolved = resolveRecipeForProduct(BASE_RECIPE(), BASE_ID);
    const varResolved = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    expect(baseResolved.isIdentity).toBe(false);
    expect(varResolved.isIdentity).toBe(false);

    // rz=90° alrededor de Z: (x,y,z) ↦ (-y,x,z); normal (-1,0,0) ↦ (0,-1,0).
    const baseP1raw = BASE_RECIPE().ports.find((p) => p.name === 'P1_horizontal')!;
    const varP1raw = VARIANT_RECIPE().ports.find((p) => p.name === 'P1_horizontal')!;
    const baseP1 = baseResolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const varP1 = varResolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;

    // Base: center rotado 90° — nuevo X = -oldY, nuevo Y = oldX.
    expect(near(baseP1.center[0], -baseP1raw.center[1], 1e-3)).toBe(true);
    expect(near(baseP1.center[1], baseP1raw.center[0], 1e-3)).toBe(true);
    expect(near(baseP1.center[2], baseP1raw.center[2], 1e-3)).toBe(true);
    // Variante: misma rotación aplicada a SU PROPIA receta (escalada en Z).
    expect(near(varP1.center[0], -varP1raw.center[1], 1e-3)).toBe(true);
    expect(near(varP1.center[1], varP1raw.center[0], 1e-3)).toBe(true);
    expect(near(varP1.center[2], varP1raw.center[2], 1e-3)).toBe(true);

    // Normal rotada igual en ambos — es invariante a la escala.
    // (-1,0,0) ↦ (0,-1,0).
    expect(near(baseP1.normal[0], 0, 1e-3)).toBe(true);
    expect(near(baseP1.normal[1], -1, 1e-3)).toBe(true);
    expect(near(varP1.normal[0], 0, 1e-3)).toBe(true);
    expect(near(varP1.normal[1], -1, 1e-3)).toBe(true);
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
    const baseResolved = resolveRecipeForProduct(BASE_RECIPE(), BASE_ID);
    const varResolved = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID);
    const baseP1 = baseResolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const varP1 = varResolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    // Si la variante copiara los centros ABSOLUTOS del base, su Z sería -150.
    // Como procesa su propia receta (ancho=450) antes de aplicar el modelFrame
    // heredado, su Z es -225.
    expect(Math.abs(varP1.center[2] - -150)).toBeGreaterThan(50);
    expect(Math.abs(varP1.center[2] - -225)).toBeLessThan(1);
    // Mientras que el base conserva -150.
    expect(Math.abs(baseP1.center[2] - -150)).toBeLessThan(1);
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
    const varP1raw = VARIANT_RECIPE().ports.find((p) => p.name === 'P1_horizontal')!;
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    // Para rz=180°: (x,y,z) ↦ (-x,-y,z); normal (-1,0,0) ↦ (1,0,0).
    expect(near(p1.center[0], -varP1raw.center[0], 1e-3)).toBe(true);
    expect(near(p1.center[1], -varP1raw.center[1], 1e-3)).toBe(true);
    expect(near(p1.center[2], varP1raw.center[2], 1e-3)).toBe(true);
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
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const rawP1 = VARIANT_RECIPE().ports.find((p) => p.name === 'P1_horizontal')!;
    expect(near(p1.center[0], rawP1.center[0], 1e-6)).toBe(true);
    expect(near(p1.center[1], rawP1.center[1], 1e-6)).toBe(true);
    expect(near(p1.center[2], rawP1.center[2], 1e-6)).toBe(true);
    // Z sigue siendo -225 (ancho_mm/2 escalado por la regla, sin pegajosidad).
    expect(p1.center[2]).toBeCloseTo(-225, 3);
  });

  it('cobertura: la regla depth-only mantiene XY idéntico y sólo escala Z', () => {
    const base = resolveRecipeForProduct(BASE_RECIPE(), BASE_ID).recipe;
    const variant = resolveRecipeForProduct(VARIANT_RECIPE(), VARIANT_ID).recipe;
    // Polígono XY idéntico entre base y variante.
    expect(base.polygon.length).toBe(variant.polygon.length);
    for (let i = 0; i < base.polygon.length; i++) {
      expect(base.polygon[i][0]).toBeCloseTo(variant.polygon[i][0], 6);
      expect(base.polygon[i][1]).toBeCloseTo(variant.polygon[i][1], 6);
    }
    // Height (profundidad canal) = ancho; translate z = -ancho.
    expect(base.height).toBe(300);
    expect(variant.height).toBe(450);
    expect(base.translate[2]).toBe(-300);
    expect(variant.translate[2]).toBe(-450);
    // XY de los centros de las bocas: idénticos.
    for (const portName of ['P1_horizontal', 'P2_vertical']) {
      const b = base.ports.find((p) => p.name === portName)!;
      const v = variant.ports.find((p) => p.name === portName)!;
      expect(b.center[0]).toBeCloseTo(v.center[0], 6);
      expect(b.center[1]).toBeCloseTo(v.center[1], 6);
      // Z: -ancho/2 escalado por la regla.
      expect(b.center[2]).toBeCloseTo(-150, 3);
      expect(v.center[2]).toBeCloseTo(-225, 3);
    }
  });
});
