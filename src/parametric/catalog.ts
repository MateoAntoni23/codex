/**
 * catalog.ts — Catálogo paramétrico STP-Z 300: originales + reconstrucciones + variantes.
 *
 * Fuente (originales y volúmenes): artifacts/parametric/fidelity.json y los
 * reportes STEP de tools/step_parametric/report/*.json. Los GLB se sirven desde
 * /parametric/*. Procedencia de los STEP: aportados al proyecto por el usuario;
 * no confirmados como originales del fabricante.
 *
 * Fuente (reconstrucciones y variantes): recetas paramétricas JS en
 * ./geometry/outlines.ts, despachadas por ./geometry/recipes.ts. Las bocas y
 * bounding boxes de reconstruction/variant se DERIVAN del polígono medido;
 * así la malla procedural y el panel del inspector no pueden salirse de sync.
 *
 * Divergencia conocida ala 50 vs 65 (familia SAM-STP-Z): el catálogo SAMET
 * publica ala_nominal_mm = 50 mm (observación "cota del dibujo", PDF 4/impr. 7
 * y PDF 5/impr. 9 del snapshot). Los STEP aportados muestran bbox Y = 65 mm.
 * Resolución (criterio A): la GEOMETRÍA OPERATIVA del editor usa la cota del
 * catálogo (50 mm). Los campos `original_bbox_span_mm` se dejan intactos como
 * registro observado del STEP; sólo `params.ala_mm` en recon/variant se alinea
 * con la cota de catálogo. La diferencia queda explícitamente visible en
 * `fidelity.span_delta_pct.y`.
 *
 * Esta vista es experimental y NO sustituye la geometría operativa del editor
 * ni las fórmulas Python del motor. Las dimensiones aquí son datos de prueba.
 */

import {
  buildRecipeFor,
  type PieceKind,
  type RawParams,
} from './geometry/recipes';

export type Vec3 = readonly [number, number, number];

/** Tipo del puerto (ver geometry/outlines.ts para la semántica completa). */
export type ParametricPortKind = 'operational' | 'reference';

export interface ParametricPort {
  readonly name: string;
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly ancho_mm: number;
  readonly ala_mm: number;
  readonly u_dir: Vec3;
  readonly v_dir: Vec3;
  readonly kind: ParametricPortKind;
}

export interface ParametricFidelity {
  readonly span_original_mm: Vec3;
  readonly span_reconstruction_mm: Vec3;
  readonly span_delta_pct: Vec3;
  readonly volume_original_mm3: number;
  readonly volume_reconstruction_mm3: number;
  readonly volume_delta_pct: number;
}

export interface ParametricVariantView {
  readonly label: string;
  readonly sku: string;
  readonly glb_url: string;
  readonly params: RawParams;
  readonly ports: readonly ParametricPort[];
  readonly notes: readonly string[];
  readonly bbox_span_mm: Vec3;
}

export interface ParametricEntry {
  readonly recipe: string;
  readonly piece_kind: PieceKind;
  readonly original_glb_url: string;
  readonly original_bbox_span_mm: Vec3;
  readonly original_volume_mm3: number;
  readonly reconstruction: ParametricVariantView;
  readonly variant: ParametricVariantView;
  readonly fidelity: ParametricFidelity;
  /**
   * Marco canónico compartido por bocas y recorridos (coincide con el frame
   * de generación de la reconstrucción). El STEP original se auto-traslada
   * para que el centro de su bbox coincida con el centro de este rectángulo.
   */
  readonly canonical_bbox_mm: { readonly min: Vec3; readonly max: Vec3 };
  /** Versión del artefacto (SHA corto / etiqueta). Permite detectar cuando
   *  una calibración guardada corresponde a una generación anterior. */
  readonly source_version: string;
  /**
   * Rotación en grados alrededor del eje Z aplicada al STEP ORIGINAL antes
   * de la alineación por bbox. Se usa cuando el frame interno del STEP está
   * rotado respecto al marco de instalación natural (caso CUPS: +45°). Las
   * reconstrucciones/variantes ya se generan en el marco natural.
   */
  readonly original_rotation_z_deg?: number;
}

// -----------------------------------------------------------------------------
// Construcción asistida: port data y bbox derivados del polígono medido.
// -----------------------------------------------------------------------------

