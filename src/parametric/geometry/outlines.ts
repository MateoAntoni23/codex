/**
 * outlines.ts — polígonos canónicos por tipo de pieza STP-Z 300.
 *
 * Procedencia (cadena completa):
 *   1. STEP de SolidWorks aportado por el usuario (análisis y sha256 en
 *      `tools/step_parametric/report/<pieza>.json`). Si el STEP es original
 *      del fabricante o un modelo hecho por el usuario no está confirmado: se
 *      usa como referencia geométrica, no como fuente oficial de cotas.
 *   2. `tools/step_parametric/build_all.py` (`_export_originals_glb`) lo
 *      convierte con CadQuery a `public/parametric/originals_glb/<pieza>.glb`,
 *      una primitiva por cara del sólido.
 *   3. Los vértices de cada polígono se tomaron de ese GLB (min/max de los
 *      accessor de cada cara), se trasladaron al marco canónico (centro del
 *      bbox GLB → centro del bbox canónico) y se copiaron aquí como literales
 *      redondeados a 0,01 mm (`4236323`). Ese paso no quedó versionado como
 *      herramienta: no hay `__outline.json` para perforada.
 * Por eso "medido del GLB" (comentarios) y "medido del STEP de referencia"
 * (notas de cada receta, visibles en la interfaz) dicen lo mismo: el GLB es el
 * STEP convertido. `perforadaOutlinesVsGlb.test.ts` contrasta CPS-45 y CPS-90
 * con su GLB.
 *
 * Son la fuente de verdad del contorno 2D que reemplaza la revolución suave
 * de CadQuery, que no reflejaba las secciones rectas con quiebres reales.
 *
 * Reglas de variación:
 *
 *   - TRPS: escala solo ancho (Z). Longitud y ala fijos.
 *   - XPS, CPS-45, CPS-90, DCPS: escala uniforme desde el origen por
 *     ancho / 300. Preserva relaciones angulares y ratios internos.
 *   - CUPS: escala solo la profundidad de extrusión (Z=ancho). El perfil
 *     XY queda fijo (SAMET no publica regla de variación).
 *
 * El `ala_mm` NO se infiere del polígono: entra como parámetro proveniente
 * del CATÁLOGO (familia SAM-STP-Z: 50 mm). Si el STEP aportado tiene un bbox
 * Y distinto, es dato de observación (fidelity.span_delta_pct), no fuente.
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
// Polígono (ancho=300) del STEP CPS-300-45-Z vía su GLB original (cadena en
// el encabezado), trasladado al marco canónico. Para variantes se aplica
// escala uniforme desde el origen.
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
      'Polígono faceteado medido del STEP de referencia (7 vértices, chaflanes mitrados; NO revolución suave).',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría medida sobre el STEP de referencia (procedencia en verificación).'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Regla provisional (SAMET no publica ancho≠300).`,
    ],
  };
}

// -----------------------------------------------------------------------------
// CPS-90 — codo plano 90°.
// Polígono (ancho=300) del STEP CPS-300-90-Z vía su GLB original (cadena en
// el encabezado).
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
      'Polígono faceteado medido del STEP de referencia (8 vértices: chaflanes 45° interior y exterior).',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría medida sobre el STEP de referencia (procedencia en verificación).'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Regla provisional.`,
    ],
  };
}

// -----------------------------------------------------------------------------
// DCPS — derivación T lateral (identificación en revisión).
// Polígono (ancho=300) del STEP `DCPS-300-Z.STEP` vía su GLB original, con chaflanes
// interiores. Las tres bocas son 300 mm (el modelo previo truncaba las del
// tronco a 75).
//
// IDENTIFICACIÓN PENDIENTE: el polígono observado es simétrico en X respecto
// al eje central (v0↔v7, v1↔v6, v2↔v5, v3↔v4, v9↔v8). Un DCPS SAMET es
// asimétrico (derivación común); una T simétrica corresponde a la familia TPS.
// El archivo STEP se llama DCPS pero su forma es compatible con TPS. No se
// renombra el SKU (impacto en BOM/compatibilidades) hasta contrastar con el
// maestro oficial SAMET.
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
      'Polígono faceteado del STEP de referencia (10 vértices, chaflanes 45° en esquinas interiores).',
      'Las tres bocas son ancho×ala (medidas del STEP: ~300 mm c/u). El modelo previo truncaba las del tronco a 75 mm.',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría medida sobre el STEP de referencia (procedencia en verificación).'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Regla provisional.`,
    ],
  };
}

// -----------------------------------------------------------------------------
// XPS — cruz plana.
// Polígono (ancho=300) del STEP XPS-300-Z vía su GLB original. 16 vértices: 4 chaflanes
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
      'Polígono faceteado del STEP de referencia (16 vértices, chaflanes 45° en cada esquina interior).',
      ancho_mm === 300
        ? 'Ancho=300 mm: geometría medida sobre el STEP de referencia (procedencia en verificación).'
        : `Variante ancho=${ancho_mm}: escala uniforme desde origen por ${(ancho_mm / 300).toFixed(3)}. Mantiene proporciones.`,
    ],
  };
}

// -----------------------------------------------------------------------------
// CUPS — codo vertical (SAMET bracket A).
// Pieza vertical: perfil XY extruido en Z. Polígono CCW visto desde +Z,
// 8 vértices con chaflanes interiores y exteriores.
//
// Marco del STEP vs marco de instalación natural:
//   El STEP viene modelado con su perfil XY rotado +45° CCW respecto al marco
//   donde las bocas quedan axis-aligned (una mira a −Y, la otra a −X). Esto
//   obligaba al usuario a calibrar +45° sobre Z en cada apertura. Lo
//   corregimos aquí en la receta: rotamos el polígono medido +45° CCW alrededor
//   del origen antes de construir el prisma y de calcular las bocas. El STEP
//   original también se rota +45° en el loader para que coincida con la
//   reconstrucción sin calibración (ver `original_rotation_z_deg` en catalog).
//
// Dos caras operativas (chaflanes exteriores V0→V1 y V4→V5, cada una 300×36.56
// mm): el STEP sí expone estas caras rectas. Sus normales en el marco natural
// son (0,−1,0) y (−1,0,0) — la pieza transiciona de horizontal a vertical.
// -----------------------------------------------------------------------------

/** Perfil del STEP CUPS-300-A-Z vía su GLB original (marco XY del STEP, pre-rotación). */
const CUPS_OUTLINE_300_XY_STEP: readonly V2[] = [
  [-54.63, 25.85],
  [-28.78, 0],
  [0, 28.78],
  [0, 204.19],
  [-28.78, 232.97],
  [-54.64, 207.12],
  [-34.0, 186.49],
  [-34.0, 46.49],
];

