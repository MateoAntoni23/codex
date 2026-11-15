/**
 * E2E — curva ajustable de escalera (CAS), con gestos reales, 1366×768.
 * Regla del operador (2026-11-14): radio interior = ancho, eje = 1,5 × ancho,
 * ángulo por instancia (90° por defecto), rango 1°–90° provisional. Una pieza por
 * código.
 *
 *   - En el selector de tres pasos, dentro de «curva horizontal», la CAS es una
 *     variante («ángulo ajustable») junto a las de 45° y 90°.
 *   - El ángulo se elige AL COLOCAR: la vista previa se dibuja con él y la pieza
 *     confirmada lo guarda (bocas, giro, longitud de eje = arco).
 *   - Fuera de rango se rechaza con el motivo y el rango: sin vista previa y sin pieza.
 *   - Al seleccionarla se corrige el ángulo (boca de entrada fija); fuera de rango, no.
 *   - Cómputo del motor real: 1 código por curva.
 *
 * Control negativo (verificado a mano, ver el traspaso): si el ángulo elegido no
 * llega a la colocación, esta prueba falla.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elegirPieza } from './helpers/selectorPieza';
import { verPestana } from './helpers/interfaz';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');
const CAS = 'SAM_CAS-300-065-18-Z';
const RAD = Math.PI / 180;
const R_EJE = 450;

test.use({ viewport: { width: 1366, height: 768 } });

type V3 = [number, number, number];
type PiezaJs = {
  instancia_id: string; producto_id: string; longitud_eje_mm?: number;
  puertos: Record<string, { posicion_mm: V3; direccion: V3 }>;
  colocacion?: { definicion?: { params?: Record<string, number> } };
};
const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] } } } } }).__codex.trayStore.getState().entrada.piezas);
const foto = (page: Page, n: string) => page.screenshot({ path: resolve(OUT_DIR, `curva-ajustable-${n}.png`) });
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const giroDeg = (dEntrada: number[], dSalida: number[]) =>
  Math.acos(Math.max(-1, Math.min(1, dEntrada[0] * dSalida[0] + dEntrada[1] * dSalida[1] + dEntrada[2] * dSalida[2]))) / RAD;

/** Giro de la vista previa (bocas de la malla que se dibuja), o null si no hay vista previa. */
async function giroVistaPrevia(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    type Boca = { name: string; outwardNormal: number[] };
    const d = (window as unknown as { __codex: { dumpMeshes: () => Array<{ kind: string; placedPorts?: Boca[] }> } }).__codex.dumpMeshes();
    const prev = d.find((x) => x.kind === 'parametric-preview');
    if (!prev?.placedPorts) return null;
    const p1 = prev.placedPorts.find((p) => p.name === 'P1')!.outwardNormal;
    const p2 = prev.placedPorts.find((p) => p.name === 'P2')!.outwardNormal;
    const c = -(p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  });
}

async function abrir(page: Page) {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
}

async function desde(page: Page, extremo: RegExp) {
  await page.getByTestId('tool-bandejas-seleccionar').click();
  await page.getByTestId('free-end').filter({ hasText: extremo }).first().click();
  await elegirPieza(page, CAS);
}

