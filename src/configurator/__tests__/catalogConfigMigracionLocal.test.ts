// @vitest-environment jsdom
/**
 * B-2.6 — la biblioteca local por SKU (codex:catalogConfig:v1) migra a v2 al
 * hidratar, sin perder nada y conservando el original.
 *
 *   - La clave v1 queda byte a byte igual (es la copia del original) y además
 *     se guarda una copia fechada.
 *   - La v2 lleva la calibración por patrón, los overrides sólo con nombres,
 *     las aprobaciones y los aportes, y el informe de la migración.
 *   - Una v1 sin geometría no se migra: se carga tal cual.
 *   - Control negativo: sin v1 ni v2 no se escribe nada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_MIGRACION_PREFIX, STORAGE_KEY_V2, useCatalogConfigStore } from '../catalogConfigStore';
import { clearPortMappingOverrides } from '../../workspace/catalogPortMapping';
import { clearBibliotecaCalibracion, getBibliotecaCalibracion } from '../../workspace/calibracionPatron';

const V1 = 'codex:catalogConfig:v1';

const v1ConGeometria = JSON.stringify({
  version: 'codex:catalogConfig/1',
  overrides: {
    'SAM_TPS-300-Z': {
      productId: 'SAM_TPS-300-Z',
      source: 'override',
      overrideReason: 'calibrado en obra',
      entries: [
        { recipePortName: 'tronco_P1', catalogPortName: 'P1', physicalLabel: 'P1', justification: 'x', geometry: { installRotationDeg: 10 } },
        { recipePortName: 'tronco_P2', catalogPortName: 'P2', physicalLabel: 'P2', justification: 'x' },
        { recipePortName: 'boca_derivacion', catalogPortName: 'P3', physicalLabel: 'P3', justification: 'x' },
      ],
    },
  },
  approvals: { 'SAM_TPS-300-Z': { approvedAtRevision: 1, approvedAtCalibrationHash: 'h', approvedAt: '2026-11-01T00:00:00Z' } },
  aporteOverrides: {},
  savedAt: '2026-11-01T00:00:00Z',
});

function reset() {
  localStorage.clear();
  clearPortMappingOverrides();
  clearBibliotecaCalibracion();
  useCatalogConfigStore.setState({
    overrides: {}, approvals: {}, aporteOverrides: {}, hydrated: false,
    calibracion: { version: 'codex:calibracion/2', patrones: {}, excepciones: {}, pendientes: {} },
    informeMigracion: null,
  });
}

async function esperar(cond: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando la migración');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(reset);
afterEach(reset);

describe('biblioteca local v1 → v2', () => {
  it('migra al hidratar: v1 intacta, copia fechada, v2 con calibración por patrón e informe', async () => {
    localStorage.setItem(V1, v1ConGeometria);
    useCatalogConfigStore.getState().hydrate();
    await esperar(() => useCatalogConfigStore.getState().informeMigracion !== null);

    expect(localStorage.getItem(V1)).toBe(v1ConGeometria);
    const copias = Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_MIGRACION_PREFIX));
    expect(copias).toHaveLength(1);
    expect(localStorage.getItem(copias[0])).toBe(v1ConGeometria);

    const v2 = JSON.parse(localStorage.getItem(STORAGE_KEY_V2)!);
    expect(v2.version).toBe('codex:catalogConfig/2');
    expect(v2.overrides['SAM_TPS-300-Z'].entries.every((e: { geometry?: unknown }) => !e.geometry)).toBe(true);
    expect(v2.approvals['SAM_TPS-300-Z']).toBeDefined();
    const patron = Object.values(v2.calibracion.patrones)[0] as { bocas: Record<string, { giro_deg: { axial: number } }> };
    expect(patron.bocas.tronco_P1.giro_deg.axial).toBeCloseTo(10, 9);
    expect(v2.migradoDesdeV1.copia).toBe(copias[0]);

    // Y la calibración quedó aplicada en memoria para la definición efectiva.
    expect(Object.keys(getBibliotecaCalibracion().patrones)).toHaveLength(1);
  });

  it('una segunda hidratación lee la v2 y no vuelve a migrar', async () => {
    localStorage.setItem(V1, v1ConGeometria);
    useCatalogConfigStore.getState().hydrate();
    await esperar(() => useCatalogConfigStore.getState().informeMigracion !== null);
    const copias = Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_MIGRACION_PREFIX));
    useCatalogConfigStore.setState({ hydrated: false });
    clearBibliotecaCalibracion();
    useCatalogConfigStore.getState().hydrate();
    expect(Object.keys(getBibliotecaCalibracion().patrones)).toHaveLength(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_MIGRACION_PREFIX))).toEqual(copias);
  });

  it('una v1 sin geometría se carga tal cual, sin migrar', () => {
    const soloNombres = JSON.stringify({ ...JSON.parse(v1ConGeometria), overrides: { 'SAM_TPS-300-Z': { productId: 'SAM_TPS-300-Z', source: 'override', entries: [] } } });
    localStorage.setItem(V1, soloNombres);
    useCatalogConfigStore.getState().hydrate();
    expect(useCatalogConfigStore.getState().overrides['SAM_TPS-300-Z']).toBeDefined();
    expect(localStorage.getItem(STORAGE_KEY_V2)).toBeNull();
    expect(localStorage.getItem(V1)).toBe(soloNombres);
  });

  it('control negativo: sin biblioteca guardada no se escribe nada', () => {
    useCatalogConfigStore.getState().hydrate();
    expect(Object.keys(localStorage)).toEqual([]);
  });
});
