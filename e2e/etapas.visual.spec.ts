/**
 * E2E hito 1b — Interfaz por etapas de trabajo (B1–B7).
 *
 * Todo el contenido se crea con gestos reales (pestañas de etapa, herramientas,
 * listas, asistente de Excel, clics en la escena). `window.__codex` sólo se usa
 * para LEER estado y para proyectar coordenadas de la escena a píxeles.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, 'output');
const EXCEL = resolve(__dirname, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const USER_REPORT = resolve(__dirname, 'fixtures/user-report-20261107.workspace.json');

type StageId = 'equipos' | 'planta' | 'bandejas' | 'conexiones' | 'resultados';
const STAGES: StageId[] = ['equipos', 'planta', 'bandejas', 'conexiones', 'resultados'];

/** Marcas propias de cada etapa (listas, herramientas, controles). */
const OWN: Record<StageId, string[]> = {
  equipos: ['panel-equipos', 'tools-equipos', 'equipment-list', 'open-import-wizard', 'new-equipment'],
  planta: ['panel-planta', 'planta-list', 'layer-infrastructure'],
  bandejas: ['panel-bandejas', 'tools-bandejas', 'piece-list', 'free-ends', 'joins', 'supports', 'pe'],
  conexiones: ['panel-conexiones', 'catalog-connections', 'circuits'],
  resultados: ['panel-resultados', 'engine-state', 'engine-reconnect', 'calculate-tray', 'reserva-input'],
};

async function openApp(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.getByTestId('stage-bar').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene), undefined, { timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

async function goStage(page: Page, s: StageId): Promise<void> {
  await page.getByTestId(`stage-tab-${s}`).click();
  await expect(page.getByTestId(`stage-tab-${s}`)).toHaveAttribute('aria-selected', 'true');
}

async function stage(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __codex: { uiStore: { getState: () => { stage: string } } } }).__codex.uiStore.getState().stage);
}

/** Clic que además verifica que el control pertenece a la etapa activa o a las barras comunes. */
async function clickOwn(page: Page, s: StageId, loc: Locator): Promise<void> {
  const inside = await loc.evaluate((el, st) => Boolean(
    el.closest(`[data-testid="panel-${st}"]`) ||
    el.closest(`[data-testid="inspector-${st}"]`) ||
    el.closest('[data-testid="project-bar"]') ||
    el.closest('[data-testid="stage-bar"]') ||
    el.closest('.import-wizard'),
  ), s);
  expect(inside, `control fuera de la etapa ${s}`).toBe(true);
  await loc.click();
}

async function project(page: Page, world: [number, number, number]): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.unified-workspace-canvas canvas').boundingBox())!;
  const ndc = await page.evaluate((w) => {
    const c = (window as unknown as { __codex: { camera: { updateMatrixWorld: () => void; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } } } }).__codex.camera;
    c.updateMatrixWorld();
    const mul = (p: number[], e: number[]) => [
      e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12] * p[3],
      e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13] * p[3],
      e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14] * p[3],
      e[3] * p[0] + e[7] * p[1] + e[11] * p[2] + e[15] * p[3],
    ];
    const clip = mul(mul([w[0], w[1], w[2], 1], c.matrixWorldInverse.elements), c.projectionMatrix.elements);
    return { x: clip[0] / clip[3], y: clip[1] / clip[3] };
  }, world);
  return { x: box.x + ((ndc.x + 1) / 2) * box.width, y: box.y + ((1 - ndc.y) / 2) * box.height };
}

async function importExcel(page: Page): Promise<void> {
  await goStage(page, 'equipos');
  await clickOwn(page, 'equipos', page.getByTestId('open-import-wizard'));
  await page.locator('.import-wizard input[type="file"]').setInputFiles(EXCEL);
  await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 20_000 });
  await page.locator('.import-wizard-footer button.primary').click();
  await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 10_000 });
  await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();
}

async function placeByList(page: Page, tag: string): Promise<string> {
  await page.getByTestId('equipment-search').fill(tag);
  await clickOwn(page, 'equipos', page.locator('.imported-tree-item', { hasText: tag }).first());
  await clickOwn(page, 'equipos', page.getByTestId('tool-equipos-ubicar'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { selectedEquipId: string | null } } } }).__codex.workspaceStore.getState().selectedEquipId)).not.toBeNull();
  await page.getByTestId('equipment-search').fill('');
  return page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { selectedEquipId: string } } } }).__codex.workspaceStore.getState().selectedEquipId);
}

