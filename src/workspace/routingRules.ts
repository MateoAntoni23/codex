/**
 * Pure functions for interactive tray routing.
 * No side effects — all functions are deterministic and testable.
 */
import type { Piece, Product, Context, CatalogCompatibility, CatalogUnionComponent } from '../tray/model';
import { isHorizontalCurve, isStraight } from './pieceClassification';
import { recipePortToCatalogPort, resolveCatalogPort } from './catalogPortMapping';

export type Point3 = [number, number, number];

export interface FreePort {
  pieceId: string;
  portName: string;
  pos: Point3;
  dir: Point3;
  /**
   * Eje "arriba de sección" en mundo (v_dir del marco local del puerto rotado
   * al mundo). Se propaga como `PlaceOptions.sectionUp` al colocar la siguiente
   * pieza para que el puente arme el marco completo sin suponer que la sección
   * está siempre en el plano horizontal.
   *
   * Heurística (sin tocar la persistencia TrayPort — sólo guarda posición y
   * dirección):
   *   - Puerto horizontal (|dir[2]| ≈ 0): [0,0,1] (eje Z mundo).
   *   - Puerto vertical: vector del puerto horizontal pareja de la misma pieza
   *     hacia este puerto, proyectado al plano XY y normalizado. Captura la
   *     orientación en planta de la sección transversal de CUPS (y análogos).
   *   - Fallback cuando no hay pareja o la proyección degenera: [1,0,0].
   */
  sectionUp: Point3;
}

type Connection = { conexion_id: string; a: [string, string]; b: [string, string] };

/** Returns a set of "pieceId:portName" keys for all ports already in a connection. */
export function getOccupiedPorts(conexiones: Connection[]): Set<string> {
  const occupied = new Set<string>();
  for (const c of conexiones) {
    occupied.add(`${c.a[0]}:${c.a[1]}`);
    occupied.add(`${c.b[0]}:${c.b[1]}`);
  }
  return occupied;
}

/** Tolerancia para clasificar un puerto como "horizontal" por su componente Z. */
const VERTICAL_DIR_TOLERANCE = 1e-3;

/**
 * Fallback para piezas legadas sin `orientacion_seccion_ws` persistido (proyectos
 * previos a la migración D7). Deriva el `sectionUp` mundial de la pieza y su
 * boca pareja horizontal. Nuevas inserciones persisten el valor canónico
 * (`PlacedPort.vDir`); esta heurística sólo se usa como fallback.
 */
function fallbackPortSectionUp(
  dir: Point3,
  pos: Point3,
  horizontalPairPos: Point3 | null,
): Point3 {
  if (Math.abs(dir[2]) < VERTICAL_DIR_TOLERANCE) return [0, 0, 1];
  if (horizontalPairPos) {
    const dx = pos[0] - horizontalPairPos[0];
    const dy = pos[1] - horizontalPairPos[1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) return [dx / len, dy / len, 0];
  }
  return [1, 0, 0];
}

/** Devuelve la posición del primer puerto horizontal de la pieza, o null. */
function findHorizontalPortPos(piece: Piece): Point3 | null {
  for (const port of Object.values(piece.puertos)) {
    const dir = port.direccion as Point3;
    if (Math.abs(dir[2]) < VERTICAL_DIR_TOLERANCE) {
      return port.posicion_mm as Point3;
    }
  }
  return null;
}

/** Returns all ports that are not part of any existing connection. */
export function getFreePorts(pieces: Piece[], conexiones: Connection[]): FreePort[] {
  const occupied = getOccupiedPorts(conexiones);
  const free: FreePort[] = [];
  for (const piece of pieces) {
    const horizontalPairPos = findHorizontalPortPos(piece);
    for (const [portName, port] of Object.entries(piece.puertos)) {
      if (!occupied.has(`${piece.instancia_id}:${portName}`)) {
        const pos = port.posicion_mm as Point3;
        const dir = port.direccion as Point3;
        // Ruta canónica D7: leer el `v_dir` del puerto persistido en la pieza.
        // Las piezas insertadas después de la migración llevan el valor correcto
        // computado por `placeRecipe` (= `PlacedPort.vDir`). Para piezas legadas
        // sin el campo, caemos al fallback heurístico.
        const persisted = (port as { orientacion_seccion_ws?: Point3 }).orientacion_seccion_ws;
        const sectionUp: Point3 = persisted ?? fallbackPortSectionUp(dir, pos, horizontalPairPos);
        free.push({
          pieceId: piece.instancia_id,
          portName,
          pos,
          dir,
          sectionUp,
        });
      }
    }
  }
  return free;
}

