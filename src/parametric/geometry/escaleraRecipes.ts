/**
 * escaleraRecipes — recetas paramétricas para los maestros escalera SAM-STE.
 *
 * Toma los polígonos MEDIDOS en `escaleraOutlines.ts` (ancho=300 × ala=65) y
 * los proyecta a (ancho_mm, ala_mm, longitud_mm) objetivos por regla explícita:
 *
 *   - TRES (tramo_recto): polígono rectangular — longitud escala X,
 *     ancho escala Z, ala escala Y. `ala-independent` MEDIDA por construcción.
 *   - CS-45 / CS-90 (curva_horizontal): hipótesis visual uniform-xz
 *     (ancho/300 escala X y Z simultáneamente). Explícita como no validada.
 *   - TS (derivación lateral): uniform-xz.
 *   - XS (cruz): uniform-xz.
 *   - RIS (reducción lateral): sin regla de escala — polígono fijo (sólo ala
 *     escala Y). El dispatcher rechaza anchos ≠ 300.
 *
 * Los polígonos se expresan en el mismo marco local que las recetas perforada
 * (plano XZ, origen en esquina mínima, extrusión Y = ala). Las normales
 * salientes y centros de boca se calculan con el helper `portOnEdgeXZ` común,
 * garantizando ortonormalidad y consistencia con el resto del dispatcher.
 *
 * Las variantes (p.ej. TRES-450-065, TRES-300-090, TRES-450-090) se construyen
 * desde el polígono base — NO desde una variante STEP distinta: por eso la
 * procedencia es 'derived' y no 'measured'.
 */

import {
  TRES_300_065_18_Z,
  CS_300_45_065_18_Z,
  CS_300_90_065_18_Z,
  TS_300_065_18_Z,
  XS_300_065_18_Z,
  RIS_15_065_18_Z,
  type EscaleraOutline,
  type Vec2,
} from './escaleraOutlines';
import type { GeometryRecipe, PortDef } from './outlines';

// ─── Helpers locales (replica de outlines.portOnEdgeXZ) ───────────────────────
//
// Se replica para no exportar helpers internos de outlines.ts. La lógica es
// idéntica: calcula centro, normal, u_dir, v_dir de un puerto sobre la arista
// (a,b) del polígono XZ con extrusión Y = ala.

function portOnEdge(name: string, a: Vec2, b: Vec2, ala_mm: number): PortDef {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  // Hito 2: los contornos escalera (escaleraOutlines.ts) están recorridos en
  // sentido opuesto a los de perforada, así que la normal "izquierda" de la arista
  // (−dz, dx) apuntaba HACIA ADENTRO del cuerpo (P1 en x_min con normal +x,
  // contra la `outward_normal` −x medida en escaleraOutlines.ts). Se usa la otra
  // (dz, −dx): coincide con la normal exterior medida. Ver la prueba
  // "toda boca apunta hacia afuera de su contorno".
  const nx = dz / len;
  const nz = -dx / len;
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

function scaleXZ(poly: readonly Vec2[], sx: number, sz: number): Vec2[] {
  return poly.map(([x, z]) => [x * sx, z * sz] as const);
}

function bboxOf(poly: readonly Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Factores de escala (sx, sz) para un maestro escalera a partir de su outline
 * base (ancho=300, ala=65). Para TRES el polígono rectangular soporta escala
 * independiente por eje; para las demás formas la hipótesis visual es
 * uniform-xz (ancho/baseAncho escala ambos ejes). El factor del ala NO entra
 * aquí: la ala se aplica como altura de extrusión, sin tocar el polígono 2D.
 *
 * La base del factor es `outline.baseAnchoMm` (ancho ÚTIL del ducto medido en
 * el STEP, típicamente 298.9 mm para el patrón ancho nominal 300). Antes se
 * usaba `bbox_local.z_max`, que coincide con el ancho útil sólo en TRES
 * (polígono rectangular); para las piezas no rectangulares — CS-45, CS-90,
 * TS, XS — el z_max es la EXTENSIÓN TOTAL del polígono (652, 744, 1189,
 * 1188 mm respectivamente), con lo que el factor de escala resultaba muy
 * inferior a 1 y las bocas terminaban con ancho del orden de 75–137 mm
 * (reporte del usuario: "bocas de ancho 150 en lugar de 300").
 */
function scaleFactorsFromOutline(
  outline: EscaleraOutline,
  targetAncho: number,
  targetLongitud: number | null,
  isRectangular: boolean,
): { sx: number; sz: number } {
  const baseAncho = outline.baseAnchoMm > 0 ? outline.baseAnchoMm : 300;
  const baseLong = outline.bbox_local.x_max > 0 ? outline.bbox_local.x_max : 300;
  if (isRectangular) {
    const sx = targetLongitud !== null && targetLongitud > 0 ? targetLongitud / baseLong : 1;
    const sz = targetAncho > 0 ? targetAncho / baseAncho : 1;
    return { sx, sz };
  }
  const s = targetAncho > 0 ? targetAncho / baseAncho : 1;
  return { sx: s, sz: s };
}

// ─── TRES — tramo recto escalera ─────────────────────────────────────────────
// Polígono rectangular medido (ancho=300 × longitud=3000 × ala=65). Regla
// ala-independent MEDIDA por construcción: longitud escala X, ancho escala Z,
// ala escala Y independientemente.

export function buildTRESRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
  longitud_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm, longitud_mm } = params;
  const { sx, sz } = scaleFactorsFromOutline(TRES_300_065_18_Z, ancho_mm, longitud_mm, true);
  const polygon = scaleXZ(TRES_300_065_18_Z.polygon, sx, sz);
  const ports: PortDef[] = [
    // outline.boundary_edges: [0]=P1 (x_min, outward -X), [1]=P2 (x_max, outward +X).
    // El polígono base es [(0,0),(long,0),(long,z_max),(0,z_max)] CCW.
    // Aristas (a→b): P1 = polygon[3] → polygon[0], P2 = polygon[1] → polygon[2].
    portOnEdge('P1', polygon[3], polygon[0], ala_mm),
    portOnEdge('P2', polygon[1], polygon[2], ala_mm),
  ];
  const bb = bboxOf(polygon);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [bb.minX, 0, bb.minZ],
    bboxMax: [bb.maxX, ala_mm, bb.maxZ],
    notes: [
      'Escalera tramo recto — polígono rectangular medido (ancho=300, ala=65, longitud=3000).',
      'Regla ala-independent MEDIDA por construcción: longitud escala X, ancho escala Z, ala escala Y de forma independiente.',
    ],
  };
}

