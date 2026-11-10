/**
 * patternClassification — Patrones base vs. variantes generadas (hito 4).
 *
 * El Configurador opera sobre productos del snapshot SAMET, pero el usuario
 * razona en términos de PATRONES BASE (geometría medida) y VARIANTES GENERADAS
 * (proyectadas por la regla del maestro). Este módulo cristaliza esa
 * distinción sobre los productos del snapshot:
 *
 *   - 'pattern'              : producto canónico que representa al maestro
 *                              (origin='base' + primer SKU alfabético). Hay
 *                              UNO por maestro — el usuario calibra y aprueba
 *                              aquí.
 *   - 'commercial-associate' : producto con misma geometría que el patrón
 *                              (origin='base') pero distinto material/acabado/
 *                              espesor. NO abre una tarea de calibración
 *                              separada; hereda la del patrón canónico.
 *   - 'variant'              : producto generado por la regla del maestro
 *                              (origin ∈ declared/measured/derived/estimated).
 *                              Se "comprueba", no se calibra: su geometría la
 *                              produce la regla desde el patrón.
 *   - 'orphan'               : producto sin maestro aplicable (sin cobertura
 *                              paramétrica) o con origin='requires-master'.
 *
 * Diseño:
 *   - Puro: sin stores ni side-effects. Los callers (ConfiguratorLayout) le
 *     pasan `productos` y toman el resultado.
 *   - El productid canónico de un maestro es el primer producto `origin='base'`
 *     por orden alfabético de `producto_id`. Determinístico y estable entre
 *     re-renders — la lista del snapshot SAMET es fija dentro de una sesión.
 *
 * No depende de aprobaciones. El consumidor combina este clasificador con
 * `catalogConfigStore.getApprovalInfo` para la columna "estado".
 */

import type { Product } from '../tray/model';
import {
  MASTER_MODELS,
  findMasterForProduct,
  type MasterModel,
} from './masterModels';
import {
  enumerateVariantsForMaster,
  type MasterVariant,
} from './masterVariants';

export type PatternKind = 'pattern' | 'commercial-associate' | 'variant' | 'orphan';

export interface PatternClassification {
  readonly kind: PatternKind;
  readonly master: MasterModel | null;
  readonly variant: MasterVariant | null;
  /** producto_id del patrón canónico. Presente para variant/associate y
   *  para pattern (coincide con el propio id). `null` para orphan sin maestro. */
  readonly canonicalPatternProductId: string | null;
}

/**
 * Para cada `MasterModel`, devuelve el `producto_id` canónico — el primer
 * producto con `origin='base'` por orden alfabético de `producto_id`. Si el
 * maestro no tiene productos base en el snapshot, no aparece en el mapa.
 *
 * Idempotente y determinístico: dos llamadas con el mismo `productos`
 * producen el mismo resultado. La elección "alfabético primero" es arbitraria
 * pero estable — si el usuario pide otra regla (p.ej. "preferí acabado Z
 * sobre ZN"), este es el único lugar a cambiar.
 */
export function computeCanonicalPatternIdsByMaster(
  productos: readonly Product[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const master of MASTER_MODELS) {
    const variants = enumerateVariantsForMaster(master, productos);
    const base = variants.filter((v) => v.origin === 'base');
    if (base.length === 0) continue;
    const sorted = [...base].sort((a, b) => a.productId.localeCompare(b.productId));
    out.set(master.id, sorted[0].productId);
  }
  return out;
}

/**
 * Clasifica un producto como patrón/asociado/variante/huérfano.
 *
 * Preferir `classifyAll(productos)` cuando se clasifican muchos productos
 * (una sola enumeración de variantes por maestro). Esta función es cómoda
 * para llamadas puntuales pero re-enumera.
 */
export function classifyProduct(
  product: Product,
  productos: readonly Product[],
  canonicalByMaster?: Map<string, string>,
): PatternClassification {
  const master = findMasterForProduct(product);
  if (!master) {
    return { kind: 'orphan', master: null, variant: null, canonicalPatternProductId: null };
  }
  const variants = enumerateVariantsForMaster(master, productos);
  const variant = variants.find((v) => v.productId === product.producto_id) ?? null;
  const canonical =
    (canonicalByMaster ?? computeCanonicalPatternIdsByMaster(productos)).get(master.id) ?? null;

  if (!variant || variant.origin === 'requires-master') {
    return { kind: 'orphan', master, variant, canonicalPatternProductId: canonical };
  }
  if (variant.origin === 'base') {
    const kind: PatternKind = canonical === product.producto_id ? 'pattern' : 'commercial-associate';
    return { kind, master, variant, canonicalPatternProductId: canonical };
  }
  return { kind: 'variant', master, variant, canonicalPatternProductId: canonical };
}

/**
 * Clasifica TODOS los productos en una única pasada — enumera variantes una
 * vez por maestro. Pensado para la lista del Configurador (cientos de SKUs).
 */
export function classifyAll(
  productos: readonly Product[],
): Map<string, PatternClassification> {
  const canonicalByMaster = computeCanonicalPatternIdsByMaster(productos);
  const variantsByMasterId = new Map<string, readonly MasterVariant[]>();
  for (const master of MASTER_MODELS) {
    variantsByMasterId.set(master.id, enumerateVariantsForMaster(master, productos));
  }
  const out = new Map<string, PatternClassification>();
  for (const product of productos) {
    const master = findMasterForProduct(product);
    if (!master) {
      out.set(product.producto_id, {
        kind: 'orphan',
        master: null,
        variant: null,
        canonicalPatternProductId: null,
      });
      continue;
    }
    const variants = variantsByMasterId.get(master.id) ?? [];
    const variant = variants.find((v) => v.productId === product.producto_id) ?? null;
    const canonical = canonicalByMaster.get(master.id) ?? null;
    if (!variant || variant.origin === 'requires-master') {
      out.set(product.producto_id, {
        kind: 'orphan',
        master,
        variant,
        canonicalPatternProductId: canonical,
      });
      continue;
    }
    if (variant.origin === 'base') {
      const kind: PatternKind =
        canonical === product.producto_id ? 'pattern' : 'commercial-associate';
      out.set(product.producto_id, {
        kind,
        master,
        variant,
        canonicalPatternProductId: canonical,
      });
      continue;
    }
    out.set(product.producto_id, {
      kind: 'variant',
      master,
      variant,
      canonicalPatternProductId: canonical,
    });
  }
  return out;
}

/**
 * Productos comerciales asociados al patrón (misma geometría base, distinto
 * material/acabado/espesor). Excluye al propio patrón. Devuelve array vacío
 * si el producto no es un patrón canónico (p.ej. si se pasa una variante).
 */
export function listCommercialAssociates(
  pattern: Product,
  productos: readonly Product[],
): readonly Product[] {
  const master = findMasterForProduct(pattern);
  if (!master) return [];
  const variants = enumerateVariantsForMaster(master, productos);
  return variants
    .filter((v) => v.origin === 'base' && v.productId !== pattern.producto_id)
    .map((v) => v.product);
}
