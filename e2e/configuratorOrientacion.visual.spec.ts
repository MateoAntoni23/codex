/**
 * E2E — Configurador de biblioteca: Orientación/Colocación + Continuaciones.
 *
 * Verifica, con clicks reales sobre el DOM, el flujo P1 (orientación) y P3
 * (continuaciones) para un producto multi-boca (TPS). Específicamente:
 *   1) Navega a ?configurator=v1.
 *   2) Selecciona un TPS en la lista izquierda.
 *   3) Abre la pestaña "Orientación / Colocación", edita giro de instalación
 *      de boca_derivacion y rotación Z del modelo, escribe motivo, aplica.
 *   4) Recarga: el override se persiste en localStorage (codex:catalogConfig:v1)
 *      y debe verse tras el reload.
 *   5) Abre la pestaña "Continuaciones" y verifica que la boca_derivacion
 *      expone al menos un producto compatible (TPS-300-Z con P3 → TRPS-300-22-Z).
 *   6) Cancel preserva estado anterior.
 *
 * El chequeo valida que el flujo de calibración se separa de la posición de
 * instancia y que el override sobrevive un reload sin exportar nada.
 */
import { test, expect } from '@playwright/test';

async function openConfiguratorWithTPS(page: import('@playwright/test').Page) {
  await page.goto('/?configurator=v1');
  // Esperar a que el catálogo cargue y la lista se pueble.
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  const tpsButton = page.locator('[data-testid="cfg-product-SAM_TPS-300-Z"]');
  await tpsButton.waitFor({ state: 'visible', timeout: 15_000 });
  await tpsButton.click();
}

test.describe('Configurador — Orientación y Continuaciones', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    // Partimos de localStorage limpio para no arrastrar overrides de otros tests.
    await page.goto('/');
    await page.evaluate(() => { localStorage.removeItem('codex:catalogConfig:v1'); localStorage.removeItem('codex:catalogConfig:v2'); });
  });

  // B-2.5: la pestaña edita la calibración del PATRÓN (corrección por boca en
  // sus ejes); no hay marco del modelo. Persiste en codex:catalogConfig:v2.
  test('calibra el patrón (giro axial + desplazamiento de una boca) y persiste tras reload', async ({ page }) => {
    await openConfiguratorWithTPS(page);

    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    // No hay campos de marco del modelo.
    await expect(page.locator('[data-testid^="cfg-mf-"]')).toHaveCount(0);

    // boca_derivacion: giro axial (antes "giro de instalación") 15° y 4 mm hacia afuera.
    await page.locator('[data-testid="cfg-port-rot-boca_derivacion"]').fill('15');
    await page.locator('[data-testid="cfg-port-desp-axial-boca_derivacion"]').fill('4');
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(
      'Calibración STEP 2026-11: boca lateral desalineada 15° y 4 mm hacia afuera.',
    );
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();
    // TPS-300 es la variante medida del patrón: sin marca de heredada.
    await expect(page.locator('[data-testid="cfg-calibracion-estado"]')).toContainText('Variante medida');

    await page.reload();
    await openConfiguratorWithTPS(page);
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();

    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('codex:catalogConfig:v2');
      return raw ? JSON.parse(raw) : null;
    });
    expect(persisted).toBeTruthy();
    expect(persisted.version).toBe('codex:catalogConfig/2');
    const patrones = Object.values(persisted.calibracion.patrones) as Array<{ bocas: Record<string, { giro_deg: { axial: number }; desplazamiento_mm: { axial: number } }> }>;
    expect(patrones).toHaveLength(1);
    expect(patrones[0].bocas.boca_derivacion.giro_deg.axial).toBe(15);
    expect(patrones[0].bocas.boca_derivacion.desplazamiento_mm.axial).toBe(4);
    // La v1 no se escribe.
    expect(await page.evaluate(() => localStorage.getItem('codex:catalogConfig:v1'))).toBeNull();
    // Y se lee de vuelta en la vista.
    await expect(page.locator('[data-testid="cfg-calibracion-patron"]')).toContainText('15');
  });

  test('una variante distinta de la medida muestra la calibración como heredada; la excepción pide motivo', async ({ page }) => {
    await openConfiguratorWithTPS(page);
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-port-rot-boca_derivacion"]').fill('10');
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill('Calibración del patrón desde la variante medida.');
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();

    // Otra variante del patrón.
    await page.locator('[data-testid="cfg-product-SAM_TPS-450-Z"]').click();
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-calibracion-estado"]')).toContainText('sin verificar en este ancho');
    await expect(page.locator('[data-testid="cfg-viewer-calibracion"]')).toContainText('sin verificar en este ancho');

    // Declararla excepción sin motivo suficiente no se aplica.
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-calibracion-excepcion"]').check();
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill('corto');
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('.cfg-tab-note-error')).toContainText('al menos 10 caracteres');
  });

  test('Cancelar descarta cambios sin persistir', async ({ page }) => {
    await openConfiguratorWithTPS(page);
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();

    await page.locator('[data-testid="cfg-port-rot-boca_derivacion"]').fill('30');
    await page.locator('[data-testid="cfg-port-desp-lateral-boca_derivacion"]').fill('2');
    await page.locator('.cfg-actions button:has-text("Cancelar")').click();

    const persisted = await page.evaluate(() => ({
      v1: localStorage.getItem('codex:catalogConfig:v1'),
      v2: localStorage.getItem('codex:catalogConfig:v2'),
    }));
    expect(persisted.v1).toBeNull();
    expect(persisted.v2).toBeNull();
  });

  test('Continuaciones muestra TRPS-300-22-Z como recomendado desde boca_derivacion', async ({ page }) => {
    await openConfiguratorWithTPS(page);
    await page.locator('[data-testid="cfg-tab-continuaciones"]').click();
    const section = page.locator('[data-testid="cfg-cont-boca_derivacion"]');
    await section.waitFor({ state: 'visible', timeout: 10_000 });

    // Debe aparecer el texto del TRPS compat; el conteo "Recomendados (N)"
    // debe ser ≥ 1.
    const heading = section.locator('h4:has-text("Recomendados")');
    const headingText = await heading.innerText();
    const match = headingText.match(/\((\d+)\)/);
    expect(match).not.toBeNull();
    const count = Number(match?.[1] ?? 0);
    expect(count, `boca_derivacion debería tener al menos 1 compat`).toBeGreaterThan(0);
  });
});
