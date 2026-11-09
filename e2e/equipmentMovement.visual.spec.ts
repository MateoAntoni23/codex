/**
 * E2E — Movimiento libre del equipo importado + ficha técnica + round-trip.
 *
 *  1. Importar libro y colocar motor + instrumento.
 *  2. Editar posición desde el editor numérico (DOM real: X/Y/Z + Aplicar).
 *  3. Cancelar una edición parcial: draft vuelve al valor del store.
 *  4. Simular drag en escena: beginEquipCheckpoint() + updateElementTransient()
 *     repetidos. El store refleja cada frame y el historial recibe UN único
 *     checkpoint para que Deshacer revierta la gesto completa.
 *  5. Deshacer / Rehacer equipo: un botón visible en el inspector, con contador.
 *  6. Exportar JSON y recargar: posición final y ficha técnica (potencia, tensión,
 *     fases) del motor se preservan en el round-trip.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const OUT_DIR = resolve(__dirname, 'output');

type StoreElementSnapshot = {
  id: string;
  name: string;
  placementStatus: string;
  positionMm?: { x: number; y: number; z: number };
  importedRef: { equipoId: string; libroId: string } | null;
  technicalKeys: string[];
};

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/?workspace=bandejas');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
}

async function importFixture(page: Page): Promise<void> {
  await page.getByTestId('open-import-wizard').click();
  await page.locator('.import-wizard').waitFor({ state: 'visible', timeout: 10_000 });
  const fileInput = page.locator('.import-wizard input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);
  await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 20_000 });
  await page.locator('.import-wizard-footer button.primary').click();
  await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 10_000 });
  await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();
}

async function placeFromTree(page: Page, tag: string): Promise<void> {
  const tree = page.locator('.imported-tree-section');
  await tree.locator('input[type="text"]').fill(tag);
  await tree.locator('.imported-tree-item', { hasText: tag }).first().click();
  await page.getByTestId('imported-place').click();
}

async function readStore(page: Page): Promise<{
  elementsCount: number;
  equipHistory: number;
  equipFuture: number;
  selectedEquipId: string | null;
  byId: Record<string, StoreElementSnapshot>;
}> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      elements: Array<{
        id: string;
        name: string;
        placementStatus: string;
        transform?: { positionMm: { x: number; y: number; z: number } };
        importedRef: { equipoId: string; libroId: string } | null;
        technical?: Record<string, unknown>;
      }>;
      equipHistory: unknown[];
      equipFuture: unknown[];
      selectedEquipId: string | null;
    };
    const byId: Record<string, StoreElementSnapshot> = {};
    for (const el of s.elements) {
      byId[el.id] = {
        id: el.id,
        name: el.name,
        placementStatus: el.placementStatus,
        positionMm: el.placementStatus === 'placed' ? el.transform?.positionMm : undefined,
        importedRef: el.importedRef,
        technicalKeys: el.technical ? Object.keys(el.technical) : [],
      };
    }
    return {
      elementsCount: s.elements.length,
      equipHistory: s.equipHistory.length,
      equipFuture: s.equipFuture.length,
      selectedEquipId: s.selectedEquipId,
      byId,
    };
  });
}

/** Simula un drag en escena: UN checkpoint al inicio + N frames transientes. */
async function simulateSceneDrag(
  page: Page,
  elementId: string,
  waypoints: Array<{ x: number; y: number; z: number }>,
): Promise<void> {
  await page.evaluate(({ elementId, waypoints }) => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      elements: Array<{ id: string; placementStatus: string; transform?: unknown }>;
      beginEquipCheckpoint: () => void;
      updateElementTransient: (el: unknown) => void;
    };
    s.beginEquipCheckpoint();
    for (const pos of waypoints) {
      const el = (w.__codex!.workspaceStore!.getState() as typeof s).elements.find((e) => e.id === elementId);
      if (!el) throw new Error(`Element ${elementId} not found during drag`);
      const next = {
        ...el,
        placementStatus: 'placed',
        transform: { positionMm: pos, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      };
      s.updateElementTransient(next);
    }
  }, { elementId, waypoints });
}

