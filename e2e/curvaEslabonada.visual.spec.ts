/**
 * E2E — curvas eslabonadas (EPS perforada, CUS escalera), ángulo por instancia,
 * con gestos reales. Regla declarada por el operador: N = techo(θ/22,5°)+1,
 * radio = ancho, eje = N−1 cuerdas.
 *
 * Perforada 300: curva a 90° → 5 EPS-300-Z. Se cambia a 45° → 3; la boca de
 * salida y la longitud se recalculan, y la unión con el recto que seguía queda
 * desactualizada con su motivo.
 * Escalera 300 ala 65: CUATRO curvas de 45° (3 eslabones cada una, 12 en total)
 * → techo(12/5) = 3 códigos CUS-300-5-065-18-Z. Redondear curva por curva
 * daría 4 (1 por curva): ése es el error a evitar.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');
type V3 = [number, number, number];
type PiezaJs = { instancia_id: string; producto_id: string; longitud_eje_mm?: number; puertos: Record<string, { posicion_mm: V3; direccion: V3 }> };
const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] } } } } }).__codex.trayStore.getState().entrada.piezas);

async function openBandejas(page: Page) {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
}

async function crearTronco(page: Page, productoId: string) {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await piezas(page)).length).toBe(1);
}

/** Continuar desde un extremo libre por el camino normal. */
async function continuar(page: Page, extremo: RegExp, productoId: string, opts: { sentido?: 'sube' | 'baja'; largo?: number } = {}) {
  const antes = (await piezas(page)).length;
  await page.getByTestId('tool-bandejas-seleccionar').click();
  await page.getByTestId('free-end').filter({ hasText: extremo }).first().click();
  await page.locator('[data-codex-routing-product-select]').selectOption(productoId);
  if (opts.sentido) {
    await page.locator('[data-codex-routing-entry-port="P1"]').click();
    await page.locator(`[data-codex-routing-vertical="${opts.sentido}"]`).click();
  }
  if (opts.largo) await page.locator('[data-codex-routing-length-input]').fill(String(opts.largo));
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(antes + 1);
  return (await piezas(page))[antes];
}

/** Abrir la ficha de la pieza y cambiar el ángulo. */
async function cambiarAngulo(page: Page, pieza: string, angulo: number) {
  await page.getByTestId('tool-bandejas-seleccionar').click();
  await page.locator(`[data-row-key="piece:${pieza}"]`).click();
  await page.getByTestId('eslabonada-angulo').fill(String(angulo));
  await page.getByTestId('eslabonada-aplicar').click();
  await expect(page.getByTestId('eslabonada-resumen')).toHaveAttribute('data-angulo', String(angulo));
}

