/**
 * escaleraOutlines — polígonos 2D medidos sobre los STEP de escalera aportados
 * por el usuario (procedencia como originales del fabricante en verificación).
 *
 * Fuente: `tools/step_parametric/report/escalera/*__outline.json`, extraídos
 * por `tools/step_parametric/extract_outlines.py` desde los archivos en
 * `C:\Users\Usuario\Desktop\step samet\Familia 300 Ala 65\Archivos STP\escalera`.
 *
 * Convención local:
 *   - Polígono 2D en el plano X–Z local, origen (0,0) en la esquina mínima.
 *   - Orientación CCW vista desde +Y. Extrusión +Y por `y_height_mm` (= ala).
 *   - Aristas de contorno expuestas con su boundary (x_min, x_max, z_min, z_max)
 *     y normal saliente (outward_normal).
 *
 * NO se inventan medidas: si falta una dimensión del catálogo, el consumidor
 * debe decidir si cae a representación conceptual o rechaza la variante.
 */

export type Vec2 = readonly [number, number];

export interface MeasuredEdge {
  readonly i: number;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly length_mm: number;
  readonly midpoint: Vec2;
  /** Normal saliente del polígono (apunta "hacia afuera" del cuerpo). */
  readonly outward_normal: Vec2;
  /** Pegada al borde del bbox: 'x_min' | 'x_max' | 'z_min' | 'z_max' | null. */
  readonly boundary: 'x_min' | 'x_max' | 'z_min' | 'z_max' | null;
}

export interface EscaleraOutline {
  readonly source_file: string;
  /** Ancho×largo del bbox local en el plano XZ, y altura Y (ala medida). */
  readonly bbox_local: { readonly x_max: number; readonly z_max: number; readonly y_height_mm: number };
  /**
   * Ancho útil de ducto medido en el STEP base — el patrón se construyó a
   * ancho nominal 300 mm, y la medición interior es 298.9 mm. Este valor
   * (NO `bbox_local.z_max`) es la base para el factor de escala cuando el
   * usuario pide un ancho objetivo distinto. Para TRES el bbox coincide con
   * el ducto; para las demás piezas el bbox es la extensión TOTAL del
   * polígono y usarlo como base produce bocas con ancho muy inferior al
   * nominal (ver `scaleFactorsFromOutline`).
   */
  readonly baseAnchoMm: number;
  /** Vértices CCW en XZ local, [[x,z], ...]. */
  readonly polygon: readonly Vec2[];
  /** Aristas que caen sobre un borde del bbox (candidatas a boca). */
  readonly boundary_edges: readonly MeasuredEdge[];
}

// ─── TRES-300-065-18-Z — tramo recto escalera 3000mm, ancho 300, ala 65 ────
// Las aristas de 3000 mm (z_min/z_max) son los rails; los puertos son los
// lados cortos (ancho = 298.9 mm nominal 300). P1 = x_min, P2 = x_max.
export const TRES_300_065_18_Z: EscaleraOutline = {
  source_file: 'TRES-300-065-18-Z.STEP',
  bbox_local: { x_max: 3000.0, z_max: 298.9, y_height_mm: 65.0 },
  baseAnchoMm: 298.9,
  polygon: [
    [0.0, 0.0],
    [3000.0, 0.0],
    [3000.0, 298.9],
    [0.0, 298.9],
  ],
  boundary_edges: [
    // P1: boca en x_min — outward -X.
    { i: 3, a: [0.0, 298.9], b: [0.0, 0.0], length_mm: 298.9, midpoint: [0.0, 149.45], outward_normal: [-1.0, 0.0], boundary: 'x_min' },
    // P2: boca en x_max — outward +X.
    { i: 1, a: [3000.0, 0.0], b: [3000.0, 298.9], length_mm: 298.9, midpoint: [3000.0, 149.45], outward_normal: [1.0, 0.0], boundary: 'x_max' },
  ],
};

// ─── CS-300-45-065-18-Z — curva escalera 45°, ancho 300, ala 65 ───────────
// 8 vértices, mitreada (NO arco suave).
//
// Contorno del STEP reemplazado por el operador el 2026-11-11 (sha256
// 123dd1e8…). El anterior (sha256 2f572cc3…) era un codo de 60°, no de 45°:
// sus bocas tenían normales a −30° y +90°. Valores copiados sin redondear de
// `CS-300-45-065-18-Z__outline.json`; `escaleraOutlinesVsReport.test.ts` los
// contrasta contra ese JSON.
export const CS_300_45_065_18_Z: EscaleraOutline = {
  source_file: 'CS-300-45-065-18-Z.STEP',
  bbox_local: { x_max: 492.211, z_max: 651.049, y_height_mm: 65.0 },
  baseAnchoMm: 298.9,
  polygon: [
    [0.0, 458.333],
    [125.494, 155.363],
    [280.857, 0.0],
    [492.211, 211.354],
    [378.889, 324.676],
    [298.9, 517.788],
    [298.9, 651.049],
    [0.004, 651.049],
  ],
  boundary_edges: [
    // Bocas = las dos aristas que miden el ancho de bandeja (~298,9 mm). Las
    // demás miden 327,9 / 219,7 / 160,3 / 209,0 / 133,3 / 192,7 mm y son
    // paredes, aunque la detección automática marque la 7 como 'x_min'.
    // P1: arista superior z_max (horizontal), polygon[6]→polygon[7], normal +Z, long 298.896.
    { i: 6, a: [298.9, 651.049], b: [0.004, 651.049], length_mm: 298.896, midpoint: [149.452, 651.049], outward_normal: [0.0, 1.0], boundary: 'z_max' },
    // P2: arista diagonal a 45°, polygon[2]→polygon[3], normal (0.707,−0.707), long 298.9.
    // No está pegada a un borde del bbox.
    { i: 2, a: [280.857, 0.0], b: [492.211, 211.354], length_mm: 298.9, midpoint: [386.534, 105.677], outward_normal: [0.707, -0.707], boundary: null },
  ],
};

