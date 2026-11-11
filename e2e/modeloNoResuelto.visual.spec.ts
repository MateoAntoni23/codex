/**
 * Modelo no resuelto: una pieza cuyo contorno medido gira otro ángulo que el
 * declarado (hoy, CS-300-45-065-18-Z: gira 60°, declara 45°) no se coloca ni se
 * dibuja como si estuviera bien. Se marca con su motivo.
 *
 *   1) Proyecto anterior (pieza sin colocación): la migración la deja "sin
 *      resolver" con el motivo del ángulo; no se dibuja con el contorno medido.
 *   2) Pieza ya colocada con la definición de 60° (guardada antes de la
 *      verificación): no se dibuja su malla; queda el esquema por sus bocas con
 *      el marcador "Modelo no resuelto" y el motivo.
 *
 * La definición del caso 2 se construye con las mismas funciones puras de la
 * app (receta → definición → colocación), sin geometría escrita a mano.
 */
import { test, expect, type Page } from '@playwright/test';
import * as THREE from 'three';
import { buildRecipeByKey } from '../src/parametric/geometry/recipes';
import { definitionFromRecipe, definitionHash, placeDefinition, puertosFromWorld } from '../src/workspace/placement/placementCore';

const CS45 = 'SAM_CS-300-45-065-18-Z';
const MOTIVO_60 = 'modelo no resuelto: el contorno medido gira 60.00° entre bocas y la pieza declara 45° (tolerancia 0,5°)';

type Dump = { kind: string; instanciaId?: string; titulo?: string; motivo?: string };

function bandeja(piezas: unknown[], extra: Record<string, unknown> = {}) {
  return {
    version_contrato: 'trazado/1',
    piezas,
    conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: 'e2e-modelo-no-resuelto', conductores: [] },
    ...extra,
  };
}

async function abrir(page: Page) {
  await page.goto('/?workspace=bandejas');
  await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { scene?: unknown } }).__codex?.scene), { timeout: 20_000 });
  // El catálogo llega en un chunk diferido: sin él no hay migración ni modelo.
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    { timeout: 20_000 },
  );
}

async function cargar(page: Page, tray: unknown) {
  await page.evaluate((input) => {
    const w = window as unknown as { __codex: { trayStore: { getState: () => { importEdit: (i: unknown) => void } } } };
    w.__codex.trayStore.getState().importEdit(input);
  }, tray);
}

const dump = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { dumpMeshes: () => Dump[] } }).__codex.dumpMeshes());

test.describe('modelo no resuelto: giro medido ≠ declarado', () => {
  test('proyecto anterior: la CS-45 escalera queda sin resolver con el motivo del ángulo', async ({ page }) => {
    await abrir(page);
    // Curva de 45° con bocas nominales (como la guardaría un proyecto anterior).
    const c = Math.SQRT1_2;
    await cargar(page, bandeja([{
      instancia_id: 'C45', producto_id: CS45,
      puertos: {
        P1: { posicion_mm: [0, 0, 0], direccion: [-1, 0, 0] },
        P2: { posicion_mm: [600 + 600 * c, 600 * c, 0], direccion: [c, c, 0] },
      },
    }]));

    await page.waitForFunction(() => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ colocacion?: { estado: string } }> } | null } } } };
      return w.__codex.trayStore.getState().entrada?.piezas[0]?.colocacion?.estado === 'sin_resolver';
    }, { timeout: 20_000 });
    const colocacion = await page.evaluate(() => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ colocacion?: unknown }> } } } } };
      return w.__codex.trayStore.getState().entrada.piezas[0].colocacion;
    });
    expect(colocacion).toEqual({ version: 1, estado: 'sin_resolver', motivo: MOTIVO_60 });

    await expect.poll(async () => (await dump(page)).find((d) => d.kind === 'unresolved-marker' && d.instanciaId === 'C45')?.motivo).toBe(MOTIVO_60);
    const kinds = (await dump(page)).filter((d) => d.instanciaId === 'C45').map((d) => d.kind);
    // No se dibuja con el contorno medido de 60° (las bocas del archivo no encajan con él).
    expect(kinds).not.toContain('ladder-measured');
    expect(kinds).not.toContain('parametric-confirmed');
    await expect(page.getByTestId('unresolved-marker')).toContainText(MOTIVO_60);
  });

  test('pieza colocada con la definición de 60°: sin malla, esquema + "Modelo no resuelto"', async ({ page }) => {
    await abrir(page);
    const params = { ancho_mm: 300, ala_mm: 65, angulo_deg: 45 };
    const raw = buildRecipeByKey('escalera:curva_horizontal', params);
    const def = definitionFromRecipe({
      patron: 'master:escalera:curva_horizontal_45', revision: '1', params,
      raw, resolved: raw, preTransform: new THREE.Matrix4(),
    });
    const huella = definitionHash(def);
    const placed = placeDefinition({ def, huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    await cargar(page, bandeja(
      [{ instancia_id: 'C45', producto_id: CS45, puertos: puertosFromWorld(placed.ports), colocacion: placed.colocacion }],
      { definiciones_ws: { [huella]: def } },
    ));

    await expect.poll(async () => {
      const m = (await dump(page)).find((d) => d.kind === 'unresolved-marker' && d.instanciaId === 'C45');
      return m ? `${m.titulo} | ${m.motivo}` : null;
    }, { timeout: 20_000 }).toBe(`Modelo no resuelto | ${MOTIVO_60}`);
    const kinds = (await dump(page)).filter((d) => d.instanciaId === 'C45').map((d) => d.kind);
    expect(kinds.some((k) => k === 'parametric-confirmed' || k.startsWith('ladder-')), `C45 dibujada como modelo válido: ${kinds.join(', ')}`).toBe(false);
    // La colocación guardada (dato del operador) no se toca: sólo cambia cómo se muestra.
    const estado = await page.evaluate(() => {
      const w = window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Array<{ colocacion?: { estado: string } }> } } } } };
      return w.__codex.trayStore.getState().entrada.piezas[0].colocacion?.estado;
    });
    expect(estado).toBe('resuelta');
  });
});
