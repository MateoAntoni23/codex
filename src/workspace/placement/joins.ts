/**
 * joins — verificación geométrica de uniones (A-7).
 *
 * Una unión entre la boca A y la boca B es válida si:
 *   - distancia entre centros ≤ D-14 posición (1 mm);
 *   - ángulo entre la normal de A y la opuesta de la normal de B ≤ D-14 ángulo (1°);
 *   - ángulo entre las orientaciones transversales (fondo de bandeja hacia arriba)
 *     de A y B ≤ D-14 ángulo (1°), SIN módulo 180° (una sección invertida no une).
 *
 * Las tolerancias se leen de `decisiones_producto.json` del motor: el frontend no
 * puede ser más permisivo que el motor.
 */
import decisiones from '../../../vendor/motor_bandejas/datos/decisiones_producto.json';
import type { Piece, TrayInput } from '../../tray/model';
import { angleDeg, type V3 } from './placementCore';

const dec = decisiones as Record<string, unknown>;
export const TOL_POS_MM = Number(dec['D-14_tolerancia_posicion_mm']);
export const TOL_ANG_DEG = Number(dec['D-14_tolerancia_angulo_grados']);

export interface JoinCheck {
  readonly ok: boolean;
  /** Distancia entre centros (mm). */
  readonly huecoMm: number;
  /** Ángulo entre normal A y −normal B (°). */
  readonly anguloDeg: number;
  /** Giro: ángulo entre orientaciones transversales (°); null si alguna falta. */
  readonly giroDeg: number | null;
  readonly motivos: string[];
  /** Avisos que no invalidan (p. ej. giro no verificable en piezas heredadas sin orientación). */
  readonly avisos: string[];
}

type PortLike = { posicion_mm: readonly number[]; direccion: readonly number[]; orientacion_seccion_ws?: readonly number[] };

export function checkJoin(a: PortLike, b: PortLike): JoinCheck {
  const d = [0, 1, 2].map((i) => a.posicion_mm[i] - b.posicion_mm[i]);
  const huecoMm = Math.hypot(d[0], d[1], d[2]);
  const anguloDeg = angleDeg(a.direccion, (b.direccion as number[]).map((x) => -x));
  const giroDeg = a.orientacion_seccion_ws && b.orientacion_seccion_ws
    ? angleDeg(a.orientacion_seccion_ws, b.orientacion_seccion_ws)
    : null;
  const motivos: string[] = [];
  if (huecoMm > TOL_POS_MM) motivos.push(`hueco ${huecoMm.toFixed(2)} mm > ${TOL_POS_MM} mm`);
  if (anguloDeg > TOL_ANG_DEG) motivos.push(`ángulo ${anguloDeg.toFixed(2)}° > ${TOL_ANG_DEG}°`);
  const avisos: string[] = [];
  // Una pieza heredada sin orientación transversal guardada (y sin pose) no
  // permite verificar el giro: se informa como "no verificable", no se inventa.
  if (giroDeg === null) avisos.push('giro no verificable: una de las bocas no tiene orientación transversal');
  else if (giroDeg > TOL_ANG_DEG) motivos.push(`giro ${giroDeg.toFixed(2)}° > ${TOL_ANG_DEG}°`);
  return { ok: motivos.length === 0, huecoMm, anguloDeg, giroDeg, motivos, avisos };
}

/** Verifica una conexión del trazado; null si falta alguna pieza o boca. */
export function checkConnection(entrada: TrayInput, c: { a: [string, string]; b: [string, string] }): JoinCheck | null {
  const pa = entrada.piezas.find((p) => p.instancia_id === c.a[0]);
  const pb = entrada.piezas.find((p) => p.instancia_id === c.b[0]);
  const A = pa?.puertos[c.a[1]];
  const B = pb?.puertos[c.b[1]];
  if (!A || !B) return null;
  return checkJoin(A as PortLike, B as PortLike);
}

/** Conexiones que involucran a `pieceIds` y no cumplen A-7 (o perdieron una boca). */
export function invalidConnections(entrada: TrayInput, pieceIds?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const c of entrada.conexiones) {
    if (pieceIds && !pieceIds.has(c.a[0]) && !pieceIds.has(c.b[0])) continue;
    const r = checkConnection(entrada, c);
    if (!r || !r.ok) out.push(c.conexion_id);
  }
  return out;
}

export function formatJoin(r: JoinCheck): string {
  return `hueco ${r.huecoMm.toFixed(2)} mm · ángulo ${r.anguloDeg.toFixed(2)}° · giro ${r.giroDeg === null ? 'no verificable' : `${r.giroDeg.toFixed(2)}°`}`;
}

export type { V3, Piece };