// ─── CS-45 — curva escalera 45° ──────────────────────────────────────────────
// 8 vértices mitereados. P1 sobre z_max (arista polygon[5]→polygon[6], recta
// horizontal). P2 sobre la cara diagonal a 60° (arista polygon[1]→polygon[2]).
// NOTA: antes P2 se fijaba sobre polygon[6]→polygon[7] por ser pegada al
// borde x_min del bbox (lo que la detección automática confunde con "boca"),
// pero esa arista es la PARED vertical izquierda — longitud 213 mm, NO una
// boca. La boca real de entrada es la cara diagonal (normal (0.866,-0.5)),
// longitud ≈298.9 mm, y es la que debe reportar `port.ancho_mm` ≈ ancho_mm.

export function buildCS45Recipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const { sx, sz } = scaleFactorsFromOutline(CS_300_45_065_18_Z, ancho_mm, null, false);
  const polygon = scaleXZ(CS_300_45_065_18_Z.polygon, sx, sz);
  // P1 = cara z_max (horizontal): polygon[5]→polygon[6]. Longitud 298.9 mm base.
  // P2 = cara diagonal 60°:       polygon[1]→polygon[2]. Longitud 298.87 mm base.
  const ports: PortDef[] = [
    portOnEdge('P1', polygon[5], polygon[6], ala_mm),
    portOnEdge('P2', polygon[1], polygon[2], ala_mm),
  ];
  const bb = bboxOf(polygon);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [bb.minX, 0, bb.minZ],
    bboxMax: [bb.maxX, ala_mm, bb.maxZ],
    notes: [
      'Escalera curva 45° — polígono medido 8 vértices (mitereado, NO arco suave).',
      ancho_mm === 300
        ? 'Ancho=300: geometría medida sobre STEP de referencia.'
        : `Variante ancho=${ancho_mm}: hipótesis visual uniform-xz (SAMET no publica ancho≠300 para CS).`,
    ],
  };
}

// ─── CS-90 — curva escalera 90° ──────────────────────────────────────────────
// 8 vértices, polígono tipo "codo Z". Las bocas quedan en los EXTREMOS de
// cada brazo, no sobre las paredes largas: P1 en el extremo del brazo
// horizontal (cara casi-vertical a x≈744), P2 en el extremo del brazo
// vertical (cara casi-horizontal a z≈744).
// NOTA: antes se fijaban P1 sobre polygon[0]→polygon[1] (piso del brazo
// horizontal, 333 mm) y P2 sobre polygon[6]→polygon[7] (pared izquierda del
// brazo vertical, 333 mm). Esas son las paredes exteriores — 333 mm, NO el
// ancho útil de 298.9 mm — y daban bocas de "ancho 334" a geometría ancho
// nominal 300 (reporte del usuario "CAS-300 con bocas ancho 150"; tras
// corregir el factor de escala quedaba el error residual 334).

export function buildCS90Recipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const { sx, sz } = scaleFactorsFromOutline(CS_300_90_065_18_Z, ancho_mm, null, false);
  const polygon = scaleXZ(CS_300_90_065_18_Z.polygon, sx, sz);
  // P1 = extremo brazo horizontal (x≈744): polygon[1]→polygon[2]. Base 298.9.
  // P2 = extremo brazo vertical   (z≈744): polygon[5]→polygon[6]. Base 298.9.
  const ports: PortDef[] = [
    portOnEdge('P1', polygon[1], polygon[2], ala_mm),
    portOnEdge('P2', polygon[5], polygon[6], ala_mm),
  ];
  const bb = bboxOf(polygon);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [bb.minX, 0, bb.minZ],
    bboxMax: [bb.maxX, ala_mm, bb.maxZ],
    notes: [
      'Escalera curva 90° — polígono medido 8 vértices (mitereado).',
      ancho_mm === 300
        ? 'Ancho=300: geometría medida sobre STEP de referencia.'
        : `Variante ancho=${ancho_mm}: hipótesis visual uniform-xz (SAMET no publica ancho≠300 para CS).`,
    ],
  };
}

