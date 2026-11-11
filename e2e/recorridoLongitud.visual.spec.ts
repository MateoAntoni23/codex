/**
 * E2E — recorrido entre dos bocas y su longitud (etapa Conexiones).
 *
 * La cadena se arma con gestos reales en Bandejas:
 *   recto 1 → curva plana 90 → recto 2000 → T (tronco) → recto 1500 por el tronco
 *                                                     └→ recto 1500 por la derivación
 *                                                          → curva vertical (CUPS) → recto 1000
 * Luego, en Conexiones, el operador elige origen y destino:
 *   1. por el tronco de la T: longitud total = suma de lo persistido (largo de
 *      cada recto, longitud de eje guardada de la curva, longitud guardada al
 *      colocar la T), con la lista de piezas atravesadas;
 *   2. por la derivación de la T: COMPLETA (semiejes guardados al colocar la T);
 *   3. por la derivación y la curva vertical: COMPLETA (línea media del perfil
 *      guardada al colocar la CUPS), con la procedencia a la vista;
 *   4. control negativo: una T sin longitudes guardadas (como una colocada antes
 *      de la regla) vuelve a dar INCOMPLETA, diciendo qué falta;
 *   5. una unión que no cumple no se atraviesa: "sin camino" con el motivo.
 *      Esa unión se registra por el store (el diálogo de Unir extremos permite
 *      registrar una unión que no cumple; acá se evita el diálogo nativo).
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'output');

type V3 = [number, number, number];
type PiezaJs = {
  instancia_id: string; producto_id: string; longitud_mm?: number; longitud_eje_mm?: number;
  puertos: Record<string, { posicion_mm: V3 }>;
  colocacion?: { longitudes_eje?: Record<string, { mm: number; procedencia: string }> };
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

const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] } } } } }).__codex.trayStore.getState().entrada.piezas);

async function continueFrom(page: Page, freeEnd: RegExp, productoId: string, opts: { entryPort?: string; side?: 'left' | 'right'; length?: number } = {}) {
  const before = (await piezas(page)).length;
  await page.getByTestId('free-end').filter({ hasText: freeEnd }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  if (opts.entryPort) await page.locator(`[data-codex-routing-entry-port="${opts.entryPort}"]`).click();
  if (opts.side) await page.locator(`[data-codex-routing-hand="${opts.side}"]`).click();
  if (opts.length) await page.locator('[data-codex-routing-length-input]').fill(String(opts.length));
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('Unión accesorio–accesorio autorizada (E2E recorrido)');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

/** Valor de la opción cuyo texto contiene `texto` (las opciones llevan nombres visibles). */
async function elegir(page: Page, testid: string, pieza: string, boca: string) {
  const value = await page.evaluate(([tid, p, b]) => {
    const sel = document.querySelector(`[data-testid="${tid}"]`) as HTMLSelectElement;
    return Array.from(sel.options).find((o) => o.value === `${p}\u0000${b}`)?.value ?? null;
  }, [testid, pieza, boca] as const);
  expect(value, `${testid}: ${pieza}.${boca}`).not.toBeNull();
  await page.getByTestId(testid).selectOption(value!);
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test.describe('Recorrido entre dos bocas', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('longitud completa por el tronco, la derivación y la curva vertical; control negativo; unión inválida corta el camino', async ({ page }) => {
    await openBandejas(page);
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continueFrom(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'right' });
    await continueFrom(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    await continueFrom(page, /^↗ 3\. TRPS-300-22-Z · Boca x_max/, 'SAM_TPS-300-Z', { entryPort: 'tronco_P1', side: 'right' });
    await continueFrom(page, /^↗ 4\. TPS-300-Z · Tronco \(salida\)/, 'SAM_TRPS-300-22-Z', { length: 1500 });
    await continueFrom(page, /^↗ 4\. TPS-300-Z · Boca de derivación/, 'SAM_TRPS-300-22-Z', { length: 1500 });
    await continueFrom(page, /^↗ 6\. TRPS-300-22-Z · Boca x_max/, 'SAM_CUPS-300-A-Z', { entryPort: 'P1_horizontal' });
    await continueFrom(page, /^↗ 7\. CUPS-300-A-Z · Boca vertical/, 'SAM_TRPS-300-22-Z', { length: 1000 });

    const ps = await piezas(page);
    expect(ps.map((p) => p.producto_id)).toEqual([
      'SAM_TRPS-300-22-Z', 'SAM_CPS-300-90-Z', 'SAM_TRPS-300-22-Z', 'SAM_TPS-300-Z', 'SAM_TRPS-300-22-Z', 'SAM_TRPS-300-22-Z',
      'SAM_CUPS-300-A-Z', 'SAM_TRPS-300-22-Z',
    ]);
    const [r1, curva, r2, tee, rTronco, rDeriv, cups, rVert] = ps;
    // Lo persistido AL COLOCAR, leído aparte para el control.
    expect(typeof curva.longitud_eje_mm).toBe('number');
    const LT = tee.colocacion!.longitudes_eje!;
    expect(Object.keys(LT).sort()).toEqual(['boca_derivacion|tronco_P1', 'boca_derivacion|tronco_P2', 'tronco_P1|tronco_P2']);
    const LC = cups.colocacion!.longitudes_eje!['P1_horizontal|P2_vertical'];
    expect(LC.mm).toBeCloseTo(227.588, 3);
    expect(cups.longitud_eje_mm).toBe(LC.mm);
    // El tronco de la T guardado coincide con la distancia entre sus bocas.
    expect(Math.abs(LT['tronco_P1|tronco_P2'].mm - dist(tee.puertos.tronco_P1.posicion_mm, tee.puertos.tronco_P2.posicion_mm))).toBeLessThan(0.05);
    const fmt = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const base = r1.longitud_mm! + curva.longitud_eje_mm! + r2.longitud_mm!;
    const esperado = base + LT['tronco_P1|tronco_P2'].mm + rTronco.longitud_mm!;
    const porDerivacion = base + LT['boca_derivacion|tronco_P1'].mm + rDeriv.longitud_mm!;
    const porCups = porDerivacion + LC.mm + rVert.longitud_mm!;

    await page.getByTestId('stage-tab-conexiones').click();
    await expect(page.getByTestId('recorrido')).toBeVisible();

    // 1. Por el tronco: total.
    await elegir(page, 'recorrido-origen', r1.instancia_id, 'P1');
    await elegir(page, 'recorrido-destino', rTronco.instancia_id, 'P2');
    const total = page.getByTestId('recorrido-total');
    await expect(total).toBeVisible();
    await expect(total).toContainText(`Longitud total: ${fmt(esperado)} mm`);
    await expect(page.getByTestId('recorrido-pieza')).toHaveCount(5);
    await expect(page.getByTestId('recorrido-pieza').nth(1)).toContainText('longitud de eje guardada');
    await expect(page.getByTestId('recorrido-pieza').nth(3)).toContainText('regla guardada al colocar');
    await page.screenshot({ path: resolve(OUT_DIR, 'recorrido-01-total.png') });

    // 2. Por la derivación: COMPLETA.
    await elegir(page, 'recorrido-destino', rDeriv.instancia_id, 'P2');
    await expect(page.getByTestId('recorrido-incompleto')).toHaveCount(0);
    await expect(page.getByTestId('recorrido-total')).toContainText(`Longitud total: ${fmt(porDerivacion)} mm`);
    await expect(page.getByTestId('recorrido-pieza').nth(3)).toContainText('Tronco (entrada) → Boca de derivación');
    await expect(page.getByTestId('recorrido-procedencia').first()).toContainText('modelo medido (patrón master:perforada:tee_simetrica): centro = punto común a los ejes de las 3 bocas');
    await page.screenshot({ path: resolve(OUT_DIR, 'recorrido-02-derivacion.png') });

    // 3. Por la derivación y la curva vertical: COMPLETA.
    await elegir(page, 'recorrido-destino', rVert.instancia_id, 'P2');
    await expect(page.getByTestId('recorrido-total')).toContainText(`Longitud total: ${fmt(porCups)} mm · 7 pieza(s)`);
    await expect(page.getByTestId('recorrido-pieza').nth(5)).toContainText('227,6 mm (regla guardada al colocar)');
    await expect(page.getByTestId('recorrido-procedencia').nth(1)).toContainText('modelo medido (perfil del STEP CUPS-300-A-Z');
    await page.screenshot({ path: resolve(OUT_DIR, 'recorrido-03-curva-vertical.png') });

    // 4. Control negativo: sin las longitudes guardadas (T colocada antes de la regla),
    //    el desvío por la derivación vuelve a quedar incompleto.
    await page.evaluate((id) => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] }; edit: (e: unknown) => void } } } };
      const st = w.__codex.trayStore.getState();
      const next = structuredClone(st.entrada);
      delete next.piezas.find((x) => x.instancia_id === id)!.colocacion!.longitudes_eje;
      st.edit(next);
    }, tee.instancia_id);
    await expect(page.getByTestId('recorrido-total')).toHaveCount(0);
    await expect(page.getByTestId('recorrido-incompleto')).toContainText('falta la longitud de 1 pieza(s)');
    await expect(page.getByTestId('recorrido-pieza').nth(3)).toContainText('sin longitud: desvío de tronco_P1 a boca_derivacion');
    await page.screenshot({ path: resolve(OUT_DIR, 'recorrido-04-control-negativo.png') });
    await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { undo: () => void } } } }).__codex.trayStore.getState().undo());
    await expect(page.getByTestId('recorrido-total')).toContainText(`Longitud total: ${fmt(porCups)} mm`);

    // 5. Una unión que no cumple corta el camino: se reemplaza la unión recto 2 – T
    //    por una registrada entre la salida del recto 2 y la derivación de la T
    //    (bocas separadas: hueco), como permite "Unir extremos". Es el único paso.
    await page.evaluate(([a, b]) => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }> }; edit: (e: unknown) => void } } } };
      const s = w.__codex.trayStore.getState();
      const next = structuredClone(s.entrada);
      next.conexiones = next.conexiones.filter((c) => !(c.a[0] === a || c.b[0] === a) || !(c.a[0] === b || c.b[0] === b));
      next.conexiones.push({ conexion_id: 'CON-INVALIDA', a: [a, 'P2'], b: [b, 'boca_derivacion'] });
      s.edit(next);
    }, [r2.instancia_id, tee.instancia_id] as const);
    await elegir(page, 'recorrido-destino', rTronco.instancia_id, 'P2');
    const sin = page.getByTestId('recorrido-sin-camino');
    await expect(sin).toContainText('no hay camino por uniones válidas: la unión CON-INVALIDA no cumple la verificación y no se atraviesa');
    await expect(page.getByTestId('recorrido-union-cortada')).toContainText(/hueco \d+\.\d+ mm > 1 mm/);
    await expect(page.getByTestId('recorrido-total')).toHaveCount(0);
    await page.screenshot({ path: resolve(OUT_DIR, 'recorrido-05-sin-camino.png') });
  });
});
