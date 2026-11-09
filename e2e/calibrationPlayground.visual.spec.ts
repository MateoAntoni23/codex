/**
 * E2E — Calibration Playground (hito 3 parte B, tarea #236).
 *
 * El Configurador expone una pestaña "Calibración visual" que renderiza en un
 * canvas aislado el mismo pipeline `placeRecipe(...)` que usa el workspace
 * para preview y confirmación. Botones:
 *   - Insertar preview → captura snapshot naranja/translúcido
 *   - Confirmar → captura snapshot celeste/sólido
 *   - Reiniciar → limpia ambos
 *
 * Qué se defiende aquí:
 *   1. Botones empiezan habilitados cuando el producto tiene receta
 *      paramétrica y Reiniciar empieza deshabilitado.
 *   2. Tras Insertar preview + Confirmar, el bridge expone dos mallas con
 *      `calibrationRole` distintos y productoId correcto.
 *   3. Si no se cambió nada entre clicks, la matriz de placeRecipe debe ser
 *      idéntica (delta == 0) y el indicador de delta debe aparecer en modo
 *      "estable".
 *   4. Reiniciar borra los dos snapshots del bridge.
 *   5. Cambiar de producto resetea el estado del playground.
 *
 * Aislamiento verificado:
 *   - `trayStore.pieces` permanece vacío tras usar el playground — el
 *     proyecto del usuario NO se toca.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

interface CalibrationMesh {
  role: 'preview' | 'confirmed';
  productoId: string;
  matrixWorld: number[];
  takenAt: string | null;
}

interface CalibrationSnapshotDump {
  preview: { matrix: number[]; ports: { name: string; center: [number, number, number]; normal: [number, number, number] }[]; takenAt: string } | null;
  confirmed: { matrix: number[]; ports: { name: string; center: [number, number, number]; normal: [number, number, number] }[]; takenAt: string } | null;
}

async function gotoConfigurator(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?configurator=v1');
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid^="cfg-product-SAM_"]'), undefined, { timeout: 20_000 });
}

async function selectProduct(page: import('@playwright/test').Page, productoId: string) {
  await page.locator(`[data-testid="cfg-product-${productoId}"]`).click();
  await page.waitForFunction((pid: string) => {
    const w = window as unknown as { __codex?: { configuratorMesh?: () => { productoId: string } | null } };
    return w.__codex?.configuratorMesh?.()?.productoId === pid;
  }, productoId, { timeout: 15_000 });
}

async function openCalibrationTab(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="cfg-tab-calibracion"]').click();
  await page.locator('[data-testid="cfg-calibration-tab"]').waitFor({ state: 'visible', timeout: 5_000 });
  // El Canvas se monta con Suspense — esperamos que el bridge esté instalado.
  await page.waitForFunction(() => {
    const w = window as unknown as { __codex?: { calibrationMeshes?: unknown } };
    return typeof w.__codex?.calibrationMeshes === 'function';
  }, undefined, { timeout: 10_000 });
}

async function readMeshes(page: import('@playwright/test').Page): Promise<CalibrationMesh[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __codex: { calibrationMeshes: () => CalibrationMesh[] } };
    return w.__codex.calibrationMeshes();
  });
}

async function readSnapshots(page: import('@playwright/test').Page): Promise<CalibrationSnapshotDump> {
  return page.evaluate(() => {
    const w = window as unknown as { __codex: { calibrationSnapshots: () => CalibrationSnapshotDump } };
    return w.__codex.calibrationSnapshots();
  });
}

function maxDelta(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

test.describe('Configurator — Calibration Playground (hito 3 parte B)', () => {
  test.setTimeout(90_000);

  test.beforeEach(async () => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test('ciclo completo preview→confirmar→delta=0→reiniciar, aislado del proyecto', async ({ page }) => {
    await gotoConfigurator(page);
    await selectProduct(page, 'SAM_TRPS-300-22-Z');
    await openCalibrationTab(page);

    // Estado inicial: sin snapshots.
    const initial = await readMeshes(page);
    expect(initial, 'escena arranca sin snapshots').toEqual([]);

    const insertBtn = page.locator('[data-testid="cfg-calibration-insert"]');
    const confirmBtn = page.locator('[data-testid="cfg-calibration-confirm"]');
    const resetBtn = page.locator('[data-testid="cfg-calibration-reset"]');
    await expect(insertBtn, 'Insertar preview habilitado para producto con receta').toBeEnabled();
    await expect(confirmBtn, 'Confirmar habilitado para producto con receta').toBeEnabled();
    await expect(resetBtn, 'Reiniciar arranca deshabilitado sin snapshots').toBeDisabled();

    // Insertar preview.
    await insertBtn.click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { calibrationMeshes: () => { role: string }[] } };
      return w.__codex.calibrationMeshes().some((m) => m.role === 'preview');
    }, undefined, { timeout: 5_000 });
    const afterPreview = await readMeshes(page);
    expect(afterPreview.filter((m) => m.role === 'preview')).toHaveLength(1);
    expect(afterPreview[0].productoId).toBe('SAM_TRPS-300-22-Z');

    // Confirmar.
    await confirmBtn.click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { calibrationMeshes: () => { role: string }[] } };
      return w.__codex.calibrationMeshes().some((m) => m.role === 'confirmed');
    }, undefined, { timeout: 5_000 });
    const afterConfirm = await readMeshes(page);
    expect(afterConfirm.filter((m) => m.role === 'confirmed')).toHaveLength(1);
    expect(afterConfirm.filter((m) => m.role === 'preview')).toHaveLength(1);

    // Delta de matriz debe ser 0 — sin cambios entre clicks.
    const snaps = await readSnapshots(page);
    expect(snaps.preview, 'snapshot preview capturado').not.toBeNull();
    expect(snaps.confirmed, 'snapshot confirmado capturado').not.toBeNull();
    const d = maxDelta(snaps.preview!.matrix, snaps.confirmed!.matrix);
    expect(d, `Δ de matriz entre preview y confirmado debería ser 0 (fue ${d})`).toBeLessThan(1e-9);

    // El badge de delta debe aparecer y marcar estabilidad.
    const deltaBadge = page.locator('[data-testid="cfg-calibration-delta"]');
    await expect(deltaBadge).toBeVisible();
    await expect(deltaBadge).toContainText('estable');

    // Aislamiento del proyecto: tray NO debe tener piezas creadas.
    const trayCount = await page.evaluate(() => {
      const w = window as unknown as { __codex?: { trayDump?: () => { pieces?: unknown[] } } };
      const dump = w.__codex?.trayDump?.();
      return Array.isArray(dump?.pieces) ? dump!.pieces!.length : 0;
    });
    expect(trayCount, 'playground no debe crear piezas en el proyecto').toBe(0);

    // Reiniciar limpia los dos snapshots.
    await resetBtn.click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { calibrationMeshes: () => unknown[] } };
      return w.__codex.calibrationMeshes().length === 0;
    }, undefined, { timeout: 5_000 });
    expect(await readMeshes(page)).toEqual([]);
    const snapsAfterReset = await readSnapshots(page);
    expect(snapsAfterReset.preview).toBeNull();
    expect(snapsAfterReset.confirmed).toBeNull();
  });

  test('cambiar de producto resetea snapshots del playground', async ({ page }) => {
    await gotoConfigurator(page);
    await selectProduct(page, 'SAM_TRPS-300-22-Z');
    await openCalibrationTab(page);

    await page.locator('[data-testid="cfg-calibration-insert"]').click();
    await page.locator('[data-testid="cfg-calibration-confirm"]').click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { calibrationMeshes: () => { role: string }[] } };
      const m = w.__codex.calibrationMeshes();
      return m.some((x) => x.role === 'preview') && m.some((x) => x.role === 'confirmed');
    }, undefined, { timeout: 5_000 });

    // Cambiar producto: los snapshots del anterior deben desaparecer.
    await selectProduct(page, 'SAM_CPS-300-90-Z');
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { calibrationMeshes: () => unknown[] } };
      return w.__codex.calibrationMeshes().length === 0;
    }, undefined, { timeout: 5_000 });
    expect(await readMeshes(page)).toEqual([]);
  });
});