/** Snaps a direction to the nearest principal axis (±X, ±Y, ±Z). */
export function snapDirectionToAxis(dir: Point3): Point3 {
  const ax = Math.abs(dir[0]);
  const ay = Math.abs(dir[1]);
  const az = Math.abs(dir[2]);
  if (ax >= ay && ax >= az) return [Math.sign(dir[0]) as 1 | -1, 0, 0];
  if (ay >= ax && ay >= az) return [0, Math.sign(dir[1]) as 1 | -1, 0];
  return [0, 0, Math.sign(dir[2]) as 1 | -1];
}

/** Computes the endpoint of a continuation from a port. */
export function computeEndpoint(pos: Point3, dir: Point3, lengthMm: number): Point3 {
  return [
    pos[0] + dir[0] * lengthMm,
    pos[1] + dir[1] * lengthMm,
    pos[2] + dir[2] * lengthMm,
  ];
}

/**
 * Returns the angle in degrees between two direction vectors.
 * Both vectors are assumed to be unit vectors.
 */
export function angleBetweenDirs(a: Point3, b: Point3): number {
  const dot = Math.min(1, Math.max(-1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]));
  return (Math.acos(Math.abs(dot)) * 180) / Math.PI;
}

/**
 * Returns true if snapping `dir` to its nearest axis would change the direction
 * by more than `maxDegrees`.
 */
export function snapChangesDirection(dir: Point3, maxDegrees = 1): boolean {
  const snapped = snapDirectionToAxis(dir);
  return angleBetweenDirs(dir, snapped) > maxDegrees;
}

// ─── Catalog lookup ───────────────────────────────────────────────────────────

/** Build the catalog port ID from a product ID and a TrayInput port name. */
export function catalogPortId(productId: string, portName: string): string {
  return `${productId}-${portName}`;
}

export interface UnionRequirement {
  productId: string;
  quantity: number;
}

export interface DirectCompatResult {
  ok: boolean;
  needsReduction: boolean;
  reason: string;
  /**
   * compatibilidad_id of the matching entry, or null if not found.
   * undefined means: data not available (empty catalog tables).
   */
  compatibilidadId: string | null | undefined;
  requiredUnion: UnionRequirement[];
  evidence: string; // estado_evidencia or empty
  /**
   * Port on the new piece to use in the connection.
   * Usually 'P1'; may be 'P2' when the catalog documents the reversed orientation
   * and D-13 (straight-piece equivalence) does not apply.
   */
  newPiecePort: string;
}

/**
 * Finds a COMPATIBILIDADES entry where both ports belong to the given product pair,
 * regardless of a→b or b→a order, and regardless of P1/P2 direction.
 * Only considers 'directa' tipo_conexion.
 */
function findCompatEntryByProducts(
  compatibilidades: CatalogCompatibility[],
  productAId: string,
  productBId: string,
): CatalogCompatibility | null {
  for (const c of compatibilidades) {
    if (c.tipo_conexion !== 'directa') continue;
    if (c.estado_compatibilidad === 'no compatible') continue;
    if (
      (c.producto_a_id === productAId && c.producto_b_id === productBId) ||
      (c.producto_a_id === productBId && c.producto_b_id === productAId)
    ) {
      return c;
    }
  }
  return null;
}

