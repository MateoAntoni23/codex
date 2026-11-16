/**
 * E2E — Conexiones importadas, etapa 1: las conexiones del Excel como lista de trabajo.
 *
 * Preparación (una vez, página compartida, en serie): el Excel de ejemplo por el
 * asistente de importación; TD-EX (EQ-0011) y TAB-A (EQ-0009) ubicados; un trazado de
 * bandeja entre ellos (recto → curva 90 → recto 2000) con gestos; un enlace a bandeja en
 * cada uno. Un punto del encargo por prueba.
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
const EXCEL_REV1 = resolve(OUT_DIR, 'conexiones-importadas-rev1.xlsx');

type V3 = [number, number, number];
type Pieza = { instancia_id: string };
type Conexion = { conexionId: string; servicio: string; origenEquipoId?: string; destinoEquipoId?: string; tensionV?: number };
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: Pieza[]; circuitos_ws?: Array<{ id: string; origen: { equipo: string }; destino: { equipo: string } }>; conexiones_ws?: unknown } } };
    workspaceStore: { getState: () => { importedCatalog: { conexiones: Conexion[] } | null; placeImportedEquipo: (id: string, p: { x: number; y: number; z: number }) => string | null; elements: Array<{ id: string; name: string }> } };
  };
};

const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const circuitos = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.circuitos_ws ?? []);
const conexionDelExcel = (page: Page, id: string) => page.evaluate((id) => (window as unknown as Codex).__codex.workspaceStore.getState().importedCatalog!.conexiones.find((c) => c.conexionId === id)!, id);

const fila = (page: Page, id: string) => page.locator(`[data-testid="conexion-fila"][data-conexion="${id}"]`);

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

/** Rev1 del Excel: CX-0001 pasa de 380 V a 400 V; CX-0010 (y su tendido) desaparece. */
async function armarRev1() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);
  const col = (ws: ExcelJS.Worksheet, nombre: string) => {
    let n = 0;
    ws.getRow(1).eachCell((c, i) => { if (String(c.value) === nombre) n = i; });
    if (!n) throw new Error(`${ws.name}: falta ${nombre}`);
    return n;
  };
  const conex = wb.getWorksheet('CONEXIONES')!;
  const tend = wb.getWorksheet('TENDIDOS')!;
  const idC = col(conex, 'conexion_id');
  const tension = col(conex, 'tension_v');
  for (let r = conex.rowCount; r >= 2; r--) {
    const id = String(conex.getRow(r).getCell(idC).value ?? '');
    if (id === 'CX-0001') conex.getRow(r).getCell(tension).value = 400;
    if (id === 'CX-0010') conex.spliceRows(r, 1);
  }
  const idT = col(tend, 'conexion_id');
  for (let r = tend.rowCount; r >= 2; r--) if (String(tend.getRow(r).getCell(idT).value ?? '') === 'CX-0010') tend.spliceRows(r, 1);
  await wb.xlsx.writeFile(EXCEL_REV1);
}

test.describe.configure({ mode: 'serial' });

