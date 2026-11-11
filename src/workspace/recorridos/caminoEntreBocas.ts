/**
 * Recorrido entre dos bocas del trazado colocado, con su longitud.
 *
 * Qué hace:
 *   - busca el camino por las piezas UNIDAS desde la boca de origen hasta la
 *     boca de destino (el menor número de piezas; cada pieza se cruza una vez);
 *   - no atraviesa uniones que no cumplen la verificación (A-7 + sección B-3):
 *     si sólo ellas cortan el camino, lo dice y por qué;
 *   - suma la longitud de cada pieza cruzada SOLO con lo persistido en el
 *     trazado (no se vuelve a inferir geometría del catálogo ni del modelo):
 *       · tramo recto: `longitud_mm`;
 *       · pieza de dos bocas con `longitud_eje_mm` guardada: esa longitud;
 *       · cruce en línea recta (las bocas de entrada y salida opuestas y
 *         alineadas, p. ej. el tronco de una T o una X): distancia entre los
 *         centros guardados de las dos bocas;
 *       · cualquier otro cruce (desvío en una pieza sin longitud de eje
 *         guardada): longitud desconocida, con motivo. El total queda
 *         incompleto y se informa como tal, nunca como un número cerrado.
 *
 * Por qué en el frontend: el motor no busca caminos (los recorridos de los
 * circuitos le llegan explícitos) y sólo suma longitudes de eje por pieza para
 * los conductores PE (D-27), sin distinguir por qué bocas se cruza una T.
 */
import type { Piece, TrayInput } from '../../tray/model';
import { checkConnection } from '../placement/joins';

export interface Boca { readonly pieza: string; readonly boca: string }

export type FuenteLongitud = 'longitud_mm' | 'longitud_eje_mm' | 'bocas_en_linea';

export interface Cruce {
  readonly pieza: string;
  readonly entrada: string;
  readonly salida: string;
  readonly longitudMm: number | null;
  readonly fuente: FuenteLongitud | null;
  /** Por qué no hay longitud (si longitudMm es null). */
  readonly motivo?: string;
}

export interface UnionCortada { readonly conexion_id: string; readonly motivos: readonly string[] }

export type ResultadoCamino =
  | {
      readonly ok: true;
      readonly cruces: readonly Cruce[];
      readonly uniones: readonly string[];
      /** Suma de las longitudes conocidas (mm). */
      readonly sumaMm: number;
      /** true si todas las piezas tienen longitud: sólo entonces sumaMm es la longitud total. */
      readonly completa: boolean;
    }
  | { readonly ok: false; readonly motivo: string; readonly unionesCortadas: readonly UnionCortada[] };

/** Tolerancias para "cruce en línea recta": las de unión del motor (D-14). */
const TOL_ALINEACION_DEG = 1;
const TOL_ALINEACION_MM = 1;

const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);

/** Longitud de la pieza entre las bocas `e` y `s`, sólo con lo persistido. */
export function longitudDeCruce(piece: Piece, e: string, s: string): Pick<Cruce, 'longitudMm' | 'fuente' | 'motivo'> {
  const n = Object.keys(piece.puertos).length;
  if (n === 2 && typeof piece.longitud_mm === 'number') return { longitudMm: piece.longitud_mm, fuente: 'longitud_mm' };
  if (n === 2 && typeof piece.longitud_eje_mm === 'number') return { longitudMm: piece.longitud_eje_mm, fuente: 'longitud_eje_mm' };
  const pe = piece.puertos[e];
  const ps = piece.puertos[s];
  const d = sub(ps.posicion_mm, pe.posicion_mm);
  const L = norm(d);
  // En línea: direcciones salientes opuestas y el segmento entre centros sobre ese eje.
  const opuestas = dot(pe.direccion, ps.direccion) / (norm(pe.direccion) * norm(ps.direccion));
  const sobreEje = L > 0 ? Math.abs(dot(d, ps.direccion)) / norm(ps.direccion) : 0;
  const desvioLateral = Math.sqrt(Math.max(0, L * L - sobreEje * sobreEje));
  if (opuestas <= -Math.cos((TOL_ALINEACION_DEG * Math.PI) / 180) && desvioLateral <= TOL_ALINEACION_MM) {
    return { longitudMm: L, fuente: 'bocas_en_linea' };
  }
  return { longitudMm: null, fuente: null, motivo: `desvío de ${e} a ${s}: la pieza no tiene guardada su longitud de eje` };
}

/** Uniones del trazado que salen de la boca (pieza, boca). */
function unionesDe(entrada: TrayInput, b: Boca) {
  const out: Array<{ conexion_id: string; otra: Boca }> = [];
  for (const c of entrada.conexiones) {
    if (c.a[0] === b.pieza && c.a[1] === b.boca) out.push({ conexion_id: c.conexion_id, otra: { pieza: c.b[0], boca: c.b[1] } });
    else if (c.b[0] === b.pieza && c.b[1] === b.boca) out.push({ conexion_id: c.conexion_id, otra: { pieza: c.a[0], boca: c.a[1] } });
  }
  return out;
}

/** Estado de la búsqueda: pieza, boca por la que se entró, y cómo se llegó. */
type Paso = { pieza: string; entrada: string; previo: Paso | null; union: string | null; salidaPrevia: string | null };

