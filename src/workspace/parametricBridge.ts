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
import {
  PARAMETRIC_CATALOG,
  type ParametricEntry,
} from '../parametric/catalog';
import {
  buildRecipeFor,
  type PieceKind,
  type RawParams,
} from '../parametric/geometry/recipes';
import { buildPrism } from '../parametric/geometry/buildPrism';
import type { GeometryRecipe, PortDef } from '../parametric/geometry/outlines';
import type { Piece, Product, TrayPort } from '../tray/model';

// ─── Tipos del puente ────────────────────────────────────────────────────────

export type Vec3 = [number, number, number];

/** Chiralidad geométrica respecto al polígono medido del STEP. */
export type Chirality = 'native' | 'mirrored';

export interface PlacedPort {
  readonly name: string;
  readonly pos: Vec3;
  /** Normal exterior (apunta "hacia afuera" del cuerpo de la pieza). */
  readonly outwardNormal: Vec3;
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
  /** Distancia mm entre P2 teórico y P2 real de la pieza. */
  readonly p2PosErrorMm: number;
  /** Ángulo grados entre P2.direccion teórico y real. */
  readonly p2DirErrorDeg: number;
  readonly matches: boolean;
}

// ─── Índice de recetas por SKU ───────────────────────────────────────────────
//
// El campo `sku` del snapshot del catálogo real coincide 1:1 con el `sku` de
// cada vista paramétrica (reconstruction/variant). No hay prefijo `SAM_` ni
// extensión `.STEP` — el `entry.recipe` sí la lleva, pero ese campo es un
// identificador interno de la vista ?pilot=step.

const ENTRY_BY_SKU = new Map<string, ParametricEntry>();
for (const entry of PARAMETRIC_CATALOG) {
  ENTRY_BY_SKU.set(entry.reconstruction.sku, entry);
  ENTRY_BY_SKU.set(entry.variant.sku, entry);
}

const SUPPORTED_PIECE_KINDS: ReadonlySet<PieceKind> = new Set([
  'tramo_recto',
  'curva_horizontal',
  'derivacion_lateral',
  'cruz',
  'curva_vertical',
]);

/**
 * Devuelve la entrada paramétrica aplicable al producto o `null` si no hay
 * receta medida para él (ya sea por SKU no incluido, o por tipo de pieza fuera
 * del scope actual del puente).
 */
