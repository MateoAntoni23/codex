/**
 * E2E — circuitos guardados y longitudes de proyectos anteriores.
 *
 * Cadena armada con gestos reales en Bandejas:
 *   recto 1 → curva plana 90 → recto 2000 → T (tronco) → recto 1500 por la derivación
 *     → curva vertical (CUPS) → recto 1000
 *
 * 1. En Conexiones el operador elige origen y destino, le pone nombre y lo
 *    guarda. En Resultados aparece una fila: nombre, origen, destino, longitud
 *    (mm) y piezas. "Copiar tabla" deja la tabla en el portapapeles.
 * 2. Sobrevive a cerrar y abrir: recargar la página (autoguardado) y además
 *    guardar copia → Nuevo → abrir el archivo.
 * 3. Rotar una pieza del recorrido (herramienta Rotar, B-4) y borrar otra: el
 *    circuito queda desactualizado con el motivo, sin recalcularse solo.
 *    Deshacer lo deja vigente otra vez.
 * 4. Proyecto anterior a la regla de longitudes: la acción explícita guarda las
 *    longitudes, dice cuántas actualizó; con el fixture del operador dice cuál
 *    no pudo y por qué.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const USER_REPORT = resolve(HERE, 'fixtures/user-report-20261107.workspace.json');

type V3 = [number, number, number];
type PiezaJs = {
  instancia_id: string; producto_id: string; longitud_mm?: number; longitud_eje_mm?: number;
  puertos: Record<string, { posicion_mm: V3 }>;
  colocacion?: { longitudes_eje?: Record<string, { mm: number }> };
};
type TrayW = { __codex: { trayStore: { getState: () => { entrada: { piezas: PiezaJs[] } & Record<string, unknown>; edit: (e: unknown) => void; undo: () => void } } } };

async function openBandejas(page: Page): Promise<void> {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

const piezas = (page: Page) => page.evaluate(() => (window as unknown as TrayW).__codex.trayStore.getState().entrada.piezas);

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
  if (await motive.count()) await motive.fill('Unión accesorio–accesorio autorizada (E2E circuitos)');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

async function armarCadena(page: Page) {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await piezas(page)).length).toBe(1);
  await continueFrom(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'right' });
  await continueFrom(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
  await continueFrom(page, /^↗ 3\. TRPS-300-22-Z · Boca x_max/, 'SAM_TPS-300-Z', { entryPort: 'tronco_P1', side: 'right' });
  await continueFrom(page, /^↗ 4\. TPS-300-Z · Boca de derivación/, 'SAM_TRPS-300-22-Z', { length: 1500 });
  await continueFrom(page, /^↗ 5\. TRPS-300-22-Z · Boca x_max/, 'SAM_CUPS-300-A-Z', { entryPort: 'P1_horizontal' });
  await continueFrom(page, /^↗ 6\. CUPS-300-A-Z · Boca vertical/, 'SAM_TRPS-300-22-Z', { length: 1000 });
  return piezas(page);
}

async function elegir(page: Page, testid: string, pieza: string, boca: string) {
  await page.getByTestId(testid).selectOption(`${pieza}\u0000${boca}`);
}

const fmt = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

test.describe('Circuitos guardados', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('guardar con nombre; tabla y copia en Resultados; sobrevive a cerrar y abrir; desactualizado al rotar o borrar una pieza', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openBandejas(page);
    const ps = await armarCadena(page);
    const [r1, curva, r2, tee, rDeriv, cups, rVert] = ps;
    const esperado = r1.longitud_mm! + curva.longitud_eje_mm! + r2.longitud_mm!
      + tee.colocacion!.longitudes_eje!['boca_derivacion|tronco_P1'].mm + rDeriv.longitud_mm!
      + cups.colocacion!.longitudes_eje!['P1_horizontal|P2_vertical'].mm + rVert.longitud_mm!;

    // 1. Guardar como circuito.
    await page.getByTestId('stage-tab-conexiones').click();
    await elegir(page, 'recorrido-origen', r1.instancia_id, 'P1');
    await elegir(page, 'recorrido-destino', rVert.instancia_id, 'P2');
    await expect(page.getByTestId('recorrido-total')).toContainText(`Longitud total: ${fmt(esperado)} mm`);
    await page.getByTestId('recorrido-guardar').click();
    await expect(page.getByTestId('recorrido-guardado-msg')).toContainText('el circuito necesita un nombre');
    await page.getByTestId('recorrido-nombre').fill('TG-1 → Bomba 3');
    await page.getByTestId('recorrido-guardar').click();
    await expect(page.getByTestId('recorrido-guardado-msg')).toContainText('Circuito "TG-1 → Bomba 3" guardado');

    // Tabla en Resultados.
    await page.getByTestId('stage-tab-resultados').click();
    const fila = page.getByTestId('circuito-fila');
    await expect(fila).toHaveCount(1);
    await expect(fila).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('circuito-nombre')).toHaveText('TG-1 → Bomba 3');
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(esperado));
    await expect(page.getByTestId('circuito-piezas')).toHaveText('7');
    await expect(fila).toContainText('1. TRPS-300-22-Z · Boca x_min');
    await expect(fila).toContainText('7. TRPS-300-22-Z · Boca x_max');
    await page.getByTestId('circuitos-copiar').click();
    await expect(page.getByTestId('circuitos-msg')).toContainText('Tabla copiada (1 circuito(s))');
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado.split(/\r?\n/)).toEqual([
      'Nombre\tOrigen\tDestino\tLongitud (mm)\tPiezas\tEstado',
      `TG-1 → Bomba 3\t1. TRPS-300-22-Z · Boca x_min\t7. TRPS-300-22-Z · Boca x_max\t${esperado.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1, useGrouping: false })}\t7\tvigente`,
    ]);
    await page.screenshot({ path: resolve(OUT_DIR, 'circuitos-01-tabla.png') });

    // 2. Sobrevive a recargar (autoguardado) y a guardar copia → Nuevo → abrir.
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
    await page.reload();
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('circuito-nombre')).toHaveText('TG-1 → Bomba 3');
    await expect(page.getByTestId('circuito-fila')).toHaveAttribute('data-vigente', 'true');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save-copy').click()]);
    const copia = resolve(OUT_DIR, `circuitos-${Date.now()}.json`);
    await download.saveAs(copia);
    expect(JSON.stringify(JSON.parse(readFileSync(copia, 'utf8')))).toContain('TG-1 → Bomba 3');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('project-new').click();
    await expect(page.getByTestId('circuito-fila')).toHaveCount(0);
    // Proyecto vacío tras "Nuevo": abrir no pide confirmación.
    await page.getByTestId('project-open-input').setInputFiles(copia);
    await expect(page.getByTestId('circuito-nombre')).toHaveText('TG-1 → Bomba 3');
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(esperado));

    // 3. Rotar una pieza del recorrido con la herramienta Rotar (ficha de la pieza, etapa
    //    Bandejas): desactualizado, con motivo.
    await page.getByTestId('stage-tab-bandejas').click();
    await page.evaluate((id) => {
      (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } } }).__codex.workspaceStore.getState().selectTray(id);
    }, r2.instancia_id);
    await page.getByTestId('tray-rotate-toggle').click();
    await page.getByTestId('tray-rotate-eje').selectOption('Z');
    await page.getByTestId('tray-rotate-angulo').fill('90');
    await page.getByTestId('tray-rotate-aplicar').click();
    await page.getByTestId('tray-broken-accept').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('circuito-fila')).toHaveAttribute('data-vigente', 'false');
    const aviso = page.getByTestId('circuito-desactualizado');
    await expect(aviso).toContainText('la pieza 3. TRPS-300-22-Z se movió o rotó');
    await expect(aviso).toContainText('ya no existe'); // las uniones que la rotación descartó
    // Lo guardado no se recalculó.
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(esperado));
    await page.screenshot({ path: resolve(OUT_DIR, 'circuitos-02-desactualizado.png') });
    // Recalcular es explícito; sin camino, lo dice y no toca lo guardado.
    await page.getByTestId('circuito-recalcular').click();
    await expect(page.getByTestId('circuitos-msg')).toContainText('No se pudo recalcular: no hay camino');
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(esperado));
    await page.evaluate(() => (window as unknown as TrayW).__codex.trayStore.getState().undo());
    await expect(page.getByTestId('circuito-fila')).toHaveAttribute('data-vigente', 'true');

    // Borrar una pieza del recorrido (botón "Eliminar pieza" de la ficha).
    await page.getByTestId('stage-tab-bandejas').click();
    await page.evaluate((id) => {
      (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } } }).__codex.workspaceStore.getState().selectTray(id);
    }, cups.instancia_id);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Eliminar pieza' }).click();
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('circuito-desactualizado')).toContainText(`la pieza ${cups.instancia_id} ya no existe`);
  });

  test('longitudes de proyectos anteriores: acción explícita, cuántas actualizó y cuáles no pudo', async ({ page }) => {
    await openBandejas(page);
    const ps = await armarCadena(page);
    const [r1, , , tee, , cups, rVert] = ps;
    // Proyecto "anterior": sin longitudes guardadas en la T ni en la CUPS.
    await page.evaluate(([t, c]) => {
      const s = (window as unknown as TrayW).__codex.trayStore.getState();
      const next = structuredClone(s.entrada);
      for (const id of [t, c]) {
        const p = next.piezas.find((x) => x.instancia_id === id)!;
        delete p.colocacion!.longitudes_eje;
        delete p.longitud_eje_mm;
      }
      s.edit(next);
    }, [tee.instancia_id, cups.instancia_id] as const);
    await page.getByTestId('stage-tab-conexiones').click();
    await elegir(page, 'recorrido-origen', r1.instancia_id, 'P1');
    await elegir(page, 'recorrido-destino', rVert.instancia_id, 'P2');
    await expect(page.getByTestId('recorrido-incompleto')).toContainText('falta la longitud de 2 pieza(s)');
    await expect(page.getByTestId('longitudes-anteriores')).toContainText('2 pieza(s) sin longitud de eje guardada');
    await page.getByTestId('longitudes-anteriores-aplicar').click();
    await expect(page.getByTestId('longitudes-anteriores-resultado')).toContainText('2 pieza(s) actualizada(s): 4. TPS-300-Z, 6. CUPS-300-A-Z.');
    await expect(page.getByTestId('longitudes-anteriores-no-pudo')).toHaveCount(0);
    await expect(page.getByTestId('recorrido-total')).toBeVisible();
    await page.screenshot({ path: resolve(OUT_DIR, 'circuitos-03-longitudes-anteriores.png') });

    // Fixture real del operador (proyecto viejo): la T no se pudo resolver al migrar.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
    await expect.poll(async () => (await piezas(page)).length).toBe(7);
    await expect(page.getByTestId('longitudes-anteriores-aplicar')).toBeVisible();
    await page.getByTestId('longitudes-anteriores-aplicar').click();
    const res = page.getByTestId('longitudes-anteriores-resultado');
    await expect(res).toContainText('0 pieza(s) actualizada(s).');
    await expect(res).toContainText('No se pudo en 1:');
    await expect(page.getByTestId('longitudes-anteriores-no-pudo')).toContainText('sin colocación resuelta: no encaja con el modelo vigente');
    // La elección del proyecto anterior no sobrevive como un falso "sin camino".
    await expect(page.getByTestId('recorrido-sin-camino')).toHaveCount(0);
    await expect(page.getByTestId('recorrido-origen')).toHaveValue('');
    await page.screenshot({ path: resolve(OUT_DIR, 'circuitos-04-no-pudo.png') });
  });
});
