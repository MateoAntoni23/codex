/**
 * E2E — Preview geometry MUST swap when the user changes product in the
 * dropdown while continuing from a curve.
 *
 * Reproduces the exact bug reported by the user:
 *   "origen CRV-1.P2, familia perforada, 300x50; selector TRPS-300-22-Z;
 *    preview naranja con forma de curva en vez de recto."
 *
 * Qué testea (clicks reales de UI, no inyección de estado para el swap):
 *   1) Carga una bandeja con T1 (TRPS) + CRV-1 (CPS-90), conectadas T1.P2↔CRV-1.P1.
 *      CRV-1.P2 queda libre.
 *   2) Activa el routing. Selecciona CRV-1.P2 como startPort (setup, no es el bug).
 *   3) DOM real: cambia el <select> del inspector a SAM_CPS-300-90-Z → captura
 *      el preview (debería ser una curva).
 *   4) DOM real: cambia el <select> a SAM_TRPS-300-22-Z → captura el preview
 *      (debería volverse un recto). **Aquí reproduce el bug si el preview
 *      conserva la forma de curva anterior.**
 *
 *   Además: dump de placedP1/P2 y matrixWorld del parametric-preview antes y
 *   después del swap, con `expect` sobre la NO equivalencia visual.
 *
 * Requiere dev server activo en http://localhost:5173.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

type MeshDump = {
  kind: string;
  instanciaId?: string;
  sku: string;
  chirality?: string;
  turnDirection?: string;
  mirrored?: boolean;
  placedP1?: [number, number, number];
  placedP2?: [number, number, number];
  matrixWorld: number[];
  worldPosition: [number, number, number];
};

function fmt3(v?: [number, number, number]): string {
  if (!v) return '(—)';
  return `(${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)})`;
}

const FIXTURE_TRAY = {
  version_contrato: 'trazado/1',
  piezas: [
    {
      instancia_id: 'T1',
      producto_id: 'SAM_TRPS-300-22-Z',
      longitud_mm: 3000,
      puertos: {
        P1: { posicion_mm: [0, 0, 0], direccion: [-1, 0, 0] },
        P2: { posicion_mm: [3000, 0, 0], direccion: [1, 0, 0] },
      },
    },
    {
      instancia_id: 'CRV-1',
      producto_id: 'SAM_CPS-300-90-Z',
      longitud_eje_mm: 933.5164030325733,
      puertos: {
        P1: { posicion_mm: [3000, 0, 0], direccion: [-1, 0, 0] },
        P2: {
          posicion_mm: [3593.160605459253, -595.4272333217659, 0],
          direccion: [-0.004416170774331087, -0.9999902486703018, 0],
        },
      },
    },
  ],
  conexiones: [
    { conexion_id: 'CON-001', a: ['T1', 'P2'], b: ['CRV-1', 'P1'] },
  ],
  circuitos: [],
  soportes: [],
  pe: {
    seccion_requerida_mm2: 16,
    cable_id: 'TEST',
    origen_requisito: 'test',
    conductores: [],
  },
};

test.describe('Preview swap de producto — debe cambiar de curva a recto sin estancarse', () => {
  test.setTimeout(120_000);
  test('selector pasa de CPS-90 a TRPS; preview deja de ser curva', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const consoleLogs: string[] = [];
    page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));

    await page.goto('/?workspace=bandejas&diag=ports');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
      { timeout: 20_000 },
    );

    // Setup (estado inicial — aceptable para configurar; el bug no está aquí).
    // Preseleccionamos CPS-300-90-Z como si el usuario hubiera clickado el
    // puerto CRV-1.P2 (que preselecciona el producto de la pieza origen).
    // El SWAP real (CPS → TRPS) se hace vía DOM después, no inyectando estado.
    await page.evaluate((tray) => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { importEdit: (i: unknown) => void } };
          routingStore: {
            getState: () => {
              deactivate: () => void;
              activate: () => void;
              selectStartPort: (p: { pieceId: string; portName: string; pos: [number, number, number]; dir: [number, number, number] }) => void;
              setProduct: (id: string) => void;
            };
          };
        };
      };
      w.__codex.routingStore.getState().deactivate();
      w.__codex.trayStore.getState().importEdit(tray);
      w.__codex.routingStore.getState().activate();
      w.__codex.routingStore.getState().selectStartPort({
        pieceId: 'CRV-1',
        portName: 'P2',
        pos: [3593.160605459253, -595.4272333217659, 0],
        dir: [-0.004416170774331087, -0.9999902486703018, 0],
      });
      // Simula la preselección de port-click: setProduct con el id del
      // producto de la pieza origen (CRV-1 → CPS-300-90-Z).
      w.__codex.routingStore.getState().setProduct('SAM_CPS-300-90-Z');
    }, FIXTURE_TRAY);

    // Esperar a que StepConfiguringSegment monte su <select>. Usamos el
    // selector específico de panel de routing (data-codex-routing-product-select)
    // para evitar confundirlo con otros selects del inspector (cables, etc).
    const productSelect = page.locator('[data-codex-routing-product-select]');
    await productSelect.waitFor({ state: 'visible', timeout: 10_000 });

    // Capturar todas las opciones disponibles en el dropdown — crítico para
    // documentar Objetivo 2 (listado estrecho al continuar desde curva).
    const availableOptions = await productSelect.evaluate((sel: HTMLSelectElement) => {
      return Array.from(sel.options).map((o) => ({
        value: o.value,
        label: o.textContent?.trim() ?? '',
        group: (o.parentElement as HTMLOptGroupElement)?.label ?? '',
      }));
    });
    console.log('\nOpciones del dropdown (continuación desde CRV-1.P2):');
    for (const o of availableOptions) {
      console.log(`  [${o.group}] ${o.value} — ${o.label}`);
    }
    writeFileSync(
      resolve(OUT_DIR, 'swap.dropdown-options.json'),
      JSON.stringify(availableOptions, null, 2),
    );

    // ─── Paso 1: estado inicial (preselección CPS-90 vía store, equivalente
    // a un port-click). El preview DEBE mostrar una curva CPS porque
    // selectedProductId = 'SAM_CPS-300-90-Z'. Esto reproduce el estado
    // documentado en la captura del usuario (preview naranja con forma de
    // curva aún cuando el selector del panel no la ofrece — porque
    // RoutingObjects resuelve el producto en la lista GLOBAL, no en la
    // lista filtrada del panel).
    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes().some((m) => m.kind === 'parametric-preview');
    }, { timeout: 5_000 });
    const dumpCurve = await page.evaluate(() => {
      const w = window as unknown as { __codex: { dumpMeshes: () => MeshDump[] } };
      return w.__codex.dumpMeshes().filter((m) => m.kind === 'parametric-preview');
    });
    console.log('\nPREVIEW en estado inicial (preselección CPS-90):');
    for (const m of dumpCurve) {
      console.log(`  sku=${m.sku}  placedP1=${fmt3(m.placedP1)}  placedP2=${fmt3(m.placedP2)}`);
    }
    await page.locator('canvas').screenshot({
      path: resolve(OUT_DIR, 'swap-01-cps-preview.png'),
    });

    expect(dumpCurve.length, 'un solo preview visible').toBe(1);
    expect(dumpCurve[0].sku, 'preview sku CPS-90 (preselección)').toBe('CPS-300-90-Z');

    // ─── Paso 2: cambiar a TRPS via UI real (el SWAP sí es DOM-driven) ───
    console.log('\nEjecutando selectOption("SAM_TRPS-300-22-Z")...');
    await productSelect.selectOption('SAM_TRPS-300-22-Z', { timeout: 5_000 });
    console.log('selectOption OK.');

    // Pequeño tick para que React aplique el nuevo render.
    await page.waitForTimeout(500);

    // Dump inmediato — sin esperar a que el preview sea TRPS. Si el bug
    // ocurre, el dump mostrará CPS persistente (prueba la reproducción).
    const postSwap = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          routingStore: { getState: () => { selectedProductId: string } };
          dumpMeshes: () => MeshDump[];
        };
      };
      return {
        selectedProductId: w.__codex.routingStore.getState().selectedProductId,
        previews: w.__codex.dumpMeshes().filter((m) => m.kind === 'parametric-preview'),
      };
    });
    console.log(`\nESTADO TRAS SELECT:`);
    console.log(`  selectedProductId = ${postSwap.selectedProductId}`);
    console.log(`  previews (${postSwap.previews.length}):`);
    for (const m of postSwap.previews) {
      console.log(`    sku=${m.sku}  placedP1=${fmt3(m.placedP1)}  placedP2=${fmt3(m.placedP2)}`);
    }

    const dumpStraight = postSwap.previews;
    console.log('\nPREVIEW tras cambiar a TRPS:');
    for (const m of dumpStraight) {
      console.log(`  sku=${m.sku}  placedP1=${fmt3(m.placedP1)}  placedP2=${fmt3(m.placedP2)}`);
    }
    await page.locator('canvas').screenshot({
      path: resolve(OUT_DIR, 'swap-02-trps-preview.png'),
    });

    // Dump para reporte.
    writeFileSync(
      resolve(OUT_DIR, 'swap.dump.json'),
      JSON.stringify({ curve: dumpCurve, straight: dumpStraight }, null, 2),
    );
    writeFileSync(resolve(OUT_DIR, 'swap.console.log'), consoleLogs.join('\n'));

    // ─── Aserciones de regresión ─────────────────────────────────────────
    expect(dumpStraight.length, 'un solo preview visible tras swap').toBe(1);
    expect(dumpStraight[0].sku, 'preview sku tras swap a TRPS').toBe('TRPS-300-22-Z');

    // placedP1 debe mantenerse en CRV-1.P2 (3593, -595, 0).
    const p1 = dumpStraight[0].placedP1!;
    expect(Math.abs(p1[0] - 3593.16), 'preview TRPS.P1.x').toBeLessThan(0.5);
    expect(Math.abs(p1[1] - -595.43), 'preview TRPS.P1.y').toBeLessThan(0.5);

    // Un TRPS recto tiene su P2 colineal con la dirección de avance, que en
    // esta configuración (dir ≈ (-0.0044, -0.9999, 0)) es casi -Y. Esperamos
    // Δy ≈ -3000 mm (longitud TRPS catálogo) y Δx ≈ -13 mm (pequeña
    // componente X de la dirección de la boca heredada de la curva CRV-1.P2).
    // Lo decisivo: NO debe haber un desplazamiento tipo arco CPS, que deja
    // Δx ≈ +593 (boca de la curva a 90° respecto al avance).
    const p2 = dumpStraight[0].placedP2!;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    expect(Math.abs(dx), 'preview TRPS Δx tras swap (≈ 13 mm, no 593 de CPS)').toBeLessThan(50);
    expect(Math.abs(dy), 'preview TRPS Δy tras swap (≈ longitud 3000)').toBeGreaterThan(2000);
  });
});
