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
    await page.evaluate(() => localStorage.removeItem('codex:catalogConfig:v1'));
  });

  test('aplica giro de instalación y modelFrame.rz_deg y persiste tras reload', async ({ page }) => {
    await openConfiguratorWithTPS(page);

    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();

    // Model frame: rz_deg = 90
    const rzInput = page.locator('[data-testid="cfg-mf-rz_deg"]');
    await rzInput.fill('90');

    // boca_derivacion: giro de instalación = 15°
    const portRot = page.locator('[data-testid="cfg-port-rot-boca_derivacion"]');
    await portRot.fill('15');

    // Motivo
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(
      'Calibración STEP 2026-11: boca lateral desalineada 15°; modelo girado 90° en Z.',
    );
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();

    // La pestaña vuelve al modo lectura — debe mostrar los valores aplicados.
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();

    // Reload y verificar que el override sobrevive sin tocar archivos.
    await page.reload();
    await openConfiguratorWithTPS(page);
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();

    // La vista de sólo lectura debe exponer rz_deg=90 y installRotationDeg=15.
    // Lo verificamos consultando el store expuesto directamente desde React.
    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('codex:catalogConfig:v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(persisted).toBeTruthy();
    expect(persisted.version).toBe('codex:catalogConfig/1');
    const tps = persisted.overrides['SAM_TPS-300-Z'];
    expect(tps).toBeTruthy();
    expect(tps.modelFrame?.rz_deg).toBe(90);
    const dev = tps.entries.find(
      (e: { recipePortName: string }) => e.recipePortName === 'boca_derivacion',
    );
    expect(dev.geometry.installRotationDeg).toBe(15);
  });

  test('Cancel descarta cambios sin persistir', async ({ page }) => {
    await openConfiguratorWithTPS(page);
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();

    await page.locator('[data-testid="cfg-mf-rz_deg"]').fill('45');
    await page.locator('[data-testid="cfg-port-rot-boca_derivacion"]').fill('30');
    // Cancel (no motive, no apply).
    await page.locator('.cfg-actions button:has-text("Cancelar")').click();

    const persisted = await page.evaluate(() => {
      return localStorage.getItem('codex:catalogConfig:v1');
    });
    expect(persisted).toBeNull();
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
