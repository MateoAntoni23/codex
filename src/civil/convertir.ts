/**
 * Cliente de la conversión STEP → malla (servicio local, server/civil_step.py).
 *
 * La conversión corre en el Python del servicio (CadQuery), detrás del mismo proxy
 * que el cálculo. Si el servicio no está o la conversión falla, se dice por qué.
 */
import type { MallaCivil } from './modelo';

export const RUTA_CONVERTIR = '/api/motor/v1/civil/convertir';

export type ResultadoConversion = { ok: true; malla: MallaCivil } | { ok: false; motivo: string };

export async function convertirStep(archivo: Blob): Promise<ResultadoConversion> {
  let res: Response;
  try {
    res = await fetch(RUTA_CONVERTIR, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
  } catch (e) {
    return { ok: false, motivo: `El servicio local no responde (¿está apagado?): ${e instanceof Error ? e.message : String(e)}. La conversión de STEP corre en el servicio del motor.` };
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* sin JSON: proxy sin servicio detrás */ }
  const err = (body as { error?: { codigo?: string; mensaje?: string } } | null)?.error;
  if (!res.ok) {
    // Un servicio de una versión anterior (levantado antes de agregar la conversión) no tiene la ruta.
    if (err?.codigo === 'RUTA_INEXISTENTE') {
      return { ok: false, motivo: 'El servicio local que está corriendo es de una versión anterior y no tiene la conversión de STEP: reinicialo (npm run dev:trays) y volvé a importar.' };
    }
    if (err?.mensaje) return { ok: false, motivo: `No se pudo convertir el STEP: ${err.mensaje}` };
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500) {
      return { ok: false, motivo: `El servicio local no responde (respuesta ${res.status}): la conversión de STEP corre en el servicio del motor; levantalo y volvé a importar.` };
    }
    return { ok: false, motivo: `No se pudo convertir el STEP (respuesta ${res.status}).` };
  }
  const malla = (body as { malla?: MallaCivil } | null)?.malla;
  if (!malla || malla.version !== 'codex:civilMalla/1') return { ok: false, motivo: 'El servicio respondió sin una malla válida.' };
  return { ok: true, malla };
}
