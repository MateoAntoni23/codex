/**
 * E2E — etapa 1: los equipos como extremos del circuito (2026-11-13).
 *
 * Con gestos reales:
 *   1. Equipos: "Nuevo equipo" × 2 (Tablero General A y Bomba 3), ubicados en la escena.
 *   2. Bandejas: un trazado entre ellos (recto → curva plana 90 → recto 2000).
 *   3. Conexiones: un enlace en cada punta (equipo + tramo, distancia desde una boca, lado).
 *      Sin enlace en un equipo, el circuito dice por qué no hay camino.
 *   4. Circuito de un equipo al otro: la longitud incluye las dos bajadas y se ve
 *      desglosada (bandeja / bajadas), antes de guardar y en Resultados.
 *   5. Persiste con el proyecto (recargar la página).
 *   6. Mover un equipo (editor numérico de la ficha, "Aplicar"): el enlace y el circuito
 *      quedan desactualizados con el motivo; lo guardado no se recalcula.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');

type V3 = [number, number, number];
type PiezaJs = { instancia_id: string; producto_id: string; longitud_mm?: number; longitud_eje_mm?: number; puertos: Record<string, { posicion_mm: V3 }> };
type BajadaJs = { id: string; equipo: string; tronco: string; punto_salida_mm: V3; punto_equipo_mm: V3; longitud_mm: number };
type ElementoJs = { id: string; name: string; transform: { positionMm: { x: number; y: number; z: number } } | null };
type Codex = {
  __codex: {
    trayStore: { getState: () => { entrada: { piezas: PiezaJs[]; bajadas_ws?: BajadaJs[]; circuitos_ws?: Array<{ sumaMm: number; bandejaMm: number; bajadasMm: number }> } } };
    workspaceStore: { getState: () => { elements: ElementoJs[] } };
  };
};

const piezas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.piezas);
const bajadas = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.trayStore.getState().entrada.bajadas_ws ?? []);
const elementos = (page: Page) => page.evaluate(() => (window as unknown as Codex).__codex.workspaceStore.getState().elements);
const fmt = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function abrir(page: Page) {
  await page.goto('/?etapa=equipos');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

/** "Nuevo equipo" en la etapa Equipos, ubicado en (x, y, z). Devuelve su id. */
async function crearEquipo(page: Page, nombre: string, categoria: string, pos: V3): Promise<string> {
  const antes = (await elementos(page)).length;
  await page.getByTestId('new-equipment').click();
  const form = page.getByTestId('new-equipment-form');
  await form.locator('#paf-cat').selectOption(categoria);
  await form.locator('#paf-name').fill(nombre);
  await form.locator('input[value="placed"]').check();
  await form.locator('#paf-x').fill(String(pos[0]));
  await form.locator('#paf-y').fill(String(pos[1]));
  await form.locator('#paf-z').fill(String(pos[2]));
  // Con forma: la ficha permite editar la posición (tablero → caja, motor → cilindro).
  if (categoria === 'motor') {
    await form.locator('#paf-geo').selectOption('cylinder');
    await form.locator('#paf-cd').fill('400');
    await form.locator('#paf-cl').fill('700');
  } else {
    await form.locator('#paf-geo').selectOption('box');
    await form.locator('#paf-bw').fill('600');
    await form.locator('#paf-bd').fill('400');
    await form.locator('#paf-bh').fill('800');
  }
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

/** Enlace equipo ↔ bandeja en Conexiones: tramo, distancia desde una boca y lado. */
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

test.describe('Etapa 1 — equipos como extremos del circuito', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('circuito de equipo a equipo: dos bajadas, longitud desglosada, persiste; mover un equipo lo desactualiza', async ({ page }) => {
    await abrir(page);

    // 1. Dos equipos en la escena.
    const tg = await crearEquipo(page, 'Tablero General A', 'electrical_panel', [300, 1500, 1200]);
    const b3 = await crearEquipo(page, 'Bomba 3', 'motor', [2600, 2800, 500]);

    // 2. Trazado de bandeja entre ellos.
    await page.getByTestId('stage-tab-bandejas').click();
    await page.getByTestId('tool-bandejas-tramo').click();
    await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
    await page.getByRole('button', { name: 'Crear tramo' }).click();
    await expect.poll(async () => (await piezas(page)).length).toBe(1);
    await continueFrom(page, /^↗ 1\. TRPS-300-22-Z · Boca x_max/, 'SAM_CPS-300-90-Z', { side: 'left' });
    await continueFrom(page, /^↗ 2\. CPS-300-90-Z/, 'SAM_TRPS-300-22-Z', { length: 2000 });
    const [r1, curva, r2] = await piezas(page);

    // 3. Conexiones: sin enlaces todavía, el circuito dice por qué no hay camino.
    await page.getByTestId('stage-tab-conexiones').click();
    await page.getByTestId('circuito-origen').selectOption(tg);
    await page.getByTestId('circuito-destino').selectOption(b3);
    await expect(page.getByTestId('circuito-sin-camino')).toContainText('el equipo Tablero General A no tiene enlace con la bandeja');

    // Un enlace en cada punta.
    await enlazar(page, tg, r1.instancia_id, 'P1', 200, 'izquierda');
    await expect(page.getByTestId('circuito-sin-camino')).toContainText('el equipo Bomba 3 no tiene enlace con la bandeja');
    await enlazar(page, b3, r2.instancia_id, 'P2', 300, 'derecha');
    const [bo, bd] = await bajadas(page);
    expect(bo).toMatchObject({ id: 'BAJ-1', equipo: tg, tronco: r1.instancia_id });
    expect(bd).toMatchObject({ id: 'BAJ-2', equipo: b3, tronco: r2.instancia_id });
    // La bajada es la recta del punto de salida al centro del equipo.
    expect(bo.punto_equipo_mm).toEqual([300, 1500, 1200]);
    expect(bo.longitud_mm).toBeCloseTo(dist(bo.punto_salida_mm, bo.punto_equipo_mm), 9);
    expect(bd.longitud_mm).toBeCloseTo(dist(bd.punto_salida_mm, [2600, 2800, 500]), 9);
    // No es bandeja: no agregó piezas.
    expect(await piezas(page)).toHaveLength(3);
    await expect(page.getByTestId('bajada-row')).toHaveCount(2);
    await expect(page.getByTestId('bajada-procedencia')).toContainText('no computa ninguna pieza de bandeja');

    // 4. Circuito: bajada → bandeja → bajada, desglosado.
    const bandeja = (r1.longitud_mm! - 200) + curva.longitud_eje_mm! + (r2.longitud_mm! - 300);
    const bajadasMm = bo.longitud_mm + bd.longitud_mm;
    const total = bandeja + bajadasMm;
    await expect(page.getByTestId('circuito-sin-camino')).toHaveCount(0);
    await expect(page.getByTestId('circuito-total')).toContainText(`Longitud total: ${fmt(total)} mm`);
    await expect(page.getByTestId('circuito-desglose-bandeja')).toContainText(`Por bandeja: ${fmt(bandeja)} mm (3 pieza(s))`);
    await expect(page.getByTestId('circuito-desglose-bajadas')).toContainText(
      `Bajadas: ${fmt(bajadasMm)} mm — origen ${fmt(bo.longitud_mm)} mm (BAJ-1), destino ${fmt(bd.longitud_mm)} mm (BAJ-2)`,
    );
    await expect(page.getByTestId('circuito-pieza').first()).toContainText('punto de salida BAJ-1');
    await expect(page.getByTestId('circuito-pieza').last()).toContainText('punto de salida BAJ-2');
    await page.getByTestId('circuito-nombre-input').fill('TG-A → Bomba 3');
    await page.getByTestId('circuito-guardar').click();
    await expect(page.getByTestId('circuito-guardado-msg')).toContainText('Circuito "TG-A → Bomba 3" guardado');
    await page.screenshot({ path: resolve(OUT_DIR, 'equipos-circuito-01-conexiones.png') });

    // En Resultados: de equipo a equipo, con el desglose.
    await page.getByTestId('stage-tab-resultados').click();
    const fila = page.getByTestId('circuito-fila');
    await expect(fila).toHaveCount(1);
    await expect(fila).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('circuito-origen-equipo')).toHaveText('Tablero General A');
    await expect(page.getByTestId('circuito-destino-equipo')).toHaveText('Bomba 3');
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(total));
    await expect(page.getByTestId('circuito-bandeja')).toHaveText(fmt(bandeja));
    await expect(page.getByTestId('circuito-bajadas')).toHaveText(fmt(bajadasMm));

    // 5. Persiste con el proyecto.
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
    await page.reload();
    await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('circuito-fila')).toHaveAttribute('data-vigente', 'true');
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(total));
    expect(await bajadas(page)).toEqual([bo, bd]);

    // 6. Mover Bomba 3 con el editor de la ficha: desactualizado con el motivo.
    await page.getByTestId('stage-tab-equipos').click();
    await page.evaluate((id) => {
      (window as unknown as { __codex: { workspaceStore: { getState: () => { selectEquip: (id: string) => void } } } }).__codex.workspaceStore.getState().selectEquip(id);
    }, b3);
    await page.locator('#pi-pos-x').fill('3100');
    await page.locator('.btn-primary:has-text("Aplicar")').click();
    await expect.poll(async () => (await elementos(page)).find((e) => e.id === b3)!.transform!.positionMm.x).toBe(3100);

    await page.getByTestId('stage-tab-resultados').click();
    await expect(page.getByTestId('circuito-fila')).toHaveAttribute('data-vigente', 'false');
    await expect(page.getByTestId('circuito-desactualizado')).toContainText('el equipo Bomba 3 se movió (500.0 mm)');
    // Lo guardado no se recalculó.
    await expect(page.getByTestId('circuito-longitud')).toHaveText(fmt(total));
    await page.screenshot({ path: resolve(OUT_DIR, 'equipos-circuito-02-desactualizado.png') });

    await page.getByTestId('stage-tab-conexiones').click();
    const filaB3 = page.locator('[data-testid="bajada-row"][data-bajada="BAJ-2"]');
    await expect(filaB3).toHaveAttribute('data-vigente', 'false');
    await expect(filaB3.getByTestId('bajada-estado')).toContainText('el equipo Bomba 3 se movió (500.0 mm)');
    await expect(page.locator('[data-testid="bajada-row"][data-bajada="BAJ-1"]')).toHaveAttribute('data-vigente', 'true');
    // Con el enlace desactualizado no se arma un circuito nuevo: se dice por qué.
    await page.getByTestId('circuito-origen').selectOption(tg);
    await page.getByTestId('circuito-destino').selectOption(b3);
    await expect(page.getByTestId('circuito-sin-camino')).toContainText('el enlace BAJ-2 del equipo Bomba 3 está desactualizado: el equipo Bomba 3 se movió (500.0 mm)');
  });
});
