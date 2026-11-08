import { describe, it, expect, beforeEach } from 'vitest';
import {
  recipePortToCatalogPort,
  catalogPortToRecipePort,
  getEffectiveMapping,
  getDefaultMapping,
  setPortMappingOverrides,
  clearPortMappingOverrides,
  listOverriddenProductIds,
  getModelFrameOverride,
  getPortGeometryOverride,
  isIdentityModelFrame,
  isIdentityPortGeometry,
  type ProductPortMapping,
} from '../catalogPortMapping';

describe('catalogPortMapping — defaults declarados', () => {
  beforeEach(() => clearPortMappingOverrides());

  it('TPS traduce tronco_P1→P1, tronco_P2→P2, boca_derivacion→P3', () => {
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P1');
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P2')).toBe('P2');
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'boca_derivacion')).toBe('P3');
  });

  it('XPS traduce P1_x_neg..P4_z_pos a P1..P4', () => {
    expect(recipePortToCatalogPort('SAM_XPS-300-Z', 'P1_x_neg')).toBe('P1');
    expect(recipePortToCatalogPort('SAM_XPS-300-Z', 'P2_x_pos')).toBe('P2');
    expect(recipePortToCatalogPort('SAM_XPS-300-Z', 'P3_z_neg')).toBe('P3');
    expect(recipePortToCatalogPort('SAM_XPS-300-Z', 'P4_z_pos')).toBe('P4');
  });

  it('CUPS traduce P1_horizontal→P1, P2_vertical→P2', () => {
    expect(recipePortToCatalogPort('SAM_CUPS-300-A-Z', 'P1_horizontal')).toBe('P1');
    expect(recipePortToCatalogPort('SAM_CUPS-300-A-Z', 'P2_vertical')).toBe('P2');
  });

  it('productos 2-boca sin mapping (TRPS, CPS) devuelven identidad', () => {
    expect(recipePortToCatalogPort('SAM_TRPS-300-22-Z', 'P1')).toBe('P1');
    expect(recipePortToCatalogPort('SAM_TRPS-300-22-Z', 'P2')).toBe('P2');
    expect(recipePortToCatalogPort('SAM_CPS-300-45-Z', 'P1')).toBe('P1');
  });

  it('nombre desconocido para producto con mapping devuelve identidad (no explota)', () => {
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'puerto_fantasma')).toBe('puerto_fantasma');
  });

  it('producto sin mapping declarado devuelve identidad sin error', () => {
    expect(recipePortToCatalogPort('SAM_INEXISTENTE', 'tronco_P1')).toBe('tronco_P1');
  });

  it('catalogPortToRecipePort hace el inverso para TPS', () => {
    expect(catalogPortToRecipePort('SAM_TPS-300-Z', 'P1')).toBe('tronco_P1');
    expect(catalogPortToRecipePort('SAM_TPS-300-Z', 'P3')).toBe('boca_derivacion');
  });

  it('getDefaultMapping de TPS devuelve 3 entradas con justificación', () => {
    const def = getDefaultMapping('SAM_TPS-300-Z');
    expect(def).not.toBeNull();
    expect(def!.length).toBe(3);
    for (const entry of def!) {
      expect(entry.justification.length).toBeGreaterThan(10);
    }
  });

  it('getDefaultMapping de producto desconocido es null', () => {
    expect(getDefaultMapping('SAM_INEXISTENTE')).toBeNull();
  });
});

describe('catalogPortMapping — overrides del configurador', () => {
  beforeEach(() => clearPortMappingOverrides());

  it('un override reemplaza al default', () => {
    const ov: ProductPortMapping = {
      productId: 'SAM_TPS-300-Z',
      source: 'override',
      overrideReason: 'Datos del fabricante actualizados vía PDF 2026 Rev. B',
      overrideAt: new Date().toISOString(),
      entries: [
        { recipePortName: 'tronco_P1', catalogPortName: 'P3', physicalLabel: 'Reasignado', justification: 'override' },
        { recipePortName: 'tronco_P2', catalogPortName: 'P1', physicalLabel: 'Reasignado', justification: 'override' },
        { recipePortName: 'boca_derivacion', catalogPortName: 'P2', physicalLabel: 'Reasignado', justification: 'override' },
      ],
    };
    setPortMappingOverrides({ 'SAM_TPS-300-Z': ov });
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P3');
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P2')).toBe('P1');
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'boca_derivacion')).toBe('P2');
  });

  it('getEffectiveMapping informa source=override cuando hay override', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        overrideReason: 'test',
        overrideAt: 'test-date',
        entries: [],
      },
    });
    expect(getEffectiveMapping('SAM_TPS-300-Z')?.source).toBe('override');
    expect(getEffectiveMapping('SAM_XPS-300-Z')?.source).toBe('default');
  });

  it('clearPortMappingOverrides restablece los defaults', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        entries: [
          { recipePortName: 'tronco_P1', catalogPortName: 'ZZZ', physicalLabel: '', justification: '' },
        ],
      },
    });
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('ZZZ');
    clearPortMappingOverrides();
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P1');
    expect(listOverriddenProductIds()).toHaveLength(0);
  });
});

