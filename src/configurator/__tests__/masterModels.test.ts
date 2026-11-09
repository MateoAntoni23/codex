// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findMasterForProduct, findMasterById, MASTER_MODELS } from '../masterModels';
import { enumerateVariantsForMaster, findMasterAndVariantForProduct } from '../masterVariants';
import type { Product } from '../../tray/model';

function makeProduct(partial: Partial<Product> & { producto_id: string; sku: string }): Product {
  return {
    descripcion_original: '',
    tipo_pieza: 'recta',
    ancho_nominal_mm: 300,
    ...partial,
  } as Product;
}

describe('MASTER_MODELS inventory', () => {
  it('tiene 12 maestros (6 perforada + 6 escalera)', () => {
    expect(MASTER_MODELS.length).toBe(12);
    expect(MASTER_MODELS.filter((m) => m.sistema === 'perforada').length).toBe(6);
    expect(MASTER_MODELS.filter((m) => m.sistema === 'escalera').length).toBe(6);
  });

  it('cada maestro declara un id único', () => {
    const ids = MASTER_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findMasterById devuelve null para id inexistente', () => {
    expect(findMasterById('master:no-existe')).toBeNull();
  });
});

describe('findMasterForProduct', () => {
  it('ancla TRPS-300-22-Z al maestro perforada:tramo_recto', () => {
    const p = makeProduct({
      producto_id: 'SAM_TRPS-300-22-Z',
      sku: 'TRPS-300-22-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ala_nominal_mm: 50,
    });
    const m = findMasterForProduct(p as unknown as Record<string, unknown>);
    expect(m?.id).toBe('master:perforada:tramo_recto');
  });

  it('desambigua CPS por ángulo', () => {
    const base = {
      producto_id: 'SAM_CPS-300-45-Z',
      sku: 'CPS-300-45-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'curva horizontal',
      ala_nominal_mm: 50,
    };
    const cps45 = findMasterForProduct({ ...base, angulo_grados: 45 });
    const cps90 = findMasterForProduct({ ...base, angulo_grados: 90 });
    expect(cps45?.id).toBe('master:perforada:curva_horizontal_45');
    expect(cps90?.id).toBe('master:perforada:curva_horizontal_90');
  });

  it('TRES SAM-STE-Z ala 65 → master:escalera:tramo_recto', () => {
    const m = findMasterForProduct({
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ala_nominal_mm: 65,
    });
    expect(m?.id).toBe('master:escalera:tramo_recto');
  });

  it('producto sin familia_id devuelve null', () => {
    const m = findMasterForProduct({ tipo_pieza: 'recta', ala_nominal_mm: 50 });
    expect(m).toBeNull();
  });
});

describe('enumerateVariantsForMaster — TRPS (regla ancho-only-z)', () => {
  const master = findMasterById('master:perforada:tramo_recto')!;
  const productos: Product[] = [
    makeProduct({
      producto_id: 'SAM_TRPS-300-22-Z',
      sku: 'TRPS-300-22-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 3000,
    }),
    makeProduct({
      producto_id: 'SAM_TRPS-450-20-Z',
      sku: 'TRPS-450-20-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 3000,
    }),
  ];
  const variants = enumerateVariantsForMaster(master, productos);

  it('base ancho=300 queda clasificada como "base" y usa la receta medida', () => {
    const v = variants.find((v) => v.ancho_mm === 300)!;
    expect(v.origin).toBe('base');
    expect(v.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(v.ports.length).toBe(2);
  });

  it('ancho=450 queda clasificada como "declared" y proyecta Z por 450/300=1.5', () => {
    const v = variants.find((v) => v.ancho_mm === 450)!;
    expect(v.origin).toBe('declared');
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    expect(v.scale.x).toBe(1);
    expect(v.scale.y).toBe(1);
    // Puertos proyectados vienen de buildRecipeFor('tramo_recto', ancho=450),
    // que ubica P1/P2 en los extremos +X/-X con ancho 450 en Z.
    expect(v.ports.length).toBe(2);
    const p1 = v.ports.find((p) => p.recipePortName === 'P1')!;
    expect(p1.centerMm).not.toBeNull();
  });
});

describe('enumerateVariantsForMaster — CPS-45 (regla uniform-xz estimada)', () => {
  const master = findMasterById('master:perforada:curva_horizontal_45')!;
  const productos: Product[] = [
    makeProduct({
      producto_id: 'SAM_CPS-450-45-Z',
      sku: 'CPS-450-45-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'curva horizontal',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      angulo_grados: 45,
    }),
  ];
  const variants = enumerateVariantsForMaster(master, productos);

  it('CPS-450 queda "declared" (listada en declaredVariantSkus), scale XZ=1.5, con warning de estimación', () => {
    const v = variants[0];
    expect(v.origin).toBe('declared');
    expect(v.scale.x).toBeCloseTo(1.5, 3);
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    // Regla no medida → se agrega warning estimado.
    expect(v.warnings.some((w) => /no medida|estim/i.test(w))).toBe(true);
  });
});

describe('enumerateVariantsForMaster — escalera sin regla (variationRule.kind = none)', () => {
  const master = findMasterById('master:escalera:tramo_recto')!;
  const productos: Product[] = [
    // Mismo ancho+ala → base.
    makeProduct({
      producto_id: 'SAM_TRES-300-065-18-Z',
      sku: 'TRES-300-065-18-Z',
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 65,
      longitud_comercial_mm: 3000,
    }),
    // Ancho distinto → requires-master (la regla es `none`).
    makeProduct({
      producto_id: 'SAM_TRES-450-065-18-Z',
      sku: 'TRES-450-065-18-Z',
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 65,
      longitud_comercial_mm: 3000,
    }),
    // Ala distinta → también requires-master.
    makeProduct({
      producto_id: 'SAM_TRES-300-090-18-Z',
      sku: 'TRES-300-090-18-Z',
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 90,
      longitud_comercial_mm: 3000,
    }),
  ];
  const variants = enumerateVariantsForMaster(master, productos);

  it('ancho=300 ala=65 queda base', () => {
    expect(variants.find((v) => v.sku === 'TRES-300-065-18-Z')?.origin).toBe('base');
  });

  it('ancho=450 ala=65 queda requires-master', () => {
    expect(variants.find((v) => v.sku === 'TRES-450-065-18-Z')?.origin).toBe('requires-master');
  });

  it('ancho=300 ala=90 queda requires-master y advierte sobre el ala', () => {
    const v = variants.find((v) => v.sku === 'TRES-300-090-18-Z')!;
    expect(v.origin).toBe('requires-master');
    expect(v.warnings.join(' ')).toMatch(/ala/i);
  });
});

describe('findMasterAndVariantForProduct — flujo del inspector', () => {
  const productos: Product[] = [
    makeProduct({
      producto_id: 'SAM_TRPS-450-20-Z',
      sku: 'TRPS-450-20-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 3000,
    }),
  ];

  it('un producto 450 resuelve maestro=TRPS y variant.origin=declared', () => {
    const res = findMasterAndVariantForProduct(productos[0], productos);
    expect(res?.master.id).toBe('master:perforada:tramo_recto');
    expect(res?.variant.origin).toBe('declared');
  });

  it('producto sin maestro devuelve null (no hay match familia+tipo+ala)', () => {
    const outlier = makeProduct({
      producto_id: 'SAM_INVENTADO',
      sku: 'INVENTADO',
      familia_id: 'FAMIQ-ALAMBRE-INOX',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
    });
    const res = findMasterAndVariantForProduct(outlier, [outlier]);
    expect(res).toBeNull();
  });
});
