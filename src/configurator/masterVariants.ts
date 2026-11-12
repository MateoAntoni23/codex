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
 * Seis orígenes posibles por variante (alineados con `RuleProvenance`):
 *   - `base`           : ancho/ala del producto == maestro. Usa la receta medida.
 *   - `declared`       : variante listada en `declaredVariantSkus` del maestro
 *                        (p.ej. TRPS-450-22-Z, CPS-450-45-Z). Mismo motor que
 *                        derived/estimated pero marcada como "declarada por el
 *                        catálogo paramétrico" (no sólo generable por regla).
 *   - `measured`       : la regla aplica Y el maestro tiene
 *                        `provenance: 'measured'` (validada contra ≥2 STEP).
 *                        Hoy ningún maestro cumple — reservado para cuando se
 *                        incorpore un segundo STEP real.
 *   - `derived`        : la regla aplica Y `provenance: 'derived'` (construible
 *                        geométricamente sin ambigüedad desde el STEP base).
 *   - `estimated`      : la regla aplica pero `provenance: 'estimated'`
 *                        (hipótesis visual sin segundo STEP).
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
import type { PieceKind } from '../parametric/geometry/recipes';
import { definicionEfectiva } from '../workspace/placement/definitions';
import { buildDefinitionGeometry } from '../workspace/placement/placementCore';
import {
  findMasterForProduct,
  type MasterModel,
  type MasterVariationRule,
} from './masterModels';


export type MasterVariantOrigin =
  | 'base'
  | 'declared'
  | 'measured'
  | 'derived'
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

/**
 * Bocas y bbox de la variante desde su DEFINICIÓN EFECTIVA (B-2: el mismo
 * camino que el espacio de trabajo; antes se proyectaban aquí con recetas y
 * contornos propios). Cada boca del maestro se busca por nombre en la
 * definición; bbox en el marco local de la definición (calibración incluida).
 */
