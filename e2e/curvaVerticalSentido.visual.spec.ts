/**
 * E2E — sentido de la curva vertical (cierra la limitación de masterModels:
 * "falta el escenario de cadena H → CUPS-D → V-descendente").
 *
 * Con gestos reales: tramo horizontal → curva vertical → tramo vertical.
 *   - Perforada: CUPS-300-A-Z (sube) y CUPS-300-D-Z (baja).
 *   - Escalera: CUS-300-5-065-18-Z eligiendo "Sube" y "Baja".
 * Verifica que las dos uniones cumplen (A-7 + B-3) y que el tramo siguiente
 * arranca en la dirección correcta (+Z al subir, −Z al bajar). Control
 * negativo: una A que bajara o una D que subiera hacen fallar la prueba.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');
type V3 = [number, number, number];
type PiezaJs = { instancia_id: string; producto_id: string; puertos: Record<string, { posicion_mm: V3; direccion: V3 }> };

async function openBandejas(page: Page): Promise<void> {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] } } } } }).__codex.trayStore.getState().entrada.piezas);

async function continueFrom(page: Page, freeEnd: RegExp, productoId: string, opts: { entryPort?: string; length?: number; sentido?: 'sube' | 'baja' } = {}) {
  const before = (await piezas(page)).length;
  await page.getByTestId('free-end').filter({ hasText: freeEnd }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  if (opts.sentido) {
    // CUS: sin elegir no hay previa ni confirmación.
    await expect(page.locator('[data-codex-routing-vertical-choice]')).toContainText('Elegí si la curva sube o baja');
    await page.locator(`[data-codex-routing-vertical="${opts.sentido}"]`).click();
  }
  if (opts.entryPort) await page.locator(`[data-codex-routing-entry-port="${opts.entryPort}"]`).click();
  if (opts.length) await page.locator('[data-codex-routing-length-input]').fill(String(opts.length));
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('E2E sentido de curva vertical');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

/** Bocas de la curva: CUPS (perfil medido) P1_horizontal/P2_vertical; CUS (eslabonada) P1/P2. */
async function cadena(page: Page, recto: string, curva: string, curvaSku: RegExp, sentido?: 'sube' | 'baja', bocas: [string, string] = ['P1_horizontal', 'P2_vertical']) {
  await openBandejas(page);
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(recto);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await piezas(page)).length).toBe(1);
  await continueFrom(page, /^↗ 1\. .* · Boca x_max/, curva, { entryPort: bocas[0], ...(sentido ? { sentido } : {}) });
  await continueFrom(page, curvaSku, recto, { length: 1000 });
  const ps = await piezas(page);
  const curvaP2 = ps[1].puertos[bocas[1]];
  const vertical = ps[2];
  await page.getByTestId('tool-bandejas-seleccionar').click();
  const filas = page.getByTestId('join-row');
  await expect(filas).toHaveCount(2);
  const oks = await filas.evaluateAll((els) => els.map((e) => e.getAttribute('data-join-ok')));
  expect(oks, 'las dos uniones cumplen').toEqual(['true', 'true']);
  return { curvaNormalZ: curvaP2.direccion[2], dz: vertical.puertos.P2.posicion_mm[2] - vertical.puertos.P1.posicion_mm[2] };
}

test.describe('Sentido de la curva vertical', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('perforada CUPS-A: horizontal → curva → vertical que SUBE', async ({ page }) => {
    const r = await cadena(page, 'SAM_TRPS-300-22-Z', 'SAM_CUPS-300-A-Z', /^↗ 2\. CUPS-300-A-Z · Boca vertical/);
    expect(r.curvaNormalZ, 'la boca vertical de la A mira hacia arriba').toBeCloseTo(1, 6);
    expect(r.dz, 'el tramo siguiente sube').toBeCloseTo(1000, 3);
    await page.screenshot({ path: resolve(OUT_DIR, 'curva-vertical-A-sube.png') });
  });

  test('perforada CUPS-D: horizontal → curva → vertical que BAJA', async ({ page }) => {
    const r = await cadena(page, 'SAM_TRPS-300-22-Z', 'SAM_CUPS-300-D-Z', /^↗ 2\. CUPS-300-D-Z · Boca vertical/);
    expect(r.curvaNormalZ, 'la boca vertical de la D mira hacia abajo').toBeCloseTo(-1, 6);
    expect(r.dz, 'el tramo siguiente baja').toBeCloseTo(-1000, 3);
    await page.screenshot({ path: resolve(OUT_DIR, 'curva-vertical-D-baja.png') });
  });

  test('escalera CUS eligiendo "Sube": horizontal → curva → vertical que sube', async ({ page }) => {
    const r = await cadena(page, 'SAM_TRES-300-065-18-Z', 'SAM_CUS-300-5-065-18-Z', /^↗ 2\. CUS-300-5-065-18-Z · Boca de salida/, 'sube', ['P1', 'P2']);
    expect(r.curvaNormalZ).toBeCloseTo(1, 6);
    expect(r.dz).toBeCloseTo(1000, 3);
  });

  test('escalera CUS eligiendo "Baja": horizontal → curva → vertical que baja', async ({ page }) => {
    const r = await cadena(page, 'SAM_TRES-300-065-18-Z', 'SAM_CUS-300-5-065-18-Z', /^↗ 2\. CUS-300-5-065-18-Z · Boca de salida/, 'baja', ['P1', 'P2']);
    expect(r.curvaNormalZ).toBeCloseTo(-1, 6);
    expect(r.dz).toBeCloseTo(-1000, 3);
  });
});