/** Rotación CCW alrededor del origen (grados). Conserva orientación CCW. */
function rotatePolygonZ(poly: readonly V2[], deg: number): V2[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return poly.map(([x, y]) => [x * c - y * s, x * s + y * c] as const);
}

/**
 * Rotación aplicada al perfil CUPS para alinearlo al marco de instalación
 * natural. También se aplica al STEP original (ver catalog.original_rotation_z_deg).
 */
export const CUPS_NATURAL_FRAME_ROTATION_Z_DEG = 45;

export function buildCUPSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  // ala_mm llega por compatibilidad con la firma común, pero CUPS no la usa:
  // la "altura" interna del canal se deriva del polígono XY medido.
  void params.ala_mm;
  const { ancho_mm } = params;

  // Rotamos el perfil medido al marco natural. SAMET no publica regla de
  // escalado para CUPS → perfil XY fijo, sólo escalamos la profundidad (Z).
  const polygon = rotatePolygonZ(
    CUPS_OUTLINE_300_XY_STEP,
    CUPS_NATURAL_FRAME_ROTATION_Z_DEG,
  );

  const xy_minX = Math.min(...polygon.map((p) => p[0]));
  const xy_maxX = Math.max(...polygon.map((p) => p[0]));
  const xy_minY = Math.min(...polygon.map((p) => p[1]));
  const xy_maxY = Math.max(...polygon.map((p) => p[1]));

  // Canónico CUPS: Z ∈ [-ancho, 0] (igual convención que piezas horizontales).
  // El prisma se construye en Z ∈ [0, ancho] y se traslada a -ancho.
  const centerZ = -ancho_mm / 2;

  // Bocas operativas sobre las dos chaflanes exteriores del perfil. En el
  // marco natural:
  //   V0→V1  (índices 0→1): arista horizontal en Y = xy_minY, normal (0,−1,0).
  //                         Es la cara de la bandeja VERTICAL.
  //   V4→V5  (índices 4→5): arista vertical en X = xy_minX, normal (−1,0,0).
  //                         Es la cara de la bandeja HORIZONTAL.
  // Ancho del puerto = ancho_mm (profundidad del canal en Z, = ancho comercial).
  // Alto del puerto  = longitud de la chaflán (~36.56 mm). No coincide con el
  // ala del tramo recto (50 mm por catálogo SAM-STP-Z): SAMET no publica
  // compatibilidad directa — se marca como pendiente en catálogo.
  const v0 = polygon[0];
  const v1 = polygon[1];
  const v4 = polygon[4];
  const v5 = polygon[5];

  const p2EdgeLen = Math.hypot(v1[0] - v0[0], v1[1] - v0[1]);
  const p1EdgeLen = Math.hypot(v5[0] - v4[0], v5[1] - v4[1]);

  // P2_vertical — chaflán V0→V1, horizontal, normal (0, −1, 0).
  // u a lo largo de la extrusión (ancho de tray): elegimos (0,0,−1) para que
  // u×v = normal con v = dirección de la arista en XY normalizada hacia +X.
  const p2EdgeDx = (v1[0] - v0[0]) / p2EdgeLen; // +1 esperado
  const p2EdgeDy = (v1[1] - v0[1]) / p2EdgeLen; // 0 esperado
  const bocaVertical: PortDef = {
    name: 'P2_vertical',
    center: [(v0[0] + v1[0]) / 2, (v0[1] + v1[1]) / 2, centerZ],
    normal: [0, -1, 0],
    ancho_mm,
    ala_mm: p2EdgeLen,
    u_dir: [0, 0, -1],
    v_dir: [p2EdgeDx, p2EdgeDy, 0],
    kind: 'operational',
  };

  // P1_horizontal — chaflán V4→V5, vertical, normal (−1, 0, 0).
  //
  // Convención unificada con TRPS/CPS/portOnEdgeXZ: en toda boca con normal
  // (−1,0,0) elegimos u=(0,0,+1) y v=(0,+1,0) de modo que u×v = normal y v
  // es el eje "ala/arriba de sección" coherente entre piezas vecinas. Antes
  // de esta normalización CUPS exponía la elección inversa (u=(0,0,−1),
  // v=(0,−1,0)) — algebraicamente válida porque u×v=n se preserva, pero
  // geométricamente equivalía a rotar 180° el marco alrededor de la normal.
  // El efecto visual era el cuerpo de CUPS invertido respecto al recto
  // horizontal entrante (ala apuntando hacia −Z mundo mientras el recto la
  // deja apuntando a +Z). Ver docs/pattern-models-reconciliation.md §D6.
  //
  // p1EdgeDx/p1EdgeDy se conservan como evidencia numérica de la arista
  // medida (p1EdgeDy ≈ −1, p1EdgeDx ≈ 0) pero el signo se invierte al
  // asignar v_dir para alinear con la convención TRPS (v = +Y local).
  const p1EdgeDx = (v5[0] - v4[0]) / p1EdgeLen; // 0 esperado
  const p1EdgeDy = (v5[1] - v4[1]) / p1EdgeLen; // −1 esperado
  const bocaHorizontal: PortDef = {
    name: 'P1_horizontal',
    center: [(v4[0] + v5[0]) / 2, (v4[1] + v5[1]) / 2, centerZ],
    normal: [-1, 0, 0],
    ancho_mm,
    ala_mm: p1EdgeLen,
    u_dir: [0, 0, 1],
    v_dir: [-p1EdgeDx, -p1EdgeDy, 0],
    kind: 'operational',
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
      'Perfil XY medido del STEP (8 vértices) rotado +45° al marco de instalación natural donde las bocas quedan axis-aligned.',
      `Bocas MEDIDAS sobre las chaflanas exteriores del STEP: 300 × ${p1EdgeLen.toFixed(2)} mm. Longitud de conexión (~${p1EdgeLen.toFixed(0)} mm) difiere del ala del tramo recto (50 mm por catálogo SAM-STP-Z): compatibilidad mecánica pendiente de dato SAMET.`,
      'Variante ascendente/descendente: SAMET publica sólo CUPS-A; la ascendente se asumiría espejo (pendiente de confirmación).',
      ancho_mm === 300
        ? 'Ancho=300 mm: profundidad del canal fiel al STEP.'
        : `Variante ancho=${ancho_mm}: sólo escala la profundidad Z. El perfil XY queda fijo (sin regla pública).`,
    ],
  };
}
