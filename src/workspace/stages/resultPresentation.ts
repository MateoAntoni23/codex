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
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isPeIssue = (s: string) => /\bPE\b/.test(s);

export function summarizeResult(result: unknown): ResultSummaryView | null {
  if (!isObj(result) || !isObj(result.resumen)) return null;
  const resumen = result.resumen;
  const estado = typeof resumen.estado_trazado === 'string' ? resumen.estado_trazado : '';
  const issues = Array.isArray(resumen.incumplimientos)
    ? resumen.incumplimientos.filter((x): x is string => typeof x === 'string')
    : [];
  const peUndefined = isObj(result.pe) && result.pe.estado_requisito === 'SIN_PE_DEFINIDO';
  const peNotes = peUndefined ? issues.filter(isPeIssue) : [];
  const designIssues = peUndefined ? issues.filter((s) => !isPeIssue(s)) : issues;

  if (estado === 'CON_INCUMPLIMIENTOS' && designIssues.length === 0 && peUndefined) {
    return { headline: 'PE sin definir', tone: 'neutral', peUndefined, designIssues, peNotes };
  }
  const headline = estado ? estado.split('_').join(' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Sin estado';
  const tone: Tone = designIssues.length > 0 || estado === 'CON_INCUMPLIMIENTOS' ? 'warn' : 'ok';
  return { headline, tone, peUndefined, designIssues, peNotes };
}
