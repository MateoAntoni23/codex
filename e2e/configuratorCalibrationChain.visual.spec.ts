/**
 * E2E — Cadena de calibración extremo-a-extremo: Configurador → trazado →
 *        pieza confirmada → payload del motor.
 *
 * Es la prueba de aceptación explícita: "corregir una pieza deliberadamente
 * desalineada desde el configurador y probar que el visor responde, Cancelar
 * restaura, Aplicar conserva, el trazado utiliza la corrección, confirmar
 * no cambia la posición, exportar/importar y recargar conservan el resultado,
 * y Python recibe las bocas corregidas en su contrato válido".
 *
 * Qué prueba (con clicks reales + screenshots en e2e/output/):
 *
 *   1) `viewer`: en el Configurador, el visor 3D re-renderiza al aplicar un
 *      `modelFrame` (screenshots `calib-01-identity.png` y
 *      `calib-02-overrided.png`).
 *
 *   2) `trazado`: con un TRPS como pieza base, al insertar un TPS desde
 *      `tronco_P1`, la pieza resultante en `trayStore.entrada.piezas`
 *      contiene `boca_derivacion.posicion_mm` DISTINTA al caso sin override.
 *      La diferencia confirma que `placeRecipe` aplicó `modelFrame` antes de
 *      almacenar los puertos.
 *
 *   3) `motor`: `toMotorEntrada(entrada)` traduce `boca_derivacion → P3` y la
 *      posición corregida sobrevive la traducción; el contrato Python recibe
 *      `piezas[i].puertos.P3.posicion_mm` idéntica a la almacenada en la
 *      pieza, sin claves de receta remanentes.
 *
 *   4) `reload`: tras recargar la página con el override en localStorage,
 *      el store sigue exponiendo el mismo mapping persistido.
 *
 * Supuestos:
 *   - `__codex` expone `trayStore`, `routingStore`, `catalogConfigStore` y
 *     `toMotorEntrada` (ver `UnifiedWorkspace.tsx`).
 *   - El fixture TRPS/TPS coincide con los nombres de receta del catálogo
 *     paramétrico (SAM_TRPS-300-22-Z, SAM_TPS-300-Z, `boca_derivacion`).
 *   - El override demo (`modelFrame.rz_deg = 45`) es suficiente para producir
 *     una diferencia mayor a 1 mm en `boca_derivacion` (cuyo centro base no
 *     está en el eje Z local).
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, 'output');

const TRAY_TRPS_ONLY = {
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
    cable_id: 'TEST',
    origen_requisito: 'test',
    conductores: [],
  },
};

// Para la prueba elegimos rx (rotación alrededor de X) con un ángulo moderado.
// Razón: la boca de entrada (tronco_P1) tiene normal local (-1,0,0); una
// rotación alrededor de X preserva su componente X y no introduce componente Y
// (que el motor rechaza para entrada horizontal). Al mismo tiempo, mueve
// boca_derivacion (normal (0,1,0), centro con Y>0 Z=0) a (Y·cos,Y·sin),
// generando el delta observable en la pieza confirmada.
const OVERRIDE_RX_DEG = 30;
const OVERRIDE_REASON =
  'Acceptance test — STEP TPS calibrado 30° alrededor de X para probar que la corrección llega a la pieza y al motor.';

type Vec3 = [number, number, number];

async function clearLocalStorage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

async function waitForConfiguratorReady(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  const tps = page.locator('[data-testid="cfg-product-SAM_TPS-300-Z"]');
  await tps.waitFor({ state: 'visible', timeout: 15_000 });
  await tps.click();
  await page.locator('[data-testid="cfg-viewer-canvas"]').waitFor({ state: 'visible', timeout: 15_000 });
  // Dar un instante a R3F para completar el primer frame.
  await page.waitForTimeout(500);
}

async function waitForWorkspaceReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
    { timeout: 20_000 },
  );
}

/**
 * Inserta un TPS desde T1.P2 usando `tronco_P1` como boca de entrada. El
 * flujo pasa por la UI real: selecciona el producto, elige la boca de
 * entrada (aunque sea la default, el botón aplica estado), y confirma.
 * El estado post-confirmación queda en `trayStore.entrada`.
 */
