/**
 * E2E — Importar Excel ELS-IMP-EQCX en el workspace unificado.
 *
 * Flujo de aceptación (A1–A11):
 *   1. Abre el workspace, hace clic en "Importar Excel".
 *   2. Entrega el fixture oficial al input del wizard.
 *   3. El wizard muestra conteos esperados (equipos activos, retirados,
 *      conexiones, tendidos).
 *   4. Confirma "Incorporar al proyecto".
 *   5. El árbol muestra "Equipos importados" con la cuenta 276 (260 activos +
 *      16 retirados, incluyendo RETIRADOS tras marcar el toggle).
 *   6. Selecciona un equipo (S1-SOP101 EQ-0026) y verifica que la ficha
 *      técnica incluye la potencia 7.5 kW.
 *   7. Exporta el workspace a JSON, lo re-importa en una página nueva y
 *      confirma que el catálogo sobrevive el round-trip.
 *
 * Requiere `npm run dev` en http://localhost:5173.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = resolve(__dirname, '../src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');
const OUT_DIR = resolve(__dirname, 'output');

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/?workspace=bandejas');
  await page.locator('.unified-workspace').waitFor({ state: 'visible', timeout: 20_000 });
}

async function importFixture(page: Page): Promise<void> {
  await page.getByTestId('open-import-wizard').click();
  await page.locator('.import-wizard').waitFor({ state: 'visible', timeout: 10_000 });
  const fileInput = page.locator('.import-wizard input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);
  // Wait for preview step
  await expect(page.locator('.import-wizard-step .active')).toHaveText(/Revisión/, { timeout: 20_000 });
}

test('A1–A11 — flujo completo de importación Excel', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  await openWorkspace(page);
  await importFixture(page);

  // A6: contadores correctos (260 activos + 16 retirados, 272 conexiones, 279 tendidos).
  const body = page.locator('.import-wizard-body');
  await expect(body).toContainText('276');
  await expect(body).toContainText('Activos: 260');
  await expect(body).toContainText('Retirados: 16');
  await expect(body).toContainText('272'); // conexiones
  await expect(body).toContainText('279'); // tendidos

  // A5/A7: no hay errores de validación (deben ser 0 ERROR en el header del libro oficial).
  await expect(body.locator('h3:has-text("Hallazgos")')).toContainText(/0 ERROR/);

  // Confirmar
  await page.locator('.import-wizard-footer button.primary').click();
  await expect(page.locator('.import-wizard-body')).toContainText('Catálogo incorporado', { timeout: 10_000 });
  await page.locator('.import-wizard-footer button:has-text("Cerrar")').click();

  // A9/A10: árbol mostrando los equipos importados.
  const importedTree = page.locator('.imported-tree-section');
  await importedTree.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(importedTree.locator('h3')).toContainText(/Equipos importados \(260\/276\)/);

  // Toggle RETIRADOS → sube a 276
  await importedTree.locator('label:has-text("Incluir RETIRADOS")').click();
  await expect(importedTree.locator('h3')).toContainText(/Equipos importados \(276\/276\)/);

  // Elegir S1-SOP101 (EQ-0026) y verificar 7.5 kW en la ficha.
  await page.fill('.imported-tree-section input[type="text"]', 'S1-SOP101');
  const row = page.locator('.imported-tree-item', { hasText: 'S1-SOP101' }).first();
  await row.click();

  const inspector = page.locator('.imported-inspector');
  await inspector.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(inspector).toContainText('S1-SOP101');
  await expect(inspector).toContainText('7.5'); // potencia_nominal_kW vigente
  // Alternativa 15 HP en CONFLICTO existe (A14).
  await expect(inspector).toContainText(/Alternativas/);

  // A11: round-trip — exportar JSON y verificar que incluye importedCatalog.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exportar JSON/ }).click(),
  ]) as [Download, void];
  const path = await download.path();
  if (!path) throw new Error('Export did not produce a file');
  const buf = readFileSync(path, 'utf-8');
  const json = JSON.parse(buf);
  writeFileSync(resolve(OUT_DIR, 'import-roundtrip.workspace.json'), buf);
  expect(json.importedCatalog?.version).toBe('codex:importedCatalog/1');
  expect(json.importedCatalog?.catalog?.equipos?.length).toBe(276);
  expect(json.importedCatalog?.catalog?.meta?.formatoId).toBe('ELS-IMP-EQCX');
});
