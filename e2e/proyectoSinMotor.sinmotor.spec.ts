/**
 * E2E A1 — Con el servicio Python APAGADO la aplicación sigue siendo útil.
 *
 * Corre en el proyecto Playwright "sin-motor": una instancia de Vite cuyo proxy
 * `/api/motor` apunta a un puerto sin servicio (ver playwright.config.ts), de modo
 * que desde la aplicación el motor está realmente apagado (conexión rechazada).
 *
 * Verifica, con clicks reales:
 *   1. `/` abre el espacio de trabajo con un proyecto VACÍO (sin equipos ni piezas).
 *   2. El estado del servicio de cálculo es "apagado" (informativo, no bloqueante).
 *   3. La lista de productos está disponible (catálogo estático).
 *   4. Se puede crear un tramo recto.
 *   5. Se puede guardar copia (fileVersion 2) y el archivo contiene el tramo.
 *   6. Calcular informa que el motor está apagado y no rompe nada.
 *   7. Con el proyecto vacío también se puede guardar copia.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'output');

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene), undefined, { timeout: 20_000 });
}

async function state(page: Page) {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { entrada: { piezas: unknown[]; conexiones: unknown[] } | null; context: { productos: unknown[] } | null } };
        workspaceStore: { getState: () => { elements: unknown[] } };
      };
    };
    const t = w.__codex.trayStore.getState();
    return {
      piezas: t.entrada?.piezas.length ?? -1,
      equipos: w.__codex.workspaceStore.getState().elements.length,
      productos: t.context?.productos.length ?? 0,
    };
  });
}

test.describe('A1 — servicio Python apagado', () => {
  test.setTimeout(90_000);

  test('abrir / muestra proyecto vacío, hay productos, se crea un tramo y se guarda copia', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    // Prueba de que el motor está de verdad apagado: el proxy no responde ok.
    const salud = await page.request.get('/api/motor/v1/salud');
    expect(salud.ok(), 'el proxy al motor NO debe responder').toBe(false);

    await open(page);

    // 1) Proyecto vacío.
    expect(await state(page)).toMatchObject({ piezas: 0, equipos: 0 });
    await expect(page.getByTestId('tray-empty')).toBeVisible();

    // 2) Estado del servicio de cálculo: apagado (informativo).
    await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'apagado', { timeout: 15_000 });

    // 3) Lista de productos disponible (catálogo estático, sin motor).
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } };
        return (w.__codex?.trayStore?.getState().context?.productos.length ?? 0) > 800;
      },
      undefined,
      { timeout: 15_000 },
    );

    // 4) Crear un tramo recto con los clicks del formulario.
    await page.getByRole('button', { name: '+ Agregar tramo recto' }).click();
    const options = await page.getByTestId('add-product-select').locator('option').count();
    expect(options, 'productos rectos ofrecidos por el formulario').toBeGreaterThan(5);
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await state(page)).piezas).toBe(1);

    // 5) Guardar copia (sin motor): descarga un fileVersion 2 con el tramo.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('project-save-copy').click(),
    ]);
    const path = resolve(OUT_DIR, `sin-motor-${Date.now()}.json`);
    await download.saveAs(path);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file.fileVersion).toBe(2);
    expect(file.trayInput.piezas).toHaveLength(1);
    expect(file.projectV2.elements).toEqual([]);

    // 6) Calcular: informa que el servicio está apagado y no rompe la aplicación.
    await page.getByRole('button', { name: 'Calcular trazado' }).click();
    await expect(page.locator('.workspace-error')).toContainText(/apagado/i, { timeout: 15_000 });
    expect((await state(page)).piezas).toBe(1);

    // El autoguardado local también funciona sin motor.
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
  });

  test('guardar copia con el proyecto vacío', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await open(page);
    expect(await state(page)).toMatchObject({ piezas: 0, equipos: 0 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('project-save-copy').click(),
    ]);
    const path = resolve(OUT_DIR, `sin-motor-vacio-${Date.now()}.json`);
    await download.saveAs(path);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file.fileVersion).toBe(2);
    expect(file.trayInput.piezas).toEqual([]);
    expect(file.trayInput.pe).toMatchObject({ cable_id: '', conductores: [] });
    expect('library' in file).toBe(false);
  });
});
