/**
 * catalogPortMapping — asociación explícita boca-receta ↔ puerto-catálogo.
 *
 * Problema que resuelve: las recetas paramétricas de accesorios usan nombres
 * semánticos para las bocas (`tronco_P1`, `tronco_P2`, `boca_derivacion` para
 * un TPS; `P1_horizontal`, `P2_vertical` para CUPS; `P1_x_neg`...`P4_z_pos`
 * para XPS). El catálogo SAMET (`catalogo_bandejas_snapshot.json`), en
 * cambio, identifica los puertos con nombres anónimos P1/P2/P3/P4 (el
 * `puerto_a_id` y `puerto_b_id` de compatibilidades usan la forma
 * `${producto_id}-${nombre_catalogo}`, p.ej. `SAM_TPS-300-Z-P3`).
 *
 * Como `routingRules.getCompatibleProductIds` arma el `portId` concatenando
 * `${producto_id}-${nombre_boca_de_la_pieza}`, sin traducción la búsqueda
 * `SAM_TPS-300-Z-tronco_P2` NO coincide con ninguna entrada del catálogo
 * (que tiene `SAM_TPS-300-Z-P2`). Resultado: la TPS continuar-por-cada-salida
 * no encontraba candidatos compat aunque el catálogo sí los listara.
 *
 * Diseño:
 *  - Para productos de 2 bocas (tramos rectos, curvas horizontales) el default
 *    es IDENTIDAD — las recetas ya usan `P1`/`P2`, así que no se necesita
 *    mapping.
 *  - Para productos de 3+ bocas se declara un mapping explícito con su
 *    justificación geométrica/física.
 *  - El Configurador de biblioteca permitirá overridear este mapping por
 *    producto, con motivo y trazabilidad (gancho `applyOverrides` abajo).
 *    Hasta que exista override, se usa el default declarado aquí.
 *
 * Fuente de autoridad del default TPS (único accesorio 3-boca con compat
 * publicada hoy): instrucción explícita del usuario — tronco_P1→P1,
 * tronco_P2→P2, boca_derivacion→P3. El catálogo SAMET no publica
 * `puerto_descripcion` por lo que no hay otra fuente para contrastar.
 *
 * Diseño de IDs:
 *  - `recipePortName`: nombre tal como aparece en `piece.puertos` y en las
 *    recetas paramétricas (`outlines.ts`). Es el que se escribe en
 *    `conexiones.a[1]`/`conexiones.b[1]` del TrayInput.
 *  - `catalogPortName`: sufijo detrás del `-` en `puerto_a_id`/`puerto_b_id`
 *    del catálogo SAMET.
 *
 * Importante: este módulo NO redefine compatibilidades. Sólo traduce el
 * nombre del puerto de la pieza al nombre que usa el catálogo. Si el
 * catálogo no lista una compat para `P3`, no se inventa aunque el usuario
 * "sepa" que debería haberla — se devuelve la ausencia en forma honesta.
 */

/**
 * Override geométrico para una boca (opcional).
 *
 * Alcance: ajuste fino de centro/normal/sección/giro de instalación SIN
 * modificar el nombre semántico ni la asociación con el catálogo. Pensado
 * para corregir desvíos observados en campo sin editar la receta.
 *
 * Convención de unidades: mm para `centerMm`, grados para `installRotationDeg`;
 * `normal`, `uDir`, `vDir` son adimensionales (quedan normalizados en el
 * consumidor). Todas las coordenadas comparten el marco canónico de la pieza.
 */
export interface PortGeometryOverride {
  readonly centerMm?: readonly [number, number, number];
  readonly normal?: readonly [number, number, number];
  readonly uDir?: readonly [number, number, number];
  readonly vDir?: readonly [number, number, number];
  /** Giro de instalación alrededor del eje normal de la boca, en grados. */
  readonly installRotationDeg?: number;
}

export interface PortMappingEntry {
  readonly recipePortName: string;
  readonly catalogPortName: string;
  readonly physicalLabel: string;
  readonly justification: string;
  /** Override geométrico por boca. Si está ausente, se usa la receta cruda. */
  readonly geometry?: PortGeometryOverride;
}