test.describe('Curvas eslabonadas', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('perforada 300: 90° → 5 EPS-300-Z; a 45° → 3, con boca de salida y longitud recalculadas', async ({ page }) => {
    await openBandejas(page);
    await crearTronco(page, 'SAM_TRPS-300-22-Z');
    const curva = await continuar(page, /^↗ 1\. .*Boca x_max/, 'SAM_EPS-300-Z', { sentido: 'sube' });
    // 90° por defecto, sube: la boca de salida mira hacia arriba, a radio 300 del giro.
    const p1 = curva.puertos.P1.posicion_mm;
    const p2a = curva.puertos.P2.posicion_mm;
    expect(curva.puertos.P2.direccion[2]).toBeCloseTo(1, 6);
    expect(p2a[0] - p1[0]).toBeCloseTo(300, 3);
    expect(p2a[2] - p1[2]).toBeCloseTo(300, 3);
    const eje90 = 4 * 2 * 300 * Math.sin((11.25 * Math.PI) / 180); // 4 cuerdas de 22,5°
    expect(curva.longitud_eje_mm).toBeCloseTo(eje90, 3);
    // Un recto vertical sigue desde la boca de salida (unión que cumple).
    await continuar(page, /^↗ 2\. EPS-300-Z · Boca de salida/, 'SAM_TRPS-300-22-Z', { largo: 1000 });
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('join-row')).toHaveCount(2);
    await expect(page.getByTestId('join-row').nth(1)).toHaveAttribute('data-join-ok', 'true');

    // Resultados: 5 eslabones → 5 × EPS-300-Z.
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('eslabonada-curva-row')).toHaveAttribute('data-eslabones', '5');
    await expect(page.getByTestId('eslabonada-compra-row')).toHaveAttribute('data-codigos', '5');
    await expect(page.getByTestId('eslabonada-compra-row')).toContainText('EPS-300-Z: 5');

    // Cambio a 45° en la ficha: 3 eslabones, la boca de salida y la longitud se recalculan.
    await page.getByTestId('stage-tab-bandejas').click();
    await cambiarAngulo(page, curva.instancia_id, 45);
    await expect(page.getByTestId('eslabonada-resumen')).toHaveAttribute('data-eslabones', '3');
    // La unión con el recto que seguía ya no cumple: queda a la vista con su motivo.
    await expect(page.getByTestId('eslabonada-msg')).toContainText('dejaron de cumplir');
    const despues = (await piezas(page)).find((p) => p.instancia_id === curva.instancia_id)!;
    expect(despues.puertos.P1.posicion_mm).toEqual(p1);
    expect(despues.puertos.P2.posicion_mm[0] - p1[0]).toBeCloseTo(300 * Math.sin(Math.PI / 4), 3);
    expect(despues.puertos.P2.posicion_mm[2] - p1[2]).toBeCloseTo(300 - 300 * Math.cos(Math.PI / 4), 3);
    expect(despues.longitud_eje_mm).toBeCloseTo(2 * 2 * 300 * Math.sin((11.25 * Math.PI) / 180), 3);
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('join-row').nth(1)).toHaveAttribute('data-join-ok', 'false');
    await expect(page.getByTestId('join-row').nth(1)).toContainText('no cumple');

    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('eslabonada-compra-row')).toHaveAttribute('data-codigos', '3');
    // El motor real acepta la curva eslabonada y calcula; su línea de 1 pieza queda marcada como reemplazada.
    await page.getByTestId('reserva-input').fill('20');
    await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
    await page.getByTestId('calculate-tray').click();
    await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
    const lineaEps = await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { result: { computo: { lineas: Array<{ producto_id: string | null; cantidad: number | null }> } } } } } })
      .__codex.trayStore.getState().result.computo.lineas.filter((l) => l.producto_id === 'SAM_EPS-300-Z'));
    expect(lineaEps, 'el motor cuenta 1 pieza por instancia (D-18)').toEqual([expect.objectContaining({ cantidad: 1 })]);
    await expect(page.getByText('curva eslabonada: reemplazada por la cuenta de eslabones').first()).toBeAttached();
    await page.screenshot({ path: resolve(OUT_DIR, 'eslabonada-01-perforada.png') });
  });

  test('escalera 300 ala 65: cuatro curvas de 45° = 12 eslabones → 3 códigos CUS (no 4)', async ({ page }) => {
    await openBandejas(page);
    await crearTronco(page, 'SAM_TRES-300-065-18-Z');
    let extremo = /^↗ 1\. .*Boca x_max/;
    for (let k = 0; k < 4; k++) {
      const c = await continuar(page, extremo, 'SAM_CUS-300-5-065-18-Z', { sentido: 'sube' });
      await cambiarAngulo(page, c.instancia_id, 45);
      extremo = new RegExp(`^↗ ${k + 2}\\. CUS-300-5-065-18-Z · Boca de salida`);
    }
    await page.getByTestId('stage-tab-resultados').click();
    const filas = page.getByTestId('eslabonada-curva-row');
    await expect(filas).toHaveCount(4);
    for (let k = 0; k < 4; k++) await expect(filas.nth(k)).toHaveAttribute('data-eslabones', '3');
    const compra = page.getByTestId('eslabonada-compra-row');
    await expect(compra).toHaveCount(1);
    await expect(compra).toHaveAttribute('data-producto', 'SAM_CUS-300-5-065-18-Z');
    await expect(compra).toHaveAttribute('data-eslabones', '12');
    // techo(12/5) = 3. Curva por curva serían 4 × techo(3/5) = 4: el error a evitar.
    await expect(compra).toHaveAttribute('data-codigos', '3');
    await expect(compra).toContainText('techo(12/5) = 3');
    await page.screenshot({ path: resolve(OUT_DIR, 'eslabonada-02-escalera.png') });
  });
});
