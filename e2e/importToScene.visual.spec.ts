/**
 * E2E — Flujo completo importado → operativo (aceptación 1 a 7).
 *
 *  1. Importar libro ELS-IMP-EQCX (fixture oficial).
 *  2. Colocar un motor y un instrumento (sensor) desde el árbol importado.
 *  3. Seleccionarlos desde árbol importado y desde el árbol de escena.
 *  4. Mover la posición (actualización directa del store) y verificar el nuevo valor.
 *  5. Exportar a JSON y recargar: posición + vínculo sobreviven el round-trip.
 *  6. Re-importar libro modificado (mismo equipoId, descripcion distinta, nuevo hash):
 *     identidad y transform se preservan; tag/name/libroId se actualizan.
 *  7. Re-importar el mismo libro: mismoHash=true, no duplica, no cambia nada.
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

async function selectImportedByTag(page: Page, tag: string): Promise<void> {
  const tree = page.locator('.imported-tree-section');
  await tree.locator('input[type="text"]').fill(tag);
  await tree.locator('.imported-tree-item', { hasText: tag }).first().click();
}

/**
 * Devuelve el estado relevante del store de workspace al E2E.
 * Usa __codex.workspaceStore para evitar depender del gizmo 3D (no existe aún).
 */
async function readStore(page: Page): Promise<{
  elementsCount: number;
  byId: Record<string, {
    id: string;
    tag: string | null;
    name: string;
    placementStatus: string;
    positionMm?: { x: number; y: number; z: number };
    importedRef: { equipoId: string; libroId: string } | null;
  }>;
  importedCatalog: { fileHash: string; equipos: number } | null;
}> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const store = w.__codex?.workspaceStore;
    if (!store) throw new Error('__codex.workspaceStore not available');
    const s = store.getState() as {
      elements: Array<{
        id: string;
        tag: string | null;
        name: string;
        placementStatus: string;
        transform?: { positionMm: { x: number; y: number; z: number } };
        importedRef: { equipoId: string; libroId: string } | null;
      }>;
      importedCatalog: { meta: { fileHash: string }; equipos: Array<unknown> } | null;
    };
    const byId: Record<string, {
      id: string;
      tag: string | null;
      name: string;
      placementStatus: string;
      positionMm?: { x: number; y: number; z: number };
      importedRef: { equipoId: string; libroId: string } | null;
    }> = {};
    for (const el of s.elements) {
      byId[el.id] = {
        id: el.id,
        tag: el.tag,
        name: el.name,
        placementStatus: el.placementStatus,
        positionMm: el.placementStatus === 'placed' ? el.transform?.positionMm : undefined,
        importedRef: el.importedRef,
      };
    }
    return {
      elementsCount: s.elements.length,
      byId,
      importedCatalog: s.importedCatalog
        ? { fileHash: s.importedCatalog.meta.fileHash, equipos: s.importedCatalog.equipos.length }
        : null,
    };
  });
}

/**
 * Mueve/coloca un elemento por id usando el store directamente.
 * Si el elemento está 'unplaced', lo pasa a 'placed' con rotación identidad.
 */
async function moveElement(page: Page, id: string, pos: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate(({ id, pos }) => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = (w.__codex!.workspaceStore!.getState() as {
      elements: Array<Record<string, unknown> & { id: string; placementStatus: string }>;
      updateElement: (el: unknown) => void;
    });
    const el = s.elements.find((e) => e.id === id);
    if (!el) throw new Error(`Element ${id} not found`);
    const next = {
      ...el,
      placementStatus: 'placed',
      transform: { positionMm: pos, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    };
    s.updateElement(next);
  }, { id, pos });
}