test.describe('Curva ajustable (CAS)', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('el ángulo se elige al colocar, llega a la pieza, se rechaza fuera de rango, se corrige después y computa 1 código por curva', async ({ page }) => {
    await abrir(page);
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRES-300-065-18-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    const tronco = (await piezas(page))[0];
    const salidaTronco = tronco.puertos.P2 ?? Object.values(tronco.puertos)[1];

    // ── Selector: la CAS es una variante de «curva horizontal», junto a 45° y 90°.
    await desde(page, /TRES-300-065-18-Z · Boca x_max/);
    const variantes = await page.locator('[data-codex-routing-pieza-variante] option').allTextContents();
    expect(variantes.some((t) => /CAS .*ángulo ajustable/.test(t)), variantes.join(' | ')).toBe(true);
    expect(variantes.some((t) => /CS .*45°/.test(t)), variantes.join(' | ')).toBe(true);
    expect(variantes.some((t) => /CS .*90°/.test(t)), variantes.join(' | ')).toBe(true);

    // ── Ángulo al colocar: 90° por defecto; se elige 30° y la vista previa lo dibuja.
    const angulo = page.locator('[data-codex-routing-angulo]');
    await expect(angulo).toBeVisible();
    await expect(angulo).toHaveValue('90');
    await expect.poll(() => giroVistaPrevia(page)).toBeCloseTo(90, 3);
    await angulo.fill('30');
    await expect.poll(() => giroVistaPrevia(page)).toBeCloseTo(30, 3);
    await foto(page, 'vista-previa-30');
    await page.locator('[data-testid="routing-confirmar"]').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(2);

    // ── La pieza colocada lleva el ángulo elegido: definición, bocas, giro y eje (arco).
    const cas1 = (await piezas(page))[1];
    expect(cas1.producto_id).toBe(CAS);
    expect(cas1.colocacion?.definicion?.params?.angulo_deg).toBe(30);
    expect(dist(cas1.puertos.P1.posicion_mm, salidaTronco.posicion_mm)).toBeLessThan(1e-6);
    expect(dist(cas1.puertos.P1.posicion_mm, cas1.puertos.P2.posicion_mm)).toBeCloseTo(2 * R_EJE * Math.sin(15 * RAD), 3);
    const dEntrada = cas1.puertos.P1.direccion.map((x) => -x);
    expect(giroDeg(dEntrada, cas1.puertos.P2.direccion)).toBeCloseTo(30, 3);
    expect(cas1.puertos.P2.posicion_mm[2]).toBeCloseTo(cas1.puertos.P1.posicion_mm[2], 6); // giro horizontal
    expect(cas1.longitud_eje_mm).toBeCloseTo(R_EJE * 30 * RAD, 3);

    // ── Fuera de rango: motivo con el rango, sin vista previa y sin pieza.
    await desde(page, /CAS-300-065-18-Z · Boca de salida/);
    await angulo.fill('120');
    const error = page.getByTestId('routing-placement-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('fuera de rango');
    await expect(error).toContainText('de 1° a 90°');
    await expect.poll(() => giroVistaPrevia(page)).toBeNull();
    await foto(page, 'fuera-de-rango');
    await page.locator('[data-testid="routing-confirmar"]').click();
    await expect(page.locator('text=/No se puede colocar: .*de 1° a 90°/').first()).toBeVisible();
    expect((await piezas(page)).length).toBe(2);
    // Dentro del rango otra vez: se coloca (90°).
    await angulo.fill('90');
    await expect.poll(() => giroVistaPrevia(page)).toBeCloseTo(90, 3);
    await page.locator('[data-testid="routing-confirmar"]').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(3);
    expect((await piezas(page))[2].colocacion?.definicion?.params?.angulo_deg).toBe(90);

    // ── Corregir el ángulo de la primera CAS: boca de entrada fija; fuera de rango no.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.locator(`[data-row-key="piece:${cas1.instancia_id}"]`).click();
    const resumen = page.getByTestId('ajustable-resumen');
    await expect(resumen).toHaveAttribute('data-angulo', '30');
    await page.getByTestId('ajustable-angulo').fill('95');
    await page.getByTestId('ajustable-aplicar').click();
    await expect(page.getByTestId('ajustable-msg')).toContainText('de 1° a 90°');
    await expect(resumen).toHaveAttribute('data-angulo', '30');
    await page.getByTestId('ajustable-angulo').fill('60');
    await page.getByTestId('ajustable-aplicar').click();
    await expect(resumen).toHaveAttribute('data-angulo', '60');
    const corregida = (await piezas(page)).find((p) => p.instancia_id === cas1.instancia_id)!;
    // La boca de entrada no se mueve (ruido de coma flotante ~1e-14 al recolocar).
    expect(dist(corregida.puertos.P1.posicion_mm, cas1.puertos.P1.posicion_mm)).toBeLessThan(1e-6);
    expect(dist(corregida.puertos.P1.direccion, cas1.puertos.P1.direccion)).toBeLessThan(1e-9);
    expect(corregida.colocacion?.definicion?.params?.angulo_deg).toBe(60);
    expect(giroDeg(dEntrada, corregida.puertos.P2.direccion)).toBeCloseTo(60, 3);
    expect(corregida.longitud_eje_mm).toBeCloseTo(R_EJE * 60 * RAD, 3);
    // La CAS que seguía queda con su unión a la vista («no cumple»), no se mueve.
    await expect(page.getByTestId('ajustable-msg')).toContainText('dejaron de cumplir');
    await foto(page, 'corregida-60');

    // ── Cómputo del motor real: 1 código por curva (2 CAS → 2).
    await page.getByTestId('stage-tab-resultados').click();
    await verPestana(page, 'computo');
    await page.getByTestId('reserva-input').fill('20');
    await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
    await page.getByTestId('calculate-tray').click();
    await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
    const lineas = await page.evaluate((id) => (window as unknown as { __codex: { trayStore: { getState: () => { result: { computo: { lineas: Array<{ producto_id: string | null; cantidad: number | null }> } } } } } })
      .__codex.trayStore.getState().result.computo.lineas.filter((l) => l.producto_id === id), CAS);
    expect(lineas.reduce((s, l) => s + (l.cantidad ?? 0), 0)).toBe(2);
    await expect(page.getByTestId('computo-linea-motor').filter({ hasText: 'CAS-300-065-18-Z' }).first()).toBeVisible();
    await foto(page, 'computo');
  });
});
