/**
 * E2E — Movimiento de bandejas (tramos) con gizmo + editor numérico.
 *
 * Cubre la aceptación del encargo:
 *   1. Crear y posicionar un recto nuevo (vía importEdit que simula tramo
 *      recién colocado — equivalente al workflow de usuario tras un AddTray).
 *   2. Confirmar la posición: cuerpo y bocas conservan la posición prevista.
 *   3. Mover un tramo aislado ya creado (editor numérico, mismo camino que el
 *      gizmo → translateWhole → edit atómico en history).
 *   4. Cancelar: ninguna entrada nueva en history.
 *      Deshacer / Rehacer: revierten/aplican en un solo paso.
 *   5. Mover un tramo conectado: el modal muestra las uniones que se
 *      perderían y ofrece "Aceptar y desconectar" o "Cancelar movimiento".
 *      Aceptar deja move + disconnect como UNA sola entrada en history.
 *   6. Exportar JSON y recuperar: la posición y el estado de desconexión
 *      sobreviven el round-trip.
 *
 * Nota sobre el gizmo: la interacción pixel-accurate con TransformControls de
 * drei es frágil en tests. Esta suite ejercita la MISMA ruta de código que el
 * drag end (translateWhole + findBrokenConnections + edit/requestConfirm) a
 * través del editor numérico y asserts sobre store — los data-testids del
 * gizmo / hint se verifican por presencia + toggle via el botón "Mover tramo".
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

type PortMm = [number, number, number];

type PieceSummary = {
  id: string;
  portPositions: Record<string, PortMm>;
  portDirs: Record<string, PortMm>;
};

type TraySnapshot = {
  piezas: PieceSummary[];
  conexiones: string[];
  historyLen: number;
  futureLen: number;
  pending: {
    pieceId: string;
    brokenConexionIds: string[];
  } | null;
};

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/?workspace=bandejas');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
  // Esperá a que __codex quede expuesto.
  await page.waitForFunction(() => {
    const w = window as typeof window & { __codex?: { trayStore?: unknown; workspaceStore?: unknown } };
    return !!w.__codex?.trayStore && !!w.__codex?.workspaceStore;
  }, { timeout: 10_000 });
}

/** Semilla: dos tramos rectos conectados en (3000,0,100). */
async function seedTwoConnectedStraight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { trayStore?: { getState: () => unknown } } };
    const ts = w.__codex!.trayStore!.getState() as { importEdit: (i: unknown) => void };
    ts.importEdit({
      version_contrato: 'trazado/1',
      piezas: [
        {
          instancia_id: 'T-1',
          producto_id: 'SAM_TRES-300-065-18-Z',
          longitud_mm: 3000,
          puertos: {
            P1: { posicion_mm: [0, 0, 100], direccion: [-1, 0, 0] },
            P2: { posicion_mm: [3000, 0, 100], direccion: [1, 0, 0] },
          },
        },
        {
          instancia_id: 'T-2',
          producto_id: 'SAM_TRES-300-065-18-Z',
          longitud_mm: 3000,
          puertos: {
            P1: { posicion_mm: [3000, 0, 100], direccion: [-1, 0, 0] },
            P2: { posicion_mm: [6000, 0, 100], direccion: [1, 0, 0] },
          },
        },
      ],
      conexiones: [
        { conexion_id: 'C-12', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
      ],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: 'e2e-tray-move', conductores: [] },
    });
  });
}

/** Semilla: un único tramo aislado sin conexiones. */
async function seedSingleIsolated(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { trayStore?: { getState: () => unknown } } };
    const ts = w.__codex!.trayStore!.getState() as { importEdit: (i: unknown) => void };
    ts.importEdit({
      version_contrato: 'trazado/1',
      piezas: [
        {
          instancia_id: 'T-1',
          producto_id: 'SAM_TRES-300-065-18-Z',
          longitud_mm: 3000,
          puertos: {
            P1: { posicion_mm: [0, 0, 100], direccion: [-1, 0, 0] },
            P2: { posicion_mm: [3000, 0, 100], direccion: [1, 0, 0] },
          },
        },
      ],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: 'e2e-tray-move', conductores: [] },
    });
  });
}

async function selectTrayPiece(page: Page, pieceId: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as { selectTray: (id: string | null) => void };
    s.selectTray(id);
  }, pieceId);
}