/**
 * Transformación del MODELO al marco canónico (modo A, "calibrar modelo").
 *
 * Esto NO es posición de la instancia: es el ajuste del artefacto (mesh, mapping
 * por producto) para que su marco local coincida con lo que espera el motor.
 * Sólo afecta al producto correspondiente; las instancias en el proyecto heredan
 * esta corrección pero conservan su posición propia.
 */
export interface ModelFrameOverride {
  readonly tx_mm?: number;
  readonly ty_mm?: number;
  readonly tz_mm?: number;
  readonly rx_deg?: number;
  readonly ry_deg?: number;
  readonly rz_deg?: number;
}

export interface ProductPortMapping {
  readonly productId: string;
  readonly entries: readonly PortMappingEntry[];
  /**
   * Procedencia del mapping efectivo:
   *   - 'default'   proviene de DEFAULT_MAPPINGS (datos de fábrica).
   *   - 'override'  override directo guardado para este productId.
   *   - 'inherited' no hay override directo, se adopta el de un sibling con
   *                 la misma identidad de variante (misma geometría y mismas
   *                 bocas, distinto acabado/espesor/comercial). Permite que
   *                 configurar Z propague automáticamente a G y a otros
   *                 espesores sin re-pedir la calibración.
   */
  readonly source: 'default' | 'override' | 'inherited';
  /**
   * Cuando `source === 'inherited'`, productId del sibling de donde se
   * tomó el override. Permite mostrar "Calibración heredada de X" en UI y
   * trazar la cadena de herencia.
   */
  readonly inheritedFromProductId?: string;
  /** Motivo del override cuando source === 'override'. */
  readonly overrideReason?: string;
  readonly overrideAt?: string;
  /** Corrección del marco del modelo. Opcional. */
  readonly modelFrame?: ModelFrameOverride;
}

export const IDENTITY_MODEL_FRAME: ModelFrameOverride = {
  tx_mm: 0,
  ty_mm: 0,
  tz_mm: 0,
  rx_deg: 0,
  ry_deg: 0,
  rz_deg: 0,
};

/**
 * Verdadero cuando el override no mueve nada (todos los campos ausentes o 0).
 * Usar para evitar persistir ruido semánticamente nulo.
 */
export function isIdentityModelFrame(f: ModelFrameOverride | undefined): boolean {
  if (!f) return true;
  const keys: (keyof ModelFrameOverride)[] = ['tx_mm', 'ty_mm', 'tz_mm', 'rx_deg', 'ry_deg', 'rz_deg'];
  return keys.every((k) => (f[k] ?? 0) === 0);
}

/**
 * Verdadero cuando el override por boca no cambia nada observable: ningún
 * vector presente y `installRotationDeg` ausente o 0.
 */
export function isIdentityPortGeometry(g: PortGeometryOverride | undefined): boolean {
  if (!g) return true;
  if (g.centerMm || g.normal || g.uDir || g.vDir) return false;
  return (g.installRotationDeg ?? 0) === 0;
}

/**
 * Mapping canónico para la curva vertical (compartido entre perforada CUPS y
 * escalera CUS). Ambas comparten la misma receta `buildCUPSRecipe` que emite
 * nombres semánticos `P1_horizontal`/`P2_vertical`; el catálogo SAMET publica
 * P1/P2 en los puertos de cada SKU.
 */
const VERTICAL_CURVE_MAPPING: readonly PortMappingEntry[] = [
  {
    recipePortName: 'P1_horizontal',
    catalogPortName: 'P1',
    physicalLabel: 'Boca horizontal (bandeja)',
    justification: 'Orden declarado en la receta paramétrica: P1 es la cara horizontal.',
  },
  {
    recipePortName: 'P2_vertical',
    catalogPortName: 'P2',
    physicalLabel: 'Boca vertical (tramo ascendente/descendente)',
    justification: 'Orden declarado en la receta paramétrica: P2 es la cara vertical.',
  },
];

