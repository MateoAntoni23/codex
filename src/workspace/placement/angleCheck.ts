/**
 * angleCheck — el giro que modela una pieza debe ser el que declara.
 *
 * Desde la fase A la pose se deriva de la definición: si el contorno medido
 * gira otro ángulo que el declarado, el error queda congelado en el proyecto.
 * Por eso una definición cuyo giro medido entre bocas no coincide con el
 * declarado (catálogo `angulo_grados`, guardado como `params.angulo_deg`) es un
 * modelo NO RESUELTO: no se coloca ni se dibuja como si estuviera bien.
 *
 * Giro = ángulo entre la dirección de entrada (−normal de una boca) y la de
 * salida (normal de la otra) = 180° − ángulo entre las normales exteriores.
 * Sólo aplica a piezas de dos bocas con ángulo declarado; sin ángulo declarado
 * (curvas verticales, que el catálogo no publica) no hay contra qué comparar.
 */
import type { StoredDefinition } from './placementCore';

export const TOLERANCIA_ANGULO_DEG = 0.5;

type Normal = readonly [number, number, number] | readonly number[];

/** Giro en grados entre dos bocas, a partir de sus normales exteriores. */
export function turnDegFromNormals(a: Normal, b: Normal): number {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return 180 - (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Giro medido de una definición de dos bocas; null si no tiene dos bocas. */
export function measuredTurnDeg(def: Pick<StoredDefinition, 'ports'>): number | null {
  if (def.ports.length !== 2) return null;
  return turnDegFromNormals(def.ports[0].normal, def.ports[1].normal);
}

export interface AngleMismatch {
  readonly declaradoDeg: number;
  readonly medidoDeg: number;
  readonly motivo: string;
}

/** Desacuerdo entre giro medido y declarado (> 0,5°), o null si coincide o no aplica. */
export function angleMismatch(def: Pick<StoredDefinition, 'ports' | 'params'>): AngleMismatch | null {
  const declarado = def.params.angulo_deg;
  if (typeof declarado !== 'number') return null;
  const medido = measuredTurnDeg(def);
  if (medido === null) return null;
  if (Math.abs(medido - declarado) <= TOLERANCIA_ANGULO_DEG) return null;
  return {
    declaradoDeg: declarado,
    medidoDeg: medido,
    motivo: `modelo no resuelto: el contorno medido gira ${medido.toFixed(2)}° entre bocas y la pieza declara ${declarado}° (tolerancia ${TOLERANCIA_ANGULO_DEG.toString().replace('.', ',')}°)`,
  };
}
