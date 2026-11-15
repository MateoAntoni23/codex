/**
 * E2E — interfaz, parte B (2026-11-14): color por tipo de bandeja. Pantalla del
 * operador: 1366×768, tema oscuro. Una prueba por punto del encargo
 * (docs/traspaso-interfaz.md):
 *
 *   B1  Color por TIPO, no por acabado: perforada Z y perforada color (ZN) iguales;
 *       escalera rojo, alambre ámbar; soportes en gris neutro.
 *   B2  Configurable desde la leyenda; se guarda en localStorage (sobrevive a
 *       recargar) y no viaja en el archivo de proyecto.
 *   B3  Selección = contorno + realce, sin cambiar el relleno. Vista previa
 *       translúcida con el color de su tipo.
 *   B4  Inválido / desactualizado / mezcla de acabados: el relleno sigue siendo el
 *       del tipo; el estado va con distintivo y texto.
 *   B5  Leyenda visible en la escena, ocultable (y se recuerda).
 *   B6  Medición CON NÚMEROS sobre los píxeles dibujados: ΔE2000 entre tipos y
 *       contraste contra el fondo, también con protanopía y deuteranopía.
 *       Informe en e2e/output/interfaz-B-colores.json.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elegirPieza } from './helpers/selectorPieza';
import { COLORES_POR_DEFECTO, EMISIVO_BASE, EMISIVO_SELECCION, FONDO_ESCENA } from '../src/workspace/colores/coloresTipo';
import { evaluarPaleta, MIN_CONTRASTE_FONDO, MIN_DELTA_E, type Rgb } from '../src/workspace/colores/distincion';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, 'output');
const USER_REPORT = resolve(HERE, 'fixtures/user-report-20261107.workspace.json');

test.use({ viewport: { width: 1366, height: 768 } });

type Dump = { kind: string; instanciaId?: string; soporteId?: string; color?: string; tipoColor?: string; selected?: boolean; worldPosition: [number, number, number] };
type Pz = { instancia_id: string; producto_id: string };
const piezas = (page: Page) => page.evaluate(() =>
  (window as unknown as { __codex: { trayStore: { getState: () => { entrada: { piezas: Pz[] } } } } }).__codex.trayStore.getState().entrada.piezas);
const dump = (page: Page) => page.evaluate(() => (window as unknown as { __codex: { dumpMeshes: () => Dump[] } }).__codex.dumpMeshes());
const foto = (page: Page, nombre: string) => page.screenshot({ path: resolve(OUT_DIR, `interfaz-B-${nombre}.png`) });
/** Color con que se dibuja cada pieza (el primer objeto de la escena que la nombra con color). */
async function colorDe(page: Page, id: string): Promise<string | undefined> {
  return (await dump(page)).find((d) => d.instanciaId === id && d.color)?.color;
}

async function abrir(page: Page, url = '/?etapa=bandejas') {
  await page.goto(url);
  await page.getByTestId('stage-bar').waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __codex?: { trayStore?: { getState: () => { context: { productos: unknown[] } | null } } } }).__codex?.trayStore?.getState().context?.productos.length ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
  await page.waitForFunction(() => Boolean((window as unknown as { __codex?: { dumpMeshes?: unknown } }).__codex?.dumpMeshes), undefined, { timeout: 20_000 });
}

/** Tramo nuevo desde el formulario, a la altura `y` (mm), de 3 m. */
async function tramo(page: Page, productoId: string, y: number): Promise<Pz> {
  const antes = (await piezas(page)).length;
  await page.getByTestId('tool-bandejas-tramo').click();
  await page.getByTestId('add-product-select').selectOption(productoId);
  const ejes = page.getByTestId('formulario-tramo').locator('fieldset');
  await ejes.nth(0).locator('input').nth(1).fill(String(y));
  await ejes.nth(1).locator('input').nth(1).fill(String(y));
  await page.getByRole('button', { name: 'Crear tramo' }).click();
  await expect.poll(async () => (await piezas(page)).length).toBe(antes + 1);
  return (await piezas(page))[antes];
}

/** Escena con un tramo de cada tipo: perforada Z, perforada color ZN, escalera Z, alambre. */
async function escenaTipos(page: Page) {
  await abrir(page);
  const perfZ = await tramo(page, 'SAM_TRPS-300-22-Z', 0);
  const perfZN = await tramo(page, 'SAM_TRPS-300-22-ZN', 900);
  const esc = await tramo(page, 'SAM_TRES-300-065-18-Z', 1800);
  const alam = await tramo(page, 'FAMIQ_300712', 2700);
  if (await page.getByTestId('formulario-cerrar').count()) await page.getByTestId('formulario-cerrar').click();
  await page.evaluate(() => (window as unknown as { __codex: { workspaceStore: { getState: () => { selectTray: (id: string | null) => void } } } }).__codex.workspaceStore.getState().selectTray(null));
  return { perfZ, perfZN, esc, alam };
}

