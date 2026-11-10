/**
 * E2E hito 1 — "El proyecto no se pierde" (A2–A7).
 *
 * Contenido creado con gestos reales de interfaz (formulario "Agregar tramo recto",
 * asistente "Importar Excel", botón "Colocar en escena", panel "Continuar trazado",
 * controles de proyecto). `window.__codex` se usa sólo para LEER estado y para
 * preparar la biblioteca de calibración (la UI de calibración vive en otra pantalla)
 * y elegir el puerto de partida del recorrido (clic en un marcador 3D).
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'output');
const EXCEL = resolve(__dirname, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const USER_REPORT = resolve(__dirname, 'fixtures/user-report-20261107.workspace.json');
const LIB_KEY = 'codex:catalogConfig:v1';

type Json = Record<string, unknown>;

async function openApp(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene), undefined, { timeout: 20_000 });
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
}

/** Foto del proyecto (lo que A2/A3 exigen idéntico). */
async function projectSnapshot(page: Page): Promise<Json> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { entrada: Json } };
        workspaceStore: { getState: () => { elements: unknown; evidence: unknown; projectMeta: unknown; fileName: string | null; importedCatalog: unknown } };
      };
    };
    const t = w.__codex.trayStore.getState().entrada as Json;
    const ws = w.__codex.workspaceStore.getState();
    return JSON.parse(JSON.stringify({
      elements: ws.elements,
      evidence: ws.evidence,
      projectMeta: ws.projectMeta,
      importedCatalog: ws.importedCatalog,
      fileName: ws.fileName,
      piezas: t.piezas,
      conexiones: t.conexiones,
      circuitos: t.circuitos,
      soportes: t.soportes,
      pe: t.pe,
    })) as Json;
  });
}

async function addStraightByUi(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length);
  // Hito 1b: el tramo nuevo es una herramienta de la etapa Bandejas.
  await page.getByTestId('stage-tab-bandejas').click();
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length)).toBe(before + 1);
}

/** Continúa el recorrido desde P2 del primer tramo con clicks del panel (unión real). */
async function continueFromFirstStraight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __codex: {
        trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string; puertos: Record<string, { posicion_mm: number[]; direccion: number[] }> }> } } };
        routingStore: { getState: () => { deactivate: () => void; activate: () => void; selectStartPort: (p: unknown) => void } };
      };
    };
    const p = w.__codex.trayStore.getState().entrada.piezas[0];
    const rs = w.__codex.routingStore.getState();
    rs.deactivate();
    rs.activate();
    rs.selectStartPort({
      pieceId: p.instancia_id, portName: 'P2',
      pos: p.puertos.P2.posicion_mm, dir: p.puertos.P2.direccion, sectionUp: [0, 0, 1],
    });
  });
  const select = page.locator('[data-codex-routing-product-select]');
  await select.waitFor({ state: 'visible', timeout: 10_000 });
  const firstProduct = await page.evaluate(() => {
    const el = document.querySelector('[data-codex-routing-product-select]') as HTMLSelectElement;
    return Array.from(el.options).find((o) => o.value)?.value ?? '';
  });
  expect(firstProduct).not.toBe('');
  await select.selectOption(firstProduct);
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('Prueba de persistencia (E2E hito 1)');
  await page.locator('text=Confirmar continuación').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { conexiones: unknown[] } } } } }).__codex.trayStore.getState().entrada.conexiones.length)).toBeGreaterThan(0);
}

async function importExcelAndPlaceEquipment(page: Page): Promise<void> {
  await page.getByTestId('stage-tab-equipos').click();
  await page.getByTestId('open-import-wizard').click();
  await page.locator('.import-wizard').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.import-wizard input[type="file"]').setInputFiles(EXCEL);
  await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 20_000 });
  await page.locator('.import-wizard-footer button.primary').click();
  await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 10_000 });
  await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();
  const tree = page.locator('.imported-tree-section');
  await tree.locator('input[type="text"]').fill('S1-SOP101');
  await tree.locator('.imported-tree-item', { hasText: 'S1-SOP101' }).first().click();
  await page.getByTestId('imported-place').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { elements: unknown[] } } } }).__codex.workspaceStore.getState().elements.length)).toBeGreaterThan(0);
}