/**
 * SKUs CUS escalera (40 variantes publicadas por SAMET) que comparten la
 * receta `buildCUPSRecipe` por equivalencia conceptual autorizada por el
 * usuario (2026-11-10). Todos usan el mismo mapping `VERTICAL_CURVE_MAPPING`
 * — se declara aquí de forma explícita para que el inspector del
 * configurador pueda enumerarlas sin descubrimiento dinámico.
 */
const CUS_PRODUCT_IDS: readonly string[] = (() => {
  const ids: string[] = [];
  for (const ancho of [150, 300, 450, 600] as const) {
    for (const ala of [65, 90, 115, 150] as const) {
      // Espesor 18 publica Z y G; espesor 14 sólo publica G (snapshot catálogo).
      const skuAncho = String(ancho).padStart(3, '0');
      const skuAla = String(ala).padStart(3, '0');
      ids.push(`SAM_CUS-${skuAncho}-5-${skuAla}-18-Z`);
      ids.push(`SAM_CUS-${skuAncho}-5-${skuAla}-18-G`);
      ids.push(`SAM_CUS-${skuAncho}-5-${skuAla}-14-G`);
    }
  }
  return ids;
})();

/**
 * Defaults por producto. Sólo se declaran mappings NO triviales (recetas
 * con nombres semánticos). Las recetas 2-boca (TRPS, CPS-45, CPS-90) usan
 * P1/P2 y caen en el fallback identidad implícito.
 */
const DEFAULT_MAPPINGS: Readonly<Record<string, readonly PortMappingEntry[]>> = {
  // ─── TPS-300-Z (tee simétrica) ────────────────────────────────────────────
  'SAM_TPS-300-Z': [
    {
      recipePortName: 'tronco_P1',
      catalogPortName: 'P1',
      physicalLabel: 'Tronco (entrada)',
      justification:
        'Catálogo SAMET publica tres puertos P1/P2/P3 para TPS; sin descripción textual del fabricante, se adopta la asociación declarada por el usuario: tronco_P1 ≡ P1.',
    },
    {
      recipePortName: 'tronco_P2',
      catalogPortName: 'P2',
      physicalLabel: 'Tronco (salida)',
      justification:
        'Adoptado por decisión del usuario: tronco_P2 ≡ P2 del catálogo SAMET.',
    },
    {
      recipePortName: 'boca_derivacion',
      catalogPortName: 'P3',
      physicalLabel: 'Boca de derivación (lateral)',
      justification:
        'Adoptado por decisión del usuario: boca_derivacion ≡ P3 del catálogo SAMET.',
    },
  ],
  // ─── XPS-300-Z (cruz) ────────────────────────────────────────────────────
  // No hay compat publicada con nombres específicos para los 4 brazos — el
  // catálogo lista P1/P2/P3/P4 sin descripción. Adoptamos el orden del
  // polígono medido: P1≡x_neg, P2≡x_pos, P3≡z_neg, P4≡z_pos.
  'SAM_XPS-300-Z': [
    { recipePortName: 'P1_x_neg', catalogPortName: 'P1', physicalLabel: 'Brazo X−', justification: 'Orden de bocas del polígono medido.' },
    { recipePortName: 'P2_x_pos', catalogPortName: 'P2', physicalLabel: 'Brazo X+', justification: 'Orden de bocas del polígono medido.' },
    { recipePortName: 'P3_z_neg', catalogPortName: 'P3', physicalLabel: 'Brazo Z−', justification: 'Orden de bocas del polígono medido.' },
    { recipePortName: 'P4_z_pos', catalogPortName: 'P4', physicalLabel: 'Brazo Z+', justification: 'Orden de bocas del polígono medido.' },
  ],
  // ─── CUPS-300-A-Z (curva vertical interior perforada) ───────────────────
  'SAM_CUPS-300-A-Z': VERTICAL_CURVE_MAPPING,
  // ─── CUS escalera (curva vertical articulada) ────────────────────────────
  // 40 variantes que comparten receta y mapping con CUPS por equivalencia
  // conceptual autorizada por el usuario (2026-11-10).
  ...Object.fromEntries(CUS_PRODUCT_IDS.map((id) => [id, VERTICAL_CURVE_MAPPING])),
};

