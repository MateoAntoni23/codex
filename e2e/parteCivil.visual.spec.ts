/**
 * E2E — parte civil, parte A (2026-11-15): importar STEP, ensamblar y guardar.
 * Pantalla del operador: 1366×768. Fixture: nave de ejemplo generada con CadQuery
 * (tools/civil_fixture/generar_nave.py → e2e/fixtures/civil/).
 *
 *   A1/A2  Importar: la conversión corre en el servicio; antes de confirmar se ven
 *          las unidades, la caja (ancho × fondo × alto) y los triángulos; no se
 *          confirma sin tipo, nivel y cota; el eje de la altura se elige.
 *   A3     Posición editable; reemplazar conserva tipo, nivel y posición; quitar.
 *   A4     Sobrevive a recargar; la copia del proyecto abierta en un navegador
 *          limpio muestra la nave. Peso del archivo de proyecto con la nave de
 *          ejemplo → e2e/output/parte-civil-peso.json.
 *   A5     Aviso de peso ANTES de sumar a la escena.
 *   A6     Error de conversión con motivo.
 *   Control negativo: un trazado con parte civil se calcula igual que sin ella y
 *   nada civil viaja al motor.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const FIX = resolve(HERE, 'fixtures/civil');
const NAVE: Array<[string, string, string, number]> = [
  ['PB-columnas.stp', 'columna', 'PB', 0],
  ['PB-vigas.stp', 'viga', 'PB', 0],
  ['PB-muros.stp', 'muro', 'PB', 0],
  ['P1-losa.stp', 'losa', 'P1', 6000],
  ['P1-columnas.stp', 'columna', 'P1', 6000],
  ['P1-vigas.stp', 'viga', 'P1', 6000],
];

test.use({ viewport: { width: 1366, height: 768 } });

type Civil = { kind: string; archivoId: string; tipo: string; triangulos: number; nombre: string };
const civilesEnEscena = (page: Page) => page.evaluate(() =>
  ((window as unknown as { __codex: { dumpMeshes: () => Array<Record<string, unknown>> } }).__codex.dumpMeshes()
    .filter((d) => d.kind === 'civil')) as unknown as Civil[]);
const archivos = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { parteCivilStore: { getState: () => { archivos: Array<{ id: string; nombre: string; tipo: string; version: number; desplazamientoMm: number[]; giroDeg: number; nivel: { nombre: string; cotaMm: number } }> } } } })
    .__codex.parteCivilStore.getState().archivos);
const foto = (page: Page, n: string) => page.screenshot({ path: resolve(OUT_DIR, `parte-civil-A-${n}.png`) });

async function abrir(page: Page, url = '/?etapa=planta') {
  await page.goto(url);
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { parteCivilStore?: unknown; dumpMeshes?: unknown } }).__codex?.parteCivilStore
    && (window as unknown as { __codex?: { dumpMeshes?: unknown } }).__codex?.dumpMeshes), undefined, { timeout: 20_000 });
}

/** Importa un STEP de la nave declarando tipo, nivel y cota (y el eje, si se pide). */
async function importar(page: Page, archivo: string, tipo: string, nivel: string, cota: number) {
  const antes = (await archivos(page)).length;
  await page.getByTestId('civil-importar-input').setInputFiles(resolve(FIX, archivo));
  await expect(page.getByTestId('civil-importacion')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('civil-tipo').selectOption(tipo);
  await page.getByTestId('civil-nivel-nombre').fill(nivel);
  await page.getByTestId('civil-nivel-cota').fill(String(cota));
  await page.getByTestId('civil-confirmar').click();
  await expect.poll(async () => (await archivos(page)).length).toBe(antes + 1);
}

async function esperarGuardado(page: Page) {
  await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 30_000 });
}

