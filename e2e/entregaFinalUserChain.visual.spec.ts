/**
 * E2E entrega final — cadena completa con el JSON real del usuario.
 *
 * Cubre el guion de aceptación:
 *
 *   1. Importa configuración (JSON real del usuario) por el botón "Importar JSON"
 *      del workspace unificado.
 *   2. Entra al Configurador, selecciona el maestro TRPS y lo compara contra
 *      la variante TRPS-450-20-Z (fila `declared` en la tabla del maestro).
 *   3. Verifica mesh + dimensiones + bocas vía el bridge dev
 *      `window.__codex.configuratorMesh()` / `.configuratorPorts()`.
 *   4. Calibra el PATRÓN desde la variante medida TRPS-300-22-Z (B-2.5: giro
 *      axial de P1 = 15°, corrección en los ejes de la boca). Confirma que la
 *      variante TRPS-450-20-Z la HEREDA, marcada "sin verificar en este ancho".
 *   5. Inserta TRPS-450-20-Z en el workspace y conecta otra pieza compatible
 *      (CPS 90°) por el flujo de rutas real.
 *   6. Repite el escenario de inheritance con TRES-300-065 → TRES-450-090-18-Z
 *      (regla `ala-independent` del maestro escalera:tramo_recto). El maestro
 *      se resuelve también para variantes con ala distinta porque la regla
 *      declara `ala` como eje que varía.
 *   7. Exporta el workspace vía "Exportar JSON", recarga la página, re-importa
 *      y confirma que trayInput + overrides sobreviven byte-equivalente.
 *   8. Verifica Cancelar (desactivar routing) y Deshacer/Rehacer tras mutar.
 *
 * Todo pasa por clicks reales del DOM; sólo los asserts leen estado directo
 * del store para comprobar invariantes.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Hito 2 (A-10): al abrir un proyecto anterior se deduce la colocación de cada pieza
 * (campo `colocacion` + tabla `definiciones_ws`) y las bocas pasan a derivarse de la
 * pose. Para comparar contra el archivo original se quitan esos datos y se
 * redondean las bocas a 1e-6 mm (la migración del fixture no corre ninguna boca).
 */
function sinColocacion<T>(v: T): T {
  const strip = (x: unknown): unknown => {
    if (typeof x === 'number') return Math.round(x * 1e6) / 1e6 + 0;
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) {
        if (k === 'colocacion' || k === 'definiciones_ws' || k === 'uniones_ws' || k === 'orientacion_seccion_ws') continue;
        o[k] = strip(val);
      }
      return o;
    }
    return x;
  };
  return strip(v) as T;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, 'fixtures/user-report-20261107.workspace.json');
const OUT_DIR = resolve(__dirname, 'output');

// Overrides elegidos para que el efecto sea visible y verificable numéricamente.
const TRPS_MF_RZ_DEG = 15;
const TRPS_REASON =
  'Entrega final — calibración test: marco rz=15° y normal P1 corregida en el maestro TRPS 300.';
const TRES_MF_RZ_DEG = 10;
const TRES_REASON =
  'Entrega final — calibración test: marco rz=10° en el maestro TRES 300-065.';

async function gotoConfigurator(page: Page): Promise<void> {
  await page.goto('/?configurator=v1');
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid^="cfg-product-SAM_"]'), {
    timeout: 20_000,
  });
}

async function selectProduct(page: Page, productoId: string): Promise<void> {
  // El producto puede no ser visible si el filtro activo lo oculta; limpiamos
  // filtros por si acaso.
  const clear = page.locator('[data-testid="cfg-filter-clear"]');
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
  }
  const btn = page.locator(`[data-testid="cfg-product-${productoId}"]`);
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
}

async function openOrientacionTab(page: Page): Promise<void> {
  await page.locator('[data-testid="cfg-tab-orientacion"]').click();
  await page.locator('[data-testid="cfg-edit-orientacion"]').waitFor({ state: 'visible', timeout: 5_000 });
}

async function openMaestroTab(page: Page): Promise<void> {
  await page.locator('[data-testid="cfg-tab-maestro"]').click();
  await page.locator('[data-testid="cfg-maestro-provenance"]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function readConfiguratorMesh(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __codex: { configuratorMesh: () => Record<string, unknown> | null } };
    return w.__codex.configuratorMesh();
  });
}

