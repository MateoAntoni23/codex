/**
 * Entradas de `computeRoutingPlacement` derivadas del estado del recorrido.
 * El preview (RoutingObjects), el panel (RoutingPanel) y la confirmación llaman a
 * esta misma función con el mismo estado: reciben el mismo objeto (A-1).
 */
import type { Context, TrayInput, Product } from '../../tray/model';
import type { StartPort } from '../routingRules';
import { checkDirectCompatibility, snapDirectionToAxis } from '../routingRules';
import { resolveRecipe, buildRecipeFromProduct } from '../parametricBridge';
import { computeRoutingPlacement, type RoutingPlacement } from './routingPlacement';

export interface RoutingStateSlice {
  readonly startPort: StartPort | null;
  readonly selectedProductId: string;
  readonly entryPortName: string | null;
  readonly turnDirection: 'left' | 'right';
  readonly previewLengthMm: number;
  readonly snapToAxis: boolean;
  readonly step: string;
}

/** Piece kinds que eligen boca de entrada (3+ bocas o curva vertical). */
export function needsEntryChoice(product: Product | null | undefined): boolean {
  const kind = product ? resolveRecipe(product)?.piece_kind : undefined;
  return kind === 'derivacion_lateral' || kind === 'cruz' || kind === 'curva_vertical';
}

export function isStraightKind(product: Product): boolean {
  const e = resolveRecipe(product);
  return e?.piece_kind === 'tramo_recto' || e?.recipe === 'escalera:tramo_recto';
}

export function routingPlacementFromState(
  context: Context | null,
  entrada: TrayInput | null,
  r: RoutingStateSlice,
): RoutingPlacement | null {
  if (!context || !entrada || !r.startPort || r.step === 'selectingPort' || !r.selectedProductId) return null;
  const product = context.productos.find((p) => p.producto_id === r.selectedProductId);
  if (!product || !resolveRecipe(product)) return null;
  const startPort = r.startPort;
  let entryPortName: string;
  let entryDir: readonly number[] | undefined;
  let lengthMm: number | null = null;
  if (needsEntryChoice(product)) {
    if (r.entryPortName) entryPortName = r.entryPortName;
    else {
      try {
        entryPortName = buildRecipeFromProduct(product, resolveRecipe(product)!).ports[0]?.name ?? 'P1';
      } catch {
        return null;
      }
    }
  } else if (isStraightKind(product)) {
    const existing = entrada.piezas.find((p) => p.instancia_id === startPort.pieceId);
    const existingProduct = context.productos.find((p) => p.producto_id === existing?.producto_id);
    const compat = existingProduct
      ? checkDirectCompatibility(
          { compatibilidades: context.compatibilidades ?? [], componentesUnion: context.componentesUnion ?? [] },
          existingProduct, startPort.portName, product, 'P1',
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
  });
}