async function newStraight(page: Page): Promise<void> {
  await goStage(page, 'bandejas');
  await clickOwn(page, 'bandejas', page.getByTestId('tool-bandejas-tramo'));
  await clickOwn(page, 'bandejas', page.getByRole('button', { name: 'Crear tramo' }));
}

async function continueFromFreeEnd(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length);
  await clickOwn(page, 'bandejas', page.getByTestId('free-end').first());
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  // Un recto compatible con modelo (◆ … mm × … mm ala), no una excepción.
  const first = await select.evaluate((el) => Array.from((el as HTMLSelectElement).options).find((o) => o.value && /^◆ .*mm × .*ala/.test(o.textContent ?? ''))?.value ?? '');
  expect(first, 'hay un recto compatible para continuar').not.toBe('');
  await select.selectOption(first);
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill('E2E hito 1b');
  await clickOwn(page, 'bandejas', page.locator('text=Confirmar continuación'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length)).toBe(before + 1);
}

/** Contraste WCAG de cada texto visible dentro de los paneles (excluye controles deshabilitados). */
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element | null): number[] => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0.5) return c;
      }
      return [255, 255, 255, 1];
    };
    const out: string[] = [];
    const panels = Array.from(document.querySelectorAll('.ws-panel'));
    for (const panel of panels) {
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? '').trim();
        if (!text) continue;
        const el = n.parentElement!;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest('button:disabled, [disabled], option, [aria-hidden="true"]')) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        const fg = parse(st.color);
        if (!fg) continue;
        const bg = bgOf(el);
        const L1 = lum(fg), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(st.fontSize);
        const bold = Number(st.fontWeight) >= 700;
        const min = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        if (ratio < min) out.push(`${ratio.toFixed(2)} «${text.slice(0, 40)}» ${st.color} / rgb(${bg.slice(0, 3).join(',')})`);
      }
    }
    return out;
  });
}

