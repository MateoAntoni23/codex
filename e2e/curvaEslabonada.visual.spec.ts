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
import { elegirPieza } from './helpers/selectorPieza';
import { verPestana } from './helpers/interfaz';
import * as THREE from 'three';
import { buildRecipeByKey } from '../src/parametric/geometry/recipes';
import { definitionFromRecipe, definitionHash, placeDefinition, puertosFromWorld } from '../src/workspace/placement/placementCore';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');
/** EPS: radio interior 260 (gráfico del catálogo, 22,5° por articulación) + ala 50/2. */
const R_EJE_EPS = 260 + 50 / 2;
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
  await elegirPieza(page, productoId);
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
    // 90° por defecto, sube: la boca de salida mira hacia arriba, a radio de EJE del giro.
    // Regla 2026-11-15: radio interior EPS 260 (gráfico, 22,5° por articulación) + ala 50/2 = 285.
    const p1 = curva.puertos.P1.posicion_mm;
    const p2a = curva.puertos.P2.posicion_mm;
    expect(curva.puertos.P2.direccion[2]).toBeCloseTo(1, 6);
    expect(p2a[0] - p1[0]).toBeCloseTo(R_EJE_EPS, 3);
    expect(p2a[2] - p1[2]).toBeCloseTo(R_EJE_EPS, 3);
    const eje90 = 4 * 2 * R_EJE_EPS * Math.sin((11.25 * Math.PI) / 180); // 4 cuerdas de 22,5°
    expect(curva.longitud_eje_mm).toBeCloseTo(eje90, 3);
    // Un recto vertical sigue desde la boca de salida (unión que cumple).
    await continuar(page, /^↗ 2\. EPS-300-Z · Boca de salida/, 'SAM_TRPS-300-22-Z', { largo: 1000 });
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('join-row')).toHaveCount(2);
    await expect(page.getByTestId('join-row').nth(1)).toHaveAttribute('data-join-ok', 'true');

    // Resultados: 5 eslabones → 5 × EPS-300-Z.
    await page.getByTestId('stage-tab-resultados').click();
    await verPestana(page, 'computo');
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
    expect(despues.puertos.P2.posicion_mm[0] - p1[0]).toBeCloseTo(R_EJE_EPS * Math.sin(Math.PI / 4), 3);
    expect(despues.puertos.P2.posicion_mm[2] - p1[2]).toBeCloseTo(R_EJE_EPS - R_EJE_EPS * Math.cos(Math.PI / 4), 3);
    expect(despues.longitud_eje_mm).toBeCloseTo(2 * 2 * R_EJE_EPS * Math.sin((11.25 * Math.PI) / 180), 3);
    // 20° (N = 2) se rechaza con el mínimo, el porqué y la alternativa; el ángulo no cambia.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.locator(`[data-row-key="piece:${curva.instancia_id}"]`).click();
    await page.getByTestId('eslabonada-angulo').fill('20');
    await page.getByTestId('eslabonada-aplicar').click();
    await expect(page.getByTestId('eslabonada-msg')).toContainText('más de 22,5°');
    await expect(page.getByTestId('eslabonada-msg')).toContainText('el gráfico de radios del catálogo arranca en 3 eslabones');
    await expect(page.getByTestId('eslabonada-msg')).toContainText('curva ajustable CAS, de 1° a 90°');
    await expect(page.getByTestId('eslabonada-resumen')).toHaveAttribute('data-angulo', '45');
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await expect(page.getByTestId('join-row').nth(1)).toHaveAttribute('data-join-ok', 'false');
    await expect(page.getByTestId('join-row').nth(1)).toContainText('no cumple');

    await page.getByTestId('stage-tab-resultados').click();
    await verPestana(page, 'computo');
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
    await verPestana(page, 'computo');
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

  test('regla de radio 2026-11-15: piezas de la regla anterior quedan desactualizadas con el motivo; a 20° no se pueden actualizar', async ({ page }) => {
    await openBandejas(page);
    // Dos EPS-300 guardadas como las dejaba la regla anterior (radio de eje = ancho = 300, sin
    // radio_interior_mm): una a 90° y otra a 20° (N = 2, que hoy se rechaza).
    const vieja = (instancia: string, anguloReceta: number, anguloGuardado: number, y: number) => {
      const raw = buildRecipeByKey('curva_eslabonada', { ancho_mm: 300, ala_mm: 50, angulo_deg: anguloReceta, sentido_vertical: 1, radio_interior_mm: 300 - 25 });
      const def = definitionFromRecipe({
        patron: 'master:perforada:curva_eslabonada', revision: '1',
        params: { ancho_mm: 300, ala_mm: 50, angulo_deg: anguloGuardado, sentido_vertical: 1 },
        raw, resolved: raw, preTransform: new THREE.Matrix4(),
      });
      const huella = definitionHash(def);
      const pl = placeDefinition({ def, huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, y, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
      return { huella, def, pieza: { instancia_id: instancia, producto_id: 'SAM_EPS-300-Z', puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } };
    };
    const a = vieja('E90', 90, 90, 0);
    const b = vieja('E20', 45, 20, 1500);
    await page.evaluate((x) => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { importEdit: (i: unknown) => void } } } };
      w.__codex.trayStore.getState().importEdit({
        version_contrato: 'trazado/1', piezas: [x.a.pieza, x.b.pieza], conexiones: [], circuitos: [], soportes: [],
        pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: 'e2e-radio-eslabonadas', conductores: [] },
        definiciones_ws: { [x.a.huella]: x.a.def, [x.b.huella]: x.b.def },
      });
    }, { a, b });
    await expect.poll(async () => (await piezas(page)).length).toBe(2);

    // Desactualizada, con el motivo de la regla (antes y ahora).
    const aviso = page.getByTestId('outdated-notice');
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await aviso.locator('summary').click();
    const motivo = page.locator('[data-testid="outdated-motivo"][data-pieza="E90"]');
    await expect(motivo).toContainText('cambió la regla de radio de las curvas eslabonadas');
    await expect(motivo).toContainText('radio = ancho (300 mm');
    await expect(motivo).toContainText('radio interior 260 mm');
    // A 20°: sin definición vigente, listada con su motivo (no se puede actualizar).
    const sin = page.locator('[data-testid="sin-definicion-motivo"][data-pieza="E20"]');
    await expect(sin).toContainText('más de 22,5°');
    await page.screenshot({ path: resolve(OUT_DIR, 'eslabonada-03-regla-radio.png') });

    // Actualizar: la de 90° pasa a la regla nueva (longitud de eje sobre radio de eje 285).
    await page.getByTestId('update-outdated').click();
    await expect.poll(async () => (await piezas(page)).find((p) => p.instancia_id === 'E90')?.longitud_eje_mm ?? 0)
      .toBeCloseTo(4 * 2 * R_EJE_EPS * Math.sin((11.25 * Math.PI) / 180), 3);
    await expect(page.getByTestId('outdated-notice')).toHaveCount(0);
    await expect(page.locator('[data-testid="sin-definicion-motivo"][data-pieza="E20"]')).toBeVisible();
  });
});
