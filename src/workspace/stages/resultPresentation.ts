/**
 * resultPresentation — cómo se lee el estado del trazado en Resultados.
 *
 * Sin PE definido el motor devuelve `estado_trazado: CON_INCUMPLIMIENTOS` con
 * incumplimientos de PE ("cobertura del PE incompleta", "PE sin conexión al
 * sistema de protección"). Es correcto, pero no es un defecto del diseño: el
 * requisito de PE todavía no se cargó. El motor lo informa explícitamente en
 * `resultado.pe.estado_requisito === 'SIN_PE_DEFINIDO'`.
 *
 * Regla: con ese estado, los incumplimientos de PE se muestran aparte como
 * "PE sin definir" (tono neutro). Si no queda ningún otro incumplimiento, el
 * estado se lee "PE sin definir" y no "con incumplimientos".
 *
 * MEZCLA DE ACABADOS (mezclaAcabados.ts): el motor (vendorizado, no se toca)
 * aplica REV-032 y declara NO_COMPATIBLE una unión entre acabados distintos del
 * mismo tipo de bandeja. La decisión del operador ("declarado por el operador,
 * contradice REV-032 (fuente del catálogo)") la permite con un AVISO. Regla: si
 * TODAS las conexiones NO_COMPATIBLE del resultado son por REV-032 y la app las
 * marcó como mezcla (`conexionesMezcla`), "conexiones no compatibles" sale de los
 * incumplimientos y esas conexiones se informan aparte (`mezclaNotes`). Si queda
 * alguna NO_COMPATIBLE por otro motivo, el incumplimiento se mantiene.
 */
export type Tone = 'ok' | 'neutral' | 'warn';

export interface ResultSummaryView {
  /** Texto principal del estado. */
  headline: string;
  tone: Tone;
  /** `true` si el motor reporta que no hay requisito de PE cargado. */
  peUndefined: boolean;
  /** Incumplimientos que SÍ son del diseño (excluye los de PE cuando no está definido). */
  designIssues: string[];
  /** Incumplimientos de PE reclasificados como "PE sin definir". */
  peNotes: string[];
  /** Conexiones que el motor da NO_COMPATIBLE por REV-032 y son mezcla de acabados declarada (aviso). */
  mezclaNotes: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isPeIssue = (s: string) => /\bPE\b/.test(s);

import type { Product, TrayInput } from '../../tray/model';
import { conexionesConMezcla } from '../mezclaAcabados';

/** summarizeResult con las mezclas de acabados del trazado (lo que usan las vistas). */
export function summarizeResultDe(result: unknown, entrada: TrayInput | null | undefined, productos: readonly Product[] | undefined): ResultSummaryView | null {
  return summarizeResult(result, conexionesConMezcla(entrada, new Map((productos ?? []).map((p) => [p.producto_id, p]))));
}

export const INCUMPLIMIENTO_NO_COMPATIBLES = 'conexiones no compatibles';

/** ¿El motor dio NO_COMPATIBLE a esta conexión por REV-032 (regla de familia o fila de REV-032)? */
function noCompatiblePorREV032(c: unknown): boolean {
  if (!isObj(c) || !isObj(c.compatibilidad) || c.compatibilidad.estado !== 'NO_COMPATIBLE') return false;
  const cond = Array.isArray(c.compatibilidad.condiciones) ? c.compatibilidad.condiciones : [];
  const obs = isObj(c.compatibilidad.registro) ? String(c.compatibilidad.registro.observaciones ?? '') : '';
  return cond.includes('REGLA_DE_FAMILIA_REV-032') || /REV-032/.test(obs);
}

const legible = (estado: string) => estado.split('_').join(' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function summarizeResult(result: unknown, conexionesMezcla: ReadonlySet<string> = new Set()): ResultSummaryView | null {
  if (!isObj(result) || !isObj(result.resumen)) return null;
  const resumen = result.resumen;
  const estado = typeof resumen.estado_trazado === 'string' ? resumen.estado_trazado : '';
  const issues = Array.isArray(resumen.incumplimientos)
    ? resumen.incumplimientos.filter((x): x is string => typeof x === 'string')
    : [];
  const peUndefined = isObj(result.pe) && result.pe.estado_requisito === 'SIN_PE_DEFINIDO';
  const peNotes = peUndefined ? issues.filter(isPeIssue) : [];
  let designIssues = peUndefined ? issues.filter((s) => !isPeIssue(s)) : issues;

  // Mezcla de acabados declarada: NO_COMPATIBLE por REV-032 → aviso, sólo si son TODAS las NO_COMPATIBLE.
  const conex = isObj(result.conexiones) ? Object.entries(result.conexiones) : [];
  const noCompat = conex.filter(([, c]) => isObj(c) && isObj(c.compatibilidad) && c.compatibilidad.estado === 'NO_COMPATIBLE');
  const porMezcla = noCompat.filter(([id, c]) => conexionesMezcla.has(id) && noCompatiblePorREV032(c)).map(([id]) => id);
  const mezclaNotes = noCompat.length > 0 && porMezcla.length === noCompat.length ? porMezcla : [];
  if (mezclaNotes.length) designIssues = designIssues.filter((s) => s !== INCUMPLIMIENTO_NO_COMPATIBLES);

  if (estado === 'CON_INCUMPLIMIENTOS' && designIssues.length === 0 && peUndefined) {
    return { headline: 'PE sin definir', tone: 'neutral', peUndefined, designIssues, peNotes, mezclaNotes };
  }
  // Sin incumplimientos que queden: el estado es el que el motor daría sin ellos (misma regla que el motor).
  const sinIncumplimientos = estado === 'CON_INCUMPLIMIENTOS' && designIssues.length === 0 && mezclaNotes.length > 0;
  const bloqueado = (Array.isArray(resumen.decisiones_que_bloquean) && resumen.decisiones_que_bloquean.length > 0)
    || (Array.isArray(resumen.verificaciones_bloqueadas) && resumen.verificaciones_bloqueadas.length > 0);
  const estadoLeido = sinIncumplimientos ? (bloqueado ? 'CON_BLOQUEOS' : 'PRESELECCION_CONDICIONADA') : estado;
  const headline = estadoLeido ? legible(estadoLeido) : 'Sin estado';
  const tone: Tone = designIssues.length > 0 || estadoLeido === 'CON_INCUMPLIMIENTOS' || mezclaNotes.length > 0 ? 'warn' : 'ok';
  return { headline, tone, peUndefined, designIssues, peNotes, mezclaNotes };
}
