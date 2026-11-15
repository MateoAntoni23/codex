/**
 * E2E — interfaz, parte A (2026-11-14): cada cosa en su lugar. Pantalla del
 * operador: 1366×768, tema oscuro.
 *
 *   A0  Disposición: izquierda = lo que existe (listas, sin formularios); inspector =
 *       lo seleccionado y lo que se puede hacer; panel inferior = tablas anchas.
 *   A1  Acciones de la pieza seleccionada, con la pieza ya elegida.
 *   A2  Selector de pieza en tres pasos, código exacto, mezcla antes de confirmar,
 *       tipos que no se ofrecen con su motivo.
 *   A3  Lista de piezas agrupada por tipo, con cantidad, plegable y filtro.
 *   A4  Resultados en el panel inferior, con pestañas.
 *   A5  Conexiones cuenta los circuitos guardados; sin «Guardar longitudes…».
 * Capturas en e2e/output/interfaz-A-*.png.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elegirPieza } from './helpers/selectorPieza';
import { verPestana } from './helpers/interfaz';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const USER_REPORT = resolve(HERE, 'fixtures/user-report-20261107.workspace.json');

test.use({ viewport: { width: 1366, height: 768 } });

type Pz = { instancia_id: string; producto_id: string };
type W = { __codex: { trayStore: { getState: () => { entrada: { piezas: Pz[]; soportes: unknown[]; circuitos: unknown[] } } }; workspaceStore: { getState: () => { selectTray: (id: string) => void } }; routingStore: { getState: () => { active: boolean; startPort: { pieceId: string; portName: string } | null } } } };
const estado = (page: Page) => page.evaluate(() => {
  const t = (window as unknown as W).__codex.trayStore.getState().entrada;
  return { piezas: t.piezas, soportes: t.soportes.length, circuitos: t.circuitos.length };
});
const foto = (page: Page, nombre: string) => page.screenshot({ path: resolve(OUT_DIR, `interfaz-A-${nombre}.png`) });

async function abrir(page: Page, url = '/') {
  await page.goto(url);
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
}
async function abrirFixture(page: Page) {
  await abrir(page);
  await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
  await expect.poll(async () => (await estado(page)).piezas.length).toBe(7);
}
async function tramo(page: Page, productoId: string) {
  await page.getByTestId('stage-tab-bandejas').click();
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await estado(page)).piezas.length).toBe(1);
  return (await estado(page)).piezas[0];
}

test.describe('Interfaz — parte A', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('A0 + A3: izquierda sólo listas; formularios en el inspector; piezas agrupadas con cantidad, plegables y filtro', async ({ page }) => {
    await abrirFixture(page);
    await page.getByTestId('stage-tab-bandejas').click();
    const izquierda = page.locator('aside[aria-label="Lista de la etapa"]');
    const inspector = page.locator('aside[aria-label="Inspector"]');
    // A3: grupos con su cantidad; la suma es el total de piezas + soportes.
    const { piezas, soportes } = await estado(page);
    const grupos = izquierda.locator('[data-testid^="grupo-"]');
    const ns = await grupos.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-n'))));
    expect(ns.reduce((a, b) => a + b, 0)).toBe(piezas.length + soportes);
    await expect(izquierda.getByTestId('grupo-rectos')).toBeVisible();
    await expect(izquierda.getByTestId('grupo-soportes')).toHaveAttribute('data-n', String(soportes));
    // Plegar y desplegar un grupo.
    const rectos = izquierda.getByTestId('grupo-rectos');
    const filasRectos = await rectos.locator('[data-row-key^="piece:"]').count();
    expect(filasRectos).toBeGreaterThan(0);
    await rectos.locator('summary').click();
    await expect(rectos.locator('[data-row-key^="piece:"]')).toHaveCount(0);
    await rectos.locator('summary').click();
    await expect(rectos.locator('[data-row-key^="piece:"]')).toHaveCount(filasRectos);
    // Filtro de texto.
    await izquierda.getByTestId('piece-filter').fill('CS-300');
    const visibles = await izquierda.locator('[data-row-key^="piece:"]').allTextContents();
    expect(visibles.length).toBeGreaterThan(0);
    expect(visibles.every((t) => t.includes('CS-300'))).toBe(true);
    await izquierda.getByTestId('piece-filter').fill('');
    await foto(page, '1-bandejas');
    // A0: la herramienta abre su formulario en el inspector, no a la izquierda.
    await page.getByTestId('tool-bandejas-tramo').click();
    await expect(inspector.getByTestId('formulario-tramo')).toBeVisible();
    await expect(inspector.getByTestId('add-product-select')).toBeVisible();
    await expect(izquierda.getByTestId('add-product-select')).toHaveCount(0);
    await expect(izquierda.getByTestId('form-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inspector.getByTestId('formulario-tramo')).toHaveCount(0);
    // El PE no se elige a la izquierda: se informa.
    await expect(izquierda.getByTestId('pe-cable')).toHaveCount(0);
    await expect(izquierda.getByTestId('pe-info')).toContainText('PE'); // el fixture trae su propio PE
    // Equipos y Conexiones: los formularios también en el inspector.
    await page.getByTestId('stage-tab-equipos').click();
    await page.getByTestId('new-equipment').click();
    await expect(inspector.getByTestId('new-equipment-form')).toBeVisible();
    await expect(izquierda.getByTestId('new-equipment-form')).toHaveCount(0);
    await foto(page, '2-equipos-nuevo');
    await page.getByTestId('formulario-cerrar').click();
    await foto(page, '3-equipos');
    await page.getByTestId('stage-tab-planta').click();
    await foto(page, '4-planta');
    await page.getByTestId('stage-tab-conexiones').click();
    await expect(izquierda.getByTestId('baj-form')).toHaveCount(0);
    await expect(izquierda.getByTestId('circuito-equipos')).toHaveCount(0);
    await expect(inspector.getByTestId('acciones-etapa')).toBeVisible();
    await foto(page, '5-conexiones');
    await inspector.getByTestId('accion-enlace').click();
    await expect(inspector.getByTestId('baj-form')).toBeVisible();
  });

  test('A1: con una pieza seleccionada, el inspector ofrece lo que se puede hacer con ELLA, ya elegida', async ({ page }) => {
    await abrirFixture(page);
    await page.getByTestId('stage-tab-bandejas').click();
    const { piezas } = await estado(page);
    const recto = piezas.find((p) => p.producto_id.startsWith('SAM_TRES-'))!;
    await page.locator(`[data-row-key="piece:${recto.instancia_id}"]`).click();
    const acciones = page.getByTestId('acciones-pieza');
    await expect(acciones).toBeVisible();
    for (const id of ['accion-pieza-derivacion', 'tray-move-toggle', 'tray-rotate-toggle', 'accion-pieza-enlazar', 'accion-pieza-medir']) {
      await expect(acciones.getByTestId(id), id).toBeVisible();
    }
    await foto(page, '6-pieza-acciones');
    // Derivación desde el tramo, con el tramo ya elegido.
    await acciones.getByTestId('accion-pieza-derivacion').click();
    await expect(page.getByTestId('formulario-derivacion')).toBeVisible();
    await expect(page.getByTestId('der-tronco')).toHaveValue(recto.instancia_id);
    await page.getByTestId('formulario-cerrar').click();
    // Enlazar un equipo, con el tramo ya elegido.
    await page.locator(`[data-row-key="piece:${recto.instancia_id}"]`).click();
    await page.getByTestId('acciones-pieza').getByTestId('accion-pieza-enlazar').click();
    await expect(page.getByTestId('baj-tronco')).toHaveValue(recto.instancia_id);
    await page.getByTestId('formulario-cerrar').click();
    // Medir desde acá: el origen es una boca de esta pieza.
    await page.locator(`[data-row-key="piece:${recto.instancia_id}"]`).click();
    await page.getByTestId('acciones-pieza').getByTestId('accion-pieza-medir').click();
    expect((await page.getByTestId('recorrido-origen').inputValue()).startsWith(`${recto.instancia_id}\u0000`)).toBe(true);
    await page.getByTestId('formulario-cerrar').click();
    // Continuar desde un extremo libre de esta pieza (si lo tiene).
    const conLibre = piezas.find((p) => p.instancia_id !== recto.instancia_id && p.producto_id.startsWith('SAM_TRES-'));
    for (const p of [recto, conLibre].filter(Boolean) as Pz[]) {
      await page.locator(`[data-row-key="piece:${p.instancia_id}"]`).click();
      const cont = page.getByTestId('acciones-pieza').getByTestId('accion-pieza-continuar');
      if (await cont.count()) {
        const boca = await cont.first().getAttribute('data-boca');
        await cont.first().click();
        await expect.poll(() => page.evaluate(() => (window as unknown as W).__codex.routingStore.getState().startPort)).toMatchObject({ pieceId: p.instancia_id, portName: boca });
        break;
      }
    }
  });

  test('A2: tipo → ancho → variante; espesor y acabado del origen por defecto; mezcla en el selector; código exacto', async ({ page }) => {
    await abrir(page);
    const r = await tramo(page, 'SAM_TRPS-300-22-Z');
    await page.getByTestId('free-end').filter({ hasText: /Boca x_max/ }).first().click();
    await page.locator('[data-codex-routing-pieza-tipo]').selectOption('recta');
    await page.locator('[data-codex-routing-pieza-ancho]').selectOption('300');
    const variante = page.locator('[data-codex-routing-pieza-variante]');
    const opcionTrps = variante.locator('option', { hasText: /^TRPS/ });
    // Z, ZN y ZB son UNA entrada.
    expect((await opcionTrps.getAttribute('data-productos'))!.split(' ').sort()).toEqual(['SAM_TRPS-300-22-Z', 'SAM_TRPS-300-22-ZB', 'SAM_TRPS-300-22-ZN']);
    await variante.selectOption({ label: (await opcionTrps.textContent())! });
    // Por defecto, espesor y acabado del origen; el código que se computa, a la vista.
    await expect(page.locator('[data-codex-routing-pieza-espesor]')).toHaveValue('0.71');
    await expect(page.locator('[data-codex-routing-pieza-acabado]')).toHaveValue('Z');
    await expect(page.locator('[data-codex-routing-codigo]')).toHaveText('TRPS-300-22-Z');
    await expect(page.getByTestId('selector-pieza-mezcla')).toHaveCount(0);
    // Otro acabado: la marca de mezcla aparece EN EL SELECTOR, antes de confirmar.
    await page.locator('[data-codex-routing-pieza-acabado]').selectOption('ZN');
    await expect(page.locator('[data-codex-routing-codigo]')).toHaveText('TRPS-300-22-ZN');
    await expect(page.getByTestId('selector-pieza-mezcla')).toBeVisible();
    await expect(page.locator('[data-codex-routing-pieza-acabado] option:checked')).toContainText('mezcla de acabados');
    // Tipos que no se ofrecen: con su motivo.
    await expect(page.getByTestId('tipos-ausentes')).toBeVisible();
    for (const t of await page.getByTestId('tipo-ausente').allTextContents()) expect(t).toMatch(/: .+\.$/);
    await foto(page, '7-selector-mezcla');
    // Lo que se computa es el código exacto elegido.
    await page.locator('[data-codex-routing-length-input]').fill('1000');
    await page.locator('text=Confirmar continuación').click();
    await expect.poll(async () => (await estado(page)).piezas.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-Z', 'SAM_TRPS-300-22-ZN']);
    void r;
  });

  test('A2: desde la familia color, un tipo que sólo existe en otro acabado se ofrece marcado; nunca una lista vacía sin explicación', async ({ page }) => {
    await abrir(page);
    await tramo(page, 'SAM_TRPS-300-22-ZN');
    await page.getByTestId('free-end').filter({ hasText: /Boca x_max/ }).first().click();
    const tipo = page.locator('[data-codex-routing-pieza-tipo]');
    await expect(tipo.locator('option', { hasText: /^Curva vertical/ }).first()).toContainText('sólo en otro acabado (mezcla)');
    await expect(tipo.locator('option', { hasText: /^Recto$/ })).toHaveCount(1);
    // Por defecto, el acabado del origen (ZN).
    await elegirPieza(page, 'SAM_TRPS-300-22-ZN');
    await expect(page.locator('[data-codex-routing-pieza-acabado]')).toHaveValue('ZN');
  });

  test('A4 + A5: Resultados en el panel inferior con pestañas; Conexiones cuenta los circuitos guardados; sin «Guardar longitudes…»', async ({ page }) => {
    await abrirFixture(page);
    // A5: el fixture trae 2 circuitos del motor y ningún circuito guardado entre equipos.
    expect((await estado(page)).circuitos).toBe(2);
    await expect(page.getByTestId('stage-status-conexiones')).toContainText('0 circuitos');
    await page.getByTestId('stage-tab-conexiones').click();
    await page.getByTestId('accion-medir').click();
    await expect(page.getByTestId('formulario-medir')).toBeVisible();
    await expect(page.getByTestId('longitudes-anteriores-aplicar')).toHaveCount(0);
    await expect(page.getByTestId('longitudes-anteriores')).toHaveCount(0);
    await page.getByTestId('formulario-cerrar').click();
    // A4: en Resultados, el panel inferior se abre; las tablas no están a la izquierda.
    await page.getByTestId('stage-tab-resultados').click();
    const panel = page.getByTestId('panel-inferior');
    await expect(panel).toHaveAttribute('data-abierto', 'true');
    const izquierda = page.locator('aside[aria-label="Lista de la etapa"]');
    await expect(izquierda.getByTestId('circuitos-tabla')).toHaveCount(0);
    await expect(izquierda.getByTestId('calculo-motor')).toHaveCount(0);
    await verPestana(page, 'circuitos');
    await expect(panel.getByTestId('circuitos-tabla')).toBeVisible();
    for (const id of ['computo', 'motor', 'avisos'] as const) {
      await verPestana(page, id);
      await expect(panel).toHaveAttribute('data-pestana', id);
    }
    await verPestana(page, 'avisos');
    await expect(panel.getByTestId('exceptions-list')).toBeVisible();
    await foto(page, '8-resultados-avisos');
    // Plegar y desplegar.
    await page.getByTestId('panel-inferior-toggle').click();
    await expect(panel).toHaveAttribute('data-abierto', 'false');
    await page.getByTestId('pestana-circuitos').click();
    await expect(panel).toHaveAttribute('data-abierto', 'true');
    await foto(page, '9-resultados-circuitos');
  });
});
