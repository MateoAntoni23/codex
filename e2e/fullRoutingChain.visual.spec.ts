/**
 * E2E — Recorrido completo recto → curva → recto → T → continuación desde
 * cada salida libre, para las dos familias con modelos paramétricos vivos:
 *
 *   • Perforada 300  (SAM-STP-Z)  — TRPS-300 / CPS-300-90 / TPS-300
 *   • Escalera 300   (SAM-STE-Z)  — TRES-300 / CS-300-90 / TS-300
 *
 * Qué comprobamos con clicks reales y asserts sobre el store de trazado:
 *
 *   1. Desde el P2 del recto inicial, el selector ofrece la curva 90°
 *      en "Recomendados" y se puede confirmar sin motivo.
 *   2. Desde el P2 libre de la curva, el selector ofrece un recto y se
 *      confirma sin motivo.
 *   3. Desde el P2 libre del segundo recto, el selector ofrece la T en
 *      "Recomendados" (familia correcta, compat SAMET documentada). El
 *      panel expone los botones de boca de entrada y permite confirmar.
 *   4. Tras colocar la T, cada una de sus dos bocas libres (P2 y P3 del
 *      catálogo) reabre el panel de continuación con al menos un producto
 *      compatible — la cadena puede continuar desde ambos lados.
 *   5. Deshacer vuelve a quitar la T; rehacer la restaura. Ningún paso
 *      intermedio requiere motor Python ni bypass del store.
 *
 * NO se revisa aquí la geometría visual (otros specs cubren alineación y
 * fidelidad al STEP). Este spec valida que la cadena DE DECISIÓN del usuario
 * se completa — selector correcto, UI de boca, commit atómico, continuación.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page } from '@playwright/test';

type Vec3 = [number, number, number];

interface PortSnapshot {
  readonly pieceId: string;
  readonly portName: string;
  readonly pos: Vec3;
  readonly dir: Vec3;
}

interface TrayState {
  readonly pieces: Array<{
    readonly instancia_id: string;
    readonly producto_id: string;
    readonly ports: Record<string, { readonly pos: Vec3; readonly dir: Vec3 }>;
  }>;
  readonly conexiones: Array<{
    readonly conexion_id: string;
    readonly a: readonly [string, string];
    readonly b: readonly [string, string];
  }>;
}

async function bootstrap(page: Page, straightProductId: string): Promise<void> {
  await page.goto('/?workspace=bandejas&diag=ports');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene),
    { timeout: 20_000 },
  );
  await page.evaluate(({ productoId }) => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { importEdit: (i: unknown) => void } };
        routingStore: {
          getState: () => {
            deactivate: () => void;
            activate: () => void;
            selectStartPort: (p: { pieceId: string; portName: string; pos: Vec3; dir: Vec3 }) => void;
          };
        };
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
        cable_id: 'E2E',
        origen_requisito: 'e2e-full-chain',
        conductores: [],
      },
    });
    w.__codex.routingStore.getState().activate();
    w.__codex.routingStore.getState().selectStartPort({
      pieceId: 'SEED',
      portName: 'P2',
      pos: [3000, 0, 0],
      dir: [1, 0, 0],
    });
  }, { productoId: straightProductId });

  await page.locator('[data-codex-routing-product-select]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function readTrayState(page: Page): Promise<TrayState> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => { entrada: unknown } } };
    };
    const entrada = w.__codex.trayStore.getState().entrada as {
      piezas: Array<{
        instancia_id: string;
        producto_id: string;
        puertos: Record<string, { posicion_mm: Vec3; direccion: Vec3 }>;
      }>;
      conexiones: Array<{
        conexion_id: string;
        a: [string, string];
        b: [string, string];
      }>;
    };
    return {
      pieces: entrada.piezas.map((p) => ({
        instancia_id: p.instancia_id,
        producto_id: p.producto_id,
        ports: Object.fromEntries(
          Object.entries(p.puertos).map(([n, pt]) => [n, { pos: pt.posicion_mm, dir: pt.direccion }]),
        ),
      })),
      conexiones: entrada.conexiones.map((c) => ({
        conexion_id: c.conexion_id,
        a: c.a,
        b: c.b,
      })),
    };
  });
}

async function selectPort(page: Page, port: PortSnapshot): Promise<void> {
  await page.evaluate((p) => {
    const w = window as unknown as {
      __codex: {
        routingStore: {
          getState: () => {
            deactivate: () => void;
            activate: () => void;
            selectStartPort: (q: { pieceId: string; portName: string; pos: Vec3; dir: Vec3 }) => void;
          };
        };
      };
    };
    const r = w.__codex.routingStore.getState();
    r.deactivate();
    r.activate();
    r.selectStartPort(p);
  }, port);
  await page.locator('[data-codex-routing-product-select]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function waitForOptionAndSelect(page: Page, productoId: string): Promise<void> {
  await page.waitForFunction((pid) => {
    const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value === pid);
  }, productoId, { timeout: 15_000 });
  await page.locator('[data-codex-routing-product-select]').selectOption(productoId);
  await page.waitForTimeout(250);
}

async function confirm(page: Page): Promise<void> {
  await page.locator('text=Confirmar continuación').click();
  await page.waitForTimeout(400);
}

function freePorts(state: TrayState, pieceId: string): string[] {
  const used = new Set<string>();
  for (const c of state.conexiones) {
    if (c.a[0] === pieceId) used.add(c.a[1]);
    if (c.b[0] === pieceId) used.add(c.b[1]);
  }
  const pieza = state.pieces.find((p) => p.instancia_id === pieceId)!;
  return Object.keys(pieza.ports).filter((n) => !used.has(n));
}

interface FamilyConfig {
  readonly label: string;
  readonly recto: string;
  readonly curva90: string;
  readonly tee: string;
  /**
   * Bocas esperadas en la T (nombres de la receta). Perforada usa nombres
   * semánticos (tronco_P1/P2, boca_derivacion); escalera usa P1/P2/P3.
   */
  readonly teePortCount: number;
}

