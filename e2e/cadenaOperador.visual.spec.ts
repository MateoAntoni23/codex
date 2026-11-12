/**
 * E2E hito 2 — PA4 / PA8: la cadena del operador en perforada 300 Z, armada con
 * gestos reales:
 *   recto → curva ascendente → recto → curva plana 90 → recto → curva plana 45 →
 *   T → un recto por cada salida → uno termina en curva descendente → otra T.
 * Todas las uniones cumplen A-7 (hueco ≤ 1 mm, ángulo ≤ 1°, giro ≤ 1°). Las uniones
 * Con la compatibilidad por la regla física del sistema (misma familia, ancho y ala),
 * todas son uniones directas documentadas — incluidas curva 45–T y curva descendente–T,
 * que antes (tabla enumerada como puerta) pedían excepción con motivo. El motor calcula
 * la cadena y todas sus uniones dan COHERENTE.
 */
import { test, expect, type Page } from '@playwright/test';

async function openBandejas(page: Page): Promise<void> {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

const count = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length);

async function continueFrom(page: Page, freeEnd: RegExp, productoId: string, opts: { entryPort?: string; side?: 'left' | 'right'; length?: number; motive?: string } = {}) {
  const before = await count(page);
  await page.getByTestId('free-end').filter({ hasText: freeEnd }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  if (opts.entryPort) await page.locator(`[data-codex-routing-entry-port="${opts.entryPort}"]`).click();
  if (opts.side) await page.locator(`[data-codex-routing-hand="${opts.side}"]`).click();
  if (opts.length) await page.locator('[data-codex-routing-length-input]').fill(String(opts.length));
  const motive = page.locator('[data-codex-routing-exception-motive]');
  const isException = (await motive.count()) > 0;
  if (isException) await motive.fill(opts.motive ?? 'Unión accesorio–accesorio autorizada por el proyectista (E2E PA4)');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(() => count(page)).toBe(before + 1);
  return isException;
}

test.describe('PA4 / PA8 — cadena del operador', () => {
  test.setTimeout(240_000);

  test('todas las uniones cumplen A-7; ninguna excepción (regla física); el motor da COHERENTE', async ({ page }) => {
    await openBandejas(page);
    // 1. recto
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(() => count(page)).toBe(1);

    const exc: string[] = [];
    const step = async (label: string, ...args: Parameters<typeof continueFrom> extends [Page, ...infer R] ? R : never) => {
      if (await continueFrom(page, ...args)) exc.push(label);
    };
    // 2. curva ascendente por su boca horizontal
    await step('recto–curva ascendente', /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CUPS-300-A-Z', { entryPort: 'P1_horizontal' });
    // 3. recto vertical por la boca vertical de la curva
    await step('curva ascendente–recto', /^↗ 2\. CUPS-300-A-Z · Boca vertical/, 'SAM_TRPS-300-22-Z', { length: 1500 });
    // 4. curva plana 90
    await step('recto–curva 90', /^↗ 3\. TRPS-300-22-Z/, 'SAM_CPS-300-90-Z', { side: 'right' });
    // 5. recto
    await step('curva 90–recto', /^↗ 4\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    // 6. curva plana 45
    await step('recto–curva 45', /^↗ 5\. TRPS-300-22-Z/, 'SAM_CPS-300-45-Z', { side: 'left' });
    // 7. T (curva 45 – T: unión directa por la regla del sistema)
    await step('curva 45–T', /^↗ 6\. CPS-300-45-Z/, 'SAM_TPS-300-Z', { entryPort: 'tronco_P1', side: 'right' });
    // 8. un recto por cada salida de la T
    await step('T–recto (tronco)', /^↗ 7\. TPS-300-Z · Tronco \(salida\)/, 'SAM_TRPS-300-22-Z', { length: 1500 });
    await step('T–recto (derivación)', /^↗ 7\. TPS-300-Z · Boca de derivación/, 'SAM_TRPS-300-22-Z', { length: 1500 });
    // 9. uno de ellos termina en curva descendente
    await step('recto–curva descendente', /^↗ 9\. TRPS-300-22-Z/, 'SAM_CUPS-300-D-Z', { entryPort: 'P1_horizontal' });
    // 10. otra T (curva descendente – T: unión directa por la regla del sistema)
    await step('curva descendente–T', /^↗ 10\. CUPS-300-D-Z · Boca vertical/, 'SAM_TPS-300-Z', { entryPort: 'tronco_P1' });

    expect(await count(page)).toBe(11);
    expect(exc, 'ninguna continuación pidió excepción').toEqual([]);

    // A-7: todas las uniones cumplen, verificadas por el panel (hueco, ángulo y giro).
    const rows = page.getByTestId('join-row');
    await expect(rows).toHaveCount(10);
    const states = await rows.evaluateAll((els) => els.map((e) => ({ ok: e.getAttribute('data-join-ok'), estado: e.getAttribute('data-join-estado') })));
    expect(states.every((s) => s.ok === 'true'), JSON.stringify(states)).toBe(true);
    expect(states.filter((s) => s.estado === 'excepcion')).toHaveLength(0);
    expect(states.filter((s) => s.estado === 'documentada')).toHaveLength(10);
    // Y con la misma función, recalculada desde las bocas guardadas.
    const joins = await page.evaluate(async () => {
      const mod = await import('/src/workspace/placement/joins.ts');
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: never } } } };
      const e = w.__codex.trayStore.getState().entrada as { conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }> };
      return e.conexiones.map((c) => mod.checkConnection(w.__codex.trayStore.getState().entrada, c));
    });
    for (const j of joins) {
      expect(j!.huecoMm).toBeLessThanOrEqual(1);
      expect(j!.anguloDeg).toBeLessThanOrEqual(1);
      expect(j!.giroDeg!).toBeLessThanOrEqual(1);
      // B-3: la sección se verifica (ancho conocido en todas las uniones).
      expect(j!.anchosMm).not.toBeNull();
    }

    // B-3 / PB6: las 4 uniones con una CUPS son válidas con aviso de ala del modelo
    // (36,56 mm medidos contra 50 declarados); el aviso se ve en la unión,
    // en la ficha de la pieza y en Resultados.
    const avisosUnion = page.getByTestId('join-aviso-ala');
    await expect(avisosUnion).toHaveCount(4);
    await expect(avisosUnion.first()).toContainText('la boca del modelo mide 36.56 mm de ala y el catálogo declara 50 mm');
    const cupsId = await page.evaluate(() => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string; producto_id: string }> } } } } };
      return w.__codex.trayStore.getState().entrada.piezas.find((p) => p.producto_id === 'SAM_CUPS-300-A-Z')!.instancia_id;
    });
    await page.evaluate((id) => {
      (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } } }).__codex.workspaceStore.getState().selectTray(id);
    }, cupsId);
    await expect(page.getByTestId('piece-aviso-modelo')).toHaveCount(2);
    await expect(page.getByTestId('piece-aviso-modelo').first()).toContainText('mide 36.56 mm de ala y el catálogo declara 50 mm');

    // Resultados: ninguna unión por excepción.
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('aviso-modelo-row')).toHaveCount(2);
    await expect(page.getByTestId('exception-row')).toHaveCount(0);
    await expect(page.getByTestId('exceptions-list')).toContainText('Ninguna');

    // PA8 — el motor calcula la cadena; todas las uniones dan COHERENTE.
    await page.getByTestId('reserva-input').fill('20');
    await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
    await page.getByTestId('calculate-tray').click();
    await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 60_000 });
    const encaje = await page.evaluate(() => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { status: string; result: { conexiones: Record<string, { encaje: { estado: string; separacion_mm?: number; desvio_angular_grados?: number } }> } } } } };
      const s = w.__codex.trayStore.getState();
      return { status: s.status, estados: Object.entries(s.result.conexiones).map(([id, c]) => ({ id, ...c.encaje })) };
    });
    expect(encaje.status).toBe('vigente');
    expect(encaje.estados).toHaveLength(10);
    expect(encaje.estados.every((e) => e.estado === 'COHERENTE'), JSON.stringify(encaje.estados)).toBe(true);
  });
});
