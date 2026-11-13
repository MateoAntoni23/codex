/**
 * parametricBridge — puente puro entre el catálogo paramétrico (recetas
 * medidas sobre los STEP aportados; procedencia en verificación) y el editor
 * operativo de bandejas.
 *
 * Responsabilidad única: traducir una receta paramétrica (polígono local en
 * marco XZ o XY) al marco mundial del editor (mm, Z-up) dado un punto de
 * conexión (startPos, entryDir) y una lateralidad (native/mirrored).
 *
 * Es el mismo transform que usa el preview y la pieza confirmada: así la
 * malla, las bocas, las normales y la orientación de sección quedan
 * geométricamente coherentes en ambos momentos (requisito del documento
 * docs/parametric-workspace-integration.md).
 *
 * Nada de esto cambia el motor Python ni la vista ?pilot=step. Es una capa
 * de visualización + verificación geométrica sobre piezas ya soportadas por
 * la receta (actualmente tramo_recto y curva_horizontal 45°/90°).
 */

import * as THREE from 'three';
import { RECETAS_ESLABONADAS } from '../parametric/geometry/recipes';
import { ANGULO_ESLABONADA_POR_DEFECTO } from '../parametric/geometry/curvaEslabonada';
import {
  type ParametricEntry,
  type ParametricVariantView,
} from '../parametric/catalog';
import {
  buildRecipeByKey,
  buildRecipeFor,
  type PieceKind,
  type RawParams,
} from '../parametric/geometry/recipes';
import { buildPrism } from '../parametric/geometry/buildPrism';
import { buildTRPSRecipe, type GeometryRecipe, type PortDef } from '../parametric/geometry/outlines';
import type { Piece, Product, TrayPort } from '../tray/model';
import { findMasterForProduct, type MasterModel } from '../configurator/masterModels';
import { resolveRecipeForProduct } from './resolvedPortGeometry';

// ─── Tipos del puente ────────────────────────────────────────────────────────

export type Vec3 = [number, number, number];

/** Chiralidad geométrica respecto al polígono medido del STEP. */
export type Chirality = 'native' | 'mirrored';

export interface PlacedPort {
  readonly name: string;
  readonly pos: Vec3;
  /** Normal exterior (apunta "hacia afuera" del cuerpo de la pieza). */
  readonly outwardNormal: Vec3;
  /**
   * Orientación de la sección en mundo (v_dir del marco local del puerto,
   * rotado al mundo). Es el eje "arriba" de la sección transversal — perpendicular
   * a `outwardNormal`. Se propaga a la siguiente pieza vía `PlaceOptions.sectionUp`
   * cuando la continuación es vertical. Para puertos horizontales clásicos
   * (TRPS/CPS/DCPS/XPS) ≈ (0,0,1).
   */
  readonly vDir: Vec3;
  /**
   * Tercer eje del marco (uDir = vDir × outwardNormal cuando el puerto es
   * native; para `mirrored` el signo queda invertido). Se expone principalmente
   * para diagnóstico — las continuaciones sólo necesitan `vDir`.
   */
  readonly uDir: Vec3;
  readonly ancho_mm: number;
  readonly ala_mm: number;
}

export interface PlacedRecipe {
  readonly entry: ParametricEntry;
  readonly recipe: GeometryRecipe;
  /** Transformación local→mundo (incluye traslación y rotación/reflexión). */
  readonly matrix: THREE.Matrix4;
  /** True cuando el transform incluye reflexión (winding invertido). */
  readonly mirrored: boolean;
  /** Nombre del puerto por el que se entra (alineado con −entryDir). */
  readonly entryPortName: string;
  /**
   * Todos los puertos de la receta colocados en el mundo. El primero coincide
   * con el puerto de entrada; el resto son bocas libres disponibles para
   * continuar el routing. Las entradas y las bocas restantes NO están ordenadas
   * por nombre; el orden preserva la definición de la receta excepto por
   * mover la entrada a la posición 0.
   */
  readonly ports: readonly PlacedPort[];
  /**
   * Alias legacy: puerto de entrada (igual a ports[0]). Para recetas 2-puerto
   * horizontales coincide con el P1 geométrico; para 3+ puertos conserva el
   * contrato de "puerto por el que entra la pieza nueva" que esperan los
   * callers existentes.
   */
  readonly p1: PlacedPort;
  /**
   * Alias legacy: siguiente puerto libre (ports[1]). Para recetas 2-puerto
   * horizontales coincide con el P2 geométrico; para 3+ puertos devuelve la
   * primera boca disponible — no toda la pieza se puede describir con sólo
   * dos puertos, por lo que los callers de accesorios deben leer `ports`.
   */
  readonly p2: PlacedPort;
}

export interface GeometricFit {
  readonly entry: ParametricEntry;
  readonly chirality: Chirality;
  /**
   * Nombre del puerto de la receta por el que se "entra" al construir la
   * colocación. Para piezas 2-puerto clásicas (TRPS/CPS/DCPS) vale 'P1';
   * para accesorios con bocas nombradas (CUPS → 'P1_horizontal', TPS →
   * 'tronco_P1', XPS → 'P1_x_neg', …) refleja el nombre real resuelto.
   *
   * ParametricMesh re-usa este nombre para pedir a `placeRecipe` el mismo
   * transform con el que se registró la pieza; si fuera 'P1' por omisión
   * (asumiendo el contrato legacy) las piezas CUPS/TPS/XPS quedaban sin
   * cuerpo paramétrico (silent fallback a schematic-line).
   */
  readonly entryPortName: string;
  /**
   * sectionUp aplicado al re-colocar (si la pieza tenía orientacion_seccion_ws
   * almacenada en el puerto de entrada). Permite a los consumers reproducir
   * la colocación sin re-inferir la orientación transversal.
   */
  readonly sectionUp?: Vec3;
  /**
   * Máximo error de posición (mm) entre puerto colocado y puerto almacenado,
   * agregado sobre TODOS los puertos. Para piezas 2-puerto coincide con el
   * error de P2; para N-puerto es el peor de los puertos no-entrada.
   */
  readonly posErrorMm: number;
  /** Máximo error angular (°) entre direcciones colocadas y almacenadas. */
  readonly dirErrorDeg: number;
  /**
   * Alias legacy: para piezas 2-puerto vale el error del puerto "P2";
   * para N-puerto es el peor error global (igual a `posErrorMm`). Se
   * conservan los nombres para no romper trazas y tests históricos.
   */
  readonly p2PosErrorMm: number;
  readonly p2DirErrorDeg: number;
  readonly matches: boolean;
}

// El índice por SKU de `src/parametric/catalog.ts` (PARAMETRIC_CATALOG, vista
// ?pilot=step) ya NO participa en el espacio de trabajo (B-2): todo producto se
// resuelve por su maestro. Ver `resolveParametricEntry`.

