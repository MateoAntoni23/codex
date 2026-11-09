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
  ESCALERA_OUTLINES_BY_SKU,
  type EscaleraOutline,
  type MeasuredEdge,
} from '../parametric/geometry/escaleraOutlines';
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

function projectPortsViaRecipe(
  master: MasterModel,
  targetAncho: number,
  targetAla: number,
  targetLongitud: number | null,
  targetAngulo: number | null,
): { ports: ProjectedPort[]; bbox: MasterVariant['bbox'] } | null {
  if (master.sistema === 'escalera') {
    return projectPortsFromEscaleraOutline(master, targetAncho, targetAla, targetLongitud, targetAngulo);
  }
  const key = recipeKeyForMaster(master);
  if (!key) return null;
  const params: Record<string, number | string | null> = {
    ancho_mm: targetAncho,
    ala_mm: targetAla,
  };
  if (key === 'tramo_recto' && targetLongitud !== null) {
    params.longitud_mm = targetLongitud;
  }
  if (key === 'curva_horizontal' && targetAngulo !== null) {
    params.angulo_deg = targetAngulo;
  }
  const recipe = buildRecipeFor(key, params);
  const portByRecipeName = new Map(recipe.ports.map((p) => [p.name, p]));
  const projected: ProjectedPort[] = master.ports.map((mp) => {
    const rp = portByRecipeName.get(mp.recipePortName);
    return {
      recipePortName: mp.recipePortName,
      catalogPortName: mp.catalogPortName,
      physicalLabel: mp.physicalLabel,
      centerMm: rp ? reorthoNormalizedCenter(rp.center, master.variationRule) : null,
      normal: rp ? normalizeDir(rp.normal) : null,
    };
  });
  return {
    ports: projected,
    bbox: { min: recipe.bboxMin as Vec3Readonly, max: recipe.bboxMax as Vec3Readonly },
  };
}

// Normales deben permanecer unitarias — buildRecipeFor ya las produce unitarias
// pero la variante puede introducir ruido numérico si alguna coordenada se
// reescaló por otro factor. Reortonormalizar aquí blinda contra regresión.
function normalizeDir(d: readonly [number, number, number]): Vec3Readonly {
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-9 || Math.abs(L - 1) < 1e-9) return [d[0], d[1], d[2]] as const;
  return [d[0] / L, d[1] / L, d[2] / L] as const;
}

// Para variantes con scale no uniforme (ancho-only-z, depth-only) la receta
// ya recibió el `ancho_mm` objetivo y buildRecipeFor emite centers escalados
// coherentemente. No se re-escala aquí para evitar doble transformación.
function reorthoNormalizedCenter(
  c: readonly [number, number, number],
  _rule: MasterVariationRule,
): Vec3Readonly {
  return [c[0], c[1], c[2]] as const;
}

// ─── Proyección de puertos para maestros escalera ────────────────────────────
//
// No hay dispatcher paramétrico publicado para escalera, pero cada maestro
// escalera lleva un outline medido (`escaleraOutlines.ts`) con los centros 2D
// de las bocas en el plano XZ local y la altura Y del ala. Proyectamos esos
// centros a ancho/ala objetivo según una regla editable, reflejando la
// decisión del usuario:
//   - TRES (tramo_recto): regla `ala-independent` MEDIDA (polígono rectangular;
//     Z escala por ancho/300, X escala por longitud/3000, Y escala por ala/65).
//   - CS/TS/XS (no tramo_recto): hipótesis visual `uniform-xz` por ancho/300,
//     Y independiente por ala/65 — EXPLÍCITA como no validada.
//   - RIS (reducción): sin regla (baseParams.ancho_mm fijo 300→150), no se
//     proyecta hacia otro ancho sin STEP.
function escaleraBaseSku(master: MasterModel): string | null {
  switch (master.id) {
    case 'master:escalera:tramo_recto':
      return 'SAM_TRES-300-065-18-Z';
    case 'master:escalera:curva_horizontal_45':
      return 'SAM_CS-300-45-065-18-Z';
    case 'master:escalera:curva_horizontal_90':
      return 'SAM_CS-300-90-065-18-Z';
    case 'master:escalera:derivacion_lateral':
      return 'SAM_TS-300-065-18-Z';
    case 'master:escalera:cruz':
      return 'SAM_XS-300-065-18-Z';
    case 'master:escalera:reduccion_lateral':
      return 'SAM_RIS-15-065-18-Z';
    default:
      return null;
  }
}

function getEscaleraOutlineForMaster(master: MasterModel): EscaleraOutline | null {
  const sku = escaleraBaseSku(master);
  if (!sku) return null;
  const outline = (ESCALERA_OUTLINES_BY_SKU as Record<string, EscaleraOutline>)[sku];
  return outline ?? null;
}