export function resolveRecipe(
  product: { sku?: string | null } | null | undefined,
): ParametricEntry | null {
  if (!product || typeof product.sku !== 'string' || !product.sku) return null;
  const entry = ENTRY_BY_SKU.get(product.sku);
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
 */
export function resolveParametricEntry(
  product: { sku?: string | null } | null | undefined,
): ParametricEntry | null {
  if (!product || typeof product.sku !== 'string' || !product.sku) return null;
  return ENTRY_BY_SKU.get(product.sku) ?? null;
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

  if (entry.piece_kind === 'tramo_recto') {
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

  if (entry.piece_kind === 'curva_horizontal') {
    const ang = (product as Record<string, unknown>).angulo_grados;
    if (typeof ang === 'number' && Number.isFinite(ang) && ang > 0) {
      params.angulo_deg = ang;
    }
  }

  return buildRecipeFor(entry.piece_kind, params as RawParams);
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

export function placeRecipe(
  product: Product,
  entry: ParametricEntry,
  startPos: readonly [number, number, number],
  entryDir: readonly [number, number, number],
  chirality: Chirality,
  overrides?: BuildRecipeOverrides,
  options?: PlaceOptions,
): PlacedRecipe {
  const recipe = buildRecipeFromProduct(product, entry, overrides);
  // Nota: ambos modos (extrudeAlongY true/false) comparten M_base. La única
  // restricción real es que la normal local del puerto de entrada no tenga
  // componente Y — eso se valida unos renglones más abajo via `entryDef.normal[1]`.
  // Antes se bloqueaba toda receta vertical aquí; se removió porque CUPS
  // (extrudeAlongY=false) se coloca correctamente cuando se entra por su
  // boca horizontal (P1_horizontal, normal (-1,0,0) sin componente Y).
  if (Math.abs(entryDir[2]) > HORIZONTAL_ENTRY_TOLERANCE) {
    throw new Error(
      `parametricBridge.placeRecipe: entryDir no horizontal (Z=${entryDir[2]}); scope actual sólo acepta direcciones en el plano XY`,
    );
  }

  const entryDef = resolveEntryPort(recipe, options?.entryPortName);
  // La entrada por un puerto cuya normal tenga componente Y en el marco local
  // implica una conexión vertical (pieza que entra desde arriba/abajo). Esto
  // requiere un marco base distinto que todavía no está habilitado.
  if (Math.abs(entryDef.normal[1]) > HORIZONTAL_ENTRY_TOLERANCE) {
    throw new Error(
      `parametricBridge.placeRecipe: puerto '${entryDef.name}' tiene normal con componente Y local (${entryDef.normal.join(', ')}); entrada vertical pendiente de habilitar`,
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

  const mirrored = chirality === 'mirrored';
  const finalMatrix = mirrored
    ? householderMatrixAroundPoint(startPos, eDir).multiply(baseMatrix)
    : baseMatrix;

  // Calcular TODOS los puertos mundo aplicando finalMatrix a los centros y
  // rotando las normales con la parte lineal (sin traslación). Para una
  // reflexión la parte lineal es ortogonal con det=−1 pero sigue preservando
  // longitudes.
  const placedPorts: PlacedPort[] = recipe.ports.map((port) => ({
    name: port.name,
    pos: applyMatrixToPoint(finalMatrix, port.center),
    outwardNormal: applyMatrixToDir(finalMatrix, port.normal),
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
 */
export function buildLocalMesh(recipe: GeometryRecipe): THREE.BufferGeometry {
  return buildPrism(recipe.polygon, recipe.height, recipe.extrudeAlongY);
}

// ─── Verificación geométrica contra una pieza ya colocada ───────────────────

const FIT_POS_TOLERANCE_MM = 2.0;
const FIT_DIR_TOLERANCE_DEG = 1.5;

/**
 * Comprueba si una pieza ya colocada (con sus `puertos` del Piece) encaja
 * con la receta paramétrica del producto. Prueba ambas chiralidades y
 * devuelve la mejor; `matches=true` cuando el error de posición de P2 está
 * por debajo de 2 mm y el de dirección por debajo de 1.5°.
 *
 * Se usa para decidir si una pieza existente puede renderizarse con la
 * malla paramétrica (preservando posición/dimensiones) o si se mantiene con
 * la representación anterior.
 */
export function verifyGeometricFit(
  product: Product,
  piece: Piece,
): GeometricFit | null {
  const entry = resolveRecipe(product);
  if (!entry) return null;

  const p1 = piece.puertos.P1 as TrayPort | undefined;
  const p2 = piece.puertos.P2 as TrayPort | undefined;
  if (!p1 || !p2) return null;

  const startPos = p1.posicion_mm as [number, number, number];
  // entryDir = opuesto a P1.direccion (la pieza previa apunta hacia P1).
  const entryDir: Vec3 = [-p1.direccion[0], -p1.direccion[1], -p1.direccion[2]];

  // Para tramos rectos, forzar longitud real de la pieza.
  const overrides: BuildRecipeOverrides | undefined =
    entry.piece_kind === 'tramo_recto'
      ? { longitud_mm: lengthFromPiece(piece) }
      : undefined;

  const native = tryPlacement(product, entry, startPos, entryDir, 'native', overrides, p2);
  const mirrored = tryPlacement(product, entry, startPos, entryDir, 'mirrored', overrides, p2);

  const best = native.p2PosErrorMm <= mirrored.p2PosErrorMm ? native : mirrored;
  const matches =
    best.p2PosErrorMm <= FIT_POS_TOLERANCE_MM &&
    best.p2DirErrorDeg <= FIT_DIR_TOLERANCE_DEG;

  return { entry, chirality: best.chirality, p2PosErrorMm: best.p2PosErrorMm, p2DirErrorDeg: best.p2DirErrorDeg, matches };
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

function tryPlacement(
  product: Product,
  entry: ParametricEntry,
  startPos: readonly [number, number, number],
  entryDir: Vec3,
  chirality: Chirality,
  overrides: BuildRecipeOverrides | undefined,
  actualP2: TrayPort,
): { chirality: Chirality; p2PosErrorMm: number; p2DirErrorDeg: number } {
  const placed = placeRecipe(product, entry, startPos, entryDir, chirality, overrides);
  const dx = placed.p2.pos[0] - actualP2.posicion_mm[0];
  const dy = placed.p2.pos[1] - actualP2.posicion_mm[1];
  const dz = placed.p2.pos[2] - actualP2.posicion_mm[2];
  const p2PosErrorMm = Math.hypot(dx, dy, dz);

  const n = placed.p2.outwardNormal;
  const r = actualP2.direccion;
  const dot = Math.min(1, Math.max(-1, n[0] * r[0] + n[1] * r[1] + n[2] * r[2]));
  const p2DirErrorDeg = (Math.acos(dot) * 180) / Math.PI;

  return { chirality, p2PosErrorMm, p2DirErrorDeg };
}

// ─── Exports auxiliares usados por integrators ──────────────────────────────

export { applyMBase as _applyMBaseForTests, phiForAlignment as _phiForTests };
export { reflectAcrossEntryAxis as _reflectForTests, reflectDir as _reflectDirForTests };
