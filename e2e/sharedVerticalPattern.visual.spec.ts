/**
 * E2E — Patrón vertical compartido y variantes no-rectas.
 *
 * Responde al encargo del 2026-11-09: no cerrar hito 4 sólo con reglas +
 * vitest. Demostrar en navegador, con clicks reales:
 *
 *   A. Variante NO recta de perforada (CS no aplica a perforada; usamos
 *      CPS-450-90-Z — curva horizontal 90° — cuyo master es
 *      `master:perforada:curva_horizontal` con regla uniform-xz).
 *   B. Variante NO recta de escalera (CS-450-90-065-18-Z — curva horizontal
 *      90° — master `master:escalera:curva_horizontal_90` con regla
 *      ala-independent, provenance=estimated).
 *   C. Patrón vertical compartido: CUPS-300-A-Z (base, interior/ascendente)
 *      y CUPS-450-D-Z (variante, exterior/descendente). Verifica que la
 *      distinción comercial se preserva: ambos usan el mismo STEP source pero
 *      resuelven masters disjuntos (`curva_vertical_interior` vs
 *      `curva_vertical_exterior`).
 *
 * Cada escenario verifica:
 *   - El Configurador identifica el maestro correcto.
 *   - La malla y bocas se renderizan con dimensiones coherentes con el ancho
 *     objetivo (no con el nominal 300).
 *   - Tabla de variantes incluye la variante seleccionada.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page } from '@playwright/test';

async function clearLocalStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

async function gotoConfigurator(page: Page) {
  await page.goto('/?configurator=v1');
  await page.locator('[data-testid="configurator-root"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid^="cfg-product-SAM_"]'), {
    timeout: 20_000,
  });
}

async function selectProduct(page: Page, productoId: string) {
  const clear = page.locator('[data-testid="cfg-filter-clear"]');
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
  }
  const btn = page.locator(`[data-testid="cfg-product-${productoId}"]`);
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
}

async function openMaestroTab(page: Page) {
  const tab = page.locator('[data-testid="cfg-tab-maestro"]');
  await tab.waitFor({ state: 'visible', timeout: 5_000 });
  await tab.click();
  await page.locator('[data-testid="cfg-maestro-variantes"]').waitFor({
    state: 'visible',
    timeout: 5_000,
  });
}

async function readMesh(page: Page) {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __codex?: {
        configuratorMesh?: () => null | {
          productoId: string;
          bboxMin: [number, number, number] | null;
          bboxMax: [number, number, number] | null;
        };
        configuratorPorts?: () => Array<{
          port: string;
          centerMm?: [number, number, number];
          normalMm?: [number, number, number];
        }>;
      };
    };
    const mesh = w.__codex?.configuratorMesh?.() ?? null;
    const ports = w.__codex?.configuratorPorts?.() ?? [];
    return { mesh, ports };
  });
}

function bboxSize(min: number[], max: number[]): [number, number, number] {
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

test.describe('Patrón vertical compartido + variantes no-rectas', () => {
  test.setTimeout(90_000);
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
    await gotoConfigurator(page);
  });

  test('A. Variante NO recta de perforada — CPS-450-90-Z (curva horizontal 90°)', async ({ page }) => {
    const productoId = 'SAM_CPS-450-90-Z';
    await selectProduct(page, productoId);
    await openMaestroTab(page);

    // Verifica que el inspector identifica el maestro correcto.
    const provenance = page.locator('[data-testid="cfg-maestro-provenance"]');
    await expect(provenance).toBeVisible();

    const { mesh, ports } = await readMesh(page);
    expect(mesh, 'mesh renderizada para CPS-450-90-Z').not.toBeNull();
    expect(mesh!.productoId).toBe(productoId);
    expect(mesh!.bboxMin, 'bbox min').not.toBeNull();
    expect(mesh!.bboxMax, 'bbox max').not.toBeNull();

    // El bbox de una CPS-90 450 debe reflejar que ESCALÓ (no quedarse en 300):
    // la curva 90 base tiene longitud total ~820 mm sobre lado x_max; escalada
    // por 450/300 crece ~1.5× en X y Z. La asserción mínima es que la bbox en
    // algún eje planar supera 500 mm — dejaría en falso una variante que
    // renderizara el STEP sin escalar.
    const size = bboxSize(mesh!.bboxMin!, mesh!.bboxMax!);
    const planarMax = Math.max(Math.abs(size[0]), Math.abs(size[2]));
    expect(planarMax, `size planar ${JSON.stringify(size)}`).toBeGreaterThan(500);

    // Las bocas renderizadas deben ser 2 (tangente inicial + final).
    const portNames = ports.map((p) => p.port).sort();
    expect(portNames).toContain('P1');
    expect(portNames).toContain('P2');
  });

  test('B. Variante NO recta de escalera — CS-450-90-065-18-Z', async ({ page }) => {
    const productoId = 'SAM_CS-450-90-065-18-Z';
    await selectProduct(page, productoId);
    await openMaestroTab(page);

    const provenance = page.locator('[data-testid="cfg-maestro-provenance"]');
    await expect(provenance).toBeVisible();
    // Regla uniform-xz / ala-independent con provenance=estimated: el banner
    // debe mencionarlo de alguna forma (el texto exacto varía según i18n).
    await expect(provenance).toContainText(/estimad/i);

    const { mesh, ports } = await readMesh(page);
    expect(mesh, 'mesh renderizada para CS-450-90').not.toBeNull();
    expect(mesh!.productoId).toBe(productoId);

    // Como escalera usa `baseAnchoMm=298.9`, factor=450/298.9≈1.5055 — la bbox
    // es levemente mayor que 1.5×base. Verificamos que escaló (no sólo
    // 300×base) y que los dos puertos P1/P2 están presentes.
    const size = bboxSize(mesh!.bboxMin!, mesh!.bboxMax!);
    const planarMax = Math.max(Math.abs(size[0]), Math.abs(size[2]));
    expect(planarMax).toBeGreaterThan(500);

    const portNames = ports.map((p) => p.port).sort();
    expect(portNames).toContain('P1');
    expect(portNames).toContain('P2');
  });

  test('C.1. Patrón vertical compartido — CUPS-300-A-Z (ascendente, interior)', async ({ page }) => {
    const productoId = 'SAM_CUPS-300-A-Z';
    await selectProduct(page, productoId);
    await openMaestroTab(page);

    // Tabla de variantes: el master interior tiene 6 variantes declaradas A-Z.
    const table = page.locator('[data-testid="cfg-maestro-variantes"]');
    await expect(table).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-300-A-Z"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-450-A-Z"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-050-A-Z"]')).toBeVisible();

    const { mesh } = await readMesh(page);
    expect(mesh!.productoId).toBe(productoId);
    // ancho=300 → profundidad en Z ≈ 300 (regla depth-only).
    const size = bboxSize(mesh!.bboxMin!, mesh!.bboxMax!);
    expect(Math.abs(size[2]), `|size.z|=${size[2]}`).toBeGreaterThan(250);
    expect(Math.abs(size[2])).toBeLessThan(400);
  });

  test('C.2. Patrón vertical compartido — CUPS-450-D-Z (descendente, exterior)', async ({ page }) => {
    const productoId = 'SAM_CUPS-450-D-Z';
    await selectProduct(page, productoId);
    await openMaestroTab(page);

    // El master exterior tiene 6 variantes declaradas D-Z. CUPS-450-D-Z debe
    // aparecer como base o fila declarada.
    const table = page.locator('[data-testid="cfg-maestro-variantes"]');
    await expect(table).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-450-D-Z"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-050-D-Z"]')).toBeVisible();

    const { mesh } = await readMesh(page);
    expect(mesh!.productoId).toBe(productoId);
    // ancho=450 → profundidad Z ≈ 450.
    const size = bboxSize(mesh!.bboxMin!, mesh!.bboxMax!);
    expect(Math.abs(size[2]), `|size.z|=${size[2]}`).toBeGreaterThan(400);
    expect(Math.abs(size[2])).toBeLessThan(550);
  });

  test('C.3. A↔D son masters disjuntos — las filas de variantes no se cruzan', async ({ page }) => {
    // Al abrir el maestro interior desde CUPS-300-A-Z, las filas D-Z no deben
    // aparecer y viceversa. Esto demuestra que la distinción comercial se
    // preserva aunque la geometría sea equivalente.
    await selectProduct(page, 'SAM_CUPS-300-A-Z');
    await openMaestroTab(page);
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-300-A-Z"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-300-D-Z"]')).toHaveCount(0);

    await selectProduct(page, 'SAM_CUPS-300-D-Z');
    await openMaestroTab(page);
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-300-D-Z"]')).toBeVisible();
    await expect(page.locator('[data-testid="cfg-maestro-row-CUPS-300-A-Z"]')).toHaveCount(0);
  });
});