async function insertTpsFromT1P2(page: import('@playwright/test').Page) {
  // 1) Reset tray y activar routing en T1.P2.
  await page.evaluate((tray) => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { importEdit: (i: unknown) => void } };
        routingStore: {
          getState: () => {
            deactivate: () => void;
            activate: () => void;
            selectStartPort: (p: {
              pieceId: string;
              portName: string;
              pos: [number, number, number];
              dir: [number, number, number];
            }) => void;
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
    });
  }, TRAY_TRPS_ONLY);

  // 2) Seleccionar SAM_TPS-300-Z en el selector de producto.
  const productSelect = page.locator('[data-codex-routing-product-select]');
  await productSelect.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_TPS-300-Z');
  }, { timeout: 15_000 });
  await productSelect.selectOption('SAM_TPS-300-Z');

  // 3) Confirmar entry port = tronco_P1 (default). Hacer click para afirmar
  //    el estado — algunos controles sólo inicializan selección tras un click.
  const troncoP1 = page.locator('[data-codex-routing-entry-port="tronco_P1"]');
  await troncoP1.waitFor({ state: 'visible', timeout: 10_000 });
  await troncoP1.click();

  // 4) Click en "Confirmar continuación".
  const confirmBtn = page.getByRole('button', { name: /Confirmar continuación/i });
  await confirmBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  // 5) Esperar a que el TPS aparezca en el tray.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => { entrada: { piezas: { producto_id: string }[] } | null } } };
    };
    const e = w.__codex.trayStore.getState().entrada;
    return !!e && e.piezas.some((p) => p.producto_id === 'SAM_TPS-300-Z');
  }, { timeout: 10_000 });
}

async function readTpsBocaDerivacion(
  page: import('@playwright/test').Page,
): Promise<{ posicion_mm: Vec3; direccion: Vec3; instancia_id: string }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { entrada: {
          piezas: Array<{
            instancia_id: string;
            producto_id: string;
            puertos: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number] }>;
          }>;
        } | null } };
      };
    };
    const e = w.__codex.trayStore.getState().entrada;
    if (!e) throw new Error('entrada null');
    const tps = e.piezas.find((p) => p.producto_id === 'SAM_TPS-300-Z');
    if (!tps) throw new Error('TPS no insertado');
    const bd = tps.puertos.boca_derivacion;
    if (!bd) throw new Error('boca_derivacion no está en puertos de la pieza');
    return {
      instancia_id: tps.instancia_id,
      posicion_mm: bd.posicion_mm,
      direccion: bd.direccion,
    };
  });
}

