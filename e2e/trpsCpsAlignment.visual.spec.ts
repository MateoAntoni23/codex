/**
 * TRPS → CPS-90 → TRPS: captura REAL del DOM/scene (preview + confirmado).
 *
 * Qué hace:
 *   1) Carga el workspace unificado con ?workspace=bandejas.
 *   2) Inyecta el TrayInput ya resuelto (right turn) via window.__codex.trayStore.
 *   3) Lee window.__codex.dumpMeshes() — matrizWorld + placedP1/P2 reales de las
 *      meshes renderizadas por ParametricMesh (confirmado).
 *   4) Inicia una sesión de routing con el mismo startPort que planAddCurve, y
 *      selecciona CPS-90 como producto previsualizado → captura parametric-preview
 *      y su matrizWorld.
 *   5) Compara preview.matrixWorld ≈ confirmed.matrixWorld (de la pieza curva).
 *   6) Dumps al reporte y screenshots en e2e/output/.
 *
 * No depende de interacción con el canvas: todo via stores + __codex hook.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_RIGHT = resolve(__dirname, 'fixtures/tray-right.json');
const FIXTURE_LEFT  = resolve(__dirname, 'fixtures/tray-left.json');
const OUT_DIR       = resolve(__dirname, 'output');

type MeshDump = {
  kind: 'parametric-confirmed' | 'parametric-preview';
  instanciaId?: string;
  sku: string;
  chirality?: string;
  turnDirection?: string;
  mirrored: boolean;
  placedP1: [number, number, number];
  placedP2: [number, number, number];
  matrixWorld: number[];
  worldPosition: [number, number, number];
};

function fmt3(v: [number, number, number]): string {
  return `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`;
}

function matDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test.describe('TRPS → CPS-90 → TRPS visual alignment', () => {
  test('confirmed meshes + preview mesh — right turn', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });

    const trayRight = JSON.parse(readFileSync(FIXTURE_RIGHT, 'utf-8'));

    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    await page.goto('/?workspace=bandejas&diag=ports');

    // Esperar a que __codex esté listo (SceneBridge montado dentro de Canvas).
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );

    // Inyectar el TrayInput post-construcción (3 piezas + 2 conexiones).
    await page.evaluate((input) => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { importEdit: (i: unknown) => void } };
          routingStore: { getState: () => { deactivate: () => void } };
        };
      };
      w.__codex.routingStore.getState().deactivate();
      w.__codex.trayStore.getState().importEdit(input);
    }, trayRight);

    // Esperar a que las 3 meshes confirmadas estén renderizadas.
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      const meshes = w.__codex.dumpMeshes();
      return meshes.filter((m) => m.kind === 'parametric-confirmed').length === 3;
    }, { timeout: 20_000 });

    const focusInfoAll = await page.evaluate(() => {
      const w = window as unknown as { __codex: { focusTray: (opts?: { instanciaId?: string; padding?: number }) => { center: number[]; sizeM: number; distM: number } | null } };
      return w.__codex.focusTray();
    });
    console.log('focus all:', focusInfoAll);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT_DIR, '01-confirmed-right.png'), fullPage: true });
    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, '01-confirmed-right-canvas.png') });

    // Zoom cercano al empalme — solo la pieza curva (+padding).
    const focusInfoCurve = await page.evaluate(() => {
      const w = window as unknown as { __codex: { focusTray: (opts?: { instanciaId?: string; padding?: number }) => { center: number[]; sizeM: number; distM: number } | null } };
      return w.__codex.focusTray({ instanciaId: 'CRV-1', padding: 0.2 });
    });
    console.log('focus CRV-1:', focusInfoCurve);
    await page.waitForTimeout(400);
    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, '01b-confirmed-crv-zoom.png') });

    const confirmedDump = await page.evaluate(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes();
    });
    writeFileSync(
      resolve(OUT_DIR, 'confirmed-right.dump.json'),
      JSON.stringify(confirmedDump, null, 2),
    );

    const confirmedList = confirmedDump.filter((m) => m.kind === 'parametric-confirmed');
    console.log('\n╔══ CONFIRMED (right turn) ══╗');
    for (const m of confirmedList) {
      console.log(`  ${m.instanciaId} (${m.sku})  chirality=${m.chirality}  mirrored=${m.mirrored}`);
      console.log(`     placedP1=${fmt3(m.placedP1)}  placedP2=${fmt3(m.placedP2)}`);
      console.log(`     worldPos=${fmt3(m.worldPosition)}`);
    }

    // Validar que cada mesh confirmed coincide con el P1/P2 almacenado en la fixture.
    const tolMm = 0.1;
    for (const m of confirmedList) {
      const piece = trayRight.piezas.find((p: { instancia_id: string }) => p.instancia_id === m.instanciaId);
      expect(piece, `pieza ${m.instanciaId} debe existir en fixture`).toBeDefined();
      const storedP1 = piece.puertos.P1.posicion_mm as [number, number, number];
      const storedP2 = piece.puertos.P2.posicion_mm as [number, number, number];
      const dP1 = Math.hypot(m.placedP1[0] - storedP1[0], m.placedP1[1] - storedP1[1], m.placedP1[2] - storedP1[2]);
      const dP2 = Math.hypot(m.placedP2[0] - storedP2[0], m.placedP2[1] - storedP2[1], m.placedP2[2] - storedP2[2]);
      expect(dP1, `${m.instanciaId}: ΔP1(renderizado - almacenado)=${dP1} mm`).toBeLessThan(tolMm);
      expect(dP2, `${m.instanciaId}: ΔP2(renderizado - almacenado)=${dP2} mm`).toBeLessThan(tolMm);
    }

    // Validar gap entre piezas (en el marco rendered).
    const byId = new Map(confirmedList.map((m) => [m.instanciaId!, m]));
    for (const conn of trayRight.conexiones) {
      const [aId, aPort] = conn.a as [string, 'P1' | 'P2'];
      const [bId, bPort] = conn.b as [string, 'P1' | 'P2'];
      const ma = byId.get(aId)!; const mb = byId.get(bId)!;
      const pa = aPort === 'P1' ? ma.placedP1 : ma.placedP2;
      const pb = bPort === 'P1' ? mb.placedP1 : mb.placedP2;
      const gap = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      console.log(`  conexión ${conn.conexion_id}: ${aId}.${aPort} ↔ ${bId}.${bPort}  gap=${gap.toFixed(4)} mm`);
      expect(gap, `gap ${conn.conexion_id}`).toBeLessThan(tolMm);
    }

    // ─── Preview test ────────────────────────────────────────────────────
    //
    // Ahora activamos routing partiendo desde T1.P2 y seleccionamos CPS-90 con
    // turnDirection='right' — esto es lo que hace el usuario antes de confirmar.
    // Debemos ver un parametric-preview mesh cuya matriz coincida con la mesh
    // confirmada de CRV-1 (porque preview y confirmed deben compartir placeRecipe).
    await page.evaluate((trps) => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { importEdit: (i: unknown) => void } };
          routingStore: {
            getState: () => {
              activate: () => void;
              selectStartPort: (p: { pieceId: string; portName: string; pos: [number, number, number]; dir: [number, number, number] }) => void;
              setProduct: (id: string) => void;
              setTurnDirection: (d: 'left' | 'right') => void;
            };
          };
        };
      };
      // Reset tray to just T1 to isolate the preview.
      w.__codex.trayStore.getState().importEdit({
        version_contrato: 'trazado/1',
        piezas: [trps],
        conexiones: [],
        circuitos: [],
        soportes: [],
        pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
      });
      const r = w.__codex.routingStore.getState();
      r.activate();
      r.selectStartPort({
        pieceId: 'T1', portName: 'P2',
        pos: [3000, 0, 0], dir: [1, 0, 0],
      });
      r.setTurnDirection('right');
      r.setProduct('SAM_CPS-300-90-Z');
    }, trayRight.piezas[0]);

    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes().some((m) => m.kind === 'parametric-preview');
    }, { timeout: 10_000 });

    // Reposicionar cámara al mismo encuadre del empalme.
    await page.evaluate(() => {
      const w = window as unknown as { __codex: { scene: { traverse: (cb: (o: { isPerspectiveCamera?: boolean; position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void; updateProjectionMatrix: () => void }) => void) => void } } };
      w.__codex.scene.traverse((o) => {
        if (o.isPerspectiveCamera) {
          o.position.set(4.5, 2.0, 2.0);
          o.lookAt(3.2, 0, 0.3);
          o.updateProjectionMatrix();
        }
      });
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT_DIR, '02-preview-right.png'), fullPage: true });
    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, '02-preview-right-canvas.png') });

    const previewDump = await page.evaluate(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes();
    });
    writeFileSync(
      resolve(OUT_DIR, 'preview-right.dump.json'),
      JSON.stringify(previewDump, null, 2),
    );

    const preview = previewDump.find((m) => m.kind === 'parametric-preview')!;
    const confirmedCurve = confirmedList.find((m) => m.sku === 'CPS-300-90-Z')!;
    console.log('\n╔══ PREVIEW (right turn) ══╗');
    console.log(`  preview.placedP1 = ${fmt3(preview.placedP1)}`);
    console.log(`  preview.placedP2 = ${fmt3(preview.placedP2)}`);
    console.log(`  confirmed CRV.placedP1 = ${fmt3(confirmedCurve.placedP1)}`);
    console.log(`  confirmed CRV.placedP2 = ${fmt3(confirmedCurve.placedP2)}`);

    const dPreviewP1 = Math.hypot(
      preview.placedP1[0] - confirmedCurve.placedP1[0],
      preview.placedP1[1] - confirmedCurve.placedP1[1],
      preview.placedP1[2] - confirmedCurve.placedP1[2],
    );
    const dPreviewP2 = Math.hypot(
      preview.placedP2[0] - confirmedCurve.placedP2[0],
      preview.placedP2[1] - confirmedCurve.placedP2[1],
      preview.placedP2[2] - confirmedCurve.placedP2[2],
    );
    const matrixMaxDiff = matDiff(preview.matrixWorld, confirmedCurve.matrixWorld);
    console.log(`  Δ P1 preview↔confirmed = ${dPreviewP1.toFixed(4)} mm`);
    console.log(`  Δ P2 preview↔confirmed = ${dPreviewP2.toFixed(4)} mm`);
    console.log(`  max |Δ matrixWorld|     = ${matrixMaxDiff.toExponential(3)}`);

    writeFileSync(
      resolve(OUT_DIR, 'console.log'),
      consoleLogs.join('\n'),
    );

    expect(dPreviewP1, 'preview vs confirmed P1').toBeLessThan(tolMm);
    expect(dPreviewP2, 'preview vs confirmed P2').toBeLessThan(tolMm);
    expect(matrixMaxDiff, 'matrixWorld diff').toBeLessThan(1e-3);
  });

  test('confirmed meshes — left turn (mirrored chirality)', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const trayLeft = JSON.parse(readFileSync(FIXTURE_LEFT, 'utf-8'));

    await page.goto('/?workspace=bandejas&diag=ports');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );
    await page.evaluate((input) => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { importEdit: (i: unknown) => void } };
          routingStore: { getState: () => { deactivate: () => void } };
        };
      };
      w.__codex.routingStore.getState().deactivate();
      w.__codex.trayStore.getState().importEdit(input);
    }, trayLeft);

    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes().filter((m) => m.kind === 'parametric-confirmed').length === 3;
    }, { timeout: 20_000 });

    await page.evaluate(() => {
      const w = window as unknown as { __codex: { focusTray: () => unknown } };
      w.__codex.focusTray();
    });
    await page.waitForTimeout(400);
    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, '03-confirmed-left-canvas.png') });

    await page.evaluate(() => {
      const w = window as unknown as { __codex: { focusTray: (o: { instanciaId: string; padding: number }) => unknown } };
      w.__codex.focusTray({ instanciaId: 'CRV-1', padding: 0.2 });
    });
    await page.waitForTimeout(400);
    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, '03b-confirmed-left-crv-zoom.png') });

    const dump = await page.evaluate(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes();
    });
    writeFileSync(resolve(OUT_DIR, 'confirmed-left.dump.json'), JSON.stringify(dump, null, 2));

    const curve = dump.find((m) => m.kind === 'parametric-confirmed' && m.instanciaId === 'CRV-1')!;
    console.log(`\nLEFT: CRV-1 chirality=${curve.chirality} mirrored=${curve.mirrored}`);
    console.log(`  placedP1=${fmt3(curve.placedP1)}  placedP2=${fmt3(curve.placedP2)}`);
    expect(curve.chirality, 'left→mirrored').toBe('mirrored');
    expect(curve.mirrored, 'mirrored flag').toBe(true);

    const confirmedList = dump.filter((m) => m.kind === 'parametric-confirmed');
    for (const m of confirmedList) {
      const piece = trayLeft.piezas.find((p: { instancia_id: string }) => p.instancia_id === m.instanciaId);
      const storedP1 = piece.puertos.P1.posicion_mm as [number, number, number];
      const storedP2 = piece.puertos.P2.posicion_mm as [number, number, number];
      const dP1 = Math.hypot(m.placedP1[0] - storedP1[0], m.placedP1[1] - storedP1[1], m.placedP1[2] - storedP1[2]);
      const dP2 = Math.hypot(m.placedP2[0] - storedP2[0], m.placedP2[1] - storedP2[1], m.placedP2[2] - storedP2[2]);
      expect(dP1, `LEFT ${m.instanciaId}: ΔP1=${dP1}`).toBeLessThan(0.1);
      expect(dP2, `LEFT ${m.instanciaId}: ΔP2=${dP2}`).toBeLessThan(0.1);
    }
  });
});