describe('catalogPortMapping — overrides geométricos (modelFrame + portGeometry)', () => {
  beforeEach(() => clearPortMappingOverrides());

  it('isIdentityModelFrame es true para undefined y para ceros', () => {
    expect(isIdentityModelFrame(undefined)).toBe(true);
    expect(isIdentityModelFrame({})).toBe(true);
    expect(isIdentityModelFrame({ tx_mm: 0, ty_mm: 0, tz_mm: 0 })).toBe(true);
    expect(isIdentityModelFrame({ rx_deg: 90 })).toBe(false);
    expect(isIdentityModelFrame({ tx_mm: 1e-9 })).toBe(false);
  });

  it('isIdentityPortGeometry es true sin vectores y sin rotación', () => {
    expect(isIdentityPortGeometry(undefined)).toBe(true);
    expect(isIdentityPortGeometry({})).toBe(true);
    expect(isIdentityPortGeometry({ installRotationDeg: 0 })).toBe(true);
    expect(isIdentityPortGeometry({ installRotationDeg: 45 })).toBe(false);
    expect(isIdentityPortGeometry({ centerMm: [1, 2, 3] })).toBe(false);
    expect(isIdentityPortGeometry({ normal: [1, 0, 0] })).toBe(false);
  });

  it('getModelFrameOverride devuelve null si identidad', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        entries: [],
        modelFrame: { tx_mm: 0, ty_mm: 0, tz_mm: 0 },
      },
    });
    expect(getModelFrameOverride('SAM_TPS-300-Z')).toBeNull();
  });

  it('getModelFrameOverride devuelve el objeto cuando no es identidad', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    const mf = getModelFrameOverride('SAM_TPS-300-Z');
    expect(mf?.rz_deg).toBe(90);
  });

  it('getPortGeometryOverride devuelve override por boca cuando existe', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        entries: [
          {
            recipePortName: 'boca_derivacion',
            catalogPortName: 'P3',
            physicalLabel: 'lateral',
            justification: 'ajuste',
            geometry: { installRotationDeg: 15, centerMm: [10, 25, 0] },
          },
        ],
      },
    });
    const g = getPortGeometryOverride('SAM_TPS-300-Z', 'boca_derivacion');
    expect(g?.installRotationDeg).toBe(15);
    expect(g?.centerMm).toEqual([10, 25, 0]);
    expect(getPortGeometryOverride('SAM_TPS-300-Z', 'tronco_P1')).toBeNull();
  });

  it('getPortGeometryOverride ignora geometría identidad', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        entries: [
          {
            recipePortName: 'boca_derivacion',
            catalogPortName: 'P3',
            physicalLabel: 'lateral',
            justification: 'noop',
            geometry: { installRotationDeg: 0 },
          },
        ],
      },
    });
    expect(getPortGeometryOverride('SAM_TPS-300-Z', 'boca_derivacion')).toBeNull();
  });

  it('agregar geometry no rompe el mapping de nombres existente', () => {
    setPortMappingOverrides({
      'SAM_TPS-300-Z': {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        entries: [
          { recipePortName: 'tronco_P1', catalogPortName: 'P1', physicalLabel: '', justification: '' },
          {
            recipePortName: 'boca_derivacion',
            catalogPortName: 'P3',
            physicalLabel: '',
            justification: '',
            geometry: { installRotationDeg: 10 },
          },
        ],
      },
    });
    // Name translation sigue funcionando.
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P1');
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'boca_derivacion')).toBe('P3');
    // Y la geometría se puede leer separada.
    expect(getPortGeometryOverride('SAM_TPS-300-Z', 'boca_derivacion')?.installRotationDeg).toBe(10);
  });
});
