/**
 * Entradas de `computeRoutingPlacement` derivadas del estado del recorrido.
 * El preview (RoutingObjects), el panel (RoutingPanel) y la confirmación llaman a
 * esta misma función con el mismo estado: reciben el mismo objeto (A-1).
 */
import type { Context, TrayInput, Product } from '../../tray/model';
import { origenDeBoca } from '../derivacion/enganche';
import type { StartPort } from '../routingRules';
import { checkDirectCompatibility, snapDirectionToAxis } from '../routingRules';
import { definicionEfectiva, esTramoRecto, modeloDeProducto } from './definitions';
import { computeRoutingPlacement, type RoutingPlacement } from './routingPlacement';
import { esVerticalArticulada } from '../parametricBridge';

export interface RoutingStateSlice {
  readonly startPort: StartPort | null;
  readonly selectedProductId: string;
  readonly entryPortName: string | null;
  readonly turnDirection: 'left' | 'right';
  readonly previewLengthMm: number;
  readonly snapToAxis: boolean;
  readonly step: string;
  /** Curva vertical articulada (CUS): sentido elegido; null = sin elegir. */
  readonly sentidoVertical?: 'sube' | 'baja' | null;
}

/** Piece kinds que eligen boca de entrada (3+ bocas o curva vertical). */
export function needsEntryChoice(product: Product | null | undefined): boolean {
  const kind = modeloDeProducto(product)?.tipo;
  return kind === 'derivacion_lateral' || kind === 'cruz' || kind === 'curva_vertical';
}

export function isStraightKind(product: Product): boolean {
  return esTramoRecto(modeloDeProducto(product));
}

export function routingPlacementFromState(
  context: Context | null,
  entrada: TrayInput | null,
  r: RoutingStateSlice,
): RoutingPlacement | null {
  if (!context || !entrada || !r.startPort || r.step === 'selectingPort' || !r.selectedProductId) return null;
  const product = context.productos.find((p) => p.producto_id === r.selectedProductId);
  if (!product || !modeloDeProducto(product)?.colocable) return null;
  // CUS articulada: sin sentido elegido no hay colocación (ni previa ni confirmación).
  if (esVerticalArticulada(product) && !r.sentidoVertical) return null;
  const startPort = r.startPort;
  let entryPortName: string;
  let entryDir: readonly number[] | undefined;
  let lengthMm: number | null = null;
  if (needsEntryChoice(product)) {
    if (r.entryPortName) entryPortName = r.entryPortName;
    else {
      const d = definicionEfectiva(product);
      if (!d.ok) return null;
      entryPortName = d.def.ports[0]?.name ?? 'P1';
    }
  } else if (isStraightKind(product)) {
    // Origen: el producto de la pieza, o el recto de referencia de una boca de enganche (escalera).
    const origen = origenDeBoca(entrada, new Map(context.productos.map((p) => [p.producto_id, p])), startPort.pieceId, startPort.portName);
    const compat = origen
      ? checkDirectCompatibility(
          { compatibilidades: context.compatibilidades ?? [], componentesUnion: context.componentesUnion ?? [] },
          origen.product, origen.portName, product, 'P1',
        )
      : null;
    entryPortName = compat?.ok ? compat.newPiecePort : 'P1';
    entryDir = r.snapToAxis ? snapDirectionToAxis(startPort.dir) : startPort.dir;
    lengthMm = r.previewLengthMm > 0 ? r.previewLengthMm : null;
  } else {
    entryPortName = 'P1';
  }
  return computeRoutingPlacement({
    product,
    startPort,
    entryPortName,
    side: r.turnDirection,
    lengthMm,
    ...(entryDir ? { entryDir } : {}),
    ...(esVerticalArticulada(product) && r.sentidoVertical ? { sentidoVertical: r.sentidoVertical } : {}),
  });
}