/** Port-level lookup: requires the specific port IDs to match when the catalog documents them. */
function findCompatEntryPortLevel(
  compatibilidades: CatalogCompatibility[],
  productAId: string,
  portAName: string,
  productBId: string,
  portBName: string,
): CatalogCompatibility | null {
  // Traducción recipe-port → catalog-port (ver catalogPortMapping.ts). Es
  // no-op para productos 2-boca que ya usan P1/P2.
  const catA = recipePortToCatalogPort(productAId, portAName);
  const catB = recipePortToCatalogPort(productBId, portBName);
  // Boca sin calibración: no hay forma de saber qué puerto del catálogo es → no
  // se afirma compatibilidad (queda como excepción con motivo).
  if (catA === null || catB === null) return null;
  const portAId = `${productAId}-${catA}`;
  const portBId = `${productBId}-${catB}`;
  for (const c of compatibilidades) {
    if (c.tipo_conexion !== 'directa') continue;
    if (c.estado_compatibilidad === 'no compatible') continue;
    const pairFwd = c.producto_a_id === productAId && c.producto_b_id === productBId;
    const pairRev = c.producto_a_id === productBId && c.producto_b_id === productAId;
    if (!pairFwd && !pairRev) continue;
    // No port data in catalog → accept on product match alone
    if (c.puerto_a_id == null && c.puerto_b_id == null) return c;
    // Port-level match (both orientations)
    if (
      (c.puerto_a_id === portAId && c.puerto_b_id === portBId) ||
      (c.puerto_a_id === portBId && c.puerto_b_id === portAId)
    ) {
      return c;
    }
  }
  return null;
}

/**
 * D-13: straight pieces with equal ancho, ala have equivalent extremes — the
 * motor accepts any P1/P2 combination between them. Checks `isStraight` from
 * the centralized classification (uses the raw catalog tipo_pieza='recta').
 */
function isD13Equivalent(a: Product, b: Product): boolean {
  if (!isStraight(a) || !isStraight(b)) return false;
  if (a.ancho_nominal_mm == null || a.ancho_nominal_mm !== b.ancho_nominal_mm) return false;
  const alaA = (a as Record<string, unknown>).ala_nominal_mm as number | null | undefined;
  const alaB = (b as Record<string, unknown>).ala_nominal_mm as number | null | undefined;
  // Both must be equal (including both absent)
  if (alaA !== alaB) return false;
  return true;
}

function getUnionComponents(
  componentesUnion: CatalogUnionComponent[],
  compatibilidadId: string,
): UnionRequirement[] {
  return componentesUnion
    .filter((u) => u.compatibilidad_id === compatibilidadId)
    .map((u) => ({ productId: u.producto_requerido_id, quantity: u.cantidad }));
}

/**
 * True when the catalog explicitly documents a self-compatibility entry that
 * joins P1 to P2 (or vice-versa) of the same product. This is the catalog's
 * declaration that the two ports are interchangeable for lookup purposes.
 *
 * Example: SAM_TRES-300-065-18-Z has CMP-01535 (producto_a==producto_b,
 * puerto_a=P1, puerto_b=P2), so queries documented against P1 are also valid
 * for P2 and vice-versa.
 *
 * Also returns true for horizontal curves — their two ports share the same
 * interface by construction and the catalog documents only P1 entries.
 */
