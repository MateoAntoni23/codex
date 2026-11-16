/**
 * E2E — Biblioteca de conductores, parte B: los declarados en el cálculo.
 *
 * Preparación (una vez, en serie): en la biblioteca se declara un 5 × 6 mm² SIN diámetro;
 * Excel de ejemplo; TD-EX, TAB-A y S1-TS1 ubicados y enlazados a un trazado (recto → curva
 * → recto 2000); CX-0001 (6 × 1×150, 1×35, 1×95: catálogo) y CX-0005 (CB-010, 5×6:
 * ningún cable del catálogo) trazados. Por la última pieza pasan los dos: bandeja mixta.
 *
 *   1. B1: CB-010 casa con el declarado y se ve que es declarado.
 *   2. B4 y B5: sin diámetro, la bandeja no tiene ocupación calculable y se dice cuál
 *      falta; el tendido sale de «sin cable de catálogo» y se lista como declarado.
 *   3. B2 y B3, con los controles negativos: completado el diámetro (en la biblioteca, en
 *      otra pestaña), la app calcula la ocupación de la bandeja mixta y dice por qué; se
 *      calcula con el motor real: ningún declarado viaja y la ocupación del motor de esa
 *      pieza no se muestra como la que vale.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elegirPieza } from './helpers/selectorPieza';
import { abrirFormulario, verPestana } from './helpers/interfaz';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const EXCEL = resolve(HERE, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const URL_CONDUCTORES = '/?configurator=v1&seccion=conductores';
const DESIGNACION = 'Operador 5 × 6 Cu (parte B)';

type V3 = [number, number, number];
type Codex = {
  __codex: {
    trayStore: { getState: () => { status: string; result: Record<string, unknown> | null; entrada: { piezas: Array<{ instancia_id: string }> }; context: { productos: unknown[] } | null } };
    workspaceStore: { getState: () => { placeImportedEquipo: (id: string, p: { x: number; y: number; z: number }) => string | null } };
  };
};
const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const conexion = (page: Page, id: string) => page.locator(`[data-testid="conexion-fila"][data-conexion="${id}"]`);
const foto = (page: Page, nombre: string) => page.screenshot({ path: resolve(OUT_DIR, `conductores-calculo-${nombre}.png`) });

async function importarExcel(page: Page, archivo: string) {
  await page.getByTestId('stage-tab-equipos').click();
  await page.getByTestId('open-import-wizard').click();
  await page.locator('.import-wizard input[type="file"]').setInputFiles(archivo);
  await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 30_000 });
  await page.locator('.import-wizard-footer button.primary').click();
  await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 15_000 });
  await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();
}

async function continuar(page: Page, extremo: RegExp, productoId: string, opts: { side?: 'left' | 'right'; length?: number } = {}) {
  const antes = (await piezas(page)).length;
  await page.getByTestId('free-end').filter({ hasText: extremo }).first().click();
  await elegirPieza(page, productoId);
  if (opts.side) await page.locator(`[data-codex-routing-hand="${opts.side}"]`).click();
  if (opts.length) await page.locator('[data-codex-routing-length-input]').fill(String(opts.length));
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(antes + 1);
}

async function enlazar(page: Page, equipoId: string, tronco: string, desde: 'P1' | 'P2', distancia: number, lado: 'izquierda' | 'derecha') {
  await abrirFormulario(page, 'enlace');
  const form = page.getByTestId('baj-form');
  await form.getByTestId('baj-equipo').selectOption(equipoId);
  await form.getByTestId('baj-tronco').selectOption(tronco);
  await form.getByTestId('baj-desde').selectOption(desde);
  await form.getByTestId('baj-distancia').fill(String(distancia));
  await form.getByTestId('baj-lado').selectOption(lado);
  await form.getByTestId('baj-crear').click();
  await expect(page.getByTestId('baj-msg')).toContainText('creado');
}

test.describe.configure({ mode: 'serial' });

test.describe('Biblioteca de conductores — parte B: los declarados en el cálculo', () => {
  test.setTimeout(300_000);
  let ctx: BrowserContext;
  let page: Page;
  let ids: string[] = [];
  let opId = '';

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    page = await ctx.newPage();
    // Un 5 × 6 declarado por el operador, sin diámetro exterior.
    await page.goto(URL_CONDUCTORES);
    await expect(page.getByTestId('conductores-root')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('conductores-nuevo').click();
    const f = page.getByTestId('conductor-form');
    await f.getByTestId('cf-designacion').fill(DESIGNACION);
    await f.getByTestId('cf-n').fill('5');
    await f.getByTestId('cf-seccion').fill('6');
    await f.getByTestId('cf-masa').fill('520');
    await page.getByTestId('cf-guardar').click();
    opId = (await page.getByTestId('conductor-ficha').getAttribute('data-cable-id'))!;
    expect(opId).toMatch(/^OP-/);

    await page.goto('/?etapa=equipos');
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => ((window as unknown as Codex).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0, undefined, { timeout: 30_000 });
    await importarExcel(page, EXCEL);
    const POS: Record<string, V3> = { 'EQ-0011': [300, 1500, 1200], 'EQ-0009': [2600, 2800, 500], 'EQ-0003': [1800, 3400, 500] };
    for (const [id, p] of Object.entries(POS)) {
      await page.evaluate(([id, p]) => (window as unknown as Codex).__codex.workspaceStore.getState().placeImportedEquipo(id as string, { x: (p as V3)[0], y: (p as V3)[1], z: (p as V3)[2] }), [id, p] as const);
    }
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continuar(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'left' });
    await continuar(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    ids = (await piezas(page)).map((p) => p.instancia_id);
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, 'EQ-0011', ids[0], 'P1', 200, 'izquierda');
    await enlazar(page, 'EQ-0009', ids[2], 'P2', 300, 'derecha');
    await enlazar(page, 'EQ-0003', ids[2], 'P2', 900, 'derecha');
    for (const id of ['CX-0001', 'CX-0005']) {
      await conexion(page, id).getByTestId('conexion-trazar').click();
      await expect(conexion(page, id)).toHaveAttribute('data-estado', 'trazada');
    }
  });
  test.afterAll(async () => { await ctx.close(); });

  test('1. B1: el tendido 5 × 6 casa con el declarado, y se ve que es declarado', async () => {
    await conexion(page, 'CX-0005').getByTestId('conexion-tendidos').locator('summary').click();
    const t = page.locator('[data-testid="tendido-fila"][data-tendido="CB-010"]');
    await expect(t).toHaveAttribute('data-origen', 'operador');
    await expect(t).toHaveAttribute('data-cable', opId);
    await expect(t).toHaveAttribute('data-procedencia', 'unico-candidato');
    await expect(t.getByTestId('tendido-cable')).toHaveText(DESIGNACION);
    await expect(t.getByTestId('tendido-declarado')).toContainText('declarado por el operador');
    await expect(t.getByTestId('tendido-declarado-nota')).toContainText('no viaja al motor; la ocupación de sus bandejas la calcula la app');
    await expect(t.getByTestId('tendido-declarado-falta')).toContainText('Le falta el diámetro exterior');
    await expect(t.getByTestId('tendido-sin-cable')).toHaveCount(0);
    // Los de CX-0001 siguen con su cable del catálogo.
    await conexion(page, 'CX-0001').getByTestId('conexion-tendidos').locator('summary').click();
    await expect(page.locator('[data-testid="tendido-fila"][data-tendido="CB-001"]')).toHaveAttribute('data-origen', 'catalogo');
    await t.scrollIntoViewIfNeeded();
    await foto(page, '01-tendido-declarado');
  });

  test('2. B4 y B5: sin diámetro, la bandeja no tiene ocupación calculable y se dice cuál falta; el tendido se lista como declarado', async () => {
    await verPestana(page, 'circuitos');
    await expect(page.getByTestId('tendidos-potencia-sin-cable')).toHaveCount(0);
    const decl = page.locator('[data-testid="tendido-potencia-declarado"][data-tendido="CB-010"]');
    await expect(decl).toHaveAttribute('data-declarado', opId);
    await expect(decl).toContainText('sin diámetro exterior: sus bandejas quedan sin ocupación calculable');
    await expect(page.getByTestId('tendidos-potencia-declarados')).toContainText('1 tendido(s) de potencia con cable declarado por el operador: no viajan al motor');
    await expect(page.locator('[data-testid="circuito-tendido"][data-tendido="CB-010"]')).toHaveAttribute('data-declarado', opId);

    await verPestana(page, 'motor');
    const fila = page.locator(`[data-testid="con-declarados-row"][data-pieza="${ids[2]}"]`);
    const o = fila.getByTestId('declarados-ocupacion');
    await expect(o).toHaveAttribute('data-origen', 'app');
    await expect(o).toHaveAttribute('data-calculada', 'false');
    await expect(o.getByTestId('declarados-no-calculable')).toHaveAttribute('data-faltan', opId);
    await expect(o.getByTestId('declarados-no-calculable')).toContainText(`Sin ocupación calculable: el cable declarado ${DESIGNACION} (${opId}) no tiene diámetro exterior`);
    await expect(o.getByTestId('declarados-porque')).toContainText(DESIGNACION);
    await fila.scrollIntoViewIfNeeded();
    await foto(page, '02-sin-diametro');
  });

  test('3. B2 y B3: con el diámetro, la app calcula la bandeja mixta y dice por qué; al motor no viaja ningún declarado y su ocupación de esa pieza no vale', async () => {
    // El operador completa el diámetro en la biblioteca, en otra pestaña.
    const bib = await ctx.newPage();
    await bib.goto(URL_CONDUCTORES);
    await expect(bib.getByTestId('conductores-root')).toBeVisible({ timeout: 30_000 });
    await bib.getByTestId('conductores-buscar').fill('parte B');
    await bib.locator(`[data-testid="conductor-fila"][data-cable-id="${opId}"]`).click();
    await bib.getByTestId('conductor-editar').click();
    await bib.getByTestId('cf-diametro').fill('17,5');
    await bib.getByTestId('cf-guardar').click();
    await expect(bib.getByTestId('conductor-ficha').getByTestId('conductor-diametro')).toHaveText('17,5 mm');
    await bib.close();

    await verPestana(page, 'motor');
    const fila = page.locator(`[data-testid="con-declarados-row"][data-pieza="${ids[2]}"]`);
    const o = fila.getByTestId('declarados-ocupacion');
    await expect(o).toHaveAttribute('data-calculada', 'true', { timeout: 10_000 });
    await expect(o).toHaveAttribute('data-declarados', opId);
    await expect(o.getByTestId('declarados-porque')).toContainText('Bandeja mixta (catálogo del motor + declarados): manda el cálculo de la app');
    await expect(o.getByTestId('declarados-porque')).toContainText(`${DESIGNACION} (${opId})`);
    const grupo = o.getByTestId('declarados-grupo');
    await expect(grupo).toContainText(`CB-010`);
    await expect(grupo).toContainText('declarado por el operador): 1 × Ø 17.5');
    await expect(page.getByTestId('con-declarados-procedencia')).toContainText('Cálculo de la app, no del motor');

    // Calcular con el motor real.
    await page.getByTestId('stage-tab-resultados').click();
    await page.getByTestId('reserva-input').fill('20');
    await page.getByTestId('calculate-tray').click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().status), { timeout: 60_000 }).toBe('vigente');
    const res = (await page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().result))!;
    // Control negativo: ningún declarado viajó.
    expect(JSON.stringify(res.entrada)).not.toContain(opId);
    expect(JSON.stringify(res.entrada)).not.toMatch(/"OP-/);
    const enviados = (res.entrada as { circuitos: Array<{ circuito_id: string }> }).circuitos.map((c) => c.circuito_id);
    expect(enviados).not.toContain('CIR-CX-0005-CB-010');
    expect(enviados).toContain('CIR-CX-0001-CB-001');

    // Control negativo: la ocupación del motor de la pieza con declarado no aparece como la que vale.
    await verPestana(page, 'motor');
    const pieza = page.locator(`[data-testid="calculo-motor"] [data-testid="motor-pieza"][data-pieza="${ids[2]}"]`);
    await expect(pieza.getByTestId('motor-ocupacion-reemplazada')).toHaveAttribute('data-motivo', 'declarados');
    await expect(pieza.getByTestId('motor-ocupacion')).toHaveCount(0);
    await expect(pieza.getByTestId('declarados-ocupacion')).toHaveAttribute('data-origen', 'app');
    // Una pieza por la que no pasa ningún declarado sigue con la del motor.
    const otra = page.locator(`[data-testid="calculo-motor"] [data-testid="motor-pieza"][data-pieza="${ids[0]}"]`);
    if (await page.locator(`[data-testid="con-declarados-row"][data-pieza="${ids[0]}"]`).count() === 0) {
      await expect(otra.getByTestId('motor-ocupacion').first()).toBeVisible();
      await expect(otra.getByTestId('motor-ocupacion-reemplazada')).toHaveCount(0);
    }
    // El tendido figura entre lo que no viaja, con el motivo.
    await verPestana(page, 'circuitos');
    const no = page.locator('[data-testid="circuito-no-motor"][data-circuito="CIR-CX-0005-CB-010"]');
    await expect(no).toHaveAttribute('data-declarado', opId);
    await expect(no.getByTestId('circuito-no-motor-motivo')).toContainText('Lleva un cable declarado por el operador: no viaja al motor');
    await verPestana(page, 'motor');
    await pieza.scrollIntoViewIfNeeded();
    await foto(page, '03-mixta-app');
  });
});
