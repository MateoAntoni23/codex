/**
 * Centralized tipo_pieza classification.
 *
 * Catalog snapshot uses 24 distinct `tipo_pieza` string values. Scattering
 * `=== 'curva'` or `=== 'recta'` checks across the codebase caused false
 * negatives (e.g. catalog says 'curva horizontal', not 'curva'). This module
 * is the single source of truth: predicates preserve the original catalog
 * string in the product and never alias it.
 *
 * Matrix (familia / tipo real / motor de catálogo / UI / geometría / motivo):
 *
 *   SAM-STE-G, SAM-STE-Z, SAM-STP-Z, SAM-STP-ZN, FAMIQ-ALAMBRE-INOX
 *     recta               → sí   sí    sí   —
 *     curva horizontal    → sí   sí    sí   —
 *     curva vertical ×3   → sí   sí    NO   geometría 3-D pendiente (E3+)
 *     T                   → sí   sí    NO   topología multi-puerto pendiente
 *     X                   → sí   sí    NO   topología multi-puerto pendiente
 *     reducción           → sí   sí    vía reducción flow   — (usa StepConfirmingReduction)
 *     adaptador           → sí   sí    NO   extremo A→B heterogéneo pendiente
 *     final de tramo      → sí   sí    NO   cierre/stub pendiente
 *     tapa                → sí   NO    —    cubierta: no es pieza recorrible
 *     piso                → sí   NO    —    fondo: no es pieza recorrible
 *   SAM-SMT-ACC, SAM-PERF-C, GEN-FERR, SAM-ESC-TRL
 *     soporte/ménsula/trapecio/etc. → NO reconocible como pieza del trazado
 *                                      (familia de accesorios/soportes/perfilería)
 *
 * Origen: vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json
 */
import type { Product } from '../tray/model';

export const KNOWN_TIPO_PIEZA = new Set<string>([
  'T',
  'X',
  'abrazadera/grampa',
  'adaptador',
  'curva horizontal',
  'curva vertical articulada',
  'curva vertical exterior',
  'curva vertical interior',
  'final de tramo',
  'kit de suspensión',
  'ménsula',
  'otro',
  'perfil/riel',
  'piso',
  'placa de fijación',
  'recta',
  'reducción',
  'separador',
  'soporte',
  'tapa',
  'tornillería',
  'trapecio/travesaño',
  'unión',
  'varilla roscada',
]);

/**
 * Walkable = la pieza forma parte del trazado del cable (entra en puertos,
 * continúa el recorrido). Excluye tapas, pisos, soportes y accesorios/ferretería.
 */
export const WALKABLE_TIPO_PIEZA = new Set<string>([
  'recta',
  'curva horizontal',
  'curva vertical articulada',
  'curva vertical exterior',
  'curva vertical interior',
  'T',
  'X',
  'reducción',
  'adaptador',
  'unión',
  'final de tramo',
]);

/**
 * Types with geometry constructor implemented in the interactive routing flow.
 * Other walkable types are catalog-recognized but not yet insertable from the UI.
 */
export const INSERTABLE_TIPO_PIEZA = new Set<string>([
  'recta',
  'curva horizontal',
]);

// ─── Predicates (take the catalog Product; preserve original tipo_pieza) ────

export function isStraight(product: Pick<Product, 'tipo_pieza'> | null | undefined): boolean {
  return product?.tipo_pieza === 'recta';
}

export function isHorizontalCurve(product: Pick<Product, 'tipo_pieza'> | null | undefined): boolean {
  return product?.tipo_pieza === 'curva horizontal';
}

export function isVerticalCurve(product: Pick<Product, 'tipo_pieza'> | null | undefined): boolean {
  const t = product?.tipo_pieza;
  return t === 'curva vertical articulada' || t === 'curva vertical exterior' || t === 'curva vertical interior';
}

export function isCurve(product: Pick<Product, 'tipo_pieza'> | null | undefined): boolean {
  return isHorizontalCurve(product) || isVerticalCurve(product);
}

export function isWalkable(product: Pick<Product, 'tipo_pieza'> | null | undefined): boolean {
  return product != null && WALKABLE_TIPO_PIEZA.has(product.tipo_pieza);
}

/** True when the interactive routing flow can place this product directly. */
export function isInteractivelyInsertable(product: Pick<Product, 'tipo_pieza'> | null | undefined): boolean {
  return product != null && INSERTABLE_TIPO_PIEZA.has(product.tipo_pieza);
}

/**
 * Returns a human-readable Spanish reason when a walkable product cannot yet be
 * inserted via the current flow, or null when the product is fully supported.
 * Returns a distinct message for non-walkable catalog types.
 */
export function getLimitationReason(product: Pick<Product, 'tipo_pieza'> | null | undefined): string | null {
  if (!product) return 'Producto no encontrado en el catálogo.';
  const t = product.tipo_pieza;
  if (!KNOWN_TIPO_PIEZA.has(t)) {
    return `Tipo de pieza "${t}" no reconocido por el catálogo cargado.`;
  }
  if (INSERTABLE_TIPO_PIEZA.has(t)) return null;
  if (t === 'reducción') {
    return 'Las reducciones se insertan automáticamente cuando el ancho cambia — no se eligen como continuación directa.';
  }
  if (isVerticalCurve(product)) {
    return 'Curvas verticales aún no soportadas en el trazado interactivo (geometría 3-D pendiente).';
  }
  if (t === 'T' || t === 'X') {
    return `Piezas tipo "${t}" aún no soportadas en el trazado interactivo (topología multi-puerto pendiente).`;
  }
  if (t === 'adaptador') {
    return 'Adaptadores aún no soportados en el trazado interactivo (geometría entre perfiles pendiente).';
  }
  if (t === 'unión') {
    return 'Las uniones se agregan automáticamente al conectar piezas compatibles — no se eligen como continuación directa.';
  }
  if (t === 'final de tramo') {
    return 'Finales de tramo aún no soportados en el trazado interactivo (cierre del trazado pendiente).';
  }
  if (!WALKABLE_TIPO_PIEZA.has(t)) {
    return `"${t}" no forma parte del trazado del cable (es tapa/piso/soporte/accesorio) y no puede continuar un tramo.`;
  }
  return `Tipo "${t}" no disponible en el trazado interactivo todavía.`;
}

// ─── Human-readable label for the selector ──────────────────────────────────

/**
 * Builds the option label for the compatibility selector.
 * Preserves the raw catalog string in the data; labels are purely cosmetic.
 */
export function formatProductOption(product: Product): string {
  const anc = product.ancho_nominal_mm ?? '?';
  const ala = (product as Record<string, unknown>).ala_nominal_mm as number | null | undefined;
  const alaStr = ala != null ? ` × ${ala} mm ala` : '';
  if (isHorizontalCurve(product)) {
    const ang = (product as Record<string, unknown>).angulo_grados;
    const rad = (product as Record<string, unknown>).radio_mm;
    return `Curva horiz. ${ang ?? '?'}° R${rad ?? '?'} — ${product.sku}`;
  }
  if (isVerticalCurve(product)) {
    const ang = (product as Record<string, unknown>).angulo_grados;
    return `${product.tipo_pieza} ${ang ?? '?'}° — ${product.sku}`;
  }
  if (isStraight(product)) {
    return `${anc} mm${alaStr} — ${product.sku}`;
  }
  return `${product.tipo_pieza} · ${product.sku}`;
}