// ─── TS — Tee simétrica escalera ─────────────────────────────────────────────
// 10 vértices: tronco vertical (en Z) + ramal (hacia +X).

export function buildTSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const { sx, sz } = scaleFactorsFromOutline(TS_300_065_18_Z, ancho_mm, null, false);
  const polygon = scaleXZ(TS_300_065_18_Z.polygon, sx, sz);
  // Boundary edges:
  //   P1 = index 0 (z_min):        polygon[0]→polygon[1]
  //   P2 = index 4 (x_max, ramal): polygon[4]→polygon[5]
  //   P3 = index 8 (z_max):        polygon[8]→polygon[9]
  const ports: PortDef[] = [
    portOnEdge('P1', polygon[0], polygon[1], ala_mm),
    // Hito 2: nombres alineados con el catálogo (P3 = "boca derivación").
    portOnEdge('P3', polygon[4], polygon[5], ala_mm),
    portOnEdge('P2', polygon[8], polygon[9], ala_mm),
  ];
  const bb = bboxOf(polygon);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [bb.minX, 0, bb.minZ],
    bboxMax: [bb.maxX, ala_mm, bb.maxZ],
    notes: [
      'Escalera Tee simétrica — polígono medido 10 vértices (tronco + ramal, chaflanes 45°).',
      ancho_mm === 300
        ? 'Ancho=300: geometría medida sobre STEP de referencia.'
        : `Variante ancho=${ancho_mm}: hipótesis visual uniform-xz.`,
    ],
  };
}

// ─── XS — Cruz escalera ──────────────────────────────────────────────────────
// 16 vértices, cruz simétrica.

export function buildXSRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ancho_mm, ala_mm } = params;
  const { sx, sz } = scaleFactorsFromOutline(XS_300_065_18_Z, ancho_mm, null, false);
  const polygon = scaleXZ(XS_300_065_18_Z.polygon, sx, sz);
  // Boundary edges:
  //   P1 = index 3 (z_min):  polygon[3]→polygon[4]
  //   P2 = index 7 (x_max):  polygon[7]→polygon[8]
  //   P3 = index 11 (z_max): polygon[11]→polygon[12]
  //   P4 = index 15 (x_min): polygon[15]→polygon[0]
  const ports: PortDef[] = [
    portOnEdge('P1', polygon[3], polygon[4], ala_mm),
    portOnEdge('P2', polygon[7], polygon[8], ala_mm),
    portOnEdge('P3', polygon[11], polygon[12], ala_mm),
    portOnEdge('P4', polygon[15], polygon[0], ala_mm),
  ];
  const bb = bboxOf(polygon);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [bb.minX, 0, bb.minZ],
    bboxMax: [bb.maxX, ala_mm, bb.maxZ],
    notes: [
      'Escalera cruz — polígono medido 16 vértices (chaflanes 45° en cada esquina interior).',
      ancho_mm === 300
        ? 'Ancho=300: geometría medida sobre STEP de referencia.'
        : `Variante ancho=${ancho_mm}: hipótesis visual uniform-xz.`,
    ],
  };
}

// ─── RIS — Reducción lateral escalera ────────────────────────────────────────
// 6 vértices. Boca z_min (ancho 150) ↔ boca z_max (ancho 300). El polígono
// NO escala: la transición 300→150 es específica; no hay regla pública para
// extenderla a otros anchos. Sólo escala la ala en Y.

export function buildRISRecipe(params: {
  ancho_mm: number;
  ala_mm: number;
}): GeometryRecipe {
  const { ala_mm } = params;
  // Ignoramos ancho_mm: el polígono queda fijo (ver notas). Un dispatcher que
  // quiera soportar reducciones de otros anchos debe aportar un STEP propio.
  const polygon = RIS_15_065_18_Z.polygon.map(([x, z]) => [x, z] as const);
  // Boundary edges:
  //   P1 = index 5 (z_min, 150 mm):  polygon[5]→polygon[0]
  //   P2 = index 3 (z_max, 300 mm):  polygon[3]→polygon[4]
  const ports: PortDef[] = [
    portOnEdge('P1', polygon[5], polygon[0], ala_mm),
    portOnEdge('P2', polygon[3], polygon[4], ala_mm),
  ];
  const bb = bboxOf(polygon);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports,
    bboxMin: [bb.minX, 0, bb.minZ],
    bboxMax: [bb.maxX, ala_mm, bb.maxZ],
    notes: [
      'Escalera reducción lateral — polígono medido 6 vértices (transición 300→150).',
      'Polígono fijo: SAMET no publica regla de extensión a otros anchos. Sólo escala la ala en Y.',
    ],
  };
}
