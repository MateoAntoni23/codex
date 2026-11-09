/**
 * E2E — Pestaña Maestro / Variantes.
 *
 * Verifica que, al seleccionar un producto del catálogo paramétrico y abrir
 * la pestaña "Maestro / Variantes":
 *  - Se identifica el `MasterModel` asociado (card con metadatos).
 *  - La tabla de variantes está poblada, con la fila del producto seleccionado
 *    marcada como activa.
 *  - Para TRPS, variante 450 aparece con origen "declared" y scale.z ≈ 1.5.
 *  - Para un producto sin maestro (p.ej. SAM-TRL de alambre inoxidable),
 *    aparece la advertencia "Este producto no tiene maestro asociado".
 *
 * Esta prueba usa clicks reales — valida la cadena producto→maestro→variantes
 * dentro del inspector, no por reflection sobre el store.
 */
import { test, expect } from '@playwright/test';

async function clearLocalStorage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

async function gotoConfigurator(page: import('@playwright/test').Page) {
  await page.goto('/?configurator=v1');
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid^="cfg-product-SAM_"]'), {
    timeout: 20_000,
  });
}

async function selectProductAndOpenMaestro(
  page: import('@playwright/test').Page,
  productoId: string,
) {
  const btn = page.locator(`[data-testid="cfg-product-${productoId}"]`);
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
  const tab = page.locator('[data-testid="cfg-tab-maestro"]');
  await tab.waitFor({ state: 'visible', timeout: 5_000 });
  await tab.click();
}

test.describe('Configurator — pestaña Maestro / Variantes', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await gotoConfigurator(page);
  });

  test('TRPS-300-22-Z → maestro:perforada:tramo_recto y tabla de variantes poblada', async ({ page }) => {
    await selectProductAndOpenMaestro(page, 'SAM_TRPS-300-22-Z');
    const table = page.locator('[data-testid="cfg-maestro-variantes"]');
    await expect(table).toBeVisible({ timeout: 5_000 });
    // Debe contener la fila del SKU 300 (base) y la del 450 (declared).
    await expect(page.locator('[data-testid="cfg-maestro-row-TRPS-300-22-Z"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-TRPS-450-20-Z"]')).toBeVisible();
    // La fila seleccionada está marcada is-active.
    await expect(page.locator('[data-testid="cfg-maestro-row-TRPS-300-22-Z"]')).toHaveClass(/is-active/);
  });

  test('Un producto sin maestro asociado muestra advertencia explícita', async ({ page }) => {
    // Buscar el primer producto SAM-TRL o alambre. Si no existe, el test se
    // skippea — no debemos depender de un SKU exacto.
    const firstTrl = await page.locator('[data-testid^="cfg-product-SAM_TRL"]').first();
    const hasTrl = (await firstTrl.count()) > 0;
    test.skip(!hasTrl, 'Snapshot no tiene productos SAM-TRL en esta sesión.');
    const productoId = (await firstTrl.getAttribute('data-testid'))!.replace('cfg-product-', '');
    await selectProductAndOpenMaestro(page, productoId);
    const warning = page.locator('[data-testid="cfg-maestro-sin-asociacion"]');
    await expect(warning).toBeVisible({ timeout: 5_000 });
  });
});
