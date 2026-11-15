/**
 * Ayudantes para el selector de pieza en tres pasos (A2, interfaz 2026-11-14):
 * tipo → ancho → variante, con espesor y acabado dentro. Reemplazan al <select>
 * plano `[data-codex-routing-product-select]`: las pruebas siguen eligiendo y
 * verificando por código exacto. Cada <option> del selector lleva
 * `data-productos` con los códigos que contiene.
 */
import { expect, type Page } from '@playwright/test';

const PASOS = ['tipo', 'ancho', 'variante', 'espesor', 'acabado'] as const;

/** Espera a que el selector de pieza esté visible en el panel de continuación. */
export async function esperarSelectorPieza(page: Page, timeout = 10_000): Promise<void> {
  await page.locator('[data-codex-routing-pieza-tipo]').waitFor({ state: 'visible', timeout });
}

/** Elige el código exacto `productoId` recorriendo tipo → ancho → variante → espesor → acabado. */
export async function elegirPieza(page: Page, productoId: string): Promise<void> {
  await esperarSelectorPieza(page);
  for (const paso of PASOS) {
    const sel = page.locator(`[data-codex-routing-pieza-${paso}]`);
    await expect(sel, `paso ${paso} del selector de pieza`).toBeVisible();
    const valor = await sel.locator('option').evaluateAll((opts, id) => {
      const o = (opts as HTMLOptionElement[]).find((x) => (x.getAttribute('data-productos') ?? '').split(' ').includes(id));
      return o ? o.value : null;
    }, productoId);
    if (valor === null) throw new Error(`${productoId} no se ofrece en el paso «${paso}» del selector de pieza`);
    await sel.selectOption(valor);
  }
  await expect(page.locator('[data-codex-routing-codigo]')).toBeVisible();
}

/** Códigos que ofrece el selector (todas las opciones de tipo). Vacío si no hay selector. */
export async function piezasOfrecidas(page: Page): Promise<string[]> {
  const sel = page.locator('[data-codex-routing-pieza-tipo]');
  if (!(await sel.count())) return [];
  return sel.locator('option').evaluateAll((opts) =>
    [...new Set((opts as HTMLOptionElement[]).flatMap((o) => (o.getAttribute('data-productos') ?? '').split(' ').filter(Boolean)))]);
}

/** Código exacto que quedó elegido (el que se computa), por su id de producto en el store. */
export async function piezaElegida(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __codex: { routingStore: { getState: () => { selectedProductId: string } } } }).__codex.routingStore.getState().selectedProductId);
}

export interface DetallePieza { readonly tipo: string; readonly excepcion: boolean; readonly conModelo: boolean }

/**
 * Lo que ofrece el selector, por código: su tipo, si es una excepción con motivo
 * (compatibilidad no documentada) y si tiene modelo paramétrico. Reemplaza la
 * lectura de los marcadores del <select> plano (◆ con modelo, ○ sin modelo,
 * ⚠ excepción).
 */
export async function detalleOfrecido(page: Page): Promise<Record<string, DetallePieza>> {
  const sel = page.locator('[data-codex-routing-pieza-tipo]');
  if (!(await sel.count())) return {};
  return sel.locator('option').evaluateAll((opts) => {
    const out: Record<string, { tipo: string; excepcion: boolean; conModelo: boolean }> = {};
    const lista = (o: Element, a: string) => (o.getAttribute(a) ?? '').split(' ').filter(Boolean);
    for (const o of opts as HTMLOptionElement[]) {
      const exc = new Set(lista(o, 'data-excepciones'));
      const sinModelo = new Set(lista(o, 'data-sin-modelo'));
      for (const id of lista(o, 'data-productos')) out[id] = { tipo: o.value, excepcion: exc.has(id), conModelo: !sinModelo.has(id) && !exc.has(id) };
    }
    return out;
  });
}