const SUPPORTED_PIECE_KINDS: ReadonlySet<PieceKind> = new Set([
  'tramo_recto',
  'curva_horizontal',
  'derivacion_lateral',
  'cruz',
  'curva_vertical',
]);

type SyntheticProductLike = {
  readonly sku?: unknown;
  readonly producto_id?: unknown;
  readonly familia_id?: unknown;
  readonly tipo_pieza?: unknown;
  readonly ancho_nominal_mm?: unknown;
  readonly ala_nominal_mm?: unknown;
  readonly longitud_comercial_mm?: unknown;
  readonly angulo_grados?: unknown;
};

/**
 * Mapea el `pieceKind` taxonómico del maestro al `PieceKind` paramétrico que
 * acepta el dispatcher legacy `buildRecipeFor`. Para escalera + reducción el
 * caller debe usar `buildRecipeByKey` con el recipeKey del maestro, no esta
 * función — este map es solo para conservar el `piece_kind` de la entrada
 * sintética (campo usado por `isParametricInsertable`/`resolveRecipe`).
 */
function masterPieceKindToParametric(master: MasterModel): PieceKind | null {
  switch (master.pieceKind) {
    case 'tramo_recto':
    case 'curva_horizontal':
    case 'curva_vertical':
    case 'cruz':
      return master.pieceKind;
    case 'tee_simetrica':
    case 'derivacion_lateral':
      return 'derivacion_lateral';
    case 'reduccion_lateral':
      // No tiene PieceKind legacy — los consumidores que requieren PieceKind
      // (p.ej. SUPPORTED_PIECE_KINDS) no aceptan reducción, lo cual es
      // correcto: no la colocamos interactivamente aún. El viewer SÍ la
      // acepta porque sólo pide `resolveParametricEntry`.
      return null;
  }
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Datos dimensionales que el maestro necesita y el producto no declara en el
 * catálogo. Sin valores por defecto: si falta alguno, la pieza no tiene
 * definición y el motivo lo nombra.
 */
export function datosFaltantesParaMaestro(master: MasterModel, product: SyntheticProductLike): string[] {
  const faltan: string[] = [];
  if (numOrNull(product.ancho_nominal_mm) === null) faltan.push('ancho_nominal_mm');
  if (numOrNull(product.ala_nominal_mm) === null) faltan.push('ala_nominal_mm');
  if (master.baseParams.longitud_mm !== undefined && numOrNull(product.longitud_comercial_mm) === null) faltan.push('longitud_comercial_mm');
  if (master.baseParams.angulo_deg !== undefined && numOrNull(product.angulo_grados) === null) faltan.push('angulo_grados');
  return faltan;
}

function paramsForMaster(master: MasterModel, product: SyntheticProductLike): RawParams {
  const params: Record<string, number | string | null> = {
    // Sólo lo que declara el producto: los baseParams del maestro describen el
    // modelo medido, no rellenan datos que el catálogo no publica.
    ancho_mm: numOrNull(product.ancho_nominal_mm),
    ala_mm: numOrNull(product.ala_nominal_mm),
  };
  if (master.baseParams.longitud_mm !== undefined) {
    params.longitud_mm = numOrNull(product.longitud_comercial_mm);
  }
  if (master.baseParams.angulo_deg !== undefined) {
    params.angulo_deg = numOrNull(product.angulo_grados);
  }
  if (master.pieceKind === 'curva_vertical') params.sentido_vertical = sentidoPorTipo(String(product.tipo_pieza));
  // Curva eslabonada: el catálogo no declara ángulo; el modelo de referencia usa el
  // de por defecto declarado por el operador (90°). Cada instancia guarda el suyo.
  if (RECETAS_ESLABONADAS.has(master.recipeKey)) params.angulo_deg = ANGULO_ESLABONADA_POR_DEFECTO;
  return params as RawParams;
}

/**
 * Sentido de una curva vertical según el tipo de pieza del catálogo (+1 sube,
 * −1 baja): interior (A) sube, exterior (D) baja; la articulada (CUS) lo elige
 * la colocación — sin elección, 'baja' como pose de REFERENCIA del modelo.
 */
export function sentidoPorTipo(tipo: string, elegido?: 'sube' | 'baja'): 1 | -1 {
  if (tipo === 'curva vertical interior') return 1;
  if (tipo === 'curva vertical exterior') return -1;
  return elegido === 'sube' ? 1 : -1;
}

function syntheticVariantView(
  label: string,
  sku: string,
  recipe: GeometryRecipe,
  params: RawParams,
  notes: readonly string[],
): ParametricVariantView {
  return {
    label,
    sku,
    glb_url: '',
    params,
    ports: recipe.ports.map((p) => ({
      name: p.name,
      center: p.center,
      normal: p.normal,
      ancho_mm: p.ancho_mm,
      ala_mm: p.ala_mm,
      u_dir: p.u_dir,
      v_dir: p.v_dir,
      kind: p.kind,
    })),
    notes,
    bbox_span_mm: [
      recipe.bboxMax[0] - recipe.bboxMin[0],
      recipe.bboxMax[1] - recipe.bboxMin[1],
      recipe.bboxMax[2] - recipe.bboxMin[2],
    ] as const,
  };
}

const SYNTHETIC_ENTRY_CACHE = new Map<string, ParametricEntry>();

/**
 * Construye una `ParametricEntry` sintética a partir del maestro y los dims
 * del producto. Útil cuando el SKU no está en `ENTRY_BY_SKU` pero existe un
 * `MasterModel` que lo cubre por regla de variación (TRES-450-090 heredando
 * del maestro TRES-300-065 con regla `ala-independent`; variantes escalera
 * en general; declaredVariantSkus con SKU que no matchea el índice legacy).
 *
 * El caller NO debe usar `original_bbox_span_mm` ni `fidelity` de la entrada
 * sintética como medición: son valores derivados del polígono (no del STEP
 * del producto real). El `piece_kind` se mapea al dispatcher legacy para
 * compat; el `recipe` (nombre) codifica el `recipeKey` del maestro para que
 * `buildRecipeFromProduct` pueda despacharlo correctamente a `buildRecipeByKey`.
 */
export function resolveParametricEntryViaMaster(
  product: SyntheticProductLike,
): ParametricEntry | null {
  const skuKey =
    typeof product.sku === 'string' && product.sku
      ? product.sku
      : typeof product.producto_id === 'string'
      ? product.producto_id
      : null;
  if (!skuKey) return null;
  const cached = SYNTHETIC_ENTRY_CACHE.get(skuKey);
  if (cached) return cached;

  const master = findMasterForProduct({
    familia_id: product.familia_id,
    tipo_pieza: product.tipo_pieza,
    ala_nominal_mm: product.ala_nominal_mm,
    angulo_grados: product.angulo_grados,
    sku: product.sku,
    producto_id: product.producto_id,
  });
  if (!master) return null;

  const pieceKind = masterPieceKindToParametric(master);
  if (!pieceKind) return null;

  const params = paramsForMaster(master, product);
  let recipe: GeometryRecipe;
  try {
    recipe = buildRecipeByKey(master.recipeKey, params);
  } catch {
    return null;
  }
  const bboxSpan: Vec3 = [
    recipe.bboxMax[0] - recipe.bboxMin[0],
    recipe.bboxMax[1] - recipe.bboxMin[1],
    recipe.bboxMax[2] - recipe.bboxMin[2],
  ];
  const notes: readonly string[] = [
    `Entrada sintética derivada del maestro ${master.id} vía buildRecipeByKey('${master.recipeKey}').`,
    `Procedencia de la regla: ${master.variationRule.provenance} (${master.variationRule.kind}).`,
  ];
  const view: ParametricVariantView = syntheticVariantView(
    `${master.label} — ${skuKey}`,
    skuKey,
    recipe,
    params,
    notes,
  );
  const entry: ParametricEntry = {
    recipe: master.recipeKey,
    piece_kind: pieceKind,
    original_glb_url: master.source.glbUrl ?? '',
    original_bbox_span_mm: bboxSpan,
    original_volume_mm3: 0,
    reconstruction: view,
    variant: view,
    fidelity: {
      span_original_mm: bboxSpan,
      span_reconstruction_mm: bboxSpan,
      span_delta_pct: [0, 0, 0],
      volume_original_mm3: 0,
      volume_reconstruction_mm3: 0,
      volume_delta_pct: 0,
    },
    canonical_bbox_mm: { min: recipe.bboxMin, max: recipe.bboxMax },
    source_version: `master:${master.id}#${master.revision}`,
  };
  SYNTHETIC_ENTRY_CACHE.set(skuKey, entry);
  return entry;
}

/**
 * Devuelve la entrada paramétrica aplicable al producto o `null` si no hay
 * receta medida para él (ya sea por SKU no incluido, o por tipo de pieza fuera
 * del scope actual del puente).
 */
export function resolveRecipe(
  product: { sku?: string | null } | null | undefined,
): ParametricEntry | null {
  const entry = resolveParametricEntry(product);
  if (!entry) return null;
  if (!SUPPORTED_PIECE_KINDS.has(entry.piece_kind)) return null;
  return entry;
}

export function hasParametricRecipe(
  product: { sku?: string | null } | null | undefined,
): boolean {
  return resolveRecipe(product) !== null;
}

/**
 * Devuelve la entrada paramétrica de un producto SIN filtrar por
 * SUPPORTED_PIECE_KINDS — útil para que el UI sepa que existe un modelo
 * (p.ej. DCPS, XPS, CUPS) aunque el flujo interactivo aún no lo coloque.
 *
 * Resolución común:
 *  1. Si el SKU está indexado en `ENTRY_BY_SKU` (PARAMETRIC_CATALOG) devuelve
 *     esa entrada — la ruta histórica.
 *  2. Si no, busca un maestro aplicable (findMasterForProduct) y construye una
 *     entrada sintética via `buildRecipeByKey`. Cubre:
 *       - variantes reales del catálogo no listadas como recon/variant en el
 *         índice legacy (p.ej. TRPS-450-20-Z publicada por el maestro),
 *       - toda la familia escalera (ningún maestro escalera tenía entrada en
 *         `PARAMETRIC_CATALOG`).
 *     La entrada sintética carga el `recipeKey` del maestro en `entry.recipe`
 *     para que `buildRecipeFromProduct` reutilice el mismo dispatcher.
 */
export function resolveParametricEntry(
  product: SyntheticProductLike | null | undefined,
): ParametricEntry | null {
  if (!product) return null;
  return resolveParametricEntryViaMaster(product);
}

/**
 * True cuando el `piece_kind` del producto está habilitado para inserción
 * interactiva a través del puente paramétrico. Distingue "tiene modelo"
 * (resolveParametricEntry) de "sabemos colocarlo hoy" (SUPPORTED_PIECE_KINDS).
 */
export function isParametricInsertable(
  product: { sku?: string | null } | null | undefined,
): boolean {
  return resolveRecipe(product) !== null;
}

// ─── Construcción de receta a partir del producto real ──────────────────────

interface BuildRecipeOverrides {
  /** Longitud comercial en mm (sólo aplicable a tramo_recto). */
  readonly longitud_mm?: number | null;
  /**
   * Sentido de una curva vertical ARTICULADA (CUS), elegido al colocar. Las
   * CUPS lo traen fijo por producto (A sube, D baja) y lo ignoran.
   */
  readonly sentido_vertical?: 'sube' | 'baja';
  /** Ángulo de una curva ESLABONADA (por instancia); sin valor, el de por defecto (90°). */
  readonly angulo_deg?: number | null;
}

/**
 * Sentido de una curva vertical (+1 sube, −1 baja), o null si no es una.
 *   - CUPS interior (A, ascendente) → sube; exterior (D, descendente) → baja.
 *   - CUS articulada → el elegido al colocar; sin elección, 'baja' como pose de
 *     REFERENCIA del modelo (vistas de catálogo). Al colocar se exige elegir.
 */
export function sentidoVerticalDe(product: Product, entry: ParametricEntry, elegido?: 'sube' | 'baja'): 1 | -1 | null {
  const esVertical = entry.piece_kind === 'curva_vertical' || RECETAS_ESLABONADAS.has(String(entry.recipe));
  if (!esVertical) return null;
  return sentidoPorTipo(String(product.tipo_pieza), elegido);
}

/** Curva vertical articulada (CUS): el sentido se elige al colocar. */
export function esVerticalArticulada(product: Product | null | undefined): boolean {
  return product?.tipo_pieza === 'curva vertical articulada';
}

/**
 * Construye la receta paramétrica efectiva para un producto del catálogo,
 * usando los dimensionales reales (ancho_nominal_mm, ala_nominal_mm,
 * longitud_comercial_mm, angulo_grados) como parámetros de la receta.
 *
 * Importante: los dimensionales aquí no se copian a sidewaysmente a otra
 * variante. Cada llamada toma los valores del producto pasado. Si el catálogo
 * no publica alguno (null), la receta usa su default declarado.
 */
export function buildRecipeFromProduct(
  product: Product,
  entry: ParametricEntry,
  overrides?: BuildRecipeOverrides,
): GeometryRecipe {
  const params: Record<string, number | string | null> = {};

  const ancho = product.ancho_nominal_mm;
  if (typeof ancho === 'number' && Number.isFinite(ancho)) {
    params.ancho_mm = ancho;
  }

  const ala = (product as Record<string, unknown>).ala_nominal_mm;
  if (typeof ala === 'number' && Number.isFinite(ala)) {
    params.ala_mm = ala;
  }

  // Dispatcher: las entradas legacy traen `entry.recipe` como nombre de archivo
  // (termina en `.STEP`) y usan `entry.piece_kind` como clave del dispatcher
  // perforada. Las entradas sintéticas derivadas de un MasterModel cargan en
  // `entry.recipe` el `recipeKey` del maestro (p.ej. 'escalera:tramo_recto') y
  // deben despacharse por ese valor — su `piece_kind` fue mapeado al dispatcher
  // legacy sólo para consumidores que filtran por PieceKind.
  const isRecipeKey =
    typeof entry.recipe === 'string' && !entry.recipe.endsWith('.STEP');

  // `piece_kind` legacy que recibe longitud comercial: tramo_recto.
  // Para escalera el recipeKey es 'escalera:tramo_recto' pero piece_kind
  // también quedó mapeado a 'tramo_recto' — ambos caminos aceptan longitud_mm.
  const takesLongitud =
    entry.piece_kind === 'tramo_recto' || entry.recipe === 'escalera:tramo_recto';
  if (takesLongitud) {
    const longOverride = overrides?.longitud_mm;
    if (typeof longOverride === 'number' && Number.isFinite(longOverride) && longOverride > 0) {
      params.longitud_mm = longOverride;
    } else {
      const longCatalog = (product as Record<string, unknown>).longitud_comercial_mm;
      if (typeof longCatalog === 'number' && Number.isFinite(longCatalog) && longCatalog > 0) {
        params.longitud_mm = longCatalog;
      }
    }
  }

  const sentido = sentidoVerticalDe(product, entry, overrides?.sentido_vertical);
  if (sentido !== null) params.sentido_vertical = sentido;

  if (RECETAS_ESLABONADAS.has(String(entry.recipe))) {
    const a = overrides?.angulo_deg;
    params.angulo_deg = typeof a === 'number' && Number.isFinite(a) ? a : ANGULO_ESLABONADA_POR_DEFECTO;
  }

  const takesAngulo =
    entry.piece_kind === 'curva_horizontal' || entry.recipe === 'escalera:curva_horizontal';
  if (takesAngulo) {
    const ang = (product as Record<string, unknown>).angulo_grados;
    if (typeof ang === 'number' && Number.isFinite(ang) && ang > 0) {
      params.angulo_deg = ang;
    }
  }

  return isRecipeKey
    ? buildRecipeByKey(entry.recipe, params as RawParams)
    : buildRecipeFor(entry.piece_kind, params as RawParams);
}

// ─── Transformación local → mundo ───────────────────────────────────────────
//
// Marco local paramétrico (recetas horizontales: TRPS, CPS-45, CPS-90):
//   - Polígono en XZ CCW visto desde +Y.
//   - Extrusión en +Y desde y=0 hasta y=ala (vertical del mundo).
//
// Marco mundial editor: X, Y en el plano del piso, Z hacia arriba.
//
// M_base (local→mundo) con det = +1:
//   local x → mundo x
//   local y → mundo z   (ala vertical)
//   local z → mundo −y  (para conservar lateralidad; sin negación caería de −1)
//
// En forma matricial (columnas = imágenes de los ejes locales en el mundo):
//
//     [ 1   0   0 ]
//     [ 0   0  -1 ]
//     [ 0   1   0 ]

function applyMBase(local: readonly [number, number, number]): Vec3 {
  return [local[0], -local[2], local[1]];
}

/**
 * Devuelve el ángulo φ (rad) de la rotación alrededor de Z-mundo que alinea
 * `M_base · nLocal` con `−entryDir` (el P1 debe apuntar hacia la pieza previa,
 * i.e., opuesto a la dirección de avance).
 *
 * Deducción: nLocal = (nLx, 0, nLz). M_base · nLocal = (nLx, −nLz, 0).
 * Rz(φ) · (a, b) = (−eDx, −eDy), con (a, b) = (nLx, −nLz). Resolviendo:
 *   cos φ = −a·eDx − b·eDy = −nLx·eDx + nLz·eDy
 *   sin φ =  b·eDx − a·eDy = −nLz·eDx − nLx·eDy
 */
function phiForAlignment(
  nLocal: readonly [number, number, number],
  entryDir: readonly [number, number, number],
): { cos: number; sin: number } {
  const a = nLocal[0];
  const b = -nLocal[2];
  const eDx = entryDir[0];
  const eDy = entryDir[1];
  return {
    cos: -a * eDx - b * eDy,
    sin: b * eDx - a * eDy,
  };
}

function rotateZ(v: Vec3, cos: number, sin: number): Vec3 {
  return [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos, v[2]];
}

/**
 * Reflexión de Householder a través del plano vertical que contiene a
 * `entryDir` y pasa por `startPos`. Es la operación que lleva un giro
 * nativo (derecho) en espejo (izquierdo) sin tener que rediseñar la receta.
 *
 * Plano normal n = (eDy, −eDx, 0) (perpendicular al avance, horizontal).
 * H = I − 2·n·nᵀ en 3x3, aplicada relativa a startPos.
 */
function reflectAcrossEntryAxis(
  p: Vec3,
  startPos: readonly [number, number, number],
  entryDir: readonly [number, number, number],
): Vec3 {
  const nx = entryDir[1];
  const ny = -entryDir[0];
  const dx = p[0] - startPos[0];
  const dy = p[1] - startPos[1];
  const dz = p[2] - startPos[2];
  const dot = nx * dx + ny * dy;
  return [
    p[0] - 2 * dot * nx,
    p[1] - 2 * dot * ny,
    p[2] + 0 * dz,
  ];
}

function reflectDir(
  d: Vec3,
  entryDir: readonly [number, number, number],
): Vec3 {
  const nx = entryDir[1];
  const ny = -entryDir[0];
  const dot = nx * d[0] + ny * d[1];
  return [d[0] - 2 * dot * nx, d[1] - 2 * dot * ny, d[2]];
}

/** Matriz 4x4 de Householder relativa a startPos (para componer con THREE). */
function householderMatrixAroundPoint(
  startPos: readonly [number, number, number],
  entryDir: readonly [number, number, number],
): THREE.Matrix4 {
  const nx = entryDir[1];
  const ny = -entryDir[0];
  const m = new THREE.Matrix4();
  // H = I − 2·n·nᵀ, con n = (nx, ny, 0) unitario cuando entryDir lo es.
  const h00 = 1 - 2 * nx * nx;
  const h01 = -2 * nx * ny;
  const h10 = -2 * ny * nx;
  const h11 = 1 - 2 * ny * ny;
  m.set(
    h00, h01, 0, 0,
    h10, h11, 0, 0,
    0,   0,   1, 0,
    0,   0,   0, 1,
  );
  // Trasladar: H' = T(startPos) · H · T(-startPos).
  const tNeg = new THREE.Matrix4().makeTranslation(-startPos[0], -startPos[1], -startPos[2]);
  const tPos = new THREE.Matrix4().makeTranslation(startPos[0], startPos[1], startPos[2]);
  return tPos.multiply(m).multiply(tNeg);
}

// ─── Colocación de la receta en el mundo ────────────────────────────────────

/** Normaliza un vector 3D; devuelve copia unitaria, o el mismo si ya lo es. */
function unit(v: readonly [number, number, number]): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0) || Math.abs(len - 1) < 1e-10) return [v[0], v[1], v[2]];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Transforma una receta horizontal (extrudeAlongY=true) a coordenadas mundo
 * dado un anclaje `startPos` (donde debe quedar el centro de P1), una
 * dirección de avance `entryDir` (sentido en el que la pieza previa apunta
 * hacia la nueva) y una `chirality`.
 *
 * Invariantes verificadas:
 *   - world(P1_outward_normal) = −entryDir (dentro de tolerancia 1e-6).
 *   - world(P1_center) = startPos (dentro de 1e-6 mm).
 *   - world(P2.outwardNormal) es unitario.
 */