// ─── Store de overrides (in-memory, serializable) ───────────────────────────
//
// El store real vive en workspace/catalogConfigStore (Zustand) para poder ser
// observado desde React. Este módulo expone sólo la API funcional pura que
// consume ese store. El store llama a `setOverrides()` al cargar o editar
// la configuración; los lookups leen `_overrides`.

let _overrides: Readonly<Record<string, ProductPortMapping>> = {};

/**
 * Versión del estado que interviene en la definición efectiva (overrides,
 * índices, resolución de maestros). Cambia en cada escritura; la definición
 * efectiva la usa como parte de su clave de memoria.
 */
let _version = 0;
export function calibracionVersion(): number {
  return _version;
}

// ─── Herencia maestro → variantes ────────────────────────────────────────────
//
// Cuando el usuario configura el "producto base" de un maestro (p.ej.
// SAM_TRPS-300-22-Z para el maestro TRPS perforada), las variantes
// (SAM_TRPS-450-20-Z, …) deben heredar esa configuración sin re-pedirla.
//
// Contrato de herencia:
//   - `modelFrame`: se hereda TAL CUAL. Es una corrección del marco del modelo
//     en ejes globales (rotación/traslación), por tanto válida para todas las
//     variantes dimensionales del mismo maestro.
//   - `geometry.normal / uDir / vDir`: se heredan TAL CUAL. Son vectores
//     unitarios configurados en ejes globales — reemplazarlos por los ejes
//     por defecto borraría la corrección hecha por el usuario.
//   - `geometry.centerMm`: NO se hereda automáticamente. Es un punto absoluto
//     en el marco del maestro base; la variante tiene dimensiones distintas y
//     su centro por defecto ya cae sobre su propia arista. Heredar el centro
//     del maestro colocaría la boca fuera del cuerpo de la variante.
//   - `geometry.installRotationDeg`: se hereda.
//
// Para que la herencia funcione sin pasar snapshots por todos los puntos de
// uso, `setProductCatalogIndex` siembra un índice `productId → metadatos del
// catálogo` que se consulta en runtime. El store de workspace lo llama al
// cargar el contexto.

type ProductIndexEntry = {
  readonly producto_id: string;
  readonly familia_id?: string | null;
  readonly tipo_pieza?: string | null;
  readonly ala_nominal_mm?: number | null;
  readonly ancho_nominal_mm?: number | null;
  readonly angulo_grados?: number | null;
  /**
   * Longitud comercial declarada en el catálogo. Participa en la identidad
   * de variante para que dos SKUs con misma geometría pero largos distintos
   * no compartan calibración (p.ej. un TRES-300-065-18 de 2.4 m no es
   * geométricamente equivalente a uno de 3.0 m).
   */
  readonly longitud_comercial_mm?: number | null;
  readonly sku?: string | null;
};

let _productIndex: Readonly<Record<string, ProductIndexEntry>> = {};

export function setPortMappingOverrides(overrides: Record<string, ProductPortMapping>): void {
  _version++;
  _overrides = { ...overrides };
}

export function clearPortMappingOverrides(): void {
  _version++;
  _overrides = {};
}

/**
 * Siembra el índice `productId → catálogo` que habilita la herencia
 * maestro → variantes. Idempotente: la última llamada gana. El store de
 * workspace lo llama al cargar `context.productos`.
 */
export function setProductCatalogIndex(products: readonly ProductIndexEntry[]): void {
  _version++;
  const idx: Record<string, ProductIndexEntry> = {};
  for (const p of products) {
    if (p?.producto_id) idx[p.producto_id] = p;
  }
  _productIndex = idx;
}

export function clearProductCatalogIndex(): void {
  _version++;
  _productIndex = {};
}

/**
 * Resolver inyectable para `findMasterForProduct`. Se inyecta desde un módulo
 * de wiring (no desde este archivo) para evitar que `catalogPortMapping` (en
 * `workspace/`) importe `configurator/masterModels` directamente — eso cerraría
 * un ciclo cuando `masterModels` evolucione.
 */
