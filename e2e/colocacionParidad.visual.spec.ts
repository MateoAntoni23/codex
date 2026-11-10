/**
 * E2E hito 2 — paridad preview ↔ confirmado (PA1, PA3).
 *
 * PA1: reproduce el defecto de lateralidad de b5c444a. El preview de un accesorio
 * usaba mano 'native' y la confirmación chiralityForTurn(turnDirection) con
 * turnDirection inicial 'left' (= espejo): la T se veía con la derivación de un
 * lado y quedaba confirmada del otro.
 *
 * La comparación se hace en el MUNDO (vértices de la malla transformados por su
 * matrixWorld), así la misma prueba corre contra el código viejo y el nuevo.
 * Gestos reales: herramienta Tramo nuevo, lista de extremos libres, selector de
 * producto, boca de entrada y Confirmar continuación.
 */
import { test, expect, type Page } from '@playwright/test';

async function openBandejas(page: Page): Promise<void> {
  await page.goto('/?etapa=bandejas');
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
}

const pieceIds = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ instancia_id: string; producto_id: string }> } } } } }).__codex.trayStore.getState().entrada.piezas);

async function newStraight(page: Page, productoId: string): Promise<void> {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await pieceIds(page)).map((p) => p.producto_id)).toContain(productoId);
}

/** Vértices en mundo (viewer, m) de la malla con userData.codex que cumpla `match`. */
async function worldVerts(page: Page, kind: string, key: { sku?: string; instanciaId?: string }): Promise<number[][] | null> {
  return page.evaluate(({ kind, key }) => {
    const w = window as unknown as { __codex: { scene: { traverse: (f: (o: unknown) => void) => void } } };
    let out: number[][] | null = null;
    w.__codex.scene.traverse((obj) => {
      const o = obj as {
        userData?: { codex?: { kind?: string; sku?: string; instanciaId?: string } };
        isMesh?: boolean;
        updateMatrixWorld?: (f: boolean) => void;
        matrixWorld?: { elements: number[] };
        geometry?: { attributes?: { position?: { count: number; array: ArrayLike<number> } } };
      };
      const cx = o.userData?.codex;
      if (!cx || cx.kind !== kind || !o.isMesh) return;
      if (key.sku && cx.sku !== key.sku) return;
      if (key.instanciaId && cx.instanciaId !== key.instanciaId) return;
      o.updateMatrixWorld?.(true);
      const m = o.matrixWorld!.elements;
      const pos = o.geometry!.attributes!.position!;
      const pts: number[][] = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
        pts.push([
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
      }
      out = pts;
    });
    return out;
  }, { kind, key });
}

/** matrixWorld de la malla (visor). */
async function meshMatrix(page: Page, kind: string, key: { sku?: string; instanciaId?: string }): Promise<number[] | null> {
  return page.evaluate(({ kind, key }) => {
    const w = window as unknown as { __codex: { scene: { traverse: (f: (o: unknown) => void) => void } } };
    let out: number[] | null = null;
    w.__codex.scene.traverse((obj) => {
      const o = obj as { userData?: { codex?: { kind?: string; sku?: string; instanciaId?: string } }; isMesh?: boolean; updateMatrixWorld?: (f: boolean) => void; matrixWorld?: { elements: number[] } };
      const cx = o.userData?.codex;
      if (!cx || cx.kind !== kind || !o.isMesh) return;
      if (key.sku && cx.sku !== key.sku) return;
      if (key.instanciaId && cx.instanciaId !== key.instanciaId) return;
      o.updateMatrixWorld?.(true);
      out = [...o.matrixWorld!.elements];
    });
    return out;
  }, { kind, key });
}

function bbox(pts: number[][]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  return { min, max };
}

/** Distancia máxima de cada vértice de A al vértice más cercano de B (m). */
function hausdorff(a: number[][], b: number[][]): number {
  const d1 = (P: number[][], Q: number[][]) => Math.max(...P.map((p) => Math.min(...Q.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])))));
  return Math.max(d1(a, b), d1(b, a));
}

