/**
 * sharedVariantCalibration — regresión del hito 2.
 *
 * Qué defiende:
 *   Dos SKUs con misma identidad de variante (mismo sistema+pieceKind, mismas
 *   dimensiones nominales) deben compartir la calibración efectiva aunque
 *   difieran en acabado (Z/G/ZN), espesor, color o atributos comerciales.
 *
 * Escenario pivot: Escalera TRES 300×90×3000 — se configura el SKU Z y se
 * verifica que el SKU G, un espesor distinto Z, y acabados varios ven la
 * misma calibración (modelFrame, mapping, geometría por boca). Un SKU con
 * largo distinto (2400 mm) NO comparte — su geometría es diferente.
 *
 * También cubre la invariante opuesta: productos del mismo maestro pero de
 * otras DIMENSIONES siguen cayendo en la herencia por maestro (modelFrame sí,
 * centerMm NO) — el nuevo canal "por variante" no debe degradar el existente.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  getEffectiveMapping,
  getModelFrameOverride,
  getPortGeometryOverride,
  setMasterResolver,
  setPortMappingOverrides,
  setProductCatalogIndex,
  type ProductPortMapping,
} from '../catalogPortMapping';
import { findMasterForProduct } from '../../configurator/masterModels';

const TRES_300_090_Z_18 = {
  producto_id: 'SAM_TRES-300-090-18-Z',
  sku: 'TRES-300-090-18-Z',
  familia_id: 'SAM-STE-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  ala_nominal_mm: 90,
  longitud_comercial_mm: 3000,
};

// Mismo ancho/ala/longitud, acabado G.
const TRES_300_090_G_18 = {
  producto_id: 'SAM_TRES-300-090-18-G',
  sku: 'TRES-300-090-18-G',
  familia_id: 'SAM-STE-G',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  ala_nominal_mm: 90,
  longitud_comercial_mm: 3000,
};

// Mismo ancho/ala/longitud, espesor distinto (20 vs 18).
const TRES_300_090_Z_20 = {
  producto_id: 'SAM_TRES-300-090-20-Z',
  sku: 'TRES-300-090-20-Z',
  familia_id: 'SAM-STE-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  ala_nominal_mm: 90,
  longitud_comercial_mm: 3000,
};

// Dimensiones distintas (2.4 m): NO comparte identidad de variante.
const TRES_300_090_Z_18_LONG_2400 = {
  producto_id: 'SAM_TRES-300-090-18-Z-2400',
  sku: 'TRES-300-090-18-Z-2400',
  familia_id: 'SAM-STE-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  ala_nominal_mm: 90,
  longitud_comercial_mm: 2400,
};

// Mismo maestro, ancho distinto (450): cae en herencia por maestro.
const TRES_450_090_Z_18 = {
  producto_id: 'SAM_TRES-450-090-18-Z',
  sku: 'TRES-450-090-18-Z',
  familia_id: 'SAM-STE-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 450,
  ala_nominal_mm: 90,
  longitud_comercial_mm: 3000,
};

function wire(products: readonly Record<string, unknown>[]): void {
  setProductCatalogIndex(
    products.map((p) => p as Parameters<typeof setProductCatalogIndex>[0][number]),
  );
  setMasterResolver((p) => findMasterForProduct(p as Record<string, unknown>));
}

function makeOverride(productId: string): ProductPortMapping {
  return {
    productId,
    source: 'override',
    entries: [
      {
        recipePortName: 'P1',
        catalogPortName: 'P1',
        physicalLabel: 'Boca x_min',
        justification: 'calibración manual del usuario',
        geometry: {
          centerMm: [0, 32.5, -150],
          normal: [-1, 0, 0],
          uDir: [0, 0, 1],
          vDir: [0, 1, 0],
          installRotationDeg: 0,
        },
      },
      {
        recipePortName: 'P2',
        catalogPortName: 'P2',
        physicalLabel: 'Boca x_max',
        justification: 'calibración manual del usuario',
      },
    ],
    modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 15, tx_mm: 0, ty_mm: 0, tz_mm: 0 },
  };
}

describe('Escalera 300×90 — calibración compartida entre acabados y espesores', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
  });

  it('acabado G hereda el mapping COMPLETO del acabado Z (source=inherited)', () => {
    wire([TRES_300_090_Z_18, TRES_300_090_G_18]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
    });
    const effectiveG = getEffectiveMapping(TRES_300_090_G_18.producto_id);
    expect(effectiveG).not.toBeNull();
    expect(effectiveG!.source).toBe('inherited');
    expect(effectiveG!.inheritedFromProductId).toBe(TRES_300_090_Z_18.producto_id);
    expect(effectiveG!.entries.length).toBe(2);
    expect(effectiveG!.modelFrame?.rz_deg).toBe(15);
  });

  it('acabado G hereda modelFrame COMPLETO (misma geometría — misma rotación)', () => {
    wire([TRES_300_090_Z_18, TRES_300_090_G_18]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
    });
    const inherited = getModelFrameOverride(TRES_300_090_G_18.producto_id);
    expect(inherited?.rz_deg).toBe(15);
  });

  it('acabado G hereda centerMm absoluto (misma variante, dimensiones físicas iguales)', () => {
    wire([TRES_300_090_Z_18, TRES_300_090_G_18]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
    });
    const geom = getPortGeometryOverride(TRES_300_090_G_18.producto_id, 'P1');
    expect(geom?.centerMm).toEqual([0, 32.5, -150]);
    expect(geom?.normal).toEqual([-1, 0, 0]);
  });

  it('espesor distinto (20 vs 18) comparte TODA la calibración', () => {
    wire([TRES_300_090_Z_18, TRES_300_090_Z_20]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
    });
    const eff = getEffectiveMapping(TRES_300_090_Z_20.producto_id);
    expect(eff?.source).toBe('inherited');
    const geom = getPortGeometryOverride(TRES_300_090_Z_20.producto_id, 'P1');
    expect(geom?.centerMm).toEqual([0, 32.5, -150]);
  });

  it('largo distinto (2400 vs 3000) NO comparte: variante distinta', () => {
    wire([TRES_300_090_Z_18, TRES_300_090_Z_18_LONG_2400]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
    });
    const eff = getEffectiveMapping(TRES_300_090_Z_18_LONG_2400.producto_id);
    // Sin default declarado para este productId: null tras la pérdida de identidad.
    expect(eff?.source).not.toBe('inherited');
    // El modelFrame SÍ sigue heredándose del maestro (ambos comparten sistema+kind+baseParams)
    // porque es una corrección en ejes globales. Esa es la herencia preexistente.
    expect(getModelFrameOverride(TRES_300_090_Z_18_LONG_2400.producto_id)?.rz_deg).toBe(15);
    // Pero centerMm NO se arrastra — es absoluto y la variante tiene otro largo.
    const geom = getPortGeometryOverride(TRES_300_090_Z_18_LONG_2400.producto_id, 'P1');
    expect(geom?.centerMm).toBeUndefined();
  });

  it('variante de otro ancho (450) cae en herencia por maestro: direcciones sí, centerMm no', () => {
    wire([TRES_300_090_Z_18, TRES_450_090_Z_18]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
    });
    expect(getModelFrameOverride(TRES_450_090_Z_18.producto_id)?.rz_deg).toBe(15);
    const geom = getPortGeometryOverride(TRES_450_090_Z_18.producto_id, 'P1');
    expect(geom?.normal).toEqual([-1, 0, 0]);
    expect(geom?.centerMm).toBeUndefined();
  });

  it('override directo en la variante (no inherited) tiene prioridad', () => {
    wire([TRES_300_090_Z_18, TRES_300_090_G_18]);
    setPortMappingOverrides({
      [TRES_300_090_Z_18.producto_id]: makeOverride(TRES_300_090_Z_18.producto_id),
      [TRES_300_090_G_18.producto_id]: {
        ...makeOverride(TRES_300_090_G_18.producto_id),
        modelFrame: { rz_deg: 45 },
      },
    });
    const eff = getEffectiveMapping(TRES_300_090_G_18.producto_id);
    expect(eff?.source).toBe('override');
    expect(eff?.modelFrame?.rz_deg).toBe(45);
  });
});