type MasterResolver = (product: ProductIndexEntry) => {
  id: string;
  baseParams: { ancho_mm: number; ala_mm: number; angulo_deg?: number };
  /**
   * Bocas del patrón (masterModels): nombre de receta → nombre de catálogo.
   * Es la fuente del mapping derivado que alcanza a todas las variantes del
   * maestro (ancho, ala, acabado, espesor) — ver `resolveCatalogPort`.
   */
  ports?: readonly { recipePortName: string; catalogPortName: string; physicalLabel?: string }[];
} | null;

let _masterResolver: MasterResolver | null = null;

export function setMasterResolver(resolver: MasterResolver | null): void {
  _version++;
  _masterResolver = resolver;
}

/**
 * Dado un productId, devuelve el productId del "producto base" del maestro
 * al que pertenece — es decir, otro productId del mismo maestro cuyo override
 * debe heredar la variante. Retorna null si:
 *   - no hay índice de catálogo sembrado;
 *   - no hay resolver de maestro inyectado;
 *   - el producto no mapea a un maestro;
 *   - ningún otro producto del mismo maestro tiene override declarado.
 *
 * Criterio de desempate: se prefiere el productId cuyas dimensiones nominales
 * (ancho, ala, ángulo) coincidan con `master.baseParams`. Esto garantiza que
 * la herencia venga del modelo base medido, no de otra variante secundaria.
 */
