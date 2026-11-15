/**
 * Ayudantes de la disposición de pantalla (interfaz, 2026-11-14): los formularios
 * se abren en el inspector y las tablas viven en pestañas del panel inferior. Las
 * pruebas siguen verificando lo mismo; sólo cambia cómo se llega.
 */
import { expect, type Page } from '@playwright/test';

export type FormularioConexiones = 'enlace' | 'circuito' | 'medir';
export type Pestana = 'circuitos' | 'contraste' | 'computo' | 'motor' | 'avisos';

/** Abre en el inspector un formulario de Conexiones (desde sus acciones), cerrando otro si lo hubiera. */
export async function abrirFormulario(page: Page, tipo: FormularioConexiones): Promise<void> {
  const f = page.getByTestId(`formulario-${tipo}`);
  if (await f.count()) return;
  const cerrar = page.getByTestId('formulario-cerrar');
  if (await cerrar.count()) await cerrar.click();
  await page.getByTestId(`accion-${tipo}`).click();
  await expect(f).toBeVisible();
}

/** Muestra una pestaña del panel inferior (lo despliega si estaba plegado). */
export async function verPestana(page: Page, id: Pestana): Promise<void> {
  const panel = page.getByTestId('panel-inferior');
  if ((await panel.getAttribute('data-abierto')) !== 'true' || (await panel.getAttribute('data-pestana')) !== id) {
    await page.getByTestId(`pestana-${id}`).click();
  }
  await expect(page.getByTestId(`panel-inferior-${id}`)).toBeVisible();
}

/**
 * Alcance real de un panel (defecto 2026-11-14): Playwright desplaza por programa
 * cualquier contenedor antes de un clic, aunque la persona no pueda desplazarlo.
 * Estas medidas se toman como las ve el usuario: nada se desplaza por programa.
 *
 *   visible(el)   el rectángulo del elemento está dentro del área visible del panel
 *                 y de la ventana, y en su centro no hay otro elemento encima.
 *   ruedaAlFinal  con la rueda del mouse sobre el panel se llega al final del medio.
 */
export interface AlcancePanel {
  /** El contenido del medio no entra (si entra, la prueba no prueba nada). */
  readonly desborda: boolean;
  readonly cabeceraVisible: boolean;
  readonly confirmarVisible: boolean;
  /** Con la rueda se llegó al final del contenido. */
  readonly ruedaAlFinal: boolean;
  /** Tras bajar con la rueda, cabecera y confirmar siguen a la vista. */
  readonly cabeceraVisibleAbajo: boolean;
  readonly confirmarVisibleAbajo: boolean;
}

/** ¿Está `sel` dentro del área visible de `panel` y de la ventana, sin nada encima en su centro? */
async function aLaVista(page: Page, panelSel: string, sel: string): Promise<boolean> {
  return page.evaluate(([panelSel, sel]) => {
    const panel = document.querySelector(panelSel);
    const el = document.querySelector(sel);
    if (!panel || !el) return false;
    const p = panel.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const dentro = r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5 && r.left >= p.left - 0.5 && r.right <= p.right + 0.5
      && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    if (!dentro) return false;
    const encima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!encima && (encima === el || el.contains(encima));
  }, [panelSel, sel] as const);
}

/**
 * Mide el alcance del inspector (o de cualquier panel) sin desplazar por programa:
 * parte del panel arriba de todo (como lo ve quien lo abre), mira cabecera y
 * confirmar, y baja sólo con la rueda del mouse.
 */
export async function medirAlcance(page: Page, o: { panel: string; cuerpo: string; cabecera: string; confirmar: string }): Promise<AlcancePanel> {
  const cuerpo = page.locator(o.cuerpo);
  // Estado de partida: el panel recién abierto, arriba de todo. Los clic/selectOption previos
  // de Playwright desplazan por programa CUALQUIER contenedor, incluso uno con overflow:hidden
  // que la persona no puede mover (así pasaba el defecto inadvertido): se vuelve todo a cero.
  await page.evaluate((panelSel) => {
    const panel = document.querySelector(panelSel)!;
    for (const el of [panel, ...panel.querySelectorAll('*')]) if (el.scrollTop) el.scrollTop = 0;
  }, o.panel);
  // El contenido no entra en el marco visible del panel (no en el cuerpo: sin restricción, el
  // cuerpo crece con su contenido y nunca «desborda», que es justamente el defecto).
  const desborda = await page.evaluate(([panelSel, cuerpoSel]) => {
    const p = document.querySelector(panelSel)!.getBoundingClientRect();
    const c = document.querySelector(cuerpoSel)!;
    return c.scrollHeight > Math.min(p.bottom, window.innerHeight) - c.getBoundingClientRect().top + 1;
  }, [o.panel, o.cuerpo] as const);
  const cabeceraVisible = await aLaVista(page, o.panel, o.cabecera);
  const confirmarVisible = await aLaVista(page, o.panel, o.confirmar);
  // Rueda del mouse sobre el medio del panel: lo único que la persona puede hacer.
  const caja = await page.locator(o.panel).boundingBox();
  if (!caja) throw new Error(`sin caja para ${o.panel}`);
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  let ruedaAlFinal = false;
  for (let i = 0; i < 40 && !ruedaAlFinal; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
    ruedaAlFinal = await cuerpo.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }
  const cabeceraVisibleAbajo = await aLaVista(page, o.panel, o.cabecera);
  const confirmarVisibleAbajo = await aLaVista(page, o.panel, o.confirmar);
  return { desborda, cabeceraVisible, confirmarVisible, ruedaAlFinal, cabeceraVisibleAbajo, confirmarVisibleAbajo };
}

/** Selectores del inspector durante una continuación. */
export const INSPECTOR_CONTINUACION = {
  /** El marco visible: la columna del inspector, fija por la disposición. */
  panel: '.unified-workspace-inspector',
  cuerpo: '[data-testid="inspector-cuerpo"]',
  cabecera: '[data-testid="routing-cabecera"]',
  confirmar: '[data-testid="routing-confirmar"]',
} as const;

/** Clic con el mouse en el centro del elemento, sin desplazar nada: falla si no está a la vista. */
export async function clicSinDesplazar(page: Page, panelSel: string, sel: string): Promise<void> {
  expect(await aLaVista(page, panelSel, sel), `${sel} a la vista dentro de ${panelSel}`).toBe(true);
  const caja = (await page.locator(sel).boundingBox())!;
  await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
}
