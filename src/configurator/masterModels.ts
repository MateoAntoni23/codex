/**
 * masterModels — ENTIDAD "modelo maestro": separa geometría del SKU comercial.
 *
 * Un `MasterModel` representa UNA geometría paramétrica ya resuelta en este
 * repo (STEP aportado + receta medida + polígono base + regla de variación).
 * Un SKU comercial del catálogo (SAM_TRPS-300-22-Z, SAM_TRES-300-065-18-Z…)
 * se liga a un maestro por la combinación `familia_id` + `piece_kind` del
 * snapshot. Dos SKUs pueden compartir maestro geométrico (perforada Z y ZN
 * son la misma geometría con acabado distinto) sin fusionar su ficha técnica.
 *
 * Alcance: trabajamos exclusivamente con los STEP que YA están en el repo.
 * No se intenta cubrir "los 885 sin receta" — este módulo documenta qué está
 * disponible y con qué regla de variación.
 *
 * Fuentes:
 *   - Perforada SAM-STP-Z (6 maestros, ancho 300 base, variante 450 declarada):
 *     definidos en `src/parametric/catalog.ts` (PARAMETRIC_CATALOG) + polígonos
 *     en `src/parametric/geometry/outlines.ts`.
 *   - Escalera SAM-STE-Z (6 maestros, ancho 300 × ala 65 fijos):
 *     polígonos en `src/parametric/geometry/escaleraOutlines.ts`.
 *
 * Revisión:
 *   Cada maestro lleva un `revision` monotónico. Si cambia la geometría base
 *   o la regla de variación, incrementamos la revisión → los proyectos ya
 *   grabados con revisión anterior conservan sus valores (via el snapshot
 *   del proyecto) y ofrecemos actualización cuando el usuario reabre.
 *
 * NO persiste overrides aquí — eso vive en catalogConfigStore. Este módulo es
 * datos estáticos (frozen) de los maestros disponibles.
 */

export type MasterSistema = 'perforada' | 'escalera';

export type MasterPieceKind =
  | 'tramo_recto'
  | 'curva_horizontal'
  | 'curva_vertical'
  | 'tee_simetrica'        // TPS: T con tronco cortado (simétrica en X).
  | 'derivacion_lateral'   // DCPS: derivación sin corte del tronco (geometría distinta).
  | 'cruz'
  | 'reduccion_lateral';

export type VariationRuleKind =
  | 'ancho-only-z'      // TRPS: ancho_mm escala sólo Z; longitud/ala fijos.
  | 'uniform-xz'        // CPS/TPS/XPS/escalera: escala uniforme en X,Z por ancho/300.
  | 'depth-only'        // CUPS: perfil XY fijo, sólo profundidad Z escala por ancho.
  | 'ala-independent'   // Escalera: ancho escala X,Z; ala escala Y independiente.
  | 'none';             // Sin regla codificada; solo ancho base.

/**
 * Procedencia de la regla de generación de variantes:
 *   - 'measured':  validada por ≥2 STEP medidos a distintos parámetros
 *                  (exige un segundo STEP real — no cubierto por ninguno de
 *                  nuestros maestros al día de hoy).
 *   - 'derived':   construida geométricamente desde el STEP base sin
 *                  ambigüedad (polígono rectangular paramétrico, perfil fijo
 *                  con extrusión en una dimensión). No valida la regla contra
 *                  una segunda medición pero es constructivamente correcta.
 *   - 'estimated': hipótesis visual (p.ej. escala uniforme por ancho/300 en
 *                  curvas mitradas). No validada ni derivable sin suposiciones.
 *
 * Nota: la dimensión nominal de la variante (ancho_mm, ala_mm) la publica el
 * catálogo SAMET independientemente de la procedencia de la regla. "Variante
 * medida" sólo corresponde a `provenance === 'measured'`; si sólo se midió el
 * modelo base, la variante proyectada es `derived` o `estimated`.
 */
export type RuleProvenance = 'measured' | 'derived' | 'estimated';