function findMasterBaseProductIdFor(productId: string): string | null {
  if (!_masterResolver) return null;
  const direct = _productIndex[productId];
  if (!direct) return null;
  const master = _masterResolver(direct);
  if (!master) return null;
  let best: { id: string; score: number } | null = null;
  for (const [id, entry] of Object.entries(_productIndex)) {
    if (id === productId) continue;
    if (!_overrides[id]) continue; // Sólo heredamos de productos con override.
    const candMaster = _masterResolver(entry);
    if (candMaster?.id !== master.id) continue;
    let score = 0;
    if (entry.ancho_nominal_mm === master.baseParams.ancho_mm) score += 4;
    if (entry.ala_nominal_mm === master.baseParams.ala_mm) score += 2;
    if (
      master.baseParams.angulo_deg === undefined ||
      entry.angulo_grados === master.baseParams.angulo_deg
    ) {
      score += 1;
    }
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
}

/**
 * Busca un sibling con override que comparta IDENTIDAD DE VARIANTE: mismo
 * maestro + mismas dimensiones nominales (ancho, ala, ángulo, longitud).
 *
 * Esta herencia es más fuerte que la de `findMasterBaseProductIdFor`: dos
 * productos con misma identidad de variante son geométricamente equivalentes
 * (solo difieren en acabado, espesor y datos comerciales), así que pueden
 * compartir la calibración completa — incluyendo `centerMm` absoluto, que
 * NO sobrevive al pasar del maestro a una variante de otras dimensiones.
 *
 * Heurística determinista: si hay varios candidatos empatados, se usa el
 * `producto_id` menor alfabéticamente para que el resultado sea estable
 * entre sesiones.
 */
function findSameVariantProductIdFor(productId: string): string | null {
  if (!_masterResolver) return null;
  const direct = _productIndex[productId];
  if (!direct) return null;
  const master = _masterResolver(direct);
  if (!master) return null;
  const sortedIds = Object.keys(_productIndex).sort();
  for (const id of sortedIds) {
    if (id === productId) continue;
    if (!_overrides[id]) continue;
    const entry = _productIndex[id];
    const candMaster = _masterResolver(entry);
    if (candMaster?.id !== master.id) continue;
    // Variante exacta: todas las dimensiones nominales que estén declaradas
    // deben coincidir. Si una está ausente en uno de los dos lados, no se
    // considera match seguro.
    if (entry.ancho_nominal_mm !== direct.ancho_nominal_mm) continue;
    if (entry.ala_nominal_mm !== direct.ala_nominal_mm) continue;
    if ((entry.angulo_grados ?? null) !== (direct.angulo_grados ?? null)) continue;
    if (
      (entry.longitud_comercial_mm ?? null) !==
      (direct.longitud_comercial_mm ?? null)
    ) {
      continue;
    }
    return id;
  }
  return null;
}

export function getEffectiveMapping(productId: string): ProductPortMapping | null {
  const ov = _overrides[productId];
  if (ov) return ov;
  // Herencia por variante: si otro SKU con misma geometría tiene override,
  // lo adoptamos como si fuera propio del producto consultado. Es lo que
  // permite que al configurar Z, el G/distinto espesor hereden la calibración
  // sin duplicarla.
  const siblingId = findSameVariantProductIdFor(productId);
  if (siblingId) {
    const sibling = _overrides[siblingId];
    if (sibling) {
      return {
        productId,
        entries: sibling.entries,
        source: 'inherited',
        inheritedFromProductId: siblingId,
        modelFrame: sibling.modelFrame,
      };
    }
  }
  const def = DEFAULT_MAPPINGS[productId];
  if (!def) return null;
  return { productId, entries: def, source: 'default' };
}

/**
 * Devuelve TODAS las entradas del mapping efectivo (default + overrides)
 * para exposición en el configurador. Pensado para listados.
 */
export function listEffectiveMappings(): readonly ProductPortMapping[] {
  const ids = new Set<string>([...Object.keys(DEFAULT_MAPPINGS), ...Object.keys(_overrides)]);
  const result: ProductPortMapping[] = [];
  for (const id of ids) {
    const m = getEffectiveMapping(id);
    if (m) result.push(m);
  }
  return result;
}

// ─── Puertos publicados por el catálogo ─────────────────────────────────────
//
// Índice `producto_id → nombres de puerto` (PUERTOS_PRODUCTO). Permite verificar
// que una identidad P1/P2… corresponde a un puerto que el catálogo publica, y que
// un mapping derivado del maestro produce un puerto_id existente.

let _catalogPorts: Readonly<Record<string, ReadonlySet<string>>> | null = null;

export function setCatalogPortIndex(
  puertos: readonly { producto_id: string; puerto_id: string }[],
): void {
  _version++;
  // El código del puerto (P1, P2…) es el sufijo de `puerto_id` tras
  // `${producto_id}-`; `nombre_puerto` es sólo descriptivo ("extremo A", "boca 1").
  const idx: Record<string, Set<string>> = {};
  for (const p of puertos) {
    if (!p?.producto_id || !p.puerto_id?.startsWith(`${p.producto_id}-`)) continue;
    (idx[p.producto_id] ??= new Set()).add(p.puerto_id.slice(p.producto_id.length + 1));
  }
  _catalogPorts = idx;
}

export function clearCatalogPortIndex(): void {
  _version++;
  _catalogPorts = null;
}

/**
 * Entradas boca-receta → puerto-catálogo derivadas del patrón (maestro) del
 * producto, en forma de PortMappingEntry. Vacío si no hay maestro resoluble.
 */
export function getMasterPortEntries(productId: string): PortMappingEntry[] {
  return (masterPortsFor(productId) ?? []).map((e) => ({
    recipePortName: e.recipePortName,
    catalogPortName: e.catalogPortName,
    physicalLabel: e.physicalLabel ?? '',
    justification: 'Derivado del patrón (maestro) del producto.',
  }));
}

/** Bocas del maestro del producto (vía resolvedor inyectado), o null. */
function masterPortsFor(productId: string) {
  if (!_masterResolver) return null;
  const entry = _productIndex[productId];
  if (!entry) return null;
  return _masterResolver(entry)?.ports ?? null;
}

/**
 * Resultado de traducir una boca de receta al puerto del catálogo SAMET.
 *  - `mapped`: hay correspondencia declarada (override / herencia / default por
 *    SKU / maestro del patrón).
 *  - `identity`: el nombre ya es un nombre de catálogo (`P<n>`) y, si el índice
 *    de puertos está sembrado, el catálogo publica ese puerto para el producto.
 *    Es una identidad explícita y verificada, no un fallback.
 *  - `uncalibrated`: no hay correspondencia. Se informa como "sin calibración de
 *    bocas"; NUNCA se devuelve el nombre sin traducir.
 */
export type PortResolution =
  | { status: 'mapped'; catalogPortName: string; source: 'override' | 'inherited' | 'default' | 'master' }
  | { status: 'identity'; catalogPortName: string }
  | { status: 'uncalibrated'; reason: string };

const CATALOG_PORT_NAME = /^P\d+$/;

/** Si el índice de puertos está sembrado, exige que el catálogo publique el puerto. */
function verifyPublished(productId: string, recipePortName: string, res: PortResolution): PortResolution {
  if (res.status === 'uncalibrated' || _catalogPorts === null) return res;
  if (_catalogPorts[productId]?.has(res.catalogPortName)) return res;
  const published = [..._catalogPorts[productId] ?? []].join(', ') || 'ninguna';
  return {
    status: 'uncalibrated',
    reason: `sin calibración de bocas para ${productId}: la boca ${recipePortName} se traduce a ${res.catalogPortName}, que el catálogo no publica (publica: ${published})`,
  };
}

export function resolveCatalogPort(productId: string, recipePortName: string): PortResolution {
  // 1) Mapping explícito (override del usuario, herencia por variante, default por SKU).
  const mapping = getEffectiveMapping(productId);
  const hit = mapping?.entries.find((e) => e.recipePortName === recipePortName);
  if (mapping && hit) {
    return verifyPublished(productId, recipePortName, {
      status: 'mapped', catalogPortName: hit.catalogPortName, source: mapping.source as 'override' | 'inherited' | 'default',
    });
  }
  // 2) Mapping derivado del patrón: el maestro declara catalogPortName por boca y
  //    vale para todas sus variantes de ancho, ala, acabado y espesor.
  const masterHit = masterPortsFor(productId)?.find((e) => e.recipePortName === recipePortName);
  if (masterHit) {
    return verifyPublished(productId, recipePortName, { status: 'mapped', catalogPortName: masterHit.catalogPortName, source: 'master' });
  }
  // 3) Identidad explícita: el nombre ya es de catálogo (P1, P2…). Si el índice de
  //    puertos está sembrado, se exige que el catálogo publique ese puerto.
  if (CATALOG_PORT_NAME.test(recipePortName)) {
    if (_catalogPorts === null) return { status: 'identity', catalogPortName: recipePortName };
    if (_catalogPorts[productId]?.has(recipePortName)) {
      return { status: 'identity', catalogPortName: recipePortName };
    }
    return {
      status: 'uncalibrated',
      reason: `el catálogo no publica la boca ${recipePortName} para ${productId}`,
    };
  }
  // 4) Sin correspondencia: modelo no resuelto.
  return { status: 'uncalibrated', reason: `sin calibración de bocas para ${productId} (boca ${recipePortName})` };
}

/**
 * Traduce un nombre de boca (como aparece en `piece.puertos`) al nombre del
 * puerto en el catálogo SAMET, o `null` si la boca no está calibrada (ver
 * `resolveCatalogPort`). No hay identidad silenciosa: el llamador decide cómo
 * informar el `null`.
 *
 * Side-effect free: no toca el store ni emite telemetría.
 */
export function recipePortToCatalogPort(
  productId: string,
  recipePortName: string,
): string | null {
  const r = resolveCatalogPort(productId, recipePortName);
  return r.status === 'uncalibrated' ? null : r.catalogPortName;
}

/**
 * Inverso: dado un nombre de catálogo, devuelve el nombre de boca de la
 * receta. Útil para desde-catálogo-al-UI. Si no hay mapping o el nombre no
 * aparece, devuelve el original (identidad).
 */
export function catalogPortToRecipePort(
  productId: string,
  catalogPortName: string,
): string {
  const mapping = getEffectiveMapping(productId);
  const hit = mapping?.entries.find((e) => e.catalogPortName === catalogPortName);
  if (hit) return hit.recipePortName;
  // Patrón del maestro (misma fuente que resolveCatalogPort).
  const masterHit = masterPortsFor(productId)?.find((e) => e.catalogPortName === catalogPortName);
  if (masterHit) return masterHit.recipePortName;
  return catalogPortName;
}

/**
 * Lista el default declarado (sin overrides) para un producto. Útil para
 * mostrar "valor del fabricante" vs "override de proyecto" en el inspector.
 */
export function getDefaultMapping(productId: string): readonly PortMappingEntry[] | null {
  return DEFAULT_MAPPINGS[productId] ?? null;
}

/**
 * Lista productos cuyo mapping actual proviene de override (no default).
 */
export function listOverriddenProductIds(): readonly string[] {
  return Object.keys(_overrides);
}

/**
 * Devuelve la transformación de modelo para un producto (si está declarada).
 * Side-effect free; la aplicación concreta la hace el consumidor (viewer o motor).
 *
 * Herencia: si el producto no tiene override directo, se consulta el
 * "producto base" del mismo maestro. El modelFrame es una rotación/traslación
 * en ejes globales, válida para todas las variantes dimensionales del maestro.
 */
export function getModelFrameOverride(productId: string): ModelFrameOverride | null {
  const direct = _overrides[productId]?.modelFrame;
  if (direct && !isIdentityModelFrame(direct)) return direct;
  // Herencia por variante exacta tiene prioridad sobre la herencia por maestro:
  // dos SKUs geométricamente equivalentes comparten el marco completo.
  const siblingId = findSameVariantProductIdFor(productId);
  if (siblingId) {
    const inherited = _overrides[siblingId]?.modelFrame;
    if (inherited && !isIdentityModelFrame(inherited)) return inherited;
  }
  const baseId = findMasterBaseProductIdFor(productId);
  if (!baseId) return null;
  const inherited = _overrides[baseId]?.modelFrame;
  if (!inherited || isIdentityModelFrame(inherited)) return null;
  return inherited;
}

/**
 * Devuelve el override geométrico para una boca específica (recipe port
 * name). Si no hay override o es identidad, devuelve null. El consumidor
 * aplica la mezcla con los datos de la receta.
 *
 * Herencia: si el producto no tiene override directo para la boca, se
 * consulta el override del "producto base" del mismo maestro. Para evitar
 * centros absolutos incorrectos en variantes dimensionales, se heredan
 * sólo `normal / uDir / vDir / installRotationDeg` — el `centerMm` se omite.
 */
export function getPortGeometryOverride(
  productId: string,
  recipePortName: string,
): PortGeometryOverride | null {
  // Lectura directa sobre el override del productId, SIN pasar por
  // getEffectiveMapping — ese último devuelve entradas heredadas de un
  // sibling y nos haría reportar "direct" a lo que en realidad es herencia.
  const directHit = _overrides[productId]?.entries.find((e) => e.recipePortName === recipePortName);
  const direct = directHit?.geometry;
  if (direct && !isIdentityPortGeometry(direct)) return direct;
  // Herencia por variante exacta: mismas dimensiones → `centerMm` sigue
  // siendo válido (el punto absoluto cae en la misma arista física).
  const siblingId = findSameVariantProductIdFor(productId);
  if (siblingId) {
    const sibHit = _overrides[siblingId]?.entries.find((e) => e.recipePortName === recipePortName);
    const sib = sibHit?.geometry;
    if (sib && !isIdentityPortGeometry(sib)) return sib;
  }
  // Fallback por herencia del maestro: hereda sólo direcciones/giros, NO el
  // centro (el centro absoluto del maestro no vale para variantes de otras
  // dimensiones; la receta de la variante ya coloca el centro correcto).
  const baseId = findMasterBaseProductIdFor(productId);
  if (!baseId) return null;
  const inheritedMapping = _overrides[baseId];
  const inheritedHit = inheritedMapping?.entries.find((e) => e.recipePortName === recipePortName);
  const inherited = inheritedHit?.geometry;
  if (!inherited || isIdentityPortGeometry(inherited)) return null;
  const projected: PortGeometryOverride = {};
  if (inherited.normal) (projected as { normal?: readonly [number, number, number] }).normal = inherited.normal;
  if (inherited.uDir) (projected as { uDir?: readonly [number, number, number] }).uDir = inherited.uDir;
  if (inherited.vDir) (projected as { vDir?: readonly [number, number, number] }).vDir = inherited.vDir;
  if ((inherited.installRotationDeg ?? 0) !== 0) {
    (projected as { installRotationDeg?: number }).installRotationDeg = inherited.installRotationDeg;
  }
  if (isIdentityPortGeometry(projected)) return null;
  return projected;
}
