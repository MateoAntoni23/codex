/**
 * masterVariants — enumeración de variantes por MasterModel.
 *
 * Objetivo: desde un `MasterModel` (geometría medida en ancho base) y los
 * productos del catálogo SAMET, listar las variantes aplicables y su
 * procedencia explícita. No se copian coordenadas absolutas del ancho base;
 * cada variante se proyecta por la `MasterVariationRule` codificada en el
 * maestro. Las reglas no medidas quedan marcadas `estimated` para que la UI
 * pueda señalarlas sin ocultar que son extrapolación.
 *
 * Cinco orígenes posibles por variante:
 *   - `base`           : ancho/ala del producto == maestro. Usa la receta medida.
 *   - `declared`       : variante listada en `declaredVariantSkus` del maestro
 *                        (p.ej. TRPS-450-22-Z, CPS-450-45-Z). Mismo motor que
 *                        rule-derived pero marcada como "declarada por el
 *                        catálogo paramétrico" (no sólo generable por regla).
 *   - `rule-derived`   : la regla aplica Y está marcada `measured: true`.
 *   - `estimated`      : la regla aplica pero `measured: false` (extrapolación).
 *   - `requires-master`: la regla es `none` para esa combinación de ancho/ala,
 *                        o el delta no es representable por la regla. El
 *                        producto necesita su propio STEP+receta.
 *
 * Para maestros perforada (piece_kind soportado por `buildRecipeFor`) se
 * proyectan puertos y bbox a través de la receta real. Para maestros escalera
 * el polígono está en `escaleraOutlines` (plano XZ) y no hay dispatcher
 * paramétrico — exponemos dimensiones proyectadas pero NO fabricamos puertos
 * en coordenadas de mundo (mantenemos esa parte conservadora: si no hay
 * segundo STEP medido, no se publica una posición de boca "escalada").
 */

import type { Product } from '../tray/model';
import { buildRecipeFor, type PieceKind } from '../parametric/geometry/recipes';
import {
  findMasterForProduct,
  type MasterModel,
  type MasterVariationRule,
} from './masterModels';

type Vec3Readonly = readonly [number, number, number];

export type MasterVariantOrigin =
  | 'base'
  | 'declared'
  | 'rule-derived'
  | 'estimated'
  | 'requires-master';

export interface ProjectedPort {
  readonly recipePortName: string;
  readonly catalogPortName: string;
  readonly physicalLabel: string;
  /** Proyección del centro tras aplicar la regla. `null` cuando el maestro no
   *  dispone de receta ejecutable (escalera sin segundo STEP medido). */
  readonly centerMm: readonly [number, number, number] | null;
  /** Normal — invariante a la escala por diseño. */
  readonly normal: readonly [number, number, number] | null;
}

export interface MasterVariant {
  readonly productId: string;
  readonly sku: string;
  readonly product: Product;
  readonly origin: MasterVariantOrigin;
  /** Dims del producto (del snapshot SAMET). */
  readonly ancho_mm: number | null;
  readonly ala_mm: number | null;
  readonly longitud_mm: number | null;
  readonly angulo_deg: number | null;
  /** Deltas vs el maestro: útil para la columna "cambio" del lado-a-lado. */
  readonly deltaFromMaster: {
    readonly ancho_mm: number;
    readonly ala_mm: number;
    readonly longitud_mm: number;
    readonly angulo_deg: number;
  };
  /** Factor de escala por eje aplicado por la regla (1 si no escala). */
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
  /** Puertos proyectados; vacío si no hay receta ejecutable. */
  readonly ports: readonly ProjectedPort[];
  /** BBox en marco local del maestro tras la regla. `null` si no hay receta. */
  readonly bbox: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  } | null;
  /** Explicación textual para UI (una frase). */
  readonly rationale: string;
  /** Advertencias concretas (p.ej. "regla estimada", "ala declarada 90 ≠ 65"). */
  readonly warnings: readonly string[];
}

// ─── Selección de productos del snapshot asociables al maestro ───────────────

function matchesCatalog(product: Product, master: MasterModel): boolean {
  const extras = product as Record<string, unknown>;
  const familiaId = typeof extras.familia_id === 'string' ? extras.familia_id : null;
  const tipo = typeof product.tipo_pieza === 'string' ? product.tipo_pieza : null;
  if (!familiaId || !tipo) return false;
  if (!master.catalogMatch.familiaIds.includes(familiaId)) return false;
  if (master.catalogMatch.catalogTipoPieza !== tipo) return false;
  // Para curvas horizontales, el maestro declara ángulo base; respetarlo.
  if (master.baseParams.angulo_deg !== undefined) {
    const ang = typeof extras.angulo_grados === 'number' ? extras.angulo_grados : null;
    if (ang !== null && ang !== master.baseParams.angulo_deg) return false;
  }
  return true;
}

