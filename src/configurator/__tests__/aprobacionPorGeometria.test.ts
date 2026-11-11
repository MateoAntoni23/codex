// @vitest-environment jsdom
/**
 * Decisión 3 (B-2): una aprobación sigue valiendo mientras la geometría
 * vigente sea la aprobada, aunque cambien huella o revisión del maestro.
 * Control negativo: una calibración real del patrón la invalida.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedStaticCatalog } from '../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../workspace/catalogPortMapping';
import { clearBibliotecaCalibracion } from '../../workspace/calibracionPatron';
import { definicionEfectiva } from '../../workspace/placement/definitions';
import { useCatalogConfigStore } from '../catalogConfigStore';
import type { Product } from '../../tray/model';

beforeAll(async () => {
  localStorage.clear();
  clearPortMappingOverrides();
  clearBibliotecaCalibracion();
  await seedStaticCatalog();
});
afterAll(() => {
  clearBibliotecaCalibracion();
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
  localStorage.clear();
});

describe('aprobación por geometría', () => {
  it('otra revisión con la misma geometría conserva la aprobación; una calibración real la invalida', () => {
    const st = useCatalogConfigStore.getState();
    st.approveProduct('SAM_TPS-450-Z', 1);
    expect(useCatalogConfigStore.getState().approvals['SAM_TPS-450-Z'].approvedDefinicion).toBeDefined();
    // Revisión 2 del maestro sin cambio de geometría: sigue vigente.
    expect(useCatalogConfigStore.getState().getApprovalInfo('SAM_TPS-450-Z', 2).status).toBe('current');
    // Calibración real del patrón: deja de valer.
    const d = definicionEfectiva({ producto_id: 'SAM_TPS-450-Z' } as Product);
    const patron = d.modelo?.patron ?? (d.ok ? d.def.patron : 'master:perforada:tee_simetrica');
    useCatalogConfigStore.getState().setCorreccionPatron(patron, 'boca_derivacion', {
      desplazamiento_mm: { lateral: 0, vertical: 0, axial: 3 }, giro_deg: { lateral: 0, vertical: 0, axial: 0 },
    }, 'prueba de aprobación');
    expect(useCatalogConfigStore.getState().getApprovalInfo('SAM_TPS-450-Z', 1).status).toBe('outdated');
  });
});