/**
 * Mapea el `turnDirection` del editor (left/right en el plano XY mundo) a la
 * chiralidad geométrica relativa al polígono medido. Los polígonos CPS-45 y
 * CPS-90 están medidos "giro derecho" (walker caminando este → sur); una
 * curva izquierda se obtiene por reflexión.
 *
 * Si en el futuro un polígono cambiara su orientación de medición, añadir
 * metadata explícita a la entrada en lugar de invertir aquí.
 */
export function chiralityForTurn(turnDirection: 'left' | 'right'): Chirality {
  return turnDirection === 'right' ? 'native' : 'mirrored';
}

const HORIZONTAL_ENTRY_TOLERANCE = 1e-3;

export interface PlaceOptions {
  /**
   * Nombre del puerto por el que entra la pieza (debe existir en recipe.ports).
   * Si se omite, se usa la receta "clásica": 'P1' en recetas 2-puerto o el
   * primer puerto si la receta sólo tiene uno con otro nombre. Las recetas
   * de 3+ puertos (TPS, XPS, CUPS) DEBEN pasar este parámetro explícitamente.
   */
  readonly entryPortName?: string;
  /**
   * Orientación del eje "arriba" de la sección en el mundo. Sólo se consulta
   * cuando la ruta requiere la colocación frame-based (entryDir vertical).
   * Para entradas horizontales, la ruta legacy impone implícitamente world-Z
   * y este campo se ignora (mantiene exactitud bit-a-bit con la calibración
   * previa: TRPS, CPS, DCPS, XPS, CUPS por boca horizontal).
   *
   * Debe ser unitario y NO paralelo a `entryDir`. Si lo es, placeRecipe lanza
   * para evitar producir un marco degenerado.
   */
  readonly sectionUp?: Vec3;
}

