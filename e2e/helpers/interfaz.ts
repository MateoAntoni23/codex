/**
 * Ayudantes de la disposición de pantalla (interfaz, 2026-11-14): los formularios
 * se abren en el inspector y las tablas viven en pestañas del panel inferior. Las
 * pruebas siguen verificando lo mismo; sólo cambia cómo se llega.
 */
import { expect, type Page } from '@playwright/test';

export type FormularioConexiones = 'enlace' | 'circuito' | 'medir';
export type Pestana = 'circuitos' | 'computo' | 'motor' | 'avisos';

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