async function previewThenConfirm(page: Page, opts: {
  freeEnd: RegExp; productoId: string; sku: string; entryPort?: string; side?: 'left' | 'right'; motive?: string;
}): Promise<{ preview: number[][]; confirmed: number[][]; previewMatrix: number[]; confirmedMatrix: number[] }> {
  const before = (await pieceIds(page)).map((p) => p.instancia_id);
  await page.getByTestId('free-end').filter({ hasText: opts.freeEnd }).first().click();
  const select = page.locator('[data-codex-routing-product-select]');
  await expect(select).toBeVisible();
  await select.selectOption(opts.productoId);
  if (opts.entryPort) await page.locator(`[data-codex-routing-entry-port="${opts.entryPort}"]`).click();
  if (opts.side) await page.locator(`[data-codex-routing-hand="${opts.side}"]`).click();
  const motive = page.locator('[data-codex-routing-exception-motive]');
  if (await motive.count()) await motive.fill(opts.motive ?? 'E2E paridad');
  let preview: number[][] | null = null;
  await expect.poll(async () => { preview = await worldVerts(page, 'parametric-preview', { sku: opts.sku }); return preview !== null; }).toBe(true);
  // Dejar asentar el preview (cambios de boca/lado) y tomar su matriz justo antes de confirmar.
  await page.waitForTimeout(200);
  preview = await worldVerts(page, 'parametric-preview', { sku: opts.sku });
  const previewMatrix = await meshMatrix(page, 'parametric-preview', { sku: opts.sku });
  await page.locator('text=Confirmar continuación').click();
  let newId = '';
  await expect.poll(async () => {
    const ids = (await pieceIds(page)).map((p) => p.instancia_id);
    newId = ids.find((i) => !before.includes(i)) ?? '';
    return newId;
  }).not.toBe('');
  let confirmed: number[][] | null = null;
  await expect.poll(async () => { confirmed = await worldVerts(page, 'parametric-confirmed', { instanciaId: newId }); return confirmed !== null; }).toBe(true);
  return { preview: preview!, confirmed: confirmed!, previewMatrix: previewMatrix!, confirmedMatrix: (await meshMatrix(page, 'parametric-confirmed', { instanciaId: newId }))! };
}

test.describe('Paridad preview ↔ confirmado', () => {
  test.setTimeout(120_000);

  test('PA1 — una T confirmada queda con la derivación del mismo lado que el preview', async ({ page }) => {
    await openBandejas(page);
    await newStraight(page, 'SAM_TRPS-300-22-Z');
    const { preview, confirmed } = await previewThenConfirm(page, {
      freeEnd: /Boca x_max/, productoId: 'SAM_TPS-300-Z', sku: 'TPS-300-Z', entryPort: 'tronco_P1',
    });
    const bp = bbox(preview);
    const bc = bbox(confirmed);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(bp.min[i] - bc.min[i]), `bbox min[${i}] preview ${bp.min[i]} vs confirmado ${bc.min[i]}`).toBeLessThan(0.001);
      expect(Math.abs(bp.max[i] - bc.max[i]), `bbox max[${i}] preview ${bp.max[i]} vs confirmado ${bc.max[i]}`).toBeLessThan(0.001);
    }
    expect(hausdorff(preview, confirmed)).toBeLessThan(0.001);
  });

  // PA3: paridad con gestos reales para cada clase de pieza. La matriz de la malla
  // confirmada es la del preview (y los vértices en el mundo coinciden).
  const CASES: Array<{ name: string; productoId: string; sku: string; entryPort?: string; side?: 'left' | 'right' }> = [
    { name: 'recto', productoId: 'SAM_TRPS-300-22-Z', sku: 'TRPS-300-22-Z' },
    { name: 'curva plana 90', productoId: 'SAM_CPS-300-90-Z', sku: 'CPS-300-90-Z', side: 'right' },
    { name: 'curva plana 45', productoId: 'SAM_CPS-300-45-Z', sku: 'CPS-300-45-Z', side: 'left' },
    { name: 'T por tronco', productoId: 'SAM_TPS-300-Z', sku: 'TPS-300-Z', entryPort: 'tronco_P1', side: 'right' },
    { name: 'T por derivación', productoId: 'SAM_TPS-300-Z', sku: 'TPS-300-Z', entryPort: 'boca_derivacion' },
    { name: 'cruz', productoId: 'SAM_XPS-300-Z', sku: 'XPS-300-Z', entryPort: 'P1_x_neg' },
    { name: 'curva ascendente', productoId: 'SAM_CUPS-300-A-Z', sku: 'CUPS-300-A-Z', entryPort: 'P1_horizontal' },
    { name: 'curva descendente', productoId: 'SAM_CUPS-300-D-Z', sku: 'CUPS-300-D-Z', entryPort: 'P1_horizontal' },
  ];
  for (const c of CASES) {
    test(`PA3 — ${c.name}: la matriz confirmada es la del preview`, async ({ page }) => {
      await openBandejas(page);
      await newStraight(page, 'SAM_TRPS-300-22-Z');
      const r = await previewThenConfirm(page, { freeEnd: /Boca x_max/, productoId: c.productoId, sku: c.sku, entryPort: c.entryPort, side: c.side });
      const diff = Math.max(...r.previewMatrix.map((v, i) => Math.abs(v - r.confirmedMatrix[i])));
      expect(diff, `matriz preview vs confirmada (${c.name})`).toBeLessThan(1e-9);
      expect(hausdorff(r.preview, r.confirmed)).toBeLessThan(1e-6);
    });
  }
});