function resolveEntryPort(
  recipe: GeometryRecipe,
  entryPortName: string | undefined,
): PortDef {
  if (entryPortName) {
    const port = recipe.ports.find((p) => p.name === entryPortName);
    if (!port) {
      throw new Error(
        `parametricBridge.placeRecipe: receta sin puerto '${entryPortName}' (disponibles: ${recipe.ports.map((p) => p.name).join(', ')})`,
      );
    }
    return port;
  }
  // Default legacy: preferir 'P1'; si la receta no lo tiene y sólo hay un
  // puerto, usar ése — cualquier otra cosa requiere entryPortName explícito.
  const p1 = recipe.ports.find((p) => p.name === 'P1');
  if (p1) return p1;
  if (recipe.ports.length === 1) return recipe.ports[0];
  throw new Error(
    `parametricBridge.placeRecipe: receta con ${recipe.ports.length} puertos (${recipe.ports.map((p) => p.name).join(', ')}) requiere entryPortName explícito`,
  );
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Construye la matriz de colocación (local → mundo) a partir del marco de la
 * boca de entrada y un sectionUp mundial. Garantiza:
 *   R · entryDef.normal   = -entryDir
 *   R · entryDef.v_dir    = sectionUp proyectado perp a entryDir (unitario)
 *   R · entryDef.u_dir    = ±(v_W × n_W) (- si mirrored)
 *   t · entryDef.center   → startPos
 *
 * Si el caller pasa `sectionUpInput` explícito y resulta paralelo a entryDir,
 * lanza — es un bug del caller (el marco pedido es degenerado). Si NO pasa
 * `sectionUpInput` (ej. render de una pieza confirmada sin contexto de puerto
 * vecino), la rotación alrededor de entryDir es cosmética para secciones
 * rectangulares, así que elegimos un fallback estable perpendicular a entryDir
 * en vez de fallar: primero world-Z (apropiado para entradas horizontales,
 * conserva el comportamiento legacy para toda pieza no-vertical), y si también
 * fuera paralelo (entradas verticales), caemos a world-X.
 */
function buildFramePlacement(
  entryDir: readonly [number, number, number],
  entryDef: PortDef,
  sectionUpInput: Vec3 | undefined,
  startPos: readonly [number, number, number],
  mirrored: boolean,
): THREE.Matrix4 {
  const eDir = unit(entryDir);
  const projectPerp = (candidate: Vec3): { v: Vec3 | null; len: number } => {
    const c = unit(candidate);
    const dot = c[0] * eDir[0] + c[1] * eDir[1] + c[2] * eDir[2];
    const raw: Vec3 = [c[0] - dot * eDir[0], c[1] - dot * eDir[1], c[2] - dot * eDir[2]];
    const len = Math.hypot(raw[0], raw[1], raw[2]);
    if (len < 1e-6) return { v: null, len };
    return { v: [raw[0] / len, raw[1] / len, raw[2] / len], len };
  };
  let vW: Vec3;
  if (sectionUpInput !== undefined) {
    const projected = projectPerp(sectionUpInput);
    if (projected.v === null) {
      throw new Error(
        `parametricBridge.placeRecipe: sectionUp (${unit(sectionUpInput).join(', ')}) es paralelo a entryDir (${eDir.join(', ')}); no se puede construir el marco del puerto en mundo`,
      );
    }
    vW = projected.v;
  } else {
    const zFallback = projectPerp([0, 0, 1]);
    if (zFallback.v !== null) {
      vW = zFallback.v;
    } else {
      const xFallback = projectPerp([1, 0, 0]);
      if (xFallback.v === null) {
        // entryDir unitario que no sea paralelo ni a Z ni a X no existe en R³ real,
        // pero por completitud defensiva, cualquier otro vector perpendicular.
        const yFallback = projectPerp([0, 1, 0]);
        if (yFallback.v === null) {
          throw new Error(
            `parametricBridge.placeRecipe: entryDir (${eDir.join(', ')}) sin eje perpendicular — numérica inconsistente`,
          );
        }
        vW = yFallback.v;
      } else {
        vW = xFallback.v;
      }
    }
  }
  const nW: Vec3 = [-eDir[0], -eDir[1], -eDir[2]];
  const uWRaw = cross(vW, nW);
  const uW: Vec3 = mirrored ? [-uWRaw[0], -uWRaw[1], -uWRaw[2]] : uWRaw;

  const uL = entryDef.u_dir as Vec3;
  const vL = entryDef.v_dir as Vec3;
  const nL = entryDef.normal as Vec3;

  // R[i][j] = uW[i]·uL[j] + vW[i]·vL[j] + nW[i]·nL[j].
  // Con R así, R·uL = uW, R·vL = vW, R·nL = nW (verificado para marcos
  // ortonormales locales; recipe garantiza orto-normalidad por construcción).
  const r00 = uW[0] * uL[0] + vW[0] * vL[0] + nW[0] * nL[0];
  const r01 = uW[0] * uL[1] + vW[0] * vL[1] + nW[0] * nL[1];
  const r02 = uW[0] * uL[2] + vW[0] * vL[2] + nW[0] * nL[2];
  const r10 = uW[1] * uL[0] + vW[1] * vL[0] + nW[1] * nL[0];
  const r11 = uW[1] * uL[1] + vW[1] * vL[1] + nW[1] * nL[1];
  const r12 = uW[1] * uL[2] + vW[1] * vL[2] + nW[1] * nL[2];
  const r20 = uW[2] * uL[0] + vW[2] * vL[0] + nW[2] * nL[0];
  const r21 = uW[2] * uL[1] + vW[2] * vL[1] + nW[2] * nL[1];
  const r22 = uW[2] * uL[2] + vW[2] * vL[2] + nW[2] * nL[2];

  // t = startPos - R · entryDef.center.
  const c = entryDef.center;
  const rc0 = r00 * c[0] + r01 * c[1] + r02 * c[2];
  const rc1 = r10 * c[0] + r11 * c[1] + r12 * c[2];
  const rc2 = r20 * c[0] + r21 * c[1] + r22 * c[2];
  const tx = startPos[0] - rc0;
  const ty = startPos[1] - rc1;
  const tz = startPos[2] - rc2;

  return new THREE.Matrix4().set(
    r00, r01, r02, tx,
    r10, r11, r12, ty,
    r20, r21, r22, tz,
    0,   0,   0,   1,
  );
}

export function placeRecipe(
  product: Product,
  entry: ParametricEntry,
  startPos: readonly [number, number, number],
  entryDir: readonly [number, number, number],
  chirality: Chirality,
  overrides?: BuildRecipeOverrides,
  options?: PlaceOptions,
): PlacedRecipe {
  const rawRecipe = buildRecipeFromProduct(product, entry, overrides);
  // Aplica overrides del Configurador (modelFrame + portGeometry por boca)
  // ANTES de calcular la matriz local→mundo. Garantía: una única resolución
  // geométrica compartida entre configurador, preview y pieza confirmada.
  // preTransform lleva raw mesh → canonical. recipe tiene puertos ya resueltos.
  const resolved = resolveRecipeForProduct(rawRecipe, product.producto_id);
  const recipe = resolved.recipe;

  const entryDef = resolveEntryPort(recipe, options?.entryPortName);
  const mirrored = chirality === 'mirrored';

  // Selección de ruta: dos caminos geométricamente equivalentes para entrada
  // horizontal (preservan calibraciones y la colocación de todas las piezas
  // existentes: TRPS, CPS, DCPS, XPS, CUPS por P1_horizontal), pero el camino
  // frame-based maneja también entradas verticales (p. ej. continuar desde
  // CUPS P2_vertical hacia un tramo recto vertical).
  //
  // Criterio de disparo: si entryDir tiene componente Z significativa (vertical
  // o mayormente vertical) tomamos la ruta frame-based; si es horizontal,
  // seguimos usando M_base + Rz(φ) para no alterar bit a bit las piezas ya
  // calibradas.
  let placementMatrix: THREE.Matrix4;
  if (Math.abs(entryDir[2]) < HORIZONTAL_ENTRY_TOLERANCE) {
    // Ruta legacy — entrada horizontal.
    // La entrada por un puerto cuya normal tenga componente Y en el marco local
    // implica una pieza colocada "de canto": M_base no sabe rotar a ese marco
    // porque Rz sólo gira en XY del mundo. Cuando entryDir es horizontal esto
    // no puede suceder con las piezas del catálogo (todas las bocas que miran
    // ±Y local corresponden a salidas verticales en el mundo, y el entryDir
    // para entrar por ellas tendría componente Z). Lo seguimos reportando como
    // configuración inválida por si llega un dato inconsistente.
    if (Math.abs(entryDef.normal[1]) > HORIZONTAL_ENTRY_TOLERANCE) {
      throw new Error(
        `parametricBridge.placeRecipe: entryDir horizontal pero el puerto '${entryDef.name}' tiene normal con componente Y local (${entryDef.normal.join(', ')}); configuración inconsistente`,
      );
    }
    const eDir = unit([entryDir[0], entryDir[1], 0]);

    // Rotación alrededor de +Z mundo que alinea M_base · entry.normal con −eDir.
    const { cos, sin } = phiForAlignment(entryDef.normal, eDir);

    // Traslación para que world(entry.center) = startPos.
    const entryWorldPre = rotateZ(applyMBase(entryDef.center), cos, sin);
    const tx = startPos[0] - entryWorldPre[0];
    const ty = startPos[1] - entryWorldPre[1];
    const tz = startPos[2] - entryWorldPre[2];

    // Transform base (local → mundo) como Matrix4 columna-major de THREE.
    // Columns are images of local basis vectors in world coordinates AFTER Rz(φ):
    //   local x → Rz · (1, 0, 0) → (cos, sin, 0)       (M_base images local-x at world-x)
    //   local y → Rz · (0, 0, 1) → (0, 0, 1)           (M_base images local-y at world-z)
    //   local z → Rz · (0, -1, 0) → (sin, -cos, 0)      (M_base images local-z at -world-y)
    const baseMatrix = new THREE.Matrix4().set(
      cos, 0,  sin, tx,
      sin, 0, -cos, ty,
      0,   1,  0,   tz,
      0,   0,  0,   1,
    );

    // placementMatrix mapea COORDENADAS RESUELTAS (post-modelFrame) → mundo.
    // Los puertos ya están resueltos en `recipe.ports`; aplicarlo directamente
    // produce la posición mundo correcta.
    placementMatrix = mirrored
      ? householderMatrixAroundPoint(startPos, eDir).multiply(baseMatrix)
      : baseMatrix;
  } else {
    // Ruta frame-based — entrada vertical o con componente Z significativa.
    // Construye una rotación general SO(3) R tal que R·marcoLocal = marcoMundo,
    // donde el marco mundo del puerto se arma a partir de entryDir y sectionUp.
    //
    // n_W  = -entryDir             (la normal exterior del puerto mira "atrás")
    // v_W  = sectionUp proyectado perpendicular a n_W y renormalizado
    // u_W  = v_W × n_W             (right-handed; mirrored lo invierte)
    //
    // La rotación es R = Σ (col_W_k ⊗ col_L_k), que preserva longitudes y
    // mapea cada eje local al correspondiente eje mundial del puerto.
    placementMatrix = buildFramePlacement(entryDir, entryDef, options?.sectionUp, startPos, mirrored);
  }

  // Para la MALLA (construida con `buildLocalMesh(recipe)` → polígono RAW sin
  // modelFrame aplicado), el consumidor necesita `placementMatrix · preTransform`
  // para transformar vertex local-raw → mundo. Así preview, confirmado y motor
  // ven la misma orientación (preTransform es la calibración del modelo que
  // declaró el usuario en el Configurador).
  const finalMatrix = resolved.isIdentity
    ? placementMatrix
    : placementMatrix.clone().multiply(resolved.preTransform);

  // Calcular TODOS los puertos mundo aplicando placementMatrix a los centros/
  // normales YA RESUELTOS. Para una reflexión la parte lineal es ortogonal con
  // det=−1 pero sigue preservando longitudes.
  const placedPorts: PlacedPort[] = recipe.ports.map((port) => ({
    name: port.name,
    pos: applyMatrixToPoint(placementMatrix, port.center),
    outwardNormal: applyMatrixToDir(placementMatrix, port.normal),
    vDir: applyMatrixToDir(placementMatrix, port.v_dir),
    uDir: applyMatrixToDir(placementMatrix, port.u_dir),
    ancho_mm: port.ancho_mm,
    ala_mm: port.ala_mm,
  }));

  // Mover el puerto de entrada al índice 0 preservando el orden del resto.
  const entryIdx = placedPorts.findIndex((p) => p.name === entryDef.name);
  const orderedPorts =
    entryIdx === 0
      ? placedPorts
      : [
          placedPorts[entryIdx],
          ...placedPorts.slice(0, entryIdx),
          ...placedPorts.slice(entryIdx + 1),
        ];

  const legacyP1 = orderedPorts[0];
  const legacyP2 = orderedPorts[1] ?? orderedPorts[0];

  return {
    entry,
    recipe,
    matrix: finalMatrix,
    mirrored,
    entryPortName: entryDef.name,
    ports: orderedPorts,
    p1: legacyP1,
    p2: legacyP2,
  };
}

function applyMatrixToPoint(
  m: THREE.Matrix4,
  p: readonly [number, number, number],
): Vec3 {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m);
  return [v.x, v.y, v.z];
}

