/**
 * E2E hito 3 — Comparación visual preview ↔ confirmado operativa, usando los
 * pipelines reales del workspace (sin inyección sintética más allá del seed).
 *
 * Qué defiende (5 invariantes sobre un patrón piloto, TRPS-300-22-Z):
 *
 *   I1. Cuerpo + bocas visibles en preview. La pieza previsualizada antes de
 *       confirmar produce una mesh `parametric-preview` en `dumpMeshes()` con
 *       matrixWorld+worldPosition válidos y placedP1/P2 reportados.
 *   I2. Misma posición y orientación preview ↔ confirmado. Confirmar la
 *       continuación produce una `parametric-confirmed` cuya placedP1/P2 y
 *       matrixWorld coinciden con los del preview dentro de tolerancia (1 µm
 *       posicional, 1e-3 en entradas de matriz). ESTA ES LA COMPARACIÓN
 *       OPERATIVA que da nombre al hito; la comparación por hashes/snapshots
 *       de configuración vive en la pestaña "Configuración actual / Patrón
 *       aprobado" del Configurador y NO reemplaza esta regresión.
 *   I3. Pieza presente tras confirmar. `TrayInput.piezas` tiene la pieza
 *       nueva con su producto_id y sus dos puertos conectados correctamente.
 *   I4. Conservación al guardar/recuperar. Exportar el workspace → resetear
 *       el store → re-importar restaura ambas piezas con la misma placedP1/P2
 *       (misma identidad en TrayInput + misma geometría renderizada).
 *   I5. Inserción independiente + continuación desde una boca libre. Desde la
 *       pieza confirmada en I2, iniciar una nueva sesión de routing en su P2
 *       libre y confirmar otra TRPS produce 3 piezas conectadas en cadena sin
 *       romper las dos anteriores (los placedP1/P2 de las previas no se mueven).
 *
 * Por qué todo en un mismo spec:
 *   Los invariantes existen dispersos en otros specs (trpsCpsAlignment cubre
 *   I2 con CPS-90; fullRoutingChain cubre I3/I5 sin verificar geometría;
 *   importToScene cubre I4 pero para equipos, no para TrayInput). Este spec
 *   los consolida sobre un patrón piloto único para que cualquier regresión
 *   que rompa cualquiera de los 5 se detecte en UN solo lugar.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

type Vec3 = [number, number, number];

interface MeshDump {
  readonly kind: 'parametric-confirmed' | 'parametric-preview' | string;
  readonly instanciaId?: string;
  readonly sku: string;
  readonly placedP1?: Vec3;
  readonly placedP2?: Vec3;
  readonly matrixWorld: number[];
  readonly worldPosition: Vec3;
}

interface TrayPiece {
  readonly instancia_id: string;
  readonly producto_id: string;
  readonly puertos: Record<string, { readonly posicion_mm: Vec3; readonly direccion: Vec3 }>;
}

interface TrayState {
  readonly piezas: TrayPiece[];
  readonly conexiones: Array<{ readonly conexion_id: string; readonly a: readonly [string, string]; readonly b: readonly [string, string] }>;
}

const PILOT_PRODUCT = 'SAM_TRPS-300-22-Z';
const PILOT_SKU = 'TRPS-300-22-Z';

function fmt(v?: Vec3): string {
  if (!v) return '(—)';
  return `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`;
}

function distMm(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function matMaxDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

async function dumpMeshes(page: Page): Promise<MeshDump[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
    return w.__codex.dumpMeshes();
  });
}

async function readTrayState(page: Page): Promise<TrayState> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => { entrada: unknown } } };
    };
    return w.__codex.trayStore.getState().entrada as TrayState;
  });
}

async function seedSingleTrayPiece(page: Page): Promise<void> {
  await page.evaluate((productoId) => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { importEdit: (i: unknown) => void } };
        routingStore: { getState: () => { deactivate: () => void } };
      };
    };
    w.__codex.routingStore.getState().deactivate();
    w.__codex.trayStore.getState().importEdit({
      version_contrato: 'trazado/1',
      piezas: [
        {
          instancia_id: 'SEED',
          producto_id: productoId,
          longitud_mm: 3000,
          puertos: {
            P1: { posicion_mm: [0, 0, 0], direccion: [-1, 0, 0] },
            P2: { posicion_mm: [3000, 0, 0], direccion: [1, 0, 0] },
          },
        },
      ],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: {
        seccion_requerida_mm2: 16,
        cable_id: 'E2E-PIPELINE',
        origen_requisito: 'previewConfirmedPipeline',
        conductores: [],
      },
    });
  }, PILOT_PRODUCT);
}

async function startRoutingAt(page: Page, pieceId: string, portName: string, pos: Vec3, dir: Vec3): Promise<void> {
  await page.evaluate((args) => {
    const w = window as unknown as {
      __codex: {
        routingStore: {
          getState: () => {
            deactivate: () => void;
            activate: () => void;
            selectStartPort: (p: { pieceId: string; portName: string; pos: Vec3; dir: Vec3 }) => void;
          };
        };
      };
    };
    const r = w.__codex.routingStore.getState();
    r.deactivate();
    r.activate();
    r.selectStartPort({ pieceId: args.pieceId, portName: args.portName, pos: args.pos, dir: args.dir });
  }, { pieceId, portName, pos, dir });

  await page.locator('[data-codex-routing-product-select]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function selectRoutingProduct(page: Page, productoId: string): Promise<void> {
  await page.waitForFunction((pid) => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === pid);
  }, productoId, { timeout: 15_000 });
  await page.locator('[data-codex-routing-product-select]').selectOption(productoId);
  await page.waitForTimeout(250);
}

async function waitForPreviewMesh(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
    return w.__codex.dumpMeshes().some((m) => m.kind === 'parametric-preview');
  }, { timeout: 10_000 });
}

async function confirmRouting(page: Page): Promise<void> {
  await page.locator('text=Confirmar continuación').click();
  await page.waitForTimeout(400);
}

async function waitForConfirmedCount(page: Page, n: number): Promise<void> {
  await page.waitForFunction((count) => {
    const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
    return w.__codex.dumpMeshes().filter((m) => m.kind === 'parametric-confirmed').length === count;
  }, n, { timeout: 15_000 });
}

test.describe('Preview ↔ Confirmado — pipeline operativo del workspace (hito 3)', () => {
  test.setTimeout(120_000);

  test('5 invariantes sobre TRPS piloto: visibilidad, geometría, confirmación, save/recover, continuación', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

    await page.goto('/?workspace=bandejas&diag=ports');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );

    // ─── Seed: inserción independiente (equivalente a AddTraySegmentForm) ──
    //
    // Una sola pieza en escena, sin routing activo. Es la forma más simple de
    // "inserción independiente": una pieza colocada por sí misma (no continúa
    // de nada). Ejerce la primera mitad de I5.
    await seedSingleTrayPiece(page);
    await waitForConfirmedCount(page, 1);

    const seedDump = (await dumpMeshes(page)).filter((m) => m.kind === 'parametric-confirmed');
    expect(seedDump.length, 'seed: una pieza confirmada').toBe(1);
    expect(seedDump[0].sku, 'seed sku correcto').toBe(PILOT_SKU);
    expect(seedDump[0].placedP1, 'seed con placedP1 visible').toBeDefined();
    expect(seedDump[0].placedP2, 'seed con placedP2 visible').toBeDefined();

    // ─── I1: Preview — cuerpo + bocas visibles ────────────────────────────
    //
    // Abrimos routing desde SEED.P2 y seleccionamos otro TRPS. Antes de
    // confirmar, el preview DEBE renderizar con matrixWorld no identidad y
    // placedP1/P2 concretos (si no, el usuario no ve lo que va a colocar).
    await startRoutingAt(page, 'SEED', 'P2', [3000, 0, 0], [1, 0, 0]);
    await selectRoutingProduct(page, PILOT_PRODUCT);
    await waitForPreviewMesh(page);

    const previewMeshes = (await dumpMeshes(page)).filter((m) => m.kind === 'parametric-preview');
    expect(previewMeshes.length, 'I1: un único preview mesh').toBe(1);
    const preview = previewMeshes[0];
    expect(preview.sku, 'I1: preview es TRPS piloto').toBe(PILOT_SKU);
    expect(preview.placedP1, 'I1: preview reporta placedP1').toBeDefined();
    expect(preview.placedP2, 'I1: preview reporta placedP2').toBeDefined();
    // La matriz world NO debe ser identidad — la pieza se posiciona fuera del origen.
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const idDiff = matMaxDiff(preview.matrixWorld, identity);
    expect(idDiff, 'I1: preview matrixWorld ≠ identidad').toBeGreaterThan(0.01);
    // El preview empalma en SEED.P2 = (3000, 0, 0) mm. Convertido a metros
    // (el worldPosition del mesh viene en coordenadas de escena), ese empalme
    // está en x ≥ 3 m. La verificación directa se hace con placedP1 en mm.
    const previewP1 = preview.placedP1!;
    expect(Math.abs(previewP1[0] - 3000), 'I1: preview.P1.x ≈ 3000 mm (SEED.P2)').toBeLessThan(0.5);
    expect(Math.abs(previewP1[1]), 'I1: preview.P1.y ≈ 0').toBeLessThan(0.5);

    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'pipeline-01-preview.png') });

    // Snapshot del preview para I2.
    const previewSnapshot = {
      matrixWorld: [...preview.matrixWorld],
      placedP1: [...previewP1] as Vec3,
      placedP2: [...preview.placedP2!] as Vec3,
    };

    // ─── I2: Confirmar — misma posición + orientación ─────────────────────
    //
    // Al confirmar, la pieza nueva debe aparecer con EXACTAMENTE la misma
    // geometría que el preview. Si se difieren, el usuario ve saltar la
    // pieza al confirmar, que es justo lo que este hito corrige.
    await confirmRouting(page);
    await waitForConfirmedCount(page, 2);

    const afterConfirmDump = await dumpMeshes(page);
    const confirmedList = afterConfirmDump.filter((m) => m.kind === 'parametric-confirmed');
    expect(confirmedList.length, 'I3: 2 piezas confirmadas tras confirmar').toBe(2);

    const newPiece = confirmedList.find((m) => m.instanciaId !== 'SEED');
    expect(newPiece, 'I3: pieza nueva identificable por instancia_id ≠ SEED').toBeDefined();
    expect(newPiece!.sku, 'I3: pieza nueva es TRPS piloto').toBe(PILOT_SKU);

    const confirmP1Diff = distMm(newPiece!.placedP1!, previewSnapshot.placedP1);
    const confirmP2Diff = distMm(newPiece!.placedP2!, previewSnapshot.placedP2);
    const confirmMatrixDiff = matMaxDiff(newPiece!.matrixWorld, previewSnapshot.matrixWorld);

    console.log('I2: preview ↔ confirmado ΔP1=%s mm · ΔP2=%s mm · ΔmatrixMax=%s',
      confirmP1Diff.toFixed(6), confirmP2Diff.toFixed(6), confirmMatrixDiff.toExponential(3));

    // Tolerancias: posicional < 1 µm (0.001 mm) — en la práctica suele ser < 1e-9.
    // Matrix entries < 1e-3 (los traslados están en metros, las rotaciones en radianes).
    expect(confirmP1Diff, 'I2: Δ placedP1 preview↔confirmado').toBeLessThan(1e-3);
    expect(confirmP2Diff, 'I2: Δ placedP2 preview↔confirmado').toBeLessThan(1e-3);
    expect(confirmMatrixDiff, 'I2: Δ max matrixWorld preview↔confirmado').toBeLessThan(1e-3);

    // ─── I3 (resto): trayInput tiene la pieza con sus conexiones ──────────
    const state = await readTrayState(page);
    expect(state.piezas.length, 'I3: tray tiene 2 piezas').toBe(2);
    expect(state.conexiones.length, 'I3: hay 1 conexión SEED.P2 ↔ pieza-nueva').toBe(1);
    const conn = state.conexiones[0];
    const [aId, aPort] = conn.a;
    const [bId, bPort] = conn.b;
    const connectsSeed = (aId === 'SEED' && aPort === 'P2') || (bId === 'SEED' && bPort === 'P2');
    expect(connectsSeed, 'I3: conexión incluye SEED.P2').toBe(true);

    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'pipeline-02-confirmed.png') });

    // Snapshot persistente para I4.
    const beforeExport = {
      piezas: state.piezas.map((p) => ({
        id: p.instancia_id,
        pid: p.producto_id,
        ports: Object.fromEntries(
          Object.entries(p.puertos).map(([n, pt]) => [n, pt.posicion_mm]),
        ),
      })),
      meshes: confirmedList.map((m) => ({
        id: m.instanciaId,
        sku: m.sku,
        p1: m.placedP1,
        p2: m.placedP2,
      })),
    };

    // ─── I4: Save / recover — exportar + reset + importar ──────────────────
    //
    // Simulamos un cierre/apertura: descargamos el JSON por el botón real y
    // lo re-importamos vía `loadFile` / `importEdit` (mismo camino que usa
    // el botón "Importar JSON"). El resultado DEBE ser bit-equivalente en
    // trayInput y la escena debe renderizar con los mismos placedP1/P2.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Exportar JSON/ }).click(),
    ]) as [Download, void];
    const exportPath = await download.path();
    if (!exportPath) throw new Error('Export did not produce a file');
    const exportBuf = readFileSync(exportPath, 'utf-8');
    const exportFile = resolve(OUT_DIR, 'pipeline-export.json');
    writeFileSync(exportFile, exportBuf);

    // Reset limpio: navegamos a un workspace vacío y re-importamos vía stores.
    await page.goto('/?workspace=bandejas');
    await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );

    await page.evaluate((jsonTxt) => {
      const w = window as unknown as {
        __codex: {
          workspaceStore: { getState: () => unknown };
          trayStore: { getState: () => { importEdit: (i: unknown) => void } };
          routingStore: { getState: () => { deactivate: () => void } };
          catalogConfigStore: { getState: () => { replaceAll: (o: Record<string, unknown>) => void } };
        };
      };
      const j = JSON.parse(jsonTxt) as {
        projectV2: {
          elements?: unknown[];
          evidence?: unknown[];
          schemaVersion?: number;
          [k: string]: unknown;
        };
        trayInput: unknown;
        catalogConfig?: { overrides?: Record<string, unknown> };
      };
      // Workspace elements/evidence/meta (pueden estar vacíos en este flujo).
      const ws = w.__codex.workspaceStore.getState() as {
        loadFile: (
          elements: unknown[],
          evidence: unknown[],
          meta: unknown,
          fileName: string,
          importedCatalog?: unknown | null,
        ) => void;
      };
      const { elements: _e, evidence: _ev, schemaVersion: _sv, ...meta } = j.projectV2 as Record<string, unknown>;
      ws.loadFile(
        (j.projectV2.elements ?? []) as unknown[],
        (j.projectV2.evidence ?? []) as unknown[],
        meta,
        'pipeline-reload.json',
        null,
      );
      w.__codex.routingStore.getState().deactivate();
      w.__codex.trayStore.getState().importEdit(j.trayInput);
      w.__codex.catalogConfigStore.getState().replaceAll((j.catalogConfig?.overrides ?? {}) as Record<string, unknown>);
    }, exportBuf);

    await waitForConfirmedCount(page, 2);

    const reloadedState = await readTrayState(page);
    expect(reloadedState.piezas.length, 'I4: reload conserva 2 piezas').toBe(2);
    for (const expected of beforeExport.piezas) {
      const found = reloadedState.piezas.find((p) => p.instancia_id === expected.id);
      expect(found, `I4: pieza ${expected.id} sobrevive reload`).toBeDefined();
      expect(found!.producto_id, `I4: producto_id ${expected.id}`).toBe(expected.pid);
      for (const [portName, pos] of Object.entries(expected.ports)) {
        const got = found!.puertos[portName]?.posicion_mm;
        expect(got, `I4: ${expected.id}.${portName} presente`).toBeDefined();
        const d = distMm(got as Vec3, pos as Vec3);
        expect(d, `I4: ${expected.id}.${portName} posición preservada`).toBeLessThan(1e-3);
      }
    }

    const reloadedMeshes = (await dumpMeshes(page)).filter((m) => m.kind === 'parametric-confirmed');
    expect(reloadedMeshes.length, 'I4: 2 meshes confirmadas tras reload').toBe(2);
    for (const expected of beforeExport.meshes) {
      const found = reloadedMeshes.find((m) => m.instanciaId === expected.id);
      expect(found, `I4: mesh ${expected.id} sobrevive reload`).toBeDefined();
      expect(distMm(found!.placedP1!, expected.p1!), `I4: mesh ${expected.id} placedP1 preservado`).toBeLessThan(1e-3);
      expect(distMm(found!.placedP2!, expected.p2!), `I4: mesh ${expected.id} placedP2 preservado`).toBeLessThan(1e-3);
    }

    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'pipeline-03-reloaded.png') });

    // ─── I5: continuación desde una boca libre de la pieza reloaded ──────
    //
    // Debemos localizar la pieza NO-SEED, hallar su boca libre (la que no
    // conecta a SEED) y arrancar un nuevo routing desde allí. Confirmar un
    // tercer TRPS valida el ciclo completo: insertar → confirmar → recuperar
    // → volver a continuar — con las previas intactas.
    const nonSeed = reloadedState.piezas.find((p) => p.instancia_id !== 'SEED')!;
    const connIds = new Set<string>();
    for (const c of reloadedState.conexiones) {
      if (c.a[0] === nonSeed.instancia_id) connIds.add(c.a[1]);
      if (c.b[0] === nonSeed.instancia_id) connIds.add(c.b[1]);
    }
    const freePorts = Object.keys(nonSeed.puertos).filter((n) => !connIds.has(n));
    expect(freePorts.length, 'I5: pieza intermedia tiene exactamente 1 boca libre').toBe(1);
    const freeName = freePorts[0];
    const freePort = nonSeed.puertos[freeName];

    await startRoutingAt(page, nonSeed.instancia_id, freeName, freePort.posicion_mm, freePort.direccion);
    await selectRoutingProduct(page, PILOT_PRODUCT);
    await waitForPreviewMesh(page);
    await confirmRouting(page);
    await waitForConfirmedCount(page, 3);

    const finalState = await readTrayState(page);
    expect(finalState.piezas.length, 'I5: 3 piezas en cadena').toBe(3);
    expect(finalState.conexiones.length, 'I5: 2 conexiones').toBe(2);

    const finalMeshes = (await dumpMeshes(page)).filter((m) => m.kind === 'parametric-confirmed');
    // Las dos primeras piezas no se movieron: validamos por id contra beforeExport.
    for (const expected of beforeExport.meshes) {
      const found = finalMeshes.find((m) => m.instanciaId === expected.id);
      expect(found, `I5: mesh ${expected.id} sigue en escena`).toBeDefined();
      expect(distMm(found!.placedP1!, expected.p1!), `I5: ${expected.id} no se movió (P1)`).toBeLessThan(1e-3);
      expect(distMm(found!.placedP2!, expected.p2!), `I5: ${expected.id} no se movió (P2)`).toBeLessThan(1e-3);
    }

    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'pipeline-04-chain.png') });

    writeFileSync(resolve(OUT_DIR, 'pipeline.console.log'), logs.join('\n'));
    writeFileSync(
      resolve(OUT_DIR, 'pipeline.summary.json'),
      JSON.stringify(
        {
          previewSnapshot: { placedP1: previewSnapshot.placedP1, placedP2: previewSnapshot.placedP2 },
          afterConfirm: {
            newPieceP1: newPiece!.placedP1,
            newPieceP2: newPiece!.placedP2,
            deltaP1Mm: confirmP1Diff,
            deltaP2Mm: confirmP2Diff,
            matrixMaxDiff: confirmMatrixDiff,
          },
          reloaded: beforeExport,
          finalPieces: finalState.piezas.map((p) => ({ id: p.instancia_id, pid: p.producto_id })),
          finalConexiones: finalState.conexiones.map((c) => ({ id: c.conexion_id, a: c.a, b: c.b })),
          meshes: finalMeshes.map((m) => ({
            id: m.instanciaId, sku: m.sku, p1: m.placedP1, p2: m.placedP2,
          })),
        },
        null,
        2,
      ),
    );

    console.log(
      '\n╔══ hito 3 — invariantes verificados sobre TRPS piloto ══╗\n' +
      `  I1 preview visible .............. placedP1=${fmt(previewSnapshot.placedP1)}\n` +
      `  I2 preview↔confirmado .......... ΔP1=${confirmP1Diff.toExponential(2)} mm · ΔP2=${confirmP2Diff.toExponential(2)} mm · matΔ=${confirmMatrixDiff.toExponential(2)}\n` +
      `  I3 tray tras confirmar ......... piezas=${state.piezas.length} conex=${state.conexiones.length}\n` +
      `  I4 save/recover ................ piezas tras reload=${reloadedState.piezas.length}\n` +
      `  I5 cadena tras continuación .... piezas=${finalState.piezas.length} conex=${finalState.conexiones.length}\n`,
    );
  });
});
