/**
 * E2E — alcance real de los paneles (defecto 2026-11-14). Pantalla del operador:
 * 1366×768.
 *
 * El defecto: el inspector no se desplazaba (`.stage-inspector { height: 100% }`
 * sin regla de overflow) y con una continuación de curva eslabonada «Confirmar
 * continuación» quedaba fuera de alcance. Las E2E pasaban igual porque Playwright
 * desplaza el contenedor por programa antes de cada clic.
 *
 * Acá nada se desplaza por programa: se mide qué ve la persona, se baja sólo con
 * la rueda del mouse y se hace clic con el mouse en coordenadas.
 *
 *   1. Inspector: cabecera (qué se está haciendo + Cancelar) y confirmar a la vista
 *      arriba y abajo; el medio se recorre con la rueda; la pieza se coloca.
 *   2. Control negativo dentro de la prueba: con la hoja de estilos del defecto
 *      (sin overflow en el medio) la misma medición falla.
 *   3. Panel izquierdo: con la lista de piezas desplegada, la rueda llega a la última fila.
 *   4. Barra de proyecto en una sola fila a 1366, con nombre de archivo y mensaje.
 *   5. Marcadores «Sin resolver»: etiqueta corta de una línea en la escena; el motivo
 *      se despliega sólo con la pieza seleccionada.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elegirPieza } from './helpers/selectorPieza';
import { medirAlcance, clicSinDesplazar, INSPECTOR_CONTINUACION, type AlcancePanel } from './helpers/interfaz';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const USER_REPORT = resolve(HERE, 'fixtures/user-report-20261107.workspace.json');

test.use({ viewport: { width: 1366, height: 768 } });

type Pz = { instancia_id: string };
const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Pz[] } } } } }).__codex.trayStore.getState().entrada.piezas);
const foto = (page: Page, nombre: string) => page.screenshot({ path: resolve(OUT_DIR, `interfaz-alcance-${nombre}.png`) });

async function abrir(page: Page, url = '/?etapa=bandejas') {
  await page.goto(url);
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
}

/** Tronco perforado 300 y continuación con curva eslabonada EPS que sube: el inspector más largo. */
async function continuacionEslabonada(page: Page) {
  await abrir(page);
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await piezas(page)).length).toBe(1);
  await page.getByTestId('tool-bandejas-seleccionar').click();
  await page.getByTestId('free-end').filter({ hasText: /^↗ 1\. .*Boca x_max/ }).first().click();
  await elegirPieza(page, 'SAM_EPS-300-Z');
  await page.locator('[data-codex-routing-entry-port="P1"]').click();
  await page.locator('[data-codex-routing-vertical="sube"]').click();
  await expect(page.locator(INSPECTOR_CONTINUACION.confirmar)).toHaveCount(1);
}

function esperarAlcanceCompleto(a: AlcancePanel) {
  expect(a.desborda, 'el contenido de la continuación no entra a 1366×768 (si entrara, la prueba no probaría nada)').toBe(true);
  expect(a.cabeceraVisible, 'cabecera a la vista sin desplazar').toBe(true);
  expect(a.confirmarVisible, 'Confirmar a la vista sin desplazar').toBe(true);
  expect(a.ruedaAlFinal, 'con la rueda se llega al final del medio').toBe(true);
  expect(a.cabeceraVisibleAbajo, 'cabecera a la vista abajo de todo').toBe(true);
  expect(a.confirmarVisibleAbajo, 'Confirmar a la vista abajo de todo').toBe(true);
}