test('movimiento + ficha técnica + round-trip (motor e instrumento)', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── 1. Importar + colocar motor + instrumento ─────────────────────────────
  await openWorkspace(page);
  await importFixture(page);

  // Motor S1-SOP101 (EQ-0026) desde el árbol real.
  await placeFromTree(page, 'S1-SOP101');
  const afterMotor = await readStore(page);
  const motorId = Object.keys(afterMotor.byId).find(
    (k) => afterMotor.byId[k].importedRef?.equipoId === 'EQ-0026',
  );
  expect(motorId).toBeTruthy();
  expect(afterMotor.byId[motorId!].placementStatus).toBe('placed');
  expect(afterMotor.byId[motorId!].technicalKeys).toContain('power');
  expect(afterMotor.byId[motorId!].technicalKeys).toContain('voltage');
  expect(afterMotor.byId[motorId!].technicalKeys).toContain('phases');

  // Instrumento — vía placeImportedEquipo para no depender de un tag específico.
  const instrumentoId = await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      importedCatalog: { equipos: Array<{ equipoId: string; categoria: string }> } | null;
      placeImportedEquipo: (eqId: string, pos: unknown) => string | null;
    };
    const instr = s.importedCatalog!.equipos.find((e) => e.categoria === 'INSTRUMENTO_TRANSMISOR');
    if (!instr) throw new Error('No INSTRUMENTO_TRANSMISOR found');
    return s.placeImportedEquipo(instr.equipoId, { x: 3000, y: 1000, z: 1200 });
  });
  expect(instrumentoId).toBeTruthy();

  // ── 2. Editor numérico real: X=1500, Y=2500, Z=400 → Aplicar ──────────────
  // El inspector derecho ya está sobre el motor (último "Colocar en escena" lo seleccionó).
  // Re-seleccionamos por robustez.
  await page.evaluate((id) => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as { selectEquip: (id: string) => void };
    s.selectEquip(id);
  }, motorId);

  await page.locator('#pi-pos-x').fill('1500');
  await page.locator('#pi-pos-y').fill('2500');
  await page.locator('#pi-pos-z').fill('400');
  await page.locator('.btn-primary:has-text("Aplicar")').click();

  const afterNumeric = await readStore(page);
  expect(afterNumeric.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 400 });
  expect(afterNumeric.equipHistory).toBeGreaterThanOrEqual(1); // al menos un snapshot
  expect(afterNumeric.equipFuture).toBe(0);

  // ── 3. Cancelar: edito X parcial pero clico Cancelar → draft vuelve al store ─
  await page.locator('#pi-pos-x').fill('9999');
  await page.locator('button:has-text("Cancelar")').click();
  // El draft debe estar sincronizado con la posición real del store.
  await expect(page.locator('#pi-pos-x')).toHaveValue('1500');
  const afterCancel = await readStore(page);
  expect(afterCancel.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 400 });

  // ── 4. Simular drag (3 waypoints) ─ un único checkpoint, posición final (2000,3000,500) ─
  const histBefore = afterCancel.equipHistory;
  await simulateSceneDrag(page, motorId!, [
    { x: 1700, y: 2700, z: 450 },
    { x: 1900, y: 2900, z: 480 },
    { x: 2000, y: 3000, z: 500 },
  ]);
  const afterDrag = await readStore(page);
  expect(afterDrag.byId[motorId!].positionMm).toEqual({ x: 2000, y: 3000, z: 500 });
  // Un único checkpoint, no uno por frame.
  expect(afterDrag.equipHistory).toBe(histBefore + 1);
  expect(afterDrag.equipFuture).toBe(0);

  // Captura del canvas con el motor en su posición final tras drag.
  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'move-after-drag.png'),
  });

  // ── 5. Deshacer: botón visible, revierte el drag completo ─────────────────
  const undoBtn = page.getByTestId('equip-undo');
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  const afterUndo = await readStore(page);
  expect(afterUndo.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 400 });
  expect(afterUndo.equipFuture).toBeGreaterThanOrEqual(1);

  // Rehacer vuelve al estado final.
  const redoBtn = page.getByTestId('equip-redo');
  await expect(redoBtn).toBeVisible();
  await redoBtn.click();
  const afterRedo = await readStore(page);
  expect(afterRedo.byId[motorId!].positionMm).toEqual({ x: 2000, y: 3000, z: 500 });

  // ── 6. Round-trip: Export + reload preserva posición + ficha técnica ──────
  // El botón "Exportar JSON" exige que el motor Python esté arriba (tray.entrada != null).
  // Como el movimiento del equipo no depende del trazado de bandejas, seedeamos un
  // TrayInput mínimo válido para que la UI serialice por su pipeline real (exportWorkspace).
  await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { trayStore?: { getState: () => unknown } } };
    const ts = w.__codex!.trayStore!.getState() as {
      entrada: unknown;
      importEdit: (input: unknown) => void;
    };
    if (ts.entrada) return;
    ts.importEdit({
      version_contrato: 'trazado/1',
      piezas: [],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: 'test-e2e', conductores: [] },
    });
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exportar JSON/ }).click(),
  ]) as [Download, void];
  const exportPath = await download.path();
  if (!exportPath) throw new Error('Export did not produce a file');
  const exportBuf = readFileSync(exportPath, 'utf-8');
  writeFileSync(resolve(OUT_DIR, 'equipmentMovement-exported.json'), exportBuf);
  const exportJson = JSON.parse(exportBuf) as {
    importedCatalog?: { catalog?: unknown };
    projectV2?: {
      elements?: Array<{
        id: string;
        transform?: { positionMm: { x: number; y: number; z: number } };
        technical?: Record<string, unknown>;
      }>;
    };
  };
  const motorExported = exportJson.projectV2?.elements?.find((e) => e.id === motorId);
  expect(motorExported?.transform?.positionMm).toEqual({ x: 2000, y: 3000, z: 500 });
  // La ficha técnica del motor viaja con el JSON.
  expect(motorExported?.technical).toBeDefined();
  expect(Object.keys(motorExported!.technical!)).toContain('power');
  expect(Object.keys(motorExported!.technical!)).toContain('voltage');
  expect(Object.keys(motorExported!.technical!)).toContain('phases');

  // Recargar el JSON exportado.
  await page.goto('/?workspace=bandejas');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate((jsonTxt) => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      loadFile: (elements: unknown[], evidence: unknown[], meta: unknown, fileName: string, importedCatalog?: unknown | null) => void;
    };
    const j = JSON.parse(jsonTxt) as {
      projectV2?: { elements?: unknown[]; evidence?: unknown[]; [k: string]: unknown };
      importedCatalog?: { catalog?: unknown };
    };
    const pv2 = j.projectV2 ?? {};
    const { elements: _e, evidence: _ev, schemaVersion: _sv, ...meta } = pv2 as Record<string, unknown>;
    s.loadFile(
      (pv2.elements ?? []) as unknown[],
      (pv2.evidence ?? []) as unknown[],
      meta,
      'reloaded.json',
      j.importedCatalog?.catalog ?? null,
    );
  }, exportBuf);

  const afterReload = await readStore(page);
  expect(afterReload.byId[motorId!]).toBeDefined();
  expect(afterReload.byId[motorId!].positionMm).toEqual({ x: 2000, y: 3000, z: 500 });
  expect(afterReload.byId[motorId!].technicalKeys).toContain('power');
  expect(afterReload.byId[motorId!].technicalKeys).toContain('voltage');
  expect(afterReload.byId[motorId!].technicalKeys).toContain('phases');
  // Historial se limpia tras loadFile (no permitimos undo cruzando cargas de archivo).
  expect(afterReload.equipHistory).toBe(0);
  expect(afterReload.equipFuture).toBe(0);
});
