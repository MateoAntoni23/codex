/**
 * E2E — Conexiones importadas, etapa 3: contrastar lo trazado contra la ingeniería.
 *
 * Preparación (una vez, en serie): el Excel de ejemplo con DOS cambios declarados acá, para
 * tener un aviso de corriente y un dato faltante entre lo que se traza (el ejemplo no los
 * trae ahí): CB-001 con Iz 300 A (diseño de CX-0001: 317,3 A) y CX-0005 sin longitud de
 * ingeniería. TD-EX, TAB-A y S1-TS1 ubicados y enlazados a un trazado con gestos cuyo último
 * recto mide 7000 mm, para que CX-0001 (10 m de ingeniería) quede más larga. Se trazan
 * CX-0001 y CX-0005.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { elegirPieza } from './helpers/selectorPieza';
import { abrirFormulario, verPestana } from './helpers/interfaz';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const EXCEL = resolve(HERE, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const EXCEL_E3 = resolve(OUT_DIR, 'contraste-ingenieria.xlsx');

type V3 = [number, number, number];
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string }>; circuitos_ws?: Array<{ id: string; sumaMm: number }> }; context: { productos: unknown[] } | null } };
    workspaceStore: { getState: () => { placeImportedEquipo: (id: string, p: { x: number; y: number; z: number }) => string | null; selectEquip: (id: string) => void } };
  };
};
const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const sumaMm = (page: Page, id: string) => page.evaluate((id) => (window as unknown as Codex).__codex.trayStore.getState().entrada.circuitos_ws!.find((c) => c.id === id)!.sumaMm, id);
const conexion = (page: Page, id: string) => page.locator(`[data-testid="conexion-fila"][data-conexion="${id}"]`);
const filaContraste = (page: Page, tipo: string, conexionId: string, tendido = '') =>
  page.locator(`[data-testid="contraste-fila"][data-tipo="${tipo}"][data-conexion="${conexionId}"][data-tendido="${tendido}"]`);
const n2 = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

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

async function armarExcel() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);
  const cambiar = (hoja: string, clave: string, id: string, campo: string, valor: number | null) => {
    const ws = wb.getWorksheet(hoja)!;
    const col = (n: string) => { let i = 0; ws.getRow(1).eachCell((c, k) => { if (String(c.value) === n) i = k; }); if (!i) throw new Error(`${hoja}: falta ${n}`); return i; };
    for (let r = 2; r <= ws.rowCount; r++) if (String(ws.getRow(r).getCell(col(clave)).value ?? '') === id) ws.getRow(r).getCell(col(campo)).value = valor;
  };
  cambiar('TENDIDOS', 'tendido_id', 'CB-001', 'ref_ing_iz_a', 300);
  cambiar('CONEXIONES', 'conexion_id', 'CX-0005', 'ref_ing_longitud_m', null);
  await wb.xlsx.writeFile(EXCEL_E3);
}

test.describe.configure({ mode: 'serial' });

test.describe('Conexiones importadas — etapa 3: contraste con la ingeniería', () => {
  test.setTimeout(300_000);
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await armarExcel();
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?etapa=equipos');
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => ((window as unknown as Codex).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0, undefined, { timeout: 30_000 });
    await importarExcel(page, EXCEL_E3);
    const POS: Record<string, V3> = { 'EQ-0011': [300, 1500, 1200], 'EQ-0009': [2600, 7800, 500], 'EQ-0003': [1800, 3400, 500] };
    for (const [id, p] of Object.entries(POS)) {
      await page.evaluate(([id, p]) => (window as unknown as Codex).__codex.workspaceStore.getState().placeImportedEquipo(id as string, { x: (p as V3)[0], y: (p as V3)[1], z: (p as V3)[2] }), [id, p] as const);
    }
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continuar(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'left' });
    await continuar(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 7000 });
    const [r1, , r2] = await piezas(page);
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, 'EQ-0011', r1.instancia_id, 'P1', 200, 'izquierda');
    await enlazar(page, 'EQ-0009', r2.instancia_id, 'P2', 300, 'derecha');
    await enlazar(page, 'EQ-0003', r2.instancia_id, 'P1', 900, 'derecha');
    await page.getByTestId('formulario-cerrar').click();
    for (const id of ['CX-0001', 'CX-0005']) {
      await conexion(page, id).getByTestId('conexion-trazar').click();
      await expect(conexion(page, id)).toHaveAttribute('data-estado', 'trazada');
    }
  });
  test.afterAll(async () => { await page.close(); });

  test('1. longitud trazada mayor que la de ingeniería: el aviso dice que la caída de tensión se verificó con una longitud menor', async () => {
    const L = (await sumaMm(page, 'CIR-CX-0001')) / 1000;
    expect(L).toBeGreaterThan(10);
    // En la tarjeta de la conexión.
    const aviso = conexion(page, 'CX-0001').locator('[data-testid="conexion-contraste"][data-tipo="longitud"]');
    await expect(aviso).toContainText(`La longitud trazada (${n2(L)} m) es mayor que la de ingeniería (10,00 m): la caída de tensión del Excel se verificó con una longitud menor.`);
    await expect(aviso).toContainText('Excel, longitud de ingeniería de CX-0001 (PM 02/11 | Listado Secado 1)');
    // En Resultados, con los dos valores y su origen.
    await page.getByTestId('stage-tab-resultados').click();
    await verPestana(page, 'contraste');
    const f = filaContraste(page, 'longitud', 'CX-0001');
    await expect(f).toHaveAttribute('data-estado', 'aviso');
    await expect(f.getByTestId('contraste-ingenieria')).toHaveText('10 m');
    await expect(f.getByTestId('contraste-comparado')).toHaveText(`${L.toLocaleString('es-AR', { maximumFractionDigits: 2 })} m`);
    await expect(f.getByTestId('contraste-origen')).toContainText('Comparado: trazado: bandeja + bajadas.');
    // Es lo primero de la tabla.
    await expect(page.getByTestId('contraste-fila').first()).toHaveAttribute('data-tipo', 'longitud');
    await expect(page.getByTestId('pestana-contraste')).toContainText('⚠');
    await page.screenshot({ path: resolve(OUT_DIR, 'contraste-01-longitud.png') });
  });

  test('2. corriente de diseño contra la admisible del tendido, las dos importadas', async () => {
    const f = filaContraste(page, 'corriente', 'CX-0001', 'CB-001');
    await expect(f).toHaveAttribute('data-estado', 'aviso');
    await expect(f.getByTestId('contraste-ingenieria')).toHaveText('317,28 A');
    await expect(f.getByTestId('contraste-comparado')).toHaveText('300 A');
    await expect(f.getByTestId('contraste-origen')).toContainText('Ingeniería: Excel, corriente de diseño de CX-0001. Comparado: Excel, corriente admisible (Iz) del tendido CB-001.');
    // El neutro y el PE no aplican (se ven al pedir todo).
    await page.getByTestId('contraste-ver-todo').check();
    await expect(filaContraste(page, 'corriente', 'CX-0001', 'CB-003')).toHaveAttribute('data-estado', 'no-aplica');
    await expect(filaContraste(page, 'corriente', 'CX-0005', 'CB-010')).toHaveAttribute('data-estado', 'ok');
  });

  test('3. metraje: longitud trazada × cantidad contra el metraje de compra', async () => {
    const L = (await sumaMm(page, 'CIR-CX-0001')) / 1000;
    const f = filaContraste(page, 'metraje', 'CX-0001', 'CB-001');
    await expect(f).toHaveAttribute('data-estado', 'aviso');
    await expect(f.getByTestId('contraste-ingenieria')).toHaveText('33 m');
    await expect(f.getByTestId('contraste-texto')).toContainText(`El metraje trazado (${n2(L * 6)} m) supera el de compra (33,00 m) del tendido CB-001. El Excel declara 3 unidad(es) existente(s); no se descuentan.`);
    await expect(f.getByTestId('contraste-origen')).toContainText(`trazado: ${n2(L)} m × 6 (cantidad del Excel)`);
  });

  test('4. si falta un dato para comparar, se dice cuál; no se supone', async () => {
    const f = filaContraste(page, 'longitud', 'CX-0005');
    await expect(f).toHaveAttribute('data-estado', 'falta');
    await expect(f.getByTestId('contraste-ingenieria')).toHaveText('sin dato');
    await expect(f.getByTestId('contraste-texto')).toHaveText('No se compara: el Excel no trae la longitud de ingeniería (ref_ing_longitud_m) de CX-0005.');
  });

  test('5. la tabla «Contraste con ingeniería» se copia', async () => {
    await page.getByTestId('contraste-copiar').click();
    await expect(page.getByTestId('contraste-msg')).toContainText('Tabla copiada');
    const lineas = (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
    expect(lineas[0]).toBe('Circuito\tConexión\tTendido\tContraste\tEstado\tIngeniería\tUnidad\tOrigen ingeniería\tComparado\tUnidad\tOrigen comparado\tDetalle');
    expect(lineas[1]).toMatch(/^F-TAB-A\tCX-0001\t\tLongitud trazada vs\. longitud de ingeniería\taviso\t10\tm\tExcel, longitud de ingeniería de CX-0001 \(PM 02\/11 \| Listado Secado 1\)\t[\d,]+\tm\ttrazado: bandeja \+ bajadas\t/);
  });

  test('6. la ficha técnica del equipo, de los atributos importados, en el inspector del equipo, con estado y origen, sólo lectura', async () => {
    await page.getByTestId('stage-tab-equipos').click();
    await page.evaluate(() => (window as unknown as Codex).__codex.workspaceStore.getState().selectEquip('EQ-0009'));
    const ficha = page.getByTestId('ficha-tecnica');
    await expect(ficha).toBeVisible();
    await expect(ficha.getByTestId('ficha-atributo')).toHaveCount(11);
    const a = ficha.locator('[data-testid="ficha-atributo"][data-atributo="corriente_total_cargas_a"]');
    await expect(a).toHaveAttribute('data-estado', 'A_CONFIRMAR');
    await expect(a).toHaveAttribute('data-origen', 'CALCULADO');
    await expect(a.getByTestId('ficha-valor')).toHaveText('317,279 A');
    await expect(a).toContainText('CALCULADO');
    await expect(a).toContainText('A_CONFIRMAR');
    await expect(ficha.getByTestId('ficha-tecnica-procedencia')).toContainText('sólo lectura: es dato importado');
    // Sólo lectura: nada editable en la ficha.
    await expect(ficha.locator('input, select, textarea, button')).toHaveCount(0);
    await page.screenshot({ path: resolve(OUT_DIR, 'contraste-02-ficha.png') });
  });
});
