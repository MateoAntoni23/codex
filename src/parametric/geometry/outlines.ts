/**
 * outlines.ts — polígonos canónicos por tipo de pieza STP-Z 300.
 *
 * Los polígonos están medidos directamente sobre los GLB originales SAMET
 * (vértices por cara extraídos de los accessor min/max), trasladados al
 * marco canónico (centro del bbox GLB → centro del bbox canónico). Son
 * la fuente de verdad que reemplaza la revolución suave de CadQuery, que
 * no reflejaba las secciones rectas con quiebres reales.
 *
 * Reglas de variación:
 *
 *   - TRPS: escala solo ancho (Z). Longitud y ala fijos.
 *   - XPS, CPS-45, CPS-90, DCPS: escala uniforme desde el origen por
 *     ancho / 300. Preserva relaciones angulares y ratios internos.
 *   - CUPS: escala solo la profundidad de extrusión (Z=ancho). El perfil
 *     XY queda fijo (SAMET no publica regla de variación).
 *
 * Todos los polígonos horizontales están en XZ, CCW visto desde +Y. CUPS
 * está en XY, CCW visto desde +Z.
 */

import type { Vec3 } from '../catalog';

type V2 = readonly [number, number];
type V3 = Vec3;

/**
 * Tipo del puerto:
 *  - 'operational': conexión verificada contra una cara real del STEP. Puede
 *    usarse como punto de conexión de bandejas vecinas.
 *  - 'reference': plano de referencia conceptual (no corresponde a una cara
 *    plana real del STEP). Útil como indicador geométrico pero NO está
 *    validado como boca operativa. Se renderiza con color distinto y nota
 *    explícita en el inspector.
 */
export type PortKind = 'operational' | 'reference';

export interface PortDef {
  readonly name: string;
  readonly center: V3;
  readonly normal: V3;
  readonly ancho_mm: number;
  readonly ala_mm: number;
  readonly u_dir: V3;
  readonly v_dir: V3;
  readonly kind: PortKind;
}

export interface GeometryRecipe {
  /** Plano del polígono y eje de extrusión. */
  readonly extrudeAlongY: boolean;
  /** Vértices del contorno (CCW visto desde +Y si Y-up, +Z si Z-up). */
  readonly polygon: readonly V2[];
  /** Altura de extrusión (>0). Para Y-up es la ala, para Z-up el ancho. */
  readonly height: number;
  /** Desplazamiento constante a aplicar al prisma tras construirlo. */
  readonly translate: V3;
  /** Puertos efectivos, en coordenadas canónicas. */
  readonly ports: readonly PortDef[];
  /** BBox canónico (inclusive translate). */
  readonly bboxMin: V3;
  readonly bboxMax: V3;
  /** Notas de procedencia/limitación para el inspector. */
  readonly notes: readonly string[];
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

function scalePolygon(poly: readonly V2[], s: number): V2[] {
  return poly.map(([u, v]) => [u * s, v * s] as const);
}

function portOnEdgeXZ(
  name: string,
  a: V2,
  b: V2,
  ala_mm: number,
): PortDef {
  // Puerto cuya cara coincide con el muro lateral del prisma Y-up sobre la
  // arista (a→b). Ancho = longitud de la arista. Normal = exterior del
  // polígono CCW (-dv, 0, du)/len. v_dir = +Y, u_dir perpendicular a normal
  // dentro del plano XZ con u_dir × v_dir = normal (puerto right-handed).
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const nx = -dz / len;
  const nz = dx / len;
  // u_dir en XZ tal que (u × v) = n con v=(0,1,0):
  //   u=(ux,0,uz) → u×v = (0*0 - uz*1, uz*0 - ux*0, ux*1 - 0*0) = (-uz, 0, ux)
  //   queremos (-uz, 0, ux) = (nx, 0, nz) ⇒ uz=-nx, ux=nz
  const ux = nz;
  const uz = -nx;
  return {
    name,
    center: [(a[0] + b[0]) / 2, ala_mm / 2, (a[1] + b[1]) / 2],
    normal: [nx, 0, nz],
    ancho_mm: len,
    ala_mm,
    u_dir: [ux, 0, uz],
    v_dir: [0, 1, 0],
    kind: 'operational',
  };
}

// -----------------------------------------------------------------------------
// TRPS — tramo recto.
// Polígono rectangular en XZ: (0,0)-(long,0)-(long,-ancho)-(0,-ancho).
// -----------------------------------------------------------------------------

export function buildTRPSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
  longitud_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm, longitud_mm } = params;
  const polygon: V2[] = [
    [0, 0],
    [longitud_mm, 0],
    [longitud_mm, -ancho_mm],
    [0, -ancho_mm],
  ];
  const ports: PortDef[] = [
    portOnEdgeXZ('P1', polygon[3], polygon[0], ala_mm), // edge (0,-ancho)→(0,0)
    portOnEdgeXZ('P2', polygon[1], polygon[2], ala_mm), // edge (long,0)→(long,-ancho)
  ];
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [0, 0, -ancho_mm],
    bboxMax: [longitud_mm, ala_mm, 0],
    notes: [
      'Envolvente simple. No refleja perfil Z ni perforaciones del STEP.',
    ],
  };
}

