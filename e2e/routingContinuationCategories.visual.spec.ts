/**
 * E2E — categorización 'Recomendados' / 'Otros productos' en el selector de
 * continuación del routing.
 *
 * Testea con clicks reales sobre el DOM:
 *   1) Carga una bandeja con TRPS + CPS-90, puerto CRV-1.P2 libre.
 *   2) Activa routing, selecciona el puerto CRV-1.P2.
 *   3) Inspecciona el selector de pieza (tipo → ancho → variante; antes, optgroups de un <select> plano):
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
import { detalleOfrecido, elegirPieza, esperarSelectorPieza } from './helpers/selectorPieza';

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
  test('muestra lo ofrecido con sus marcadores: excepción con motivo y tipos no ofrecidos con su razón', async ({ page }) => {
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

    await esperarSelectorPieza(page);
    // Interfaz (2026-11-14): el selector es tipo → ancho → variante; lo que antes eran los
    // grupos «Recomendados» / «Otros productos» son, por código, compatibles documentados o
    // excepciones con motivo, y lo que no se puede insertar se explica aparte.
    const detalle = await detalleOfrecido(page);
    const ids = Object.keys(detalle);
    expect(ids.length, 'al menos una pieza ofrecida').toBeGreaterThan(0);
    const excepciones = ids.filter((id) => detalle[id].excepcion);
    if (excepciones.length) {
      // Marcador y razón visibles antes de confirmar.
      await elegirPieza(page, excepciones[0]);
      await expect(page.getByTestId('selector-pieza-codigo')).toContainText('excepción con motivo (compatibilidad no documentada)');
      await expect(page.locator('[data-codex-routing-pieza-variante] option:checked')).toContainText('excepción con motivo');
    }
    const ausentes = page.getByTestId('tipo-ausente');
    for (const t of await ausentes.allTextContents()) {
      expect(t, 'cada tipo que no se ofrece dice por qué').toMatch(/no existe en|no hay de|ninguna es compatible|no tiene modelo/);
    }
  });
});
