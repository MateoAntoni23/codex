/**
 * E2E — Conexiones importadas, etapa 4: qué pasa por cada bandeja.
 *
 * Preparación (una vez, en serie): Excel de ejemplo; TD-EX, TAB-A y S1-TS1 ubicados y
 * enlazados a un trazado con gestos (recto → curva → recto 2000); un circuito de mando a
 * mano con su cable (2 × Sintenax 2×1,5: el ejemplo no trae mando con cable de catálogo);
 * CX-0001 (6 × 1×150, 1×35, 1×95) y CX-0005 (5×6, sin cable de catálogo) trazados.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elegirPieza } from './helpers/selectorPieza';
import { abrirFormulario } from './helpers/interfaz';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const EXCEL = resolve(HERE, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');

type V3 = [number, number, number];
type Obj = { name?: string; type: string; uuid: string; userData: Record<string, unknown>; material?: unknown; traverse: (f: (o: Obj) => void) => void };
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string }> }; context: { productos: unknown[]; catalogoCables: { cables: Array<{ cable_id: string; diametro_exterior_mm: number }> } } | null } };
    workspaceStore: { getState: () => { placeImportedEquipo: (id: string, p: { x: number; y: number; z: number }) => string | null; selectTray: (id: string | null) => void } };
    scene: Obj;
  };
};
const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const conexion = (page: Page, id: string) => page.locator(`[data-testid="conexion-fila"][data-conexion="${id}"]`);

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

/** Colores de relleno (color, emisivo, intensidad, opacidad) de todas las mallas, salvo el trazo del recorrido. */
const coloresDeRelleno = (page: Page) => page.evaluate(() => {
  const scene = (window as unknown as Codex).__codex.scene;
  const enResaltado = new Set<string>();
  scene.traverse((o) => { if (o.name === 'recorrido-resaltado') o.traverse((x) => enResaltado.add(x.uuid)); });
  const out: Record<string, string> = {};
  scene.traverse((o) => {
    if (o.type !== 'Mesh' || enResaltado.has(o.uuid)) return;
    const mats = ([] as unknown[]).concat(o.material ?? []) as Array<{ color?: { getHexString: () => string }; emissive?: { getHexString: () => string }; emissiveIntensity?: number; opacity?: number }>;
    out[o.uuid] = mats.map((m) => `${m.color?.getHexString() ?? ''}/${m.emissive?.getHexString() ?? ''}/${m.emissiveIntensity ?? ''}/${m.opacity ?? ''}`).join('|');
  });
  return out;
});

const resaltadoEnEscena = (page: Page) => page.evaluate(() => {
  let r: { circuito: string; piezas: string[]; puntosMm: number[][] } | null = null;
  (window as unknown as Codex).__codex.scene.traverse((o) => {
    if (o.name === 'recorrido-resaltado') r = o.userData.codex as { circuito: string; piezas: string[]; puntosMm: number[][] };
  });
  return r as { circuito: string; piezas: string[]; puntosMm: number[][] } | null;
});

test.describe.configure({ mode: 'serial' });

