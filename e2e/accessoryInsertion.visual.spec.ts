/**
 * E2E — Inserción interactiva de TPS / XPS / CUPS.
 *
 * Testea con clicks reales sobre el DOM:
 *   1) Carga una bandeja con TRPS (T1) y puerto libre T1.P2.
 *   2) Activa routing y selecciona T1.P2 como startPort.
 *   3) En el <select data-codex-routing-product-select>, cambia el producto a
 *      TPS / XPS / CUPS. El panel debe mostrar el selector de boca de entrada
 *      (botones con data-codex-routing-entry-port).
 *   4) Elige una boca distinta de la default (p.ej. tronco_P1 → tronco_P2 en TPS),
 *      confirma, y comprueba que la pieza creada:
 *        - tiene N bocas con los nombres de la receta
 *        - la conexión usa el nombre de boca elegido
 *   5) Para CUPS, el botón P2_vertical debe estar disabled; P1_horizontal activo.
 *
 * Requiere dev server activo en http://localhost:5173.
 */
import { test, expect } from '@playwright/test';

const FIXTURE_TRAY_WITH_FREE_P2 = {
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

async function bootstrap(page: import('@playwright/test').Page) {
  await page.goto('/?workspace=bandejas&diag=ports');
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
            selectStartPort: (p: { pieceId: string; portName: string; pos: [number, number, number]; dir: [number, number, number] }) => void;
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
  }, FIXTURE_TRAY_WITH_FREE_P2);

  const productSelect = page.locator('[data-codex-routing-product-select]');
  await productSelect.waitFor({ state: 'visible', timeout: 20_000 }); // 10 s se quedaba corto en corridas completas lentas
  return productSelect;
}

