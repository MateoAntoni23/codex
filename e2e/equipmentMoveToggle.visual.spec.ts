/**
 * E2E con eventos reales de mouse — descubribilidad y uso del modo Mover.
 *
 *  1. Importar el libro real y colocar motor EA-BBA004.
 *  2. Seleccionar con click en el canvas sobre el motor; verificar inspector.
 *  3. Verificar: el gizmo NO aparece sólo con selección (requiere modo mover).
 *  4. Click real en "✥ Mover libremente" (inspector) → el gizmo + hint aparecen.
 *  5. Capturar camera.position; drag real sobre el handle X del gizmo; verificar:
 *     - position.x del motor cambió en el store;
 *     - la cámara no se movió (OrbitControls inhibido por TransformControls).
 *  6. Esc real → modo mover se apaga, hint desaparece.
 *  7. Deshacer (botón) → posición vuelve al valor previo al drag.
 *  8. Capturas antes/después del movimiento.
 *
 * Esta prueba NO muta el store directamente para arrastrar — usa page.mouse.*
 * sobre el handle X proyectado a coords 2D del canvas. Si el gizmo no se monta,
 * el drag no toca ningún handle y la posición queda estática: el test falla y
 * documenta el bug real que reportó el usuario.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
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
  await page.locator('.import-wizard input[type="file"]').setInputFiles(FIXTURE);
  await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 20_000 });
  await page.locator('.import-wizard-footer button.primary').click();
  await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 10_000 });
  await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();
}

async function placeFromTree(page: Page, tag: string): Promise<string> {
  const tree = page.locator('.imported-tree-section');
  await tree.locator('input[type="text"]').fill(tag);
  await tree.locator('.imported-tree-item', { hasText: tag }).first().click();
  await page.getByTestId('imported-place').click();
  return await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as { selectedEquipId: string | null };
    return s.selectedEquipId as string;
  });
}

/** Proyecta un punto mundo→canvas 2D usando THREE y devuelve (x,y) relativos al canvas. */
async function worldToCanvas(page: Page, world: { x: number; y: number; z: number }): Promise<{ x: number; y: number }> {
  const canvasBox = await page.locator('.unified-workspace-canvas canvas').boundingBox();
  if (!canvasBox) throw new Error('canvas sin bounding box');
  const ndc = await page.evaluate((w) => {
    const g = window as typeof window & {
      __codex?: { camera?: unknown; scene?: unknown };
      THREE?: unknown;
    };
    // THREE no está global — importamos la copia de la cámara y usamos la API directa.
    const cam = g.__codex!.camera as { project: (v: unknown) => { x: number; y: number }; isCamera?: boolean };
    // Construir un Vector3-like con el método mínimo de proyección.
    const v = { x: w.x, y: w.y, z: w.z, isVector3: true };
    // Replicate Vector3.project: v.applyMatrix4(camera.projectionMatrix * camera.matrixWorldInverse).
    // Para no replicar, usamos la clase a través del constructor que three cuelga en cam.
    // El objeto cámara expone .matrixWorldInverse y .projectionMatrix como THREE.Matrix4.
    const c = cam as unknown as {
      matrixWorldInverse: { elements: number[] };
      projectionMatrix: { elements: number[] };
    };
    // mul4x4(p, m) devuelve p' = m·p en column-major (like three).
    const mul = (p: { x: number; y: number; z: number; w: number }, m: { elements: number[] }) => {
      const e = m.elements;
      return {
        x: e[0] * p.x + e[4] * p.y + e[8]  * p.z + e[12] * p.w,
        y: e[1] * p.x + e[5] * p.y + e[9]  * p.z + e[13] * p.w,
        z: e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14] * p.w,
        w: e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15] * p.w,
      };
    };
    const viewSpace = mul({ x: v.x, y: v.y, z: v.z, w: 1 }, c.matrixWorldInverse);
    const clip = mul(viewSpace, c.projectionMatrix);
    return { x: clip.x / clip.w, y: clip.y / clip.w };
  }, world);
  // NDC (-1..1) → canvas (0..width/height) — y invertida.
  const cx = canvasBox.x + (ndc.x * 0.5 + 0.5) * canvasBox.width;
  const cy = canvasBox.y + (1 - (ndc.y * 0.5 + 0.5)) * canvasBox.height;
  return { x: cx, y: cy };
}

/** Lee la posición mundo del handle "X" del gizmo TransformControls (si existe). */
async function readGizmoXHandleWorld(page: Page): Promise<{ x: number; y: number; z: number } | null> {
  return await page.evaluate(() => {
    const g = window as typeof window & { __codex?: { scene?: unknown } };
    const scene = g.__codex!.scene as {
      traverse: (cb: (obj: unknown) => void) => void;
      updateMatrixWorld?: (force?: boolean) => void;
    };
    scene.updateMatrixWorld?.(true);
    let found: null | { x: number; y: number; z: number } = null;
    scene.traverse((o: unknown) => {
      const obj = o as {
        name?: string;
        matrixWorld?: { elements: number[] };
        parent?: unknown;
      };
      if (obj.name !== 'X' || !obj.matrixWorld) return;
      // Verificar que viene de TransformControls (padre o ancestro con isTransformControls).
      let p: { isTransformControls?: boolean; parent?: unknown } | undefined =
        obj.parent as { isTransformControls?: boolean; parent?: unknown };
      let isFromTC = false;
      while (p) {
        if (p.isTransformControls) { isFromTC = true; break; }
        p = p.parent as { isTransformControls?: boolean; parent?: unknown } | undefined;
      }
      if (!isFromTC) return;
      const e = obj.matrixWorld.elements;
      // Columna 3 (0-indexed) de una Matrix4 es la traslación en mundo.
      if (!found) found = { x: e[12], y: e[13], z: e[14] };
    });
    return found;
  });
}