async function saveCopy(page: Page, name: string): Promise<{ path: string; json: Json }> {
  mkdirSync(OUT_DIR, { recursive: true });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save-copy').click()]);
  const path = resolve(OUT_DIR, `${name}-${Date.now()}.json`);
  await download.saveAs(path);
  return { path, json: JSON.parse(readFileSync(path, 'utf8')) as Json };
}

async function openFile(page: Page, path: string): Promise<void> {
  await page.getByTestId('project-open-input').setInputFiles(path);
}

const SAMPLE_OVERRIDE = {
  'SAM_TPS-300-Z': {
    productId: 'SAM_TPS-300-Z',
    source: 'override',
    overrideReason: 'Calibración E2E hito 1',
    overrideAt: '2026-11-10T10:00:00Z',
    entries: [{ recipePortName: 'tronco_P1', catalogPortName: 'P3', physicalLabel: 'x', justification: 'y' }],
    modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 0, tx_mm: 0, ty_mm: 3, tz_mm: 0 },
  },
};
const SAMPLE_APPROVAL = { 'SAM_TPS-300-Z': { approvedAtRevision: 2, approvedAtCalibrationHash: 'h-e2e', approvedAt: '2026-11-10T11:00:00Z' } };
const SAMPLE_APORTE = { 'SAM_TPS-300-Z': { kind: 'fijo-mm', valueMm: 450 } };

async function setLibrary(page: Page, lib: { overrides: unknown; approvals: unknown; aporteOverrides: unknown }): Promise<void> {
  const ok = await page.evaluate((l) => {
    const w = window as unknown as { __codex: { catalogConfigStore: { getState: () => { replaceLibrary: (l: unknown) => boolean } } } };
    return w.__codex.catalogConfigStore.getState().replaceLibrary(l);
  }, lib);
  expect(ok).toBe(true);
}

