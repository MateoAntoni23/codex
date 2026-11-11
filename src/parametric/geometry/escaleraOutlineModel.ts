/**
 * escaleraOutlineModel — tipos y derivación de los contornos de escalera.
 *
 * Los datos (polígono, bbox, qué aristas son bocas) están en
 * `escaleraOutlines.ts`, GENERADO desde los `__outline.json` extraídos del STEP
 * (ver `tools/step_parametric/emit_escalera_outlines.mjs`). Aquí sólo se
 * derivan, desde el polígono, los datos de cada boca: extremos, largo, punto
 * medio y normal saliente. No se guardan por duplicado: no hay nada que
 * transcribir ni que pueda discrepar del polígono.
 *
 * Convención local:
 *   - Polígono 2D en el plano X–Z local, origen (0,0) en la esquina mínima.
 *   - Orientación CCW vista desde +Y. Extrusión +Y por `y_height_mm` (= ala).
 *   - Arista i = polygon[i] → polygon[i+1]; normal saliente (dz, −dx)/L, la
 *     misma convención que `extract_outlines.py`.
 */

export type Vec2 = readonly [number, number];

export type BoundaryLabel = 'x_min' | 'x_max' | 'z_min' | 'z_max';

/** Boca declarada en `tools/step_parametric/escalera_bocas.json`. */
export interface BocaDeclarada {
  readonly nombre: string;
  /** Índice de arista: polygon[arista] → polygon[arista + 1]. */
  readonly arista: number;
  readonly ancho_nominal_mm: number;
}

export interface MeasuredEdge {
  /** Nombre de la boca (P1, P2, …), igual al `recipePortName` del maestro. */
  readonly nombre: string;
  readonly i: number;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly length_mm: number;
  readonly midpoint: Vec2;
  /** Normal saliente del polígono (apunta "hacia afuera" del cuerpo). */
  readonly outward_normal: Vec2;
  /**
   * Borde del bbox en el que cae la arista según la detección automática del
   * extractor (informativo; NO identifica bocas: ver `nombre`).
   */
  readonly boundary: BoundaryLabel | null;
  readonly ancho_nominal_mm: number;
}

export interface EscaleraOutline {
  readonly source_file: string;
  /** Extensión del bbox local en el plano XZ, y altura Y (ala medida). */
  readonly bbox_local: { readonly x_max: number; readonly z_max: number; readonly y_height_mm: number };
  /**
   * Ancho útil de ducto medido en el STEP base (298.9 para el patrón de ancho
   * nominal 300). Es la base del factor de escala cuando se pide otro ancho
   * (NO `bbox_local.z_max`, que es la extensión total del polígono).
   */
  readonly baseAnchoMm: number;
  /** Vértices CCW en XZ local, [[x,z], ...]. */
  readonly polygon: readonly Vec2[];
  /** Detección del extractor por arista (x_min, …, o null). */
  readonly edge_boundary: readonly (BoundaryLabel | null)[];
  /** Bocas declaradas, en el orden declarado. */
  readonly bocas: readonly BocaDeclarada[];
  /** Bocas con su geometría, derivada del polígono; mismo orden que `bocas`. */
  readonly boundary_edges: readonly MeasuredEdge[];
}

export type EscaleraOutlineInput = Omit<EscaleraOutline, 'boundary_edges'>;

/** Geometría de la arista i del polígono (CCW en XZ). */
export function edgeOf(polygon: readonly Vec2[], i: number): { a: Vec2; b: Vec2; length_mm: number; midpoint: Vec2; outward_normal: Vec2 } {
  const n = polygon.length;
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`arista ${i} fuera de 0..${n - 1}`);
  const a = polygon[i];
  const b = polygon[(i + 1) % n];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  if (!(L > 0)) throw new Error(`arista ${i} de largo nulo`);
  return {
    a,
    b,
    length_mm: L,
    midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    outward_normal: [dz / L, -dx / L],
  };
}

export function defineEscaleraOutline(input: EscaleraOutlineInput): EscaleraOutline {
  if (input.edge_boundary.length !== input.polygon.length) {
    throw new Error(`${input.source_file}: ${input.edge_boundary.length} etiquetas de arista para ${input.polygon.length} vértices`);
  }
  const boundary_edges: MeasuredEdge[] = input.bocas.map((boca) => ({
    nombre: boca.nombre,
    i: boca.arista,
    ...edgeOf(input.polygon, boca.arista),
    boundary: input.edge_boundary[boca.arista],
    ancho_nominal_mm: boca.ancho_nominal_mm,
  }));
  return { ...input, boundary_edges };
}