test.describe('Parte civil — A: importar, ensamblar y guardar', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('A1/A2/A4: importar, ver unidades, caja y triángulos antes de confirmar; recargar y que siga', async ({ page }) => {
    await abrir(page);
    await page.getByTestId('civil-importar-input').setInputFiles(resolve(FIX, 'PB-columnas.stp'));
    await expect(page.getByTestId('civil-convirtiendo')).toBeVisible();
    await expect(page.getByTestId('civil-importacion')).toBeVisible({ timeout: 60_000 });
    // Lo que se leyó del STEP, antes de confirmar.
    await expect(page.getByTestId('civil-unidades')).toContainText('milímetro');
    const caja = page.getByTestId('civil-caja');
    await expect(caja).toHaveAttribute('data-ancho', '24300');
    await expect(caja).toHaveAttribute('data-fondo', '12300');
    await expect(caja).toHaveAttribute('data-alto', '6000');
    await expect(page.getByTestId('civil-triangulos')).toHaveAttribute('data-triangulos', '180');
    await expect(page.getByTestId('civil-eje')).toHaveValue('Z');
    // Nada se deduce: sin tipo, nivel y cota no se confirma; todavía no hay nada en la escena.
    await expect(page.getByTestId('civil-confirmar')).toBeDisabled();
    await expect(page.getByTestId('civil-faltan')).toContainText('el tipo');
    expect(await civilesEnEscena(page)).toHaveLength(0);
    await foto(page, 'importar');
    await page.getByTestId('civil-tipo').selectOption('columna');
    await page.getByTestId('civil-nivel-nombre').fill('PB');
    await page.getByTestId('civil-nivel-cota').fill('0');
    await page.getByTestId('civil-confirmar').click();
    await expect.poll(async () => (await civilesEnEscena(page)).map((c) => [c.tipo, c.triangulos])).toEqual([['columna', 180]]);
    await expect(page.getByTestId('civil-nivel-PB')).toContainText('PB-columnas.stp');
    await expect(page.getByTestId('civil-ficha')).toBeVisible();

    // Recargar: sigue ahí (autoguardado).
    await esperarGuardado(page);
    await page.reload();
    await abrir(page);
    await expect.poll(async () => (await civilesEnEscena(page)).map((c) => c.tipo), { timeout: 20_000 }).toEqual(['columna']);
    await expect(page.getByTestId('civil-nivel-PB')).toContainText('PB-columnas.stp');
  });

  test('A2: el eje de la altura se elige; una columna exportada con Y vertical aparece acostada con Z', async ({ page }) => {
    await abrir(page);
    await page.getByTestId('civil-importar-input').setInputFiles(resolve(FIX, 'PB-columnas-yup.stp'));
    await expect(page.getByTestId('civil-importacion')).toBeVisible({ timeout: 60_000 });
    const caja = page.getByTestId('civil-caja');
    // Con Z (lo de la app) el alto da 12300: la nave «acostada». Es el control que ve el operador.
    await expect(caja).toHaveAttribute('data-alto', '12300');
    await page.getByTestId('civil-eje').selectOption('Y');
    await expect(caja).toHaveAttribute('data-alto', '6000');
    await expect(caja).toHaveAttribute('data-ancho', '24300');
    await expect(caja).toHaveAttribute('data-fondo', '12300');
    await page.getByTestId('civil-tipo').selectOption('columna');
    await page.getByTestId('civil-nivel-nombre').fill('PB');
    await page.getByTestId('civil-nivel-cota').fill('0');
    await page.getByTestId('civil-confirmar').click();
    await expect.poll(async () => (await archivos(page)).map((a) => (a as unknown as { ejeVertical: string }).ejeVertical)).toEqual(['Y']);
    await expect(page.getByTestId('civil-ficha-caja')).toHaveAttribute('data-alto', '6000');
  });

  test('A3: posición editable; reemplazar conserva tipo, nivel y posición; quitar', async ({ page }) => {
    await abrir(page);
    await importar(page, 'PB-columnas.stp', 'columna', 'PB', 0);
    await page.getByTestId('civil-desp-x').fill('1000');
    await page.getByTestId('civil-desp-x').blur();
    await page.getByTestId('civil-giro').fill('10');
    await page.getByTestId('civil-giro').blur();
    await expect.poll(async () => (await archivos(page))[0]).toMatchObject({ desplazamientoMm: [1000, 0, 0], giroDeg: 10 });

    // Reemplazar por la versión nueva (una fila más de columnas).
    await page.getByTestId('civil-reemplazar-input').setInputFiles(resolve(FIX, 'PB-columnas-v2.stp'));
    await expect(page.getByTestId('civil-importacion')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('civil-tipo')).toBeDisabled();
    await expect(page.getByTestId('civil-tipo')).toHaveValue('columna');
    await expect(page.getByTestId('civil-nivel-nombre')).toHaveValue('PB');
    await expect(page.getByTestId('civil-triangulos')).toHaveAttribute('data-triangulos', '240');
    await page.getByTestId('civil-confirmar').click();
    await expect.poll(async () => (await archivos(page))[0]).toMatchObject({
      nombre: 'PB-columnas-v2.stp', tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, desplazamientoMm: [1000, 0, 0], giroDeg: 10, version: 2,
    });
    expect(await archivos(page)).toHaveLength(1);
    await expect.poll(async () => (await civilesEnEscena(page)).map((c) => c.triangulos)).toEqual([240]);
    await foto(page, 'reemplazado');

    // Quitar.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('civil-quitar').click();
    await expect.poll(async () => (await archivos(page)).length).toBe(0);
    expect(await civilesEnEscena(page)).toHaveLength(0);
  });

  test('A4: la copia del proyecto abierta en un navegador limpio muestra la nave; peso del archivo', async ({ page, browser }) => {
    await abrir(page);
    for (const [f, tipo, nivel, cota] of NAVE) await importar(page, f, tipo, nivel, cota);
    await expect(page.getByTestId('civil-nivel-PB')).toBeVisible();
    await expect(page.getByTestId('civil-nivel-P1')).toBeVisible();
    await esperarGuardado(page);
    await foto(page, 'nave');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save-copy').click()]);
    const ruta = resolve(OUT_DIR, 'parte-civil-nave.workspace.json');
    await descarga.saveAs(ruta);
    const copia = JSON.parse(readFileSync(ruta, 'utf-8'));
    expect(copia.fileVersion).toBe(4);
    expect(copia.parteCivil.archivos).toHaveLength(6);
    const bytes = statSync(ruta).size;
    const triangulos = copia.parteCivil.archivos.reduce((s: number, a: { malla: { triangulos: number } }) => s + a.malla.triangulos, 0);
    writeFileSync(resolve(OUT_DIR, 'parte-civil-peso.json'), JSON.stringify({ archivos: 6, triangulos, bytes, kb: Math.round(bytes / 1024) }, null, 2));

    // Navegador limpio (otro contexto: sin IndexedDB ni localStorage del anterior).
    const limpio = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const p2 = await limpio.newPage();
    await abrir(p2);
    expect(await civilesEnEscena(p2)).toHaveLength(0);
    await p2.getByTestId('project-open-input').setInputFiles(ruta);
    await expect.poll(async () => (await civilesEnEscena(p2)).length, { timeout: 20_000 }).toBe(6);
    await expect(p2.getByTestId('civil-nivel-P1')).toContainText('P1-losa.stp');
    await p2.screenshot({ path: resolve(OUT_DIR, 'parte-civil-A-copia-limpia.png') });
    await limpio.close();
  });

  test('A5: un archivo que pasa el umbral se avisa ANTES de sumarlo, con el número y la sugerencia', async ({ page }) => {
    await abrir(page);
    // Parte civil ya pesada (cuenta declarada en la malla; la geometría es la del fixture).
    await importar(page, 'P1-losa.stp', 'losa', 'P1', 6000);
    await page.evaluate(() => {
      const st = (window as unknown as { __codex: { parteCivilStore: { getState: () => { archivos: Array<{ malla: { triangulos: number } }>; cargar: (a: unknown[]) => void } } } }).__codex.parteCivilStore.getState();
      st.cargar(st.archivos.map((a) => ({ ...a, malla: { ...a.malla, triangulos: 999_950 } })));
    });
    await page.getByTestId('civil-importar-input').setInputFiles(resolve(FIX, 'PB-columnas.stp'));
    await expect(page.getByTestId('civil-importacion')).toBeVisible({ timeout: 60_000 });
    const aviso = page.getByTestId('civil-aviso-peso');
    await expect(aviso).toContainText('1.000.130 triángulos');
    await expect(aviso).toContainText('simplificar el modelo');
    // Antes de sumarlo: todavía no está en la escena.
    expect((await civilesEnEscena(page)).length).toBe(1);
    await expect(page.getByTestId('civil-confirmar')).toHaveText('Sumar igual a la escena');
    await foto(page, 'aviso-peso');
  });

  test('A6: si la conversión falla, se dice por qué', async ({ page }) => {
    await abrir(page);
    await page.getByTestId('civil-importar-input').setInputFiles(resolve(FIX, 'no-es-step.stp'));
    await expect(page.getByTestId('civil-error')).toContainText('no es un STEP', { timeout: 30_000 });
    await expect(page.getByTestId('civil-importacion')).toHaveCount(0);
  });

  test('control negativo: con parte civil el trazado se calcula igual y nada civil viaja al motor', async ({ page }) => {
    await abrir(page, '/?etapa=bandejas');
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRES-300-065-18-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    const calcular = async () => {
      await page.getByTestId('stage-tab-resultados').click();
      await page.getByTestId('reserva-input').fill('20');
      await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().includes('/v1/calcular') && r.method() === 'POST'),
        page.getByTestId('calculate-tray').click(),
      ]);
      await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
      const resultado = await page.evaluate(() => JSON.stringify((window as unknown as { __codex: { trayStore: { getState: () => { result: { computo: unknown; ocupaciones?: unknown } } } } }).__codex.trayStore.getState().result.computo));
      return { cuerpo: req.postData() ?? '', resultado };
    };
    const sin = await calcular();
    await page.getByTestId('stage-tab-planta').click();
    for (const [f, tipo, nivel, cota] of NAVE.slice(0, 3)) await importar(page, f, tipo, nivel, cota);
    expect((await civilesEnEscena(page)).length).toBe(3);
    const con = await calcular();
    // Lo que viaja al motor: la misma entrada; nada civil.
    expect(JSON.parse(con.cuerpo).entrada).toEqual(JSON.parse(sin.cuerpo).entrada);
    for (const marca of ['civil', 'PB-columnas', 'codex:parteCivil', 'codex:civilMalla', 'malla']) expect(con.cuerpo).not.toContain(marca);
    // El resultado (cómputo) es el mismo.
    expect(con.resultado).toBe(sin.resultado);
  });
});
