/**
 * E2E — Conexiones importadas, etapa 2: los cables salen de los tendidos.
 *
 * Preparación (una vez, en serie): el Excel de ejemplo con DOS cambios, para casos que el de
 * ejemplo no trae entre lo que se traza: CB-001 con Ø 20 mm (ningún tendido trae diámetro) y
 * CB-012 (CX-0006) pasado a un unipolar 1×16 de fases (Sintenax Cu y Superastic Cu: dos
 * candidatos que no difieren sólo en el material; los dos del ejemplo son de EQUIPOTENCIALIDAD). TD-EX
 * (EQ-0011), TAB-A (EQ-0009) y S1-TS1 (EQ-0003) ubicados y enlazados a un trazado hecho con
 * gestos. Se trazan CX-0001 (TD-EX → TAB-A: 6 × 1×150, 1×35 N, 1×95 PE) y CX-0005 (TD-EX →
 * S1-TS1: un 5×6, que el catálogo no tiene).
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
const EXCEL_DIAM = resolve(OUT_DIR, 'tendidos-importados-diametro.xlsx');

type V3 = [number, number, number];
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string }> }; status: string; result: Record<string, unknown> | null; context: { productos: unknown[] } | null } };
    workspaceStore: { getState: () => { placeImportedEquipo: (id: string, p: { x: number; y: number; z: number }) => string | null } };
  };
};
const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const conexion = (page: Page, id: string) => page.locator(`[data-testid="conexion-fila"][data-conexion="${id}"]`);
const tendido = (page: Page, id: string) => page.locator(`[data-testid="tendido-fila"][data-tendido="${id}"]`);

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

async function armarExcelConDiametro() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);
  const ws = wb.getWorksheet('TENDIDOS')!;
  const col = (n: string) => { let i = 0; ws.getRow(1).eachCell((c, k) => { if (String(c.value) === n) i = k; }); if (!i) throw new Error(`falta ${n}`); return i; };
  const id = col('tendido_id');
  const d = col('diametro_exterior_mm');
  for (let r = 2; r <= ws.rowCount; r++) {
    const fila = ws.getRow(r);
    const t = String(fila.getCell(id).value ?? '');
    if (t === 'CB-001') fila.getCell(d).value = 20;
    if (t === 'CB-012') {
      fila.getCell(col('naturaleza')).value = 'CONDUCTOR_UNIPOLAR';
      fila.getCell(col('funcion')).value = 'FASES';
      fila.getCell(col('conductores_por_unidad')).value = 1;
      fila.getCell(col('seccion_mm2')).value = 16;
      fila.getCell(col('incluye_pe')).value = 'NO';
      fila.getCell(col('seccion_pe_mm2')).value = null;
    }
  }
  await wb.xlsx.writeFile(EXCEL_DIAM);
}

test.describe.configure({ mode: 'serial' });

test.describe('Conexiones importadas — etapa 2: los cables salen de los tendidos', () => {
  test.setTimeout(300_000);
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await armarExcelConDiametro();
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto('/?etapa=equipos');
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => ((window as unknown as Codex).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0, undefined, { timeout: 30_000 });
    await importarExcel(page, EXCEL_DIAM);
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
    const [r1, , r2] = await piezas(page);
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, 'EQ-0011', r1.instancia_id, 'P1', 200, 'izquierda');
    await enlazar(page, 'EQ-0009', r2.instancia_id, 'P2', 300, 'derecha');
    await enlazar(page, 'EQ-0003', r2.instancia_id, 'P2', 900, 'derecha');
    await page.getByTestId('formulario-cerrar').click();
    for (const id of ['CX-0001', 'CX-0005']) {
      await conexion(page, id).getByTestId('conexion-trazar').click();
      await expect(conexion(page, id)).toHaveAttribute('data-estado', 'trazada');
    }
  });
  test.afterAll(async () => { await page.close(); });

  test('1. un circuito ligado lleva todos los tendidos de su conexión: una lista de cables sobre el mismo recorrido', async () => {
    await verPestana(page, 'circuitos');
    const fila = page.locator('[data-testid="circuito-fila"][data-excel="CX-0001"]');
    await expect(fila.getByTestId('circuito-tendido')).toHaveCount(3);
    await expect(fila.getByTestId('circuito-tendido').nth(0)).toContainText('CB-001: Sintenax Valio · Unipolar · cobre · 1 × 150 mm² × 6');
    await expect(fila.getByTestId('circuito-tendido').nth(1)).toContainText('CB-002: Sintenax Valio · Unipolar · cobre · 1 × 35 mm² × 1');
    await expect(fila.getByTestId('circuito-tendido').nth(2)).toContainText('CB-003: Sintenax Valio · Unipolar · cobre · 1 × 95 mm² × 1');
    // El cable a mano queda para los circuitos fuera del Excel.
    await expect(fila.getByTestId('circuito-cable-editar')).toHaveCount(0);
    await page.screenshot({ path: resolve(OUT_DIR, 'tendidos-01-resultados.png') });
  });

  test('2. para cada tendido se muestra lo importado', async () => {
    await conexion(page, 'CX-0001').getByTestId('conexion-tendidos').locator('summary').click();
    await expect(tendido(page, 'CB-001').getByTestId('tendido-importado')).toHaveText(
      'Excel: CONDUCTOR_UNIPOLAR · FASES · 6 × 2×(3×1×150) · sección 150 mm² · PE NO · apantallado NO_INDICADO · Ø 20 mm',
    );
    await expect(tendido(page, 'CB-003').getByTestId('tendido-importado')).toContainText('PE · 1 × 1×95 V/A · sección 95 mm²');
  });

  test('3. casado: un candidato se propone; cobre contra aluminio sale de la regla del operador y se ve; se cambia a aluminio', async () => {
    // Sobre todo el Excel (las tarjetas existen aunque estén plegadas).
    await expect(page.locator('[data-testid="tendido-fila"][data-procedencia="unico-candidato"]')).toHaveCount(63);
    await expect(page.locator('[data-testid="tendido-fila"][data-procedencia="regla-cobre"]')).toHaveCount(40);
    const f = tendido(page, 'CB-001');
    await expect(f).toHaveAttribute('data-procedencia', 'regla-cobre');
    await expect(f).toHaveAttribute('data-cable', 'PRY-SVALIO-CU-1x150');
    await expect(f.getByTestId('tendido-procedencia')).toContainText('propuesto por la regla del operador (2026-11-15): cobre (el Excel no trae material)');
    // Control negativo: no se presenta como dato del Excel ni como único candidato.
    await expect(f.getByTestId('tendido-procedencia')).not.toContainText('único candidato');
    await expect(f.getByTestId('tendido-importado')).not.toContainText('cobre');
    await f.getByTestId('tendido-elegir').selectOption('PRY-SVALIO-AL-1x150');
    await expect(f).toHaveAttribute('data-procedencia', 'operador');
    await expect(f.getByTestId('tendido-procedencia')).toContainText('elegido por el operador');
    await expect(f.getByTestId('tendido-cable')).toHaveText('Sintenax Valio · Unipolar · aluminio · 1 × 150 mm²');
    await page.screenshot({ path: resolve(OUT_DIR, 'tendidos-02-aluminio.png') });
    await f.getByTestId('tendido-elegir').selectOption({ index: 0 }); // volver a la propuesta
    await expect(f).toHaveAttribute('data-procedencia', 'regla-cobre');
  });

  test('4. varios candidatos que no son sólo el material: elige el operador; ninguno: sin cable, con el motivo', async () => {
    const varios = page.locator('[data-testid="tendido-fila"]', { has: page.locator('[data-testid="tendido-sin-cable"]', { hasText: 'candidatos en el catálogo: elegí uno' }) });
    await expect(varios).toHaveCount(1);
    await expect(varios).toHaveAttribute('data-tendido', 'CB-012');
    await expect(varios.first()).toHaveAttribute('data-cable', '');
    await expect(varios.first().getByTestId('tendido-elegir').locator('option')).toHaveCount(4); // elegí + 2 + sin cable
    await conexion(page, 'CX-0006').getByTestId('conexion-tendidos').locator('summary').click();
    await varios.first().getByTestId('tendido-elegir').selectOption('PRY-SVALIO-CU-1x16');
    await expect(tendido(page, 'CB-012')).toHaveAttribute('data-procedencia', 'operador');
    await expect(tendido(page, 'CB-012')).toHaveAttribute('data-cable', 'PRY-SVALIO-CU-1x16');
    const cb010 = tendido(page, 'CB-010');
    await expect(cb010).toHaveAttribute('data-cable', '');
    await expect(cb010.getByTestId('tendido-sin-cable')).toContainText('el catálogo no tiene cables de 5 conductores');
    await expect(cb010.getByTestId('tendido-elegir')).toHaveCount(0); // nada para elegir: nunca un cable por defecto
  });

  test('5. diámetro del Excel distinto del de catálogo: aviso con los dos números', async () => {
    await expect(tendido(page, 'CB-001').getByTestId('tendido-aviso')).toContainText(
      'el diámetro exterior del Excel (20 mm) difiere del del cable de catálogo (24 mm): la ocupación la calcula el motor con el suyo',
    );
  });

  test('6. al motor: un circuito por tendido de potencia con cable, mismo recorrido; el PE del motor sale de su sección, una vez', async () => {
    await page.getByTestId('stage-tab-resultados').click();
    await verPestana(page, 'circuitos'); // «Circuitos y el motor» vive bajo la tabla de circuitos
    for (const t of ['CB-001', 'CB-002', 'CB-003']) await expect(page.locator(`[data-testid="circuito-al-motor"][data-circuito="CIR-CX-0001-${t}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="circuito-no-motor"][data-circuito="CIR-CX-0005-CB-010"]')).toContainText('5 conductores');
    await page.getByTestId('reserva-input').fill('20');
    await page.getByTestId('calculate-tray').click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().status), { timeout: 60_000 }).toBe('vigente');
    const res = await page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().result!);
    const entrada = res.entrada as { circuitos: Array<{ circuito_id: string; cable_id: string; cantidad: number; recorrido: string[] }>; pe: { cable_id: string } };
    const [r1, curva, r2] = await piezas(page);
    const recorrido = [r1.instancia_id, curva.instancia_id, r2.instancia_id];
    expect(entrada.circuitos).toEqual([
      expect.objectContaining({ circuito_id: 'CIR-CX-0001-CB-001', cable_id: 'PRY-SVALIO-CU-1x150', cantidad: 6, recorrido }),
      expect.objectContaining({ circuito_id: 'CIR-CX-0001-CB-002', cable_id: 'PRY-SVALIO-CU-1x35', cantidad: 1, recorrido }),
      expect.objectContaining({ circuito_id: 'CIR-CX-0001-CB-003', cable_id: 'PRY-SVALIO-CU-1x95', cantidad: 1, recorrido }),
    ]);
    expect(Object.keys(res.circuitos as object).sort()).toEqual(['CIR-CX-0001-CB-001', 'CIR-CX-0001-CB-002', 'CIR-CX-0001-CB-003']);
    // El PE del trazado: el del motor, aparte; ningún tendido viaja con su cable.
    expect(entrada.pe.cable_id).toBe('PRY-SASTFLEX-CU-1x16');
    expect(entrada.circuitos.some((c) => c.cable_id === 'PRY-SASTFLEX-CU-1x16')).toBe(false);
    // Nada del Excel que no sea del contrato.
    expect(JSON.stringify(entrada)).not.toContain('conexiones_ws');
    await page.screenshot({ path: resolve(OUT_DIR, 'tendidos-03-motor.png') });
  });

  test('7. Resultados: los tendidos de potencia sin cable de catálogo, con la lista y sus bandejas', async () => {
    await verPestana(page, 'circuitos');
    const aviso = page.getByTestId('tendidos-potencia-sin-cable');
    await expect(aviso).toContainText('1 tendido(s) de potencia sin cable de catálogo ni declarado: la ocupación de estas bandejas no los incluye.');
    const item = aviso.locator('[data-testid="tendido-potencia-sin-cable"][data-tendido="CB-010"]');
    await expect(item).toContainText('CX-0005');
    await expect(item).toContainText('5 conductores');
    await expect(item).toContainText('Bandejas: ');
    await page.screenshot({ path: resolve(OUT_DIR, 'tendidos-04-sin-cable.png') });
  });
});