// ─── CS-300-90-065-18-Z — curva escalera 90°, ancho 300, ala 65 ───────────
// 8 vértices, mitreada (polígono tipo "codo Z"). Consistent con project_cps90_geometry.md
// para la familia perforada, solo que aquí sí 65 mm de ala.
export const CS_300_90_065_18_Z: EscaleraOutline = {
  source_file: 'CS-300-90-065-18-Z.STEP',
  bbox_local: { x_max: 744.12, z_max: 744.031, y_height_mm: 65.0 },
  baseAnchoMm: 298.9,
  polygon: [
    [411.12, 0.0],
    [744.12, 0.0],
    [743.44, 298.9],
    [534.46, 298.9],
    [298.9, 534.46],
    [298.9, 743.46],
    [0.0, 744.03],
    [0.0, 411.12],
  ],
  boundary_edges: [
    // P1: boca extremo del brazo horizontal (x≈744) — polygon[1]→polygon[2].
    // Centro (743.78, 149.45), normal casi +X (chamfer 0.68 mm respecto al bbox),
    // long 298.9. Boundary 'x_max' (parcial, por el chaflán mitero).
    { i: 1, a: [744.12, 0.0], b: [743.44, 298.9], length_mm: 298.9, midpoint: [743.78, 149.45], outward_normal: [0.99999, 0.00228], boundary: 'x_max' },
    // P2: boca extremo del brazo vertical (z≈744) — polygon[5]→polygon[6].
    // Centro (149.45, 743.745), normal casi +Z, long 298.9.
    // Boundary 'z_max' (parcial, por el chaflán mitero de 0.57 mm).
    // NOTA: antes P1/P2 apuntaban a polygon[0]→polygon[1] (piso brazo horiz,
    // long 333) y polygon[6]→polygon[7] (pared izq brazo vert, long 333)
    // porque la detección automática elige aristas pegadas al bbox. Esas
    // aristas son paredes EXTERIORES del codo, no bocas (ver recipes).
    { i: 5, a: [298.9, 743.46], b: [0.0, 744.03], length_mm: 298.9, midpoint: [149.45, 743.745], outward_normal: [0.00191, 0.99999], boundary: 'z_max' },
  ],
};

// ─── TS-300-065-18-Z — T escalera, ancho 300, ala 65 ───────────────────────
// 10 vértices: tronco vertical (en Z) + ramal horizontal (hacia +X).
export const TS_300_065_18_Z: EscaleraOutline = {
  source_file: 'TS-300-065-18-Z.STEP',
  bbox_local: { x_max: 743.462, z_max: 1189.0, y_height_mm: 65.0 },
  baseAnchoMm: 298.9,
  polygon: [
    [0.0, 0.0],
    [298.9, 0.0],
    [298.9, 208.91],
    [534.46, 444.47],
    [743.46, 444.47],
    [743.46, 744.44],
    [534.55, 744.44],
    [298.99, 980.0],
    [298.99, 1189.0],
    [0.0, 1189.0],
  ],
  boundary_edges: [
    // P1: tronco inferior (z_min).
    { i: 0, a: [0.0, 0.0], b: [298.9, 0.0], length_mm: 298.9, midpoint: [149.45, 0.0], outward_normal: [0.0, -1.0], boundary: 'z_min' },
    // P2: ramal (x_max).
    { i: 4, a: [743.46, 444.47], b: [743.46, 744.44], length_mm: 299.96, midpoint: [743.46, 594.46], outward_normal: [1.0, 0.0], boundary: 'x_max' },
    // P3: tronco superior (z_max).
    // a/b corregidos 2026-11-11 desde el __outline.json: antes decían
    // [298.99, 980.0] → [298.99, 1189.0], los extremos de la arista 7 (pared).
    { i: 8, a: [298.985, 1189.0], b: [0.0, 1189.0], length_mm: 298.99, midpoint: [149.49, 1189.0], outward_normal: [0.0, 1.0], boundary: 'z_max' },
  ],
};