async function readStore(page: Page): Promise<{
  selectedEquipId: string | null;
  moveMode: boolean;
  byId: Record<string, { positionMm?: { x: number; y: number; z: number } }>;
  equipHistory: number;
  equipFuture: number;
}> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __codex?: { workspaceStore?: { getState: () => unknown } } };
    const s = w.__codex!.workspaceStore!.getState() as {
      selectedEquipId: string | null;
      moveMode: boolean;
      equipHistory: unknown[];
      equipFuture: unknown[];
      elements: Array<{
        id: string;
        placementStatus: string;
        transform?: { positionMm: { x: number; y: number; z: number } };
      }>;
    };
    const byId: Record<string, { positionMm?: { x: number; y: number; z: number } }> = {};
    for (const el of s.elements) {
      byId[el.id] = { positionMm: el.placementStatus === 'placed' ? el.transform?.positionMm : undefined };
    }
    return {
      selectedEquipId: s.selectedEquipId,
      moveMode: s.moveMode,
      byId,
      equipHistory: s.equipHistory.length,
      equipFuture: s.equipFuture.length,
    };
  });
}

async function readCamera(page: Page): Promise<{ pos: [number, number, number]; target: [number, number, number] | null }> {
  return await page.evaluate(() => {
    const g = window as typeof window & { __codex?: { camera?: unknown; controls?: unknown } };
    const cam = g.__codex!.camera as { position: { x: number; y: number; z: number } };
    const ctl = g.__codex!.controls as { target?: { x: number; y: number; z: number } } | undefined;
    return {
      pos: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number],
      target: ctl?.target ? [ctl.target.x, ctl.target.y, ctl.target.z] : null,
    };
  });
}

test('toggle Mover: gizmo visible, drag con mouse real, cámara inmóvil, Esc', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  await openWorkspace(page);
  await importFixture(page);

  // Colocar EA-BBA004 (motor) y seleccionar.
  const motorId = await placeFromTree(page, 'EA-BBA004');
  expect(motorId).toBeTruthy();
  const initialStore = await readStore(page);
  expect(initialStore.selectedEquipId).toBe(motorId);
  expect(initialStore.moveMode).toBe(false);
  const initialPos = initialStore.byId[motorId].positionMm!;

  // Sin modo Mover: el hint on-screen NO debe existir.
  await expect(page.getByTestId('move-mode-hint')).toHaveCount(0);
  // Tampoco debe existir el gizmo "X" de TransformControls.
  expect(await readGizmoXHandleWorld(page)).toBeNull();

  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'move-toggle-01-before.png'),
  });

  // ── Toggle real con click ───────────────────────────────────────────────────
  const toggle = page.getByTestId('equip-move-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveText(/activo/i);

  // El hint aparece y el handle X del gizmo existe en la escena.
  await expect(page.getByTestId('move-mode-hint')).toBeVisible();
  const xHandleWorld = await readGizmoXHandleWorld(page);
  expect(xHandleWorld).not.toBeNull();

  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'move-toggle-02-gizmo-visible.png'),
  });

  // ── Drag real sobre el handle X ────────────────────────────────────────────
  const camBefore = await readCamera(page);
  const handle2D = await worldToCanvas(page, xHandleWorld!);

  // Movemos el ratón 120 px a la derecha, suficiente para un desplazamiento
  // perceptible del equipo. El exact delta en mm depende de la cámara; sólo
  // verificamos que la posición cambió y que la cámara no se movió.
  await page.mouse.move(handle2D.x, handle2D.y);
  await page.mouse.down();
  // Stepping explícito: TransformControls requiere movimientos para disparar
  // objectChange. Un único move con destino lejano a veces no basta.
  await page.mouse.move(handle2D.x + 40, handle2D.y, { steps: 4 });
  await page.mouse.move(handle2D.x + 80, handle2D.y, { steps: 4 });
  await page.mouse.move(handle2D.x + 120, handle2D.y, { steps: 4 });
  await page.mouse.up();

  const afterDrag = await readStore(page);
  const afterPos = afterDrag.byId[motorId].positionMm!;
  // Hubo movimiento en X (o en algún eje) — suficiente para probar que
  // el drag impactó el store. Estricto: delta en X ≥ 50 mm.
  expect(Math.abs(afterPos.x - initialPos.x)).toBeGreaterThan(50);
  // Un único checkpoint de historial para el drag completo.
  expect(afterDrag.equipHistory - initialStore.equipHistory).toBe(1);

  await page.locator('.unified-workspace-canvas canvas').screenshot({
    path: resolve(OUT_DIR, 'move-toggle-03-after-drag.png'),
  });

  // Cámara inmóvil — tolerancia pequeña por redondeos.
  const camAfter = await readCamera(page);
  const dCam = Math.hypot(
    camAfter.pos[0] - camBefore.pos[0],
    camAfter.pos[1] - camBefore.pos[1],
    camAfter.pos[2] - camBefore.pos[2],
  );
  expect(dCam).toBeLessThan(0.01);

  // ── Esc apaga el modo mover ─────────────────────────────────────────────────
  await page.keyboard.press('Escape');
  const afterEsc = await readStore(page);
  expect(afterEsc.moveMode).toBe(false);
  await expect(page.getByTestId('move-mode-hint')).toHaveCount(0);
  expect(await readGizmoXHandleWorld(page)).toBeNull();

  // ── Deshacer revierte el drag completo ─────────────────────────────────────
  const undoBtn = page.getByTestId('equip-undo');
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  const afterUndo = await readStore(page);
  expect(afterUndo.byId[motorId].positionMm).toEqual(initialPos);
});