test.describe('Interfaz — alcance real de los paneles (1366×768)', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('inspector: con una curva eslabonada, cabecera y Confirmar a la vista; el medio se recorre con la rueda; la pieza se coloca', async ({ page }) => {
    await continuacionEslabonada(page);
    const a = await medirAlcance(page, INSPECTOR_CONTINUACION);
    await foto(page, 'inspector-abajo');
    esperarAlcanceCompleto(a);
    // Colocar la pieza con un clic de mouse real, sin desplazamiento previo.
    await clicSinDesplazar(page, INSPECTOR_CONTINUACION.panel, INSPECTOR_CONTINUACION.confirmar);
    await expect.poll(async () => (await piezas(page)).length).toBe(2);
  });

  test('control negativo: con la hoja de estilos del defecto (sin overflow en el medio) la medición falla', async ({ page }) => {
    await continuacionEslabonada(page);
    // Lo que había antes del arreglo: el inspector a altura fija, sin regla de overflow en el medio.
    await page.addStyleTag({ content: '.stage-inspector-cuerpo { overflow: visible !important; }' });
    const a = await medirAlcance(page, INSPECTOR_CONTINUACION);
    await foto(page, 'control-negativo');
    expect(a.desborda).toBe(true);
    expect(a.ruedaAlFinal, 'sin overflow la rueda no puede llegar al final').toBe(false);
    expect(() => esperarAlcanceCompleto(a)).toThrow();
  });

  test('panel izquierdo: con la lista de piezas agrupada y desplegada, la rueda llega a la última fila', async ({ page }) => {
    await abrir(page, '/');
    await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
    await expect.poll(async () => (await piezas(page)).length).toBe(7);
    await page.getByTestId('stage-tab-bandejas').click();
    // Desplegar todos los grupos de piezas.
    const plegados = page.locator('[data-testid="piece-list"] details:not([open]) > summary');
    while (await plegados.count()) await plegados.first().click();
    const izq = '.unified-workspace-tree';
    const desborda = await page.locator(izq).evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(desborda, 'con todas las piezas desplegadas la lista no entra a 1366×768').toBe(true);
    await page.locator(izq).evaluate((el) => { el.scrollTop = 0; });
    const caja = (await page.locator(izq).boundingBox())!;
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    let alFinal = false;
    for (let i = 0; i < 40 && !alFinal; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(60);
      alFinal = await page.locator(izq).evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
    }
    expect(alFinal, 'con la rueda se llega al final de la lista').toBe(true);
    // El panel no se estira más allá de la ventana: su borde inferior queda a la vista.
    const r = (await page.locator(izq).boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual(768);
    await foto(page, 'izquierda-abajo');
  });
  test('barra de proyecto en una sola fila a 1366, con nombre de archivo y mensaje', async ({ page }) => {
    await abrir(page, '/');
    await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
    await expect.poll(async () => (await piezas(page)).length).toBe(7);
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
    const filas = await page.getByTestId('project-bar').evaluate((bar) => {
      const visibles = [...bar.querySelectorAll('button, a, .project-name, .project-save-status, .project-message')]
        .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      const centros = visibles.map((r) => Math.round(r.top + r.height / 2));
      const b = bar.getBoundingClientRect();
      return { min: Math.min(...centros), max: Math.max(...centros), alto: b.height, derecha: Math.max(...visibles.map((r) => r.right)), ancho: window.innerWidth };
    });
    expect(filas.max - filas.min, 'todo en la misma fila').toBeLessThanOrEqual(4);
    expect(filas.alto).toBeLessThanOrEqual(44);
    expect(filas.derecha, 'nada sale por la derecha').toBeLessThanOrEqual(filas.ancho);
    await expect(page.getByTestId('open-configurator')).toBeVisible();
    // Si el nombre se recorta con «…», la marca de cambios sin copia sigue entera a la vista.
    const sinCopia = page.locator('.project-bar .workspace-dirty');
    if (await sinCopia.count()) {
      await expect(sinCopia).toHaveText('● sin copia');
      const r = (await sinCopia.boundingBox())!;
      expect(r.x + r.width).toBeLessThanOrEqual(1366);
      expect(await sinCopia.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.locator('.project-bar').screenshot({ path: resolve(OUT_DIR, 'interfaz-alcance-barra.png') });
  });

  test('marcadores «Sin resolver»: una línea en la escena; el motivo sólo con la pieza seleccionada', async ({ page }) => {
    await abrir(page, '/');
    await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
    await expect.poll(async () => (await piezas(page)).length).toBe(7);
    const marcas = page.getByTestId('unresolved-marker');
    await expect.poll(() => marcas.count()).toBeGreaterThan(0);
    const n = await marcas.count();
    await page.getByTestId('stage-tab-bandejas').click();
    // Sin selección: ninguna lleva el motivo y cada una ocupa una sola línea.
    await expect(page.getByTestId('marker-motivo')).toHaveCount(0);
    for (let i = 0; i < n; i++) {
      const caja = (await marcas.nth(i).boundingBox())!;
      expect(caja.height, `marcador ${i}: una línea`).toBeLessThanOrEqual(18);
      expect(caja.width, `marcador ${i}: corto`).toBeLessThanOrEqual(110);
    }
    // Los marcadores quedan por debajo de los paneles (no tapan el inspector).
    const zMarca = await marcas.first().evaluate((el) => Number(getComputedStyle(el.parentElement!.parentElement!).zIndex) || 0);
    expect(zMarca).toBeLessThan(10);
    await foto(page, 'marcadores');
    // Al seleccionar una pieza sin resolver, su marcador muestra el motivo.
    const id = await page.evaluate(() =>
      (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string; colocacion?: { estado: string } }> } } } } })
        .__codex.trayStore.getState().entrada.piezas.find((p) => p.colocacion?.estado === 'sin_resolver')!.instancia_id);
    await page.locator(`[data-row-key="piece:${id}"]`).click();
    await expect(page.getByTestId('marker-motivo')).toHaveCount(1);
    await expect(page.locator('[data-testid="unresolved-marker"][data-desplegado="true"]')).toHaveCount(1);
  });
});