async function readSnapshot(page: Page): Promise<TraySnapshot> {
  return await page.evaluate(() => {
    const w = window as typeof window & {
      __codex?: {
        trayStore?: { getState: () => unknown };
      };
    };
    // trayMoveState vive fuera de __codex — accedemos indirectamente via el DOM
    // (presencia del modal). Pending se reporta por su existencia visible abajo.
    const ts = w.__codex!.trayStore!.getState() as {
      entrada: {
        piezas: Array<{
          instancia_id: string;
          puertos: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number] }>;
        }>;
        conexiones: Array<{ conexion_id: string }>;
      } | null;
      history: unknown[];
      future: unknown[];
    };
    const e = ts.entrada!;
    const piezas = e.piezas.map((p) => ({
      id: p.instancia_id,
      portPositions: Object.fromEntries(
        // Hito 2: las bocas se derivan de la pose → ruido numérico ~1e-14 mm.
        Object.entries(p.puertos).map(([k, v]) => [k, v.posicion_mm.map((x) => Math.round(x * 1e6) / 1e6 + 0)]),
      ) as Record<string, [number, number, number]>,
      portDirs: Object.fromEntries(
        Object.entries(p.puertos).map(([k, v]) => [k, v.direccion.map((x) => Math.round(x * 1e9) / 1e9 + 0)]),
      ) as Record<string, [number, number, number]>,
    }));
    return {
      piezas,
      conexiones: e.conexiones.map((c) => c.conexion_id),
      historyLen: ts.history.length,
      futureLen: ts.future.length,
      pending: null,
    };
  });
}

function pieceCentroidFromSnap(piece: PieceSummary): [number, number, number] {
  const ports = Object.values(piece.portPositions);
  let sx = 0, sy = 0, sz = 0;
  for (const p of ports) { sx += p[0]; sy += p[1]; sz += p[2]; }
  return [sx / ports.length, sy / ports.length, sz / ports.length];
}