// ─── XS-300-065-18-Z — cruz escalera, ancho 300, ala 65 ────────────────────
// 16 vértices, cruz simétrica de brazos 298.9mm.
export const XS_300_065_18_Z: EscaleraOutline = {
  source_file: 'XS-300-065-18-Z.STEP',
  bbox_local: { x_max: 1187.936, z_max: 1187.936, y_height_mm: 65.0 },
  baseAnchoMm: 298.9,
  polygon: [
    [0.0, 444.56],
    [208.91, 444.56],
    [444.47, 209.0],
    [444.47, 0.0],
    [743.37, 0.0],
    [743.37, 208.91],
    [978.93, 444.47],
    [1187.94, 444.47],
    [1187.94, 743.37],
    [979.02, 743.37],
    [743.46, 978.93],
    [743.46, 1187.94],
    [444.56, 1187.94],
    [444.56, 979.02],
    [209.0, 743.46],
    [0.0, 743.46],
  ],
  boundary_edges: [
    // P1: brazo inferior (z_min).
    { i: 3, a: [444.47, 0.0], b: [743.37, 0.0], length_mm: 298.9, midpoint: [593.92, 0.0], outward_normal: [0.0, -1.0], boundary: 'z_min' },
    // P2: brazo derecho (x_max).
    { i: 7, a: [1187.94, 444.47], b: [1187.94, 743.37], length_mm: 298.9, midpoint: [1187.94, 593.92], outward_normal: [1.0, 0.0], boundary: 'x_max' },
    // P3: brazo superior (z_max).
    { i: 11, a: [743.46, 1187.94], b: [444.56, 1187.94], length_mm: 298.9, midpoint: [594.01, 1187.94], outward_normal: [0.0, 1.0], boundary: 'z_max' },
    // P4: brazo izquierdo (x_min).
    { i: 15, a: [0.0, 743.46], b: [0.0, 444.56], length_mm: 298.9, midpoint: [0.0, 594.01], outward_normal: [-1.0, 0.0], boundary: 'x_min' },
  ],
};

// ─── RIS-15-065-18-Z — reducción lateral escalera (300 → 150), ala 65 ─────
// 6 vértices, longitud transición 450 mm. Un lateral recto (x_min) + un
// lateral quebrado (tramo recto 148.9 + rampa 45° de 212.1 mm + remate recto
// 150.5 mm). Boca ancho 150 en z_min, boca ancho 300 en z_max.
export const RIS_15_065_18_Z: EscaleraOutline = {
  source_file: 'RIS-15-065-18-Z.STEP',
  bbox_local: { x_max: 298.9, z_max: 450.0, y_height_mm: 65.0 },
  // RIS mide 300→150: la boca "ancha" es 298.9 (= ancho útil nominal 300).
  // El build de RIS no usa `scaleFactorsFromOutline` (polígono fijo), pero
  // declaramos el campo por consistencia con el resto de outlines.
  baseAnchoMm: 298.9,
  polygon: [
    [148.896, 0.0],
    [148.9, 149.503],
    [298.9, 299.503],
    [298.9, 450.0],
    [0.004, 450.0],
    [0.0, 0.0],
  ],
  boundary_edges: [
    // P1: boca estrecha (z_min) — ancho medido 148.9 mm (nominal 150).
    { i: 5, a: [0.0, 0.0], b: [148.896, 0.0], length_mm: 148.896, midpoint: [74.448, 0.0], outward_normal: [0.0, -1.0], boundary: 'z_min' },
    // P2: boca ancha (z_max) — ancho medido 298.9 mm (nominal 300).
    { i: 3, a: [298.9, 450.0], b: [0.004, 450.0], length_mm: 298.896, midpoint: [149.452, 450.0], outward_normal: [0.0, 1.0], boundary: 'z_max' },
  ],
};

export const ESCALERA_OUTLINES_BY_SKU = {
  'SAM_TRES-300-065-18-Z': TRES_300_065_18_Z,
  'SAM_CS-300-45-065-18-Z': CS_300_45_065_18_Z,
  'SAM_CS-300-90-065-18-Z': CS_300_90_065_18_Z,
  'SAM_TS-300-065-18-Z': TS_300_065_18_Z,
  'SAM_XS-300-065-18-Z': XS_300_065_18_Z,
  'SAM_RIS-15-065-18-Z': RIS_15_065_18_Z,
  // RCS-30-15 (reducción central) sigue pendiente: el STEP está orientado con
  // Y como eje principal (450 mm) y no expone cara superior plana a y_max.
} as const;

export type EscaleraSku = keyof typeof ESCALERA_OUTLINES_BY_SKU;

export function getEscaleraOutline(sku: string | null | undefined): EscaleraOutline | null {
  if (!sku) return null;
  const key = sku as EscaleraSku;
  return (ESCALERA_OUTLINES_BY_SKU as Record<string, EscaleraOutline>)[key] ?? null;
}
