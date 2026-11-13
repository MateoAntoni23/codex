/**
 * E2E — etapa 2: el cable del circuito (2026-11-13).
 *
 * Con gestos reales:
 *   1. Dos equipos, un trazado entre ellos y un enlace en cada punta (como la etapa 1).
 *   2. Circuito entre los dos equipos con cable elegido en cascada (línea → tipo →
 *      formación): Sintenax Valio · Tripolar · cobre · 3 × 50 mm², cantidad 2, juntos.
 *      La función es fija (potencia) y se explica por qué.
 *   3. Otro circuito sin cable: se guarda igual y aparece como incompleto con el motivo.
 *   4. Resultados y "Copiar tabla" muestran cable y cantidad. Sobrevive a recargar.
 *   5. El cable se elige después desde Resultados: el incompleto pasa a completo.
 * El catálogo en cascada es el del motor real (113 cables, ids contrastados).
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');

type V3 = [number, number, number];
type PiezaJs = { instancia_id: string };
type CircuitoJs = { nombre: string; cable?: { cable_id: string; cantidad: number; separado: boolean | null; funcion: string } };
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: PiezaJs[]; circuitos_ws?: CircuitoJs[] }; context: { catalogoCables?: { ok: boolean; cables?: unknown[] } } | null } };
    workspaceStore: { getState: () => { elements: Array<{ id: string; name: string }> } };
  };
};

const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const circuitos = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.circuitos_ws ?? []);
const elementos = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.workspaceStore.getState().elements);

async function abrir(page: Page) {
  await page.goto('/?etapa=equipos');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

async function crearEquipo(page: Page, nombre: string, pos: V3): Promise<string> {
  const antes = (await elementos(page)).length;
  await page.getByTestId('new-equipment').click();
  const form = page.getByTestId('new-equipment-form');
  await form.locator('#paf-cat').selectOption('electrical_panel');
  await form.locator('#paf-name').fill(nombre);
  await form.locator('input[value="placed"]').check();
  await form.locator('#paf-x').fill(String(pos[0]));
  await form.locator('#paf-y').fill(String(pos[1]));
  await form.locator('#paf-z').fill(String(pos[2]));
  await form.getByRole('button', { name: 'Crear' }).click();
  await expect.poll(async () => (await elementos(page)).length).toBe(antes + 1);
  return (await elementos(page)).find((e) => e.name === nombre)!.id;
}

async function continueFrom(page: Page, freeEnd: RegExp, productoId: string, opts: { side?: 'left' | 'right'; length?: number } = {}) {
  const before = (await piezas(page)).length;
  await page.getByTestId('free-end').filter({ hasText: freeEnd }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(productoId);
  if (opts.side) await page.locator(`[data-codex-routing-hand="${opts.side}"]`).click();
  if (opts.length) await page.locator('[data-codex-routing-length-input]').fill(String(opts.length));
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(async () => (await piezas(page)).length).toBe(before + 1);
}

async function enlazar(page: Page, equipoId: string, tronco: string, desde: 'P1' | 'P2', distancia: number, lado: 'izquierda' | 'derecha') {
  const form = page.getByTestId('baj-form');
  await form.getByTestId('baj-equipo').selectOption(equipoId);
  await form.getByTestId('baj-tronco').selectOption(tronco);
  await form.getByTestId('baj-desde').selectOption(desde);
  await form.getByTestId('baj-distancia').fill(String(distancia));
  await form.getByTestId('baj-lado').selectOption(lado);
  await form.getByTestId('baj-crear').click();
  await expect(page.getByTestId('baj-msg')).toContainText('creado');
}

/** Cable en cascada: línea → tipo → formación, cantidad y disposición. */
async function elegirCable(page: Page, prefijo: string, o: { tipo: string; formacion: string; cantidad: number; funcion?: string }) {
  await page.getByTestId(`${prefijo}-cable-linea`).selectOption({ label: 'Sintenax Valio' });
  await page.getByTestId(`${prefijo}-cable-tipo`).selectOption({ label: o.tipo });
  await page.getByTestId(`${prefijo}-cable-formacion`).selectOption(o.formacion);
  await page.getByTestId(`${prefijo}-cable-cantidad`).fill(String(o.cantidad));
  if (o.funcion) await page.getByTestId(`${prefijo}-cable-funcion-select`).selectOption(o.funcion);
}

