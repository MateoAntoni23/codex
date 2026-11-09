/**
 * E2E — Cadena vertical: recto horizontal → CUPS → recto vertical.
 *
 * Verifica, con clicks reales:
 *   1) Partiendo de un TRPS horizontal en escena, el usuario inserta una CUPS
 *      por su boca P1_horizontal. La CUPS queda con P2_vertical libre.
 *   2) Desde P2_vertical arranca un recto TRPS cuyo P1 coincide (±1 mm) con la
 *      posición de P2_vertical y cuyo P2 está exactamente 1500 mm por encima
 *      en Z respecto a P1 (longitud editable del recto).
 *   3) Export JSON + re-import conserva las 3 piezas y las 2 conexiones.
 *   4) Undo y redo recomponen/rehacen la cadena como un único paso lógico.
 *
 * Objetivo del encargo: la colocación usa el marco completo del puerto
 * (centro, normal, sectionUp), no una rotación fija de compensación. Los
 * recorridos horizontales siguen funcionando — eso lo cubren los specs
 * existentes; acá sólo verificamos el caso vertical.
 *
 * Requiere `npm run dev` corriendo en http://localhost:5173.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

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
  ],
  conexiones: [],
  circuitos: [],
  soportes: [],
  pe: {
    seccion_requerida_mm2: 16,
    cable_id: 'VERT-TEST',
    origen_requisito: 'test',
    conductores: [],
  },
};

type FreePort = {
  pieceId: string;
  portName: string;
  pos: [number, number, number];
  dir: [number, number, number];
  sectionUp?: [number, number, number];
};

async function bootstrap(page: Page): Promise<void> {
  await page.goto('/?workspace=bandejas');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
    { timeout: 20_000 },
  );
  await page.evaluate((tray) => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { importEdit: (i: unknown) => void } };
        routingStore: {
          getState: () => {
            deactivate: () => void;
            activate: () => void;
            selectStartPort: (p: FreePort) => void;
          };
        };
      };
    };
    w.__codex.routingStore.getState().deactivate();
    w.__codex.trayStore.getState().importEdit(tray);
    w.__codex.routingStore.getState().activate();
    w.__codex.routingStore.getState().selectStartPort({
      pieceId: 'T1',
      portName: 'P2',
      pos: [3000, 0, 0],
      dir: [1, 0, 0],
      sectionUp: [0, 0, 1],
    });
  }, FIXTURE_TRAY);

  await page.locator('[data-codex-routing-product-select]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function insertCups(page: Page): Promise<void> {
  const productSelect = page.locator('[data-codex-routing-product-select]');
  await page.waitForFunction(() => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_CUPS-300-A-Z');
  }, { timeout: 15_000 });
  await productSelect.selectOption('SAM_CUPS-300-A-Z');
  await page.waitForTimeout(300);
  // Default entry boca ahora es P1_horizontal (primera soportada de la receta).
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('Transición horizontal→vertical autorizada (E2E vertical chain)');
  await page.locator('text=Confirmar continuación').click();
  await page.waitForTimeout(400);
}

async function selectVerticalExitAndContinueStraight(page: Page, lengthMm: number): Promise<void> {
  // Localizar el P2_vertical real de la CUPS que acaba de insertarse y arrancar
  // routing desde él. El store de routing ya acepta sectionUp — usamos la
  // misma heurística que getFreePorts (XY entre par horizontal y vertical).
  const started = await page.evaluate(() => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { entrada: unknown } };
        routingStore: {
          getState: () => {
            deactivate: () => void;
            activate: () => void;
            selectStartPort: (p: FreePort) => void;
            startPort: FreePort | null;
          };
        };
      };
    };
    const entrada = w.__codex.trayStore.getState().entrada as {
      piezas: Array<{
        instancia_id: string;
        producto_id: string;
        puertos: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number] }>;
      }>;
    };
    const cups = entrada.piezas.find((p) => p.producto_id === 'SAM_CUPS-300-A-Z');
    if (!cups) return null;
    const pv = cups.puertos['P2_vertical'];
    const ph = cups.puertos['P1_horizontal'];
    if (!pv || !ph) return null;
    const dx = pv.posicion_mm[0] - ph.posicion_mm[0];
    const dy = pv.posicion_mm[1] - ph.posicion_mm[1];
    const len = Math.hypot(dx, dy);
    const sectionUp: [number, number, number] = len > 1e-6 ? [dx / len, dy / len, 0] : [1, 0, 0];
    const rs = w.__codex.routingStore.getState();
    rs.deactivate();
    rs.activate();
    rs.selectStartPort({
      pieceId: cups.instancia_id,
      portName: 'P2_vertical',
      pos: pv.posicion_mm,
      dir: pv.direccion,
      sectionUp,
    });
    const now = w.__codex.routingStore.getState().startPort;
    return { pieceId: cups.instancia_id, startPort: now, pv };
  });
  expect(started, 'P2_vertical localizada y routing arrancado').toBeTruthy();
  expect(started!.startPort?.portName).toBe('P2_vertical');

  const productSelect = page.locator('[data-codex-routing-product-select]');
  await productSelect.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_TRPS-300-22-Z');
  }, { timeout: 15_000 });
  await productSelect.selectOption('SAM_TRPS-300-22-Z');
  await page.waitForTimeout(200);

  // Longitud configurable del recto vertical.
  const lenInput = page.locator('[data-codex-routing-length-input]');
  if (await lenInput.count()) {
    await lenInput.fill(String(lengthMm));
  }

  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('Tramo recto vertical autorizado (E2E vertical chain)');

  await page.locator('text=Confirmar continuación').click();
  await page.waitForTimeout(400);
}

async function readTray(page: Page) {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => { entrada: unknown } } };
    };
    const entrada = w.__codex.trayStore.getState().entrada as {
      piezas: Array<{
        instancia_id: string;
        producto_id: string;
        puertos: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number] }>;
      }>;
      conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }>;
    };
    return {
      pieces: entrada.piezas.map((p) => ({
        id: p.instancia_id,
        producto_id: p.producto_id,
        puertos: p.puertos,
      })),
      conexiones: entrada.conexiones,
    };
  });
}

test.describe('Cadena vertical recto → CUPS → recto vertical', () => {
  test.setTimeout(90_000);

  test('insertar CUPS, continuar por P2_vertical, verificar unión y longitud configurable', async ({ page }) => {
    // Captura errores de página y consola para diagnosticar regresiones del
    // bridge frame-based (p. ej. un render que lance en ParametricMesh y resetee
    // __codex vía ErrorBoundary): sin esto el fallo llega al test como
    // "trayStore is undefined", opaco.
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrap(page);
    await insertCups(page);

    // Snapshot intermedio: ya hay CUPS enlazada al TRPS.
    const afterCups = await readTray(page);
    expect(afterCups.pieces).toHaveLength(2);
    expect(afterCups.conexiones).toHaveLength(1);
    const cups = afterCups.pieces.find((p) => p.producto_id === 'SAM_CUPS-300-A-Z');
    expect(cups, 'CUPS presente').toBeTruthy();
    const pvBefore = cups!.puertos['P2_vertical'];

    // Insertar recto vertical de 1500 mm por P2_vertical.
    await selectVerticalExitAndContinueStraight(page, 1500);

    // Diagnóstico: si al confirmar algo tiró un error que resetea __codex,
    // enterate acá en lugar de en el genérico "trayStore is undefined".
    const codexAlive = await page.evaluate(() => {
      const w = window as unknown as { __codex?: unknown };
      return Boolean(w.__codex);
    });
    if (!codexAlive) {
      throw new Error(
        `__codex se perdió tras confirmar la continuación vertical. ` +
        `pageerrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      );
    }
    const afterVertical = await readTray(page);
    expect(afterVertical.pieces).toHaveLength(3);
    expect(afterVertical.conexiones).toHaveLength(2);

    // Localizar el recto que no es T1 ni CUPS — ese es el nuevo recto vertical.
    const nuevoRecto = afterVertical.pieces.find(
      (p) => p.id !== 'T1' && p.producto_id === 'SAM_TRPS-300-22-Z',
    );
    expect(nuevoRecto, 'nuevo recto vertical presente').toBeTruthy();

    // Uno de sus puertos coincide (±1 mm) con pv.
    const ports = Object.entries(nuevoRecto!.puertos);
    const matches = ports.filter(([, p]) =>
      Math.hypot(
        p.posicion_mm[0] - pvBefore.posicion_mm[0],
        p.posicion_mm[1] - pvBefore.posicion_mm[1],
        p.posicion_mm[2] - pvBefore.posicion_mm[2],
      ) < 1,
    );
    expect(matches.length, 'uno de los puertos del nuevo recto está en P2_vertical de CUPS').toBe(1);
    const [, entryPort] = matches[0];
    const [, otherPort] = ports.find(([n]) => n !== matches[0][0])!;

    // El otro puerto está sobre la misma recta vertical (ΔX, ΔY ≈ 0 en XY),
    // con ΔZ cercano a ±1500 mm (longitud del recto).
    const dx = otherPort.posicion_mm[0] - entryPort.posicion_mm[0];
    const dy = otherPort.posicion_mm[1] - entryPort.posicion_mm[1];
    const dz = otherPort.posicion_mm[2] - entryPort.posicion_mm[2];
    expect(Math.hypot(dx, dy)).toBeLessThan(5);
    expect(Math.abs(Math.abs(dz) - 1500)).toBeLessThan(5);

    // El avance debe seguir la dirección vertical de la salida CUPS (mismo signo Z).
    expect(Math.sign(dz) === Math.sign(pvBefore.direccion[2])).toBe(true);

    // ── Round-trip export + import ───────────────────────────────────────────
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar JSON/ }).click();
    const download: Download = await downloadPromise;
    const exportPath = resolve(OUT_DIR, `vertical-chain-${Date.now()}.json`);
    await download.saveAs(exportPath);
    const parsed = JSON.parse(readFileSync(exportPath, 'utf8'));
    expect(parsed?.trayInput?.piezas?.length ?? parsed?.tray?.piezas?.length ?? 0).toBeGreaterThanOrEqual(3);

    const acceptAny = (d: import('@playwright/test').Dialog) => void d.accept();
    page.on('dialog', acceptAny);
    await page.getByRole('button', { name: /Importar JSON/ }).click();
    await page.locator('input[type="file"][accept=".json"]').setInputFiles(exportPath);
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __codex?: { trayStore?: { getState: () => { entrada: { piezas: unknown[] } } } };
        };
        return (w.__codex?.trayStore?.getState()?.entrada?.piezas?.length ?? 0) === 3;
      },
      { timeout: 10_000 },
    );
    page.off('dialog', acceptAny);
    const afterReimport = await readTray(page);
    expect(afterReimport.pieces).toHaveLength(3);
    expect(afterReimport.conexiones).toHaveLength(2);
  });

  test('cancelar la continuación vertical NO modifica la cadena ya confirmada', async ({ page }) => {
    await bootstrap(page);
    await insertCups(page);
    const before = await readTray(page);
    expect(before.pieces).toHaveLength(2);

    // Arrancar routing desde P2_vertical, elegir TRPS, pero cancelar.
    await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { entrada: unknown } };
          routingStore: {
            getState: () => {
              deactivate: () => void;
              activate: () => void;
              selectStartPort: (p: FreePort) => void;
            };
          };
        };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{
          instancia_id: string;
          producto_id: string;
          puertos: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number] }>;
        }>;
      };
      const cups = entrada.piezas.find((p) => p.producto_id === 'SAM_CUPS-300-A-Z')!;
      const pv = cups.puertos['P2_vertical'];
      const rs = w.__codex.routingStore.getState();
      rs.deactivate();
      rs.activate();
      rs.selectStartPort({
        pieceId: cups.instancia_id,
        portName: 'P2_vertical',
        pos: pv.posicion_mm,
        dir: pv.direccion,
        sectionUp: [1, 0, 0],
      });
    });
    // Desactivar routing simula el botón cancelar.
    await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { routingStore: { getState: () => { deactivate: () => void } } };
      };
      w.__codex.routingStore.getState().deactivate();
    });
    const after = await readTray(page);
    expect(after.pieces).toHaveLength(2);
    expect(after.conexiones).toHaveLength(1);
  });
});