test.describe('Conexiones importadas — etapa 4: qué pasa por cada bandeja', () => {
  test.setTimeout(300_000);
  let page: Page;
  let ids: string[] = [];

  test.beforeAll(async ({ browser }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
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
    // Un circuito de mando fuera del Excel, con su cable elegido a mano.
    await abrirFormulario(page, 'circuito');
    await page.getByTestId('circuito-origen').selectOption('EQ-0011');
    await page.getByTestId('circuito-destino').selectOption('EQ-0009');
    await page.getByTestId('circuito-cable-linea').selectOption({ label: 'Sintenax Valio' });
    await page.getByTestId('circuito-cable-tipo').selectOption({ label: 'Bipolar · cobre' });
    await page.getByTestId('circuito-cable-formacion').selectOption('PRY-SVALIO-CU-2x1.5');
    await page.getByTestId('circuito-cable-cantidad').fill('2');
    await page.getByTestId('circuito-cable-funcion-select').selectOption('maniobra');
    await page.getByTestId('circuito-nombre-input').fill('Mando a mano');
    await page.getByTestId('circuito-guardar').click();
    await expect(page.getByTestId('circuito-guardado-msg')).toContainText('guardado');
    await page.getByTestId('formulario-cerrar').click();
    for (const id of ['CX-0001', 'CX-0005']) {
      await conexion(page, id).getByTestId('conexion-trazar').click();
      await expect(conexion(page, id)).toHaveAttribute('data-estado', 'trazada');
    }
  });
  test.afterAll(async () => { await page.close(); });

  test('1. al seleccionar una pieza, el inspector lista circuitos y tendidos que la atraviesan, con función, cable y cantidad, y la suma de diámetros por grupo', async () => {
    await page.getByTestId('stage-tab-bandejas').click();
    await page.evaluate((id) => (window as unknown as Codex).__codex.workspaceStore.getState().selectTray(id), ids[2]);
    const panel = page.getByTestId('por-esta-bandeja');
    await expect(panel).toContainText('Por esta bandeja pasan (3 circuito(s))');
    const item = (t: string) => panel.locator(`[data-testid="pasa-item"][data-tendido="${t}"]`);
    await expect(item('CB-001')).toContainText('CB-001 · Potencia · Sintenax Valio · Unipolar · cobre · 1 × 150 mm² × 6 · Ø 24 mm');
    await expect(item('CB-002')).toContainText('CB-002 · Potencia · Sintenax Valio · Unipolar · cobre · 1 × 35 mm² × 1');
    await expect(item('CB-003')).toContainText('CB-003 · Potencia · Sintenax Valio · Unipolar · cobre · 1 × 95 mm² × 1');
    await expect(item('CB-010')).toContainText('CB-010 · Potencia · sin cable de catálogo × 1');
    await expect(item('CB-010').getByTestId('pasa-fuera')).toContainText('no entra en la suma: sin cable de catálogo');
    const mando = panel.locator('[data-testid="pasa-circuito"]', { hasText: 'Mando a mano' }).getByTestId('pasa-item');
    await expect(mando).toContainText('Maniobra · Sintenax Valio · Bipolar · cobre · 2 × 1,5 mm² × 2');
    // Sumas por grupo, con los diámetros del catálogo.
    const d = await page.evaluate(() => Object.fromEntries(
      (window as unknown as Codex).__codex.trayStore.getState().context!.catalogoCables.cables.map((c) => [c.cable_id, c.diametro_exterior_mm]),
    ));
    const mm = (x: number) => `${x.toLocaleString('es-AR', { maximumFractionDigits: 1 })} mm`;
    const pot = d['PRY-SVALIO-CU-1x150'] * 6 + d['PRY-SVALIO-CU-1x35'] + d['PRY-SVALIO-CU-1x95'];
    await expect(panel.getByTestId('pasa-suma-potencia')).toHaveText(`Σ diámetros, Potencia: ${mm(pot)} (8 cable(s))`);
    await expect(panel.getByTestId('pasa-suma-resto')).toHaveText(`Σ diámetros, Mando, señal y comunicación: ${mm(d['PRY-SVALIO-CU-2x1.5'] * 2)} (2 cable(s))`);
    await expect(panel).toContainText('1 ítem(s) fuera de la suma');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(OUT_DIR, 'por-bandeja-01-inspector.png') });
  });

  test('2. desde la lista se salta al circuito, y su recorrido se resalta en la escena sin color de relleno', async () => {
    const antes = await coloresDeRelleno(page);
    expect(Object.keys(antes).length).toBeGreaterThan(0);
    expect(await resaltadoEnEscena(page)).toBeNull();
    await page.locator('[data-testid="pasa-circuito"][data-circuito="CIR-CX-0001"]').getByTestId('pasa-ver-circuito').click();
    // Su fila en Resultados › Circuitos, marcada.
    await expect(page.getByTestId('panel-inferior-circuitos')).toBeVisible();
    await expect(page.locator('[data-testid="circuito-fila"][data-circuito="CIR-CX-0001"]')).toHaveAttribute('data-resaltado', 'true');
    await expect(page.locator('[data-testid="circuito-fila"][data-resaltado="true"]')).toHaveCount(1);
    // En la escena: un trazo aparte que sigue el recorrido guardado.
    await expect.poll(async () => (await resaltadoEnEscena(page))?.circuito).toBe('CIR-CX-0001');
    const r = (await resaltadoEnEscena(page))!;
    expect(r.piezas).toEqual(ids);
    expect(r.puntosMm.length).toBeGreaterThanOrEqual(6);
    // Sin color de relleno: ninguna malla de la escena cambió color, emisivo ni opacidad.
    expect(await coloresDeRelleno(page)).toEqual(antes);
    await page.screenshot({ path: resolve(OUT_DIR, 'por-bandeja-02-resaltado.png') });
  });

  test('3. el resaltado sigue al circuito elegido y se quita desde la tabla', async () => {
    const mando = page.locator('[data-testid="circuito-fila"]', { hasText: 'Mando a mano' });
    await mando.getByTestId('circuito-resaltar').click();
    await expect(mando).toHaveAttribute('data-resaltado', 'true');
    await expect.poll(async () => (await resaltadoEnEscena(page))?.circuito).toMatch(/^CIR-\d+$/);
    await mando.getByTestId('circuito-resaltar').click();
    await expect.poll(async () => resaltadoEnEscena(page)).toBeNull();
  });
});
