/**
 * trayRotation — lógica pura del gizmo de rotación de piezas de bandeja (B-4).
 *
 * El gizmo (TransformControls de drei en modo `rotate`) gira un proxy invisible
 * ubicado en el pivote, en coordenadas del visor (metros, Y arriba). Acá se
 * traduce esa rotación al trazado (mm, Z arriba) y se aplica a la pieza con el
 * mismo camino que la rotación numérica del inspector (`rotatePieceAroundAxis`,
 * que transforma bocas y pose a la vez — A-8).
 *
 * Reglas de la fase A que respeta:
 *   - una rotación que deja uniones inválidas NO se confirma sola: se pide
 *     confirmación y, si se acepta, esas uniones se descartan (no quedan
 *     uniones inválidas registradas);
 *   - una rotación es UNA entrada en el historial (deshacer/rehacer).
 */
import type { Piece, TrayInput } from '../tray/model';
import { rotatePieceAroundAxis, normalizeDeg } from './pieceTransforms';
import { pieceCentroid, findBrokenConnections } from './trayMovement';

export type V3 = [number, number, number];
export type EjeMundo = 'X' | 'Y' | 'Z';

/** Paso por defecto del gizmo (grados). Con la tecla modificadora (Shift) el giro es libre. */
export const PASO_ROTACION_DEG = 15;

/** Pivote de la rotación: el centro de la pieza o una de sus bocas. */
export type PivoteRotacion = 'centro' | { boca: string };

export const EJES_MUNDO: Record<EjeMundo, V3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** Punto (mm) del pivote; null si la boca no existe. */
export function puntoPivote(piece: Piece, pivote: PivoteRotacion): V3 | null {
  if (pivote === 'centro') {
    const c = pieceCentroid(piece);
    return [c[0], c[1], c[2]];
  }
  const p = piece.puertos[pivote.boca];
  return p ? [p.posicion_mm[0], p.posicion_mm[1], p.posicion_mm[2]] : null;
}

/** mm (Z arriba) → visor (Y arriba, m). Igual que `centroidMmToViewer` de la escena. */
export function mmAVisor(mm: readonly number[]): V3 {
  return [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];
}

/**
 * Cuaternión de rotación del visor [x, y, z, w] → eje (mm, unitario) y ángulo
 * (grados, en (−180, 180]). El cambio de ejes visor→mm es una rotación propia
 * (mm = (vx, −vz, vy), determinante +1): el ángulo se conserva y el eje se
 * transforma igual que un vector.
 */
export function rotacionVisorAMm(q: readonly number[]): { eje: V3; deg: number } {
  const [x, y, z, w0] = q;
  const w = Math.max(-1, Math.min(1, w0));
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) return { eje: [0, 0, 1], deg: 0 };
  const deg = normalizeDeg((2 * Math.atan2(s, w) * 180) / Math.PI);
  const eje: V3 = [x / s, -z / s, y / s];
  // Se expresa con la componente dominante del eje positiva, para leerlo como
  // "+X/+Y/+Z" y un ángulo con signo (girar −θ sobre −e es girar θ sobre e).
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(eje[b]) > Math.abs(eje[a]) ? b : a), 0);
  return eje[k] < 0
    ? { eje: [-eje[0], -eje[1], -eje[2]], deg: normalizeDeg(-deg) }
    : { eje, deg };
}

/** Eje mundial al que corresponde `eje` (si es uno de X/Y/Z), o null. */
export function ejeMundoDe(eje: readonly number[]): EjeMundo | null {
  for (const k of ['X', 'Y', 'Z'] as const) {
    const e = EJES_MUNDO[k];
    if (Math.abs(Math.abs(e[0] * eje[0] + e[1] * eje[1] + e[2] * eje[2]) - 1) < 1e-9) return k;
  }
  return null;
}

/** Redondea al paso (si hay paso). */
export function ajustarAPaso(deg: number, pasoDeg: number | null): number {
  if (!pasoDeg) return deg;
  return Math.round(deg / pasoDeg) * pasoDeg;
}

/** Copia del trazado con la pieza rotada `deg` grados alrededor de `eje` (mm) por `pivote` (mm). */
export function rotarEnTrazado(entrada: TrayInput, pieceId: string, eje: readonly number[], deg: number, pivote: readonly number[]): TrayInput {
  const next = structuredClone(entrada);
  const idx = next.piezas.findIndex((p) => p.instancia_id === pieceId);
  if (idx < 0) return next;
  next.piezas[idx] = rotatePieceAroundAxis(next.piezas[idx], eje, deg, pivote);
  return next;
}

/**
 * Qué hacer al terminar una rotación: confirmar directo (ninguna unión deja de
 * cumplir) o pedir confirmación listando las uniones que dejarían de cumplir.
 */
export function resolverRotacion(post: TrayInput, pieceId: string): { tipo: 'confirmar' } | { tipo: 'pedir_confirmacion'; rotas: string[] } {
  const rotas = findBrokenConnections(post, pieceId);
  return rotas.length === 0 ? { tipo: 'confirmar' } : { tipo: 'pedir_confirmacion', rotas };
}
