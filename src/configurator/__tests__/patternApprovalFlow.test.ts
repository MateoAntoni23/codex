// @vitest-environment jsdom
/**
 * patternApprovalFlow — regresión del flujo aprobar → desactualizar → revalidar.
 *
 * Qué defiende (hito 1 operativo del configurador):
 *   - approveProduct fija revisión + hash de calibración en el momento.
 *   - getApprovalInfo devuelve 'current' justo después de aprobar.
 *   - Un cambio en la calibración (upsertOverride cambiando geometría) deja la
 *     aprobación en 'outdated' con reason='calibration-changed'.
 *   - Un cambio en la revisión del maestro deja la aprobación en 'outdated'
 *     con reason='revision-changed'.
 *   - revokeApproval vuelve a 'none'.
 *   - serialize/hydrate round-trip preserva las aprobaciones.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useCatalogConfigStore } from '../catalogConfigStore';
import {
  clearPortMappingOverrides,
  type ProductPortMapping,
} from '../../workspace/catalogPortMapping';

const PRODUCT_ID = 'SAM_TPS-300-Z';
const INITIAL_REVISION = 1;

function makeOverride(): ProductPortMapping {
  return {
    productId: PRODUCT_ID,
    source: 'override',
    overrideReason: 'test — reemplaza default',
    overrideAt: '2026-11-09T00:00:00Z',
    entries: [
      { recipePortName: 'tronco_P1', catalogPortName: 'P1', physicalLabel: 'A', justification: 'default-ish' },
      { recipePortName: 'tronco_P2', catalogPortName: 'P2', physicalLabel: 'B', justification: 'default-ish' },
      { recipePortName: 'boca_derivacion', catalogPortName: 'P3', physicalLabel: 'C', justification: 'default-ish' },
    ],
  };
}

describe('catalogConfigStore — flujo de aprobación', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    clearPortMappingOverrides();
    useCatalogConfigStore.setState({ overrides: {}, approvals: {}, hydrated: false });
  });

  it('approveProduct sin override: aprobación queda vigente con el default', () => {
    const store = useCatalogConfigStore.getState();
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    const info = store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION);
    expect(info.status).toBe('current');
    expect(info.stored?.approvedAtRevision).toBe(INITIAL_REVISION);
  });

  it('approveProduct con override: aprobación queda vigente con el override', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride());
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    const info = store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION);
    expect(info.status).toBe('current');
  });

  it('cambiar calibración (upsertOverride con geometry nueva) invalida la aprobación', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride());
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    expect(store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION).status).toBe('current');
    // Cambio la calibración:
    const edited = {
      ...makeOverride(),
      entries: [
        { ...makeOverride().entries[0], geometry: { centerMm: [1, 2, 3] as [number, number, number] } },
        makeOverride().entries[1],
        makeOverride().entries[2],
      ],
    };
    store.upsertOverride(PRODUCT_ID, edited);
    const info = store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION);
    expect(info.status).toBe('outdated');
    expect(info.outdatedReason).toBe('calibration-changed');
  });

  it('cambiar la revisión del maestro invalida la aprobación', () => {
    const store = useCatalogConfigStore.getState();
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    expect(store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION).status).toBe('current');
    const info = store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION + 1);
    expect(info.status).toBe('outdated');
    expect(info.outdatedReason).toBe('revision-changed');
  });

  it('ambos cambios a la vez marcan reason=both', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride());
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    const edited = {
      ...makeOverride(),
      modelFrame: { rx_deg: 90 },
    };
    store.upsertOverride(PRODUCT_ID, edited);
    const info = store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION + 2);
    expect(info.status).toBe('outdated');
    expect(info.outdatedReason).toBe('both');
  });

  it('revokeApproval devuelve el estado a none', () => {
    const store = useCatalogConfigStore.getState();
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    expect(store.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION).status).toBe('current');
    store.revokeApproval(PRODUCT_ID);
    expect(useCatalogConfigStore.getState().getApprovalInfo(PRODUCT_ID, INITIAL_REVISION).status).toBe('none');
  });

  it('serialize incluye approvals y hydrate las restaura', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride());
    store.approveProduct(PRODUCT_ID, INITIAL_REVISION);
    const raw = useCatalogConfigStore.getState().serialize();
    const parsed = JSON.parse(raw);
    expect(parsed.approvals?.[PRODUCT_ID]).toBeDefined();
    expect(parsed.approvals[PRODUCT_ID].approvedAtRevision).toBe(INITIAL_REVISION);

    // Simulamos un reload: guardamos el payload en localStorage, reseteamos y
    // volvemos a hidratar.
    localStorage.setItem('codex:catalogConfig:v1', raw);
    clearPortMappingOverrides();
    useCatalogConfigStore.setState({ overrides: {}, approvals: {}, hydrated: false });
    useCatalogConfigStore.getState().hydrate();
    const reloaded = useCatalogConfigStore.getState();
    expect(reloaded.approvals[PRODUCT_ID]).toBeDefined();
    expect(reloaded.getApprovalInfo(PRODUCT_ID, INITIAL_REVISION).status).toBe('current');
  });

  it('archivos antiguos sin approvals hidratan como aprobaciones vacías (compat)', () => {
    localStorage.setItem(
      'codex:catalogConfig:v1',
      JSON.stringify({
        version: 'codex:catalogConfig/1',
        overrides: { [PRODUCT_ID]: makeOverride() },
        savedAt: '2026-01-01T00:00:00Z',
      }),
    );
    useCatalogConfigStore.getState().hydrate();
    const state = useCatalogConfigStore.getState();
    expect(state.overrides[PRODUCT_ID]).toBeDefined();
    expect(state.approvals).toEqual({});
  });
});
