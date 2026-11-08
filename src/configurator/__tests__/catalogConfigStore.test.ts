// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useCatalogConfigStore } from '../catalogConfigStore';
import {
  clearPortMappingOverrides,
  getEffectiveMapping,
  recipePortToCatalogPort,
  type ProductPortMapping,
} from '../../workspace/catalogPortMapping';

function makeOverride(productId: string, mapping: Partial<ProductPortMapping> = {}): ProductPortMapping {
  return {
    productId,
    source: 'override',
    overrideReason: 'test — reemplaza al default',
    overrideAt: '2026-11-08T00:00:00Z',
    entries: [
      { recipePortName: 'tronco_P1', catalogPortName: 'P3', physicalLabel: 'reasignado', justification: 'Override: test' },
      { recipePortName: 'tronco_P2', catalogPortName: 'P1', physicalLabel: 'reasignado', justification: 'Override: test' },
      { recipePortName: 'boca_derivacion', catalogPortName: 'P2', physicalLabel: 'reasignado', justification: 'Override: test' },
    ],
    ...mapping,
  };
}

describe('catalogConfigStore', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    clearPortMappingOverrides();
    // Reset the Zustand store state directly.
    useCatalogConfigStore.setState({ overrides: {}, hydrated: false });
  });

  it('upsertOverride propaga el mapping al motor de compat', () => {
    const ov = makeOverride('SAM_TPS-300-Z');
    useCatalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', ov);
    // La traducción ahora sigue el override: tronco_P1 → P3.
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P3');
    expect(getEffectiveMapping('SAM_TPS-300-Z')?.source).toBe('override');
  });

  it('removeOverride restablece el default declarado', () => {
    useCatalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', makeOverride('SAM_TPS-300-Z'));
    useCatalogConfigStore.getState().removeOverride('SAM_TPS-300-Z');
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P1');
    expect(getEffectiveMapping('SAM_TPS-300-Z')?.source).toBe('default');
  });

  it('hydrate lee de localStorage y rehidrata el motor', () => {
    const ov = makeOverride('SAM_TPS-300-Z');
    localStorage.setItem(
      'codex:catalogConfig:v1',
      JSON.stringify({
        version: 'codex:catalogConfig/1',
        overrides: { 'SAM_TPS-300-Z': ov },
        savedAt: '2026-11-08T00:00:00Z',
      }),
    );
    useCatalogConfigStore.getState().hydrate();
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P3');
    expect(useCatalogConfigStore.getState().overrides['SAM_TPS-300-Z']).toBeDefined();
  });

  it('serialize produce JSON con firma codex:catalogConfig/1', () => {
    useCatalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', makeOverride('SAM_TPS-300-Z'));
    const raw = useCatalogConfigStore.getState().serialize();
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe('codex:catalogConfig/1');
    expect(parsed.overrides['SAM_TPS-300-Z'].source).toBe('override');
  });

  it('replaceAll reemplaza todos los overrides y persiste', () => {
    useCatalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', makeOverride('SAM_TPS-300-Z'));
    useCatalogConfigStore.getState().replaceAll({});
    expect(recipePortToCatalogPort('SAM_TPS-300-Z', 'tronco_P1')).toBe('P1');
    expect(useCatalogConfigStore.getState().overrides).toEqual({});
  });

  it('hydrate ignora payloads con versión distinta', () => {
    localStorage.setItem(
      'codex:catalogConfig:v1',
      JSON.stringify({ version: 'otra/1', overrides: { x: 'y' } }),
    );
    useCatalogConfigStore.getState().hydrate();
    expect(useCatalogConfigStore.getState().overrides).toEqual({});
  });
});