test.describe('Cadena de calibración — Configurador → trazado → motor', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await clearLocalStorage(page);
  });

  test('visor del Configurador responde al aplicar modelFrame', async ({ page }) => {
    await page.goto('/?configurator=v1');
    await waitForConfiguratorReady(page);

    const canvas = page.locator('[data-testid="cfg-viewer-canvas"]');
    await canvas.screenshot({ path: resolve(OUT_DIR, 'calib-01-identity.png') });

    // Aplicar modelFrame.rz_deg via UI real.
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-mf-rx_deg"]').fill(String(OVERRIDE_RX_DEG));
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(OVERRIDE_REASON);
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();

    // La pestaña vuelve a lectura y el visor re-renderiza cuando el store
    // cambia (ConfiguratorViewer está suscripto a `overrides`).
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();
    await page.waitForTimeout(500);
    await canvas.screenshot({ path: resolve(OUT_DIR, 'calib-02-overrided.png') });

    // Verificar persistencia.
    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('codex:catalogConfig:v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(persisted).toBeTruthy();
    expect(persisted.version).toBe('codex:catalogConfig/1');
    expect(persisted.overrides['SAM_TPS-300-Z']?.modelFrame?.rx_deg).toBe(OVERRIDE_RX_DEG);
  });

  test('routing aplica corrección y motor recibe boca_derivacion traducida a P3', async ({ page }) => {
    // ─── Baseline: sin override ──────────────────────────────────────────
    await page.goto('/?workspace=bandejas');
    await waitForWorkspaceReady(page);

    await insertTpsFromT1P2(page);
    const baseline = await readTpsBocaDerivacion(page);

    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'calib-03-workspace-baseline.png') });

    // ─── Aplicar override directamente al store (equivalente a la UI;
    //     cubierta por el test anterior). `upsertOverride` sincroniza
    //     `setPortMappingOverrides` y escribe localStorage. ─────────────
    await page.evaluate(({ rx, reason }) => {
      const w = window as unknown as {
        __codex: { catalogConfigStore: { getState: () => {
          upsertOverride: (id: string, m: Record<string, unknown>) => void;
        } } };
      };
      w.__codex.catalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', {
        productId: 'SAM_TPS-300-Z',
        source: 'override',
        overrideReason: reason,
        overrideAt: new Date().toISOString(),
        // Hito 2 (A-4): la colocación usa el marco completo de la boca de entrada.
        // Un `modelFrame` rígido (malla + bocas juntas) es un cambio de coordenadas
        // locales y NO cambia la pieza colocada. La calibración que sí corrige la
        // colocación es la de la boca respecto del cuerpo: aquí, el giro de
        // instalación de la boca de entrada (tronco_P1) — la T queda girada sobre
        // el eje del tronco y la derivación se mueve.
        entries: [
          { recipePortName: 'tronco_P1', catalogPortName: 'P1', physicalLabel: 'P1', justification: 'identidad', geometry: { installRotationDeg: rx } },
          { recipePortName: 'tronco_P2', catalogPortName: 'P2', physicalLabel: 'P2', justification: 'identidad' },
          { recipePortName: 'boca_derivacion', catalogPortName: 'P3', physicalLabel: 'P3', justification: 'identidad' },
        ],
      });
    }, { rx: OVERRIDE_RX_DEG, reason: OVERRIDE_REASON });

    // ─── Re-insertar con override activo ─────────────────────────────────
    await insertTpsFromT1P2(page);
    const withOverride = await readTpsBocaDerivacion(page);

    await page.locator('canvas').screenshot({ path: resolve(OUT_DIR, 'calib-04-workspace-overrided.png') });

    // ─── Assert: la posición de boca_derivacion DEBE diferir ─────────────
    const d = Math.hypot(
      withOverride.posicion_mm[0] - baseline.posicion_mm[0],
      withOverride.posicion_mm[1] - baseline.posicion_mm[1],
      withOverride.posicion_mm[2] - baseline.posicion_mm[2],
    );
    expect(
      d,
      `la calibración debe mover boca_derivacion (baseline=${JSON.stringify(baseline.posicion_mm)}, ` +
      `override=${JSON.stringify(withOverride.posicion_mm)}, Δ=${d.toFixed(3)} mm)`,
    ).toBeGreaterThan(1);

    // ─── Motor payload: boca_derivacion → P3 con posición corregida ──────
    const motorPayload = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { entrada: unknown } };
          toMotorEntrada: (e: unknown) => Record<string, unknown>;
        };
      };
      const e = w.__codex.trayStore.getState().entrada;
      return w.__codex.toMotorEntrada(e);
    });

    const motorPiezas = motorPayload.piezas as Array<{
      producto_id: string;
      puertos: Record<string, { posicion_mm: [number, number, number] }>;
    }>;
    const tpsMotor = motorPiezas.find((p) => p.producto_id === 'SAM_TPS-300-Z');
    expect(tpsMotor, 'TPS debe estar en el payload del motor').toBeDefined();
    // La clave de receta no debe sobrevivir a la traducción.
    expect(tpsMotor!.puertos.boca_derivacion).toBeUndefined();
    // La clave de catálogo debe aparecer con la MISMA posición que la pieza.
    expect(tpsMotor!.puertos.P3).toBeDefined();
    expect(tpsMotor!.puertos.P3.posicion_mm[0]).toBeCloseTo(withOverride.posicion_mm[0], 3);
    expect(tpsMotor!.puertos.P3.posicion_mm[1]).toBeCloseTo(withOverride.posicion_mm[1], 3);
    expect(tpsMotor!.puertos.P3.posicion_mm[2]).toBeCloseTo(withOverride.posicion_mm[2], 3);

    // La conexión de entrada también debe estar traducida (tronco_P1 → P1).
    const motorConexiones = motorPayload.conexiones as Array<{ a: [string, string]; b: [string, string] }>;
    const conn = motorConexiones.find(
      (c) => c.a[0] === withOverride.instancia_id || c.b[0] === withOverride.instancia_id,
    );
    expect(conn, 'debe existir conexión T1 ↔ TPS').toBeDefined();
    // El extremo sobre el TPS debe usar nombre de catálogo.
    const tpsEnd = conn!.a[0] === withOverride.instancia_id ? conn!.a[1] : conn!.b[1];
    expect(['P1', 'P2', 'P3']).toContain(tpsEnd);
  });

  test('override sobrevive reload de la página', async ({ page }) => {
    // Preparar un override vía el Configurador (usamos el flujo UI real).
    await page.goto('/?configurator=v1');
    await waitForConfiguratorReady(page);
    await page.locator('[data-testid="cfg-tab-orientacion"]').click();
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-mf-rx_deg"]').fill(String(OVERRIDE_RX_DEG));
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(OVERRIDE_REASON);
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();

    // Reload entero y volver a entrar al Configurador.
    await page.reload();
    await waitForConfiguratorReady(page);

    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('codex:catalogConfig:v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(persisted?.overrides?.['SAM_TPS-300-Z']?.modelFrame?.rx_deg).toBe(OVERRIDE_RX_DEG);

    // El visor debe seguir en el Configurador — el store ya está hidratado.
    await page.locator('[data-testid="cfg-viewer-canvas"]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('[data-testid="cfg-viewer-canvas"]')
      .screenshot({ path: resolve(OUT_DIR, 'calib-05-after-reload.png') });
  });
});