test('mover tramos: gizmo visible, editor numérico, cancel/undo/redo, broken modal, export/recover', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── 1. Crear + posicionar un recto nuevo ──────────────────────────────────
  await openWorkspace(page);
  await seedSingleIsolated(page);
  await selectTrayPiece(page, 'T-1');

  const s0 = await readSnapshot(page);
  expect(s0.piezas).toHaveLength(1);
  expect(s0.piezas[0].id).toBe('T-1');
  expect(s0.historyLen).toBe(0);
  expect(s0.futureLen).toBe(0);

  // El inspector muestra el toggle "Mover tramo" y el editor numérico.
  const moveToggle = page.getByTestId('tray-move-toggle');
  await expect(moveToggle).toBeVisible();
  const centroidEditor = page.getByTestId('tray-centroid-editor');
  await expect(centroidEditor).toBeVisible();
  await expect(page.getByTestId('tray-centroid-input-X')).toHaveValue('1500');
  await expect(page.getByTestId('tray-centroid-input-Y')).toHaveValue('0');
  await expect(page.getByTestId('tray-centroid-input-Z')).toHaveValue('100');

  // Activar modo mover → se ve el hint en escena.
  await moveToggle.click();
  const hint = page.getByTestId('tray-move-mode-hint');
  await expect(hint).toBeVisible({ timeout: 5_000 });

  // Esc desactiva el modo. UnifiedWorkspace también escucha Escape y deselecciona
  // la pieza como efecto secundario — reseleccionamos para seguir editando.
  await page.keyboard.press('Escape');
  await expect(hint).not.toBeVisible({ timeout: 3_000 });
  await selectTrayPiece(page, 'T-1');
  await expect(page.getByTestId('tray-centroid-editor')).toBeVisible();

  // ── 2. Confirmar posición: traslación por editor numérico mantiene bocas ─
  // Trasladamos el centroide a (2500, 500, 400): delta = (+1000, +500, +300).
  await page.getByTestId('tray-centroid-input-X').fill('2500');
  await page.getByTestId('tray-centroid-input-Y').fill('500');
  await page.getByTestId('tray-centroid-input-Z').fill('400');
  await page.getByTestId('tray-centroid-apply').click();

  const s1 = await readSnapshot(page);
  // P1 pasa de (0,0,100) a (1000,500,400); P2 de (3000,0,100) a (4000,500,400).
  expect(s1.piezas[0].portPositions.P1).toEqual([1000, 500, 400]);
  expect(s1.piezas[0].portPositions.P2).toEqual([4000, 500, 400]);
  // Direcciones preservadas.
  expect(s1.piezas[0].portDirs.P1).toEqual([-1, 0, 0]);
  expect(s1.piezas[0].portDirs.P2).toEqual([1, 0, 0]);
  // Una sola entrada en history, no hay rotas → sin modal.
  expect(s1.historyLen).toBe(1);
  expect(s1.futureLen).toBe(0);
  await expect(page.getByTestId('tray-broken-modal')).not.toBeVisible();

  // ── 3. Mover un tramo aislado (ya creado) — otra traslación silenciosa ────
  await page.getByTestId('tray-centroid-input-Y').fill('-1000');
  await page.getByTestId('tray-centroid-apply').click();
  const s2 = await readSnapshot(page);
  expect(s2.piezas[0].portPositions.P1[1]).toBe(-1000);
  expect(s2.piezas[0].portPositions.P2[1]).toBe(-1000);
  expect(s2.historyLen).toBe(2);

  // ── 4. Cancelar + Deshacer / Rehacer ──────────────────────────────────────
  // El flujo de "cancelar antes de aplicar" en el editor numérico se expresa
  // naturalmente: cambiá el draft pero NO toques Aplicar. Entonces undo
  // revierte la ÚLTIMA aplicación. Hacemos undo para verificar.
  const undoBtn = page.locator('button[title^="Deshacer bandeja"]');
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  const sUndo = await readSnapshot(page);
  // Undo revierte a la posición tras la primera traslación (centroide 2500,500,400).
  expect(sUndo.piezas[0].portPositions.P1).toEqual([1000, 500, 400]);
  expect(sUndo.piezas[0].portPositions.P2).toEqual([4000, 500, 400]);
  expect(sUndo.futureLen).toBeGreaterThanOrEqual(1);

  const redoBtn = page.locator('button[title^="Rehacer bandeja"]');
  await expect(redoBtn).toBeVisible();
  await redoBtn.click();
  const sRedo = await readSnapshot(page);
  expect(sRedo.piezas[0].portPositions.P1[1]).toBe(-1000);

  // ── 5. Mover un tramo conectado → modal con dos opciones ──────────────────
  await seedTwoConnectedStraight(page);
  await selectTrayPiece(page, 'T-1');

  const sConn0 = await readSnapshot(page);
  expect(sConn0.conexiones).toContain('C-12');
  expect(sConn0.historyLen).toBe(0);

  // Trasladamos T-1 lo suficiente para romper C-12 (centroide 1500,0,100 → 1500,2000,100).
  await page.getByTestId('tray-centroid-input-Y').fill('2000');
  await page.getByTestId('tray-centroid-apply').click();

  // El modal debería aparecer con C-12 listada.
  const brokenModal = page.getByTestId('tray-broken-modal');
  await expect(brokenModal).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('broken-conn-C-12')).toBeVisible();

  // 5a. Cancelar movimiento → posición restaurada, sin history.
  await page.getByTestId('tray-broken-cancel').click();
  await expect(brokenModal).not.toBeVisible();
  const sCancel = await readSnapshot(page);
  expect(sCancel.piezas[0].portPositions.P1).toEqual([0, 0, 100]);
  expect(sCancel.piezas[0].portPositions.P2).toEqual([3000, 0, 100]);
  expect(sCancel.conexiones).toContain('C-12');
  expect(sCancel.historyLen).toBe(0);

  // 5b. Repetir → Aceptar y desconectar → UNA sola entrada en history.
  await page.getByTestId('tray-centroid-input-Y').fill('2000');
  await page.getByTestId('tray-centroid-apply').click();
  await expect(brokenModal).toBeVisible({ timeout: 3_000 });
  await page.getByTestId('tray-broken-accept').click();
  await expect(brokenModal).not.toBeVisible();

  const sAccept = await readSnapshot(page);
  expect(sAccept.piezas[0].portPositions.P1).toEqual([0, 2000, 100]);
  expect(sAccept.piezas[0].portPositions.P2).toEqual([3000, 2000, 100]);
  // C-12 fue descartada.
  expect(sAccept.conexiones).not.toContain('C-12');
  // Una ÚNICA entrada en history cubre move + disconnect.
  expect(sAccept.historyLen).toBe(1);

  // Deshacer revierte ambos: posición y conexión.
  const undoBtn2 = page.locator('button[title^="Deshacer bandeja"]');
  await undoBtn2.click();
  const sAtomicUndo = await readSnapshot(page);
  expect(sAtomicUndo.piezas[0].portPositions.P1).toEqual([0, 0, 100]);
  expect(sAtomicUndo.conexiones).toContain('C-12');

  // Y Rehacer vuelve al estado desconectado + movido en un paso.
  const redoBtn2 = page.locator('button[title^="Rehacer bandeja"]');
  await redoBtn2.click();
  const sAtomicRedo = await readSnapshot(page);
  expect(sAtomicRedo.piezas[0].portPositions.P1).toEqual([0, 2000, 100]);
  expect(sAtomicRedo.conexiones).not.toContain('C-12');

  // ── 6. Export + recover: posición y desconexión sobreviven ────────────────
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exportar JSON/ }).click(),
  ]) as [Download, void];
  const dlPath = await download.path();
  if (!dlPath) throw new Error('No download');
  const exportBuf = readFileSync(dlPath, 'utf-8');
  const parsed = JSON.parse(exportBuf) as {
    trayInput?: { piezas?: Array<{ instancia_id: string; puertos: Record<string, { posicion_mm: PortMm }> }>; conexiones?: Array<{ conexion_id: string }> };
  };
  const t1Exported = parsed.trayInput?.piezas?.find((p) => p.instancia_id === 'T-1');
  expect(t1Exported?.puertos.P1.posicion_mm).toEqual([0, 2000, 100]);
  expect(t1Exported?.puertos.P2.posicion_mm).toEqual([3000, 2000, 100]);
  expect(parsed.trayInput?.conexiones?.map((c) => c.conexion_id)).not.toContain('C-12');

  // Recargar via loadFile + importEdit (misma ruta que "Importar JSON").
  await page.goto('/?workspace=bandejas');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const w = window as typeof window & { __codex?: { trayStore?: unknown } };
    return !!w.__codex?.trayStore;
  }, { timeout: 10_000 });

  await page.evaluate((jsonTxt) => {
    const w = window as typeof window & {
      __codex?: {
        trayStore?: { getState: () => unknown };
        workspaceStore?: { getState: () => unknown };
      };
    };
    const j = JSON.parse(jsonTxt) as {
      projectV2?: { elements?: unknown[]; evidence?: unknown[]; [k: string]: unknown };
      trayInput?: unknown;
    };
    const pv2 = j.projectV2 ?? {};
    const { elements: _e, evidence: _ev, schemaVersion: _sv, ...meta } = pv2 as Record<string, unknown>;
    const ws = w.__codex!.workspaceStore!.getState() as {
      loadFile: (e: unknown[], ev: unknown[], m: unknown, fn: string, ic?: unknown | null) => void;
    };
    ws.loadFile((pv2.elements ?? []) as unknown[], (pv2.evidence ?? []) as unknown[], meta, 'tray-move-reload.json', null);
    if (j.trayInput) {
      const ts = w.__codex!.trayStore!.getState() as { importEdit: (i: unknown) => void };
      ts.importEdit(j.trayInput);
    }
  }, exportBuf);

  const sReload = await readSnapshot(page);
  const t1Reload = sReload.piezas.find((p) => p.id === 'T-1')!;
  expect(t1Reload.portPositions.P1).toEqual([0, 2000, 100]);
  expect(t1Reload.portPositions.P2).toEqual([3000, 2000, 100]);
  expect(sReload.conexiones).not.toContain('C-12');
  expect(sReload.historyLen).toBe(0);

  // Captura final del canvas con el tramo movido.
  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'tray-move-after-accept-reload.png'),
  });

  // Coherencia: la función pieceCentroidFromSnap nos sirve para asserts
  // suplementarios si en el futuro el editor de centroide cambia su cálculo.
  const c = pieceCentroidFromSnap(t1Reload);
  expect(c[0]).toBeCloseTo(1500, 3);
  expect(c[1]).toBeCloseTo(2000, 3);
  expect(c[2]).toBeCloseTo(100, 3);
});