function spanOf(min: Vec3, max: Vec3): Vec3 {
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

function makeView(
  label: string,
  sku: string,
  glb_url: string,
  piece_kind: PieceKind,
  params: RawParams,
  notes: readonly string[],
): ParametricVariantView {
  const recipe = buildRecipeFor(piece_kind, params);
  return {
    label,
    sku,
    glb_url,
    params,
    ports: recipe.ports,
    notes,
    bbox_span_mm: spanOf(recipe.bboxMin, recipe.bboxMax),
  };
}

/**
 * Versión de los artefactos de geometría JS. Se incrementa cuando cambian
 * polígonos medidos, reglas de escalado o posicionamiento de bocas. Las
 * calibraciones guardadas con una versión anterior se marcan "revisar".
 */
const SOURCE_VERSION = 'ala50-catalogo-SAM-STP-Z';

const RAW_ENTRIES: readonly {
  recipe: string;
  piece_kind: PieceKind;
  original_glb_url: string;
  original_bbox_span_mm: Vec3;
  original_volume_mm3: number;
  recon: {
    label: string;
    sku: string;
    glb_url: string;
    params: RawParams;
    notes: readonly string[];
  };
  variant: {
    label: string;
    sku: string;
    glb_url: string;
    params: RawParams;
    notes: readonly string[];
  };
  volume_reconstruction_mm3: number;
  original_rotation_z_deg?: number;
}[] = [
  {
    recipe: 'TRPS-300-22-Z.STEP',
    piece_kind: 'tramo_recto',
    original_glb_url: '/parametric/originals_glb/TRPS-300-22-Z.glb',
    original_bbox_span_mm: [3000, 65, 300],
    original_volume_mm3: 58500000,
    recon: {
      label: 'Reconstrucción paramétrica (ancho=300)',
      sku: 'TRPS-300-22-Z',
      glb_url: '/parametric/reconstructions/TRPS-300-22-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000, espesor_mm: 0.71 },
      notes: [
        'Envolvente simplificada del STEP de referencia (sin perfil Z ni perforaciones).',
        'ala_mm proviene del catálogo SAMET (cota del dibujo, 50 mm). El STEP aportado muestra bbox Y = 65 mm; esa divergencia queda documentada en fidelity.span_delta_pct.y.',
      ],
    },
    variant: {
      label: 'Variante ancho=450 (ala, largo y espesor sin cambio)',
      sku: 'TRPS-450-22-Z',
      glb_url: '/parametric/variants/TRPS-450-22-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 50, longitud_mm: 3000, espesor_mm: 0.71 },
      notes: [
        'Regla MEDIDA sobre los STEP de referencia: la sección rectangular escala sólo en Z (ancho); longitud y ala invariantes. ala_mm 50 por catálogo (familia SAM-STP-Z).',
      ],
    },
    volume_reconstruction_mm3: 58500000,
  },
  {
    recipe: 'CPS-300-45-Z.STEP',
    piece_kind: 'curva_horizontal',
    original_glb_url: '/parametric/originals_glb/CPS-300-45-Z.glb',
    original_bbox_span_mm: [345.99, 65, 321.98],
    original_volume_mm3: 4961049.74,
    recon: {
      label: 'Reconstrucción paramétrica (polígono medido, 7 vértices)',
      sku: 'CPS-300-45-Z',
      glb_url: '/parametric/reconstructions/CPS-300-45-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 50, angulo_deg: 45, espesor_mm: 0.71 },
      notes: [
        'Polígono faceteado medido sobre el GLB de referencia (sin revolución; refleja chaflanes 45° reales).',
        'ala_mm 50 por catálogo (familia SAM-STP-Z, "Ala 50 mm de la familia"). El bbox Y del STEP aportado es 65 mm — divergencia visible en fidelity.span_delta_pct.y.',
      ],
    },
    variant: {
      label: 'Variante ancho=450 (escala uniforme desde origen)',
      sku: 'CPS-450-45-Z',
      glb_url: '/parametric/variants/CPS-450-45-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 50, angulo_deg: 45, espesor_mm: 0.71 },
      notes: [
        'Regla ESTIMADA (no medida): escala uniforme del polígono por ancho/300 desde el origen.',
        'SAMET no publica CPS de ancho≠300 ni su regla de escalado; dimensionales sin verificación oficial — revisión técnica obligatoria antes de usar.',
      ],
    },
    volume_reconstruction_mm3: 4961049.74,
  },
  {
    recipe: 'CPS-300-90-Z.STEP',
    piece_kind: 'curva_horizontal',
    original_glb_url: '/parametric/originals_glb/CPS-300-90-Z.glb',
    original_bbox_span_mm: [744.12, 65, 744.03],
    original_volume_mm3: 19402777.71,
    recon: {
      label: 'Reconstrucción paramétrica (polígono medido, 8 vértices)',
      sku: 'CPS-300-90-Z',
      glb_url: '/parametric/reconstructions/CPS-300-90-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 50, angulo_deg: 90, espesor_mm: 0.71 },
      notes: [
        'Polígono faceteado del STEP de referencia con chaflanes interior y exterior a 45°.',
        'ala_mm 50 por catálogo (familia SAM-STP-Z). bbox Y del STEP aportado = 65 mm; divergencia explícita en fidelity.span_delta_pct.y.',
      ],
    },
    variant: {
      label: 'Variante ancho=450 (escala uniforme desde origen)',
      sku: 'CPS-450-90-Z',
      glb_url: '/parametric/variants/CPS-450-90-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 50, angulo_deg: 90, espesor_mm: 0.71 },
      notes: [
        'Regla ESTIMADA (no medida): escala uniforme del polígono por ancho/300 desde el origen.',
        'SAMET no publica CPS 90° de ancho≠300; dimensionales sin verificación oficial — revisión técnica obligatoria.',
      ],
    },
    volume_reconstruction_mm3: 19402777.71,
  },
  {
    recipe: 'CUPS-300-A-Z.STEP',
    piece_kind: 'curva_vertical',
    original_glb_url: '/parametric/originals_glb/CUPS-300-A-Z.glb',
    // Bbox del STEP TRAS la rotación +45° al marco natural (mismo marco
    // en el que se evalúa la reconstrucción). Span sin rotar era 54.63 × 232.97;
    // con el perfil rotado el bbox envolvente es 164.74 × 164.74. Z=300
    // no cambia porque la rotación es sólo en Z.
    original_bbox_span_mm: [164.74, 164.74, 300],
    original_volume_mm3: 2375093.49,
    original_rotation_z_deg: 45,
    recon: {
      label: 'Reconstrucción paramétrica (perfil XY medido, marco natural)',
      sku: 'CUPS-300-A-Z',
      glb_url: '/parametric/reconstructions/CUPS-300-A-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 50, espesor_mm: 0.71, angulo_vertical_deg: 90 },
      notes: [
        'Perfil XY faceteado (8 vértices medidos) rotado +45° al marco de instalación natural; extruido en Z por ancho.',
        'Bocas OPERATIVAS medidas sobre las dos chaflanas exteriores del STEP: cada cara 300 × ~36.56 mm.',
        'Función: P1_horizontal (normal −X) ↔ bandeja horizontal; P2_vertical (normal −Y) ↔ bandeja vertical.',
      ],
    },
    variant: {
      label: 'Variante ancho=450 (sólo escala profundidad Z, perfil XY fijo)',
      sku: 'CUPS-450-A-Z',
      glb_url: '/parametric/variants/CUPS-450-A-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 50, espesor_mm: 0.71, angulo_vertical_deg: 90 },
      notes: [
        'Regla ESTIMADA: SAMET no publica CUPS de ancho≠300; asumimos perfil XY fijo y escalamos sólo profundidad Z.',
        'Altura de conexión (~36.56 mm) distinta del ala de los tramos rectos (50 mm por catálogo SAM-STP-Z): compatibilidad mecánica PENDIENTE de dato SAMET aunque la geometría se visualice correctamente.',
      ],
    },
    volume_reconstruction_mm3: 2375093.49,
  },
  {
    recipe: 'DCPS-300-Z.STEP',
    piece_kind: 'derivacion_lateral',
    original_glb_url: '/parametric/originals_glb/DCPS-300-Z.glb',
    original_bbox_span_mm: [449.5, 65, 375.15],
    original_volume_mm3: 10378217.58,
    recon: {
      label: 'Reconstrucción paramétrica (polígono medido, 10 vértices)',
      sku: 'DCPS-300-Z',
      glb_url: '/parametric/reconstructions/DCPS-300-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 50, espesor_mm: 0.71 },
      notes: [
        'Polígono faceteado del STEP de referencia con chaflanes 45° en esquinas interiores.',
        'Las TRES bocas tienen el ancho completo del fitting (el modelo previo truncaba las del tronco a 75 mm).',
        'ala_mm 50 por catálogo (familia SAM-STP-Z). bbox Y del STEP aportado = 65 mm — divergencia explícita.',
        'IDENTIFICACIÓN EN REVISIÓN: el polígono medido es simétrico en X (v0↔v7, v1↔v6, v2↔v5, v3↔v4); un DCPS es asimétrico, una T simétrica (TPS) sí lo es. Archivo nombrado `DCPS-300-Z.STEP` pero forma compatible con TPS. SKU preservado hasta contrastar con maestro oficial SAMET (no afectar BOM/compatibilidades).',
      ],
    },
    variant: {
      label: 'Variante ancho=450 (escala uniforme desde origen)',
      sku: 'DCPS-450-Z',
      glb_url: '/parametric/variants/DCPS-450-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 50, espesor_mm: 0.71 },
      notes: [
        'Regla ESTIMADA (no medida): escala uniforme del polígono por ancho/300.',
        'SAMET no publica DCPS de ancho≠300; valores sin verificación oficial — revisión técnica obligatoria.',
      ],
    },
    volume_reconstruction_mm3: 10378217.58,
  },
  {
    recipe: 'XPS-300-Z.STEP',
    piece_kind: 'cruz',
    original_glb_url: '/parametric/originals_glb/XPS-300-Z.glb',
    original_bbox_span_mm: [449.4, 65, 449.4],
    original_volume_mm3: 11964879.34,
    recon: {
      label: 'Reconstrucción paramétrica (cruz simétrica, 16 vértices)',
      sku: 'XPS-300-Z',
      glb_url: '/parametric/reconstructions/XPS-300-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 50, espesor_mm: 0.71 },
      notes: [
        'Polígono faceteado del STEP de referencia con los 4 chaflanes 45° reales.',
        'ala_mm 50 por catálogo (familia SAM-STP-Z). bbox Y del STEP aportado = 65 mm — divergencia explícita.',
      ],
    },
    variant: {
      label: 'Variante ancho=450 (escala uniforme desde origen)',
      sku: 'XPS-450-Z',
      glb_url: '/parametric/variants/XPS-450-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 50, espesor_mm: 0.71 },
      notes: [
        'Regla ESTIMADA (no medida): escala uniforme del polígono por ancho/300.',
        'SAMET no publica XPS de ancho≠300; valores sin verificación oficial — revisión técnica obligatoria.',
      ],
    },
    volume_reconstruction_mm3: 11964879.34,
  },
];

function buildEntry(raw: (typeof RAW_ENTRIES)[number]): ParametricEntry {
  const recon = makeView(
    raw.recon.label,
    raw.recon.sku,
    raw.recon.glb_url,
    raw.piece_kind,
    raw.recon.params,
    raw.recon.notes,
  );
  const variant = makeView(
    raw.variant.label,
    raw.variant.sku,
    raw.variant.glb_url,
    raw.piece_kind,
    raw.variant.params,
    raw.variant.notes,
  );
  // Marco canónico = bbox de la reconstrucción (ancho=300), que coincide con
  // el bbox del STEP original tras neutralizar la rotación −90°X.
  const reconRecipe = buildRecipeFor(raw.piece_kind, raw.recon.params);
  const canonical_bbox_mm = {
    min: reconRecipe.bboxMin,
    max: reconRecipe.bboxMax,
  };
  const reconSpan = recon.bbox_span_mm;
  const origSpan = raw.original_bbox_span_mm;
  const span_delta_pct: Vec3 = [
    pctDelta(origSpan[0], reconSpan[0]),
    pctDelta(origSpan[1], reconSpan[1]),
    pctDelta(origSpan[2], reconSpan[2]),
  ];
  const volume_delta_pct = pctDelta(
    raw.original_volume_mm3,
    raw.volume_reconstruction_mm3,
  );
  return {
    recipe: raw.recipe,
    piece_kind: raw.piece_kind,
    original_glb_url: raw.original_glb_url,
    original_bbox_span_mm: raw.original_bbox_span_mm,
    original_volume_mm3: raw.original_volume_mm3,
    reconstruction: recon,
    variant,
    fidelity: {
      span_original_mm: raw.original_bbox_span_mm,
      span_reconstruction_mm: reconSpan,
      span_delta_pct,
      volume_original_mm3: raw.original_volume_mm3,
      volume_reconstruction_mm3: raw.volume_reconstruction_mm3,
      volume_delta_pct,
    },
    canonical_bbox_mm,
    source_version: SOURCE_VERSION,
    original_rotation_z_deg: raw.original_rotation_z_deg,
  };
}

function pctDelta(ref: number, value: number): number {
  if (ref === 0) return 0;
  return ((value - ref) / ref) * 100;
}

export const PARAMETRIC_CATALOG: readonly ParametricEntry[] = RAW_ENTRIES.map(buildEntry);

export type ViewId = 'original' | 'reconstruction' | 'variant';

export function viewLabel(view: ViewId): string {
  switch (view) {
    case 'original':
      return 'STEP original (SAMET)';
    case 'reconstruction':
      return 'Reconstrucción paramétrica (300)';
    case 'variant':
      return 'Variante paramétrica (450)';
  }
}