// ─── Proyección por regla ────────────────────────────────────────────────────

function piecesSupportedByBuildRecipe(pieceKind: string): pieceKind is PieceKind {
  return (
    pieceKind === 'tramo_recto' ||
    pieceKind === 'curva_horizontal' ||
    pieceKind === 'curva_vertical' ||
    pieceKind === 'derivacion_lateral' ||
    pieceKind === 'cruz'
  );
}

function scaleOfRule(
  rule: MasterVariationRule,
  baseAncho: number,
  targetAncho: number,
): { x: number; y: number; z: number } {
  const factor = baseAncho > 0 ? targetAncho / baseAncho : 1;
  switch (rule.kind) {
    case 'ancho-only-z':
      return { x: 1, y: 1, z: factor };
    case 'uniform-xz':
      return { x: factor, y: 1, z: factor };
    case 'depth-only':
      return { x: 1, y: 1, z: factor };
    case 'ala-independent':
      return { x: factor, y: 1, z: factor };
    case 'none':
      return { x: 1, y: 1, z: 1 };
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function projectPortsViaRecipe(
  master: MasterModel,
  targetAncho: number,
  targetAla: number,
  targetLongitud: number | null,
  targetAngulo: number | null,
): { ports: ProjectedPort[]; bbox: MasterVariant['bbox'] } | null {
  if (!piecesSupportedByBuildRecipe(master.pieceKind)) return null;
  const params: Record<string, number | string | null> = {
    ancho_mm: targetAncho,
    ala_mm: targetAla,
  };
  if (master.pieceKind === 'tramo_recto' && targetLongitud !== null) {
    params.longitud_mm = targetLongitud;
  }
  if (master.pieceKind === 'curva_horizontal' && targetAngulo !== null) {
    params.angulo_deg = targetAngulo;
  }
  const recipe = buildRecipeFor(master.pieceKind, params);
  const portByRecipeName = new Map(recipe.ports.map((p) => [p.name, p]));
  const projected: ProjectedPort[] = master.ports.map((mp) => {
    const rp = portByRecipeName.get(mp.recipePortName);
    return {
      recipePortName: mp.recipePortName,
      catalogPortName: mp.catalogPortName,
      physicalLabel: mp.physicalLabel,
      centerMm: rp ? (rp.center as Vec3Readonly) : null,
      normal: rp ? (rp.normal as Vec3Readonly) : null,
    };
  });
  return {
    ports: projected,
    bbox: { min: recipe.bboxMin as Vec3Readonly, max: recipe.bboxMax as Vec3Readonly },
  };
}

// ─── Clasificación por variante ──────────────────────────────────────────────

function classifyOrigin(
  master: MasterModel,
  product: Product,
  deltaAncho: number,
  deltaAla: number,
): MasterVariantOrigin {
  const sku = product.sku;
  if (deltaAncho === 0 && deltaAla === 0) {
    // Mismo ancho+ala que el maestro: la variante ES el maestro renombrado.
    return 'base';
  }
  if (sku && master.declaredVariantSkus.includes(sku)) {
    return 'declared';
  }
  const rule = master.variationRule;
  // La regla debe cubrir el delta.
  const canHandleAncho = rule.varies.includes('ancho') && deltaAncho !== 0;
  const canHandleAla = rule.varies.includes('ala') && deltaAla !== 0;
  const alaOk = deltaAla === 0 || canHandleAla;
  const anchoOk = deltaAncho === 0 || canHandleAncho;
  if (!alaOk || !anchoOk) return 'requires-master';
  return rule.measured ? 'rule-derived' : 'estimated';
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Enumera las variantes aplicables al maestro cruzando el snapshot de
 * productos. Cada entrada declara su origen (base/declared/rule-derived/
 * estimated/requires-master) y proyección geométrica cuando el motor sabe
 * fabricarla. Ordenada por ancho ascendente y luego por SKU alfabético.
 */
export function enumerateVariantsForMaster(
  master: MasterModel,
  productos: readonly Product[],
): readonly MasterVariant[] {
  const baseAncho = master.baseParams.ancho_mm;
  const baseAla = master.baseParams.ala_mm;
  const baseLong = master.baseParams.longitud_mm ?? 0;
  const baseAng = master.baseParams.angulo_deg ?? 0;

  const matching = productos.filter((p) => matchesCatalog(p, master));
  const variants: MasterVariant[] = [];

  for (const product of matching) {
    const extras = product as Record<string, unknown>;
    const ancho = num(product.ancho_nominal_mm);
    const ala = num(extras.ala_nominal_mm);
    const longitud = num(extras.longitud_comercial_mm);
    const angulo = num(extras.angulo_grados);

    // Si falta el ancho no podemos proyectar; lo listamos requires-master.
    if (ancho === null) {
      variants.push({
        productId: product.producto_id,
        sku: product.sku,
        product,
        origin: 'requires-master',
        ancho_mm: null,
        ala_mm: ala,
        longitud_mm: longitud,
        angulo_deg: angulo,
        deltaFromMaster: { ancho_mm: 0, ala_mm: 0, longitud_mm: 0, angulo_deg: 0 },
        scale: { x: 1, y: 1, z: 1 },
        ports: [],
        bbox: null,
        rationale: 'El snapshot no declara ancho_nominal_mm — no se puede derivar variante por regla.',
        warnings: ['Falta ancho_nominal_mm en el catálogo.'],
      });
      continue;
    }

    const effectiveAla = ala ?? baseAla;
    const deltaAncho = ancho - baseAncho;
    const deltaAla = (ala ?? baseAla) - baseAla;
    const deltaLong = (longitud ?? baseLong) - baseLong;
    const deltaAng = (angulo ?? baseAng) - baseAng;

    const origin = classifyOrigin(master, product, deltaAncho, deltaAla);
    const scale = scaleOfRule(master.variationRule, baseAncho, ancho);

    const warnings: string[] = [];
    if (ala !== null && deltaAla !== 0 && !master.variationRule.varies.includes('ala')) {
      warnings.push(
        `ala_nominal_mm ${ala} ≠ ${baseAla} y la regla "${master.variationRule.kind}" no cubre el cambio de ala — requiere STEP propio.`,
      );
    }
    if (
      (origin === 'estimated' || origin === 'declared') &&
      !master.variationRule.measured &&
      (deltaAncho !== 0 || deltaAla !== 0)
    ) {
      warnings.push('Variante proyectada por regla no medida — dimensionales sin verificación oficial.');
    }

    let ports: readonly ProjectedPort[] = [];
    let bbox: MasterVariant['bbox'] = null;
    let rationale: string;

    if (origin === 'requires-master') {
      rationale = `Diferencia respecto al maestro (Δancho=${deltaAncho}, Δala=${deltaAla}) fuera del alcance de la regla "${master.variationRule.kind}". Necesita STEP propio.`;
    } else if (origin === 'base') {
      rationale = 'Dimensionales iguales al maestro — la variante es la geometría base.';
      const proj = projectPortsViaRecipe(master, ancho, effectiveAla, longitud, angulo);
      if (proj) {
        ports = proj.ports;
        bbox = proj.bbox;
      }
    } else {
      const proj = projectPortsViaRecipe(master, ancho, effectiveAla, longitud, angulo);
      if (proj) {
        ports = proj.ports;
        bbox = proj.bbox;
      }
      rationale =
        `Regla "${master.variationRule.kind}" aplicada ` +
        `(scale X:${scale.x.toFixed(3)} Y:${scale.y.toFixed(3)} Z:${scale.z.toFixed(3)}). ` +
        master.variationRule.rationale;
    }

    if (!ports.length && origin !== 'requires-master' && !piecesSupportedByBuildRecipe(master.pieceKind)) {
      warnings.push(
        'Maestro sin dispatcher paramétrico (escalera): sólo se publican dimensiones proyectadas, no coordenadas de bocas.',
      );
    }

    variants.push({
      productId: product.producto_id,
      sku: product.sku,
      product,
      origin,
      ancho_mm: ancho,
      ala_mm: ala,
      longitud_mm: longitud,
      angulo_deg: angulo,
      deltaFromMaster: {
        ancho_mm: deltaAncho,
        ala_mm: deltaAla,
        longitud_mm: deltaLong,
        angulo_deg: deltaAng,
      },
      scale,
      ports,
      bbox,
      rationale,
      warnings,
    });
  }

  variants.sort((a, b) => {
    const ax = a.ancho_mm ?? Number.POSITIVE_INFINITY;
    const bx = b.ancho_mm ?? Number.POSITIVE_INFINITY;
    if (ax !== bx) return ax - bx;
    return a.sku.localeCompare(b.sku);
  });
  return variants;
}

/**
 * Devuelve el maestro aplicable a un producto y la variante que lo representa
 * dentro de ese maestro. Útil para la pestaña Maestro: a partir del producto
 * seleccionado, saca el maestro y mueve el foco a la fila correspondiente.
 */
export function findMasterAndVariantForProduct(
  product: Product,
  productos: readonly Product[],
): { master: MasterModel; variant: MasterVariant } | null {
  const master = findMasterForProduct(product);
  if (!master) return null;
  const variants = enumerateVariantsForMaster(master, productos);
  const variant = variants.find((v) => v.productId === product.producto_id);
  if (!variant) return null;
  return { master, variant };
}
