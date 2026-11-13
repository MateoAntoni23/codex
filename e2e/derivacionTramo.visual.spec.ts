/**
 * E2E — derivación en un tramo, con gestos reales, las dos familias.
 *
 * La herramienta coloca SÓLO la derivación y deja su boca libre; lo que sigue se
 * continúa por el camino normal (extremo libre → selector → confirmar).
 *
 * Perforada: tronco de 300 (3000 mm), derivación de 100 a mitad de tramo.
 *   Aparece la DCPS-100-Z con su boca libre y NINGUNA bandeja nueva. Desde esa
 *   boca se continúa con un recto de 100: unión válida, recorrido completo
 *   (1500 + 80,542 + 1000), el motor computa 1 DCPS-100-Z, el tronco intacto.
 * Escalera: tronco de 300, derivación a mitad de tramo. Aparece la boca libre y
 *   ninguna pieza. Desde la boca se continúa con un recto de 150: ninguna
 *   conexión nueva, recorrido completo (1500 + 1000), ningún accesorio computado.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');

type V3 = [number, number, number];
type PiezaJs = { instancia_id: string; producto_id: string; longitud_mm?: number; puertos: Record<string, { posicion_mm: V3; direccion: V3 }> };
type EngJs = { id: string; salida: [string, string] };
type W = { __codex: { trayStore: { getState: () => {
  entrada: { piezas: PiezaJs[]; conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }>; enganches_ws?: EngJs[] };
  status: string;
  result: { computo: { lineas: Array<{ producto_id: string | null; cantidad: number | null }> } } | null;
} } } };

async function openBandejas(page: Page): Promise<void> {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

const estado = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as W).__codex.trayStore.getState();
  return { piezas: s.entrada.piezas, conexiones: s.entrada.conexiones, enganches: s.entrada.enganches_ws ?? [] };
});

async function crearTronco(page: Page, productoId: string) {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await estado(page)).piezas.length).toBe(1);
  return (await estado(page)).piezas[0];
}

async function crearDerivacion(page: Page, tronco: string, ancho: number) {
  await page.getByTestId('tool-bandejas-derivacion').click();
  await page.getByTestId('der-tronco').selectOption(tronco);
  await page.getByTestId('der-desde').selectOption('P1');
  await page.getByTestId('der-distancia').fill('1500');
  await page.getByTestId('der-lado').selectOption('izquierda');
  await page.getByTestId('der-ancho').selectOption(String(ancho));
  // No se elige ninguna bandeja: la operación no la crea.
  await expect(page.getByTestId('der-ramal')).toHaveCount(0);
  await page.getByTestId('der-crear').click();
}

/** Continuar por el camino normal: clic en el extremo libre, producto, largo, confirmar. */
async function continuarDesde(page: Page, extremo: RegExp, productoId: string, largo: number) {
  const antes = (await estado(page)).piezas.length;
  await page.getByTestId('tool-bandejas-seleccionar').click();
  await page.getByTestId('free-end').filter({ hasText: extremo }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  await page.locator('[data-codex-routing-length-input]').fill(String(largo));
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await estado(page)).piezas.length).toBe(antes + 1);
  return (await estado(page)).piezas[antes];
}

async function recorrido(page: Page, origen: [string, string], destino: [string, string]) {
  await page.getByTestId('stage-tab-conexiones').click();
  await page.getByTestId('recorrido-origen').selectOption(`${origen[0]}\u0000${origen[1]}`);
  await page.getByTestId('recorrido-destino').selectOption(`${destino[0]}\u0000${destino[1]}`);
}

async function calcular(page: Page) {
  await page.getByTestId('stage-tab-resultados').click();
  await page.getByTestId('reserva-input').fill('20');
  await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
  await page.getByTestId('calculate-tray').click();
  await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
  return page.evaluate(() => {
    const s = (window as unknown as W).__codex.trayStore.getState();
    return { status: s.status, lineas: s.result!.computo.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })) };
  });
}

/**
 * Vista cenital sobre una pieza: la junta con el flanco del tronco queda en
 * cuadro. focusTray falla (null) si la pieza no tiene malla en la escena: la
 * DCPS, de una sola boca, antes no se dibujaba y lo continuado se veía suelto.
 */
