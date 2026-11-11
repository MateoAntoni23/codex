/**
 * B-1.1 — sin valores por defecto en las dimensiones de una definición.
 *
 * Antes, si un producto no declaraba ala, ancho, largo o ángulo, la receta los
 * rellenaba (65, 300, 3000, 90) o los tomaba del maestro. Ahora la definición
 * no se resuelve y el motivo nombra el dato que falta.
 *
 * Controles negativos: el mismo producto CON el dato se resuelve; el motivo
 * cambia si cambia el dato que falta.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { findMasterForProduct } from '../../../configurator/masterModels';
import { buildRecipeByKey, buildRecipeFor, ParametroFaltanteError } from '../../../parametric/geometry/recipes';
import { MOTIVO_ANGULO_AJUSTABLE, resolveDefinition } from '../definitions';
import type { Product } from '../../../tray/model';

const snapshot = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8',
)) as { PRODUCTOS: Product[] };
const bySku = (sku: string) => {
  const p = snapshot.PRODUCTOS.find((x) => x.sku === sku);
  if (!p) throw new Error(`${sku} no está en el catálogo`);
  return p;
};
const sin = (p: Product, campo: string): Product => {
  const c = { ...(p as unknown as Record<string, unknown>) };
  delete c[campo];
  return c as unknown as Product;
};

beforeAll(async () => {
  clearPortMappingOverrides();
  await seedStaticCatalog();
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

describe('recetas: un parámetro que falta es un error, no un valor inventado', () => {
  it('buildRecipeFor sin ala, ancho, largo o ángulo lanza ParametroFaltanteError', () => {
    const ok = { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000, angulo_deg: 90 };
    expect(() => buildRecipeFor('tramo_recto', ok)).not.toThrow(); // control
    for (const [kind, campo] of [['tramo_recto', 'ala_mm'], ['tramo_recto', 'ancho_mm'], ['tramo_recto', 'longitud_mm'], ['curva_horizontal', 'angulo_deg']] as const) {
      const params: Record<string, number> = { ...ok };
      delete params[campo];
      expect(() => buildRecipeFor(kind, params), `${kind} sin ${campo}`).toThrow(ParametroFaltanteError);
      expect(() => buildRecipeFor(kind, params)).toThrow(new RegExp(`falta ${campo}`));
    }
  });

  it('buildRecipeByKey (escalera) igual', () => {
    const ok = { ancho_mm: 300, ala_mm: 65, longitud_mm: 3000, angulo_deg: 45 };
    expect(() => buildRecipeByKey('escalera:curva_horizontal', ok)).not.toThrow(); // control
    expect(() => buildRecipeByKey('escalera:curva_horizontal', { ancho_mm: 300, ala_mm: 65 })).toThrow(/falta angulo_deg/);
    expect(() => buildRecipeByKey('escalera:tramo_recto', { ancho_mm: 300, angulo_deg: 0, longitud_mm: 3000 })).toThrow(/falta ala_mm/);
  });
});

describe('definición de un producto del catálogo al que le falta un dato', () => {
  it('sin ala: no se resuelve y el motivo nombra ala_nominal_mm', () => {
    const p = bySku('CPS-300-90-Z');
    expect(resolveDefinition(p).ok).toBe(true); // control: con ala se resuelve
    const r = resolveDefinition(sin(p, 'ala_nominal_mm'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/ala_nominal_mm/);
  });

  it('sin largo comercial (tramo): el motivo nombra longitud_comercial_mm', () => {
    const p = bySku('TRES-300-065-18-Z');
    expect(resolveDefinition(p).ok).toBe(true);
    const r = resolveDefinition(sin(p, 'longitud_comercial_mm'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/longitud_comercial_mm/);
  });

  it('curva de ángulo ajustable (CAS): sin definición, con el motivo del montaje', () => {
    const cas = snapshot.PRODUCTOS.filter((p) => String(p.sku).startsWith('CAS-'));
    expect(cas.length).toBe(40);
    for (const p of cas) {
      const r = resolveDefinition(p);
      expect(r.ok, p.sku).toBe(false);
      if (!r.ok) expect(r.motivo).toBe(MOTIVO_ANGULO_AJUSTABLE);
    }
  });

  it('control: una curva escalera con ángulo declarado se resuelve; quitárselo da el motivo de dato faltante, no el de ajustable', () => {
    const p = bySku('CS-300-90-065-18-Z');
    expect(resolveDefinition(p).ok).toBe(true);
    const r = resolveDefinition(sin(p, 'angulo_grados'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toBe(MOTIVO_ANGULO_AJUSTABLE);
  });

  it('sin ángulo no hay desempate silencioso entre los maestros de 45° y 90°', () => {
    expect(findMasterForProduct(sin(bySku('CS-300-90-065-18-Z'), 'angulo_grados'))).toBeNull();
    expect(findMasterForProduct(bySku('CS-300-90-065-18-Z'))?.id).toBe('master:escalera:curva_horizontal_90');
    expect(findMasterForProduct(bySku('CS-300-45-065-18-Z'))?.id).toBe('master:escalera:curva_horizontal_45');
  });
});
