/**
 * E2E — Cadena vertical escalera: TRES horizontal → CUS → TRES vertical.
 *
 * Demuestra con clicks reales que la curva vertical articulada de escalera
 * reutiliza el patrón geométrico CUPS por equivalencia conceptual autorizada
 * por el usuario (2026-11-10), sin duplicar polígono ni calibración:
 *
 *   1) Partiendo de un TRES-300-065-18-Z horizontal en escena, insertar
 *      CUS-300-5-065-18-Z por su boca P1_horizontal. La CUS queda con
 *      P2_vertical libre.
 *   2) Desde P2_vertical arranca un TRES vertical cuyo P1 coincide (±1 mm)
 *      con la posición de P2_vertical y cuyo P2 está ±1500 mm en Z.
 *   3) Preview → confirmado → export JSON + re-import conserva las 3 piezas
 *      y las 2 conexiones.
 *
 * El master `master:escalera:curva_vertical` resuelve 40 SKUs CUS (anchos
 * {150,300,450,600} × alas {65,90,115,150} × espesores × acabados) sobre
 * una única definición geométrica compartida (buildCUPSRecipe). No existe un
 * SKU "CDS" descendente en SAMET — la orientación descendente se resuelve
 * por colocación en escena (boca fuente), no por declarar otro master.
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
      producto_id: 'SAM_TRES-300-065-18-Z',
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
    cable_id: 'ESCALERA-VERT-TEST',
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

async function insertCus(page: Page): Promise<void> {
  const productSelect = page.locator('[data-codex-routing-product-select]');
  // El SKU debe aparecer en el selector gracias a la entrada sintética que
  // deriva del master `master:escalera:curva_vertical` (comparte receta
  // escalera:curva_vertical → buildCUPSRecipe). Si falla acá significa que el
  // dispatcher o la resolución a maestro se rompió.
  await page.waitForFunction(() => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_CUS-300-5-065-18-Z');
  }, { timeout: 15_000 });
  await productSelect.selectOption('SAM_CUS-300-5-065-18-Z');
  // CUS articulada: hay que elegir el sentido (sin elección no hay previa ni confirmación).
  // Esta cadena se escribió con la curva bajando (orientación de referencia del perfil).
  await page.locator('[data-codex-routing-vertical="baja"]').click();
  await page.waitForTimeout(300);
  // Receta vertical: entrada por P1_horizontal, salida por P2_vertical.
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) {
    await motive.fill('CUS escalera inserta por patrón compartido CUPS (E2E cadena vertical escalera)');
  }
  await page.locator('text=Confirmar continuación').click();
  await page.waitForTimeout(400);
}

async function selectVerticalExitAndContinueStraight(page: Page, lengthMm: number): Promise<void> {
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
    const cus = entrada.piezas.find((p) => p.producto_id === 'SAM_CUS-300-5-065-18-Z');
    if (!cus) return null;
    const pv = cus.puertos['P2_vertical'];
    const ph = cus.puertos['P1_horizontal'];
    if (!pv || !ph) return null;
    const dx = pv.posicion_mm[0] - ph.posicion_mm[0];
    const dy = pv.posicion_mm[1] - ph.posicion_mm[1];
    const len = Math.hypot(dx, dy);
    const sectionUp: [number, number, number] = len > 1e-6 ? [dx / len, dy / len, 0] : [1, 0, 0];
    const rs = w.__codex.routingStore.getState();
    rs.deactivate();
    rs.activate();
    rs.selectStartPort({
      pieceId: cus.instancia_id,
      portName: 'P2_vertical',
      pos: pv.posicion_mm,
      dir: pv.direccion,
      sectionUp,
    });
    const now = w.__codex.routingStore.getState().startPort;
    return { pieceId: cus.instancia_id, startPort: now, pv };
  });
  expect(started, 'P2_vertical de la CUS localizada y routing arrancado').toBeTruthy();
  expect(started!.startPort?.portName).toBe('P2_vertical');

  const productSelect = page.locator('[data-codex-routing-product-select]');
  await productSelect.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_TRES-300-065-18-Z');
  }, { timeout: 15_000 });
  await productSelect.selectOption('SAM_TRES-300-065-18-Z');
  await page.waitForTimeout(200);

  const lenInput = page.locator('[data-codex-routing-length-input]');
  if (await lenInput.count()) {
    await lenInput.fill(String(lengthMm));
  }

  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) {
    await motive.fill('Tramo vertical escalera autorizado (E2E cadena vertical escalera)');
  }

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

test.describe('Cadena vertical escalera: TRES → CUS → TRES vertical (patrón CUPS compartido)', () => {
  test.setTimeout(90_000);

  test('insertar CUS escalera, continuar por P2_vertical, verificar unión y roundtrip', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrap(page);
    await insertCus(page);

    // Snapshot intermedio: TRES + CUS enlazadas.
    const afterCus = await readTray(page);
    expect(afterCus.pieces).toHaveLength(2);
    expect(afterCus.conexiones).toHaveLength(1);
    const cus = afterCus.pieces.find((p) => p.producto_id === 'SAM_CUS-300-5-065-18-Z');
    expect(cus, 'CUS escalera presente tras colocación').toBeTruthy();
    const pvBefore = cus!.puertos['P2_vertical'];
    expect(pvBefore, 'CUS expone P2_vertical (nombre heredado de la receta CUPS)').toBeTruthy();
    // La boca vertical sale con un componente Z ≠ 0 (ascendente o descendente
    // según la orientación de colocación).
    expect(Math.abs(pvBefore.direccion[2])).toBeGreaterThan(0.5);

    // Insertar recto vertical de 1500 mm por P2_vertical.
    await selectVerticalExitAndContinueStraight(page, 1500);

    const codexAlive = await page.evaluate(() => {
      const w = window as unknown as { __codex?: unknown };
      return Boolean(w.__codex);
    });
    if (!codexAlive) {
      throw new Error(
        `__codex se perdió tras confirmar la continuación vertical escalera. ` +
          `pageerrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`,
      );
    }
    const afterVertical = await readTray(page);
    expect(afterVertical.pieces).toHaveLength(3);
    expect(afterVertical.conexiones).toHaveLength(2);

    // El nuevo recto vertical no es T1 ni la CUS.
    const nuevoRecto = afterVertical.pieces.find(
      (p) => p.id !== 'T1' && p.producto_id === 'SAM_TRES-300-065-18-Z',
    );
    expect(nuevoRecto, 'nuevo tramo recto escalera vertical presente').toBeTruthy();

    const ports = Object.entries(nuevoRecto!.puertos);
    const matches = ports.filter(([, p]) =>
      Math.hypot(
        p.posicion_mm[0] - pvBefore.posicion_mm[0],
        p.posicion_mm[1] - pvBefore.posicion_mm[1],
        p.posicion_mm[2] - pvBefore.posicion_mm[2],
      ) < 1,
    );
    expect(
      matches.length,
      'uno de los puertos del nuevo recto está sobre P2_vertical de la CUS',
    ).toBe(1);
    const [, entryPort] = matches[0];
    const [, otherPort] = ports.find(([n]) => n !== matches[0][0])!;

    const dx = otherPort.posicion_mm[0] - entryPort.posicion_mm[0];
    const dy = otherPort.posicion_mm[1] - entryPort.posicion_mm[1];
    const dz = otherPort.posicion_mm[2] - entryPort.posicion_mm[2];
    expect(Math.hypot(dx, dy)).toBeLessThan(5);
    expect(Math.abs(Math.abs(dz) - 1500)).toBeLessThan(5);
    // El avance respeta la dirección Z de la salida CUS (ascendente o
    // descendente según venga configurada en escena).
    expect(Math.sign(dz) === Math.sign(pvBefore.direccion[2])).toBe(true);

    // ── Round-trip export + import ───────────────────────────────────────────
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar JSON/ }).click();
    const download: Download = await downloadPromise;
    const exportPath = resolve(OUT_DIR, `escalera-vertical-chain-${Date.now()}.json`);
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
    // Tras re-importar, la CUS escalera sigue siendo la misma instancia con
    // sus puertos nombrados P1_horizontal / P2_vertical (nombres de la receta
    // CUPS compartida).
    const cusAfter = afterReimport.pieces.find(
      (p) => p.producto_id === 'SAM_CUS-300-5-065-18-Z',
    );
    expect(cusAfter, 'CUS escalera sobrevive export/import').toBeTruthy();
    expect(cusAfter!.puertos['P1_horizontal']).toBeTruthy();
    expect(cusAfter!.puertos['P2_vertical']).toBeTruthy();
  });

  test('cancelar la continuación vertical NO modifica la cadena ya confirmada', async ({ page }) => {
    await bootstrap(page);
    await insertCus(page);
    const before = await readTray(page);
    expect(before.pieces).toHaveLength(2);

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
      const cus = entrada.piezas.find((p) => p.producto_id === 'SAM_CUS-300-5-065-18-Z')!;
      const pv = cus.puertos['P2_vertical'];
      const rs = w.__codex.routingStore.getState();
      rs.deactivate();
      rs.activate();
      rs.selectStartPort({
        pieceId: cus.instancia_id,
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