test.describe('Etapa 2 — el cable del circuito', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('cable tripolar en cascada, cantidad 2; sin cable queda incompleto con el motivo; sobrevive a recargar', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await abrir(page);
    // El catálogo en cascada es el del motor: 113 cables, ids contrastados.
    expect(await page.evaluate(() => {
      const k = (window as unknown as Codex).__codex.trayStore.getState().context?.catalogoCables;
      return k?.ok ? k.cables!.length : k;
    })).toBe(113);

    // 1. Equipos, trazado y enlaces.
    const tg = await crearEquipo(page, 'Tablero General A', [300, 1500, 1200]);
    const b3 = await crearEquipo(page, 'Bomba 3', [2600, 2800, 500]);
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continueFrom(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'left' });
    await continueFrom(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    const [r1, , r2] = await piezas(page);
    await page.getByTestId('stage-tab-conexiones').click();
    await enlazar(page, tg, r1.instancia_id, 'P1', 200, 'izquierda');
    await enlazar(page, b3, r2.instancia_id, 'P2', 300, 'derecha');

    // 2. Circuito con cable: cascada de tres listas cortas.
    await page.getByTestId('circuito-origen').selectOption(tg);
    await page.getByTestId('circuito-destino').selectOption(b3);
    await expect(page.getByTestId('circuito-cable-tipo')).toBeDisabled();
    await page.getByTestId('circuito-cable-linea').selectOption({ label: 'Sintenax Valio' });
    expect(await page.getByTestId('circuito-cable-tipo').locator('option').count()).toBe(1 + 9);
    await page.getByTestId('circuito-cable-tipo').selectOption({ label: 'Tripolar · cobre' });
    expect(await page.getByTestId('circuito-cable-formacion').locator('option').count()).toBe(1 + 16);
    await expect(page.getByTestId('circuito-cable-cantidad')).toHaveValue('1'); // por defecto 1
    // Etapa 3: la disposición no se elige (en contacto, D-02, confirmado por el operador); la función sí, potencia por defecto.
    await expect(page.getByTestId('circuito-cable-disposicion')).toContainText('Juntos, en contacto, en una sola capa (D-02)');
    await expect(page.getByTestId('circuito-cable-funcion-select')).toHaveValue('potencia');
    await expect(page.getByTestId('circuito-cable-funcion')).toContainText('El conductor de protección (PE) no es un circuito');
    await elegirCable(page, 'circuito', { tipo: 'Tripolar · cobre', formacion: 'PRY-SVALIO-CU-3x50', cantidad: 2 });
    await page.getByTestId('circuito-nombre-input').fill('TG-A → Bomba 3');
    await page.getByTestId('circuito-guardar').click();
    await expect(page.getByTestId('circuito-guardado-msg')).toHaveText('Circuito "TG-A → Bomba 3" guardado. Está en Resultados.');
    await page.screenshot({ path: resolve(OUT_DIR, 'cables-01-cascada.png') });

    // 3. Otro circuito sin cable: se guarda, queda incompleto. El formulario volvió a vacío.
    await expect(page.getByTestId('circuito-cable-formacion')).toHaveValue('');
    await page.getByTestId('circuito-origen').selectOption(b3);
    await page.getByTestId('circuito-destino').selectOption(tg);
    await page.getByTestId('circuito-nombre-input').fill('Sin cable');
    await page.getByTestId('circuito-guardar').click();
    await expect(page.getByTestId('circuito-guardado-msg')).toContainText('Sin cable: queda incompleto hasta elegirlo.');
    expect(await circuitos(page)).toEqual([
      expect.objectContaining({ nombre: 'TG-A → Bomba 3', cable: { cable_id: 'PRY-SVALIO-CU-3x50', cantidad: 2, separado: false, funcion: 'potencia' } }),
      expect.not.objectContaining({ cable: expect.anything() }),
    ]);

    // 4. Resultados y "Copiar tabla": cable y cantidad.
    const verResultados = async () => {
      await page.getByTestId('stage-tab-resultados').click();
      const filas = page.getByTestId('circuito-fila');
      await expect(filas).toHaveCount(2);
      await expect(filas.nth(0)).toHaveAttribute('data-completo', 'true');
      await expect(filas.nth(0).getByTestId('circuito-cable')).toHaveText('Sintenax Valio · Tripolar · cobre · 3 × 50 mm²');
      await expect(filas.nth(0).getByTestId('circuito-cantidad')).toHaveText('2');
      await expect(filas.nth(0).getByTestId('circuito-incompleto-calculo')).toHaveCount(0);
      await expect(filas.nth(1)).toHaveAttribute('data-completo', 'false');
      await expect(filas.nth(1).getByTestId('circuito-cable')).toHaveText('sin cable');
      await expect(filas.nth(1).getByTestId('circuito-cantidad')).toHaveText('—');
      await expect(filas.nth(1).getByTestId('circuito-incompleto-calculo')).toHaveText('Incompleto: le falta el cable para poder calcular.');
      // Incompleto no es desactualizado ni error.
      await expect(filas.nth(1)).toHaveAttribute('data-vigente', 'true');
    };
    await verResultados();
    await page.getByTestId('circuitos-copiar').click();
    const copiado = (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
    expect(copiado[0]).toBe('Nombre\tOrigen\tDestino\tCable\tCantidad\tLongitud total (mm)\tBandeja (mm)\tBajadas (mm)\tPiezas\tEstado');
    expect(copiado[1]).toMatch(/^TG-A → Bomba 3\tTablero General A\tBomba 3\tSintenax Valio · Tripolar · cobre · 3 × 50 mm²\t2\t[\d,]+\t[\d,]+\t[\d,]+\t3\tvigente$/);
    expect(copiado[2]).toMatch(/^Sin cable\tBomba 3\tTablero General A\tsin cable\t\t[\d,]+\t[\d,]+\t[\d,]+\t3\tvigente; incompleto: le falta el cable para poder calcular$/);
    await page.screenshot({ path: resolve(OUT_DIR, 'cables-02-resultados.png') });

    // Sobrevive a recargar.
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
    await page.reload();
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean((window as unknown as Codex).__codex?.trayStore?.getState().context?.catalogoCables));
    await verResultados();

    // 5. Elegir el cable después, desde Resultados: pasa a completo.
    const fila2 = page.getByTestId('circuito-fila').nth(1);
    await fila2.getByTestId('circuito-cable-editar').click();
    await elegirCable(page, 'editar', { tipo: 'Tetrapolar · cobre', formacion: 'PRY-SVALIO-CU-4x25/16', cantidad: 1 });
    await page.getByTestId('circuito-cable-guardar').click();
    await expect(page.getByTestId('circuitos-msg')).toHaveText('Cable guardado.');
    await expect(fila2).toHaveAttribute('data-completo', 'true');
    await expect(fila2.getByTestId('circuito-cable')).toHaveText('Sintenax Valio · Tetrapolar · cobre · 4 × 25/16 mm²');
    await expect(fila2.getByTestId('circuito-cantidad')).toHaveText('1');
    expect((await circuitos(page))[1].cable).toEqual({ cable_id: 'PRY-SVALIO-CU-4x25/16', cantidad: 1, separado: false, funcion: 'potencia' });
  });
});