function applyMatrixToDir(
  m: THREE.Matrix4,
  d: readonly [number, number, number],
): Vec3 {
  // Normales se transforman con la parte lineal (ignorando traslación).
  // THREE.Vector3.transformDirection usa la 3x3 y normaliza el resultado;
  // para matrices ortogonales (rotación ± reflexión) la normalización es
  // un no-op y preserva el signo de las componentes.
  const v = new THREE.Vector3(d[0], d[1], d[2]).transformDirection(m);
  return [v.x, v.y, v.z];
}

// ─── Malla local (compartida por preview y pieza confirmada) ─────────────────

/**
 * Construye la BufferGeometry local de la receta (una sola vez por recipe
 * key) — sin transformar, en coordenadas locales de la receta. Quien dibuja
 * aplica el `matrix` de `PlacedRecipe` al <mesh>.
 *
 * `recipe.translate` se aplica aquí a la malla para dejarla en el mismo
 * marco local donde la receta declara las bocas (p.ej. CUPS declara
 * `translate=[0,0,-ancho_mm]` y la boca P1_horizontal a z=-ancho/2). Sin
 * esto, el cuerpo quedaba desplazado +ancho mm respecto de las bocas y la
 * conexión preview/confirmado aparecía corrida. La misma aplicación existe
 * en `ParametricScene` (configurador): esta función es la causa común
 * para ambos pipelines.
 */
