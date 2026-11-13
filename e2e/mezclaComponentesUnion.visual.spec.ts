/**
 * E2E — componentes de unión de las mezclas de acabados (agregados por la app),
 * con gestos reales y el motor real.
 *
 * 1. Unión perforada ZN → Z: el motor la da "no compatible" y no calcula sus
 *    componentes; el cómputo trae JB-CC-M6 marcado como agregado por la app, con
 *    su procedencia, separado de las líneas del motor.
 * 2. Un proyecto sin mezclas (Z → Z) no tiene ninguna línea agregada.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');
const PROCEDENCIA = 'unión entre acabados distintos, componentes tomados de la unión del mismo acabado; declarado por el operador';

const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length);

async function tramoYContinuacion(page: Page, tronco: string, siguiente: string) {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(tronco);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(() => piezas(page)).toBe(1);
  await page.getByTestId('tool-bandejas-seleccionar').click();
  await page.getByTestId('free-end').filter({ hasText: /Boca x_max/ }).first().click();
  await page.locator('[data-codex-routing-product-select]').selectOption(siguiente);
  await page.locator('[data-codex-routing-length-input]').fill('1000');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(() => piezas(page)).toBe(2);
}

async function calcular(page: Page) {
  await page.getByTestId('stage-tab-resultados').click();
  await page.getByTestId('reserva-input').fill('20');
  await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
  await page.getByTestId('calculate-tray').click();
  await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
}

const lineasMotor = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { result: { computo: { lineas: Array<{ producto_id: string | null; estado_cantidad: string; origen: Record<string, unknown> }> } } } } } })
    .__codex.trayStore.getState().result.computo.lineas);

test.describe('Componentes de unión de las mezclas', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('perforada ZN → Z: el cómputo trae JB-CC-M6 agregado por la app, separado de lo que calculó el motor', async ({ page }) => {
    await tramoYContinuacion(page, 'SAM_TRPS-100-22-ZN', 'SAM_TRPS-100-22-Z');
    await calcular(page);
    // El motor no calcula componentes de esa unión (y su resultado no se toca).
    const motor = await lineasMotor(page);
    expect(motor.some((l) => typeof l.origen?.conexion === 'string' && l.producto_id === null && l.estado_cantidad === 'bloqueada')).toBe(true);
    expect(motor.some((l) => l.producto_id === 'SAM_JB-CC-M6')).toBe(false);
    // La app la completa, marcada.
    const app = page.getByTestId('computo-linea-app');
    await expect(app).toHaveCount(1);
    await expect(app).toHaveAttribute('data-producto', 'SAM_JB-CC-M6');
    await expect(app).toContainText('[AGREGADA POR LA APP]');
    await expect(app).toContainText('JB-CC-M6: 2 juego');
    await expect(app.getByTestId('computo-linea-app-procedencia')).toHaveText(PROCEDENCIA);
    await expect(page.getByTestId('computo-sin-componentes')).toHaveCount(0);
    await page.screenshot({ path: resolve(OUT_DIR, 'mezcla-componentes-01.png') });
  });

  test('un proyecto sin mezclas no tiene ninguna línea agregada', async ({ page }) => {
    await tramoYContinuacion(page, 'SAM_TRPS-100-22-Z', 'SAM_TRPS-100-22-Z');
    await calcular(page);
    await expect(page.getByTestId('computo-linea-app')).toHaveCount(0);
    await expect(page.getByTestId('computo-app')).toHaveCount(0);
  });
});