/**
 * BFS por piezas (cada una se cruza una vez); `atravesarInvalidas` sólo se usa
 * para explicar un corte. El camino puede salir del origen cruzando su pieza o
 * directamente por una unión de la boca de origen, y llega al destino saliendo
 * por la boca de destino o entrando a ella por una unión (sin cruzar su pieza).
 */
function buscar(entrada: TrayInput, origen: Boca, destino: Boca, atravesarInvalidas: boolean, cortadas: Map<string, UnionCortada>):
  { pasos: Array<{ pieza: string; entrada: string; salida: string }>; uniones: string[] } | null {
  const piezas = new Map(entrada.piezas.map((p) => [p.instancia_id, p]));
  const visitadas = new Set<string>([origen.pieza]);
  const reconstruir = (fin: Paso | null, salida: string, unionFinal: string | null) => {
    const pasos: Array<{ pieza: string; entrada: string; salida: string }> = [];
    const uniones: string[] = unionFinal ? [unionFinal] : [];
    let s: string = salida;
    for (let p: Paso | null = fin; p; p = p.previo) {
      pasos.unshift({ pieza: p.pieza, entrada: p.entrada, salida: s });
      if (p.union) uniones.unshift(p.union);
      s = p.salidaPrevia ?? '';
    }
    return { pasos, uniones };
  };
  /** Uniones atravesables desde una boca (registra las que no cumplen). */
  const salidasPorUnion = (desde: Boca) => unionesDe(entrada, desde).filter((u) => {
    const chk = checkConnection(entrada, { a: [desde.pieza, desde.boca], b: [u.otra.pieza, u.otra.boca] });
    if (chk && chk.ok) return true;
    cortadas.set(u.conexion_id, { conexion_id: u.conexion_id, motivos: chk ? chk.motivos : ['falta una de las bocas de la unión'] });
    return atravesarInvalidas;
  });
  const esDestino = (b: Boca) => b.pieza === destino.pieza && b.boca === destino.boca;

  const cola: Paso[] = [{ pieza: origen.pieza, entrada: origen.boca, previo: null, union: null, salidaPrevia: null }];
  for (const u of salidasPorUnion(origen)) {
    if (esDestino(u.otra)) return reconstruir(null, '', u.conexion_id);
    if (visitadas.has(u.otra.pieza)) continue;
    visitadas.add(u.otra.pieza);
    cola.push({ pieza: u.otra.pieza, entrada: u.otra.boca, previo: null, union: u.conexion_id, salidaPrevia: null });
  }
  while (cola.length) {
    const actual = cola.shift()!;
    const pieza = piezas.get(actual.pieza);
    if (!pieza) continue;
    for (const salida of Object.keys(pieza.puertos)) {
      if (salida === actual.entrada) continue;
      if (esDestino({ pieza: actual.pieza, boca: salida })) return reconstruir(actual, salida, null);
      for (const u of salidasPorUnion({ pieza: actual.pieza, boca: salida })) {
        if (esDestino(u.otra)) return reconstruir(actual, salida, u.conexion_id);
        if (visitadas.has(u.otra.pieza)) continue;
        visitadas.add(u.otra.pieza);
        cola.push({ pieza: u.otra.pieza, entrada: u.otra.boca, previo: actual, union: u.conexion_id, salidaPrevia: salida });
      }
    }
  }
  return null;
}

export function caminoEntreBocas(entrada: TrayInput, origen: Boca, destino: Boca): ResultadoCamino {
  const piezas = new Map(entrada.piezas.map((p) => [p.instancia_id, p]));
  for (const [rol, b] of [['origen', origen], ['destino', destino]] as const) {
    const p = piezas.get(b.pieza);
    if (!p) return { ok: false, motivo: `el ${rol} no existe en el trazado (pieza ${b.pieza})`, unionesCortadas: [] };
    if (!p.puertos[b.boca]) return { ok: false, motivo: `el ${rol} no existe en el trazado (boca ${b.boca} de ${b.pieza})`, unionesCortadas: [] };
  }
  if (origen.pieza === destino.pieza && origen.boca === destino.boca) {
    return { ok: false, motivo: 'origen y destino son la misma boca', unionesCortadas: [] };
  }
  const cortadas = new Map<string, UnionCortada>();
  const r = buscar(entrada, origen, destino, false, cortadas);
  if (!r) {
    const conInvalidas = buscar(entrada, origen, destino, true, new Map());
    if (conInvalidas) {
      const enElCamino = conInvalidas.uniones.filter((u) => cortadas.has(u)).map((u) => cortadas.get(u)!);
      return {
        ok: false,
        motivo: `no hay camino por uniones válidas: ${enElCamino.length === 1 ? 'la unión' : 'las uniones'} ${enElCamino.map((u) => u.conexion_id).join(', ')} no ${enElCamino.length === 1 ? 'cumple' : 'cumplen'} la verificación y no se atraviesa${enElCamino.length === 1 ? '' : 'n'}`,
        unionesCortadas: enElCamino,
      };
    }
    return { ok: false, motivo: 'no hay camino: origen y destino no están unidos por piezas del trazado', unionesCortadas: [] };
  }
  const cruces: Cruce[] = r.pasos.map((p) => ({ ...p, ...longitudDeCruce(piezas.get(p.pieza)!, p.entrada, p.salida) }));
  const sumaMm = cruces.reduce((acc, c) => acc + (c.longitudMm ?? 0), 0);
  return { ok: true, cruces, uniones: r.uniones, sumaMm, completa: cruces.every((c) => c.longitudMm !== null) };
}