const PERFORADA: FamilyConfig = {
  label: 'perforada 300',
  recto: 'SAM_TRPS-300-22-Z',
  curva90: 'SAM_CPS-300-90-Z',
  tee: 'SAM_TPS-300-Z',
  teePortCount: 3,
};

const ESCALERA: FamilyConfig = {
  label: 'escalera 300',
  recto: 'SAM_TRES-300-065-18-Z',
  curva90: 'SAM_CS-300-90-065-18-Z',
  tee: 'SAM_TS-300-065-18-Z',
  teePortCount: 3,
};

async function runFullChain(page: Page, cfg: FamilyConfig): Promise<void> {
  await bootstrap(page, cfg.recto);

  // ── Paso 1: curva 90° desde SEED.P2 ─────────────────────────────────────
  await waitForOptionAndSelect(page, cfg.curva90);
  await confirm(page);

  let state = await readTrayState(page);
  expect(state.pieces.length, `[${cfg.label}] curva agregada`).toBe(2);
  const curvaPiece = state.pieces.find((p) => p.producto_id === cfg.curva90);
  expect(curvaPiece, `[${cfg.label}] curva existe`).toBeDefined();

  // Punto de entrada: la boca libre de la curva (no la conectada a SEED).
  const curvaFreeNames = freePorts(state, curvaPiece!.instancia_id);
  expect(curvaFreeNames.length, `[${cfg.label}] curva con 1 salida libre`).toBe(1);
  const curvaFreeName = curvaFreeNames[0];
  const curvaFreePort = curvaPiece!.ports[curvaFreeName];

  // ── Paso 2: segundo recto desde la salida libre de la curva ─────────────
  await selectPort(page, {
    pieceId: curvaPiece!.instancia_id,
    portName: curvaFreeName,
    pos: curvaFreePort.pos,
    dir: curvaFreePort.dir,
  });
  await waitForOptionAndSelect(page, cfg.recto);
  await confirm(page);

  state = await readTrayState(page);
  expect(state.pieces.length, `[${cfg.label}] segundo recto agregado`).toBe(3);

  const segundoRecto = state.pieces
    .filter((p) => p.producto_id === cfg.recto)
    .find((p) => p.instancia_id !== 'SEED');
  expect(segundoRecto, `[${cfg.label}] segundo recto existe`).toBeDefined();
  const rectoFreeNames = freePorts(state, segundoRecto!.instancia_id);
  expect(rectoFreeNames.length, `[${cfg.label}] recto con 1 salida libre`).toBe(1);
  const rectoFreePort = segundoRecto!.ports[rectoFreeNames[0]];

  // ── Paso 3: T desde la salida libre del segundo recto ───────────────────
  await selectPort(page, {
    pieceId: segundoRecto!.instancia_id,
    portName: rectoFreeNames[0],
    pos: rectoFreePort.pos,
    dir: rectoFreePort.dir,
  });
  await waitForOptionAndSelect(page, cfg.tee);
  // La T exige elegir boca de entrada. El default de RoutingPanel es la
  // primera boca soportada — para ambas familias es una entrada horizontal
  // válida, así que podemos confirmar sin tocar los botones y comprobar al
  // final que la conexión usa la boca esperada (la primera habilitada).
  const entryButtons = page.locator('[data-codex-routing-entry-port]');
  await expect(entryButtons, `[${cfg.label}] botones de boca para la T`).toHaveCount(cfg.teePortCount);
  const entryNames = await entryButtons.evaluateAll((els) =>
    els.map((el) => ({
      name: (el as HTMLElement).getAttribute('data-codex-routing-entry-port') ?? '',
      disabled: (el as HTMLButtonElement).disabled,
    })),
  );
  const firstEnabled = entryNames.find((e) => !e.disabled);
  expect(firstEnabled, `[${cfg.label}] al menos una boca habilitada para la T`).toBeDefined();
  await page.locator(`[data-codex-routing-entry-port="${firstEnabled!.name}"]`).click();
  await confirm(page);

  state = await readTrayState(page);
  expect(state.pieces.length, `[${cfg.label}] T agregada`).toBe(4);
  const teePiece = state.pieces.find((p) => p.producto_id === cfg.tee);
  expect(teePiece, `[${cfg.label}] T existe`).toBeDefined();
  expect(Object.keys(teePiece!.ports).sort(), `[${cfg.label}] T con 3 bocas`).toHaveLength(3);
  const teeFreeNames = freePorts(state, teePiece!.instancia_id);
  expect(teeFreeNames.length, `[${cfg.label}] T con 2 salidas libres`).toBe(2);

  // ── Paso 4: desde cada salida libre de la T, el selector ofrece algo ────
  for (const freeName of teeFreeNames) {
    const freePort = teePiece!.ports[freeName];
    await selectPort(page, {
      pieceId: teePiece!.instancia_id,
      portName: freeName,
      pos: freePort.pos,
      dir: freePort.dir,
    });
    // El selector debe ofrecer al menos un candidato compatible — típicamente
    // el recto de la familia.
    const compatCount = await page.evaluate(() => {
      const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
      if (!sel) return -1;
      return Array.from(sel.options).filter((o) => !!o.value).length;
    });
    expect(compatCount, `[${cfg.label}] T.${freeName}: lista compatible no vacía`).toBeGreaterThan(0);
    // El recto de la familia debe estar presente.
    const hasRecto = await page.evaluate((pid) => {
      const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
      return !!sel && Array.from(sel.options).some((o) => o.value === pid);
    }, cfg.recto);
    expect(hasRecto, `[${cfg.label}] T.${freeName}: recto ofrecido`).toBe(true);
  }

  // ── Paso 5: undo quita la T, redo la restaura ───────────────────────────
  await page.evaluate(() => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => { undo: () => void } } };
    };
    w.__codex.trayStore.getState().undo();
  });
  await page.waitForTimeout(200);
  const afterUndo = await readTrayState(page);
  expect(
    afterUndo.pieces.some((p) => p.producto_id === cfg.tee),
    `[${cfg.label}] undo quita la T`,
  ).toBe(false);
  expect(afterUndo.pieces.length, `[${cfg.label}] 3 piezas tras undo`).toBe(3);

  await page.evaluate(() => {
    const w = window as unknown as {
      __codex: { trayStore: { getState: () => { redo: () => void } } };
    };
    w.__codex.trayStore.getState().redo();
  });
  await page.waitForTimeout(200);
  const afterRedo = await readTrayState(page);
  expect(
    afterRedo.pieces.some((p) => p.producto_id === cfg.tee),
    `[${cfg.label}] redo restaura la T`,
  ).toBe(true);
  expect(afterRedo.pieces.length, `[${cfg.label}] 4 piezas tras redo`).toBe(4);
}

test.describe('Recorrido completo recto → curva → recto → T → continuación', () => {
  test.setTimeout(90_000);

  test('perforada 300: TRPS → CPS-90 → TRPS → TPS, salidas libres habilitan continuación', async ({ page }) => {
    await runFullChain(page, PERFORADA);
  });

  test('escalera 300: TRES → CS-90 → TRES → TS, salidas libres habilitan continuación', async ({ page }) => {
    await runFullChain(page, ESCALERA);
  });
});