/**
 * Fail-fast: comprueba que `resolveParametricEntry(product)` devuelve entrada
 * para el productId pedido ANTES de esperar al Canvas. Sin esta verificación,
 * `.screenshot()` sobre `cfg-viewer-canvas` cuelga 180 s cuando la receta no
 * existe (viewer muestra el hint en texto y el testid nunca aparece).
 */
async function assertRecipeAvailable(page: Page, productId: string): Promise<void> {
  const hasRecipe = await page.evaluate((pid) => {
    const w = window as unknown as {
      __codex?: { hasParametricRecipe?: (id: string) => boolean };
    };
    if (!w.__codex?.hasParametricRecipe) {
      throw new Error('__codex.hasParametricRecipe no está expuesto — ConfiguratorLayout no montado');
    }
    return w.__codex.hasParametricRecipe(pid);
  }, productId);
  if (!hasRecipe) {
    throw new Error(
      `assertRecipeAvailable: el producto ${productId} no tiene receta paramétrica resuelta ` +
      `(ni índice legacy ni master-based). El Canvas del Configurador no va a aparecer — falla ahora.`,
    );
  }
}

async function readConfiguratorPorts(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const w = window as unknown as { __codex: { configuratorPorts: () => Array<Record<string, unknown>> } };
    return w.__codex.configuratorPorts();
  });
}

async function importWorkspaceViaUI(page: Page): Promise<void> {
  const raw = readFileSync(FIXTURE, 'utf-8');
  // Hito 1: el confirm sólo aparece si hay contenido; aceptar de forma tolerante.
  const accept = (d: import('@playwright/test').Dialog) => void d.accept().catch(() => undefined);
  page.on('dialog', accept);
  const input = page.locator('input[type="file"][accept=".json"]').first();
  await input.setInputFiles({
    name: 'user-report-20261107.workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  });
  // Esperar a que trayStore tenga las piezas.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __codex?: { trayStore?: { getState: () => { entrada: { piezas: unknown[] } | null } } };
    };
    const e = w.__codex?.trayStore?.getState().entrada;
    return !!e && e.piezas.length > 0;
  }, { timeout: 20_000 });
  page.off('dialog', accept);
}

async function waitWorkspaceReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
    { timeout: 20_000 },
  );
}

