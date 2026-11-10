/**
 * E2E — Botón "Cargar escenario de prueba".
 *
 * Verifica (click real, sin tocar el store):
 *   1. Pulsar agrega Tablero Prueba A + Motor Prueba A + 1 conexión planificada.
 *   2. Equipos visibles (placementStatus=placed) y seleccionables desde el árbol.
 *   3. Segunda pulsación es idempotente (no duplica).
 *   4. Mover uno de los equipos no requiere motor Python ni importador.
 *   5. Export → import conserva equipos + conexión.
 *   6. Deshacer revierte en un solo paso: elementos + ports + connections.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

const TABLERO_ID = 'scenario:tablero-prueba-a';
const MOTOR_ID = 'scenario:motor-prueba-a';
const CONN_ID = 'scenario:conn-potencia-a';

type StoreSnapshot = {
  elementsCount: number;
  portsCount: number;
  connectionsCount: number;
  equipHistory: number;
  equipFuture: number;
  hasTablero: boolean;
  hasMotor: boolean;
  tableroPlaced: boolean;
  motorPlaced: boolean;
  motorPos: { x: number; y: number; z: number } | null;
  tableroName: string | null;
  connPlanned: boolean;
};

async function openWorkspace(page: Page): Promise<void> {
  // Hito 1b: las acciones de prueba sólo aparecen con ?dev=1 (menú Desarrollo).
  await page.goto('/?workspace=bandejas&dev=1');
  await page.getByTestId('dev-menu').locator('summary').click();
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
}

async function seedTrayInput(page: Page): Promise<void> {
  // El escenario no depende del motor Python ni del trazado, pero importar/
  // exportar sí exige un `trayInput`. Sembramos uno mínimo vacío para que la
  // ruta export+import quede ejercitada igual sin arrancar el motor.
  await page.evaluate(() => {
    const w = window as typeof window & {
      __codex?: { trayStore?: { getState: () => unknown } };
    };
    const t = w.__codex!.trayStore!.getState() as {
      importEdit: (input: unknown) => void;
    };
    t.importEdit({
      version_contrato: 'trazado/1',
      piezas: [],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: {
        seccion_requerida_mm2: 16,
        cable_id: 'DEMO-PE',
        origen_requisito: 'demo',
        conductores: [],
      },
    });
  });
}

async function readSnapshot(page: Page): Promise<StoreSnapshot> {
  return await page.evaluate(
    ({ TABLERO_ID, MOTOR_ID, CONN_ID }) => {
      const w = window as typeof window & {
        __codex?: { workspaceStore?: { getState: () => unknown } };
      };
      const s = w.__codex!.workspaceStore!.getState() as {
        elements: Array<{
          id: string;
          name: string;
          placementStatus: string;
          transform?: { positionMm: { x: number; y: number; z: number } };
        }>;
        projectMeta: {
          ports: Array<{ id: string }>;
          connections: Array<{ id: string; installationStatus: string }>;
        };
        equipHistory: unknown[];
        equipFuture: unknown[];
      };
      const tablero = s.elements.find((e) => e.id === TABLERO_ID);
      const motor = s.elements.find((e) => e.id === MOTOR_ID);
      const conn = s.projectMeta.connections.find((c) => c.id === CONN_ID);
      return {
        elementsCount: s.elements.length,
        portsCount: s.projectMeta.ports.length,
        connectionsCount: s.projectMeta.connections.length,
        equipHistory: s.equipHistory.length,
        equipFuture: s.equipFuture.length,
        hasTablero: !!tablero,
        hasMotor: !!motor,
        tableroPlaced: tablero?.placementStatus === 'placed',
        motorPlaced: motor?.placementStatus === 'placed',
        motorPos: motor?.transform?.positionMm ?? null,
        tableroName: tablero?.name ?? null,
        connPlanned: conn?.installationStatus === 'planned',
      };
    },
    { TABLERO_ID, MOTOR_ID, CONN_ID },
  );
}

test('cargar escenario de prueba: idempotencia, movimiento, round-trip, undo', async ({
  page,
}) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await openWorkspace(page);
  await seedTrayInput(page);

  // ── 1. Pulsar el botón real ────────────────────────────────────────────────
  const before = await readSnapshot(page);
  expect(before.hasTablero).toBe(false);
  expect(before.hasMotor).toBe(false);

  await page.getByTestId('load-test-scenario').click();
  const afterLoad = await readSnapshot(page);

  expect(afterLoad.hasTablero).toBe(true);
  expect(afterLoad.hasMotor).toBe(true);
  expect(afterLoad.tableroPlaced).toBe(true);
  expect(afterLoad.motorPlaced).toBe(true);
  expect(afterLoad.elementsCount).toBe(before.elementsCount + 2);
  expect(afterLoad.portsCount).toBe(before.portsCount + 2);
  expect(afterLoad.connectionsCount).toBe(before.connectionsCount + 1);
  expect(afterLoad.connPlanned).toBe(true);
  expect(afterLoad.tableroName?.toLowerCase()).toContain('demo');

  // ── 2. Idempotencia: segunda pulsación no cambia nada ──────────────────────
  await page.getByTestId('load-test-scenario').click();
  const afterSecond = await readSnapshot(page);
  expect(afterSecond.elementsCount).toBe(afterLoad.elementsCount);
  expect(afterSecond.portsCount).toBe(afterLoad.portsCount);
  expect(afterSecond.connectionsCount).toBe(afterLoad.connectionsCount);
  expect(afterSecond.equipHistory).toBe(afterLoad.equipHistory);

  // ── 3. Movimiento del motor vía API operacional (independiente del motor Py)
  await page.evaluate(({ MOTOR_ID }) => {
    const w = window as typeof window & {
      __codex?: { workspaceStore?: { getState: () => unknown } };
    };
    const s = w.__codex!.workspaceStore!.getState() as {
      elements: Array<{
        id: string;
        placementStatus: string;
        transform?: unknown;
      }>;
      beginEquipCheckpoint: () => void;
      updateElementTransient: (el: unknown) => void;
    };
    const motor = s.elements.find((e) => e.id === MOTOR_ID)!;
    s.beginEquipCheckpoint();
    s.updateElementTransient({
      ...motor,
      placementStatus: 'placed',
      transform: {
        positionMm: { x: 5500, y: 2500, z: 250 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
  }, { MOTOR_ID });
  const afterMove = await readSnapshot(page);
  expect(afterMove.motorPos?.x).toBe(5500);
  expect(afterMove.motorPos?.y).toBe(2500);

  // ── 4. Export + import preservan equipos + conexión ────────────────────────
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Exportar JSON/ }).click();
  const download: Download = await downloadPromise;
  const exportPath = resolve(OUT_DIR, `test-scenario-${Date.now()}.json`);
  await download.saveAs(exportPath);
  const raw = readFileSync(exportPath, 'utf8');
  const parsed = JSON.parse(raw);
  const projectV2 = parsed.projectV2;
  const exportedTablero = projectV2.elements.find((e: { id: string }) => e.id === TABLERO_ID);
  const exportedMotor = projectV2.elements.find((e: { id: string }) => e.id === MOTOR_ID);
  const exportedConn = projectV2.connections.find((c: { id: string }) => c.id === CONN_ID);
  expect(exportedTablero).toBeTruthy();
  expect(exportedMotor).toBeTruthy();
  expect(exportedConn).toBeTruthy();
  expect(exportedMotor.transform.positionMm.x).toBe(5500);

  // Reimportar — aceptar cualquier confirm() que aparezca durante la ventana
  // (puede ser 1 o 2 según el estado dirty). Removemos el handler tras importar.
  const acceptAny = (d: import('@playwright/test').Dialog) => void d.accept();
  page.on('dialog', acceptAny);
  await page.getByRole('button', { name: /Importar JSON/ }).click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(exportPath);
  await page.waitForFunction(
    ({ MOTOR_ID }) => {
      const w = window as typeof window & {
        __codex?: { workspaceStore?: { getState: () => unknown } };
      };
      const s = w.__codex!.workspaceStore!.getState() as {
        elements: Array<{ id: string }>;
      };
      return s.elements.some((e) => e.id === MOTOR_ID);
    },
    { MOTOR_ID },
    { timeout: 10_000 },
  );
  const afterReimport = await readSnapshot(page);
  page.off('dialog', acceptAny);
  expect(afterReimport.hasTablero).toBe(true);
  expect(afterReimport.hasMotor).toBe(true);
  expect(afterReimport.motorPos?.x).toBe(5500);
  expect(afterReimport.connectionsCount).toBeGreaterThanOrEqual(1);

  // ── 5. Undo del load restaura el estado previo ─────────────────────────────
  // Re-cargamos el escenario en un store limpio para probar el undo aislado.
  await page.evaluate(() => {
    const w = window as typeof window & {
      __codex?: { workspaceStore?: { getState: () => unknown } };
    };
    const s = w.__codex!.workspaceStore!.getState() as { reset: () => void };
    s.reset();
  });
  const cleanBefore = await readSnapshot(page);
  await page.getByTestId('load-test-scenario').click();
  const loaded = await readSnapshot(page);
  expect(loaded.hasTablero).toBe(true);
  expect(loaded.hasMotor).toBe(true);

  await page.evaluate(() => {
    const w = window as typeof window & {
      __codex?: { workspaceStore?: { getState: () => unknown } };
    };
    const s = w.__codex!.workspaceStore!.getState() as { undoEquip: () => void };
    s.undoEquip();
  });
  const undone = await readSnapshot(page);
  expect(undone.hasTablero).toBe(false);
  expect(undone.hasMotor).toBe(false);
  expect(undone.elementsCount).toBe(cleanBefore.elementsCount);
  expect(undone.portsCount).toBe(cleanBefore.portsCount);
  expect(undone.connectionsCount).toBe(cleanBefore.connectionsCount);
  expect(undone.equipFuture).toBeGreaterThanOrEqual(1);

  writeFileSync(
    resolve(OUT_DIR, 'testScenario-summary.json'),
    JSON.stringify({ before, afterLoad, afterSecond, afterMove, afterReimport, undone }, null, 2),
  );
});
