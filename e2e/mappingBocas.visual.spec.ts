/**
 * E2E m1c — traducción de bocas para accesorios de varias bocas (C1, C2, C4).
 *
 * Gestos reales: herramienta "Tramo nuevo", lista de extremos libres, selector de
 * producto del panel de continuación y "Confirmar continuación". `window.__codex`
 * sólo se usa para leer estado.
 */
import { test, expect, type Page } from '@playwright/test';
import { detalleOfrecido, elegirPieza } from './helpers/selectorPieza';

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
  const select = page.locator('[data-codex-routing-pieza-tipo]');
  await expect(select).toBeVisible();
  await elegirPieza(page, productoId);
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('E2E m1c');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

/** Lo que ofrece el selector de continuación, por código (tipo, excepción, con modelo). */
const options = (page: Page) => detalleOfrecido(page);

test.describe('m1c — bocas de accesorios', () => {
  test.setTimeout(120_000);

  test('C1 — CUPS-300-D-Z por su boca vertical ofrece TRPS-300-22-Z como compatible documentado', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-300-22-Z');
    await continueFrom(page, /Boca x_max/, 'SAM_CUPS-300-D-Z');

    // Elegir la boca vertical libre de la CUPS (nombre físico del maestro).
    await page.getByTestId('free-end').filter({ hasText: /CUPS-300-D-Z · Boca vertical/ }).click();
    await expect(page.locator('[data-codex-routing-pieza-tipo]')).toBeVisible();
    await expect(page.getByTestId('routing-uncalibrated')).toHaveCount(0);
    const opts = await options(page);
    expect(opts['SAM_TRPS-300-22-Z'], 'TRPS-300-22-Z ofrecido').toBeDefined();
    expect(opts['SAM_TRPS-300-22-Z'].conModelo, `documentado y con modelo: ${JSON.stringify(opts['SAM_TRPS-300-22-Z'])}`).toBe(true);
    expect(opts['SAM_TRPS-300-22-Z'].excepcion, 'no es una excepción (compat. no documentada)').toBe(false);
    // Compatibilidad por la regla física: otra curva vertical de la misma familia, ancho y
    // ala es una unión directa (antes, sin fila en la tabla, se ofrecía como excepción ⚠).
    // Nada se ofrece con cartel de excepción.
    for (const [id, d] of Object.entries(opts)) {
      expect(d.excepcion, `${id} no debe ofrecerse como excepción`).toBe(false);
    }
    await expect(page.locator('label', { hasText: /Continuación \(\d+ compatibles?\)/ })).toBeVisible();
  });

  test('C2 — T perforada de 450 con acabado ZB, por un tronco libre, ofrece su recto documentado', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-450-20-ZB');
    // La T entra por su derivación (boca por defecto); quedan libres los dos troncos.
    await continueFrom(page, /Boca x_max/, 'SAM_TPS-450-ZB');
    await page.getByTestId('free-end').filter({ hasText: /TPS-450-ZB · Tronco \(salida\)/ }).click();
    await expect(page.locator('[data-codex-routing-pieza-tipo]')).toBeVisible();
    await expect(page.getByTestId('routing-uncalibrated')).toHaveCount(0);
    const opts = await options(page);
    expect(opts['SAM_TRPS-450-20-ZB']?.conModelo, JSON.stringify(opts['SAM_TRPS-450-20-ZB'])).toBe(true);
  });

  // Control negativo (derivación en un tramo): la DCPS no se ofrece como continuación de un
  // recorrido. Colocada así no tendría tronco anfitrión y se computaría una derivación que no
  // deriva de nada; se coloca sólo con la herramienta "Derivación en tramo". (Antes la DCPS era el
  // ejemplo de producto "sin calibración de bocas"; hoy no queda ninguno: portMappingAudit.test.ts.)
  test('C4 — la DCPS no se ofrece como continuación (sin tronco anfitrión sería una derivación huérfana)', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-300-22-Z');
    await page.getByTestId('free-end').filter({ hasText: /Boca x_max/ }).first().click();
    await expect(page.locator('[data-codex-routing-pieza-tipo]')).toBeVisible();
    const opts = await options(page);
    expect(Object.keys(opts).filter((id) => id.startsWith('SAM_DCPS-'))).toEqual([]);
    expect(opts['SAM_TRPS-300-22-Z'], 'el recto sí se ofrece').toBeDefined();
  });

  // Control negativo (compatibilidad por la regla física): continuando desde una CPS-300-45-Z
  // (perforada zincada) no se ofrece NINGUNA escalera — antes aparecía CS-300-45-065-14-G
  // (escalera galvanizada) como "compat. no documentada". Sólo perforada de 300 y ala 50.
  test('C5 — desde una CPS-300-45-Z no se ofrece escalera; sólo perforada del mismo ancho y ala', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-300-22-Z');
    await continueFrom(page, /Boca x_max/, 'SAM_CPS-300-45-Z');
    await page.getByTestId('free-end').filter({ hasText: /CPS-300-45-Z/ }).first().click();
    await expect(page.locator('[data-codex-routing-pieza-tipo]')).toBeVisible();
    const opts = await options(page);
    const ids = Object.keys(opts);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids, 'la escalera galvanizada del defecto no se ofrece').not.toContain('SAM_CS-300-45-065-14-G');
    expect(ids.filter((id) => /^SAM_(TRES|CS|TS|XS|CUS|RCS|RIS)-/.test(id)), 'ninguna escalera').toEqual([]);
    expect(Object.entries(opts).filter(([, d]) => d.excepcion).map(([id]) => id), 'nada con cartel de excepción').toEqual([]);
    expect(ids).toContain('SAM_TRPS-300-22-Z');
  });
});
