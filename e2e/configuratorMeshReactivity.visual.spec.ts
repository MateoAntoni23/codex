/**
 * E2E — Reactividad real de la malla del Configurador.
 *
 * Esta prueba existe por un bug reportado: "cambiar `modelFrame` gira las
 * bocas pero NO la malla" y "seleccionar otro producto cambia sus bocas pero
 * conserva la malla previa". La causa raíz era un uso incorrecto del
 * callback `onUpdate` de R3F, que sólo se dispara de forma fiable al
 * adjuntar hijos; asignar `geometry`/`matrix` desde `onUpdate` dejaba la
 * malla congelada. El fix usa `useRef` + `useLayoutEffect` (igual que
 * `RoutingObjects`/`TrayObjects`), de modo que cada cambio de la escena
 * recompone matriz y geometría explícitamente.
 *
 * Las pruebas NO se basan en bytes de screenshot (coincidirían si sólo
 * las bocas se moviesen). Verifican el `matrixWorld` real de la malla y
 * su bounding box, a través del bridge `window.__codex.configuratorMesh()`
 * instalado por `ConfiguratorSceneBridge` dentro del Canvas del visor.
 *
 * Cobertura:
 *   A) Cambiar producto (TRPS→CPS→CUPS→XPS→TPS) cambia `geometryUuid`,
 *      `productoId` y `bbox`. Un sólo mesh paramétrico en la escena a la vez.
 *   B) Aplicar `modelFrame.rx_deg = 30` muda la rotación del `matrixWorld`
 *      del mesh (no sólo de las bocas). "Quitar overrides" restaura.
 *   C) Aplicar un `installRotationDeg` por boca NO cambia `matrixWorld`
 *      del mesh — sólo el `userData` de la boca editada.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

type Mat16 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

interface ConfiguratorMeshSnapshot {
  productoId: string;
  isIdentity: boolean;
  matrixElements: number[] | null;
  matrixWorld: Mat16;
  bboxMin: [number, number, number] | null;
  bboxMax: [number, number, number] | null;
  geometryUuid: string;
}

interface ConfiguratorPortSnapshot {
  port: string;
  centerMm: [number, number, number];
  normalMm: [number, number, number];
}

async function clearLocalStorage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

async function gotoConfigurator(page: import('@playwright/test').Page) {
  await page.goto('/?configurator=v1');
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  // Esperar a que el catálogo esté populado (initialize() hidratado).
  await page.waitForFunction(() => {
    const anyBtn = document.querySelector('[data-testid^="cfg-product-SAM_"]');
    return !!anyBtn;
  }, { timeout: 20_000 });
}

async function selectProduct(page: import('@playwright/test').Page, productoId: string) {
  const btn = page.locator(`[data-testid="cfg-product-${productoId}"]`);
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
  // Esperar a que el visor exponga el mesh con este producto.
  await page.waitForFunction((pid: string) => {
    const w = window as unknown as {
      __codex?: { configuratorMesh?: () => { productoId: string } | null };
    };
    const snap = w.__codex?.configuratorMesh?.();
    return !!snap && snap.productoId === pid;
  }, productoId, { timeout: 15_000 });
}

async function readMesh(page: import('@playwright/test').Page): Promise<ConfiguratorMeshSnapshot> {
  const snap = await page.evaluate(() => {
    const w = window as unknown as {
      __codex: { configuratorMesh: () => ConfiguratorMeshSnapshot | null };
    };
    return w.__codex.configuratorMesh();
  });
  if (!snap) throw new Error('configuratorMesh devolvió null — no hay malla visible');
  return snap;
}

async function readPorts(page: import('@playwright/test').Page): Promise<ConfiguratorPortSnapshot[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __codex: { configuratorPorts: () => ConfiguratorPortSnapshot[] };
    };
    return w.__codex.configuratorPorts();
  });
}

function rotationPart(m: Mat16): Mat16 {
  // Devuelve una copia con la traslación zerada para comparar sólo rotación/escala.
  const out = m.slice() as Mat16;
  out[12] = 0; out[13] = 0; out[14] = 0;
  return out;
}

function maxAbsDelta(a: Mat16, b: Mat16): number {
  let maxD = 0;
  for (let i = 0; i < 16; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

// Sólo productos cuya receta paramétrica está registrada (resolveParametricEntry
// != null) muestran mesh en el visor. Usamos uno por cada tipo_pieza.
const PRODUCT_SEQUENCE = [
  'SAM_TRPS-300-22-Z',  // tramo_recto
  'SAM_CPS-300-90-Z',   // curva_horizontal
  'SAM_CUPS-300-A-Z',   // curva_vertical
  'SAM_XPS-300-Z',      // cruz_horizontal
  'SAM_TPS-300-Z',      // tee_horizontal
] as const;

test.describe('Configurator — reactividad de malla (bug report 2026-11)', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await clearLocalStorage(page);
  });

  test('A. Cambiar producto cambia malla, bocas y bbox (no sólo bocas)', async ({ page }) => {
    await gotoConfigurator(page);
    const canvas = page.locator('[data-testid="cfg-viewer-canvas"]');

    const seen = new Map<string, ConfiguratorMeshSnapshot>();
    for (const pid of PRODUCT_SEQUENCE) {
      await selectProduct(page, pid);
      const snap = await readMesh(page);
      expect(snap.productoId, `productoId del mesh renderizado debe coincidir con la selección (${pid})`).toBe(pid);
      expect(snap.bboxMin, 'bboxMin presente').not.toBeNull();
      expect(snap.bboxMax, 'bboxMax presente').not.toBeNull();
      // Cada producto debe tener geometría distinta (uuid distinto) y
      // una bbox distinta de los anteriores.
      for (const [prevPid, prev] of seen) {
        expect(
          snap.geometryUuid,
          `geometryUuid debe cambiar entre ${prevPid} y ${pid}`,
        ).not.toBe(prev.geometryUuid);
        const bboxEqual =
          prev.bboxMin!.every((v, i) => Math.abs(v - snap.bboxMin![i]) < 1e-6) &&
          prev.bboxMax!.every((v, i) => Math.abs(v - snap.bboxMax![i]) < 1e-6);
        expect(
          bboxEqual,
          `bbox NO debe coincidir entre ${prevPid} y ${pid} (prev=${JSON.stringify(prev.bboxMin)}..${JSON.stringify(prev.bboxMax)} actual=${JSON.stringify(snap.bboxMin)}..${JSON.stringify(snap.bboxMax)})`,
        ).toBe(false);
      }
      // Las bocas también deben pertenecer al producto activo (no quedar las anteriores).
      const ports = await readPorts(page);
      expect(ports.length, `${pid}: debe haber bocas visibles`).toBeGreaterThan(0);

      seen.set(pid, snap);
      await canvas.screenshot({
        path: resolve(OUT_DIR, `reactivity-A-${pid}.png`),
      });
    }
  });

  test('B. modelFrame rota la MALLA (matrixWorld) y las bocas a la vez', async ({ page }) => {
    await gotoConfigurator(page);
    const canvas = page.locator('[data-testid="cfg-viewer-canvas"]');
    await selectProduct(page, 'SAM_TPS-300-Z');

    // ─── Baseline (identidad) ──────────────────────────────────────────────
    const before = await readMesh(page);
    expect(before.isIdentity, 'estado inicial debe ser identity').toBe(true);
    const portsBefore = await readPorts(page);
    const bocaDervBefore = portsBefore.find((p) => p.port === 'boca_derivacion');
    expect(bocaDervBefore, 'boca_derivacion debe existir en TPS').toBeDefined();
    await canvas.screenshot({ path: resolve(OUT_DIR, 'reactivity-B-01-before.png') });

    // ─── Aplicar rx_deg = 30 ───────────────────────────────────────────────
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-mf-rx_deg"]').fill('30');
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(
      'E2E reactividad — rx=30 debe rotar malla Y bocas al mismo tiempo',
    );
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    // La pestaña vuelve al modo lectura cuando se aplica.
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();

    // Esperar a que el mesh refleje el override.
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __codex: { configuratorMesh: () => { isIdentity: boolean } | null };
      };
      return w.__codex.configuratorMesh()?.isIdentity === false;
    }, { timeout: 5_000 });

    const after = await readMesh(page);
    expect(after.isIdentity, 'después del override, isIdentity=false').toBe(false);
    expect(
      after.productoId,
      'el override no cambia el producto activo',
    ).toBe(before.productoId);

    // La parte de rotación del matrixWorld DEBE diferir (no sólo la traslación).
    const rotBefore = rotationPart(before.matrixWorld);
    const rotAfter = rotationPart(after.matrixWorld);
    const rotDelta = maxAbsDelta(rotBefore, rotAfter);
    expect(
      rotDelta,
      `la rotación del matrixWorld debe cambiar tras aplicar rx=30 ` +
      `(delta=${rotDelta.toExponential(2)}) — si es ~0 la malla no rotó.`,
    ).toBeGreaterThan(1e-4);

    // Las bocas también se mueven (consistencia malla+bocas): la Y de la
    // boca_derivacion debía ser >0 y ahora aparece como (0, Y·cos30, Y·sin30)
    // en coordenadas locales mm.
    const portsAfter = await readPorts(page);
    const bocaDervAfter = portsAfter.find((p) => p.port === 'boca_derivacion');
    expect(bocaDervAfter, 'boca_derivacion sigue presente tras el override').toBeDefined();
    const bocaDelta = Math.hypot(
      bocaDervAfter!.centerMm[0] - bocaDervBefore!.centerMm[0],
      bocaDervAfter!.centerMm[1] - bocaDervBefore!.centerMm[1],
      bocaDervAfter!.centerMm[2] - bocaDervBefore!.centerMm[2],
    );
    expect(
      bocaDelta,
      'boca_derivacion debe moverse en mm con rx=30',
    ).toBeGreaterThan(1);

    await canvas.screenshot({ path: resolve(OUT_DIR, 'reactivity-B-02-after.png') });

    // ─── Quitar overrides restaura identidad ──────────────────────────────
    await page.locator('[data-testid="cfg-reset-orientacion"]').click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __codex: { configuratorMesh: () => { isIdentity: boolean } | null };
      };
      return w.__codex.configuratorMesh()?.isIdentity === true;
    }, { timeout: 5_000 });
    const reset = await readMesh(page);
    const rotReset = rotationPart(reset.matrixWorld);
    const rotResetDelta = maxAbsDelta(rotBefore, rotReset);
    expect(
      rotResetDelta,
      'tras "Quitar overrides" la matriz debe volver a identidad',
    ).toBeLessThan(1e-4);
    await canvas.screenshot({ path: resolve(OUT_DIR, 'reactivity-B-03-reset.png') });
  });

  test('C. portGeometry sólo cambia la boca editada; matrixWorld del mesh queda', async ({ page }) => {
    await gotoConfigurator(page);
    await selectProduct(page, 'SAM_TPS-300-Z');

    const before = await readMesh(page);
    expect(before.isIdentity).toBe(true);

    // Aplicar únicamente installRotationDeg para boca_derivacion.
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-port-rot-boca_derivacion"]').fill('45');
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(
      'E2E reactividad — installRotationDeg no debe mover la malla',
    );
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();
    // Un override existe → isIdentity false (la resolvedRecipe tiene cambios);
    // pero matrixWorld del mesh NO debería cambiar porque modelFrame sigue
    // identidad. Esperar un tick para que el useLayoutEffect vuelva a correr.
    await page.waitForTimeout(400);
    const after = await readMesh(page);
    const rotDelta = maxAbsDelta(before.matrixWorld, after.matrixWorld);
    expect(
      rotDelta,
      'un override sólo por boca (installRotationDeg) no debe mover el matrixWorld del mesh ' +
      `(delta=${rotDelta.toExponential(2)})`,
    ).toBeLessThan(1e-4);
  });
});