test.describe('Hito 1 — el proyecto no se pierde', () => {
  test.setTimeout(150_000);

  test('A1b — "/" abre el espacio de trabajo vacío; el editor inicial sigue en ?legacy=v1', async ({ page }) => {
    await openApp(page, '/');
    const snap = await projectSnapshot(page);
    expect(snap.elements).toEqual([]);
    expect(snap.piezas).toEqual([]);
    await expect(page.getByTestId('project-controls')).toBeVisible();
    // El editor inicial no es el producto, pero sigue accesible.
    await page.goto('/?legacy=v1');
    await expect(page.locator('.unified-workspace')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty();
    // El enlace histórico del espacio de trabajo también sigue funcionando.
    await openApp(page, '/?workspace=bandejas');
    await expect(page.getByTestId('project-controls')).toBeVisible();
  });

  test('A2 — tramo + unión + equipo + nombre de archivo sobreviven a recargar la página', async ({ page }) => {
    await openApp(page);
    await addStraightByUi(page);
    await continueFromFirstStraight(page);
    await importExcelAndPlaceEquipment(page);
    const saved = await saveCopy(page, 'a2'); // fija el nombre de archivo del proyecto
    expect(saved.json.fileVersion).toBe(2);
    await waitSaved(page);

    const before = await projectSnapshot(page);
    expect((before.piezas as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((before.conexiones as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((before.elements as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(before.fileName).toMatch(/^workspace-.*\.json$/);

    await page.reload();
    await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene), undefined, { timeout: 20_000 });

    const after = await projectSnapshot(page);
    expect(after).toEqual(before); // piezas, uniones, equipos, evidencia, catálogo importado y archivo
    // Y la barra de proyecto lo muestra (hito 1b: el nombre vive en la barra de proyecto).
    await expect(page.getByTestId('project-name')).toContainText(String(before.fileName).replace(/\.json$/, ''));
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved');
    // Restaurar no marca "cambios sin copia en archivo".
    await expect(page.locator('.workspace-dirty')).toHaveCount(0);
  });

  test('A3 — fixture v1: abrir → guardar copia → abrir de nuevo = idéntico', async ({ page }) => {
    await openApp(page);
    await openFile(page, USER_REPORT);
    await expect.poll(async () => ((await projectSnapshot(page)).piezas as unknown[]).length).toBe(7);
    const first = await projectSnapshot(page);
    const original = JSON.parse(readFileSync(USER_REPORT, 'utf8')) as { projectV2: { elements: Json[]; evidence: unknown[] }; trayInput: Json };

    // Contra el ORIGINAL: el validador sólo normaliza `importedRef: null` en equipos que no lo traían.
    const strip = (els: Json[]) => els.map((e) => { const { importedRef, ...r } = e; return importedRef == null ? r : e; });
    expect(strip(first.elements as Json[])).toEqual(strip(original.projectV2.elements));
    expect(first.evidence).toEqual(original.projectV2.evidence);
    expect(first.piezas).toEqual(original.trayInput.piezas);
    expect(first.conexiones).toEqual(original.trayInput.conexiones);
    expect(first.circuitos).toEqual(original.trayInput.circuitos);
    expect(first.soportes).toEqual(original.trayInput.soportes);
    expect((first.elements as unknown[]).length).toBe(9);
    expect((first.evidence as unknown[]).length).toBe(4);
    expect((first.conexiones as unknown[]).length).toBe(6);
    expect((first.circuitos as unknown[]).length).toBe(2);
    expect((first.soportes as unknown[]).length).toBe(9);

    page.on('dialog', (d) => void d.accept());
    const copy = await saveCopy(page, 'a3');
    await page.getByTestId('project-new').click();
    await expect.poll(async () => ((await projectSnapshot(page)).piezas as unknown[]).length).toBe(0);
    await openFile(page, copy.path);
    await expect.poll(async () => ((await projectSnapshot(page)).piezas as unknown[]).length).toBe(7);
    const second = await projectSnapshot(page);
    // fileName es el de la copia abierta; todo lo demás, idéntico.
    const { fileName: f1, ...rest1 } = first;
    const { fileName: f2, ...rest2 } = second;
    expect(f1).toBe('user-report-20261107.workspace.json');
    expect(String(f2)).toMatch(/^a3-\d+\.json$/);
    expect(rest2).toEqual(rest1);
  });

  test('A4 — la copia lleva overrides + approvals + aporteOverrides; vaciar y adoptar los restaura', async ({ page }) => {
    await openApp(page);
    await addStraightByUi(page);
    await setLibrary(page, { overrides: SAMPLE_OVERRIDE, approvals: SAMPLE_APPROVAL, aporteOverrides: SAMPLE_APORTE });

    const copy = await saveCopy(page, 'a4');
    const lib = copy.json.library as Json;
    expect(Object.keys(lib.overrides as Json)).toEqual(['SAM_TPS-300-Z']);
    expect(Object.keys(lib.approvals as Json)).toEqual(['SAM_TPS-300-Z']);
    expect(Object.keys(lib.aporteOverrides as Json)).toEqual(['SAM_TPS-300-Z']);

    // Vaciar la biblioteca y abrir el archivo → aviso → adoptar.
    await setLibrary(page, { overrides: {}, approvals: {}, aporteOverrides: {} });
    page.on('dialog', (d) => void d.accept());
    await openFile(page, copy.path);
    const dialog = page.getByTestId('library-conflict');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('library-keep-local')).toBeFocused(); // el valor por defecto es seguir con la local
    await page.getByTestId('library-adopt').click();
    await expect(dialog).toHaveCount(0);

    const restored = await page.evaluate(([key]) => {
      const w = window as unknown as { __codex: { catalogConfigStore: { getState: () => { overrides: Json; approvals: Json; aporteOverrides: Json } } } };
      const s = w.__codex.catalogConfigStore.getState();
      return {
        mem: { overrides: Object.keys(s.overrides), approvals: Object.keys(s.approvals), aporte: Object.keys(s.aporteOverrides) },
        ls: JSON.parse(localStorage.getItem(key) ?? 'null'),
        backups: Object.keys(localStorage).filter((k) => k.startsWith(`${key}:backup:`)),
      };
    }, [LIB_KEY]);
    expect(restored.mem).toEqual({ overrides: ['SAM_TPS-300-Z'], approvals: ['SAM_TPS-300-Z'], aporte: ['SAM_TPS-300-Z'] });
    expect(Object.keys(restored.ls.overrides)).toEqual(['SAM_TPS-300-Z']);
    expect(Object.keys(restored.ls.approvals)).toEqual(['SAM_TPS-300-Z']);
    expect(Object.keys(restored.ls.aporteOverrides)).toEqual(['SAM_TPS-300-Z']);
    expect(restored.backups).toHaveLength(1); // copia de la biblioteca anterior (vacía)
  });

  test('A4b — "seguir con la local" (por defecto) y "cancelar" no tocan la biblioteca', async ({ page }) => {
    await openApp(page);
    await setLibrary(page, { overrides: SAMPLE_OVERRIDE, approvals: SAMPLE_APPROVAL, aporteOverrides: SAMPLE_APORTE });
    const copy = await saveCopy(page, 'a4b');
    await setLibrary(page, { overrides: {}, approvals: {}, aporteOverrides: {} });
    const raw = await page.evaluate((k) => localStorage.getItem(k), LIB_KEY);
    page.on('dialog', (d) => void d.accept());

    await openFile(page, copy.path);
    await page.getByTestId('library-keep-local').click();
    expect(await page.evaluate((k) => localStorage.getItem(k), LIB_KEY)).toBe(raw);

    await addStraightByUi(page);
    const projectBefore = await projectSnapshot(page);
    await openFile(page, copy.path);
    await page.getByTestId('library-cancel').click();
    expect(await page.evaluate((k) => localStorage.getItem(k), LIB_KEY)).toBe(raw);
    expect(await projectSnapshot(page)).toEqual(projectBefore); // cancelar tampoco cambia el proyecto
  });

  test('A5 — un archivo sin bloque de biblioteca deja codex:catalogConfig:v1 byte a byte igual', async ({ page }) => {
    await openApp(page);
    await setLibrary(page, { overrides: SAMPLE_OVERRIDE, approvals: SAMPLE_APPROVAL, aporteOverrides: SAMPLE_APORTE });
    const raw = await page.evaluate((k) => localStorage.getItem(k), LIB_KEY);
    expect(raw).not.toBeNull();
    page.on('dialog', (d) => void d.accept());
    await openFile(page, USER_REPORT); // fileVersion 1, sin catalogConfig
    await expect.poll(async () => ((await projectSnapshot(page)).piezas as unknown[]).length).toBe(7);
    await expect(page.getByTestId('library-conflict')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), LIB_KEY)).toBe(raw);
    // Y tras recargar la página sigue igual (no se reescribe al hidratar).
    await page.reload();
    await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), LIB_KEY)).toBe(raw);
  });

  test('A6 — los datos del editor inicial en IndexedDB quedan intactos', async ({ page }) => {
    // 1) El editor inicial crea/lee su base.
    await page.goto('/?legacy=v1');
    await page.waitForFunction(() => document.querySelector('#root')?.children.length, undefined, { timeout: 20_000 });
    await page.waitForTimeout(1500); // su inicialización/persistencia asíncrona
    const dump = (name: string) => page.evaluate(async (dbName) => {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === dbName)) return null;
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const out: Record<string, unknown> = { version: db.version };
      for (const store of Array.from(db.objectStoreNames)) {
        out[store] = await new Promise((res) => {
          const tx = db.transaction(store);
          const os = tx.objectStore(store);
          const keys = os.getAllKeys();
          const vals = os.getAll();
          tx.oncomplete = () => res({ keys: keys.result, values: vals.result });
        });
      }
      db.close();
      return JSON.parse(JSON.stringify(out));
    }, name);
    const legacyBefore = await dump('codex-cable-tray-v1');
    expect(legacyBefore, 'el editor inicial creó su base').not.toBeNull();

    // 2) Se usa el espacio de trabajo (misma origen) y se autoguarda.
    await openApp(page);
    await addStraightByUi(page);
    await waitSaved(page);
    const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
    expect(names).toContain('codex-workspace-v1');
    expect(names).toContain('codex-cable-tray-v1');

    // 3) La base del editor inicial es exactamente la misma.
    const legacyAfter = await dump('codex-cable-tray-v1');
    expect(legacyAfter).toEqual(legacyBefore);
    // …y el proyecto del espacio de trabajo NO está en la base del editor inicial.
    expect(JSON.stringify(legacyAfter)).not.toContain('codex:workspaceProject/1');
    const ws = (await dump('codex-workspace-v1')) as Record<string, { keys: string[] }>;
    expect(ws.project.keys).toContain('current');
  });

  test('A7 — un fallo de escritura en IndexedDB muestra error y no altera el estado en memoria', async ({ page }) => {
    await openApp(page);
    await addStraightByUi(page);
    await waitSaved(page);

    // La próxima escritura falla (cuota llena).
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype as unknown as { put: (...a: unknown[]) => unknown; __origPut?: (...a: unknown[]) => unknown };
      proto.__origPut = proto.put;
      proto.put = function () { throw new DOMException('cuota llena (E2E)', 'QuotaExceededError'); };
    });
    await addStraightByUi(page); // cambia el estado en memoria
    const inMemory = await projectSnapshot(page);
    expect((inMemory.piezas as unknown[]).length).toBe(2);
    const indicator = page.getByTestId('project-save-status');
    await expect(indicator).toHaveAttribute('data-phase', 'error', { timeout: 10_000 });
    await expect(indicator).toContainText(/Error al guardar/);
    // La memoria no se tocó por el fallo.
    expect(await projectSnapshot(page)).toEqual(inMemory);

    // Se restablece IndexedDB y se reintenta desde el indicador.
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype as unknown as { put: unknown; __origPut?: unknown };
      proto.put = proto.__origPut;
    });
    await page.getByTestId('project-save-retry').click();
    await waitSaved(page);
    await page.reload();
    await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene), undefined, { timeout: 20_000 });
    expect(((await projectSnapshot(page)).piezas as unknown[]).length).toBe(2);
  });

  test('Nuevo pide confirmación si hay contenido, vacía el proyecto y respeta la biblioteca', async ({ page }) => {
    await openApp(page);
    await addStraightByUi(page);
    await setLibrary(page, { overrides: SAMPLE_OVERRIDE, approvals: {}, aporteOverrides: {} });
    const raw = await page.evaluate((k) => localStorage.getItem(k), LIB_KEY);
    const dialogs: string[] = [];
    page.once('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.getByTestId('project-new').click();
    expect(dialogs).toHaveLength(1);
    expect(((await projectSnapshot(page)).piezas as unknown[]).length).toBe(1); // cancelado: sigue igual
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('project-new').click();
    await expect.poll(async () => ((await projectSnapshot(page)).piezas as unknown[]).length).toBe(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), LIB_KEY)).toBe(raw);
    // Con el proyecto ya vacío no hay confirmación.
    let asked = false;
    page.once('dialog', (d) => { asked = true; void d.accept(); });
    await page.getByTestId('project-new').click();
    await page.waitForTimeout(300);
    expect(asked).toBe(false);
  });
});
