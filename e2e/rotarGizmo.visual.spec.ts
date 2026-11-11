/**
 * E2E B-4 — herramienta "Rotar tramo" (gizmo de rotación).
 *
 * PB8. Rotar con el gizmo una pieza suelta y una unida.
 *   - Suelta: el giro se confirma solo, es UNA entrada del historial, deshacer y
 *     rehacer lo revierten/aplican. Paso de 15° (Shift: libre).
 *   - Unida: un giro que deja la unión fuera de tolerancia pide confirmación
 *     (mismo aviso que al mover). Cancelar restaura; aceptar descarta la unión.
 *     Nunca queda una unión inválida registrada.
 *   - Valor numérico editable con pivote en una boca: la boca queda fija.
 *
 * Sobre el arrastre: una prueba arrastra de verdad el anillo vertical con el
 * mouse (posición tomada de la cámara inicial; verifica giro sobre Z en pasos
 * de 15° y una entrada en el historial). Las demás disparan los MISMOS eventos
 * del TransformControls (dragging-changed / objectChange) con el proxy girado,
 * a través del puente `__codex.trayRotateGizmo`, para fijar ángulos exactos.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');

type V3 = [number, number, number];
type Estado = {
  piezas: Array<{ instancia_id: string; puertos: Record<string, { posicion_mm: V3; direccion: V3 }> }>;
  conexiones: Array<{ conexion_id: string }>;
  history: number;
  invalidas: string[];
};

async function openBandejas(page: Page): Promise<void> {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

async function estado(page: Page): Promise<Estado> {
  return page.evaluate(async () => {
    const joins = await import('/src/workspace/placement/joins.ts');
    const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: never; history: unknown[] } } } };
    const s = w.__codex.trayStore.getState();
    const e = s.entrada as unknown as Estado & { conexiones: Array<{ conexion_id: string }> };
    return {
      piezas: JSON.parse(JSON.stringify(e.piezas)),
      conexiones: e.conexiones.map((c) => ({ conexion_id: c.conexion_id })),
      history: s.history.length,
      invalidas: joins.invalidConnections(s.entrada),
    };
  });
}

const count = async (page: Page) => (await estado(page)).piezas.length;

async function crearTramo(page: Page): Promise<void> {
  const before = await count(page);
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(() => count(page)).toBe(before + 1);
}

async function continuarDesde(page: Page, extremo: RegExp): Promise<void> {
  const before = await count(page);
  await page.getByTestId('free-end').filter({ hasText: extremo }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption('SAM_TRPS-300-22-Z');
  await page.locator('[data-codex-routing-length-input]').fill('1500');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(() => count(page)).toBe(before + 1);
}

async function seleccionar(page: Page, id: string): Promise<void> {
  await page.evaluate((pid) => {
    (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } } }).__codex.workspaceStore.getState().selectTray(pid);
  }, id);
}

/** Gira el proxy del gizmo `deg` grados sobre `ejeVisor` (Y del visor = Z del trazado). */
async function arrastrarAnillo(page: Page, ejeVisor: V3, deg: number): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __codex?: { trayRotateGizmo?: unknown } }).__codex?.trayRotateGizmo);
  await page.evaluate(([e, d]) => {
    (window as unknown as { __codex: { trayRotateGizmo: { arrastrar: (e: V3, d: number) => void } } }).__codex.trayRotateGizmo.arrastrar(e as V3, d as number);
  }, [ejeVisor, deg] as const);
}

const cerca = (a: number[], b: number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < tol);

