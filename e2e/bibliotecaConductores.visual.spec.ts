/**
 * E2E — Biblioteca de conductores, parte A (encargo del 2026-11-15).
 *
 *   1. Un cable del catálogo del motor no se puede editar: solo lectura, con duplicar.
 *   2. Un declarado sin diámetro dice qué no se puede calcular; cargado, se encuentra
 *      después de recargar la página (localStorage es su autoridad).
 *   3. Duplicar uno del catálogo: nace declarado y dice de cuál salió.
 *   4. Con el Excel de ejemplo en el proyecto: la guía muestra exactamente las siete
 *      combinaciones sin cable, con cuántos tendidos destraba cada una; un declarado 5×6
 *      las cubre (7) y aparece con sus tendidos en la lista.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const EXCEL = resolve(HERE, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const URL_CONDUCTORES = '/?configurator=v1&seccion=conductores';

const foto = (page: Page, nombre: string) => page.screenshot({ path: resolve(OUT_DIR, `biblioteca-conductores-${nombre}.png`) });
const fila = (page: Page, id: string) => page.locator(`[data-testid="conductor-fila"][data-cable-id="${id}"]`);

async function abrirBiblioteca(page: Page) {
  await page.goto(URL_CONDUCTORES);
  await expect(page.getByTestId('conductores-root')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="conductor-fila"][data-origen="catalogo"]')).toHaveCount(113, { timeout: 30_000 });
}

async function cargarDeclarado(page: Page, d: { designacion: string; n: string; seccion: string; diametro: string; masa: string }) {
  await page.getByTestId('conductores-nuevo').click();
  const f = page.getByTestId('conductor-form');
  await f.getByTestId('cf-designacion').fill(d.designacion);
  await f.getByTestId('cf-n').fill(d.n);
  await f.getByTestId('cf-seccion').fill(d.seccion);
  await f.getByTestId('cf-diametro').fill(d.diametro);
  await f.getByTestId('cf-masa').fill(d.masa);
}

test.describe('Biblioteca de conductores — parte A', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('la pestaña está junto a la de modelos, y un cable del catálogo del motor no se puede editar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('open-conductores')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('open-configurator')).toBeVisible();
    await page.getByTestId('open-conductores').click();
    await expect(page.getByTestId('conductores-root')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('cfg-seccion-conductores')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="conductor-fila"][data-origen="catalogo"]')).toHaveCount(113, { timeout: 30_000 });
    // La de modelos sigue a un clic.
    await page.getByTestId('cfg-seccion-modelos').click();
    await expect(page.getByTestId('conductores-root')).toHaveCount(0);
    await page.getByTestId('cfg-seccion-conductores').click();

    // Filtros y buscador.
    await page.getByTestId('conductores-filtro-seccion').selectOption('10');
    await page.getByTestId('conductores-buscar').fill('4 × 10');
    await expect(fila(page, 'PRY-SVALIO-CU-4x10')).toBeVisible();
    await fila(page, 'PRY-SVALIO-CU-4x10').click();
    const ficha = page.getByTestId('conductor-ficha');
    await expect(ficha).toHaveAttribute('data-origen', 'catalogo');
    await expect(ficha.getByTestId('conductor-origen')).toHaveText('catálogo del motor');
    await expect(ficha.getByTestId('conductor-solo-lectura')).toContainText('Solo lectura');
    // Control: ni editar ni borrar, ni ningún campo editable.
    await expect(ficha.getByTestId('conductor-editar')).toHaveCount(0);
    await expect(ficha.getByTestId('conductor-borrar')).toHaveCount(0);
    await expect(ficha.locator('input, select, textarea')).toHaveCount(0);
    await foto(page, 'catalogo-solo-lectura');
  });

  test('un declarado sin diámetro dice qué no se puede calcular, y sigue ahí después de recargar', async ({ page }) => {
    await abrirBiblioteca(page);
    await cargarDeclarado(page, { designacion: 'Prueba 5 × 6 sin diámetro', n: '5', seccion: '6', diametro: '', masa: '520' });
    await expect(page.getByTestId('cf-no-calculable')).toContainText('sin diámetro exterior no hay ocupación de bandeja');
    await page.getByTestId('cf-guardar').click();
    const ficha = page.getByTestId('conductor-ficha');
    await expect(ficha).toHaveAttribute('data-origen', 'operador');
    const id = (await ficha.getAttribute('data-cable-id'))!;
    expect(id).toMatch(/^OP-/);
    await expect(ficha.getByTestId('conductor-no-calculable')).toContainText('sin diámetro exterior no hay ocupación de bandeja');
    await expect(ficha.getByTestId('conductor-no-calculable')).not.toContainText('masa');
    await expect(ficha.getByTestId('conductor-diametro')).toHaveText('no declarado');
    await foto(page, 'declarado-sin-diametro');

    await page.reload();
    await expect(page.getByTestId('conductores-root')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('conductores-buscar').fill('sin diámetro');
    await expect(fila(page, id)).toHaveAttribute('data-origen', 'operador');
    await fila(page, id).click();
    await expect(page.getByTestId('conductor-ficha').getByTestId('conductor-no-calculable')).toContainText('sin diámetro exterior');

    // Se edita: con el diámetro, ya no falta nada.
    await page.getByTestId('conductor-editar').click();
    await page.getByTestId('cf-diametro').fill('17,5');
    await page.getByTestId('cf-guardar').click();
    await expect(page.getByTestId('conductor-ficha').getByTestId('conductor-diametro')).toHaveText('17,5 mm');
    await expect(page.getByTestId('conductor-ficha').getByTestId('conductor-no-calculable')).toHaveCount(0);
  });

  test('duplicar un cable del catálogo: nace declarado por el operador y dice de cuál salió', async ({ page }) => {
    await abrirBiblioteca(page);
    await page.getByTestId('conductores-buscar').fill('4 × 10');
    await fila(page, 'PRY-SVALIO-CU-4x10').click();
    await page.getByTestId('conductor-duplicar').click();
    const ficha = page.getByTestId('conductor-ficha');
    await expect(ficha).toHaveAttribute('data-origen', 'operador');
    await expect(ficha.getByTestId('conductor-procedencia')).toContainText('Duplicado de PRY-SVALIO-CU-4x10');
    await expect(ficha.getByTestId('conductor-editar')).toBeVisible();
    // El original sigue intacto y de solo lectura.
    await fila(page, 'PRY-SVALIO-CU-4x10').click();
    await expect(page.getByTestId('conductor-ficha')).toHaveAttribute('data-origen', 'catalogo');
  });

  test('con el Excel de ejemplo: la guía muestra las siete combinaciones sin cable y cuántos tendidos destraba cada una', async ({ page }) => {
    await page.goto('/?etapa=equipos');
    await page.getByTestId('stage-bar').waitFor({ timeout: 30_000 });
    await page.getByTestId('open-import-wizard').click();
    await page.locator('.import-wizard input[type="file"]').setInputFiles(EXCEL);
    await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 30_000 });
    await page.locator('.import-wizard-footer button.primary').click();
    await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 15_000 });
    await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 15_000 });

    await abrirBiblioteca(page);
    await expect(page.getByTestId('conductores-proyecto')).toContainText('Tendidos del Excel del proyecto abierto');
    await page.getByTestId('conductores-guia-abrir').click();
    const combos = page.getByTestId('guia-combinacion');
    await expect(combos).toHaveCount(7);
    const leidas = Object.fromEntries(await combos.evaluateAll((els) => els.map((e) => [e.getAttribute('data-clave'), Number(e.getAttribute('data-n'))])));
    expect(leidas).toEqual({
      'CABLE_MULTIPOLAR|2|1': 87, 'CABLE_MULTIPOLAR|3|1': 23, 'CABLE_MULTIPOLAR|5|6': 7, 'CABLE_MULTIPOLAR|4|1': 4,
      'CABLE_MULTIPOLAR|27|1': 2, 'CABLE_MULTIPOLAR|5|10': 1, 'CABLE_MULTIPOLAR|7|1': 1,
    });
    await expect(page.getByTestId('guia-fuera')).toContainText('42 tendido(s): tubo');
    await foto(page, 'guia');

    // «Cargar uno» desde la combinación 5×6: la ficha llega con conductores y sección.
    await page.locator('[data-testid="guia-combinacion"][data-clave="CABLE_MULTIPOLAR|5|6"]').getByTestId('guia-cargar').click();
    await expect(page.getByTestId('cf-n')).toHaveValue('5');
    await expect(page.getByTestId('cf-seccion')).toHaveValue('6');
    await page.getByTestId('cf-designacion').fill('Sintenax 5 × 6 (operador)');
    await page.getByTestId('cf-diametro').fill('17,5');
    await page.getByTestId('cf-masa').fill('520');
    await page.getByTestId('cf-guardar').click();
    const id = (await page.getByTestId('conductor-ficha').getAttribute('data-cable-id'))!;
    await expect(page.locator('[data-testid="guia-combinacion"][data-clave="CABLE_MULTIPOLAR|5|6"]')).toHaveAttribute('data-cubierta', '7');
    await expect(page.locator('[data-testid="guia-combinacion"][data-clave="CABLE_MULTIPOLAR|5|10"]')).toHaveAttribute('data-cubierta', '0');
    await expect(fila(page, id)).toHaveAttribute('data-tendidos', '7');
    // Un cable del catálogo con tendidos: el conteo usa la misma regla.
    const conTendidos = await page.locator('[data-testid="conductor-fila"][data-origen="catalogo"]').evaluateAll(
      (els) => els.filter((e) => Number(e.getAttribute('data-tendidos')) > 0).length);
    expect(conTendidos).toBeGreaterThan(0);
    await foto(page, 'guia-cubierta');
  });
});
