/**
 * E2E — derivación en un tramo, con gestos reales, las dos familias.
 *
 * Perforada: tronco de 300 (3000 mm), enganche a mitad de tramo, ramal de 100.
 *   La unión es válida, se computa DCPS-100-Z (cómputo del motor), el recorrido
 *   por el ramal da longitud completa y el tronco conserva su largo y sus bocas.
 * Escalera: tronco de 300, enganche, ramal de 150. Unión válida, NO se computa
 *   accesorio, el recorrido por el ramal da longitud completa.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');

type V3 = [number, number, number];
type PiezaJs = { instancia_id: string; producto_id: string; longitud_mm?: number; puertos: Record<string, { posicion_mm: V3; direccion: V3 }> };
type W = { __codex: { trayStore: { getState: () => {
  entrada: { piezas: PiezaJs[]; conexiones: Array<{ conexion_id: string }> };
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
  return { piezas: s.entrada.piezas, conexiones: s.entrada.conexiones };
});

async function crearTronco(page: Page, productoId: string) {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await estado(page)).piezas.length).toBe(1);
  return (await estado(page)).piezas[0];
}

async function crearDerivacion(page: Page, tronco: string, ramal: string, largo: number) {
  await page.getByTestId('tool-bandejas-derivacion').click();
  await page.getByTestId('der-tronco').selectOption(tronco);
  await page.getByTestId('der-desde').selectOption('P1');
  await page.getByTestId('der-distancia').fill('1500');
  await page.getByTestId('der-lado').selectOption('izquierda');
  await page.getByTestId('der-ramal').selectOption(ramal);
  await page.getByTestId('der-ramal-largo').fill(String(largo));
  await page.getByTestId('der-crear').click();
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

test.describe('Derivación en un tramo', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('perforada: tronco 300, ramal 100 a mitad de tramo → DCPS-100-Z computada, recorrido completo, tronco intacto', async ({ page }) => {
    await openBandejas(page);
    const tronco = await crearTronco(page, 'SAM_TRPS-300-22-Z');
    expect(tronco.longitud_mm).toBe(3000);

    await crearDerivacion(page, tronco.instancia_id, 'SAM_TRPS-100-22-Z', 1000);
    await expect(page.getByTestId('der-msg')).toHaveText('Derivación ENG-1 creada con DCPS-100-Z.');
    const s = await estado(page);
    expect(s.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-Z', 'SAM_DCPS-100-Z', 'SAM_TRPS-100-22-Z']);
    // El tronco no se cortó ni cambió.
    expect(s.piezas[0]).toEqual(tronco);
    // La unión DCPS ↔ ramal es válida (B-3); entre tronco y ramal no hay conexión.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    const fila = page.getByTestId('join-row');
    await expect(fila).toHaveCount(1);
    await expect(fila).toHaveAttribute('data-join-ok', 'true');
    await expect(page.getByTestId('enganche-row')).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('enganche-accesorio')).toHaveText('Accesorio: DCPS-100-Z (se computa)');
    await expect(page.getByTestId('free-end')).toHaveCount(3);
    await page.screenshot({ path: resolve(OUT_DIR, 'derivacion-01-perforada.png') });

    // Recorrido del tronco al final del ramal: completo (1500 + 80,542 + 1000).
    const ramal = s.piezas[2].instancia_id;
    await recorrido(page, [tronco.instancia_id, 'P1'], [ramal, 'P2']);
    await expect(page.getByTestId('recorrido-total')).toContainText('Longitud total: 2.580,5 mm · 3 pieza(s)');
    await expect(page.getByTestId('recorrido-pieza').nth(0)).toContainText('1.500,0 mm (hasta el enganche, guardada)');
    await expect(page.getByTestId('recorrido-pieza').nth(1)).toContainText('80,5 mm (regla guardada al colocar)');
    await page.screenshot({ path: resolve(OUT_DIR, 'derivacion-02-recorrido.png') });

    // El motor computa la DCPS-100-Z (1 pieza) y el tronco conserva su largo.
    const res = await calcular(page);
    expect(res.status).toBe('vigente');
    expect(res.lineas.filter((l) => l.producto_id === 'SAM_DCPS-100-Z')).toEqual([{ producto_id: 'SAM_DCPS-100-Z', cantidad: 1 }]);
    expect((await estado(page)).piezas[0].longitud_mm).toBe(3000);
  });

  test('escalera: tronco 300, ramal 150 → sin accesorio (explícito), nada computado de más, recorrido completo', async ({ page }) => {
    await openBandejas(page);
    const tronco = await crearTronco(page, 'SAM_TRES-300-065-18-Z');
    await crearDerivacion(page, tronco.instancia_id, 'SAM_TRES-150-065-18-Z', 1000);
    await expect(page.getByTestId('der-msg')).toHaveText('Derivación ENG-1 creada sin accesorio (escalera).');
    const s = await estado(page);
    expect(s.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRES-300-065-18-Z', 'SAM_TRES-150-065-18-Z']);
    expect(s.conexiones).toEqual([]);
    expect(s.piezas[0]).toEqual(tronco);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('enganche-row')).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('enganche-accesorio')).toContainText('sin accesorio por familia — escalera: la derivación no consume accesorio; se arma cortando en obra');
    // La boca del ramal enganchada al flanco no es un extremo libre: quedan las 2 del tronco y el final del ramal.
    await expect(page.getByTestId('free-end')).toHaveCount(3);
    await page.screenshot({ path: resolve(OUT_DIR, 'derivacion-03-escalera.png') });

    await recorrido(page, [tronco.instancia_id, 'P1'], [s.piezas[1].instancia_id, 'P2']);
    await expect(page.getByTestId('recorrido-total')).toContainText('Longitud total: 2.500,0 mm · 2 pieza(s)');

    const res = await calcular(page);
    expect(res.status).toBe('vigente');
    const productosComputados = [...new Set(res.lineas.map((l) => l.producto_id).filter((x): x is string => !!x))];
    expect(productosComputados.filter((id) => /DCPS|^SAM_TS-/.test(id))).toEqual([]);
    expect(res.lineas.filter((l) => l.producto_id === 'SAM_TRES-150-065-18-Z')).toEqual([{ producto_id: 'SAM_TRES-150-065-18-Z', cantidad: 1 }]);
  });
});