test.describe('B-4 — Rotar tramo', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('PB8 — pieza suelta: el gizmo gira 90° sobre Z, una entrada en el historial, deshacer/rehacer', async ({ page }) => {
    await openBandejas(page);
    await crearTramo(page);
    const [pieza] = (await estado(page)).piezas;
    await seleccionar(page, pieza.instancia_id);

    await page.getByTestId('tray-rotate-toggle').click();
    await expect(page.getByTestId('tray-rotate-panel')).toBeVisible();
    await expect(page.getByTestId('tray-rotate-mode-hint')).toBeVisible();
    await expect(page.getByTestId('tray-rotate-paso')).toContainText('Paso 15°');
    expect(await page.evaluate(() => (window as unknown as { __codex: { trayRotateGizmo: { paso: () => number | null } } }).__codex.trayRotateGizmo.paso())).toBe(15);
    await page.locator('canvas').first().screenshot({ path: resolve(OUT_DIR, 'rotar-01-gizmo.png') });

    const antes = await estado(page);
    const p0 = antes.piezas[0].puertos;
    await arrastrarAnillo(page, [0, 1, 0], 90);
    const despues = await estado(page);
    const p1 = despues.piezas[0].puertos;
    // Giro de 90° sobre Z por el centro: las direcciones giran (x → y) y el centro queda.
    expect(cerca(p1.P2.direccion, [-p0.P2.direccion[1], p0.P2.direccion[0], p0.P2.direccion[2]])).toBe(true);
    const centro = (p: Estado['piezas'][0]['puertos']) => [0, 1, 2].map((k) => (p.P1.posicion_mm[k] + p.P2.posicion_mm[k]) / 2);
    expect(cerca(centro(p1), centro(p0), 1e-6)).toBe(true);
    expect(despues.history).toBe(antes.history + 1);
    // El valor del arrastre queda en el campo numérico, con su eje.
    await expect(page.getByTestId('tray-rotate-angulo')).toHaveValue('90');
    await expect(page.getByTestId('tray-rotate-eje')).toHaveValue('Z');
    await page.locator('canvas').first().screenshot({ path: resolve(OUT_DIR, 'rotar-02-girada.png') });

    await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { undo: () => void } } } }).__codex.trayStore.getState().undo());
    expect(cerca((await estado(page)).piezas[0].puertos.P2.posicion_mm, p0.P2.posicion_mm)).toBe(true);
    await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { redo: () => void } } } }).__codex.trayStore.getState().redo());
    expect(cerca((await estado(page)).piezas[0].puertos.P2.posicion_mm, p1.P2.posicion_mm)).toBe(true);

    // Shift: giro libre (sin paso).
    await page.keyboard.down('Shift');
    await expect(page.getByTestId('tray-rotate-paso')).toContainText('giro libre');
    expect(await page.evaluate(() => (window as unknown as { __codex: { trayRotateGizmo: { paso: () => number | null } } }).__codex.trayRotateGizmo.paso())).toBeNull();
    await page.keyboard.up('Shift');

    // Esc sale de la herramienta.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tray-rotate-panel')).toHaveCount(0);
  });

  test('PB8 — arrastre real del anillo vertical con el mouse: gira en pasos de 15° sobre Z', async ({ page }) => {
    await openBandejas(page);
    await crearTramo(page);
    const [pieza] = (await estado(page)).piezas;
    await seleccionar(page, pieza.instancia_id);
    await page.getByTestId('tray-rotate-toggle').click();
    await page.waitForFunction(() => !!(window as unknown as { __codex?: { trayRotateGizmo?: unknown } }).__codex?.trayRotateGizmo);
    const antes = await estado(page);
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    // El anillo verde (giro sobre el eje vertical) pasa por debajo del pivote,
    // que la cámara inicial deja centrado: se toma el anillo en su punto inferior
    // (ver rotar-01-gizmo.png) y se arrastra hacia un costado.
    const cx = box.x + box.width * (527 / 956);
    const cy = box.y + box.height * (535 / 912);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 8, cy - i * 2);
    await page.mouse.up();
    const despues = await estado(page);
    const d0 = antes.piezas[0].puertos.P2.direccion;
    const d1 = despues.piezas[0].puertos.P2.direccion;
    const deg = (Math.atan2(d1[1], d1[0]) - Math.atan2(d0[1], d0[0])) * 180 / Math.PI;
    expect(Math.abs(deg), 'el arrastre gira la pieza').toBeGreaterThan(1);
    expect(Math.abs(deg % 15) < 1e-6 || Math.abs(Math.abs(deg % 15) - 15) < 1e-6, `paso de 15° (${deg})`).toBe(true);
    expect(Math.abs(d1[2]), 'gira sobre Z: la dirección queda horizontal').toBeLessThan(1e-9);
    expect(despues.history).toBe(antes.history + 1);
    await canvas.screenshot({ path: resolve(OUT_DIR, 'rotar-04-mouse.png') });
  });

  test('PB8 — pieza unida: pide confirmación; cancelar restaura, aceptar descarta la unión; nunca queda una inválida', async ({ page }) => {
    await openBandejas(page);
    await crearTramo(page);
    await continuarDesde(page, /^↗ 1\. TRPS-300-22-Z/);
    const inicial = await estado(page);
    expect(inicial.conexiones).toHaveLength(1);
    expect(inicial.invalidas).toEqual([]);
    const segunda = inicial.piezas[1];
    await seleccionar(page, segunda.instancia_id);
    await page.getByTestId('tray-rotate-toggle').click();

    // 45° sobre Z por el centro: la unión deja de cumplir → aviso.
    await arrastrarAnillo(page, [0, 1, 0], 45);
    const modal = page.getByTestId('tray-broken-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Mover o rotar el tramo desconectará 1 unión(es)');
    await page.locator('canvas').first().screenshot({ path: resolve(OUT_DIR, 'rotar-03-unida-aviso.png') });

    // Cancelar: todo como antes, sin entrada en el historial.
    await page.getByTestId('tray-broken-cancel').click();
    const cancelado = await estado(page);
    expect(cerca(cancelado.piezas[1].puertos.P2.posicion_mm, segunda.puertos.P2.posicion_mm)).toBe(true);
    expect(cancelado.conexiones).toHaveLength(1);
    expect(cancelado.history).toBe(inicial.history);

    // Valor numérico con pivote en la boca unida: 90° sobre Z. La boca P1 queda en su lugar,
    // pero su dirección gira: la unión deja de cumplir y se pide confirmación.
    await page.getByTestId('tray-rotate-pivot').selectOption('boca:P1');
    await page.getByTestId('tray-rotate-eje').selectOption('Z');
    await page.getByTestId('tray-rotate-angulo').fill('90');
    await page.getByTestId('tray-rotate-aplicar').click();
    await expect(modal).toBeVisible();
    // Con pivote en P1, la boca P1 queda fija.
    const conPivote = await estado(page);
    expect(cerca(conPivote.piezas[1].puertos.P1.posicion_mm, segunda.puertos.P1.posicion_mm)).toBe(true);

    // Aceptar: el giro queda y la unión se descarta (una entrada en el historial).
    await page.getByTestId('tray-broken-accept').click();
    const aceptado = await estado(page);
    expect(aceptado.conexiones).toHaveLength(0);
    expect(aceptado.invalidas).toEqual([]);
    expect(aceptado.history).toBe(inicial.history + 1);
  });
});