export function hasSelfPortEquivalence(
  compatibilidades: CatalogCompatibility[],
  product: Product,
): boolean {
  if (isHorizontalCurve(product)) return true;
  const pid = product.producto_id;
  const p1 = `${pid}-P1`;
  const p2 = `${pid}-P2`;
  for (const c of compatibilidades) {
    if (c.tipo_conexion !== 'directa') continue;
    if (c.estado_compatibilidad === 'no compatible') continue;
    if (c.producto_a_id !== pid || c.producto_b_id !== pid) continue;
    if ((c.puerto_a_id === p1 && c.puerto_b_id === p2) ||
        (c.puerto_a_id === p2 && c.puerto_b_id === p1)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if `existingProduct` and `newProduct` can be connected directly.
 * Uses COMPATIBILIDADES as the authoritative source; falls back to a heuristic
 * message if the tables are empty (motor didn't return them).
 */
export function checkDirectCompatibility(
  context: Pick<Context, 'compatibilidades' | 'componentesUnion'>,
  existingProduct: Product,
  existingPortName: string,
  newProduct: Product,
  newPortName: string,
): DirectCompatResult {
  const { compatibilidades, componentesUnion } = context;

  // No catalog data available — cannot verify
  if (!compatibilidades || compatibilidades.length === 0) {
    return {
      ok: false,
      needsReduction: false,
      reason: 'Tablas de compatibilidad no disponibles (el motor no las devolvió en este contexto). No se puede verificar la conexión.',
      compatibilidadId: undefined,
      requiredUnion: [],
      evidence: '',
      newPiecePort: newPortName,
    };
  }

  // Try exact port match first
  const entry = findCompatEntryPortLevel(
    compatibilidades,
    existingProduct.producto_id, existingPortName,
    newProduct.producto_id, newPortName,
  );

  if (entry) {
    const union = getUnionComponents(componentesUnion, entry.compatibilidad_id);
    return {
      ok: true,
      needsReduction: false,
      reason: `Compatible según catálogo (${entry.compatibilidad_id}).`,
      compatibilidadId: entry.compatibilidad_id,
      requiredUnion: union,
      evidence: entry.estado_evidencia ?? '',
      newPiecePort: newPortName,
    };
  }

  // Try the other port of the new piece (P1↔P2 or P2↔P1)
  const altNewPortName = newPortName === 'P1' ? 'P2' : 'P1';
  const altEntry = findCompatEntryPortLevel(
    compatibilidades,
    existingProduct.producto_id, existingPortName,
    newProduct.producto_id, altNewPortName,
  );

  if (altEntry) {
    // D-13: straight pieces with equal dimensions have equivalent extremes.
    // The motor accepts any P1/P2 combo → keep the originally requested port.
    // Without D-13 (accessories, different sizes), the catalog orientation is authoritative.
    const d13 = isD13Equivalent(existingProduct, newProduct);
    const resolvedPort = d13 ? newPortName : altNewPortName;
    const union = getUnionComponents(componentesUnion, altEntry.compatibilidad_id);
    const reason = d13
      ? `Compatible según catálogo (${altEntry.compatibilidad_id}) — equivalencia D-13.`
      : `Compatible según catálogo (${altEntry.compatibilidad_id}) — conectar por puerto ${altNewPortName}.`;
    return {
      ok: true,
      needsReduction: false,
      reason,
      compatibilidadId: altEntry.compatibilidad_id,
      requiredUnion: union,
      evidence: altEntry.estado_evidencia ?? '',
      newPiecePort: resolvedPort,
    };
  }

  // Symmetric fallback: fires when the catalog declares the existing product's
  // two ports as interchangeable (self-compat P1↔P2 entry, or horizontal curve
  // by construction). Required because the catalog typically documents only
  // one port per product; queries against the other port must be matched too.
  if (hasSelfPortEquivalence(compatibilidades, existingProduct)) {
    const altExistPortName = existingPortName === 'P1' ? 'P2' : 'P1';
    const symEntry = findCompatEntryPortLevel(
      compatibilidades,
      existingProduct.producto_id, altExistPortName,
      newProduct.producto_id, newPortName,
    );
    if (symEntry) {
      const union = getUnionComponents(componentesUnion, symEntry.compatibilidad_id);
      return {
        ok: true,
        needsReduction: false,
        reason: `Compatible según catálogo (${symEntry.compatibilidad_id}) — simetría de puerto.`,
        compatibilidadId: symEntry.compatibilidad_id,
        requiredUnion: union,
        evidence: symEntry.estado_evidencia ?? '',
        newPiecePort: newPortName,
      };
    }
    const symAltEntry = findCompatEntryPortLevel(
      compatibilidades,
      existingProduct.producto_id, altExistPortName,
      newProduct.producto_id, altNewPortName,
    );
    if (symAltEntry) {
      const d13 = isD13Equivalent(existingProduct, newProduct);
      const resolvedPort = d13 ? newPortName : altNewPortName;
      const union = getUnionComponents(componentesUnion, symAltEntry.compatibilidad_id);
      const reason = d13
        ? `Compatible según catálogo (${symAltEntry.compatibilidad_id}) — equivalencia D-13, simetría de puerto.`
        : `Compatible según catálogo (${symAltEntry.compatibilidad_id}) — conectar por puerto ${altNewPortName}, simetría de puerto.`;
      return {
        ok: true,
        needsReduction: false,
        reason,
        compatibilidadId: symAltEntry.compatibilidad_id,
        requiredUnion: union,
        evidence: symAltEntry.estado_evidencia ?? '',
        newPiecePort: resolvedPort,
      };
    }
  }

  // No compatible entry found — check for explicit 'no compatible' entry
  const noComp = compatibilidades.find(
    (c) =>
      c.estado_compatibilidad === 'no compatible' &&
      (
        (c.producto_a_id === existingProduct.producto_id && c.producto_b_id === newProduct.producto_id) ||
        (c.producto_a_id === newProduct.producto_id && c.producto_b_id === existingProduct.producto_id)
      ),
  );
  if (noComp) {
    return {
      ok: false,
      needsReduction: false,
      reason: `Incompatibles según catálogo (${noComp.compatibilidad_id}).`,
      compatibilidadId: noComp.compatibilidad_id,
      requiredUnion: [],
      evidence: noComp.estado_evidencia ?? '',
      newPiecePort: newPortName,
    };
  }

  // No entry at all — might need reduction or simply not documented
  const famA = (existingProduct as Record<string, unknown>).familia_id as string | undefined;
  const famB = (newProduct as Record<string, unknown>).familia_id as string | undefined;
  const wA = existingProduct.ancho_nominal_mm;
  const wB = newProduct.ancho_nominal_mm;

  if (famA && famB && famA !== famB) {
    return {
      ok: false,
      needsReduction: false,
      reason: `Sin evidencia de compatibilidad en el catálogo. Familias distintas (${famA} ≠ ${famB}).`,
      compatibilidadId: null,
      requiredUnion: [],
      evidence: '',
      newPiecePort: newPortName,
    };
  }

  if (wA != null && wB != null && wA !== wB) {
    return {
      ok: false,
      needsReduction: true,
      reason: `Sin conexión directa en el catálogo. Anchos distintos (${wA} ≠ ${wB} mm) — puede requerir reducción.`,
      compatibilidadId: null,
      requiredUnion: [],
      evidence: '',
      newPiecePort: newPortName,
    };
  }

  return {
    ok: false,
    needsReduction: false,
    reason: `Sin evidencia de compatibilidad directa en el catálogo para estos productos.`,
    compatibilidadId: null,
    requiredUnion: [],
    evidence: '',
    newPiecePort: newPortName,
  };
}

// ─── Reduction candidates ─────────────────────────────────────────────────────

export interface ReductionCandidate {
  reductionProduct: Product;
  /** Catalog port of reduction that connects to the EXISTING piece. */
  reductionPortToExisting: string; // 'P1' or 'P2'
  /** Catalog port of reduction that connects to the NEW piece. */
  reductionPortToNew: string; // the other one
  compatWithExisting: CatalogCompatibility;
  compatWithNew: CatalogCompatibility;
  unionForExistingConn: UnionRequirement[];
  unionForNewConn: UnionRequirement[];
  /** False when longitud_comercial_mm is null — insertion must be blocked. */
  geometryDocumented: boolean;
}

/**
 * Finds all reduction products that can bridge from `existingProduct` to `newProduct`,
 * checking BOTH ports of each reduction candidate against the catalog.
 *
 * A candidate is valid only if:
 * 1. There is a 'directa' compatibility between existingProduct and reductionProduct (some port)
 * 2. There is a 'directa' compatibility between reductionProduct (other port) and newProduct
 */
export function findReductionCandidates(
  context: Pick<Context, 'productos' | 'compatibilidades' | 'componentesUnion' | 'puertos'>,
  existingProduct: Product,
  newProduct: Product,
): ReductionCandidate[] {
  const { productos, compatibilidades, componentesUnion, puertos } = context;

  if (!compatibilidades || compatibilidades.length === 0) return [];

  const reductions = productos.filter((p) => p.tipo_pieza === 'reducción');
  const candidates: ReductionCandidate[] = [];

  for (const red of reductions) {
    // Step 1: find compatibility entry for existingProduct ↔ reduction
    const compatExisting = findCompatEntryByProducts(compatibilidades, existingProduct.producto_id, red.producto_id);
    if (!compatExisting) continue;

    // Step 2: determine which port of the reduction connects to existingProduct
    // The entry has puerto_a_id and puerto_b_id; find the one belonging to the reduction
    let redPortToExisting: string | null = null;
    if (compatExisting.puerto_a_id?.startsWith(red.producto_id + '-')) {
      redPortToExisting = compatExisting.puerto_a_id.slice(red.producto_id.length + 1);
    } else if (compatExisting.puerto_b_id?.startsWith(red.producto_id + '-')) {
      redPortToExisting = compatExisting.puerto_b_id.slice(red.producto_id.length + 1);
    } else {
      // Can't determine orientation — skip
      continue;
    }

    // Step 3: find the other port of the reduction
    const redCatalogPorts = puertos?.filter((p) => p.producto_id === red.producto_id) ?? [];
    const redPortToNew = redCatalogPorts.find((p) => {
      const suffix = p.puerto_id.slice(red.producto_id.length + 1);
      return suffix !== redPortToExisting;
    });
    if (!redPortToNew) continue;
    const redPortToNewName = redPortToNew.puerto_id.slice(red.producto_id.length + 1);

    // Step 4: check there's a compatibility entry for reduction's other port ↔ newProduct
    // We search by product pair (not specific port), which is sufficient to confirm catalog support
    const compatNew = findCompatEntryByProducts(compatibilidades, red.producto_id, newProduct.producto_id);
    if (!compatNew) continue;

    // Verify the compatNew entry uses the correct port of the reduction
    const usesCorrectPort =
      (compatNew.puerto_a_id?.startsWith(red.producto_id + '-') &&
        compatNew.puerto_a_id.slice(red.producto_id.length + 1) === redPortToNewName) ||
      (compatNew.puerto_b_id?.startsWith(red.producto_id + '-') &&
        compatNew.puerto_b_id.slice(red.producto_id.length + 1) === redPortToNewName);
    if (!usesCorrectPort) continue;

    candidates.push({
      reductionProduct: red,
      reductionPortToExisting: redPortToExisting,
      reductionPortToNew: redPortToNewName,
      compatWithExisting: compatExisting,
      compatWithNew: compatNew,
      unionForExistingConn: getUnionComponents(componentesUnion, compatExisting.compatibilidad_id),
      unionForNewConn: getUnionComponents(componentesUnion, compatNew.compatibilidad_id),
      geometryDocumented: (red as Record<string, unknown>).longitud_comercial_mm != null,
    });
  }

  return candidates;
}

// ─── Compatible product lookup ───────────────────────────────────────────────

/**
 * Returns the set of product IDs that have at least one documented direct
 * compatibility entry connecting to the given port of the existing product.
 *
 * Uses port-level matching when catalog entries carry port IDs; falls back to
 * product-level for the 626 entries with null puerto_a_id/puerto_b_id.
 *
 * Does NOT filter by tipo_pieza — the caller decides which product types to show.
 */
/**
 * Compatibilidad de una boca existente con estado explícito: si la boca no tiene
 * calibración (no se sabe a qué puerto del catálogo corresponde), se informa como
 * `uncalibrated` en lugar de "0 compatibles".
 */
export type PortCompatibility =
  | { status: 'ok'; ids: Set<string> }
  | { status: 'uncalibrated'; reason: string };

export function getPortCompatibility(
  compatibilidades: CatalogCompatibility[],
  existingProductId: string,
  existingPortName: string,
): PortCompatibility {
  const res = resolveCatalogPort(existingProductId, existingPortName);
  if (res.status === 'uncalibrated') return { status: 'uncalibrated', reason: res.reason };
  return { status: 'ok', ids: getCompatibleProductIds(compatibilidades, existingProductId, existingPortName) };
}

export function getCompatibleProductIds(
  compatibilidades: CatalogCompatibility[],
  existingProductId: string,
  existingPortName: string,
): Set<string> {
  // Traducir el nombre de boca (semántica de la receta, p.ej. 'tronco_P2' o
  // 'boca_derivacion' en una TPS) al nombre anónimo que usa el catálogo SAMET
  // (P1/P2/P3). Para productos 2-boca (rectos, curvas horizontales) el
  // mapping es identidad y esta llamada es un no-op. Ver catalogPortMapping.ts
  // para el default declarado y la API de overrides del configurador.
  const catalogPortName = recipePortToCatalogPort(existingProductId, existingPortName);
  const result = new Set<string>();
  // Sin calibración: no se adivina el puerto (ver getPortCompatibility para el estado).
  if (catalogPortName === null) return result;
  const portId = `${existingProductId}-${catalogPortName}`;

  for (const c of compatibilidades) {
    if (c.tipo_conexion !== 'directa') continue;
    if (c.estado_compatibilidad === 'no compatible') continue;

    const isA = c.producto_a_id === existingProductId;
    const isB = c.producto_b_id === existingProductId;
    if (!isA && !isB) continue;

    const hasPortData = c.puerto_a_id != null || c.puerto_b_id != null;
    const portMatches = !hasPortData || c.puerto_a_id === portId || c.puerto_b_id === portId;

    if (portMatches) {
      result.add(isA ? c.producto_b_id : c.producto_a_id);
    }
  }

  return result;
}

// ─── Port validity check ──────────────────────────────────────────────────────

export interface StartPort {
  pieceId: string;
  portName: string;
  pos: Point3;
  dir: Point3;
  /**
   * Eje "arriba de sección" en mundo, propagado desde el FreePort elegido.
   * Opcional por compatibilidad con fixtures de tests existentes y para que
   * selectores que sólo tienen pos/dir no rompan tipos. Cuando está ausente
   * el puente usa el default implícito [0,0,1] — correcto para toda entrada
   * horizontal del catálogo actual.
   */
  sectionUp?: Point3;
}

/**
 * Verifies that the start port still exists in the current tray,
 * is still free (not in any connection), and its geometry hasn't changed.
 */
export function verifyStartPortValid(
  pieces: Piece[],
  conexiones: Connection[],
  startPort: StartPort,
  posTolerance = 0.01, // mm
  dirToleranceDeg = 1, // degrees
): { valid: boolean; reason: string } {
  const piece = pieces.find((p) => p.instancia_id === startPort.pieceId);
  if (!piece) {
    return { valid: false, reason: `La pieza "${startPort.pieceId}" ya no existe en el trazado.` };
  }

  const port = piece.puertos[startPort.portName];
  if (!port) {
    return { valid: false, reason: `El puerto "${startPort.portName}" ya no existe en la pieza "${startPort.pieceId}".` };
  }

  const occupied = getOccupiedPorts(conexiones);
  if (occupied.has(`${startPort.pieceId}:${startPort.portName}`)) {
    return { valid: false, reason: `El puerto ${startPort.pieceId}.${startPort.portName} fue ocupado por otra conexión mientras se configuraba.` };
  }

  const pos = port.posicion_mm as Point3;
  const dist = Math.hypot(pos[0] - startPort.pos[0], pos[1] - startPort.pos[1], pos[2] - startPort.pos[2]);
  if (dist > posTolerance) {
    return { valid: false, reason: `La posición del puerto cambió desde que se seleccionó (desviación ${dist.toFixed(2)} mm).` };
  }

  const currentDir = port.direccion as Point3;
  const dirAngle = angleBetweenDirs(currentDir, startPort.dir);
  if (dirAngle > dirToleranceDeg) {
    return { valid: false, reason: `La dirección del puerto cambió desde que se seleccionó (${dirAngle.toFixed(1)}°).` };
  }

  return { valid: true, reason: '' };
}

// ─── ID generation ────────────────────────────────────────────────────────────

/** Returns the first CON-NNN identifier not in existingIds. */
export function generateConnectionId(existingIds: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `CON-${String(n).padStart(3, '0')}`;
    if (!existingIds.has(id)) return id;
  }
}