function proyeccionDesdeDefinicion(
  master: MasterModel,
  product: Product,
): { ports: readonly ProjectedPort[]; bbox: NonNullable<MasterVariant['bbox']> } | { motivo: string } {
  const d = definicionEfectiva(product);
  if (!d.ok) return { motivo: d.motivo };
  const byName = new Map(d.def.ports.map((p) => [p.name, p]));
  const ports: ProjectedPort[] = master.ports.map((mp) => {
    const p = byName.get(mp.recipePortName);
    return {
      recipePortName: mp.recipePortName,
      catalogPortName: mp.catalogPortName,
      physicalLabel: mp.physicalLabel,
      centerMm: p ? ([p.center[0], p.center[1], p.center[2]] as const) : null,
      normal: p ? ([p.normal[0], p.normal[1], p.normal[2]] as const) : null,
    };
  });
  const g = buildDefinitionGeometry(d.def, 'nativa');
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.dispose();
  return { ports, bbox: { min: [b.min.x, b.min.y, b.min.z] as const, max: [b.max.x, b.max.y, b.max.z] as const } };
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

/**
 * Mapea el `pieceKind` taxonómico del maestro al `PieceKind` paramétrico del
 * dispatcher `buildRecipeFor`. Un maestro TPS (`tee_simetrica`) reutiliza
 * `buildDCPSRecipe` porque el polígono medido del archivo físico DCPS-*.STEP
 * corresponde geométricamente a una tee simétrica. Un maestro DCPS puro
 * (`derivacion_lateral`) devuelve `null` — no hay STEP ni polígono.
 *
 * Para escalera se consulta el dispatcher paralelo en escaleraRecipes.
 * Devuelve `null` si el maestro no puede ejecutar receta en este dispatcher.
 */
function recipeKeyForMaster(master: MasterModel): PieceKind | null {
  if (master.sistema !== 'perforada') return null;
  switch (master.pieceKind) {
    case 'tramo_recto':
    case 'curva_horizontal':
    case 'curva_vertical':
    case 'cruz':
      return master.pieceKind;
    case 'tee_simetrica':
      return 'derivacion_lateral';
    case 'derivacion_lateral':
      // DCPS puro — sin STEP medido; no se ejecuta receta.
      return null;
    case 'reduccion_lateral':
      return null;
  }
}

interface ScaleContext {
  readonly master: MasterModel;
  readonly baseAncho: number;
  readonly targetAncho: number;
  readonly baseAla: number;
  readonly targetAla: number;
  readonly baseLongitud: number | null;
  readonly targetLongitud: number | null;
}

/**
 * Factor por eje LOCAL del maestro. Para maestros de perforada el marco
 * local es el del polígono XZ con extrusión Y=ala (exceptuando CUPS, que es
 * extruido por ancho en Z y es rotado 45°). Para escalera el polígono vive
 * también en XZ con extrusión Y=ala.
 *
 * Reglas:
 *   - ancho-only-z: TRPS (perforada) — ancho escala Z, Y/X fijos.
 *   - uniform-xz: curvas/T/cruz — hipótesis visual explícita de escala
 *     uniforme por ancho/base. NO valida como regla constructiva.
 *   - depth-only: CUPS — profundidad Z escala por ancho/base, perfil XY fijo.
 *   - ala-independent (tramo_recto escalera): rectángulo paramétrico puro.
 *     longitud escala X, ancho escala Z, ala escala Y — cada eje independiente.
 *   - ala-independent (no tramo_recto): fallback conservador — uniform-xz por
 *     ancho, Y por ala. Mantenido para compat; las curvas/T/cruz usan la
 *     hipótesis uniform-xz.
 *   - none: sin regla aplicable; devuelve identidad.
 */
function scaleOfRule(
  rule: MasterVariationRule,
  ctx: ScaleContext,
): { x: number; y: number; z: number } {
  const anchoFactor = ctx.baseAncho > 0 ? ctx.targetAncho / ctx.baseAncho : 1;
  const alaFactor = ctx.baseAla > 0 ? ctx.targetAla / ctx.baseAla : 1;
  const longFactor =
    ctx.baseLongitud !== null && ctx.targetLongitud !== null && ctx.baseLongitud > 0
      ? ctx.targetLongitud / ctx.baseLongitud
      : 1;
  switch (rule.kind) {
    case 'ancho-only-z':
      return { x: longFactor, y: 1, z: anchoFactor };
    case 'uniform-xz':
      return { x: anchoFactor, y: 1, z: anchoFactor };
    case 'depth-only':
      return { x: 1, y: 1, z: anchoFactor };
    case 'mitad-corrida':
      // No es una escala: corre la mitad derecha de la planta (ver buildDCPSLateralRecipe).
      return { x: 1, y: 1, z: 1 };
    case 'ala-independent':
      if (ctx.master.pieceKind === 'tramo_recto') {
        return { x: longFactor, y: alaFactor, z: anchoFactor };
      }
      return { x: anchoFactor, y: alaFactor, z: anchoFactor };
    case 'none':
      return { x: 1, y: 1, z: 1 };
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
  switch (rule.provenance) {
    case 'measured':
      return 'measured';
    case 'derived':
      return 'derived';
    case 'estimated':
      return 'estimated';
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Enumera las variantes aplicables al maestro cruzando el snapshot de
 * productos. Cada entrada declara su origen (base/declared/measured/derived/
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

    // Sin ala declarada no se toma la del maestro (B-1.1): se lista sin bocas.
    if (ala === null) {
      variants.push({
        productId: product.producto_id,
        sku: product.sku,
        product,
        origin: 'requires-master',
        ancho_mm: ancho,
        ala_mm: null,
        longitud_mm: longitud,
        angulo_deg: angulo,
        deltaFromMaster: { ancho_mm: ancho - baseAncho, ala_mm: 0, longitud_mm: 0, angulo_deg: 0 },
        scale: { x: 1, y: 1, z: 1 },
        ports: [],
        bbox: null,
        rationale: 'El snapshot no declara ala_nominal_mm — no se puede derivar variante por regla.',
        warnings: ['Falta ala_nominal_mm en el catálogo.'],
      });
      continue;
    }
    const effectiveAla = ala;
    const deltaAncho = ancho - baseAncho;
    const deltaAla = ala - baseAla;
    const deltaLong = (longitud ?? baseLong) - baseLong;
    const deltaAng = (angulo ?? baseAng) - baseAng;

    const origin = classifyOrigin(master, product, deltaAncho, deltaAla);
    const scale = scaleOfRule(master.variationRule, {
      master,
      baseAncho,
      targetAncho: ancho,
      baseAla,
      targetAla: effectiveAla,
      baseLongitud: master.baseParams.longitud_mm ?? null,
      targetLongitud: longitud,
    });

    const warnings: string[] = [];
    if (ala !== null && deltaAla !== 0 && !master.variationRule.varies.includes('ala')) {
      warnings.push(
        `ala_nominal_mm ${ala} ≠ ${baseAla} y la regla "${master.variationRule.kind}" no cubre el cambio de ala — requiere STEP propio.`,
      );
    }
    if (
      (origin === 'estimated' || origin === 'declared') &&
      master.variationRule.provenance !== 'measured' &&
      (deltaAncho !== 0 || deltaAla !== 0)
    ) {
      const label =
        master.variationRule.provenance === 'estimated'
          ? 'regla estimada (hipótesis visual sin segundo STEP)'
          : 'regla derivada (construida desde el STEP base; no validada contra un segundo STEP)';
      warnings.push(
        `Variante proyectada por ${label} — las dimensiones nominales (ancho, ala) las publica el catálogo SAMET, pero la geometría generada no está verificada oficialmente.`,
      );
    }

    let ports: readonly ProjectedPort[] = [];
    let bbox: MasterVariant['bbox'] = null;
    let rationale: string;

    if (origin === 'requires-master') {
      rationale = `Diferencia respecto al maestro (Δancho=${deltaAncho}, Δala=${deltaAla}) fuera del alcance de la regla "${master.variationRule.kind}". Necesita STEP propio.`;
    } else if (origin === 'base') {
      rationale = 'Dimensionales iguales al maestro — la variante es la geometría base.';
      const proj = proyeccionDesdeDefinicion(master, product);
      if ('motivo' in proj) warnings.push(`Sin definición efectiva: ${proj.motivo}`);
      else {
        ports = proj.ports;
        bbox = proj.bbox;
      }
    } else {
      const proj = proyeccionDesdeDefinicion(master, product);
      if ('motivo' in proj) warnings.push(`Sin definición efectiva: ${proj.motivo}`);
      else {
        ports = proj.ports;
        bbox = proj.bbox;
      }
      rationale =
        `Regla "${master.variationRule.kind}" aplicada ` +
        `(scale X:${scale.x.toFixed(3)} Y:${scale.y.toFixed(3)} Z:${scale.z.toFixed(3)}). ` +
        master.variationRule.rationale;
    }

    if (
      !ports.length &&
      origin !== 'requires-master' &&
      recipeKeyForMaster(master) === null &&
      master.sistema !== 'escalera'
    ) {
      // Sin receta ejecutable y sin outline de escalera disponible → sólo
      // publicamos dimensiones proyectadas (no bocas).
      warnings.push(
        'Maestro sin dispatcher paramétrico: sólo se publican dimensiones proyectadas, no coordenadas de bocas.',
      );
    }
    if (
      master.sistema !== 'perforada' &&
      master.variationRule.provenance === 'estimated' &&
      (deltaAncho !== 0 || deltaAla !== 0)
    ) {
      // Para escalera estimada (curvas/T/cruz hipotéticas), señalar.
      // TRES (derived) no se marca aquí: ya emitimos el aviso específico
      // de derived arriba cuando corresponde.
      const already = warnings.some((w) => /hipótesis|estim/i.test(w));
      if (!already) {
        warnings.push(
          'Escalera no-rectilínea: proyección bajo hipótesis visual uniform-xz, no validada como regla constructiva.',
        );
      }
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