test.describe('Conexiones importadas — etapa 1: lista de trabajo', () => {
  test.setTimeout(300_000);
  let page: Page;
  const POS: Record<string, V3> = { 'EQ-0011': [300, 1500, 1200], 'EQ-0009': [2600, 2800, 500] };

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await armarRev1();
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto('/?etapa=equipos');
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0, undefined, { timeout: 30_000 });
    await importarExcel(page, EXCEL);
    // Ubicar los dos equipos (la ubicación no es lo que se prueba acá).
    for (const [id, p] of Object.entries(POS)) {
      await page.evaluate(([id, p]) => (window as unknown as Codex).__codex.workspaceStore.getState().placeImportedEquipo(id as string, { x: (p as V3)[0], y: (p as V3)[1], z: (p as V3)[2] }), [id, p] as const);
    }
    // Trazado con gestos.
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continuar(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'left' });
    await continuar(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    const [r1, , r2] = await piezas(page);
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, 'EQ-0011', r1.instancia_id, 'P1', 200, 'izquierda');
    await enlazar(page, 'EQ-0009', r2.instancia_id, 'P2', 300, 'derecha');
    await page.getByTestId('formulario-cerrar').click();
  });
  test.afterAll(async () => { await page.close(); });

  test('1. la lista principal son las conexiones del Excel, agrupadas por servicio, con filtro y buscador', async () => {
    const lista = page.getByTestId('catalog-connections');
    await expect(lista).toContainText('Conexiones del Excel (272)');
    for (const [s, n] of [['POTENCIA', 104], ['CONTROL', 67], ['INSTRUMENTACION', 50], ['COMUNICACION', 7], ['EQUIPOTENCIALIDAD', 2], ['NEUMATICA', 42]] as const) {
      await expect(page.getByTestId(`conexiones-grupo-${s}`).locator(':scope > summary')).toHaveText(`${s} (${n})`);
    }
    // Es lo primero del panel.
    const primero = await page.getByTestId('panel-conexiones').evaluate((p) => p.querySelector('[data-testid]')?.getAttribute('data-testid'));
    expect(primero).toBe('catalog-connections');
    await page.getByTestId('conexiones-buscar').fill('F-TAB-A');
    await expect(page.getByTestId('conexion-fila')).toHaveCount(1);
    await expect(fila(page, 'CX-0001')).toBeVisible();
    await page.getByTestId('conexiones-buscar').fill('');
    await page.getByTestId('conexiones-filtro-servicio').selectOption('NEUMATICA');
    await expect(page.getByTestId('conexion-fila')).toHaveCount(42);
    await expect(page.getByTestId('conexiones-grupo-POTENCIA')).toHaveCount(0);
    await page.getByTestId('conexiones-filtro-servicio').selectOption('');
    await page.getByTestId('conexiones-filtro-estado').selectOption('sin-trazar');
    await expect(page.getByTestId('conexion-fila')).toHaveCount(1); // sólo TD-EX → TAB-A tiene los dos equipos enlazados
    await expect(fila(page, 'CX-0001')).toBeVisible();
    await page.getByTestId('conexiones-filtro-estado').selectOption('');
    await page.screenshot({ path: resolve(OUT_DIR, 'conexiones-importadas-01-lista.png') });
  });

  test('2. cada conexión muestra su estado con el motivo', async () => {
    await expect(fila(page, 'CX-0001')).toHaveAttribute('data-estado', 'sin-trazar');
    await expect(fila(page, 'CX-0001').getByTestId('conexion-origen')).toContainText('TD-EX (EQ-0011, Excel)');
    await expect(fila(page, 'CX-0010')).toHaveAttribute('data-estado', 'sin-resolver');
    await expect(fila(page, 'CX-0010').getByTestId('conexion-motivo')).toContainText('el Excel no trae el equipo de destino «Recorrido Secado (PB → piso 2)»');
    // Un equipo del Excel que no está en la escena.
    const otro = (await conexionDelExcel(page, 'CX-0040'));
    const lejano = otro.origenEquipoId === 'EQ-0009' ? otro.destinoEquipoId! : otro.origenEquipoId!;
    await expect(fila(page, 'CX-0040')).toHaveAttribute('data-estado', 'sin-ubicar');
    await expect(fila(page, 'CX-0040').getByTestId('conexion-motivo')).toContainText(`(${lejano} `);
    // Ubicado pero sin enlace a bandeja.
    await page.evaluate((id) => (window as unknown as Codex).__codex.workspaceStore.getState().placeImportedEquipo(id, { x: 6000, y: 0, z: 0 }), lejano);
    if (!(await page.getByTestId('panel-conexiones').count())) await page.getByTestId('stage-tab-conexiones').click();
    await expect(fila(page, 'CX-0040')).toHaveAttribute('data-estado', 'sin-enlace');
    await expect(fila(page, 'CX-0040').getByTestId('conexion-motivo')).toContainText('no tiene enlace con la bandeja');
    await expect(page.getByTestId('conexiones-filtro-estado').locator('option[value="sin-enlace"]')).toContainText('(');
  });

  test('3. control negativo y servicios: sin equipo resuelto no es trazable; tres servicios se listan sin trazar, con el motivo', async () => {
    await expect(fila(page, 'CX-0010')).toHaveAttribute('data-trazable', 'false');
    await expect(fila(page, 'CX-0010').getByTestId('conexion-trazar')).toHaveCount(0);
    for (const s of ['EQUIPOTENCIALIDAD', 'NEUMATICA']) {
      const filas = page.getByTestId(`conexiones-grupo-${s}`).getByTestId('conexion-fila');
      await expect(filas.first()).toHaveAttribute('data-estado', 'no-se-traza');
      await expect(filas.first().getByTestId('conexion-trazar')).toHaveCount(0);
    }
    await expect(page.getByTestId('conexiones-grupo-NEUMATICA').getByTestId('conexion-motivo').first()).toContainText('tubo de aire comprimido');
    await expect(page.getByTestId('conexiones-grupo-EQUIPOTENCIALIDAD').getByTestId('conexion-motivo').first()).toContainText('no es un circuito');
    // COMUNICACION sí se traza: su estado no es «no se traza».
    await expect(page.getByTestId('conexiones-grupo-COMUNICACION').locator('[data-estado="no-se-traza"]')).toHaveCount(0);
  });

  test('4. emparejar a mano: dato del operador, a la vista como tal; lo importado no cambia', async () => {
    const f = fila(page, 'CX-0010');
    await f.getByTestId('conexion-emparejar-destino').selectOption('EQ-0009');
    await expect(f.getByTestId('conexion-destino')).toHaveAttribute('data-fuente', 'operador');
    await expect(f.getByTestId('conexion-destino-manual')).toContainText('emparejado a mano por el operador, no es dato del Excel');
    await expect(f.getByTestId('conexion-destino')).not.toContainText(', Excel)'); // la marca de dato del Excel
    await expect(f).toHaveAttribute('data-estado', 'sin-trazar');
    // Control negativo: el Excel sigue sin destino.
    expect((await conexionDelExcel(page, 'CX-0010')).destinoEquipoId).toBeUndefined();
  });

  test('5. «Trazar» crea el circuito con origen y destino puestos, ligado a su conexión', async () => {
    await fila(page, 'CX-0001').getByTestId('conexion-trazar').click();
    await expect(page.getByTestId('conexiones-msg')).toContainText('Circuito CIR-CX-0001 trazado para CX-0001');
    await expect(fila(page, 'CX-0001')).toHaveAttribute('data-estado', 'trazada');
    await fila(page, 'CX-0010').getByTestId('conexion-trazar').click();
    await expect(fila(page, 'CX-0010')).toHaveAttribute('data-estado', 'trazada');
    const cs = await circuitos(page);
    expect(cs.map((c) => [c.id, c.origen.equipo, c.destino.equipo])).toEqual([
      ['CIR-CX-0001', 'EQ-0011', 'EQ-0009'],
      ['CIR-CX-0010', 'EQ-0011', 'EQ-0009'],
    ]);
    await verPestana(page, 'circuitos');
    const r = page.locator('[data-testid="circuito-fila"][data-excel="CX-0001"]');
    await expect(r.getByTestId('circuito-nombre')).toHaveText('F-TAB-A');
    await expect(r.getByTestId('circuito-excel')).toHaveText('Excel: CX-0001');
    await expect(r.getByTestId('circuito-origen-equipo')).toHaveText('TD-EX');
    await page.screenshot({ path: resolve(OUT_DIR, 'conexiones-importadas-02-trazada.png') });
  });

  test('6. un circuito que no está en el Excel se puede trazar y queda «fuera del Excel» en la lista y en Resultados', async () => {
    await abrirFormulario(page, 'circuito');
    await page.getByTestId('circuito-origen').selectOption('EQ-0011');
    await page.getByTestId('circuito-destino').selectOption('EQ-0009');
    await page.getByTestId('circuito-nombre-input').fill('Extra a mano');
    await page.getByTestId('circuito-guardar').click();
    await expect(page.getByTestId('circuito-guardado-msg')).toContainText('guardado');
    await page.getByTestId('formulario-cerrar').click();
    const enLista = page.locator('[data-testid="circuito-lista-fila"]', { hasText: 'Extra a mano' });
    await expect(enLista.getByTestId('circuito-fuera-excel')).toContainText('fuera del Excel');
    await verPestana(page, 'circuitos');
    const r = page.locator('[data-testid="circuito-fila"]', { hasText: 'Extra a mano' });
    await expect(r.getByTestId('circuito-excel')).toHaveText('fuera del Excel');
    // No liga ninguna conexión.
    await expect(fila(page, 'CX-0001').getByTestId('conexion-circuito')).toContainText('CIR-CX-0001');
  });

  test('7. reimportar: la conexión que cambió o desapareció deja su circuito marcado con el motivo; nada se borra ni se recalcula solo', async () => {
    const antes = await circuitos(page);
    await importarExcel(page, EXCEL_REV1);
    expect((await conexionDelExcel(page, 'CX-0001')).tensionV).toBe(400);
    await page.getByTestId('stage-tab-conexiones').click();
    await expect(fila(page, 'CX-0001')).toHaveAttribute('data-estado', 'desactualizada');
    await expect(fila(page, 'CX-0001').getByTestId('conexion-motivo')).toContainText('la conexión CX-0001 cambió en el Excel: tensionV (380 → 400)');
    await expect(fila(page, 'CX-0010')).toHaveCount(0);
    expect(await circuitos(page)).toEqual(antes);
    await verPestana(page, 'circuitos');
    await expect(page.locator('[data-testid="circuito-fila"][data-excel="CX-0010"]').getByTestId('circuito-excel-cambio')).toContainText('la conexión CX-0010 ya no está en el Excel');
    await expect(page.locator('[data-testid="circuito-fila"][data-excel="CX-0001"]').getByTestId('circuito-excel-cambio')).toContainText('tensionV (380 → 400)');
    await page.screenshot({ path: resolve(OUT_DIR, 'conexiones-importadas-03-reimportado.png') });
    // Retrazar es explícito y lo pone al día.
    await fila(page, 'CX-0001').getByTestId('conexion-retrazar').click();
    await expect(fila(page, 'CX-0001')).toHaveAttribute('data-estado', 'trazada');
  });
});