export function buildLocalMesh(recipe: GeometryRecipe): THREE.BufferGeometry {
  const geom = buildPrism(recipe.polygon, recipe.height, recipe.extrudeAlongY);
  const [tx, ty, tz] = recipe.translate;
  if (tx !== 0 || ty !== 0 || tz !== 0) {
    geom.translate(tx, ty, tz);
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
  }
  return geom;
}

// ─── Verificación geométrica contra una pieza ya colocada ───────────────────

const FIT_POS_TOLERANCE_MM = 2.0;
const FIT_DIR_TOLERANCE_DEG = 1.5;

/**
 * Comprueba si una pieza ya colocada (con sus `puertos` del Piece) encaja
 * con la receta paramétrica del producto. Prueba cada combinación
 * (entryPortName × chirality) iterando los puertos reales de la receta,
 * sin presuponer nombres 'P1'/'P2'. Devuelve la mejor; `matches=true` cuando
 * el peor error de posición entre todos los puertos está por debajo de
 * 2 mm y el de dirección por debajo de 1.5°.
 *
 * Soporta accesorios con N bocas (CUPS: P1_horizontal/P2_vertical,
 * TPS: tronco_P1/tronco_P2/boca_derivacion, XPS: P1_x_neg..P4_z_pos).
 * Si la pieza almacenó `orientacion_seccion_ws` en el puerto de entrada,
 * se propaga como `sectionUp` para reproducir exactamente el frame original.
 */