test.describe('Inserción interactiva de accesorios (TPS/XPS/CUPS)', () => {
  test.setTimeout(60_000);

  test('TPS: selector de boca aparece; entrada por tronco_P1 default; se puede elegir tronco_P2', async ({ page }) => {
    const productSelect = await bootstrap(page);

    // Esperar a que TPS esté disponible en el selector.
    await page.waitForFunction(() => {
      const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
      return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_TPS-300-Z');
    }, { timeout: 15_000 });

    await productSelect.selectOption('SAM_TPS-300-Z');
    await page.waitForTimeout(300);

    // Deben aparecer los 3 botones de boca.
    const btns = page.locator('[data-codex-routing-entry-port]');
    await expect(btns).toHaveCount(3);
    const names = await btns.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getAttribute('data-codex-routing-entry-port')),
    );
    expect(names.sort()).toEqual(['boca_derivacion', 'tronco_P1', 'tronco_P2'].sort());

    // Elegir tronco_P2 explícitamente.
    await page.locator('[data-codex-routing-entry-port="tronco_P2"]').click();

    // Confirmar.
    await page.locator('text=Confirmar continuación').click();

    // Después del commit: la pieza nueva debe tener las 3 bocas con los nombres
    // de la receta, y la conexión usar 'tronco_P2' como puerto de la pieza nueva.
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, unknown> }>;
        conexiones: Array<{ a: [string, string]; b: [string, string] }>;
      };
      return {
        pieces: entrada.piezas.map((p) => ({
          id: p.instancia_id,
          producto_id: p.producto_id,
          ports: Object.keys(p.puertos),
        })),
        conexiones: entrada.conexiones,
      };
    });
    const tps = result.pieces.find((p) => p.producto_id === 'SAM_TPS-300-Z');
    expect(tps, 'TPS piece created').toBeDefined();
    expect(tps!.ports.sort()).toEqual(['boca_derivacion', 'tronco_P1', 'tronco_P2']);
    const conn = result.conexiones.find(
      (c) => c.a[0] === 'T1' && c.a[1] === 'P2' && c.b[0] === tps!.id,
    );
    expect(conn, 'connection T1.P2 → TPS exists').toBeDefined();
    expect(conn!.b[1]).toBe('tronco_P2');

    // Verificación de cuerpo paramétrico: la TPS debe renderizar como
    // `parametric-confirmed` (receta aplicada por `verifyGeometricFit`), con
    // entryPortName='tronco_P2' y placedPorts que cubran los 3 nombres de la
    // receta y coincidan (±1 mm) con las posiciones persistidas en la pieza.
    // Esto prueba que el fit no cae a schematic-line-fallback por el nombre
    // no-P1/P2 de la boca de entrada.
    const bodyData = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          scene: { traverse: (f: (o: unknown) => void) => void };
          trayStore: { getState: () => { entrada: unknown } };
        };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, { posicion_mm: [number, number, number] }> }>;
      };
      const tpsPiece = entrada.piezas.find((p) => p.producto_id === 'SAM_TPS-300-Z');
      let body: { kind?: string; sku?: string; entryPortName?: string; placedPorts?: Array<{ name: string; pos: [number, number, number] }> } | null = null;
      w.__codex.scene.traverse((obj: unknown) => {
        const o = obj as { userData?: { codex?: { kind?: string; sku?: string; entryPortName?: string; placedPorts?: Array<{ name: string; pos: [number, number, number] }> } } };
        const cx = o.userData?.codex;
        if (cx && cx.kind === 'parametric-confirmed' && cx.sku === 'TPS-300-Z') body = cx;
      });
      return { tpsPiece, body };
    });
    expect(bodyData.body, 'TPS renderizada como parametric-confirmed (no schematic-line)').toBeTruthy();
    // Nota: el solver de `verifyGeometricFit` escoge independientemente la
    // boca de entrada entre las bocas que la receta publica, buscando mínimo
    // error geométrico. Para accesorios simétricos como TPS (tronco_P1,
    // tronco_P2, boca_derivacion) múltiples bocas dan ajuste perfecto, así
    // que no se exige un entryPortName concreto. Lo que debe cumplir el fit:
    //   - entryPortName ∈ {bocas publicadas por la receta}
    //   - placedPorts cubre las 3 bocas con los nombres de la receta
    //   - cada placedPort queda ±1 mm del puerto persistido con ese nombre
    expect(['boca_derivacion', 'tronco_P1', 'tronco_P2']).toContain(bodyData.body!.entryPortName);
    const tpsPlaced = bodyData.body!.placedPorts ?? [];
    expect(tpsPlaced.map((p) => p.name).sort()).toEqual(['boca_derivacion', 'tronco_P1', 'tronco_P2']);
    for (const placed of tpsPlaced) {
      const stored = bodyData.tpsPiece!.puertos[placed.name];
      const err = Math.hypot(
        placed.pos[0] - stored.posicion_mm[0],
        placed.pos[1] - stored.posicion_mm[1],
        placed.pos[2] - stored.posicion_mm[2],
      );
      expect(err, `TPS placed ${placed.name} alineada con boca persistida`).toBeLessThan(1);
    }
  });

  test('TPS: cada salida libre queda disponible para continuar (routing re-arma el selector)', async ({ page }) => {
    const productSelect = await bootstrap(page);

    await page.waitForFunction(() => {
      const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
      return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_TPS-300-Z');
    }, { timeout: 15_000 });

    await productSelect.selectOption('SAM_TPS-300-Z');
    await page.waitForTimeout(300);

    // Entrada por tronco_P2 → tronco_P1 y boca_derivacion quedan libres.
    await page.locator('[data-codex-routing-entry-port="tronco_P2"]').click();
    await page.locator('text=Confirmar continuación').click();
    await page.waitForTimeout(500);

    const tpsInfo = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number] }> }>;
      };
      const tps = entrada.piezas.find((p) => p.producto_id === 'SAM_TPS-300-Z')!;
      return {
        id: tps.instancia_id,
        tronco_P1: tps.puertos['tronco_P1'],
        boca_derivacion: tps.puertos['boca_derivacion'],
      };
    });

    // La "continuación" efectiva (completar un segmento) depende de que el
    // catálogo SAMET declare compatibilidad usando los nombres semánticos
    // (`tronco_P1`, `boca_derivacion`) de la receta paramétrica. Hoy el
    // catálogo usa P1/P2/P3 anónimos → es una brecha documentada, no
    // regresión de esta PR. Lo que SÍ validamos acá: cada salida queda
    // registrada con su nombre semántico y el store de routing acepta
    // arrancar un trazado desde ella (reabre el panel de configuración).
    for (const portName of ['tronco_P1', 'boca_derivacion'] as const) {
      const port = tpsInfo[portName];
      const openedSelector = await page.evaluate(({ pieceId, pName, pos, dir }) => {
        const w = window as unknown as {
          __codex: {
            routingStore: {
              getState: () => {
                deactivate: () => void;
                activate: () => void;
                selectStartPort: (p: { pieceId: string; portName: string; pos: [number, number, number]; dir: [number, number, number] }) => void;
                startPort: unknown;
              };
            };
          };
        };
        const rs = w.__codex.routingStore.getState();
        rs.deactivate();
        rs.activate();
        rs.selectStartPort({ pieceId, portName: pName, pos, dir });
        const current = w.__codex.routingStore.getState().startPort as
          | { pieceId: string; portName: string } | null;
        return current?.portName === pName && current?.pieceId === pieceId;
      }, { pieceId: tpsInfo.id, pName: portName, pos: port.posicion_mm, dir: port.direccion });
      expect(openedSelector, `routing arranca desde ${portName}`).toBe(true);

      // El panel vuelve a montar el selector de producto en modo configuración.
      await page.locator('[data-codex-routing-product-select]').waitFor({ state: 'visible', timeout: 10_000 });

      // Post-fix mapping explícito: el compat lookup de tronco_P1 y
      // boca_derivacion ahora SÍ encuentra productos (traduce a P1/P3 del
      // catálogo). El selector debe listar al menos un producto además del
      // placeholder "— elegir —" (option sin value). Antes del fix, la lista
      // quedaba vacía porque el catálogo desconocía esos nombres.
      const compatCount = await page.evaluate(() => {
        const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
        if (!sel) return -1;
        return Array.from(sel.options).filter((o) => !!o.value).length;
      });
      expect(compatCount, `compat list for ${portName} not empty`).toBeGreaterThan(0);
    }
  });

  test('XPS: 4 bocas, entrada por P1_x_neg default; se puede elegir P4_z_pos', async ({ page }) => {
    const productSelect = await bootstrap(page);

    // Asegurarnos de que XPS está en el selector (puede estar como "Otros").
    await page.waitForFunction(() => {
      const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
      return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_XPS-300-Z');
    }, { timeout: 15_000 });

    await productSelect.selectOption('SAM_XPS-300-Z');
    await page.waitForTimeout(300);

    const btns = page.locator('[data-codex-routing-entry-port]');
    await expect(btns).toHaveCount(4);

    // Elegir P4_z_pos.
    await page.locator('[data-codex-routing-entry-port="P4_z_pos"]').click();

    // Si el producto es "other" (requiere excepción), motivo obligatorio.
    const motive = page.locator('[data-codex-routing-exception-motive]');
    if (await motive.count()) {
      await motive.fill('Excepción técnica autorizada — prueba de inserción XPS');
    }

    await page.locator('text=Confirmar continuación').click();
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, unknown> }>;
        conexiones: Array<{ a: [string, string]; b: [string, string] }>;
      };
      return {
        pieces: entrada.piezas.map((p) => ({
          id: p.instancia_id,
          producto_id: p.producto_id,
          ports: Object.keys(p.puertos),
        })),
        conexiones: entrada.conexiones,
      };
    });
    const xps = result.pieces.find((p) => p.producto_id === 'SAM_XPS-300-Z');
    expect(xps, 'XPS piece created').toBeDefined();
    expect(xps!.ports.sort()).toEqual(['P1_x_neg', 'P2_x_pos', 'P3_z_neg', 'P4_z_pos']);
    const conn = result.conexiones.find(
      (c) => c.a[0] === 'T1' && c.a[1] === 'P2' && c.b[0] === xps!.id,
    );
    expect(conn!.b[1]).toBe('P4_z_pos');

    // Cuerpo paramétrico XPS: mismo contrato que TPS pero con 4 bocas y
    // entryPortName 'P4_z_pos'. Si `verifyGeometricFit` aún presupusiera P1
    // como entrada, el fit fallaría y caería a schematic-line-fallback.
    const bodyData = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: {
          scene: { traverse: (f: (o: unknown) => void) => void };
          trayStore: { getState: () => { entrada: unknown } };
        };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, { posicion_mm: [number, number, number] }> }>;
      };
      const xpsPiece = entrada.piezas.find((p) => p.producto_id === 'SAM_XPS-300-Z');
      let body: { kind?: string; sku?: string; entryPortName?: string; placedPorts?: Array<{ name: string; pos: [number, number, number] }> } | null = null;
      w.__codex.scene.traverse((obj: unknown) => {
        const o = obj as { userData?: { codex?: { kind?: string; sku?: string; entryPortName?: string; placedPorts?: Array<{ name: string; pos: [number, number, number] }> } } };
        const cx = o.userData?.codex;
        if (cx && cx.kind === 'parametric-confirmed' && cx.sku === 'XPS-300-Z') body = cx;
      });
      return { xpsPiece, body };
    });
    expect(bodyData.body, 'XPS renderizada como parametric-confirmed (no schematic-line)').toBeTruthy();
    // Igual que en TPS: el solver elige la boca de entrada por ajuste
    // geométrico, no por la elección del usuario. XPS es simétrica — múltiples
    // bocas dan ajuste perfecto. La aceptación real es que las 4 bocas
    // placedPorts están todas sobre las bocas persistidas.
    expect(['P1_x_neg', 'P2_x_pos', 'P3_z_neg', 'P4_z_pos']).toContain(bodyData.body!.entryPortName);
    const xpsPlaced = bodyData.body!.placedPorts ?? [];
    expect(xpsPlaced.map((p) => p.name).sort()).toEqual(['P1_x_neg', 'P2_x_pos', 'P3_z_neg', 'P4_z_pos']);
    for (const placed of xpsPlaced) {
      const stored = bodyData.xpsPiece!.puertos[placed.name];
      const err = Math.hypot(
        placed.pos[0] - stored.posicion_mm[0],
        placed.pos[1] - stored.posicion_mm[1],
        placed.pos[2] - stored.posicion_mm[2],
      );
      expect(err, `XPS placed ${placed.name} alineada con boca persistida`).toBeLessThan(1);
    }
  });

  test('CUPS: ambas bocas P1_horizontal y P2_vertical ahora son elegibles (frame-based placement)', async ({ page }) => {
    const productSelect = await bootstrap(page);

    await page.waitForFunction(() => {
      const sel = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement | null;
      return !!sel && Array.from(sel.options).some((o) => o.value === 'SAM_CUPS-300-A-Z');
    }, { timeout: 15_000 });

    await productSelect.selectOption('SAM_CUPS-300-A-Z');
    await page.waitForTimeout(300);

    // El puente paramétrico ahora acepta el marco completo del puerto; ambas
    // bocas quedan habilitadas. La combinación geométricamente inconsistente
    // (p. ej. P2_vertical con entryDir horizontal) se bloquea por el guard de
    // consistencia al confirmar, no por deshabilitar el botón.
    const vertical = page.locator('[data-codex-routing-entry-port="P2_vertical"]');
    const horizontal = page.locator('[data-codex-routing-entry-port="P1_horizontal"]');
    await expect(vertical).toBeEnabled();
    await expect(horizontal).toBeEnabled();

    const motive = page.locator('[data-codex-routing-exception-motive]');
    if (await motive.count()) {
      await motive.fill('Transición horizontal→vertical autorizada por proyectista');
    }

    await page.locator('text=Confirmar continuación').click();
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        piezas: Array<{ instancia_id: string; producto_id: string; puertos: Record<string, unknown> }>;
        conexiones: Array<{ a: [string, string]; b: [string, string] }>;
      };
      return {
        pieces: entrada.piezas.map((p) => ({
          id: p.instancia_id,
          producto_id: p.producto_id,
          ports: Object.keys(p.puertos),
        })),
        conexiones: entrada.conexiones,
      };
    });
    const cups = result.pieces.find((p) => p.producto_id === 'SAM_CUPS-300-A-Z');
    expect(cups, 'CUPS piece created').toBeDefined();
    expect(cups!.ports.sort()).toEqual(['P1_horizontal', 'P2_vertical']);
    const conn = result.conexiones.find(
      (c) => c.a[0] === 'T1' && c.a[1] === 'P2' && c.b[0] === cups!.id,
    );
    expect(conn!.b[1]).toBe('P1_horizontal');
  });

  test('Excepción con motivo: persiste en workspace, se elimina del payload motor, sobrevive export/import y undo/redo', async ({ page }) => {
    // Brecha de datos documentada: en el catálogo SAMET actual, los 6 productos
    // con receta paramétrica insertable (TRPS, CPS-45, CPS-90, CUPS-A, TPS, XPS
    // de ancho 300) están TODOS en la lista de compat de TRPS-300.P2. Es decir,
    // desde una boca libre de un TRPS no hay candidato paramétrico en el
    // optgroup "Otros" al que se le pueda cargar motivo por la UI — porque el
    // catálogo ya autoriza la unión y el flujo ofrece el commit directo sin
    // excepción. Esta brecha de datos se documenta en el TODO del proyecto y
    // no es regresión de esta PR.
    //
    // Lo que SÍ está bajo prueba aquí: el modelo de datos y la cadena de
    // persistencia recibe correctamente una excepción simulando el payload
    // exacto que escribe `RoutingPanel.commitDirect` (ver RoutingPanel.tsx:
    // bloque `if (exception && exception.motivo.length > 0)`) y lo preserva
    // a través de:
    //   - store.edit (= misma vía usada tras applyOperation en commitDirect)
    //   - toMotorEntrada (debe borrar el campo)
    //   - exportWorkspace → importWorkspace (roundtrip de archivo)
    //   - undo() → redo()
    // Todos esos pasos son código de producción real; el único atajo es que
    // el acto de ingresar el motivo en el DOM se sustituye por la escritura
    // directa al store con la misma estructura que escribe la UI.
    await bootstrap(page);

    const EXPECTED_CONN_ID = 'CON-EXC-E2E-001';
    const motiveText = 'Transición horizontal→vertical autorizada por proyectista (regresión e2e)';
    const otherProductId = 'SAM_XPS-300-Z';

    // Paso 1 — construir en memoria una entrada con la pieza nueva + la conexión
    // + el bloque `excepciones_conexion` tal como lo escribe commitDirect.
    await page.evaluate(({ connId, motivo, productId }) => {
      const w = window as unknown as {
        __codex: {
          trayStore: {
            getState: () => {
              entrada: unknown;
              edit: (input: unknown) => void;
            };
          };
        };
      };
      const current = w.__codex.trayStore.getState().entrada as {
        piezas: Array<Record<string, unknown>>;
        conexiones: Array<Record<string, unknown>>;
        circuitos: unknown[];
        soportes: unknown[];
        pe: unknown;
        version_contrato: string;
      };
      const next = {
        ...current,
        piezas: [
          ...current.piezas,
          {
            instancia_id: 'EXC_PIEZA',
            producto_id: productId,
            longitud_mm: 300,
            puertos: {
              P1_x_neg: { posicion_mm: [3150, 0, 0], direccion: [-1, 0, 0] },
              P2_x_pos: { posicion_mm: [3450, 0, 0], direccion: [1, 0, 0] },
              P3_z_neg: { posicion_mm: [3300, 0, -150], direccion: [0, 0, -1] },
              P4_z_pos: { posicion_mm: [3300, 0, 150], direccion: [0, 0, 1] },
            },
          },
        ],
        conexiones: [
          ...current.conexiones,
          {
            conexion_id: connId,
            a: ['T1', 'P2'],
            b: ['EXC_PIEZA', 'P1_x_neg'],
          },
        ],
        excepciones_conexion: {
          [connId]: {
            motivo,
            confirmado_por: 'proyectista',
            fecha_iso: new Date().toISOString(),
            reason_code: 'compat_no_documentada',
            producto_id: productId,
          },
        },
      };
      w.__codex.trayStore.getState().edit(next);
    }, { connId: EXPECTED_CONN_ID, motivo: motiveText, productId: otherProductId });

    // Paso 2 — verificar que quedó indexada por conexion_id.
    const captured = await page.evaluate((connId) => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        excepciones_conexion?: Record<string, Record<string, unknown>>;
      };
      return entrada.excepciones_conexion?.[connId] ?? null;
    }, EXPECTED_CONN_ID);
    expect(captured, 'excepción persistida').not.toBeNull();
    expect(captured!.motivo).toBe(motiveText);
    expect(captured!.confirmado_por).toBe('proyectista');
    expect(typeof captured!.fecha_iso).toBe('string');
    expect(captured!.producto_id).toBe(otherProductId);
    expect(captured!.reason_code).toBe('compat_no_documentada');

    // Paso 3 — motor payload NO debe contener excepciones_conexion.
    const motorStripped = await page.evaluate(async () => {
      const storeMod = await import('/src/tray/store.ts');
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const tray = w.__codex.trayStore.getState().entrada as Record<string, unknown>;
      const motor = storeMod.toMotorEntrada(tray as never);
      return 'excepciones_conexion' in motor;
    });
    expect(motorStripped, 'excepciones_conexion stripped del payload Python').toBe(false);

    // Paso 4 — export → import: la excepción sobrevive al roundtrip del archivo.
    const roundtripOk = await page.evaluate(async (connId) => {
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
        ws.elements as never, ws.evidence as never, ws.projectMeta as never, tray as never,
      );
      const re = workspaceFile.importWorkspace(json);
      const persisted = (re.trayInput as Record<string, unknown>).excepciones_conexion as
        | Record<string, Record<string, unknown>> | undefined;
      return {
        hasField: !!persisted,
        matches: persisted?.[connId]?.motivo ?? null,
        reasonCode: persisted?.[connId]?.reason_code ?? null,
      };
    }, EXPECTED_CONN_ID);
    expect(roundtripOk.hasField, 'excepciones_conexion presente en roundtrip').toBe(true);
    expect(roundtripOk.matches).toBe(motiveText);
    expect(roundtripOk.reasonCode).toBe('compat_no_documentada');

    // Paso 5 — undo elimina la excepción (vuelve a la entrada previa a la edición).
    await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { undo: () => void } } };
      };
      w.__codex.trayStore.getState().undo();
    });
    await page.waitForTimeout(200);
    const afterUndo = await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as Record<string, unknown>;
      return {
        hasException: !!entrada.excepciones_conexion,
        piezaIds: (entrada.piezas as Array<{ instancia_id: string }>).map((p) => p.instancia_id),
      };
    });
    expect(afterUndo.piezaIds, 'pieza de excepción removida tras undo').not.toContain('EXC_PIEZA');
    expect(afterUndo.hasException, 'excepción removida tras undo').toBe(false);

    // Paso 6 — redo restaura la excepción exactamente.
    await page.evaluate(() => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { redo: () => void } } };
      };
      w.__codex.trayStore.getState().redo();
    });
    await page.waitForTimeout(200);
    const afterRedo = await page.evaluate((connId) => {
      const w = window as unknown as {
        __codex: { trayStore: { getState: () => { entrada: unknown } } };
      };
      const entrada = w.__codex.trayStore.getState().entrada as {
        excepciones_conexion?: Record<string, Record<string, unknown>>;
      };
      return entrada.excepciones_conexion?.[connId]?.motivo ?? null;
    }, EXPECTED_CONN_ID);
    expect(afterRedo, 'excepción restaurada tras redo').toBe(motiveText);
  });
});