/** Vista desde arriba, encuadrando todo. */
async function vistaSuperior(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __codex: { camera: { position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void }; controls?: { target: { set: (x: number, y: number, z: number) => void }; update: () => void } } };
    // Piezas entre x 0..3 m y z 0..-2.7 m del visor: cámara cenital sobre el centro.
    w.__codex.controls?.target.set(1.5, 0, -1.35);
    w.__codex.camera.position.set(1.5, 6, -1.349);
    w.__codex.camera.lookAt(1.5, 0, -1.35);
    w.__codex.controls?.update();
  });
  await page.waitForTimeout(300);
}

/** Lee píxeles de una captura (decodificada en el navegador) en los puntos dados: mediana 5×5. */
async function pixeles(page: Page, puntos: Array<[number, number]>): Promise<Rgb[]> {
  const png = (await page.screenshot()).toString('base64');
  const crudos = await page.evaluate(async ({ png, puntos }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    return puntos.map(([x, y]) => {
      const d = ctx.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
      const canal = (k: number) => { const v: number[] = []; for (let i = 0; i < 25; i++) v.push(d[i * 4 + k]); v.sort((a, b) => a - b); return v[12] / 255; };
      return [canal(0), canal(1), canal(2)];
    });
  }, { png, puntos });
  return crudos as unknown as Rgb[];
}

/**
 * Proyección a pantalla de un punto de cada pieza: a un 30 % del largo entre sus
 * bocas P1 y P2 (no en el centro, donde van los distintivos de estado).
 */