// -----------------------------------------------------------------------------
// CPS-45 — codo plano 45°.
// Polígono medido (ancho=300) del GLB CPS-300-45-Z, trasladado al marco
// canónico. Para variantes se aplica escala uniforme desde el origen.
// -----------------------------------------------------------------------------

const CPS45_OUTLINE_300: readonly V2[] = [
  [109.84, 0],
  [410.97, -0.43],
  [410.97, -29.29],
  [435.43, -88.33],
  [455.83, -108.73],
  [243.21, -321.98],
  [109.84, -188.6],
];

export function buildCPS45Recipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const s = ancho_mm / 300;
  const polygon = scalePolygon(CPS45_OUTLINE_300, s);

  // Port 1 — cara de entrada (z≈0), arista polygon[0] → polygon[1].
  // Port 2 — cara slanted, arista polygon[4] → polygon[5].
  const p1 = portOnEdgeXZ('P1', polygon[0], polygon[1], ala_mm);
  const p2 = portOnEdgeXZ('P2', polygon[4], polygon[5], ala_mm);

  const minX = Math.min(...polygon.map((p) => p[0]));
  const maxX = Math.max(...polygon.map((p) => p[0]));
  const minZ = Math.min(...polygon.map((p) => p[1]));
  const maxZ = Math.max(...polygon.map((p) => p[1]));

  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports: [p1, p2],
    bboxMin: [minX, 0, minZ],
    bboxMax: [maxX, ala_mm, maxZ],
    notes: [
      'Polígono faceteado medido del STEP original (7 vértices, chaflanes mitrados; NO revolución suave).',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría fiel al STEP SAMET.'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Regla provisional (SAMET no publica ancho≠300).`,
    ],
  };
}

// -----------------------------------------------------------------------------
// CPS-90 — codo plano 90°.
// Polígono medido (ancho=300) del GLB CPS-300-90-Z.
// -----------------------------------------------------------------------------

const CPS90_OUTLINE_300: readonly V2[] = [
  [0, 0],
  [298.9, -0.57],
  [298.9, -209.57],
  [534.46, -445.13],
  [743.37, -445.13],
  [744.12, -744.03],
  [411.12, -744.03],
  [0, -332.92],
];

export function buildCPS90Recipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const s = ancho_mm / 300;
  const polygon = scalePolygon(CPS90_OUTLINE_300, s);

  // P1 — cara de entrada (z≈0), arista polygon[0] → polygon[1].
  // P2 — cara saliente (x≈744), arista polygon[4] → polygon[5].
  const p1 = portOnEdgeXZ('P1', polygon[0], polygon[1], ala_mm);
  const p2 = portOnEdgeXZ('P2', polygon[4], polygon[5], ala_mm);

  const minX = Math.min(...polygon.map((p) => p[0]));
  const maxX = Math.max(...polygon.map((p) => p[0]));
  const minZ = Math.min(...polygon.map((p) => p[1]));
  const maxZ = Math.max(...polygon.map((p) => p[1]));

  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports: [p1, p2],
    bboxMin: [minX, 0, minZ],
    bboxMax: [maxX, ala_mm, maxZ],
    notes: [
      'Polígono faceteado medido del STEP original (8 vértices: chaflanes 45° interior y exterior).',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría fiel al STEP SAMET.'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Regla provisional.`,
    ],
  };
}

