/**
 * routingPlacement — EL cálculo de colocación de una pieza nueva (A-1).
 *
 * El preview la dibuja y confirmar guarda este mismo resultado. Ambos llaman a
 * `computeRoutingPlacement` con las mismas entradas (tomadas del store de
 * recorrido); la función es pura y además memoriza por clave, de modo que el
 * objeto que dibuja el preview es literalmente el que se guarda.
 */
import type { Product } from '../../tray/model';
import type { StartPort } from '../routingRules';
import { resolveDefinition } from './definitions';
import {
  isHandSensitive,
  placeDefinition,
  PlacementError,
  sideOfHand,
  type ColocacionResuelta,
  type Mano,
  type StoredDefinition,
  type WorldPort,
} from './placementCore';

export type Side = 'left' | 'right';

export interface RoutingPlacementInput {
  readonly product: Product;
  readonly startPort: StartPort;
  /** Boca de la pieza nueva que se une a la existente. */
  readonly entryPortName: string;
  /** Lado elegido por el operador (sólo pesa en piezas sensibles a la mano). */
  readonly side: Side;
  /** Largo (sólo tramos rectos). */
  readonly lengthMm?: number | null;
  /** Dirección de avance (por defecto, la normal de la boca existente). */
  readonly entryDir?: readonly number[];
  /** Curva vertical articulada (CUS): si sube o baja. Las CUPS lo traen fijo (A sube, D baja). */
  readonly sentidoVertical?: 'sube' | 'baja';
}

export type RoutingPlacement =
  | {
      readonly ok: true;
      readonly def: StoredDefinition;
      readonly huella: string;
      readonly colocacion: ColocacionResuelta;
      readonly ports: readonly WorldPort[];
      readonly entryPortName: string;
      /** La pieza cambia con la mano → se muestra el selector de lado. */
      readonly handSensitive: boolean;
      /** Lado al que queda cada mano (para rotular el selector). */
      readonly sides: Readonly<Record<Mano, 'izquierda' | 'derecha' | null>>;
    }
  | { readonly ok: false; readonly motivo: string };

const cache = new Map<string, RoutingPlacement>();
const MAX_CACHE = 64;

function key(i: RoutingPlacementInput): string {
  return JSON.stringify([
    i.product.producto_id,
    i.startPort.pieceId, i.startPort.portName, i.startPort.pos, i.startPort.dir, i.startPort.sectionUp ?? null,
    i.entryPortName, i.side, i.lengthMm ?? null, i.entryDir ?? null, i.sentidoVertical ?? null,
  ]);
}

/** Mano que deja las bocas del lado pedido (nativa si la pieza es simétrica). */
function handForSide(sides: Record<Mano, 'izquierda' | 'derecha' | null>, side: Side): Mano {
  const want = side === 'left' ? 'izquierda' : 'derecha';
  if (sides.nativa === want) return 'nativa';
  if (sides.espejo === want) return 'espejo';
  return 'nativa';
}

/** Llamada pura y memorizada: preview y confirmación reciben el mismo objeto. */
export function computeRoutingPlacement(input: RoutingPlacementInput): RoutingPlacement {
  // La clave incluye la huella de la definición vigente: si cambia la biblioteca,
  // cambia la huella y se recalcula.
  const d = resolveDefinition(input.product, {
    longitud_mm: input.lengthMm ?? null,
    ...(input.sentidoVertical ? { sentido_vertical: input.sentidoVertical } : {}),
  });
  if (!d.ok) return { ok: false, motivo: d.motivo };
  const k = `${key(input)}|${d.huella}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const result = compute(input, d);
  cache.set(k, result);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return result;
}

/** Vacía la memoria (cambió la biblioteca). */
export function clearRoutingPlacementCache(): void {
  cache.clear();
}

function compute(input: RoutingPlacementInput, d: { def: StoredDefinition; huella: string }): RoutingPlacement {
  const base = {
    def: d.def,
    huella: d.huella,
    entryPortName: input.entryPortName,
    startPos: input.startPort.pos,
    entryDir: input.entryDir ?? input.startPort.dir,
    ...(input.startPort.sectionUp ? { sectionUp: input.startPort.sectionUp } : {}),
  };
  try {
    const sides = { nativa: sideOfHand(base, 'nativa'), espejo: sideOfHand(base, 'espejo') };
    const handSensitive = isHandSensitive(base);
    const mano: Mano = handSensitive ? handForSide(sides, input.side) : 'nativa';
    const { colocacion, ports } = placeDefinition({ ...base, mano });
    return { ok: true, def: d.def, huella: d.huella, colocacion, ports, entryPortName: input.entryPortName, handSensitive, sides };
  } catch (e) {
    return { ok: false, motivo: e instanceof PlacementError || e instanceof Error ? e.message : String(e) };
  }
}
