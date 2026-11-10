/**
 * E2E hito 2 — PA7: unir a mano dos extremos que no coinciden informa hueco,
 * ángulo y giro, no mueve piezas y no crea la unión sin confirmación.
 * Gestos reales: herramienta Tramo nuevo (coordenadas), "Unir extremos" y clic en
 * las bocas (esferas) de la escena.
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

async function straightAt(page: Page, p1: number[], p2: number[]): Promise<void> {
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption('SAM_TRPS-300-22-Z');
  const f1 = page.locator('fieldset', { hasText: 'P1 — extremo de referencia' }).locator('input');
  const f2 = page.locator('fieldset', { hasText: 'P2 — extremo opuesto' }).locator('input');
  for (let i = 0; i < 3; i++) { await f1.nth(i).fill(String(p1[i])); await f2.nth(i).fill(String(p2[i])); }
  await page.getByRole('button', { name: 'Crear tramo' }).click();
}

async function project(page: Page, mm: number[]): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.unified-workspace-canvas canvas').boundingBox())!;
  const ndc = await page.evaluate((w) => {
    const c = (window as unknown as { __codex: { camera: { updateMatrixWorld: () => void; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } } } }).__codex.camera;
    c.updateMatrixWorld();
    const mul = (p: number[], e: number[]) => [0, 1, 2, 3].map((r) => e[r] * p[0] + e[4 + r] * p[1] + e[8 + r] * p[2] + e[12 + r] * p[3]);
    const clip = mul(mul([w[0], w[1], w[2], 1], c.matrixWorldInverse.elements), c.projectionMatrix.elements);
    return { x: clip[0] / clip[3], y: clip[1] / clip[3] };
  }, [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000]);
  return { x: box.x + ((ndc.x + 1) / 2) * box.width, y: box.y + ((1 - ndc.y) / 2) * box.height };
}

const tray = (page: Page) => page.evaluate(() =>
  JSON.parse(JSON.stringify((window as unknown as { __codex: { trayStore: { getState: () => { entrada: unknown } } } }).__codex.trayStore.getState().entrada)) as {
    piezas: Array<{ instancia_id: string; puertos: Record<string, { posicion_mm: number[] }> }>;
    conexiones: unknown[];
  });

test('PA7 — unir extremos que no coinciden: informa hueco, ángulo y giro; sin confirmación no une', async ({ page }) => {
  test.setTimeout(120_000);
  await openBandejas(page);
  // Dos rectos: el segundo empieza 250 mm después del primero y girado 3° (las esferas
  // de boca miden 160 mm: con menos separación se superponen y el clic cae en la otra).
  await straightAt(page, [0, 0, 0], [3000, 0, 0]);
  const a = Math.PI * 3 / 180;
  await straightAt(page, [3250, 0, 0], [3250 + 3000 * Math.cos(a), 3000 * Math.sin(a), 0]);
  await expect.poll(async () => (await tray(page)).piezas.length).toBe(2);
  const before = await tray(page);
  await page.evaluate(() => (window as unknown as { __codex: { focusTray: (o: unknown) => unknown } }).__codex.focusTray({ padding: 0.3 }));

  await page.getByTestId('tool-bandejas-unir').click();
  const clickPort = async (pid: string, port: string) => {
    const pos = (await tray(page)).piezas.find((p) => p.instancia_id === pid)!.puertos[port].posicion_mm;
    const pt = await project(page, pos);
    await page.mouse.click(pt.x, pt.y);
  };
  const [idA, idB] = before.piezas.map((p) => p.instancia_id);

  // 1) Sin confirmación: el diálogo informa y se cancela → no hay unión.
  let message = '';
  page.once('dialog', (d) => { message = d.message(); void d.dismiss(); });
  await clickPort(idA, 'P2');
  await clickPort(idB, 'P1');
  await expect.poll(() => message).not.toBe('');
  expect(message).toMatch(/hueco 250\.\d+ mm/);
  expect(message).toMatch(/ángulo 3\.\d+°/);
  expect(message).toMatch(/giro 0\.00°/);
  expect(message).toMatch(/NO cumple/);
  const afterCancel = await tray(page);
  expect(afterCancel.conexiones).toHaveLength(0);
  // Nunca se mueven piezas para tapar el hueco.
  expect(afterCancel.piezas.map((p) => p.puertos)).toEqual(before.piezas.map((p) => p.puertos));

  // 2) Con confirmación: se registra, queda marcada como que no cumple y las piezas siguen donde estaban.
  await page.getByTestId('tool-bandejas-unir').click();
  page.once('dialog', (d) => void d.accept());
  await clickPort(idA, 'P2');
  await clickPort(idB, 'P1');
  await expect.poll(async () => (await tray(page)).conexiones.length).toBe(1);
  expect((await tray(page)).piezas.map((p) => p.puertos)).toEqual(before.piezas.map((p) => p.puertos));
  await expect(page.getByTestId('join-row')).toHaveAttribute('data-join-ok', 'false');
  await expect(page.getByTestId('join-row')).toContainText('no cumple');
});