export function verifyGeometricFit(
  product: Product,
  piece: Piece,
): GeometricFit | null {
  const entry = resolveRecipe(product);
  if (!entry) return null;

  // Para tramos rectos, forzar longitud real de la pieza.
  const overrides: BuildRecipeOverrides | undefined =
    entry.piece_kind === 'tramo_recto'
      ? { longitud_mm: lengthFromPiece(piece) }
      : undefined;

  // Puertos de la receta: fuente de verdad para "qué entradas son válidas".
  // Construimos la receta una vez para leer los nombres (buildRecipeFromProduct
  // es puro y barato: polígono + puertos declarados).
  let recipePortNames: readonly string[];
  try {
    const probe = buildRecipeFromProduct(product, entry, overrides);
    recipePortNames = probe.ports.map((p) => p.name);
  } catch {
    return null;
  }
  if (recipePortNames.length === 0) return null;

  // Sólo son entradas candidatas los puertos cuyo nombre existe en la
  // pieza almacenada. Si ninguno existe la pieza no corresponde a esta receta.
  const candidates = recipePortNames.filter((n) => Boolean(piece.puertos[n]));
  if (candidates.length === 0) return null;

  type Attempt = {
    entryPortName: string;
    chirality: Chirality;
    posErrorMm: number;
    dirErrorDeg: number;
    sectionUp?: Vec3;
  };
  let best: Attempt | null = null;
  for (const entryPortName of candidates) {
    for (const chirality of ['native', 'mirrored'] as const) {
      const attempt = tryPlacement(
        product,
        entry,
        piece,
        entryPortName,
        chirality,
        overrides,
      );
      if (!attempt) continue;
      if (!best || attempt.posErrorMm < best.posErrorMm) {
        best = attempt;
      }
    }
  }
  if (!best) return null;

  const matches =
    best.posErrorMm <= FIT_POS_TOLERANCE_MM &&
    best.dirErrorDeg <= FIT_DIR_TOLERANCE_DEG;

  return {
    entry,
    chirality: best.chirality,
    entryPortName: best.entryPortName,
    sectionUp: best.sectionUp,
    posErrorMm: best.posErrorMm,
    dirErrorDeg: best.dirErrorDeg,
    p2PosErrorMm: best.posErrorMm,
    p2DirErrorDeg: best.dirErrorDeg,
    matches,
  };
}