/**
 * Proyecta un `MeasuredEdge` del outline (plano XZ, ala en Y) a un centro 3D
 * (x, y, z) aplicando factores por eje. La ala se centra en Y: midpoint.y =
 * ala / 2 (los puertos están en el plano medio del extruido).
 *
 * `factorX` escala X del polígono (longitud para TRES; ancho/300 en la
 * hipótesis uniform-xz para el resto). `factorZ` escala Z del polígono. No
 * aplicamos escala a la NORMAL — la outward_normal es ortonormal por
 * construcción y una escala no uniforme la distorsionaría; la mantenemos
 * literal porque una boca queda perpendicular a su arista también después
 * del escalado (las aristas candidatas están alineadas con x_min/x_max/
 * z_min/z_max, i.e. ejes puros).
 */
function projectEscaleraEdge(
  edge: MeasuredEdge,
  factorX: number,
  factorZ: number,
  targetAla: number,
): { center: Vec3Readonly; normal: Vec3Readonly } {
  const cxLocal = edge.midpoint[0] * factorX;
  const czLocal = edge.midpoint[1] * factorZ;
  // Marco del maestro escalera: polígono en XZ local, Y = ala. Para que la
  // boca quede centrada en la altura del ala, Y = ala/2.
  const centerY = targetAla / 2;
  return {
    center: [cxLocal, centerY, czLocal] as const,
    normal: [edge.outward_normal[0], 0, edge.outward_normal[1]] as const,
  };
}

function projectPortsFromEscaleraOutline(
  master: MasterModel,
  targetAncho: number,
  targetAla: number,
  targetLongitud: number | null,
  _targetAngulo: number | null,
): { ports: ProjectedPort[]; bbox: MasterVariant['bbox'] } | null {
  const outline = getEscaleraOutlineForMaster(master);
  if (!outline) return null;

  const baseAncho = master.baseParams.ancho_mm;
  const baseLong = master.baseParams.longitud_mm ?? null;

  // Determinar escala por eje según el tipo de maestro.
  let factorX = 1;
  let factorZ = 1;
  if (master.pieceKind === 'tramo_recto') {
    // TRES: longitud escala X; ancho escala Z (regla ala-independent medida).
    if (baseLong !== null && targetLongitud !== null && baseLong > 0) {
      factorX = targetLongitud / baseLong;
    }
    if (baseAncho > 0) {
      factorZ = targetAncho / baseAncho;
    }
  } else {
    // Curvas, T, cruz: hipótesis visual uniform-xz (explícita).
    if (baseAncho > 0) {
      factorX = targetAncho / baseAncho;
      factorZ = targetAncho / baseAncho;
    }
  }

  // Si hay ≤2 aristas de boundary con normal eje, están garantizadas como
  // ortonormales (son los boundaries x_min/x_max/z_min/z_max). Para curvas
  // mitereadas con bocas que no caen sobre bordes rectos, se marcaría; no es
  // el caso en los outlines medidos actuales.
  const projectedByBoundary = new Map<string, { center: Vec3Readonly; normal: Vec3Readonly }>();
  for (const edge of outline.boundary_edges) {
    if (!edge.boundary) continue;
    projectedByBoundary.set(edge.boundary, projectEscaleraEdge(edge, factorX, factorZ, targetAla));
  }

  // Mapear los puertos declarados por el maestro a los boundaries medidos. El
  // maestro usa nombres P1/P2/P3/P4; los boundary_edges del outline están
  // listados en el orden P1→P2→… (ver escaleraOutlines.ts). Mantenemos ese
  // orden como contrato — si un maestro renombra su physicalLabel debe
  // preservarlo coherentemente.
  const boundariesInOrder: ('x_min' | 'x_max' | 'z_min' | 'z_max' | null)[] =
    outline.boundary_edges.map((e) => e.boundary);
  const projected: ProjectedPort[] = master.ports.map((mp, idx) => {
    const boundary = boundariesInOrder[idx] ?? null;
    const geom = boundary ? projectedByBoundary.get(boundary) : null;
    return {
      recipePortName: mp.recipePortName,
      catalogPortName: mp.catalogPortName,
      physicalLabel: mp.physicalLabel,
      centerMm: geom ? geom.center : null,
      normal: geom ? geom.normal : null,
    };
  });

  const bboxMax: Vec3Readonly = [
    outline.bbox_local.x_max * factorX,
    targetAla,
    outline.bbox_local.z_max * factorZ,
  ] as const;
  return {
    ports: projected,
    bbox: { min: [0, 0, 0] as const, max: bboxMax },
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
    if (master.sistema !== 'perforada' && !master.variationRule.measured && (deltaAncho !== 0 || deltaAla !== 0)) {
      // Para escalera no medida (curvas/T/cruz), señalar la hipótesis.
      // (TRES tiene `measured: true` → no se marca.)
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
