// @vitest-environment jsdom
/**
 * aporteTrazado — regresión de defaults, validación y persistencia.
 *
 * Qué defiende:
 *   - `defaultAporteForMaster` devuelve `longitud` para tramo_recto y
 *     `multiplo-ancho × 2` para el resto de pieceKind.
 *   - `isAporteRule` rechaza valores inválidos (multiplier ≤ 0, valueMm ≤ 0,
 *     kind desconocido) y acepta las tres formas canónicas.
 *   - `computeAporteMm` responde según la regla y devuelve null cuando falta
 *     la dimensión requerida.
 *   - El store `useCatalogConfigStore` persiste `aporteOverrides`:
 *       · upsertAporte + removeAporte actualizan la fuente efectiva.
 *       · serialize/hydrate preservan las reglas.
 *       · archivos antiguos sin `aporteOverrides` no rompen el hydrate.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeAporteMm,
  defaultAporteForMaster,
  isAporteRule,
  type AporteRule,
} from '../aporteTrazado';
import type { MasterModel } from '../masterModels';
import { useCatalogConfigStore } from '../catalogConfigStore';
import { clearPortMappingOverrides } from '../../workspace/catalogPortMapping';

function makeMaster(pieceKind: MasterModel['pieceKind']): MasterModel {
  return {
    id: `test:${pieceKind}`,
    label: `Test ${pieceKind}`,
    sistema: 'perforada',
    pieceKind,
    source: { stepFile: 'TEST.STEP', stepHashShort: '00000000', reportJsonPath: 'test.json' },
    recipeKey: pieceKind,
    baseParams: { ancho_mm: 300, ala_mm: 50 },
    canonicalRotationZDeg: 0,
    catalogMatch: { familiaIds: ['X'], catalogTipoPieza: 'recta', catalogAlaMm: 50 },
    ports: [],
    variationRule: {
      kind: 'ancho-only-z',
      provenance: 'derived',
      varies: ['ancho'],
      rationale: 'test',
    },
    declaredVariantSkus: [],
    closure: {
      continuity: { status: 'pending', regressionSpecs: [], limitations: [] },
      fidelity: { status: 'pending', regressionSpecs: [], limitations: [] },
      variants: { status: 'pending', regressionSpecs: [], limitations: [] },
    },
    revision: 1,
  } as MasterModel;
}

describe('aporteTrazado — defaults por pieceKind', () => {
  it('tramo_recto → por longitud del segmento', () => {
    expect(defaultAporteForMaster(makeMaster('tramo_recto'))).toEqual({ kind: 'longitud' });
  });

  it('curva horizontal → 2 × ancho', () => {
    expect(defaultAporteForMaster(makeMaster('curva_horizontal'))).toEqual({
      kind: 'multiplo-ancho',
      multiplier: 2,
    });
  });

  it('T simétrica → 2 × ancho', () => {
    expect(defaultAporteForMaster(makeMaster('tee_simetrica'))).toEqual({
      kind: 'multiplo-ancho',
      multiplier: 2,
    });
  });

  it('curva vertical → 2 × ancho', () => {
    expect(defaultAporteForMaster(makeMaster('curva_vertical'))).toEqual({
      kind: 'multiplo-ancho',
      multiplier: 2,
    });
  });
});

describe('aporteTrazado — validación estructural', () => {
  it('acepta reglas canónicas', () => {
    expect(isAporteRule({ kind: 'longitud' })).toBe(true);
    expect(isAporteRule({ kind: 'multiplo-ancho', multiplier: 2 })).toBe(true);
    expect(isAporteRule({ kind: 'fijo-mm', valueMm: 100 })).toBe(true);
  });

  it('rechaza multiplier inválido o ausente', () => {
    expect(isAporteRule({ kind: 'multiplo-ancho' })).toBe(false);
    expect(isAporteRule({ kind: 'multiplo-ancho', multiplier: 0 })).toBe(false);
    expect(isAporteRule({ kind: 'multiplo-ancho', multiplier: -1 })).toBe(false);
    expect(isAporteRule({ kind: 'multiplo-ancho', multiplier: Number.NaN })).toBe(false);
  });

  it('rechaza valueMm inválido o ausente', () => {
    expect(isAporteRule({ kind: 'fijo-mm' })).toBe(false);
    expect(isAporteRule({ kind: 'fijo-mm', valueMm: 0 })).toBe(false);
    expect(isAporteRule({ kind: 'fijo-mm', valueMm: -5 })).toBe(false);
  });

  it('rechaza formas no-objeto o kind desconocido', () => {
    expect(isAporteRule(null)).toBe(false);
    expect(isAporteRule('longitud')).toBe(false);
    expect(isAporteRule({ kind: 'otro' })).toBe(false);
  });
});

describe('aporteTrazado — computeAporteMm', () => {
  it('kind=longitud devuelve la longitud si está provista', () => {
    expect(computeAporteMm({ kind: 'longitud' }, { ancho_mm: 300, longitud_mm: 2500 })).toBe(2500);
  });

  it('kind=longitud devuelve null si falta longitud_mm', () => {
    expect(computeAporteMm({ kind: 'longitud' }, { ancho_mm: 300 })).toBeNull();
  });

  it('kind=multiplo-ancho usa multiplier × ancho_mm', () => {
    expect(
      computeAporteMm({ kind: 'multiplo-ancho', multiplier: 2.5 }, { ancho_mm: 400 }),
    ).toBe(1000);
  });

  it('kind=fijo-mm devuelve el valor declarado', () => {
    expect(computeAporteMm({ kind: 'fijo-mm', valueMm: 750 }, { ancho_mm: 300 })).toBe(750);
  });
});

describe('catalogConfigStore — persistencia de aporteOverrides', () => {
  const PRODUCT_ID = 'TEST_PROD';
  const RULE: AporteRule = { kind: 'multiplo-ancho', multiplier: 3 };

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    clearPortMappingOverrides();
    useCatalogConfigStore.setState({
      overrides: {},
      approvals: {},
      aporteOverrides: {},
      hydrated: false,
    });
  });

  it('upsertAporte guarda y refleja override en getEffectiveAporte', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertAporte(PRODUCT_ID, RULE);
    const eff = useCatalogConfigStore.getState().getEffectiveAporte(
      PRODUCT_ID,
      makeMaster('tramo_recto'),
    );
    expect(eff?.source).toBe('override');
    expect(eff?.rule).toEqual(RULE);
  });

  it('removeAporte vuelve al default del maestro', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertAporte(PRODUCT_ID, RULE);
    store.removeAporte(PRODUCT_ID);
    const eff = useCatalogConfigStore.getState().getEffectiveAporte(
      PRODUCT_ID,
      makeMaster('tramo_recto'),
    );
    expect(eff?.source).toBe('default');
    expect(eff?.rule).toEqual({ kind: 'longitud' });
  });

  it('serialize incluye aporteOverrides y hydrate los restaura', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertAporte(PRODUCT_ID, RULE);
    const raw = useCatalogConfigStore.getState().serialize();
    const parsed = JSON.parse(raw);
    expect(parsed.aporteOverrides?.[PRODUCT_ID]).toEqual(RULE);

    localStorage.setItem('codex:catalogConfig:v1', raw);
    useCatalogConfigStore.setState({
      overrides: {},
      approvals: {},
      aporteOverrides: {},
      hydrated: false,
    });
    useCatalogConfigStore.getState().hydrate();
    expect(useCatalogConfigStore.getState().aporteOverrides[PRODUCT_ID]).toEqual(RULE);
  });

  it('archivos antiguos sin aporteOverrides hidratan como vacío', () => {
    localStorage.setItem(
      'codex:catalogConfig:v1',
      JSON.stringify({
        version: 'codex:catalogConfig/1',
        overrides: {},
        savedAt: '2026-01-01T00:00:00Z',
      }),
    );
    useCatalogConfigStore.getState().hydrate();
    expect(useCatalogConfigStore.getState().aporteOverrides).toEqual({});
  });

  it('replaceAporteOverrides descarta entradas inválidas', () => {
    const store = useCatalogConfigStore.getState();
    store.replaceAporteOverrides({
      valid: { kind: 'longitud' },
      bad: { kind: 'otro' } as unknown as AporteRule,
      badMul: { kind: 'multiplo-ancho' } as unknown as AporteRule,
    });
    const state = useCatalogConfigStore.getState().aporteOverrides;
    expect(state.valid).toEqual({ kind: 'longitud' });
    expect(state.bad).toBeUndefined();
    expect(state.badMul).toBeUndefined();
  });

  it('upsertAporte rechaza reglas inválidas sin mutar el estado', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertAporte(PRODUCT_ID, { kind: 'otro' } as unknown as AporteRule);
    expect(useCatalogConfigStore.getState().aporteOverrides[PRODUCT_ID]).toBeUndefined();
  });
});