// -----------------------------------------------------------------------------
// DCPS — derivación T lateral.
// Polígono medido (ancho=300) del GLB DCPS-300-Z con chaflanes interiores.
// Las tres bocas son 300 mm (el modelo previo truncaba las del tronco a 75).
// -----------------------------------------------------------------------------

const DCPS_OUTLINE_300: readonly V2[] = [
  [0, -74.2],
  [28.77, -74.2],
  [74.25, -28.71],
  [74.25, 0],
  [375.26, 0],
  [375.26, -28.71],
  [420.74, -74.2],
  [449.5, -74.2],
  [449.5, -375.15],
  [0, -375.15],
];

export function buildDCPSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const s = ancho_mm / 300;
  const polygon = scalePolygon(DCPS_OUTLINE_300, s);

  // boca_derivacion — cara superior z=0, arista polygon[3] → polygon[4].
  // tronco_P1 — cara izquierda x=0, arista polygon[9] → polygon[0].
  // tronco_P2 — cara derecha x=449.5, arista polygon[7] → polygon[8].
  const bocaDerivacion = portOnEdgeXZ(
    'boca_derivacion',
    polygon[3],
    polygon[4],
    ala_mm,
  );
  const troncoP1 = portOnEdgeXZ('tronco_P1', polygon[9], polygon[0], ala_mm);
  const troncoP2 = portOnEdgeXZ('tronco_P2', polygon[7], polygon[8], ala_mm);

  const minX = Math.min(...polygon.map((p) => p[0]));
  const maxX = Math.max(...polygon.map((p) => p[0]));
  const minZ = Math.min(...polygon.map((p) => p[1]));
  const maxZ = Math.max(...polygon.map((p) => p[1]));

  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports: [bocaDerivacion, troncoP1, troncoP2],
    bboxMin: [minX, 0, minZ],
    bboxMax: [maxX, ala_mm, maxZ],
    notes: [
      'Polígono faceteado del STEP original (10 vértices, chaflanes 45° en esquinas interiores).',
      'Las tres bocas son ancho×ala (medidas del STEP: ~300 mm c/u). El modelo previo truncaba las del tronco a 75 mm.',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría fiel al STEP SAMET.'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Regla provisional.`,
    ],
  };
}

// -----------------------------------------------------------------------------
// XPS — cruz plana.
// Polígono medido (ancho=300) del GLB XPS-300-Z. 16 vértices: 4 chaflanes
// 45° en las esquinas interiores.
// -----------------------------------------------------------------------------

const XPS_OUTLINE_300: readonly V2[] = [
  [0, -74.2],
  [28.71, -74.2],
  [74.2, -28.71],
  [74.2, 0],
  [375.2, 0],
  [375.2, -28.71],
  [420.69, -74.2],
  [449.4, -74.2],
  [449.4, -375.2],
  [420.69, -375.2],
  [375.2, -420.69],
  [375.2, -449.4],
  [74.2, -449.4],
  [74.2, -420.69],
  [28.71, -375.2],
  [0, -375.2],
];

export function buildXPSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const s = ancho_mm / 300;
  const polygon = scalePolygon(XPS_OUTLINE_300, s);

  // P4_z_pos (norte) — arista polygon[3] → polygon[4] (cara superior z=0)
  // P2_x_pos (este) — arista polygon[7] → polygon[8] (cara x=L)
  // P3_z_neg (sur) — arista polygon[11] → polygon[12] (cara inferior z=-L)
  // P1_x_neg (oeste) — arista polygon[15] → polygon[0] (cara x=0)
  const pN = portOnEdgeXZ('P4_z_pos', polygon[3], polygon[4], ala_mm);
  const pE = portOnEdgeXZ('P2_x_pos', polygon[7], polygon[8], ala_mm);
  const pS = portOnEdgeXZ('P3_z_neg', polygon[11], polygon[12], ala_mm);
  const pW = portOnEdgeXZ('P1_x_neg', polygon[15], polygon[0], ala_mm);

  const minX = Math.min(...polygon.map((p) => p[0]));
  const maxX = Math.max(...polygon.map((p) => p[0]));
  const minZ = Math.min(...polygon.map((p) => p[1]));
  const maxZ = Math.max(...polygon.map((p) => p[1]));

  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    // Orden preservado respecto al catálogo anterior (W, E, S, N):
    ports: [pW, pE, pS, pN],
    bboxMin: [minX, 0, minZ],
    bboxMax: [maxX, ala_mm, maxZ],
    notes: [
      'Polígono faceteado del STEP original (16 vértices, chaflanes 45° en cada esquina interior).',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría fiel al STEP SAMET.'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Mantiene proporciones.`,
    ],
  };
}

