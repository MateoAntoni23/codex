/**
 * E2E m1c — traducción de bocas para accesorios de varias bocas (C1, C2, C4).
 *
 * Gestos reales: herramienta "Tramo nuevo", lista de extremos libres, selector de
 * producto del panel de continuación y "Confirmar continuación". `window.__codex`
 * sólo se usa para leer estado.
 */
import { test, expect, type Page } from '@playwright/test';

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
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ producto_id: string }> } } } } }).__codex.trayStore.getState().entrada.piezas.map((p) => p.producto_id));

async function newStraight(page: Page, productoId: string): Promise<void> {
  await page.getByTestId('tool-bandejas-tramo').click();
  // El formulario arranca filtrado a productos con modelo; se elige el producto por su valor.
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(() => piezas(page)).toContain(productoId);
}

async function continueFrom(page: Page, freeEndText: RegExp, productoId: string): Promise<void> {
  const before = (await piezas(page)).length;
  await page.getByTestId('free-end').filter({ hasText: freeEndText }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('E2E m1c');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

/** Opciones del selector de continuación: texto por valor. */
async function options(page: Page): Promise<Record<string, string>> {
  return page.locator('[data-codex-routing-product-select]').evaluate((el) =>
    Object.fromEntries(Array.from((el as HTMLSelectElement).options).filter((o) => o.value).map((o) => [o.value, o.textContent ?? ''])));
}

test.describe('m1c — bocas de accesorios', () => {
  test.setTimeout(120_000);

  test('C1 — CUPS-300-D-Z por su boca vertical ofrece TRPS-300-22-Z como compatible documentado', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-300-22-Z');
    await continueFrom(page, /Boca x_max/, 'SAM_CUPS-300-D-Z');

    // Elegir la boca vertical libre de la CUPS (nombre físico del maestro).
    await page.getByTestId('free-end').filter({ hasText: /CUPS-300-D-Z · Boca vertical/ }).click();
    await expect(page.locator('[data-codex-routing-product-select]')).toBeVisible();
    await expect(page.getByTestId('routing-uncalibrated')).toHaveCount(0);
    const opts = await options(page);
    expect(opts['SAM_TRPS-300-22-Z'], 'TRPS-300-22-Z ofrecido').toBeDefined();
    expect(opts['SAM_TRPS-300-22-Z'].startsWith('◆'), `documentado, no excepción: «${opts['SAM_TRPS-300-22-Z']}»`).toBe(true);
    expect(opts['SAM_TRPS-300-22-Z']).not.toMatch(/compat\. no documentada/);
    // No se inventa accesorio ↔ accesorio: una curva vertical sigue siendo excepción.
    for (const [id, text] of Object.entries(opts)) {
      if (/^SAM_CUPS-/.test(id)) expect(text.startsWith('⚠'), `${id} debe seguir como excepción: «${text}»`).toBe(true);
    }
    await expect(page.locator('label', { hasText: /Continuación \(\d+ compatibles?\)/ })).toBeVisible();
  });

  test('C2 — T perforada de 450 con acabado ZB, por un tronco libre, ofrece su recto documentado', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-450-20-ZB');
    // La T entra por su derivación (boca por defecto); quedan libres los dos troncos.
    await continueFrom(page, /Boca x_max/, 'SAM_TPS-450-ZB');
    await page.getByTestId('free-end').filter({ hasText: /TPS-450-ZB · Tronco \(salida\)/ }).click();
    await expect(page.locator('[data-codex-routing-product-select]')).toBeVisible();
    await expect(page.getByTestId('routing-uncalibrated')).toHaveCount(0);
    const opts = await options(page);
    expect(opts['SAM_TRPS-450-20-ZB']?.startsWith('◆'), `«${opts['SAM_TRPS-450-20-ZB']}»`).toBe(true);
  });

  // Hasta la derivación en un tramo, la DCPS era el ejemplo de producto "sin calibración de
  // bocas" (su maestro declaraba 3 bocas y el catálogo publica sólo P1). La DCPS lateral
  // medida declara exactamente esa boca: hoy no queda ningún producto sin calibrar
  // (portMappingAudit.test.ts). Continuar con una DCPS la une por su única boca — la unión
  // directa documentada DCPS-P1 ↔ TRPS-P1 —, sin aviso y sin bocas de tronco sueltas.
  test('C4 — la DCPS se une por su única boca (la documentada); no hay aviso de calibración', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-300-22-Z');
    await continueFrom(page, /Boca x_max/, 'SAM_DCPS-300-Z');
    await expect(page.getByTestId('routing-uncalibrated')).toHaveCount(0);
    await expect(page.getByTestId('free-end').filter({ hasText: /DCPS-300-Z/ })).toHaveCount(0);
    await expect(page.getByTestId('join-row')).toHaveAttribute('data-join-ok', 'true');
  });
});
