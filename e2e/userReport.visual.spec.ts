/**
 * Reproducción + validación de la representación de escalera (SAM-STE-Z) sobre
 * el proyecto real del usuario.
 *
 * Carga `e2e/fixtures/user-report-20261107.workspace.json` tal cual exportó el
 * usuario, usando el mismo flujo del botón "Importar JSON" (importWorkspace →
 * loadFile + trayStore.importEdit). Verifica, sin modificar el fixture:
 *   1. Las 7 piezas se renderizan por el generador de escalera
 *      (ladder-straight / ladder-curve / ladder-tee) y no por los fallbacks
 *      box/line.
 *   2. Los puertos renderizados (los que usa la geometría escalera) coinciden
 *      con los puertos almacenados (ε < 0.1 mm). Es decir, la malla se ajusta
 *      a los puertos: no se mueve ningún puerto.
 *   3. Deshacer/rehacer funciona después de mutar el trazado (agregar y
 *      quitar una pieza) y no pierde las 7 piezas originales.
 *   4. Exportar → importar es round-trip exacto en `trayInput` + `elements` +
 *      `evidence`.
 *
 * Emite capturas: full + zoom T1 + zoom CS1, antes y después de los ciclos.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, 'fixtures/user-report-20261107.workspace.json');
const OUT_DIR = resolve(__dirname, 'output');

type V3 = [number, number, number];

type MeshDump = {
  kind: string;
  instanciaId?: string;
  sku?: string | null;
  widthMm?: number | null;
  alaMm?: number | null;
  lenMm?: number;
  radiusMm?: number;
  troncoLenMm?: number;
  ramalLenMm?: number;
  ports?: Record<string, V3>;
  reason?: string;
  part?: string;
  segment?: number;
  matrixWorld: number[];
  worldPosition: V3;
};

function fmt3(v: V3): string {
  return `(${v[0].toFixed(1)}, ${v[1].toFixed(1)}, ${v[2].toFixed(1)})`;
}

function distMm(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function loadUserProject(page: import('@playwright/test').Page, rawJson: string) {
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

async function waitForPieces(page: import('@playwright/test').Page, expected: string[]) {
  await page.waitForFunction((ids) => {
    const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
    const dump = w.__codex.dumpMeshes();
    const found = new Set(dump.map((m) => m.instanciaId).filter(Boolean));
    return ids.every((id) => found.has(id));
  }, expected, { timeout: 20_000 });
}

async function collectInventory(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
    return w.__codex.dumpMeshes();
  });
}

function pickByInstance(dump: MeshDump[]): Map<string, MeshDump> {
  const out = new Map<string, MeshDump>();
  for (const m of dump) {
    if (!m.instanciaId) continue;
    const prev = out.get(m.instanciaId);
    // Preferimos el tag "root" de la pieza (lleva `ports`) sobre los tags
    // de segmentos individuales (que llevan `part` o `segment`).
    const isRoot = !m.part && m.segment === undefined && m.ports;
    if (!prev || isRoot) {
      if (isRoot || !prev) out.set(m.instanciaId, m);
    }
  }
  return out;
}

test.describe('Reporte del usuario — escalera Z', () => {
  test('rendering ladder + undo/redo + export/import round-trip', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const rawJson = readFileSync(FIXTURE, 'utf-8');

    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    await page.goto('/?workspace=bandejas');

    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );

    await loadUserProject(page, rawJson);

    const expectedIds = ['R1', 'R2', 'T1', 'R3', 'R4', 'CS1', 'R5'];
    await waitForPieces(page, expectedIds);

    // Encuadrar toda la bandeja.
    await page.evaluate(() => {
      const w = window as unknown as { __codex: { focusTray: () => unknown } };
      w.__codex.focusTray();
    });
    await page.waitForTimeout(500);
    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'user-report-ladder-01-full.png') });

    // Zooms de inspección.
    for (const [id, file] of [['T1', 'user-report-ladder-02-T1.png'], ['CS1', 'user-report-ladder-03-CS1.png']] as const) {
      await page.evaluate((instId) => {
        const w = window as unknown as { __codex: { focusTray: (o: { instanciaId: string; padding: number }) => unknown } };
        w.__codex.focusTray({ instanciaId: instId, padding: 0.8 });
      }, id);
      await page.waitForTimeout(300);
      await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, file) });
    }

    const dump = await collectInventory(page);
    const byId = pickByInstance(dump);
    writeFileSync(resolve(OUT_DIR, 'user-report-ladder.dump.json'), JSON.stringify(dump, null, 2));

    // 1 — Todas las piezas pasan por el generador escalera.
    console.log('\n╔════ RUTA DE RENDER (familia escalera) ════╗');
    const parsed = JSON.parse(rawJson) as {
      trayInput: {
        piezas: Array<{
          instancia_id: string;
          producto_id: string;
          puertos: Record<string, { posicion_mm: V3; direccion: V3 }>;
        }>;
        conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }>;
      };
    };
    for (const id of expectedIds) {
      const m = byId.get(id);
      const pz = parsed.trayInput.piezas.find((p) => p.instancia_id === id)!;
      console.log(`  ${id} (${pz.producto_id}) → ${m?.kind ?? 'MISSING'}  (width=${m?.widthMm ?? '∅'} ala=${m?.alaMm ?? '∅'} len/radius/tronco=${m?.lenMm ?? m?.radiusMm ?? m?.troncoLenMm ?? '∅'})`);
      expect(m, `${id} debe tener root-tag de escalera`).toBeTruthy();
      expect(m!.kind, `${id} ruta de render`).toMatch(/^ladder-(straight|curve|tee)$/);
    }

    // 2 — Puertos renderizados coinciden con puertos almacenados (no se moviero).
    console.log('\n╔════ PUERTOS RENDERIZADOS vs ALMACENADOS ════╗');
    const tolMm = 0.1;
    for (const id of expectedIds) {
      const m = byId.get(id)!;
      const pz = parsed.trayInput.piezas.find((p) => p.instancia_id === id)!;
      for (const [portName, stored] of Object.entries(pz.puertos)) {
        const rendered = m.ports?.[portName];
        expect(rendered, `${id}.${portName} debe tener puerto renderizado`).toBeDefined();
        const d = distMm(rendered!, stored.posicion_mm);
        console.log(`  ${id}.${portName}: stored=${fmt3(stored.posicion_mm)} rendered=${fmt3(rendered!)}  Δ=${d.toFixed(3)} mm`);
        expect(d, `${id}.${portName} debe mantenerse en su posición`).toBeLessThan(tolMm);
      }
    }

    // Gaps entre puertos conectados = 0 (ya era 0 en pre-ladder, se mantiene).
    console.log('\n╔════ GAPS EN CONEXIONES (post-ladder) ════╗');
    const junctions: Array<{ connection: string; gapMm: number }> = [];
    for (const conn of parsed.trayInput.conexiones) {
      const [aId, aPort] = conn.a;
      const [bId, bPort] = conn.b;
      const pa = byId.get(aId)?.ports?.[aPort];
      const pb = byId.get(bId)?.ports?.[bPort];
      expect(pa, `${conn.conexion_id}: puerto ${aId}.${aPort} renderizado`).toBeDefined();
      expect(pb, `${conn.conexion_id}: puerto ${bId}.${bPort} renderizado`).toBeDefined();
      const gap = distMm(pa!, pb!);
      console.log(`  ${conn.conexion_id}: ${aId}.${aPort} ↔ ${bId}.${bPort}  gap=${gap.toFixed(3)} mm`);
      expect(gap, `${conn.conexion_id} gap`).toBeLessThan(tolMm);
      junctions.push({ connection: conn.conexion_id, gapMm: gap });
    }
    writeFileSync(resolve(OUT_DIR, 'user-report-ladder.junctions.json'), JSON.stringify(junctions, null, 2));

    // 3 — Undo/redo: mutamos agregando una pieza fantasma (tocar revision),
    // comprobamos que las 7 piezas persistan después de deshacer.
    const beforeCount = parsed.trayInput.piezas.length;
    const mutResult = await page.evaluate((pieces: typeof parsed.trayInput.piezas) => {
      const w = window as unknown as {
        __codex: {
          trayStore: {
            getState: () => {
              entrada: { piezas: Array<{ instancia_id: string }>; conexiones: unknown[] } | null;
              edit: (next: unknown) => void;
              undo: () => void;
              redo: () => void;
              revision: number;
            };
          };
        };
      };
      const s0 = w.__codex.trayStore.getState();
      const rev0 = s0.revision;
      const snap0 = s0.entrada ? JSON.parse(JSON.stringify(s0.entrada)) : null;
      // Crear una copia con una pieza extra "GHOST" sin conectar.
      const next = snap0 ? JSON.parse(JSON.stringify(snap0)) : null;
      if (!next) return { error: 'no entrada' };
      next.piezas.push({
        instancia_id: 'GHOST',
        producto_id: pieces[0].producto_id,
        puertos: {
          P1: { posicion_mm: [-5000, 0, 0], direccion: [-1, 0, 0] },
          P2: { posicion_mm: [-2000, 0, 0], direccion: [1, 0, 0] },
        },
      });
      s0.edit(next);
      const rev1 = w.__codex.trayStore.getState().revision;
      const after = w.__codex.trayStore.getState().entrada;
      const idsAfterEdit = after?.piezas.map((p) => p.instancia_id) ?? [];
      // Undo
      w.__codex.trayStore.getState().undo();
      const rev2 = w.__codex.trayStore.getState().revision;
      const afterUndo = w.__codex.trayStore.getState().entrada;
      const idsAfterUndo = afterUndo?.piezas.map((p) => p.instancia_id) ?? [];
      // Redo
      w.__codex.trayStore.getState().redo();
      const rev3 = w.__codex.trayStore.getState().revision;
      const afterRedo = w.__codex.trayStore.getState().entrada;
      const idsAfterRedo = afterRedo?.piezas.map((p) => p.instancia_id) ?? [];
      // Undo final para restaurar.
      w.__codex.trayStore.getState().undo();
      return {
        rev0, rev1, rev2, rev3,
        idsAfterEdit, idsAfterUndo, idsAfterRedo,
      };
    }, parsed.trayInput.piezas);

    console.log('\n╔════ UNDO / REDO ════╗');
    console.log(`  rev secuencia: ${mutResult.rev0} → ${mutResult.rev1} (edit) → ${mutResult.rev2} (undo) → ${mutResult.rev3} (redo)`);
    expect(mutResult.idsAfterEdit?.length, 'edit agrega GHOST').toBe(beforeCount + 1);
    expect(mutResult.idsAfterUndo?.length, 'undo quita GHOST').toBe(beforeCount);
    expect(mutResult.idsAfterRedo?.length, 'redo re-agrega GHOST').toBe(beforeCount + 1);
    expect((mutResult.idsAfterUndo as string[]).sort(), 'undo: 7 originales presentes').toEqual(expectedIds.slice().sort());

    // Esperar a que post-undo final el estado vuelva a tener 7 piezas renderizadas.
    await waitForPieces(page, expectedIds);

    // 4 — Export → Import round-trip: serializar y re-importar, comparar.
    const roundTrip = await page.evaluate(async (originalRaw) => {
      const workspaceFile = await import('/src/workspace/workspaceFile.ts');
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { entrada: unknown } };
          workspaceStore: {
            getState: () => { elements: unknown[]; evidence: unknown[]; projectMeta: unknown };
          };
        };
      };
      const tray = w.__codex.trayStore.getState().entrada;
      const ws = w.__codex.workspaceStore.getState();
      const json = workspaceFile.exportWorkspace(
        ws.elements as never,
        ws.evidence as never,
        ws.projectMeta as never,
        tray as never,
      );
      const original = JSON.parse(originalRaw) as { trayInput: unknown; projectV2: { elements: unknown[]; evidence: unknown[] } };
      const reimported = workspaceFile.importWorkspace(json);
      return {
        originalTray: original.trayInput,
        originalElements: original.projectV2.elements,
        originalEvidence: original.projectV2.evidence,
        reimpTray: reimported.trayInput,
        reimpElements: reimported.projectV2.elements,
        reimpEvidence: reimported.projectV2.evidence,
      };
    }, rawJson);

    console.log('\n╔════ EXPORT / IMPORT ROUND-TRIP ════╗');
    expect(roundTrip.reimpTray, 'trayInput round-trip').toEqual(roundTrip.originalTray);
    expect(roundTrip.reimpElements, 'elements round-trip').toEqual(roundTrip.originalElements);
    expect(roundTrip.reimpEvidence, 'evidence round-trip').toEqual(roundTrip.originalEvidence);
    console.log('  OK — trayInput, elements y evidence conservados byte-equivalente');

    writeFileSync(resolve(OUT_DIR, 'user-report-ladder.console.log'), consoleLogs.join('\n'));
  });
});
