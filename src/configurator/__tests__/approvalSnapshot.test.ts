// @vitest-environment jsdom
/**
 * approvalSnapshot — regresión del snapshot de mapping al aprobar (hito 3).
 *
 * Qué defiende:
 *   - Al aprobar sin override, el snapshot captura el default declarado.
 *   - Al aprobar con override, el snapshot captura el override exacto.
 *   - El snapshot es independiente: ediciones posteriores del override NO
 *     mutan el snapshot almacenado (referencia clonada en profundidad).
 *   - Serializar + hidratar preserva el snapshot (viajan en el archivo del
 *     proyecto); compat con archivos legacy que no lo traigan.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useCatalogConfigStore } from '../catalogConfigStore';
import {
  clearPortMappingOverrides,
  type ProductPortMapping,
} from '../../workspace/catalogPortMapping';

const PRODUCT_ID = 'SAM_TPS-300-Z';
const REVISION = 1;

function makeOverride(centerX = 0): ProductPortMapping {
  return {
    productId: PRODUCT_ID,
    source: 'override',
    overrideReason: 'test — reemplaza default',
    overrideAt: '2026-11-09T00:00:00Z',
    entries: [
      {
        recipePortName: 'tronco_P1',
        catalogPortName: 'P1',
        physicalLabel: 'A',
        justification: 'default-ish',
        geometry: { centerMm: [centerX, 0, 0] },
      },
      {
        recipePortName: 'tronco_P2',
        catalogPortName: 'P2',
        physicalLabel: 'B',
        justification: 'default-ish',
      },
      {
        recipePortName: 'boca_derivacion',
        catalogPortName: 'P3',
        physicalLabel: 'C',
        justification: 'default-ish',
      },
    ],
  };
}

describe('catalogConfigStore — snapshot al aprobar', () => {
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

  it('aprobar con override congela el mapping exacto en approvedMapping', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride(5));
    store.approveProduct(PRODUCT_ID, REVISION);
    const approval = useCatalogConfigStore.getState().approvals[PRODUCT_ID];
    expect(approval.approvedMapping).toBeDefined();
    expect(approval.approvedMapping!.entries[0].geometry?.centerMm).toEqual([5, 0, 0]);
  });

  it('editar el override después NO muta el snapshot', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride(5));
    store.approveProduct(PRODUCT_ID, REVISION);
    // Mutamos la fuente: el snapshot no debe cambiar.
    useCatalogConfigStore.getState().upsertOverride(PRODUCT_ID, makeOverride(99));
    const approval = useCatalogConfigStore.getState().approvals[PRODUCT_ID];
    expect(approval.approvedMapping!.entries[0].geometry?.centerMm).toEqual([5, 0, 0]);
  });

  it('aprobar sin override congela el default declarado', () => {
    const store = useCatalogConfigStore.getState();
    store.approveProduct(PRODUCT_ID, REVISION);
    const approval = useCatalogConfigStore.getState().approvals[PRODUCT_ID];
    // SAM_TPS-300-Z tiene default declarado con 3 entries.
    expect(approval.approvedMapping).toBeDefined();
    expect(approval.approvedMapping!.entries.length).toBe(3);
    expect(approval.approvedMapping!.source).toBe('default');
  });

  it('serialize + hydrate preserva approvedMapping', () => {
    const store = useCatalogConfigStore.getState();
    store.upsertOverride(PRODUCT_ID, makeOverride(7));
    store.approveProduct(PRODUCT_ID, REVISION);
    const raw = useCatalogConfigStore.getState().serialize();
    const parsed = JSON.parse(raw);
    expect(parsed.approvals[PRODUCT_ID].approvedMapping.entries[0].geometry.centerMm).toEqual([7, 0, 0]);

    // Reset + hidratar.
    localStorage.setItem('codex:catalogConfig:v1', raw);
    clearPortMappingOverrides();
    useCatalogConfigStore.setState({
      overrides: {},
      approvals: {},
      aporteOverrides: {},
      hydrated: false,
    });
    useCatalogConfigStore.getState().hydrate();
    const reloaded = useCatalogConfigStore.getState().approvals[PRODUCT_ID];
    expect(reloaded.approvedMapping?.entries[0].geometry?.centerMm).toEqual([7, 0, 0]);
  });

  it('archivos legacy sin approvedMapping se cargan sin romper (undefined)', () => {
    localStorage.setItem(
      'codex:catalogConfig:v1',
      JSON.stringify({
        version: 'codex:catalogConfig/1',
        overrides: {},
        approvals: {
          [PRODUCT_ID]: {
            approvedAtRevision: REVISION,
            approvedAtCalibrationHash: 'deadbeef',
            approvedAt: '2026-01-01T00:00:00Z',
            // approvedMapping ausente — archivo pre-hito-3.
          },
        },
        savedAt: '2026-01-01T00:00:00Z',
      }),
    );
    useCatalogConfigStore.getState().hydrate();
    const approval = useCatalogConfigStore.getState().approvals[PRODUCT_ID];
    expect(approval.approvedMapping).toBeUndefined();
    // La aprobación sigue siendo utilizable — basta el hash.
    expect(approval.approvedAtCalibrationHash).toBe('deadbeef');
  });
});
