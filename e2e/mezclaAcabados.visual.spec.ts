/**
 * E2E — mezcla de acabados (decisión del operador, 2026-11-13), con gestos reales.
 *
 * Se permite unir acabados distintos del mismo tipo de bandeja y el sistema lo
 * marca (aviso, no invalidez), con la procedencia "declarado por el operador,
 * contradice REV-032 (fuente del catálogo)". La señal es texto, no color.
 *
 * 1. Unión: tronco color TRPS-100-22-ZN → se continúa con un recto zincado
 *    TRPS-100-22-Z. La unión es válida (B-3) y está marcada en la fila de la
 *    unión, en la ficha de la pieza y en Resultados. El motor la da "no
 *    compatible" por REV-032; Resultados la lee como aviso, no como incumplimiento.
 * 2. Derivación: sobre un tronco color se ofrece y coloca la DCPS zincada (no se
 *    bloquea) y el enganche queda marcado en la derivación, la ficha y Resultados.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');
const PROCEDENCIA = 'declarado por el operador, contradice REV-032 (fuente del catálogo)';

type PiezaJs = { instancia_id: string; producto_id: string };
const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] } } } } }).__codex.trayStore.getState().entrada.piezas);

async function openBandejas(page: Page) {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
}

async function crearTronco(page: Page, productoId: string) {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await piezas(page)).length).toBe(1);
  return (await piezas(page))[0];
}

async function calcular(page: Page) {
  await page.getByTestId('stage-tab-resultados').click();
  await page.getByTestId('reserva-input').fill('20');
  await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
  await page.getByTestId('calculate-tray').click();
  await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
}

test.describe('Mezcla de acabados', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('unión color → zincada: válida y marcada en la unión, la ficha y Resultados (el motor no la vuelve incumplimiento)', async ({ page }) => {
    await openBandejas(page);
    const tronco = await crearTronco(page, 'SAM_TRPS-100-22-ZN');
    // Por el camino normal: la zincada del mismo ancho se ofrece desde la color.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.getByTestId('free-end').filter({ hasText: /Boca x_max/ }).first().click();
    const select = page.locator('[data-codex-routing-product-select]');
    await expect(select.locator('option[value="SAM_TRPS-100-22-Z"]')).toHaveCount(1);
    await select.selectOption('SAM_TRPS-100-22-Z');
    await page.locator('[data-codex-routing-length-input]').fill('1000');
    await page.locator('text=Confirmar continuación').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(2);

    // Unión: válida (B-3) y con la marca, que nombra los dos acabados y la procedencia.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    const fila = page.getByTestId('join-row');
    await expect(fila).toHaveCount(1);
    await expect(fila).toHaveAttribute('data-join-ok', 'true');
    await expect(fila).toHaveAttribute('data-join-mezcla', 'ZN|Z');
    const marca = fila.getByTestId('join-aviso-mezcla');
    await expect(marca).toContainText('MEZCLA DE ACABADOS');
    await expect(marca).toContainText('TRPS-100-22-ZN ZN (color negro) ↔ TRPS-100-22-Z Z (chapa pregalvanizada en origen)');
    await expect(marca).toContainText(PROCEDENCIA);

    // Ficha de la pieza.
    await page.locator(`[data-row-key="piece:${tronco.instancia_id}"]`).click();
    await expect(page.getByTestId('piece-aviso-mezcla')).toContainText('MEZCLA DE ACABADOS');
    await page.screenshot({ path: resolve(OUT_DIR, 'mezcla-01-union.png') });

    // Resultados: con el motor real. Lo marca la app y no queda como "conexiones no compatibles".
    await calcular(page);
    await expect(page.getByTestId('mezcla-row')).toHaveCount(1);
    await expect(page.getByTestId('mezcla-row-marca')).toContainText(PROCEDENCIA);
    await expect(page.getByTestId('result-mezcla-note')).toContainText('MEZCLA DE ACABADOS en 1 unión(es)');
    await expect(page.getByTestId('result-issues').filter({ hasText: 'conexiones no compatibles' })).toHaveCount(0);
    await expect(page.getByTestId('result-headline')).not.toHaveText('Con incumplimientos');
    // Se computan las dos piezas, cada una con su código.
    const computo = await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { result: { computo: { lineas: Array<{ producto_id: string | null }> } } } } } }).__codex.trayStore.getState().result.computo.lineas.map((l) => l.producto_id));
    expect(computo).toEqual(expect.arrayContaining(['SAM_TRPS-100-22-ZN', 'SAM_TRPS-100-22-Z']));
    await page.screenshot({ path: resolve(OUT_DIR, 'mezcla-02-resultados.png') });
  });

  test('derivación: DCPS zincada sobre tronco color se coloca y queda marcada', async ({ page }) => {
    await openBandejas(page);
    const tronco = await crearTronco(page, 'SAM_TRPS-300-22-ZN');
    await page.getByTestId('tool-bandejas-derivacion').click();
    await page.getByTestId('der-tronco').selectOption(tronco.instancia_id);
    await page.getByTestId('der-distancia').fill('1500');
    await page.getByTestId('der-ancho').selectOption('100');
    await page.getByTestId('der-crear').click();
    await expect(page.getByTestId('der-msg')).toContainText('DCPS-100-Z colocada');
    await expect(page.getByTestId('der-advertencia').filter({ hasText: 'mezcla de acabados' })).toContainText(PROCEDENCIA);
    expect((await piezas(page)).map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-ZN', 'SAM_DCPS-100-Z']);

    await page.getByTestId('tool-bandejas-seleccionar').click();
    const marca = page.getByTestId('enganche-aviso-mezcla');
    await expect(marca).toHaveAttribute('data-mezcla', 'ZN|Z');
    await expect(marca).toContainText('TRPS-300-22-ZN ZN (color negro) ↔ DCPS-100-Z Z (chapa pregalvanizada en origen)');
    await expect(page.getByTestId('enganche-row')).toHaveAttribute('data-vigente', 'true');

    const dcps = (await piezas(page))[1].instancia_id;
    await page.locator(`[data-row-key="piece:${dcps}"]`).click();
    await expect(page.getByTestId('piece-mezcla')).toContainText('Derivación ENG-1');
    await expect(page.getByTestId('piece-aviso-mezcla')).toContainText('MEZCLA DE ACABADOS');

    await calcular(page);
    await expect(page.getByTestId('mezcla-row')).toHaveAttribute('data-mezcla-tipo', 'enganche');
    await page.screenshot({ path: resolve(OUT_DIR, 'mezcla-03-derivacion.png') });
  });
});