async function vistaEnganche(page: Page, instanciaId: string, padding: number) {
  const r = await page.evaluate(([id, pad]) => {
    type Cam = { position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void; updateProjectionMatrix: () => void };
    const w = (window as unknown as { __codex: { focusTray: (o: unknown) => { center: [number, number, number] } | null; camera: Cam; controls: { target: { set: (x: number, y: number, z: number) => void }; update: () => void } } }).__codex;
    const f = w.focusTray({ instanciaId: id, padding: pad });
    if (!f) return null;
    const [x, y, z] = f.center;
    w.camera.position.set(x, y + 0.9, z + 0.001); // visor en Y arriba: desde arriba
    w.camera.lookAt(x, y, z);
    w.camera.updateProjectionMatrix();
    w.controls.target.set(x, y, z);
    w.controls.update();
    return f;
  }, [instanciaId, padding] as const);
  expect(r, `la pieza ${instanciaId} tiene malla en la escena`).not.toBeNull();
  await page.waitForTimeout(400);
}

test.describe('Derivación en un tramo', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('perforada: tronco 300, derivación de 100 → sólo la DCPS-100-Z con su boca libre; se continúa con un recto de 100', async ({ page }) => {
    await openBandejas(page);
    const tronco = await crearTronco(page, 'SAM_TRPS-300-22-Z');
    expect(tronco.longitud_mm).toBe(3000);

    await crearDerivacion(page, tronco.instancia_id, 100);
    await expect(page.getByTestId('der-msg')).toHaveText('Derivación ENG-1 creada: DCPS-100-Z colocada, su boca queda libre para continuar.');
    await expect(page.getByTestId('der-advertencia')).toContainText('DCPS-100-Z: cota de boca NO CONFIRMADA — no hay STEP propio de este ancho; se generó con la planta y el sobreancho (1.315 mm) de la DCPS-50 medida.');
    let s = await estado(page);
    // Sólo la DCPS: ninguna bandeja nueva, ninguna conexión.
    expect(s.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-Z', 'SAM_DCPS-100-Z']);
    expect(s.conexiones).toEqual([]);
    expect(s.piezas[0]).toEqual(tronco);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('enganche-row')).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('enganche-accesorio')).toHaveText('Accesorio: DCPS-100-Z (se computa)');
    // La boca de la DCPS es un extremo libre, junto con las dos del tronco.
    await expect(page.getByTestId('free-end')).toHaveCount(3);
    await expect(page.getByTestId('free-end').filter({ hasText: /DCPS-100-Z/ })).toHaveCount(1);
    await page.screenshot({ path: resolve(OUT_DIR, 'derivacion-01-perforada-dcps-sola.png') });

    // Desde la boca libre de la DCPS, por el camino normal, un recto de 100.
    const recto = await continuarDesde(page, /DCPS-100-Z/, 'SAM_TRPS-100-22-Z', 1000);
    s = await estado(page);
    expect(s.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-Z', 'SAM_DCPS-100-Z', 'SAM_TRPS-100-22-Z']);
    expect(s.piezas[0]).toEqual(tronco);
    expect(s.conexiones.map((c) => [c.a, c.b])).toEqual([[[s.piezas[1].instancia_id, 'P1'], [recto.instancia_id, 'P1']]]);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('join-row')).toHaveCount(1);
    await expect(page.getByTestId('join-row')).toHaveAttribute('data-join-ok', 'true');
    // El recto nace en la boca de la DCPS, sobre el flanco del tronco (y = 150 + 80,542), y sale perpendicular.
    expect(recto.puertos.P1.posicion_mm[0]).toBeCloseTo(1500, 3);
    expect(recto.puertos.P1.posicion_mm[1]).toBeCloseTo(230.542, 3);
    expect(recto.puertos.P2.posicion_mm[1] - recto.puertos.P1.posicion_mm[1]).toBeCloseTo(1000, 3);
    await vistaEnganche(page, s.piezas[1].instancia_id, 0.25);
    await page.locator('canvas').first().screenshot({ path: resolve(OUT_DIR, 'derivacion-02-perforada-continuada.png') });

    // Recorrido: tronco → enganche → DCPS (su longitud) → recto continuado.
    await recorrido(page, [tronco.instancia_id, 'P1'], [recto.instancia_id, 'P2']);
    await expect(page.getByTestId('recorrido-total')).toContainText('Longitud total: 2.580,5 mm · 3 pieza(s)');
    await expect(page.getByTestId('recorrido-pieza').nth(0)).toContainText('1.500,0 mm (hasta el enganche, guardada)');
    await expect(page.getByTestId('recorrido-pieza').nth(1)).toContainText('80,5 mm (regla guardada al colocar)');

    // El motor computa 1 DCPS-100-Z y el tronco conserva su largo.
    const res = await calcular(page);
    expect(res.status).toBe('vigente');
    expect(res.lineas.filter((l) => l.producto_id === 'SAM_DCPS-100-Z')).toEqual([{ producto_id: 'SAM_DCPS-100-Z', cantidad: 1 }]);
    expect((await estado(page)).piezas[0].longitud_mm).toBe(3000);
  });

  test('escalera: tronco 300, derivación a mitad de tramo → sólo la boca libre, ninguna pieza; se continúa con un recto de 150', async ({ page }) => {
    await openBandejas(page);
    const tronco = await crearTronco(page, 'SAM_TRES-300-065-18-Z');
    await crearDerivacion(page, tronco.instancia_id, 150);
    await expect(page.getByTestId('der-msg')).toHaveText('Derivación ENG-1 creada: boca libre sobre el flanco, sin accesorio (escalera), lista para continuar.');
    let s = await estado(page);
    expect(s.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRES-300-065-18-Z']);
    expect(s.conexiones).toEqual([]);
    expect(s.piezas[0]).toEqual(tronco);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('enganche-row')).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('enganche-accesorio')).toContainText('sin accesorio por familia — escalera: la derivación no consume accesorio; se arma cortando en obra');
    // La boca sobre el flanco es un extremo libre legítimo: las 2 del tronco + la boca.
    await expect(page.getByTestId('free-end')).toHaveCount(3);
    await expect(page.getByTestId('free-end').filter({ hasText: /Boca de derivación ENG-1/ })).toHaveCount(1);
    await page.screenshot({ path: resolve(OUT_DIR, 'derivacion-03-escalera-boca.png') });

    const recto = await continuarDesde(page, /Boca de derivación ENG-1/, 'SAM_TRES-150-065-18-Z', 1000);
    s = await estado(page);
    expect(s.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRES-300-065-18-Z', 'SAM_TRES-150-065-18-Z']);
    // La boca no es del catálogo: ninguna conexión; lo continuado es la salida del enganche.
    expect(s.conexiones).toEqual([]);
    expect(s.enganches.map((e) => e.salida)).toEqual([[recto.instancia_id, 'P1']]);
    expect(recto.puertos.P1.posicion_mm[1]).toBeCloseTo(150, 3);
    // Quedan las 2 bocas del tronco y el final del recto.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('free-end')).toHaveCount(3);
    await expect(page.getByTestId('free-end').filter({ hasText: /Boca de derivación/ })).toHaveCount(0);
    await vistaEnganche(page, recto.instancia_id, 0.05);
    await page.locator('canvas').first().screenshot({ path: resolve(OUT_DIR, 'derivacion-04-escalera-continuada.png') });

    await recorrido(page, [tronco.instancia_id, 'P1'], [recto.instancia_id, 'P2']);
    await expect(page.getByTestId('recorrido-total')).toContainText('Longitud total: 2.500,0 mm · 2 pieza(s)');

    const res = await calcular(page);
    expect(res.status).toBe('vigente');
    const computados = [...new Set(res.lineas.map((l) => l.producto_id).filter((x): x is string => !!x))];
    expect(computados.filter((id) => /DCPS|^SAM_TS-/.test(id))).toEqual([]);
    expect(res.lineas.filter((l) => l.producto_id === 'SAM_TRES-150-065-18-Z')).toEqual([{ producto_id: 'SAM_TRES-150-065-18-Z', cantidad: 1 }]);
  });
});