// -----------------------------------------------------------------------------
// CUPS — codo vertical (SAMET bracket A).
// Pieza vertical: perfil XY extruido en Z. Polígono CCW visto desde +Z,
// 8 vértices con chaflanes interiores y exteriores.
// -----------------------------------------------------------------------------

const CUPS_OUTLINE_300_XY: readonly V2[] = [
  [-54.63, 25.85],
  [-28.78, 0],
  [0, 28.78],
  [0, 204.19],
  [-28.78, 232.97],
  [-54.64, 207.12],
  [-34.0, 186.49],
  [-34.0, 46.49],
];

export function buildCUPSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  // ala_mm llega por compatibilidad con la firma común, pero CUPS no la usa:
  // la "altura" interna del canal se deriva del polígono XY medido.
  void params.ala_mm;
  const { ancho_mm } = params;

  // SAMET no publica regla de escalado para CUPS. Mantenemos el perfil XY
  // fijo y sólo escalamos la profundidad (ancho/Z).
  const polygon = CUPS_OUTLINE_300_XY;

  const xy_minX = Math.min(...polygon.map((p) => p[0]));
  const xy_maxX = Math.max(...polygon.map((p) => p[0]));
  const xy_minY = Math.min(...polygon.map((p) => p[1]));
  const xy_maxY = Math.max(...polygon.map((p) => p[1]));
  const xSpan = xy_maxX - xy_minX;
  const ySpan = xy_maxY - xy_minY;
  const centerX = (xy_minX + xy_maxX) / 2;
  const centerY = (xy_minY + xy_maxY) / 2;

  // Canónico CUPS: Z ∈ [-ancho, 0] (igual convención que piezas horizontales).
  // El prisma se construye en Z ∈ [0, ancho] y se traslada a -ancho.
  const centerZ = -ancho_mm / 2;

  // Bocas provisionales. El STEP no expone caras rectas en Y=0 ni X=xy_minX
  // (los cantos están chaflanados); las conservamos como PLANOS DE REFERENCIA
  // en los que apoyarán las bandejas vecinas, con la misma semántica que usaba
  // el modelo envolvente previo. La fidelidad de malla sí mejora: el prisma
  // reconstruido reproduce los 8 vértices del perfil medido.
  const bocaHorizontal: PortDef = {
    name: 'P1_horizontal',
    center: [centerX, xy_minY, centerZ],
    normal: [0, -1, 0],
    ancho_mm,
    ala_mm: xSpan,
    u_dir: [1, 0, 0],
    v_dir: [0, 0, -1],
    kind: 'reference',
  };
  const bocaVertical: PortDef = {
    name: 'P2_vertical',
    center: [xy_minX, centerY, centerZ],
    normal: [-1, 0, 0],
    ancho_mm,
    ala_mm: ySpan,
    u_dir: [0, 0, -1],
    v_dir: [0, 1, 0],
    kind: 'reference',
  };

  return {
    extrudeAlongY: false,
    polygon,
    height: ancho_mm,
    translate: [0, 0, -ancho_mm],
    ports: [bocaHorizontal, bocaVertical],
    bboxMin: [xy_minX, xy_minY, -ancho_mm],
    bboxMax: [xy_maxX, xy_maxY, 0],
    notes: [
      'Polígono faceteado del STEP original (8 vértices del perfil XY). Pieza vertical: se extruye en Z por ancho.',
      'Bocas provisionales: planos de referencia Y=0 y X=-54.63 (el STEP no expone caras rectas ahí). SAMET no publica puertos operativos para CUPS.',
      ancho_mm === 300
        ? 'Ancho=300 mm: profundidad del canal fiel al STEP.'
        : `Variante ancho=${ancho_mm}: sólo escala la profundidad Z. El perfil XY queda fijo (sin regla pública).`,
    ],
  };
}
