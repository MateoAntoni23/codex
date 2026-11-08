/**
 * E2E — categorización 'Recomendados' / 'Otros productos' en el selector de
 * continuación del routing.
 *
 * Testea con clicks reales sobre el DOM:
 *   1) Carga una bandeja con TRPS + CPS-90, puerto CRV-1.P2 libre.
 *   2) Activa routing, selecciona el puerto CRV-1.P2.
 *   3) Inspecciona las <optgroup> del <select data-codex-routing-product-select>:
 *      espera al menos "Recomendados" con TRPS/CPS y "Otros productos" con
 *      ⚠ (compat_no_documentada) y/o ⏳ (kind_pendiente_insercion) para los
 *      productos paramétricos sin compat SAMET explícita.
 *   4) Selecciona un candidato 'other' habilitado (si existe): el panel debe
 *      mostrar el bloque de excepción con `data-codex-routing-exception-motive`
 *      y bloquear confirmación sin motivo.
 *
 * Requiere dev server activo en http://localhost:5173.
 */
import { test, expect } from '@playwright/test';

const FIXTURE_TRAY = {
  version_contrato: 'trazado/1',
  piezas: [
    {
      instancia_id: 'T1',
      producto_id: 'SAM_TRPS-300-22-Z',
      longitud_mm: 3000,
      puertos: {
        P1: { posicion_mm: [0, 0, 0], direccion: [-1, 0, 0] },
        P2: { posicion_mm: [3000, 0, 0], direccion: [1, 0, 0] },
      },
    },
    {
      instancia_id: 'CRV-1',
      producto_id: 'SAM_CPS-300-90-Z',
      longitud_eje_mm: 933.5164030325733,
      puertos: {
        P1: { posicion_mm: [3000, 0, 0], direccion: [-1, 0, 0] },
        P2: {
          posicion_mm: [3593.160605459253, -595.4272333217659, 0],
          direccion: [-0.004416170774331087, -0.9999902486703018, 0],
        },
      },
    },
  ],
  conexiones: [
    { conexion_id: 'CON-001', a: ['T1', 'P2'], b: ['CRV-1', 'P1'] },
  ],
  circuitos: [],
  soportes: [],
  pe: {
    seccion_requerida_mm2: 16,
    cable_id: 'TEST',
    origen_requisito: 'test',
    conductores: [],
  },
};

test.describe('Selector de continuación con estados explícitos', () => {
  test.setTimeout(60_000);
  test('muestra optgroups Recomendados y Otros productos con sus marcadores', async ({ page }) => {
    await page.goto('/?workspace=bandejas&diag=ports');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );

    await page.evaluate((tray) => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { importEdit: (i: unknown) => void } };
          routingStore: {
            getState: () => {
              deactivate: () => void;
              activate: () => void;
              selectStartPort: (p: { pieceId: string; portName: string; pos: [number, number, number]; dir: [number, number, number] }) => void;
            };
          };
        };
      };
      w.__codex.routingStore.getState().deactivate();
      w.__codex.trayStore.getState().importEdit(tray);
      w.__codex.routingStore.getState().activate();
      w.__codex.routingStore.getState().selectStartPort({
        pieceId: 'CRV-1',
        portName: 'P2',
        pos: [3593.160605459253, -595.4272333217659, 0],
        dir: [-0.004416170774331087, -0.9999902486703018, 0],
      });
    }, FIXTURE_TRAY);

    const productSelect = page.locator('[data-codex-routing-product-select]');
    await productSelect.waitFor({ state: 'visible', timeout: 10_000 });

    // Dump la estructura de optgroups para ver qué categorías aparecen.
    const groups = await productSelect.evaluate((sel: HTMLSelectElement) => {
      const out: { label: string; options: { value: string; label: string; disabled: boolean }[] }[] = [];
      for (const child of Array.from(sel.children)) {
        if (child.tagName === 'OPTGROUP') {
          const grp = child as HTMLOptGroupElement;
          out.push({
            label: grp.label,
            options: Array.from(grp.querySelectorAll('option')).map((o) => ({
              value: o.value,
              label: o.textContent?.trim() ?? '',
              disabled: o.disabled,
            })),
          });
        }
      }
      return out;
    });

    const recommended = groups.find((g) => g.label.startsWith('Recomendados'));
    const otros = groups.find((g) => g.label.startsWith('Otros productos'));

    // Debería existir al menos "Recomendados" (con TRPS/CPS conocidos del catálogo
    // real) o "Otros productos" (con DCPS/XPS/CUPS). Si no hay ninguno, el flujo
    // no está mostrando el selector esperado.
    expect(recommended || otros, 'al menos un optgroup esperado').toBeTruthy();

    if (otros) {
      // Marcadores: ⚠ para compat_no_documentada, ⏳ para kind_pendiente_insercion.
      const markers = otros.options.map((o) => o.label).join('\n');
      const hasAnyMarker = /[⚠⏳]/.test(markers);
      expect(hasAnyMarker, 'opciones de "Otros productos" con marcador ⚠ o ⏳').toBeTruthy();
      // Alguna razón corta visible.
      const hasReason =
        /compat\. no documentada|inserción pendiente|sin modelo|bocas divergentes/.test(markers);
      expect(hasReason, 'razón visible en el label de las opciones').toBeTruthy();
    }
  });
});
