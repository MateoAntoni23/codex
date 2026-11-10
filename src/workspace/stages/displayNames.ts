/**
 * displayNames — nombres que ve el operador (decisión 3d).
 *
 * Regla: no mostrar identificadores internos cuando existe un nombre legible, y
 * no inventar etiquetas.
 *   - Pieza: SKU comercial del producto (`sku`), con el número de orden en la
 *     lista para distinguir piezas iguales. Si el producto no está en el catálogo,
 *     se muestra el `instancia_id` (no hay nada legible que mostrar).
 *   - Boca: `physicalLabel` del maestro (masterModels) cuando el producto tiene
 *     maestro y la boca está declarada; si no, el nombre de la boca tal cual.
 *   - Producto: SKU; descripción como texto secundario.
 */
import type { Piece, Product } from '../../tray/model';
import { findMasterForProduct } from '../../configurator/masterModels';

export type ProductIndex = ReadonlyMap<string, Product>;

export function indexProducts(productos: readonly Product[] | undefined): ProductIndex {
  return new Map((productos ?? []).map((p) => [p.producto_id, p]));
}

export function productLabel(productoId: string, idx: ProductIndex): string {
  const p = idx.get(productoId);
  return p && typeof p.sku === 'string' && p.sku ? p.sku : productoId;
}

export function productDescription(productoId: string, idx: ProductIndex): string | null {
  const d = idx.get(productoId)?.descripcion_original;
  return typeof d === 'string' && d ? d : null;
}

/** Etiqueta de una pieza: «n. SKU». `n` es la posición 1-based en el trazado. */
export function pieceLabel(piece: Piece, position: number, idx: ProductIndex): string {
  const p = idx.get(piece.producto_id);
  if (!p || typeof p.sku !== 'string' || !p.sku) return piece.instancia_id;
  return `${position}. ${p.sku}`;
}

/** Etiqueta de una pieza buscándola por id dentro del trazado. */
export function pieceLabelById(id: string, piezas: readonly Piece[], idx: ProductIndex): string {
  const i = piezas.findIndex((p) => p.instancia_id === id);
  return i < 0 ? id : pieceLabel(piezas[i], i + 1, idx);
}

/** Nombre físico de una boca (physicalLabel del maestro) o el nombre de la boca. */
export function portLabel(productoId: string, portName: string, idx: ProductIndex): string {
  const product = idx.get(productoId);
  if (!product) return portName;
  const master = findMasterForProduct(product as Record<string, unknown>);
  const entry = master?.ports.find(
    (p) => p.recipePortName === portName || p.catalogPortName === portName,
  );
  return entry?.physicalLabel || portName;
}
