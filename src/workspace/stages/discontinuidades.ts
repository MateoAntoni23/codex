/**
 * Discontinuidades de recorrido explicadas (etapa 3, 2026-11-14).
 *
 * El motor informa «recorridos discontinuos» como incumplimiento
 * (`trazado.py`, `_resumen`) para todo recorrido con dos piezas consecutivas que
 * no están unidas por una `conexion` (`analizar_recorrido` → `saltos_sin_conexion`).
 * Una derivación en un tramo (`derivacion/enganche.ts`) NO es una conexión del
 * trazado: el ramal (la DCPS en perforada, lo continuado en escalera) no está
 * unido al tronco por una conexión. Para el motor ese recorrido ES discontinuo, y
 * eso no se oculta ni se traduce: el resultado del motor no se modifica.
 *
 * Lo que hace la app es EXPLICARLO en el propio incumplimiento, con el mismo
 * criterio que el NO_COMPATIBLE de las mezclas de acabados:
 *   - si TODAS las discontinuidades del resultado son pares tronco ↔ ramal de una
 *     derivación en tramo que la app conoce, se dice así;
 *   - si alguna no lo es, el incumplimiento queda como está y se nombra cuál.
 * Qué afecta, sin afirmar de más: ocupación y reserva se calculan por pieza y no
 * dependen de la continuidad. La curvatura sí puede quedar sin evaluar en la pieza
 * del salto (el motor la informa NO_EVALUADO_EXTREMO_DE_RECORRIDO: p. ej. la DCPS,
 * que para el motor es una «T»); en ese caso se nombra la pieza.
 */
import type { TrayInput } from '../../tray/model';
import { enganchesOf } from '../derivacion/enganche';

export const INCUMPLIMIENTO_DISCONTINUOS = 'recorridos discontinuos';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface Salto {
  /** Circuito (circuito_id) o conductor PE (conductor_id). */
  readonly recorrido: string;
  readonly a: string;
  readonly b: string;
  /** Enganche (derivación en tramo) al que corresponde, si alguno. */
  readonly enganche: string | null;
}

/** Todos los saltos sin conexión del resultado (circuitos y conductores PE), clasificados. */
export function saltosDelResultado(result: unknown, entrada: TrayInput | null | undefined): Salto[] {
  if (!isObj(result)) return [];
  const engs = enganchesOf(entrada);
  const engDe = (a: string, b: string) => engs.find((e) => {
    const par = new Set([e.tronco, e.salida[0]]);
    return e.salida[0] !== '' && par.has(a) && par.has(b) && a !== b;
  })?.id ?? null;
  const out: Salto[] = [];
  const recorrer = (id: string, rec: unknown) => {
    if (!isObj(rec) || !Array.isArray(rec.saltos_sin_conexion)) return;
    for (const s of rec.saltos_sin_conexion) {
      if (!Array.isArray(s) || typeof s[0] !== 'string' || typeof s[1] !== 'string') continue;
      out.push({ recorrido: id, a: s[0], b: s[1], enganche: engDe(s[0], s[1]) });
    }
  };
  if (isObj(result.circuitos)) for (const [id, c] of Object.entries(result.circuitos)) if (isObj(c)) recorrer(id, c.recorrido);
  if (isObj(result.pe) && Array.isArray(result.pe.conductores)) {
    for (const c of result.pe.conductores) if (isObj(c)) recorrer(String(c.conductor_id), c.recorrido);
  }
  return out;
}

/** Piezas de los saltos en las que el motor dejó la curvatura sin evaluar por el corte del recorrido. */
function curvaturaNoEvaluada(result: unknown, saltos: readonly Salto[]): string[] {
  if (!isObj(result) || !isObj(result.circuitos)) return [];
  const out = new Set<string>();
  for (const s of saltos) {
    const c = result.circuitos[s.recorrido];
    if (!isObj(c) || !Array.isArray(c.curvatura)) continue;
    for (const k of c.curvatura) {
      if (isObj(k) && k.estado === 'NO_EVALUADO_EXTREMO_DE_RECORRIDO' && (k.instancia === s.a || k.instancia === s.b)) out.add(String(k.instancia));
    }
  }
  return [...out];
}

/**
 * Texto del incumplimiento «recorridos discontinuos» explicado, o null si el
 * resultado no lo informa o no hay saltos que explicar. `etiqueta` da el nombre
 * visible de una pieza; `nombreRecorrido`, el de un circuito.
 */
export function explicarDiscontinuos(
  result: unknown,
  entrada: TrayInput | null | undefined,
  etiqueta: (pieza: string) => string = (p) => p,
  nombreRecorrido: (id: string) => string = (id) => id,
): string | null {
  if (!isObj(result) || !isObj(result.resumen) || !Array.isArray(result.resumen.incumplimientos)) return null;
  if (!result.resumen.incumplimientos.includes(INCUMPLIMIENTO_DISCONTINUOS)) return null;
  const saltos = saltosDelResultado(result, entrada);
  if (!saltos.length) return null;
  const otras = saltos.filter((s) => s.enganche === null);
  const n = saltos.length;
  if (otras.length === 0) {
    const sinCurv = curvaturaNoEvaluada(result, saltos);
    const efecto = sinCurv.length
      ? `no afecta ocupación ni reserva; el motor no evaluó la curvatura en ${sinCurv.map(etiqueta).join(', ')}`
      : 'no afecta ocupación, reserva ni curvatura';
    return n === 1
      ? `${INCUMPLIMIENTO_DISCONTINUOS}: la discontinuidad corresponde a una derivación en tramo; el motor no la modela como conexión (${efecto})`
      : `${INCUMPLIMIENTO_DISCONTINUOS}: las ${n} discontinuidades corresponden a derivaciones en tramo; el motor no las modela como conexión (${efecto})`;
  }
  const lista = otras.map((s) => `${nombreRecorrido(s.recorrido)} entre ${etiqueta(s.a)} y ${etiqueta(s.b)}`).join('; ');
  return `${INCUMPLIMIENTO_DISCONTINUOS}: ${otras.length} de ${n} no ${otras.length === 1 ? 'corresponde' : 'corresponden'} a una derivación en tramo: ${lista}`;
}

/** Los incumplimientos del motor con el de discontinuidades explicado (el resultado no se modifica). */
export function incumplimientosExplicados(
  incumplimientos: readonly string[],
  explicacion: string | null,
): string[] {
  return explicacion ? incumplimientos.map((s) => (s === INCUMPLIMIENTO_DISCONTINUOS ? explicacion : s)) : [...incumplimientos];
}