export interface MasterVariationRule {
  readonly kind: VariationRuleKind;
  /** Procedencia de la regla — ver `RuleProvenance`. */
  readonly provenance: RuleProvenance;
  /** Dimensiones que varían. Sirve para generar variantes legibles. */
  readonly varies: readonly ('ancho' | 'ala' | 'longitud' | 'angulo')[];
  /** Explicación corta para UI. */
  readonly rationale: string;
}

export interface MasterBaseParams {
  readonly ancho_mm: number;
  readonly ala_mm: number;
  readonly longitud_mm?: number;
  readonly angulo_deg?: number;
}

export interface MasterSource {
  readonly stepFile: string;
  /** Primeros 8 chars del SHA-256 (medido por tools/step_parametric). */
  readonly stepHashShort: string;
  readonly reportJsonPath: string;
  readonly glbUrl?: string;
}

/**
 * Estado de cierre del patrón — resultado efectivo de la regresión compartida
 * (no un juicio por visor). Fuente única para mostrar en el Configurador qué
 * patrones están listos para revisión visual y cuáles tienen limitaciones
 * conocidas.
 *
 *   - 'validated'        Flush con rectos de referencia verificado en todas las
 *                        bocas documentadas del patrón; no se conocen
 *                        limitaciones operativas pendientes.
 *   - 'validated-scoped' Flush verificado pero sólo para un subconjunto de
 *                        escenarios (ver `limitations`). Ej.: CUPS cerrada sólo
 *                        en recorrido horizontal → vertical.
 *   - 'estimated'        Regla de variación es hipótesis visual; la junta flush
 *                        al ancho base pasa, pero no hay segundo STEP que valide
 *                        la escala.
 *   - 'pending'          Sin STEP medido o sin regresión — el patrón no debe
 *                        exponerse como operativo.
 */
export type ClosureStatus = 'validated' | 'validated-scoped' | 'estimated' | 'pending';

export interface MasterClosure {
  readonly status: ClosureStatus;
  /** Path(s) a specs que respaldan el estado; vacío para 'pending'. */
  readonly regressionSpecs: readonly string[];
  /** Limitaciones concretas que acotan el cierre; vacío cuando no las hay. */
  readonly limitations: readonly string[];
}

export interface MasterModel {
  readonly id: string;
  readonly label: string;
  readonly sistema: MasterSistema;
  readonly pieceKind: MasterPieceKind;
  readonly source: MasterSource;
  /** Clave de receta en el dispatcher paramétrico. */
  readonly recipeKey: string;
  readonly baseParams: MasterBaseParams;
  /** Rotación canónica aplicada al polígono/malla (p.ej. CUPS +45° en Z). */
  readonly canonicalRotationZDeg: number;
  /**
   * SKUs del snapshot asociables a este maestro por (familia_id, piece_kind,
   * ala_mm). Se derivan en runtime vs el snapshot — aquí sólo listamos los
   * `familia_id` y `catalog_piece_kind` esperados.
   */
  readonly catalogMatch: {
    readonly familiaIds: readonly string[];
    /** Valor de `tipo_pieza` en el snapshot SAMET. */
    readonly catalogTipoPieza: string;
    /** `ala_nominal_mm` del snapshot que vincula con este maestro. */
    readonly catalogAlaMm: number;
    /**
     * Prefijos de SKU admitidos — discrimina entre maestros con el mismo
     * (familia, tipo_pieza, ala) pero geometría distinta (TPS vs DCPS).
     * Ejemplo: ['TPS-'] para la tee simétrica, ['DCPS-'] para la derivación
     * lateral. Omitir para "cualquier SKU que cumpla familia/tipo/ala".
     */
    readonly catalogSkuPrefixes?: readonly string[];
  };
  readonly ports: readonly {
    readonly recipePortName: string;
    readonly physicalLabel: string;
    /** Nombre en el catálogo SAMET (P1/P2/...). */
    readonly catalogPortName: string;
  }[];
  readonly variationRule: MasterVariationRule;
  /** Variantes YA declaradas con polígono medido (no estimadas). */
  readonly declaredVariantSkus: readonly string[];
  /**
   * Estado efectivo del patrón según la regresión compartida. Fuente única para
   * la revisión visual del Configurador — no se recomputa por visor.
   */
  readonly closure: MasterClosure;
  readonly revision: number;
}

