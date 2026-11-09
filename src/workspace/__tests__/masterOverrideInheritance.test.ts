/**
 * Herencia maestro → variante en getModelFrameOverride/getPortGeometryOverride.
 *
 * Caso cubierto (#123): el usuario configura SAM_TRPS-300-22-Z (modelFrame +
 * portGeometry en P1 con normal corregida). Cuando el motor consulta los
 * overrides para SAM_TRPS-450-20-Z (variante proyectada por el maestro TRPS
 * perforada) debe heredar la configuración sin tener que duplicar el override.
 *
 * Contratos:
 *   - modelFrame del maestro → variante: heredado tal cual.
 *   - normal/uDir/vDir del maestro → variante: heredado tal cual (no se
 *     reemplaza por ejes por defecto).
 *   - centerMm del maestro: NO se hereda (es absoluto; en la variante el
 *     punto por defecto ya cae en la arista correcta por dimensiones).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  getModelFrameOverride,
  getPortGeometryOverride,
  setMasterResolver,
  setPortMappingOverrides,
  setProductCatalogIndex,
  type ProductPortMapping,
} from '../catalogPortMapping';
import { findMasterForProduct } from '../../configurator/masterModels';

const TRPS_300 = {
  producto_id: 'SAM_TRPS-300-22-Z',
  sku: 'TRPS-300-22-Z',
  familia_id: 'SAM-STP-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  ala_nominal_mm: 50,
};
const TRPS_450 = {
  producto_id: 'SAM_TRPS-450-20-Z',
  sku: 'TRPS-450-20-Z',
  familia_id: 'SAM-STP-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 450,
  ala_nominal_mm: 50,
};
const TRES_300_65 = {
  producto_id: 'SAM_TRES-300-065-18-Z',
  sku: 'TRES-300-065-18-Z',
  familia_id: 'SAM-STE-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  ala_nominal_mm: 65,
  longitud_comercial_mm: 3000,
};
// Variante del maestro escalera:tramo_recto que conserva ala=65 (misma de la
// baseParams). Esto mantiene `findMasterForProduct` resolviendo al mismo
// maestro para ambos productos (hoy el maestro escalera declara catalogAlaMm
// único); la herencia funciona de todas formas porque el modelFrame es un
// correctivo en ejes globales, válido para cualquier variante dimensional.
const TRES_450_65 = {
  producto_id: 'SAM_TRES-450-065-18-Z',
  sku: 'TRES-450-065-18-Z',
  familia_id: 'SAM-STE-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 450,
  ala_nominal_mm: 65,
  longitud_comercial_mm: 3000,
};

function wireIndex(products: readonly Record<string, unknown>[]): void {
  setProductCatalogIndex(
    products.map((p) => p as Parameters<typeof setProductCatalogIndex>[0][number]),
  );
  setMasterResolver((p) => findMasterForProduct(p as Record<string, unknown>));
}

describe('getModelFrameOverride — herencia maestro → variante', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
  });

  it('TRPS-450 hereda el modelFrame configurado en TRPS-300', () => {
    wireIndex([TRPS_300, TRPS_450]);
    const mapping: ProductPortMapping = {
      productId: TRPS_300.producto_id,
      source: 'override',
      entries: [],
      modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 90, tx_mm: 0, ty_mm: 0, tz_mm: 0 },
    };
    setPortMappingOverrides({ [TRPS_300.producto_id]: mapping });

    const inherited = getModelFrameOverride(TRPS_450.producto_id);
    expect(inherited).not.toBeNull();
    expect(inherited!.rz_deg).toBe(90);
  });

  it('variant con override DIRECTO ignora el del maestro', () => {
    wireIndex([TRPS_300, TRPS_450]);
    setPortMappingOverrides({
      [TRPS_300.producto_id]: {
        productId: TRPS_300.producto_id,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
      [TRPS_450.producto_id]: {
        productId: TRPS_450.producto_id,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 45 },
      },
    });
    const direct = getModelFrameOverride(TRPS_450.producto_id);
    expect(direct?.rz_deg).toBe(45);
  });

  it('sin índice de catálogo, no hay herencia (fallback seguro)', () => {
    setPortMappingOverrides({
      [TRPS_300.producto_id]: {
        productId: TRPS_300.producto_id,
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    const inherited = getModelFrameOverride(TRPS_450.producto_id);
    expect(inherited).toBeNull();
  });

  it('TRES-450-065 hereda modelFrame de TRES-300-065 (maestro escalera:tramo_recto)', () => {
    wireIndex([TRES_300_65, TRES_450_65]);
    setPortMappingOverrides({
      [TRES_300_65.producto_id]: {
        productId: TRES_300_65.producto_id,
        source: 'override',
        entries: [],
        modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 30 },
      },
    });
    const inherited = getModelFrameOverride(TRES_450_65.producto_id);
    expect(inherited?.rz_deg).toBe(30);
  });
});

describe('getPortGeometryOverride — herencia parcial (normal/uDir/vDir sí; center NO)', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
  });

  it('variante hereda normal/uDir/vDir pero NO centerMm absoluto del maestro', () => {
    wireIndex([TRPS_300, TRPS_450]);
    setPortMappingOverrides({
      [TRPS_300.producto_id]: {
        productId: TRPS_300.producto_id,
        source: 'override',
        entries: [
          {
            recipePortName: 'P1',
            catalogPortName: 'P1',
            physicalLabel: 'Boca x_min',
            justification: 'test',
            geometry: {
              centerMm: [0, 25, -150], // Absoluto en marco ancho=300.
              normal: [-1, 0, 0],
              uDir: [0, 0, 1],
              vDir: [0, 1, 0],
              installRotationDeg: 0,
            },
          },
        ],
      },
    });
    const inherited = getPortGeometryOverride(TRPS_450.producto_id, 'P1');
    expect(inherited).not.toBeNull();
    expect(inherited!.centerMm).toBeUndefined(); // CRÍTICO — no se arrastra.
    expect(inherited!.normal).toEqual([-1, 0, 0]);
    expect(inherited!.uDir).toEqual([0, 0, 1]);
    expect(inherited!.vDir).toEqual([0, 1, 0]);
  });

  it('variante con override DIRECTO en P1 ignora al maestro', () => {
    wireIndex([TRPS_300, TRPS_450]);
    setPortMappingOverrides({
      [TRPS_300.producto_id]: {
        productId: TRPS_300.producto_id,
        source: 'override',
        entries: [
          {
            recipePortName: 'P1',
            catalogPortName: 'P1',
            physicalLabel: 'Boca x_min',
            justification: 'test',
            geometry: { normal: [-1, 0, 0] },
          },
        ],
      },
      [TRPS_450.producto_id]: {
        productId: TRPS_450.producto_id,
        source: 'override',
        entries: [
          {
            recipePortName: 'P1',
            catalogPortName: 'P1',
            physicalLabel: 'Boca x_min',
            justification: 'variante con override propio',
            geometry: { normal: [+1, 0, 0] },
          },
        ],
      },
    });
    const direct = getPortGeometryOverride(TRPS_450.producto_id, 'P1');
    expect(direct!.normal).toEqual([+1, 0, 0]);
  });

  it('productId sin maestro: devuelve null sin lanzar', () => {
    wireIndex([
      {
        producto_id: 'UNRELATED_X',
        sku: 'UNRELATED-X',
        familia_id: 'INVENTADA',
        tipo_pieza: 'imaginaria',
      },
    ]);
    const direct = getPortGeometryOverride('UNRELATED_X', 'P1');
    expect(direct).toBeNull();
    const mf = getModelFrameOverride('UNRELATED_X');
    expect(mf).toBeNull();
  });
});
