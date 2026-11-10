/**
 * m1c — compatibilidad por boca para accesorios de varias bocas, contra el
 * catálogo real (C1, C2, C4). No se inventa compatibilidad: sólo se lee lo que
 * el catálogo documenta.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { loadStaticCatalog, seedStaticCatalog, type StaticCatalog } from '../../catalog/staticCatalog';
import { getPortCompatibility } from '../routingRules';
import {
  clearCatalogPortIndex,
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  resolveCatalogPort,
  setMasterResolver,
} from '../catalogPortMapping';

let cat: StaticCatalog;
const tipo = (id: string) => cat.productos.find((p) => p.producto_id === id)?.tipo_pieza;

beforeAll(async () => {
  clearPortMappingOverrides();
  cat = await loadStaticCatalog();
  await seedStaticCatalog();
});
afterAll(() => {
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

function compatOf(productId: string, boca: string) {
  const r = getPortCompatibility(cat.compatibilidades, productId, boca);
  if (r.status !== 'ok') throw new Error(`${productId}.${boca}: ${r.reason}`);
  return r.ids;
}

describe('C1 — CUPS-300-D-Z por su boca vertical', () => {
  it('la boca P2_vertical se traduce por el patrón a P2 (puerto publicado)', () => {
    expect(resolveCatalogPort('SAM_CUPS-300-D-Z', 'P2_vertical')).toEqual({ status: 'mapped', catalogPortName: 'P2', source: 'master' });
  });
  it('ofrece TRPS-300-22-Z como compatible documentado', () => {
    expect(compatOf('SAM_CUPS-300-D-Z', 'P2_vertical').has('SAM_TRPS-300-22-Z')).toBe(true);
    expect(compatOf('SAM_CUPS-300-D-Z', 'P1_horizontal').has('SAM_TRPS-300-22-Z')).toBe(true);
  });
  it('no inventa accesorio ↔ accesorio: todos los compatibles de la boca vertical son rectos', () => {
    const ids = [...compatOf('SAM_CUPS-300-D-Z', 'P2_vertical')];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => tipo(id) === 'recta')).toBe(true);
    expect(ids).not.toContain('SAM_CUPS-300-D-Z');
    expect(ids).not.toContain('SAM_CUPS-300-A-Z');
  });
});

describe('C2 — T y X de ancho ≠ 300 y acabado ≠ Z', () => {
  it('T perforada TPS-450-ZB (bocas semánticas) → TRPS-450-20-ZB por cada boca', () => {
    for (const boca of ['tronco_P1', 'tronco_P2', 'boca_derivacion']) {
      expect(resolveCatalogPort('SAM_TPS-450-ZB', boca).status).toBe('mapped');
      expect(compatOf('SAM_TPS-450-ZB', boca).has('SAM_TRPS-450-20-ZB')).toBe(true);
    }
  });
  it('T escalera TS-450-065-18-G → TRES-450-065-18-G por la derivación', () => {
    expect(compatOf('SAM_TS-450-065-18-G', 'P3').has('SAM_TRES-450-065-18-G')).toBe(true);
  });
  it('X escalera XS-450-065-18-G → TRES-450-065-18-G por un brazo', () => {
    expect(compatOf('SAM_XS-450-065-18-G', 'P3').has('SAM_TRES-450-065-18-G')).toBe(true);
  });
});

describe('C4 — producto sin mapping resoluble', () => {
  it('DCPS-300-Z: "sin calibración de bocas", no "0 compatibles"', () => {
    const r = getPortCompatibility(cat.compatibilidades, 'SAM_DCPS-300-Z', 'boca_derivacion');
    expect(r.status).toBe('uncalibrated');
    if (r.status === 'uncalibrated') expect(r.reason).toMatch(/sin calibración de bocas/);
  });
  it('un producto sin maestro ni mapping con boca semántica no se traduce en silencio', () => {
    expect(resolveCatalogPort('SAM_EMPS-300-Z', 'tronco_P1').status).toBe('uncalibrated');
  });
});