function lengthFromPiece(piece: Piece): number | null {
  if (typeof piece.longitud_mm === 'number' && piece.longitud_mm > 0) {
    return piece.longitud_mm;
  }
  const p1 = piece.puertos.P1;
  const p2 = piece.puertos.P2;
  if (!p1 || !p2) return null;
  const dx = p2.posicion_mm[0] - p1.posicion_mm[0];
  const dy = p2.posicion_mm[1] - p1.posicion_mm[1];
  const dz = p2.posicion_mm[2] - p1.posicion_mm[2];
  const d = Math.hypot(dx, dy, dz);
  return d > 0 ? d : null;
}

/**
 * Coloca la receta tomando `entryPortName` como boca de entrada y acumula
 * el peor error de posición y dirección sobre TODOS los puertos presentes
 * tanto en la receta como en la pieza almacenada. Devuelve `null` cuando
 * la colocación lanza (p.ej. combinación entryDir/sectionUp inválida).
 */
function tryPlacement(
  product: Product,
  entry: ParametricEntry,
  piece: Piece,
  entryPortName: string,
  chirality: Chirality,
  overrides: BuildRecipeOverrides | undefined,
): {
  entryPortName: string;
  chirality: Chirality;
  posErrorMm: number;
  dirErrorDeg: number;
  sectionUp?: Vec3;
} | null {
  const piecePort = piece.puertos[entryPortName] as TrayPort | undefined;
  if (!piecePort) return null;
  const startPos = piecePort.posicion_mm as [number, number, number];
  const entryDir: Vec3 = [
    -piecePort.direccion[0],
    -piecePort.direccion[1],
    -piecePort.direccion[2],
  ];
  const storedSectionUp = piecePort.orientacion_seccion_ws as
    | [number, number, number]
    | undefined;

  let placed: PlacedRecipe;
  try {
    placed = placeRecipe(product, entry, startPos, entryDir, chirality, overrides, {
      entryPortName,
      ...(storedSectionUp ? { sectionUp: [...storedSectionUp] as Vec3 } : {}),
    });
  } catch {
    return null;
  }

  let worstPos = 0;
  let worstDir = 0;
  for (const port of placed.ports) {
    const stored = piece.puertos[port.name] as TrayPort | undefined;
    if (!stored) continue;
    const dx = port.pos[0] - stored.posicion_mm[0];
    const dy = port.pos[1] - stored.posicion_mm[1];
    const dz = port.pos[2] - stored.posicion_mm[2];
    const posErr = Math.hypot(dx, dy, dz);
    if (posErr > worstPos) worstPos = posErr;

    const n = port.outwardNormal;
    const r = stored.direccion;
    const dot = Math.min(1, Math.max(-1, n[0] * r[0] + n[1] * r[1] + n[2] * r[2]));
    const dirErr = (Math.acos(dot) * 180) / Math.PI;
    if (dirErr > worstDir) worstDir = dirErr;
  }

  return {
    entryPortName,
    chirality,
    posErrorMm: worstPos,
    dirErrorDeg: worstDir,
    ...(storedSectionUp ? { sectionUp: [...storedSectionUp] as Vec3 } : {}),
  };
}

// ─── Exports auxiliares usados por integrators ──────────────────────────────

export { applyMBase as _applyMBaseForTests, phiForAlignment as _phiForTests };
export { reflectAcrossEntryAxis as _reflectForTests, reflectDir as _reflectDirForTests };

// ─── Geometría nominal del catálogo (B-2, decisión 2) ────────────────────────

export const NOTA_NOMINAL = 'geometría nominal del catálogo, sin modelo medido';

/**
 * Receta NOMINAL para un producto sin modelo medido, construida sólo con lo
 * que declara el catálogo (no se inventa nada). Reglas:
 *   - tramo recto ('recta'): ancho y ala declarados; el largo, el de la
 *     instancia o el comercial del catálogo. Rectángulo ancho × largo × ala con
 *     bocas en los extremos (la misma construcción que el tramo medido TRPS).
 *   - curva horizontal: haría falta ancho, ala, ángulo y radio declarados.
 *     Ningún producto del catálogo actual los declara: no está implementada y
 *     se informa como tal.
 *   - otros tipos: el catálogo no da una regla nominal.
 * Devuelve null si no aplica ninguna regla, o error con motivo si aplica y
 * falta un dato.
 */
export function buildNominalRecipe(
  product: SyntheticProductLike & { readonly tipo_pieza?: unknown },
  opts?: { longitud_mm?: number | null },
): { ok: true; recipe: GeometryRecipe; params: Record<string, number> } | { ok: false; motivo: string } | null {
  const ancho = numOrNull(product.ancho_nominal_mm);
  const ala = numOrNull(product.ala_nominal_mm);
  if (product.tipo_pieza === 'recta') {
    if (ancho === null || ala === null) {
      const faltan = [ancho === null ? 'ancho_nominal_mm' : '', ala === null ? 'ala_nominal_mm' : ''].filter(Boolean).join(' ni ');
      return { ok: false, motivo: `sin modelo medido y el catálogo no declara ${faltan} para construir la geometría nominal` };
    }
    const largo = opts?.longitud_mm && opts.longitud_mm > 0 ? opts.longitud_mm : numOrNull(product.longitud_comercial_mm);
    if (largo === null) return { ok: false, motivo: 'sin modelo medido; geometría nominal: falta el largo (se indica al colocar el tramo)' };
    return {
      ok: true,
      recipe: buildTRPSRecipe({ ancho_mm: ancho, ala_mm: ala, longitud_mm: largo }),
      params: { ancho_mm: ancho, ala_mm: ala, longitud_mm: largo },
    };
  }
  if (product.tipo_pieza === 'curva horizontal') {
    return {
      ok: false,
      motivo: 'sin modelo medido; la geometría nominal de una curva necesita ancho, ala, ángulo y radio declarados (no implementada: ningún producto del catálogo los declara)',
    };
  }
  return null;
}

/** El producto tiene una regla nominal que el catálogo alcanza a cubrir (sin mirar el largo). */
export function tieneReglaNominal(product: SyntheticProductLike & { readonly tipo_pieza?: unknown }): boolean {
  return product.tipo_pieza === 'recta' && numOrNull(product.ancho_nominal_mm) !== null && numOrNull(product.ala_nominal_mm) !== null;
}