test.describe('Hito 1b — interfaz por etapas', () => {
  test.setTimeout(240_000);

  test('B1 — cada etapa muestra sólo su lista, sus herramientas y su inspector', async ({ page }) => {
    await openApp(page, '/');
    // Contenido real en todas las etapas: Excel (equipos y conexiones) + un tramo.
    await importExcel(page);
    await newStraight(page);
    for (const s of STAGES) {
      await goStage(page, s);
      await expect(page.getByTestId(`inspector-${s}`)).toBeVisible();
      for (const id of OWN[s]) await expect(page.getByTestId(id), `${s}: falta ${id}`).toBeVisible();
      for (const other of STAGES.filter((o) => o !== s)) {
        await expect(page.getByTestId(`inspector-${other}`)).toHaveCount(0);
        for (const id of OWN[other]) await expect(page.getByTestId(id), `${s}: aparece ${id} de ${other}`).toHaveCount(0);
      }
      // La escena es común a todas las etapas.
      await expect(page.locator('.unified-workspace-canvas canvas')).toBeVisible();
      // La guía de trabajo y la leyenda fijas ya no existen.
      await expect(page.getByText('Guía de trabajo')).toHaveCount(0);
    }
  });

  test('B2 — recorrido completo sin pasar por controles ajenos', async ({ page }) => {
    await openApp(page, '/');
    await importExcel(page);
    const motorId = await placeByList(page, 'S1-SOP101');
    expect(motorId).toBeTruthy();
    await newStraight(page);
    await continueFromFreeEnd(page);
    await goStage(page, 'resultados');
    await clickOwn(page, 'resultados', page.getByTestId('reserva-input'));
    await page.getByTestId('reserva-input').fill('20');
    await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
    await clickOwn(page, 'resultados', page.getByTestId('calculate-tray'));
    await expect(page.getByTestId('result-headline')).toBeVisible({ timeout: 30_000 });
    const st = await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { status: string; entrada: { piezas: unknown[]; conexiones: unknown[] } } } } }).__codex.trayStore.getState());
    expect(st.status).toBe('vigente');
    expect(st.entrada.piezas).toHaveLength(2);
    expect(st.entrada.conexiones).toHaveLength(1);
  });

  test('B3/B4 — escena ↔ lista: equipo con grupo plegado y lista desplazada; pieza', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 760 });
    await openApp(page, '/');
    await importExcel(page);
    const motorId = await placeByList(page, 'S1-SOP101');

    // B4: clic en la lista → marcado en la escena (emisivo de selección).
    await page.keyboard.press('Escape');
    await clickOwn(page, 'equipos', page.locator('.imported-tree-item', { hasText: 'S1-SOP101' }).first());
    const selectedEmissive = () => page.evaluate((id) => {
      const w = window as unknown as { __codex: { workspaceStore: { getState: () => { selectedEquipId: string | null } }; scene: { traverse: (f: (o: unknown) => void) => void } } };
      let n = 0;
      w.__codex.scene.traverse((o) => {
        const m = o as { isMesh?: boolean; material?: { emissiveIntensity?: number; emissive?: { getHexString: () => string } } };
        if (m.isMesh && m.material?.emissiveIntensity === 2 && m.material.emissive?.getHexString() === '223366') n++;
      });
      return { sel: w.__codex.workspaceStore.getState().selectedEquipId === id, n };
    }, motorId);
    await expect.poll(selectedEmissive).toEqual({ sel: true, n: 1 });

    // B3: deseleccionar, plegar el grupo del motor y desplazar la lista lejos de él.
    await page.keyboard.press('Escape');
    const group = page.getByTestId('equipment-group-motor');
    await group.locator('summary').click();
    await expect(group).not.toHaveAttribute('open', '');
    await page.locator('.unified-workspace-tree').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const row = page.locator('[data-row-key^="imp:"]', { hasText: 'S1-SOP101' });
    await expect(row).toHaveCount(0); // grupo plegado: la fila no está montada

    // Clic en el equipo en la escena.
    const pos = await page.evaluate((id) => {
      const w = window as unknown as { __codex: { workspaceStore: { getState: () => { elements: Array<{ id: string; transform: { positionMm: { x: number; y: number; z: number } } | null }> } } } };
      const el = w.__codex.workspaceStore.getState().elements.find((e) => e.id === id)!;
      const p = el.transform!.positionMm;
      return [p.x / 1000, p.z / 1000, -p.y / 1000] as [number, number, number];
    }, motorId);
    const pt = await project(page, pos);
    await page.mouse.click(pt.x, pt.y);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { selectedEquipId: string | null } } } }).__codex.workspaceStore.getState().selectedEquipId)).toBe(motorId);
    await expect(group).toHaveAttribute('open', '');
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeInViewport();

    // Pieza: varias piezas, lista desplazada; clic en la escena desde otra etapa.
    await newStraight(page);
    await continueFromFreeEnd(page);
    await continueFromFreeEnd(page);
    await page.keyboard.press('Escape');
    await goStage(page, 'equipos');
    const target = await page.evaluate(() => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string; puertos: Record<string, { posicion_mm: number[] }> }> } } } } };
      const p = w.__codex.trayStore.getState().entrada.piezas[0];
      const ports = Object.values(p.puertos).map((q) => q.posicion_mm);
      const c = [0, 1, 2].map((i) => ports.reduce((a, q) => a + q[i], 0) / ports.length);
      return { id: p.instancia_id, world: [c[0] / 1000, c[2] / 1000, -c[1] / 1000] as [number, number, number] };
    });
    await page.evaluate(() => (window as unknown as { __codex: { focusTray: (o: unknown) => unknown } }).__codex.focusTray({ padding: 0.2 }));
    // La bandeja por defecto puede ser escalera (largueros + travesaños, hueca en el
    // centro): se prueba el centro y luego sobre cada larguero hasta acertar a la pieza.
    const selectedTray = () => page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { selectedTrayId: string | null } } } }).__codex.workspaceStore.getState().selectedTrayId);
    for (const [dy, dz] of [[0, 0], [0.07, 0.03], [-0.07, 0.03], [0.14, 0.03], [-0.14, 0.03]]) {
      const tp = await project(page, [target.world[0], target.world[1] + dz, target.world[2] + dy]);
      await page.mouse.click(tp.x, tp.y);
      if ((await selectedTray()) === target.id) break;
      await page.keyboard.press('Escape');
      await goStage(page, 'equipos');
    }
    await expect.poll(() => stage(page)).toBe('bandejas'); // 3b: cambio automático de etapa
    const pieceRow = page.locator(`[data-row-key="piece:${target.id}"]`);
    await expect(pieceRow).toHaveAttribute('aria-current', 'true');
    await expect(pieceRow).toBeInViewport();
    await expect(page.getByTestId('piece-title')).toBeVisible();

    // B4 pieza: clic en la lista → color de selección en la escena.
    const other = await page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string }> } } } } }).__codex.trayStore.getState().entrada.piezas[1].instancia_id);
    await clickOwn(page, 'bandejas', page.locator(`[data-row-key="piece:${other}"]`));
    await expect.poll(() => page.evaluate((id) => {
      let ok = false;
      (window as unknown as { __codex: { scene: { traverse: (f: (o: unknown) => void) => void } } }).__codex.scene.traverse((o) => {
        const m = o as { userData?: { codex?: { instanciaId?: string } }; material?: { color?: { getHexString: () => string } } };
        if (m.userData?.codex?.instanciaId === id && m.material?.color?.getHexString() === 'ffcf33') ok = true;
      });
      return ok;
    }, other)).toBe(true);
  });

  test('B5 — tema: cambia, persiste al recargar, no altera el archivo; contraste AA', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    await openApp(page, '/');
    await page.evaluate(() => localStorage.removeItem('codex:ui:theme'));
    await page.reload();
    await page.getByTestId('stage-bar').waitFor();
    await expect(page.getByTestId('workspace-root')).toHaveAttribute('data-theme', 'dark'); // oscuro por defecto
    await importExcel(page);
    await newStraight(page);

    const save = async (name: string) => {
      const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save-copy').click()]);
      const p = resolve(OUT_DIR, `${name}-${Date.now()}.json`);
      await d.saveAs(p);
      const j = JSON.parse(readFileSync(p, 'utf8'));
      delete j.exportedAt;
      return j;
    };
    const before = await save('b5-oscuro');

    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light') {
        await page.getByTestId('theme-toggle').click();
        await expect(page.getByTestId('workspace-root')).toHaveAttribute('data-theme', 'light');
      }
      for (const s of STAGES) {
        await goStage(page, s);
        const fails = await contrastFailures(page);
        expect(fails, `contraste ${theme}/${s}`).toEqual([]);
      }
    }
    // La escena conserva su fondo en ambos temas (no la toca el tema).
    const sceneBg = await page.locator('.unified-workspace-canvas').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(sceneBg).not.toBe('rgb(255, 255, 255)');

    await page.reload();
    await page.getByTestId('stage-bar').waitFor();
    await expect(page.getByTestId('workspace-root')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('codex:ui:theme'))).toBe('light');
    const after = await save('b5-claro');
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('codex:ui:theme');
    expect(Object.keys(after)).not.toContain('theme');
  });

  test('B6 — proyecto sin PE: Resultados dice "PE sin definir", no incumplimiento', async ({ page }) => {
    await openApp(page, '/');
    await newStraight(page);
    await goStage(page, 'resultados');
    await page.getByTestId('reserva-input').fill('20');
    await expect(page.getByTestId('engine-state')).toHaveAttribute('data-engine', 'conectado', { timeout: 20_000 });
    await page.getByTestId('calculate-tray').click();
    const headline = page.getByTestId('result-headline');
    await expect(headline).toHaveText('PE sin definir', { timeout: 30_000 });
    await expect(headline).toHaveAttribute('data-tone', 'neutral');
    await expect(page.getByTestId('result-pe-note')).toBeVisible();
    await expect(page.getByTestId('result-issues')).toHaveCount(0);
    const visible = await page.getByTestId('panel-resultados').innerText();
    expect(visible).not.toMatch(/incumplimiento/i);
    expect(await page.getByTestId('stage-status-resultados').innerText()).toBe('PE sin definir');
  });

  test('B7 — las acciones de prueba no aparecen en uso normal; con ?dev=1 sí', async ({ page }) => {
    const ids = ['load-test-scenario', 'load-cups-chains', 'load-motor-example', 'load-demo-equipment'];
    await openApp(page, '/');
    await expect(page.getByTestId('dev-menu')).toHaveCount(0);
    for (const s of STAGES) {
      await goStage(page, s);
      for (const id of ids) await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await openApp(page, '/?dev=1');
    await page.getByTestId('dev-menu').locator('summary').click();
    for (const id of ids) await expect(page.getByTestId(id)).toBeVisible();
    await page.getByTestId('load-demo-equipment').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { elements: unknown[] } } } }).__codex.workspaceStore.getState().elements.length)).toBeGreaterThan(0);
  });

  test('3d — sin identificadores internos en listas de piezas y uniones', async ({ page }) => {
    await openApp(page, '/');
    await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: unknown[] } } } } }).__codex.trayStore.getState().entrada.piezas.length)).toBe(7);
    await goStage(page, 'bandejas');
    const pieces = await page.getByTestId('piece-list').innerText();
    // Los ids de instancia del archivo (R1, T1, CS1…) no aparecen solos; sí los SKU.
    expect(pieces).toMatch(/\d\. [A-Z]+-\d+/);
    expect(pieces).not.toMatch(/\bSAM_/);
    expect(pieces).not.toMatch(/^R1$|\bR1 ·/m);
  });
});