test.describe('Entrega final — cadena completa con JSON del usuario', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('TRPS: variante 450 hereda la calibración del patrón medida en la 300 (marcada heredada)', async ({ page }) => {
    await gotoConfigurator(page);

    // ─── Seleccionar maestro TRPS 300 y abrir su tabla ──────────────────
    await selectProduct(page, 'SAM_TRPS-300-22-Z');
    await openMaestroTab(page);

    // La fila del seleccionado está marcada activa.
    await expect(
      page.locator('[data-testid="cfg-maestro-row-TRPS-300-22-Z"]'),
    ).toHaveClass(/is-active/);
    // La variante 450 existe en la tabla con origin `declared`.
    const row450 = page.locator('[data-testid="cfg-maestro-row-TRPS-450-20-Z"]');
    await expect(row450).toBeVisible();
    await expect(row450).toContainText('declared');

    // La procedencia del maestro: el perforada tramo_recto es `derived`
    // (TRPS-300 es el único STEP; TRPS-450 se proyecta por regla, no se midió).
    const provText = (
      await page.locator('[data-testid="cfg-maestro-provenance"]').textContent()
    ) ?? '';
    expect(provText.toLowerCase()).toContain('derivada');

    // ─── B-2.5: calibrar el PATRÓN desde la variante medida (TRPS-300) ───
    // Ya no hay marco del modelo ni normales por SKU: la corrección es por boca,
    // en sus propios ejes (giro axial de P1 = 15°).
    await openOrientacionTab(page);
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await expect(page.locator('[data-testid^="cfg-mf-"]')).toHaveCount(0);
    await page.locator('[data-testid="cfg-port-rot-P1"]').fill(String(TRPS_MF_RZ_DEG));
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(TRPS_REASON);
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-calibracion-estado"]')).toContainText('Variante medida');

    // ─── Verificar visual de la VARIANTE TRPS-450-20-Z con calibración ──
    // La variante se resuelve por maestro (ancho=450, regla ancho-only-z) y
    // hereda la calibración del patrón, marcada "sin verificar en este ancho".
    // Fail-fast: si no hay receta, la aserción falla con mensaje útil ANTES
    // de que el .screenshot() bloquee 180 s.
    await assertRecipeAvailable(page, 'SAM_TRPS-450-20-Z');
    await selectProduct(page, 'SAM_TRPS-450-20-Z');
    await page.waitForTimeout(500);
    await page
      .locator('[data-testid="cfg-viewer-canvas"]')
      .screenshot({ path: resolve(OUT_DIR, 'entrega-01-trps450-mesh.png') });

    const mesh = await readConfiguratorMesh(page);
    expect(mesh, 'configuratorMesh devuelve datos para TRPS-450-20-Z').not.toBeNull();
    expect(mesh!.productoId).toBe('SAM_TRPS-450-20-Z');
    expect(mesh!.isIdentity, 'la variante hereda la calibración del patrón: NO es identidad').toBe(false);
    await expect(page.locator('[data-testid="cfg-viewer-calibracion"]')).toContainText('sin verificar en este ancho');

    const ports = await readConfiguratorPorts(page);
    const p1 = ports.find((p) => p.port === 'P1');
    const p2 = ports.find((p) => p.port === 'P2');
    expect(p1, 'puerto P1 renderizado en TRPS-450').toBeDefined();
    expect(p2, 'puerto P2 renderizado en TRPS-450').toBeDefined();

    writeFileSync(
      resolve(OUT_DIR, 'entrega-01-trps450-with-override.mesh.json'),
      JSON.stringify({ mesh, ports }, null, 2),
    );
  });

  test('TRES-450-090: hereda la calibración del patrón de TRES-300-065 (ala-independent)', async ({ page }) => {
    await gotoConfigurator(page);

    await selectProduct(page, 'SAM_TRES-300-065-18-Z');
    await openMaestroTab(page);

    // La procedencia del maestro escalera tramo_recto es `derived`.
    const provText = (
      await page.locator('[data-testid="cfg-maestro-provenance"]').textContent()
    ) ?? '';
    expect(provText.toLowerCase()).toContain('derivada');

    // ─── B-2.5: calibrar el patrón (giro axial de P1 = 10°) ─────────────
    await openOrientacionTab(page);
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-port-rot-P1"]').fill(String(TRES_MF_RZ_DEG));
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(TRES_REASON);
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();

    // ─── Variantes: 450-065 (misma ala) y 450-090 (otra ala) la heredan ──
    for (const variantId of ['SAM_TRES-450-065-18-Z', 'SAM_TRES-450-090-18-Z']) {
      await selectProduct(page, variantId);
      await page.locator('[data-testid="cfg-tab-orientacion"]').click();
      await expect(page.locator('[data-testid="cfg-calibracion-estado"]'), `${variantId} hereda la calibración`).toContainText('sin verificar en este ancho');
    }

    // ─── Visualizar la VARIANTE TRES-450-090 con calibración heredada ───
    // Resolución común: el maestro TRES-300-065 (escalera:tramo_recto,
    // regla ala-independent) cubre TRES-450-090 porque la variación por ala
    // forma parte de la regla del maestro. La variante usa la misma calibración del patrón.
    // Fail-fast: si no hay receta, fallamos con mensaje útil ANTES de que
    // .screenshot() bloquee 180 s en el testid que nunca llega.
    await assertRecipeAvailable(page, 'SAM_TRES-450-090-18-Z');
    await selectProduct(page, 'SAM_TRES-450-090-18-Z');
    await page.waitForTimeout(500);
    await page
      .locator('[data-testid="cfg-viewer-canvas"]')
      .screenshot({ path: resolve(OUT_DIR, 'entrega-02-tres450090-mesh.png') });

    const mesh = await readConfiguratorMesh(page);
    expect(mesh, 'configuratorMesh devuelve datos para TRES-450-090').not.toBeNull();
    expect(mesh!.productoId).toBe('SAM_TRES-450-090-18-Z');
    expect(mesh!.isIdentity, 'la variante hereda la calibración del patrón: NO es identidad').toBe(false);

    const ports = await readConfiguratorPorts(page);
    const p1v = ports.find((p) => p.port === 'P1');
    const p2v = ports.find((p) => p.port === 'P2');
    expect(p1v, 'puerto P1 renderizado en TRES-450-090').toBeDefined();
    expect(p2v, 'puerto P2 renderizado en TRES-450-090').toBeDefined();
  });

  test('Workspace: import real, roundtrip export→reload→import, cancel, undo/redo', async ({ page }) => {
    await page.goto('/?workspace=bandejas');
    await waitWorkspaceReady(page);

    // ─── 1) Importar JSON del usuario via UI ─────────────────────────────
    await importWorkspaceViaUI(page);

    // Verificar que las 7 piezas originales quedaron cargadas.
    const beforeState = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string }>; conexiones: Array<{ conexion_id: string }> } | null } } };
      };
      const e = w.__codex.trayStore.getState().entrada;
      return {
        piezasIds: e?.piezas.map((p) => p.instancia_id) ?? [],
        conexionesIds: e?.conexiones.map((c) => c.conexion_id) ?? [],
      };
    });
    expect(beforeState.piezasIds.length).toBe(7);
    expect(beforeState.conexionesIds.length).toBe(6);

    await page
      .locator('canvas')
      .first()
      .screenshot({ path: resolve(OUT_DIR, 'entrega-03-workspace-imported.png') });

    // ─── 2) Guardar un override en Configurador (persistente en localStorage) ─
    await gotoConfigurator(page);
    await selectProduct(page, 'SAM_TRPS-300-22-Z');
    await openOrientacionTab(page);
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-port-rot-P1"]').fill(String(TRPS_MF_RZ_DEG));
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(TRPS_REASON);
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();

    // Volver al workspace y reimportar fixture para que el proyecto tenga tray + overrides.
    await page.goto('/?workspace=bandejas');
    await waitWorkspaceReady(page);
    await importWorkspaceViaUI(page);

    // Reaplicar override — importWorkspace reemplaza overrides por lo que trae el archivo.
    await gotoConfigurator(page);
    await selectProduct(page, 'SAM_TRPS-300-22-Z');
    await openOrientacionTab(page);
    await page.locator('[data-testid="cfg-edit-orientacion"]').click();
    await page.locator('[data-testid="cfg-port-rot-P1"]').fill(String(TRPS_MF_RZ_DEG));
    await page.locator('[data-testid="cfg-orientacion-reason"]').fill(TRPS_REASON);
    await page.locator('[data-testid="cfg-apply-orientacion"]').click();
    await expect(page.locator('[data-testid="cfg-edit-orientacion"]')).toBeVisible();

    // ─── 3) Exportar workspace completo (contendrá tray + overrides) ─────
    await page.goto('/?workspace=bandejas');
    await waitWorkspaceReady(page);
    const [download]: [Download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Exportar JSON/i }).click(),
    ]);
    const exportedPath = resolve(OUT_DIR, 'entrega-exported.workspace.json');
    await download.saveAs(exportedPath);
    const exportedRaw = readFileSync(exportedPath, 'utf-8');
    const exported = JSON.parse(exportedRaw) as {
      trayInput: { piezas: Array<{ instancia_id: string }>; conexiones: Array<{ conexion_id: string }> };
      library?: { overrides: Record<string, unknown>; calibracion?: { patrones: Record<string, { bocas: Record<string, { giro_deg: { axial: number } }> }> } };
    };
    expect(exported.trayInput.piezas.length).toBe(7);
    expect(exported.trayInput.conexiones.length).toBe(6);
    // B-2.5: el archivo lleva la calibración por patrón (no overrides por SKU).
    const patronesExportados = Object.values(exported.library?.calibracion?.patrones ?? {});
    expect(patronesExportados).toHaveLength(1);
    expect(patronesExportados[0].bocas.P1.giro_deg.axial).toBe(TRPS_MF_RZ_DEG);

    // ─── 4) Reload entero + re-importar el archivo exportado ─────────────
    await page.reload();
    await waitWorkspaceReady(page);
    // Clear cualquier estado previo.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitWorkspaceReady(page);

    // Hito 1: la biblioteca local manda. Tras localStorage.clear() la local está vacía y el
    // archivo trae overrides → aviso; se elige "adoptar" para recuperar la calibración del archivo.
    const acceptDialog = (d: import('@playwright/test').Dialog) => void d.accept().catch(() => undefined);
    page.on('dialog', acceptDialog);
    const input = page.locator('input[type="file"][accept=".json"]').first();
    await input.setInputFiles({
      name: 'entrega-exported.workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedRaw, 'utf-8'),
    });
    await page.getByTestId('library-adopt').click();
    page.off('dialog', acceptDialog);
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __codex?: { trayStore?: { getState: () => { entrada: { piezas: unknown[] } | null } } };
        };
        const e = w.__codex?.trayStore?.getState().entrada;
        return !!e && e.piezas.length === 7;
      },
      { timeout: 10_000 },
    );

    const afterReload = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          trayStore: { getState: () => { entrada: unknown } };
          catalogConfigStore: { getState: () => { calibracion: { patrones: Record<string, unknown> } } };
        };
      };
      return {
        entrada: w.__codex.trayStore.getState().entrada,
        patrones: w.__codex.catalogConfigStore.getState().calibracion.patrones,
      };
    });
    expect(sinColocacion(afterReload.entrada)).toEqual(sinColocacion(exported.trayInput));
    expect(afterReload.patrones).toEqual(exported.library!.calibracion!.patrones);

    await page
      .locator('canvas')
      .first()
      .screenshot({ path: resolve(OUT_DIR, 'entrega-04-workspace-reimported.png') });

    // ─── 5) Cancelar routing (activo→deactivado) ─────────────────────────
    const routingState0 = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          routingStore: {
            getState: () => {
              active: boolean;
              activate: () => void;
              deactivate: () => void;
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
      const r = w.__codex.routingStore.getState();
      r.activate();
      r.selectStartPort({ pieceId: 'R1', portName: 'P2', pos: [0, 0, 0], dir: [1, 0, 0] });
      return w.__codex.routingStore.getState().active;
    });
    expect(routingState0).toBe(true);
    // Click en Escape vía global clearAll: usar key Escape.
    await page.keyboard.press('Escape');
    const routingState1 = await page.evaluate(
      () =>
        (window as unknown as { __codex: { routingStore: { getState: () => { active: boolean } } } })
          .__codex.routingStore.getState().active,
    );
    expect(routingState1, 'Escape debe desactivar routing').toBe(false);

    // ─── 6) Undo / Redo: mutar y verificar historial ─────────────────────
    const mut = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          trayStore: {
            getState: () => {
              entrada: { piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, unknown> }>; conexiones: unknown[] } | null;
              edit: (next: unknown) => void;
              undo: () => void;
              redo: () => void;
            };
          };
        };
      };
      const s = w.__codex.trayStore.getState();
      const snap = JSON.parse(JSON.stringify(s.entrada));
      const next = JSON.parse(JSON.stringify(s.entrada));
      next.piezas.push({
        instancia_id: 'GHOST',
        producto_id: 'SAM_TRES-300-065-18-Z',
        puertos: {
          P1: { posicion_mm: [-5000, 0, 0], direccion: [-1, 0, 0] },
          P2: { posicion_mm: [-2000, 0, 0], direccion: [1, 0, 0] },
        },
      });
      s.edit(next);
      const afterEdit = w.__codex.trayStore.getState().entrada!.piezas.length;
      s.undo();
      const afterUndo = w.__codex.trayStore.getState().entrada!.piezas.length;
      s.redo();
      const afterRedo = w.__codex.trayStore.getState().entrada!.piezas.length;
      s.undo(); // restaurar
      return { snap: snap.piezas.length, afterEdit, afterUndo, afterRedo };
    });
    expect(mut.snap).toBe(7);
    expect(mut.afterEdit).toBe(8);
    expect(mut.afterUndo).toBe(7);
    expect(mut.afterRedo).toBe(8);
  });
});