const PATTERN_FLUSH_SPEC = 'src/workspace/__tests__/patternChainContinuity.test.ts';
const CUPS_PORT_FRAME_SPEC = 'src/parametric/geometry/__tests__/cupsPortFrameRepro.test.ts';
const CUPS_CHAIN_SPEC = 'src/workspace/__tests__/cupsChainWorldContinuity.test.ts';

// ─── Maestros perforada SAM-STP-Z ────────────────────────────────────────────
//
// Los 6 maestros de familia SAM-STP-Z (ala 50 mm por catálogo). Cada uno tiene
// STEP aportado, polígono medido en outlines.ts y receta en recipes.ts.

const PERFORADA_FAMILIAS: readonly string[] = ['SAM-STP-Z', 'SAM-STP-ZN'];

const MASTER_PERFORADA: readonly MasterModel[] = [
  {
    id: 'master:perforada:tramo_recto',
    label: 'Perforada — tramo recto (TRPS)',
    sistema: 'perforada',
    pieceKind: 'tramo_recto',
    source: {
      stepFile: 'TRPS-300-22-Z.STEP',
      stepHashShort: 'd2288065',
      reportJsonPath: 'tools/step_parametric/report/TRPS-300-22-Z.json',
      glbUrl: '/parametric/originals_glb/TRPS-300-22-Z.glb',
    },
    recipeKey: 'tramo_recto',
    baseParams: { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'recta',
      catalogAlaMm: 50,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca x_min', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca x_max', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'ancho-only-z',
      provenance: 'derived',
      varies: ['ancho', 'longitud'],
      rationale: 'TRPS escala sólo la dimensión Z (ancho) y acepta longitud comercial del catálogo. Ala fija 50 mm. Regla derivada por construcción del polígono rectangular — no se ha medido un segundo STEP de ancho≠300 para validarla como \'measured\'.',
    },
    declaredVariantSkus: ['TRPS-450-20-Z'],
    closure: {
      status: 'validated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [],
    },
    revision: 1,
  },
  {
    id: 'master:perforada:curva_horizontal_45',
    label: 'Perforada — curva horizontal 45° (CPS-45)',
    sistema: 'perforada',
    pieceKind: 'curva_horizontal',
    source: {
      stepFile: 'CPS-300-45-Z.STEP',
      stepHashShort: '8d0395e9',
      reportJsonPath: 'tools/step_parametric/report/CPS-300-45-Z.json',
      glbUrl: '/parametric/originals_glb/CPS-300-45-Z.glb',
    },
    recipeKey: 'curva_horizontal',
    baseParams: { ancho_mm: 300, ala_mm: 50, angulo_deg: 45 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'curva horizontal',
      catalogAlaMm: 50,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca tangente inicial', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca tangente final', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'uniform-xz',
      provenance: 'estimated',
      varies: ['ancho', 'angulo'],
      rationale: 'SAMET no publica CPS de ancho≠300. Regla asumida: escala uniforme del polígono por ancho/300.',
    },
    declaredVariantSkus: ['CPS-450-45-Z'],
    closure: {
      status: 'estimated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Flush verificado sobre ancho base 300. La regla uniform-xz no fue validada contra un segundo STEP de otro ancho.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:perforada:curva_horizontal_90',
    label: 'Perforada — curva horizontal 90° (CPS-90)',
    sistema: 'perforada',
    pieceKind: 'curva_horizontal',
    source: {
      stepFile: 'CPS-300-90-Z.STEP',
      stepHashShort: '8677caca',
      reportJsonPath: 'tools/step_parametric/report/CPS-300-90-Z.json',
      glbUrl: '/parametric/originals_glb/CPS-300-90-Z.glb',
    },
    recipeKey: 'curva_horizontal',
    baseParams: { ancho_mm: 300, ala_mm: 50, angulo_deg: 90 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'curva horizontal',
      catalogAlaMm: 50,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca tangente inicial', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca tangente final', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'uniform-xz',
      provenance: 'estimated',
      varies: ['ancho'],
      rationale: 'SAMET no publica CPS 90° de ancho≠300. Regla asumida: escala uniforme del polígono por ancho/300.',
    },
    declaredVariantSkus: ['CPS-450-90-Z'],
    closure: {
      status: 'estimated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Flush verificado sobre ancho base 300. La regla uniform-xz no fue validada contra un segundo STEP de otro ancho.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:perforada:curva_vertical_interior',
    label: 'Perforada — curva vertical interior (CUPS)',
    sistema: 'perforada',
    pieceKind: 'curva_vertical',
    source: {
      stepFile: 'CUPS-300-A-Z.STEP',
      stepHashShort: '28cf5602',
      reportJsonPath: 'tools/step_parametric/report/CUPS-300-A-Z.json',
      glbUrl: '/parametric/originals_glb/CUPS-300-A-Z.glb',
    },
    recipeKey: 'curva_vertical',
    baseParams: { ancho_mm: 300, ala_mm: 50 },
    canonicalRotationZDeg: 45,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'curva vertical interior',
      catalogAlaMm: 50,
    },
    ports: [
      { recipePortName: 'P1_horizontal', physicalLabel: 'Boca horizontal (bandeja)', catalogPortName: 'P1' },
      { recipePortName: 'P2_vertical', physicalLabel: 'Boca vertical (tramo ascendente)', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'depth-only',
      provenance: 'derived',
      varies: ['ancho'],
      rationale: 'Perfil XY fijo (giro canónico +45° sobre polígono cuadrado), sólo profundidad Z escala por ancho. Derivada del STEP base — no hay segundo STEP de ancho≠300 para validarla como \'measured\'.',
    },
    declaredVariantSkus: ['CUPS-450-A-Z'],
    closure: {
      status: 'validated-scoped',
      regressionSpecs: [CUPS_PORT_FRAME_SPEC, CUPS_CHAIN_SPEC],
      limitations: [
        'Cerrado sólo en recorrido horizontal → CUPS (entrando por P1_horizontal) → vertical (saliendo por P2_vertical). El recorrido inverso no está regresionado.',
        'Encadenamiento de dos curvas verticales consecutivas no está regresionado.',
        'CUPS-B descendente pendiente — sin STEP publicado por SAMET.',
        'Pendiente D7: sectionUp del tramo vertical se deriva por heurística (routingRules.computePortSectionUp). La ruta canónica (leer v_dir mundial del puerto fuente) ya está regresionada y daría el mismo resultado; la migración elimina la heurística.',
        'Overrides del configurador con installRotationDeg sobre P1_horizontal o P2_vertical podrían invalidar la heurística D7; úsense con cuidado hasta migrar la fuente de sectionUp.',
      ],
    },
    revision: 1,
  },
  {
    // TPS = tee simétrica (T diseñada con tronco cortado). STEP medido; el
    // archivo físico en disco se nombra DCPS-300-Z.STEP por legado del
    // proveedor, pero el polígono corresponde a TPS (confirmado por el
    // usuario en 2026-11). Los GLB mantienen el nombre DCPS-* para no romper
    // el tooling de step_parametric.
    id: 'master:perforada:tee_simetrica',
    label: 'Perforada — tee simétrica (TPS)',
    sistema: 'perforada',
    pieceKind: 'tee_simetrica',
    source: {
      stepFile: 'DCPS-300-Z.STEP',
      stepHashShort: 'c567bd3a',
      reportJsonPath: 'tools/step_parametric/report/DCPS-300-Z.json',
      glbUrl: '/parametric/originals_glb/DCPS-300-Z.glb',
    },
    recipeKey: 'tee_simetrica',
    baseParams: { ancho_mm: 300, ala_mm: 50 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'T',
      catalogAlaMm: 50,
      catalogSkuPrefixes: ['TPS-'],
    },
    ports: [
      { recipePortName: 'tronco_P1', physicalLabel: 'Tronco (entrada)', catalogPortName: 'P1' },
      { recipePortName: 'tronco_P2', physicalLabel: 'Tronco (salida)', catalogPortName: 'P2' },
      { recipePortName: 'boca_derivacion', physicalLabel: 'Boca de derivación', catalogPortName: 'P3' },
    ],
    variationRule: {
      kind: 'uniform-xz',
      provenance: 'estimated',
      varies: ['ancho'],
      rationale: 'SAMET no publica TPS de ancho≠300. Hipótesis visual: escala uniforme por ancho/300; no validada como regla constructiva.',
    },
    declaredVariantSkus: ['TPS-450-Z'],
    closure: {
      status: 'estimated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Flush de las 3 bocas verificado sobre ancho base 300. La regla uniform-xz no está validada con un segundo STEP.',
        'Archivo STEP compartido con DCPS (nombre legacy del proveedor); discriminación por catalogSkuPrefixes.',
      ],
    },
    revision: 2,
  },
  {
    // DCPS = derivación lateral (sin corte del tronco principal). GEOMETRÍA
    // DISTINTA a TPS: el tronco se mantiene entero y la derivación sale por
    // uno de los flancos. No tenemos STEP ni polígono medido — pendiente. Se
    // modela para que el Configurador no asocie DCPS al STEP de TPS por
    // confusión histórica.
    id: 'master:perforada:derivacion_pendiente',
    label: 'Perforada — derivación lateral DCPS (pendiente)',
    sistema: 'perforada',
    pieceKind: 'derivacion_lateral',
    source: {
      stepFile: '(pendiente — SAMET no publicó STEP para DCPS)',
      stepHashShort: '--------',
      reportJsonPath: '(pendiente)',
    },
    recipeKey: 'derivacion_lateral',
    baseParams: { ancho_mm: 300, ala_mm: 50 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'T',
      catalogAlaMm: 50,
      catalogSkuPrefixes: ['DCPS-'],
    },
    ports: [
      { recipePortName: 'tronco_P1', physicalLabel: 'Tronco (entrada)', catalogPortName: 'P1' },
      { recipePortName: 'tronco_P2', physicalLabel: 'Tronco (salida)', catalogPortName: 'P2' },
      { recipePortName: 'boca_derivacion', physicalLabel: 'Boca de derivación lateral', catalogPortName: 'P3' },
    ],
    variationRule: {
      kind: 'none',
      provenance: 'estimated',
      varies: [],
      rationale: 'DCPS geometría distinta de TPS (sin corte del tronco). Sin STEP medido — la asociación de los SKUs SAM_DCPS-*-Z queda explícita como PENDIENTE. No se genera variante hasta disponer del polígono.',
    },
    declaredVariantSkus: [],
    closure: {
      status: 'pending',
      regressionSpecs: [],
      limitations: [
        'Sin STEP medido para DCPS. No debe exponerse como operativo hasta que SAMET publique el polígono.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:perforada:cruz',
    label: 'Perforada — cruz plana (XPS)',
    sistema: 'perforada',
    pieceKind: 'cruz',
    source: {
      stepFile: 'XPS-300-Z.STEP',
      stepHashShort: '4ab08eda',
      reportJsonPath: 'tools/step_parametric/report/XPS-300-Z.json',
      glbUrl: '/parametric/originals_glb/XPS-300-Z.glb',
    },
    recipeKey: 'cruz',
    baseParams: { ancho_mm: 300, ala_mm: 50 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: PERFORADA_FAMILIAS,
      catalogTipoPieza: 'X',
      catalogAlaMm: 50,
    },
    ports: [
      { recipePortName: 'P1_x_neg', physicalLabel: 'Brazo X−', catalogPortName: 'P1' },
      { recipePortName: 'P2_x_pos', physicalLabel: 'Brazo X+', catalogPortName: 'P2' },
      { recipePortName: 'P3_z_neg', physicalLabel: 'Brazo Z−', catalogPortName: 'P3' },
      { recipePortName: 'P4_z_pos', physicalLabel: 'Brazo Z+', catalogPortName: 'P4' },
    ],
    variationRule: {
      kind: 'uniform-xz',
      provenance: 'estimated',
      varies: ['ancho'],
      rationale: 'SAMET no publica XPS de ancho≠300. Regla asumida: escala uniforme por ancho/300.',
    },
    declaredVariantSkus: ['XPS-450-Z'],
    closure: {
      status: 'estimated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Flush de los 4 brazos verificado sobre ancho base 300. La regla uniform-xz no está validada con un segundo STEP.',
      ],
    },
    revision: 1,
  },
];

// ─── Maestros escalera SAM-STE ──────────────────────────────────────────────
//
// Polígonos medidos en escaleraOutlines.ts para ala=65 ancho=300. Sin variantes
// 450/600 explícitas; el snapshot publica alas 65/90/115 y anchos
// 150/300/450/600 pero no hay STEP para esas combinaciones.

const ESCALERA_FAMILIAS: readonly string[] = ['SAM-STE-Z', 'SAM-STE-G'];

const MASTER_ESCALERA: readonly MasterModel[] = [
  {
    id: 'master:escalera:tramo_recto',
    label: 'Escalera — tramo recto (TRES)',
    sistema: 'escalera',
    pieceKind: 'tramo_recto',
    source: {
      stepFile: 'TRES-300-065-18-Z.STEP',
      stepHashShort: '76f3fbb4',
      reportJsonPath: 'tools/step_parametric/report/escalera/TRES-300-065-18-Z.json',
    },
    recipeKey: 'escalera:tramo_recto',
    baseParams: { ancho_mm: 300, ala_mm: 65, longitud_mm: 3000 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ESCALERA_FAMILIAS,
      catalogTipoPieza: 'recta',
      catalogAlaMm: 65,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca x_min', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca x_max', catalogPortName: 'P2' },
    ],
    variationRule: {
      // TRES tiene polígono rectangular — la regla se deriva por construcción:
      // ancho escala Z, ala escala Y independientemente, longitud escala X. No
      // depende de otro STEP para ser válida; una variante 450×65 o 300×90 se
      // genera con factores exactos sobre las aristas medidas.
      kind: 'ala-independent',
      provenance: 'derived',
      varies: ['ancho', 'ala', 'longitud'],
      rationale: 'TRES polígono rectangular medido (ancho=300, ala=65, longitud=3000). La geometría se extiende sin ambigüedad: ancho escala Z, ala escala Y, longitud escala X. Variantes 450/600 × alas 65/90/115 generables con factores exactos — procedencia \'derived\' (no \'measured\') porque no se validó contra un segundo STEP de dimensiones distintas.',
    },
    declaredVariantSkus: ['TRES-450-065-18-Z', 'TRES-300-090-18-Z'],
    closure: {
      status: 'validated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [],
    },
    revision: 2,
  },
  {
    id: 'master:escalera:curva_horizontal_45',
    label: 'Escalera — curva horizontal 45° (CS-45)',
    sistema: 'escalera',
    pieceKind: 'curva_horizontal',
    source: {
      stepFile: 'CS-300-45-065-18-Z.STEP',
      stepHashShort: '2f572cc3',
      reportJsonPath: 'tools/step_parametric/report/escalera/CS-300-45-065-18-Z.json',
    },
    recipeKey: 'escalera:curva_horizontal',
    baseParams: { ancho_mm: 300, ala_mm: 65, angulo_deg: 45 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ESCALERA_FAMILIAS,
      catalogTipoPieza: 'curva horizontal',
      catalogAlaMm: 65,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca tangente inicial', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca tangente final', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'none',
      provenance: 'derived',
      varies: [],
      rationale: 'Polígono medido 8 vértices sobre STEP ancho=300 ala=65. Sin segundo STEP para derivar regla de escala — las variantes se marcan \'derived\' por reproducción geométrica directa.',
    },
    declaredVariantSkus: [],
    closure: {
      status: 'validated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Polígono fijo medido sobre ancho 300 ala 65. Variantes de ancho no publicadas.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:escalera:curva_horizontal_90',
    label: 'Escalera — curva horizontal 90° (CS-90)',
    sistema: 'escalera',
    pieceKind: 'curva_horizontal',
    source: {
      stepFile: 'CS-300-90-065-18-Z.STEP',
      stepHashShort: 'e110db9d',
      reportJsonPath: 'tools/step_parametric/report/escalera/CS-300-90-065-18-Z.json',
    },
    recipeKey: 'escalera:curva_horizontal',
    baseParams: { ancho_mm: 300, ala_mm: 65, angulo_deg: 90 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ESCALERA_FAMILIAS,
      catalogTipoPieza: 'curva horizontal',
      catalogAlaMm: 65,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca tangente inicial', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca tangente final', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'none',
      provenance: 'derived',
      varies: [],
      rationale: 'Polígono medido 8 vértices sobre STEP ancho=300 ala=65. Variantes \'derived\' por reproducción geométrica directa del polígono base.',
    },
    declaredVariantSkus: [],
    closure: {
      status: 'validated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Polígono fijo medido sobre ancho 300 ala 65. Variantes de ancho no publicadas.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:escalera:derivacion_lateral',
    label: 'Escalera — tee (TS)',
    sistema: 'escalera',
    pieceKind: 'derivacion_lateral',
    source: {
      stepFile: 'TS-300-065-18-Z.STEP',
      stepHashShort: '7e10f01e',
      reportJsonPath: 'tools/step_parametric/report/escalera/TS-300-065-18-Z.json',
    },
    recipeKey: 'escalera:derivacion_lateral',
    baseParams: { ancho_mm: 300, ala_mm: 65 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ESCALERA_FAMILIAS,
      catalogTipoPieza: 'T',
      catalogAlaMm: 65,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Tronco (z_min)', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca derivación (x_max)', catalogPortName: 'P2' },
      { recipePortName: 'P3', physicalLabel: 'Tronco (z_max)', catalogPortName: 'P3' },
    ],
    variationRule: {
      kind: 'none',
      provenance: 'derived',
      varies: [],
      rationale: 'Polígono medido 10 vértices sobre STEP ancho=300 ala=65. Variantes \'derived\' por reproducción geométrica directa.',
    },
    declaredVariantSkus: [],
    closure: {
      status: 'validated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Polígono fijo medido sobre ancho 300 ala 65. Flush de las 3 bocas verificado con entrada por P2.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:escalera:cruz',
    label: 'Escalera — cruz (XS)',
    sistema: 'escalera',
    pieceKind: 'cruz',
    source: {
      stepFile: 'XS-300-065-18-Z.STEP',
      stepHashShort: '4731b052',
      reportJsonPath: 'tools/step_parametric/report/escalera/XS-300-065-18-Z.json',
    },
    recipeKey: 'escalera:cruz',
    baseParams: { ancho_mm: 300, ala_mm: 65 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ESCALERA_FAMILIAS,
      catalogTipoPieza: 'X',
      catalogAlaMm: 65,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Brazo z_min', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Brazo x_max', catalogPortName: 'P2' },
      { recipePortName: 'P3', physicalLabel: 'Brazo z_max', catalogPortName: 'P3' },
      { recipePortName: 'P4', physicalLabel: 'Brazo x_min', catalogPortName: 'P4' },
    ],
    variationRule: {
      kind: 'none',
      provenance: 'derived',
      varies: [],
      rationale: 'Polígono medido 16 vértices sobre STEP ancho=300 ala=65. Variantes \'derived\' por reproducción geométrica directa.',
    },
    declaredVariantSkus: [],
    closure: {
      status: 'validated',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Polígono fijo medido sobre ancho 300 ala 65. Flush de los 4 brazos verificado con entrada por P4.',
      ],
    },
    revision: 1,
  },
  {
    id: 'master:escalera:reduccion_lateral',
    label: 'Escalera — reducción lateral 300→150 (RIS)',
    sistema: 'escalera',
    pieceKind: 'reduccion_lateral',
    source: {
      stepFile: 'RIS-15-065-18-Z.STEP',
      stepHashShort: '93957e14',
      reportJsonPath: 'tools/step_parametric/report/escalera/RIS-15-065-18-Z.json',
    },
    recipeKey: 'escalera:reduccion_lateral',
    baseParams: { ancho_mm: 300, ala_mm: 65 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ESCALERA_FAMILIAS,
      catalogTipoPieza: 'reducción',
      catalogAlaMm: 65,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'Boca 150 mm (z_min)', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'Boca 300 mm (z_max)', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'none',
      provenance: 'derived',
      varies: [],
      rationale: 'Polígono medido 6 vértices; transición ancho 300→150 específica. Otras reducciones (RCS-30-15) tienen STEP sin cara superior plana y quedan pendientes.',
    },
    declaredVariantSkus: [],
    closure: {
      status: 'validated-scoped',
      regressionSpecs: [PATTERN_FLUSH_SPEC],
      limitations: [
        'Marco orto-normal y convención común verificados a nivel receta vía buildRecipeByKey.',
        'No participa en placeRecipe interactivo: masterPieceKindToParametric(reduccion_lateral) devuelve null; el viewer del configurador la consume directo.',
        'Falta publicar TRES-150 para cerrar flush world-level de la boca 150 mm con un recto adyacente.',
        'Otras reducciones (RCS-30-15, AMPS) no tienen STEP publicado.',
      ],
    },
    revision: 1,
  },
];

export const MASTER_MODELS: readonly MasterModel[] = [
  ...MASTER_PERFORADA,
  ...MASTER_ESCALERA,
];

/**
 * Busca el maestro aplicable a un producto del snapshot por
 * (familia_id, tipo_pieza, ala_nominal_mm). Devuelve `null` cuando no hay
 * maestro declarado — el producto queda sin cobertura paramétrica.
 */
export function findMasterForProduct(product: {
  familia_id?: unknown;
  tipo_pieza?: unknown;
  ala_nominal_mm?: unknown;
  angulo_grados?: unknown;
  sku?: unknown;
  producto_id?: unknown;
}): MasterModel | null {
  const familiaId = typeof product.familia_id === 'string' ? product.familia_id : null;
  const tipo = typeof product.tipo_pieza === 'string' ? product.tipo_pieza : null;
  const ala = typeof product.ala_nominal_mm === 'number' ? product.ala_nominal_mm : null;
  if (!familiaId || !tipo || ala === null) return null;

  const sku = typeof product.sku === 'string' ? product.sku : null;
  const productoId = typeof product.producto_id === 'string' ? product.producto_id : null;
  // Para discriminar TPS vs DCPS (mismo tipo_pieza='T') usamos el prefijo del
  // SKU o del producto_id. producto_id puede venir como `SAM_TPS-300-Z`, sku
  // como `TPS-300-Z`.
  const skuPrefix = sku ?? productoId?.replace(/^SAM_/, '') ?? null;

  const candidates = MASTER_MODELS.filter((m) => {
    if (!m.catalogMatch.familiaIds.includes(familiaId)) return false;
    if (m.catalogMatch.catalogTipoPieza !== tipo) return false;
    // Filtro por ala: estricto EXCEPTO cuando la variationRule marca `ala`
    // como eje que varía (p.ej. ala-independent de TRES). En ese caso el
    // maestro cubre por construcción otros alas y la variante debe resolverlo.
    const alaVaries = m.variationRule.varies.includes('ala');
    if (!alaVaries && m.catalogMatch.catalogAlaMm !== ala) return false;
    if (m.catalogMatch.catalogSkuPrefixes && skuPrefix) {
      return m.catalogMatch.catalogSkuPrefixes.some((pref) => skuPrefix.startsWith(pref));
    }
    return true;
  });
  if (candidates.length === 0) return null;
  // Si hay un candidato con prefijo específico que matchea, preferirlo sobre
  // los "agnósticos" (sin catalogSkuPrefixes) — evita que un producto TPS
  // caiga en un maestro sin discriminador cuando existe uno específico.
  const withPrefix = candidates.filter((m) => m.catalogMatch.catalogSkuPrefixes);
  const effective = withPrefix.length > 0 ? withPrefix : candidates;
  if (effective.length === 1) return effective[0];
  // Para curva_horizontal hay dos (45° y 90°): desempatar por angulo_grados.
  const angulo = typeof product.angulo_grados === 'number' ? product.angulo_grados : null;
  if (angulo !== null) {
    const byAngle = effective.find((m) => m.baseParams.angulo_deg === angulo);
    if (byAngle) return byAngle;
  }
  return effective[0];
}

export function findMasterById(id: string): MasterModel | null {
  return MASTER_MODELS.find((m) => m.id === id) ?? null;
}