async function enPantalla(page: Page, ids: string[]): Promise<Array<[number, number]>> {
  return page.evaluate((ids) => {
    type P = { instancia_id: string; puertos: Record<string, { posicion_mm: [number, number, number] }> };
    const w = window as unknown as { __codex: { camera: { position: { constructor: new (x: number, y: number, z: number) => { project: (c: unknown) => { x: number; y: number } } } }; trayStore: { getState: () => { entrada: { piezas: P[] } } } } };
    const cam = w.__codex.camera;
    const canvas = document.querySelector('.unified-workspace-canvas canvas')!.getBoundingClientRect();
    const V = cam.position.constructor;
    const visor = (mm: [number, number, number]) => [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
    return ids.map((id) => {
      const pz = w.__codex.trayStore.getState().entrada.piezas.find((x) => x.instancia_id === id)!;
      const [a, b] = Object.values(pz.puertos).map((q) => visor(q.posicion_mm));
      const p = new V(a[0] + 0.3 * (b[0] - a[0]), a[1] + 0.3 * (b[1] - a[1]), a[2] + 0.3 * (b[2] - a[2])).project(cam);
      return [canvas.left + ((p.x + 1) / 2) * canvas.width, canvas.top + ((1 - p.y) / 2) * canvas.height] as [number, number];
    });
  }, ids);
}

test.describe('Interfaz — parte B: color por tipo de bandeja', () => {
  test.setTimeout(180_000);
  test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

  test('B1: color por TIPO, no por acabado: perforada Z y color iguales; escalera, alambre', async ({ page }) => {
    const { perfZ, perfZN, esc, alam } = await escenaTipos(page);
    expect(await colorDe(page, perfZ.instancia_id)).toBe(COLORES_POR_DEFECTO.perforada);
    // Perforada color (ZN): mismo tipo, mismo color que la zincada.
    expect(await colorDe(page, perfZN.instancia_id)).toBe(COLORES_POR_DEFECTO.perforada);
    expect(await colorDe(page, esc.instancia_id)).toBe(COLORES_POR_DEFECTO.escalera);
    expect(await colorDe(page, alam.instancia_id)).toBe(COLORES_POR_DEFECTO.alambre);
    // Cuatro colores distintos entre sí en la escena (ninguno es el celeste anterior).
    expect(new Set(Object.values(COLORES_POR_DEFECTO)).size).toBe(4);
    expect(Object.values(COLORES_POR_DEFECTO)).not.toContain('#50b8de');
    await vistaSuperior(page);
    await foto(page, 'B1-tipos');
  });

  test('B1: soportes en gris neutro de herrajes (proyecto del operador: escalera con 9 soportes)', async ({ page }) => {
    await abrir(page, '/');
    await page.getByTestId('project-open-input').setInputFiles(USER_REPORT);
    await expect.poll(async () => (await dump(page)).filter((d) => d.kind === 'soporte').length, { timeout: 20_000 }).toBe(9);
    for (const s of (await dump(page)).filter((d) => d.kind === 'soporte')) {
      expect(s.color).toBe(COLORES_POR_DEFECTO.herraje);
      expect(s.tipoColor).toBe('herraje');
    }
  });

  test('B2: el color se cambia desde la interfaz; queda en este navegador y no en el archivo de proyecto', async ({ page }) => {
    const { esc, perfZ } = await escenaTipos(page);
    await page.getByTestId('leyenda-color-escalera').fill('#aa2266');
    await expect.poll(() => colorDe(page, esc.instancia_id)).toBe('#aa2266');
    expect(await colorDe(page, perfZ.instancia_id)).toBe(COLORES_POR_DEFECTO.perforada);
    expect(await page.evaluate(() => localStorage.getItem('codex:ui:colores-tipo'))).toContain('#aa2266');
    // El proyecto (en memoria y en el archivo que se guarda) no lleva colores.
    const entrada = await page.evaluate(() => JSON.stringify((window as unknown as { __codex: { trayStore: { getState: () => { entrada: unknown } } } }).__codex.trayStore.getState().entrada));
    expect(entrada).not.toContain('#aa2266');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save-copy').click()]);
    const archivo = readFileSync((await descarga.path())!, 'utf-8');
    expect(archivo).not.toContain('#aa2266');
    expect(archivo).not.toContain('colores-tipo');
    // Sobrevive a recargar (preferencia por navegador, como el tema). Antes, que el proyecto quede
    // guardado: si no, al recargar no está la pieza y no hay color que mirar (carrera de la prueba).
    await expect(page.getByTestId('project-save-status')).toHaveAttribute('data-phase', 'saved', { timeout: 10_000 });
    await page.reload();
    await abrir(page);
    await expect.poll(() => colorDe(page, esc.instancia_id), { timeout: 20_000 }).toBe('#aa2266');
    // Restablecer vuelve al rojo por defecto.
    await page.getByTestId('leyenda-restablecer').click();
    await expect.poll(() => colorDe(page, esc.instancia_id)).toBe(COLORES_POR_DEFECTO.escalera);
    await expect(page.getByTestId('leyenda-restablecer')).toHaveCount(0);
  });

  test('B3: la selección es contorno y realce sin cambiar el relleno; la vista previa usa el color de su tipo', async ({ page }) => {
    const { alam, perfZ } = await escenaTipos(page);
    // Selección de la pieza de alambre (ámbar): el relleno NO pasa a amarillo.
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.locator(`[data-row-key="piece:${alam.instancia_id}"]`).click();
    await expect.poll(async () => (await dump(page)).find((d) => d.instanciaId === alam.instancia_id && d.color)?.selected).toBe(true);
    expect(await colorDe(page, alam.instancia_id)).toBe(COLORES_POR_DEFECTO.alambre);
    // Contorno: la malla seleccionada lleva aristas (LineSegments) y realce emisivo; las demás no.
    const marca = await page.evaluate((ids) => {
      const w = window as unknown as { __codex: { scene: { traverse: (f: (o: { userData: { codex?: { instanciaId?: string; color?: string } }; children: Array<{ type: string }>; material?: { emissiveIntensity?: number; color?: { getHexString: () => string } } }) => void) => void } } };
      const out: Record<string, { contorno: boolean; realce: number; relleno: string }> = {};
      w.__codex.scene.traverse((o) => {
        const id = o.userData.codex?.instanciaId;
        if (!id || !ids.includes(id) || !o.material || out[id]) return;
        out[id] = { contorno: o.children.some((c) => /Line/.test(c.type)), realce: o.material.emissiveIntensity ?? 0, relleno: `#${o.material.color?.getHexString()}` };
      });
      return out;
    }, [alam.instancia_id, perfZ.instancia_id]);
    expect(marca[alam.instancia_id]).toEqual({ contorno: true, realce: EMISIVO_SELECCION, relleno: COLORES_POR_DEFECTO.alambre });
    expect(marca[perfZ.instancia_id]).toEqual({ contorno: false, realce: EMISIVO_BASE, relleno: COLORES_POR_DEFECTO.perforada });
    await vistaSuperior(page);
    await foto(page, 'B3-seleccion');

    // Vista previa: continuar desde la perforada con una curva eslabonada → translúcida, celeste.
    await page.getByTestId('free-end').filter({ hasText: /TRPS-300-22-Z · Boca x_max/ }).first().click();
    await elegirPieza(page, 'SAM_EPS-300-Z');
    await page.locator('[data-codex-routing-entry-port="P1"]').click();
    await page.locator('[data-codex-routing-vertical="sube"]').click();
    await expect.poll(async () => (await dump(page)).some((d) => d.kind === 'parametric-preview')).toBe(true);
    const prev = await page.evaluate(() => {
      const w = window as unknown as { __codex: { scene: { traverse: (f: (o: { userData: { codex?: { kind?: string; tipoColor?: string } }; material?: { transparent: boolean; opacity: number; color: { getHexString: () => string } } }) => void) => void } } };
      let r: { tipo?: string; color: string; opacity: number; transparent: boolean } | null = null;
      w.__codex.scene.traverse((o) => {
        if (o.userData.codex?.kind === 'parametric-preview' && o.material) r = { tipo: o.userData.codex.tipoColor, color: `#${o.material.color.getHexString()}`, opacity: o.material.opacity, transparent: o.material.transparent };
      });
      return r;
    });
    expect(prev).toEqual({ tipo: 'perforada', color: COLORES_POR_DEFECTO.perforada, opacity: 0.35, transparent: true });
    await foto(page, 'B3-vista-previa');
  });

  test('B4: unión que deja de cumplir y mezcla de acabados: el relleno sigue siendo el del tipo; el estado va con texto', async ({ page }) => {
    await abrir(page);
    const tronco = await tramo(page, 'SAM_TRPS-300-22-Z', 0);
    // Mezcla de acabados: se continúa la perforada zincada con una perforada color (ZN).
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.getByTestId('free-end').filter({ hasText: /Boca x_max/ }).first().click();
    await elegirPieza(page, 'SAM_TRPS-300-22-ZN');
    await page.locator('[data-codex-routing-length-input]').fill('1000');
    await page.locator('[data-testid="routing-confirmar"]').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(2);
    const zn = (await piezas(page))[1];
    await page.getByTestId('tool-bandejas-seleccionar').click();
    const union = page.getByTestId('join-row').first();
    await expect(union).toContainText(/mezcla/i);
    // Mismo color de relleno que la zincada: la mezcla NO se pinta.
    expect(await colorDe(page, zn.instancia_id)).toBe(COLORES_POR_DEFECTO.perforada);
    expect(await colorDe(page, tronco.instancia_id)).toBe(COLORES_POR_DEFECTO.perforada);

    // Unión que deja de cumplir (desactualizada): curva eslabonada y recto; se cambia el ángulo.
    await page.getByTestId('free-end').filter({ hasText: /TRPS-300-22-Z · Boca x_min/ }).first().click();
    await elegirPieza(page, 'SAM_EPS-300-Z');
    await page.locator('[data-codex-routing-entry-port="P1"]').click();
    await page.locator('[data-codex-routing-vertical="sube"]').click();
    await page.locator('[data-testid="routing-confirmar"]').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(3);
    const curva = (await piezas(page))[2];
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.getByTestId('free-end').filter({ hasText: /EPS-300-Z · Boca de salida/ }).first().click();
    await elegirPieza(page, 'SAM_TRPS-300-22-Z');
    await page.locator('[data-codex-routing-length-input]').fill('1000');
    await page.locator('[data-testid="routing-confirmar"]').click();
    await expect.poll(async () => (await piezas(page)).length).toBe(4);
    const recto = (await piezas(page))[3];
    await page.getByTestId('tool-bandejas-seleccionar').click();
    await page.locator(`[data-row-key="piece:${curva.instancia_id}"]`).click();
    await page.getByTestId('eslabonada-angulo').fill('45');
    await page.getByTestId('eslabonada-aplicar').click();
    await expect(page.getByTestId('eslabonada-msg')).toContainText('dejaron de cumplir');
    await page.getByTestId('tool-bandejas-seleccionar').click();
    const rota = page.locator('[data-testid="join-row"][data-join-ok="false"]');
    await expect(rota).toHaveCount(1);
    await expect(rota).toContainText('no cumple');
    // Ninguna pieza cambia de relleno por el estado.
    for (const p of [tronco, zn, curva, recto]) expect(await colorDe(page, p.instancia_id)).toBe(COLORES_POR_DEFECTO.perforada);
    await foto(page, 'B4-estados');
  });

  test('B5: leyenda de colores en la escena, sólo con los tipos presentes; se oculta y se recuerda', async ({ page }) => {
    await abrir(page);
    // Sin piezas, no hay leyenda.
    await expect(page.getByTestId('leyenda-colores')).toHaveCount(0);
    await tramo(page, 'SAM_TRPS-300-22-Z', 0);
    await tramo(page, 'SAM_TRES-300-065-18-Z', 900);
    const leyenda = page.getByTestId('leyenda-colores');
    await expect(leyenda).toBeVisible();
    await expect(leyenda.locator('[data-testid^="leyenda-tipo-"]')).toHaveCount(2);
    await expect(page.getByTestId('leyenda-tipo-perforada')).toHaveAttribute('data-color', COLORES_POR_DEFECTO.perforada);
    await expect(page.getByTestId('leyenda-tipo-escalera')).toHaveAttribute('data-color', COLORES_POR_DEFECTO.escalera);
    // Dentro de la escena (no tapa paneles).
    const canvas = (await page.locator('.unified-workspace-canvas').boundingBox())!;
    const caja = (await leyenda.boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(canvas.x);
    expect(caja.x + caja.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(caja.y + caja.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    await foto(page, 'B5-leyenda');
    // Ocultar: queda sólo el botón para volver a mostrarla; se recuerda al recargar.
    await page.getByTestId('leyenda-ocultar').click();
    await expect(leyenda).toHaveCount(0);
    await expect(page.getByTestId('leyenda-mostrar')).toBeVisible();
    await page.reload();
    await abrir(page);
    await expect(page.getByTestId('leyenda-mostrar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('leyenda-colores')).toHaveCount(0);
    await page.getByTestId('leyenda-mostrar').click();
    await expect(page.getByTestId('leyenda-colores')).toBeVisible();
  });

  test('B6: con números, sobre los píxeles dibujados: los tipos se distinguen entre sí y del fondo, también con visión rojo-verde reducida', async ({ page }) => {
    const { perfZ, esc, alam } = await escenaTipos(page);
    // Herraje: soporte gris del proyecto del operador se mide aparte; acá, los tres tipos de bandeja.
    await vistaSuperior(page);
    const puntos = await enPantalla(page, [perfZ.instancia_id, esc.instancia_id, alam.instancia_id]);
    // Fondo: una esquina de la escena sin piezas.
    const canvas = (await page.locator('.unified-workspace-canvas').boundingBox())!;
    const [p, e, a, fondo] = await pixeles(page, [...puntos, [canvas.x + canvas.width - 30, canvas.y + 30]]);
    await foto(page, 'B6-medicion');
    const dibujados = { perforada: p, escalera: e, alambre: a };
    const inf = evaluarPaleta(dibujados, fondo);
    const nominal = evaluarPaleta(COLORES_POR_DEFECTO, FONDO_ESCENA);
    const hex = (c: Rgb) => `#${c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
    const informe = {
      umbrales: { deltaE2000_minimo: MIN_DELTA_E, contraste_fondo_minimo: MIN_CONTRASTE_FONDO },
      dibujados: { ...Object.fromEntries(Object.entries(dibujados).map(([k, v]) => [k, hex(v)])), fondo: hex(fondo) },
      dibujado: { pares: inf.pares.map((x) => ({ ...x, deltaE: +x.deltaE.toFixed(1) })), fondo: inf.fondo.map((x) => ({ ...x, deltaE: +x.deltaE.toFixed(1), contraste: +x.contraste.toFixed(2) })) },
      nominal: { colores: COLORES_POR_DEFECTO, fondo: FONDO_ESCENA, pares: nominal.pares.map((x) => ({ ...x, deltaE: +x.deltaE.toFixed(1) })), contraFondo: nominal.fondo.map((x) => ({ ...x, deltaE: +x.deltaE.toFixed(1), contraste: +x.contraste.toFixed(2) })) },
    };
    writeFileSync(resolve(OUT_DIR, 'interfaz-B-colores.json'), JSON.stringify(informe, null, 2));
    // eslint-disable-next-line no-console
    console.log(`B6 dibujado: peor par ${inf.peorPar.a}/${inf.peorPar.b} (${inf.peorPar.vision}) ΔE ${inf.peorPar.deltaE.toFixed(1)}; peor contra el fondo ${inf.peorFondo.clave} (${inf.peorFondo.vision}) ${inf.peorFondo.contraste.toFixed(2)}:1`);
    // El fondo medido es el de la escena.
    expect(hex(fondo)).toBe(FONDO_ESCENA);
    expect(inf.peorPar.deltaE, `peor par dibujado ${inf.peorPar.a}/${inf.peorPar.b} (${inf.peorPar.vision})`).toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(inf.peorFondo.contraste, `peor contra el fondo ${inf.peorFondo.clave} (${inf.peorFondo.vision})`).toBeGreaterThanOrEqual(MIN_CONTRASTE_FONDO);
    expect(nominal.ok).toBe(true);
  });
});