test('aceptación 1–7 — importado → operativo → mover → round-trip → reimport', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  // ─── Paso 1: Importar ──────────────────────────────────────────────────────
  await openWorkspace(page);
  await importFixture(page);

  const afterImport = await readStore(page);
  expect(afterImport.importedCatalog?.equipos).toBe(276);
  const originalHash = afterImport.importedCatalog!.fileHash;

  // ─── Paso 2: Colocar motor + instrumento ───────────────────────────────────
  // Captura antes de colocar para contrastar la evidencia visual.
  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'canvas-antes-de-colocar.png'),
  });

  // Motor S1-SOP101 (EQ-0026) desde la ficha del inspector importado.
  await selectImportedByTag(page, 'S1-SOP101');
  await expect(page.locator('.imported-inspector')).toContainText('S1-SOP101');
  await page.getByTestId('imported-place').click();
  const afterPlaceMotor = await readStore(page);
  const motorId = Object.keys(afterPlaceMotor.byId).find(
    (k) => afterPlaceMotor.byId[k].importedRef?.equipoId === 'EQ-0026',
  );
  expect(motorId).toBeTruthy();
  // Verificación crítica del fix: el botón "Colocar en escena" debe dejar el
  // elemento 'placed' con posición apoyada en el piso, no 'unplaced'. De lo
  // contrario WorkspaceScene lo filtra y el usuario no lo ve.
  expect(afterPlaceMotor.byId[motorId!].placementStatus).toBe('placed');
  expect(afterPlaceMotor.byId[motorId!].positionMm?.z).toBe(250); // motor cylinder length/2
  // Captura después de colocar — debe mostrar el cilindro en escena.
  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'canvas-despues-de-colocar.png'),
  });
  // Verificación adicional: la cámara apuntó al nuevo elemento. focusElement
  // debe estar expuesta y haber movido el target de los controles al equipo.
  const camInfo = await page.evaluate(() => {
    const w = window as typeof window & {
      __codex?: {
        camera?: { position: { x: number; y: number; z: number } };
        controls?: { target?: { x: number; y: number; z: number } };
        focusElement?: unknown;
      };
    };
    return {
      hasFocus: typeof w.__codex?.focusElement === 'function',
      target: w.__codex?.controls?.target
        ? { x: w.__codex.controls.target.x, y: w.__codex.controls.target.y, z: w.__codex.controls.target.z }
        : null,
      camera: w.__codex?.camera?.position
        ? { x: w.__codex.camera.position.x, y: w.__codex.camera.position.y, z: w.__codex.camera.position.z }
        : null,
    };
  });
  expect(camInfo.hasFocus).toBe(true);
  // Motor en viewer: positionMm (0, 0, 250) → [0, 0.25, 0]. Target debe estar
  // cerca de esa posición tras el focus automático.
  expect(camInfo.target).not.toBeNull();
  expect(Math.abs(camInfo.target!.x)).toBeLessThan(0.5);
  expect(Math.abs(camInfo.target!.y - 0.25)).toBeLessThan(0.5);
  expect(Math.abs(camInfo.target!.z)).toBeLessThan(0.5);
  // Mover a una posición conocida para el resto del flujo.
  await moveElement(page, motorId!, { x: 1000, y: 2000, z: 0 });

  // Buscar y colocar un instrumento. Usamos el primer INSTRUMENTO del catálogo.
  // Vía store — más determinista que escanear la lista por categoría.
  const instrumentoId = await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      importedCatalog: { equipos: Array<{ equipoId: string; categoria: string }> } | null;
      placeImportedEquipo: (eqId: string, pos: unknown) => string | null;
    };
    const instr = s.importedCatalog!.equipos.find((e) => e.categoria === 'INSTRUMENTO_TRANSMISOR');
    if (!instr) throw new Error('No INSTRUMENTO_TRANSMISOR found');
    return s.placeImportedEquipo(instr.equipoId, { x: 5000, y: 6000, z: 1200 });
  });
  expect(instrumentoId).toBeTruthy();

  // ─── Paso 3: Seleccionar desde árbol importado y desde árbol escena ────────
  await selectImportedByTag(page, 'S1-SOP101');
  await expect(page.locator('.imported-inspector')).toContainText('S1-SOP101');
  // El botón "Ver en escena" aparece cuando ya hay vínculo colocado.
  await expect(page.getByTestId('imported-goto-element')).toBeVisible();
  await page.getByTestId('imported-goto-element').click();
  // Verifica que el inspector operativo se activó (el equipment card debe mostrar el id).
  const selectedAfterGoto = await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    return (w.__codex!.workspaceStore!.getState() as { selectedEquipId: string | null }).selectedEquipId;
  });
  expect(selectedAfterGoto).toBe(motorId);

  // ─── Paso 4: Mover ─────────────────────────────────────────────────────────
  await moveElement(page, motorId!, { x: 1500, y: 2500, z: 300 });
  const afterMove = await readStore(page);
  expect(afterMove.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 300 });

  // ─── Paso 5: Exportar + recargar ───────────────────────────────────────────
  // El botón "Exportar JSON" exige tray.entrada != null (lo setea el motor Python
  // al iniciar). Si el motor no está arriba, seedeamos un TrayInput mínimo válido
  // para que la UI serialice por su pipeline real sin depender del backend.
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
  writeFileSync(resolve(OUT_DIR, 'importToScene-exported.json'), exportBuf);
  const exportJson = JSON.parse(exportBuf) as {
    importedCatalog?: { catalog?: { equipos: Array<unknown>; meta: { fileHash: string } } };
    projectV2?: { elements?: Array<{ id: string; placementStatus: string; transform?: unknown; importedRef: unknown }> };
  };
  expect(exportJson.importedCatalog?.catalog?.equipos?.length).toBe(276);
  const motorInExport = exportJson.projectV2?.elements?.find((e) => e.id === motorId);
  expect(motorInExport?.importedRef).toEqual({ equipoId: 'EQ-0026', libroId: originalHash });
  expect((motorInExport?.transform as { positionMm: unknown } | undefined)?.positionMm).toEqual({ x: 1500, y: 2500, z: 300 });

  // Recarga: abrir workspace nuevo + importar el JSON exportado vía loadFile directo.
  await page.goto('/?workspace=bandejas');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate((jsonTxt) => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      loadFile: (
        elements: unknown[],
        evidence: unknown[],
        meta: unknown,
        fileName: string,
        importedCatalog?: unknown | null,
      ) => void;
    };
    const j = JSON.parse(jsonTxt) as {
      projectV2?: {
        elements?: unknown[];
        evidence?: unknown[];
        [k: string]: unknown;
      };
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
  expect(afterReload.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 300 });
  expect(afterReload.byId[motorId!].importedRef).toEqual({ equipoId: 'EQ-0026', libroId: originalHash });

  // ─── Paso 6: Reimportar catálogo modificado (mismo equipoId, nuevo hash) ───
  // En lugar de un libro físico distinto, mutamos el catálogo recargado: cambiamos
  // descripcion y fileHash. setImportedCatalog debe reconciliar nombre/libroId pero
  // conservar el transform del motor.
  await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      importedCatalog: {
        meta: { fileHash: string };
        equipos: Array<{ equipoId: string; descripcion: string; tag: string }>;
      } | null;
      setImportedCatalog: (c: unknown) => void;
    };
    const next = JSON.parse(JSON.stringify(s.importedCatalog!)) as typeof s.importedCatalog & {
      meta: { fileHash: string };
      equipos: Array<{ equipoId: string; descripcion: string; tag: string }>;
    };
    next.meta.fileHash = 'f'.repeat(64);
    const motor = next.equipos.find((e) => e.equipoId === 'EQ-0026')!;
    motor.descripcion = 'MOTOR MODIFICADO E2E';
    s.setImportedCatalog(next);
  });
  const afterReimport = await readStore(page);
  expect(afterReimport.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 300 }); // transform intacto
  expect(afterReimport.byId[motorId!].name).toBe('MOTOR MODIFICADO E2E');
  expect(afterReimport.byId[motorId!].importedRef?.libroId).toBe('f'.repeat(64));

  // ─── Paso 7: Reimportar el mismo libro (mismoHash) — no duplica ────────────
  const countBeforeDup = afterReimport.elementsCount;
  await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      importedCatalog: unknown;
      setImportedCatalog: (c: unknown) => void;
    };
    // Re-aplicar el mismo catálogo (el hash es el mismo → es un no-op efectivo).
    s.setImportedCatalog(JSON.parse(JSON.stringify(s.importedCatalog)));
  });
  const afterSameHash = await readStore(page);
  expect(afterSameHash.elementsCount).toBe(countBeforeDup);
  // El transform y el vínculo del motor siguen iguales.
  expect(afterSameHash.byId[motorId!].positionMm).toEqual({ x: 1500, y: 2500, z: 300 });
  expect(afterSameHash.byId[motorId!].importedRef?.libroId).toBe('f'.repeat(64));
});
