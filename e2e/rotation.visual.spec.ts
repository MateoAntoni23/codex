/**
 * E2E — Rotación manual de pieza (modo "Eje mundo" y "Eje de boca").
 *
 * Carga el proyecto real del usuario y ejercita la UI de rotación del
 * inspector sobre R1 (recto) y T1 (tee). Verifica que:
 *   P1. ±90° en eje Z con pivote centroide gira los puertos coherentemente.
 *   P2. Rotación numérica (37°) aplica el ángulo exacto y el botón "Aplicar"
 *       resetea el input a 0.
 *   P3. Pivote en puerto deja ese puerto inmóvil (eje mundo).
 *   P4. Undo/redo revierte y reaplica la rotación sin perder puertos.
 *   P5. En modo "Eje de boca", la boca seleccionada queda fija (pos+dir).
 *   P6. Rotación sobre un puerto conectado muestra la advertencia de
 *       conflicto listando los puertos adicionales que se desalinean.
 *   P7. Cambiar de modo mundo→boca y volver preserva el ángulo pendiente.
 *
 * Requiere que el dev server esté corriendo en http://localhost:5173.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, 'fixtures/user-report-20261107.workspace.json');
const OUT_DIR = resolve(__dirname, 'output');

type V3 = [number, number, number];

type TrayState = {
  entrada: {
    piezas: Array<{
      instancia_id: string;
      puertos: Record<string, { posicion_mm: V3; direccion: V3 }>;
    }>;
    conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }>;
  } | null;
  history: unknown[];
  future: unknown[];
};

async function loadFixture(page: import('@playwright/test').Page, rawJson: string) {
  await page.evaluate(async (raw) => {
    const workspaceFile = await import('/src/workspace/workspaceFile.ts');
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { importEdit: (i: unknown) => void } };
        workspaceStore: {
          getState: () => {
            loadFile: (
              elements: unknown[],
              evidence: unknown[],
              meta: unknown,
              fileName: string,
            ) => void;
            selectTray?: (id: string) => void;
          };
        };
        routingStore: { getState: () => { deactivate: () => void } };
      };
    };
    const ws = workspaceFile.importWorkspace(raw);
    const meta = workspaceFile.extractMeta(ws.projectV2);
    w.__codex.workspaceStore
      .getState()
      .loadFile(ws.projectV2.elements, ws.projectV2.evidence, meta, 'user-report-20261107.workspace.json');
    w.__codex.trayStore.getState().importEdit(ws.trayInput);
    w.__codex.routingStore.getState().deactivate();
  }, rawJson);
}

async function selectPiece(page: import('@playwright/test').Page, instanciaId: string) {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __codex: { workspaceStore: { getState: () => { selectTray: (id: string) => void } } };
    };
    w.__codex.workspaceStore.getState().selectTray(id);
  }, instanciaId);
  await page.waitForSelector('[data-codex-rotate-controls]', { timeout: 5_000 });
}

async function getPiece(
  page: import('@playwright/test').Page,
  instanciaId: string,
): Promise<TrayState['entrada'] extends infer E ? (E extends null ? never : E['piezas'][number]) : never> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => TrayState } };
    };
    const e = w.__codex.trayStore.getState().entrada!;
    return e.piezas.find((p) => p.instancia_id === id)!;
  }, instanciaId) as never;
}

async function dist(page: import('@playwright/test').Page, a: V3, b: V3): Promise<number> {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test.describe('Rotación manual — inspector', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await page.goto('/?workspace=bandejas');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );
    const rawJson = readFileSync(FIXTURE, 'utf-8');
    await loadFixture(page, rawJson);
  });

  test('P1 — rotación +90° en Z con pivote centroide gira los puertos de R1', async ({ page }) => {
    const before = await getPiece(page, 'R1');
    const centroidX = (before.puertos.P1.posicion_mm[0] + before.puertos.P2.posicion_mm[0]) / 2;
    const centroidY = (before.puertos.P1.posicion_mm[1] + before.puertos.P2.posicion_mm[1]) / 2;

    await selectPiece(page, 'R1');
    await page.locator('[data-codex-rotate-controls] button:has-text("Z")').click();
    await page.locator('[data-codex-rotate-controls] button:has-text("+90°")').click();

    const after = await getPiece(page, 'R1');
    // P1 y P2 debieron rotar 90° alrededor del centroide; componente X queda igual al centroide X.
    expect(Math.abs(after.puertos.P1.posicion_mm[0] - centroidX)).toBeLessThan(1);
    expect(Math.abs(after.puertos.P2.posicion_mm[0] - centroidX)).toBeLessThan(1);
    // Nueva Y corresponde a ± la mitad de la longitud original en X.
    const halfLenX = Math.abs(before.puertos.P2.posicion_mm[0] - before.puertos.P1.posicion_mm[0]) / 2;
    expect(Math.abs(Math.abs(after.puertos.P1.posicion_mm[1] - centroidY) - halfLenX)).toBeLessThan(1);
    // Dirección ha rotado -1,0 → 0,-1 (en el plano XY).
    expect(Math.abs(after.puertos.P1.direccion[0])).toBeLessThan(0.05);
    expect(Math.abs(Math.abs(after.puertos.P1.direccion[1]) - 1)).toBeLessThan(0.05);
  });

  test('P2 — rotación numérica (37°) aplica exacto y resetea input', async ({ page }) => {
    await selectPiece(page, 'R1');
    const before = await getPiece(page, 'R1');
    await page.locator('[data-codex-rotate-controls] button:has-text("Z")').click();
    const input = page.locator('[data-codex-rotate-controls] input[type="number"]');
    await input.fill('37');
    await page.locator('[data-codex-rotate-apply]').click();

    const after = await getPiece(page, 'R1');
    expect(await input.inputValue()).toBe('0');
    // Dirección ha girado 37° alrededor de Z: Δθ = 37° medida desde la dirección original.
    const dBef = before.puertos.P1.direccion;
    const dAft = after.puertos.P1.direccion;
    const cosT = dBef[0] * dAft[0] + dBef[1] * dAft[1];
    const sinT = dBef[0] * dAft[1] - dBef[1] * dAft[0];
    const deg = (Math.atan2(sinT, cosT) * 180) / Math.PI;
    expect(Math.abs(deg - 37)).toBeLessThan(0.5);
  });

  test('P3 — pivote=Puerto (P1, eje mundo Z) deja P1 inmóvil', async ({ page }) => {
    await selectPiece(page, 'R1');
    const before = await getPiece(page, 'R1');
    await page.locator('[data-codex-rotate-controls] button:has-text("Z")').click();
    // Cambiar pivote a "Puerto"
    const pivotSelect = page.locator('[data-codex-rotate-controls] select').first();
    await pivotSelect.selectOption('port');
    // Seleccionar P1 en el segundo select (aparece tras elegir "Puerto")
    const portSelect = page.locator('[data-codex-rotate-controls] select').nth(1);
    await portSelect.selectOption('P1');
    await page.locator('[data-codex-rotate-controls] button:has-text("+90°")').click();

    const after = await getPiece(page, 'R1');
    const d = Math.hypot(
      after.puertos.P1.posicion_mm[0] - before.puertos.P1.posicion_mm[0],
      after.puertos.P1.posicion_mm[1] - before.puertos.P1.posicion_mm[1],
      after.puertos.P1.posicion_mm[2] - before.puertos.P1.posicion_mm[2],
    );
    expect(d).toBeLessThan(0.01);
  });

  test('P4 — undo/redo revierte y reaplica la rotación', async ({ page }) => {
    await selectPiece(page, 'R1');
    const before = await getPiece(page, 'R1');
    await page.locator('[data-codex-rotate-controls] button:has-text("Z")').click();
    await page.locator('[data-codex-rotate-controls] button:has-text("+90°")').click();
    // Hito 2 (A-8): R1 está unido a R2; la rotación deja esa unión inválida y ya no
    // se acepta en silencio: aparece el aviso de conexiones rotas y se confirma.
    await expect(page.getByTestId('tray-broken-modal')).toBeVisible();
    await page.getByTestId('tray-broken-accept').click();
    const afterRot = await getPiece(page, 'R1');

    const d1 = await dist(page, afterRot.puertos.P2.posicion_mm, before.puertos.P2.posicion_mm);
    expect(d1).toBeGreaterThan(100);

    // Undo via store
    await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { undo: () => void } } };
      };
      w.__codex.trayStore.getState().undo();
    });
    const afterUndo = await getPiece(page, 'R1');
    expect(await dist(page, afterUndo.puertos.P2.posicion_mm, before.puertos.P2.posicion_mm)).toBeLessThan(0.01);

    // Redo
    await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { redo: () => void } } };
      };
      w.__codex.trayStore.getState().redo();
    });
    const afterRedo = await getPiece(page, 'R1');
    expect(await dist(page, afterRedo.puertos.P2.posicion_mm, afterRot.puertos.P2.posicion_mm)).toBeLessThan(0.01);
  });

  test('P5 — modo "Eje de boca" deja la boca seleccionada fija (pos+dir)', async ({ page }) => {
    await selectPiece(page, 'R1');
    const before = await getPiece(page, 'R1');
    await page.locator('[data-codex-rotate-mode="portAxis"]').click();
    const portAxisSelect = page.locator('[data-codex-rotate-port-axis]');
    await portAxisSelect.selectOption('P1');
    await page.locator('[data-codex-rotate-controls] button:has-text("+90°")').click();

    const after = await getPiece(page, 'R1');
    expect(
      await dist(page, after.puertos.P1.posicion_mm, before.puertos.P1.posicion_mm),
    ).toBeLessThan(0.01);
    // Dirección preservada exactamente.
    expect(Math.abs(after.puertos.P1.direccion[0] - before.puertos.P1.direccion[0])).toBeLessThan(0.001);
    expect(Math.abs(after.puertos.P1.direccion[1] - before.puertos.P1.direccion[1])).toBeLessThan(0.001);
    expect(Math.abs(after.puertos.P1.direccion[2] - before.puertos.P1.direccion[2])).toBeLessThan(0.001);
  });

  test('P6 — conflicto visible al rotar T1 sobre eje de boca con múltiples uniones', async ({ page }) => {
    await selectPiece(page, 'T1');
    await page.locator('[data-codex-rotate-mode="portAxis"]').click();
    // T1 es un tee: debería tener 3 bocas (P1, P2, P3). Al elegir cualquiera,
    // las otras 2 forman conflictos si están conectadas.
    const portAxisSelect = page.locator('[data-codex-rotate-port-axis]');
    await portAxisSelect.selectOption('P1');
    const conflicts = page.locator('[data-codex-rotate-conflicts]');
    // El fixture conecta T1 a varios vecinos; al menos una unión debería
    // aparecer como conflictiva (no la que coincide con P1).
    await expect(conflicts).toBeVisible({ timeout: 2000 });
    const conflictsText = await conflicts.textContent();
    expect(conflictsText).toMatch(/desalinear/i);
  });

  test('P7 — alternar modo preserva el input de ángulo', async ({ page }) => {
    await selectPiece(page, 'R1');
    const input = page.locator('[data-codex-rotate-controls] input[type="number"]');
    await input.fill('45');
    await page.locator('[data-codex-rotate-mode="portAxis"]').click();
    expect(await input.inputValue()).toBe('45');
    await page.locator('[data-codex-rotate-mode="worldAxis"]').click();
    expect(await input.inputValue()).toBe('45');
  });
});
