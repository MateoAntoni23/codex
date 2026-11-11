// ARCHIVO GENERADO — NO EDITAR A MANO.
//
// Generado por tools/step_parametric/emit_escalera_outlines.mjs desde
//   tools/step_parametric/report/escalera/*__outline.json (extraídos del STEP)
//   tools/step_parametric/escalera_bocas.json (qué aristas son bocas)
// Para cambiar un contorno: volver a extraer el STEP. Para cambiar una boca:
// editar escalera_bocas.json. Después: node tools/step_parametric/emit_escalera_outlines.mjs
// escaleraOutlinesGenerated.test.ts falla si este archivo no está al día.

import { defineEscaleraOutline, type EscaleraOutline } from './escaleraOutlineModel';

export type { EscaleraOutline, MeasuredEdge, BocaDeclarada, Vec2 } from './escaleraOutlineModel';

// ─── TRES-300-065-18-Z — tramo recto escalera 3000 mm, ancho 300, ala 65
// Las aristas de 3000 mm son los largueros, no bocas.
export const TRES_300_065_18_Z: EscaleraOutline = defineEscaleraOutline({
  source_file: "TRES-300-065-18-Z.STEP",
  bbox_local: { x_max: 3000, z_max: 298.9, y_height_mm: 65 },
  baseAnchoMm: 298.9,
  polygon: [
    [0, 0],
    [3000, 0],
    [3000, 298.9],
    [0, 298.9],
  ],
  edge_boundary: ["z_min", "x_max", "z_max", "x_min"],
  bocas: [
    { nombre: "P1", arista: 3, ancho_nominal_mm: 300 }, // lado corto x_min
    { nombre: "P2", arista: 1, ancho_nominal_mm: 300 }, // lado corto x_max
  ],
});

// ─── CS-300-45-065-18-Z — curva escalera 45°, ancho 300, ala 65
// STEP reemplazado por el operador el 2026-11-11 (el anterior era un codo de 60°). La arista 7 queda pegada a x_min pero es pared (192,7 mm).
export const CS_300_45_065_18_Z: EscaleraOutline = defineEscaleraOutline({
  source_file: "CS-300-45-065-18-Z.STEP",
  bbox_local: { x_max: 492.211, z_max: 651.049, y_height_mm: 65 },
  baseAnchoMm: 298.9,
  polygon: [
    [0, 458.333],
    [125.494, 155.363],
    [280.857, 0],
    [492.211, 211.354],
    [378.889, 324.676],
    [298.9, 517.788],
    [298.9, 651.049],
    [0.004, 651.049],
  ],
  edge_boundary: [null, null, null, null, null, null, "z_max", "x_min"],
  bocas: [
    { nombre: "P1", arista: 6, ancho_nominal_mm: 300 }, // z_max, horizontal
    { nombre: "P2", arista: 2, ancho_nominal_mm: 300 }, // cara diagonal a 45°
  ],
});

// ─── CS-300-90-065-18-Z — curva escalera 90°, ancho 300, ala 65
// Las aristas pegadas al bbox (0 y 6, 333 mm) son paredes exteriores, no bocas.
export const CS_300_90_065_18_Z: EscaleraOutline = defineEscaleraOutline({
  source_file: "CS-300-90-065-18-Z.STEP",
  bbox_local: { x_max: 744.12, z_max: 744.031, y_height_mm: 65 },
  baseAnchoMm: 298.9,
  polygon: [
    [411.12, 0],
    [744.12, 0],
    [743.438, 298.9],
    [534.459, 298.9],
    [298.9, 534.459],
    [298.9, 743.462],
    [0, 744.031],
    [0, 411.12],
  ],
  edge_boundary: ["z_min", null, null, null, null, null, "x_min", null],
  bocas: [
    { nombre: "P1", arista: 1, ancho_nominal_mm: 300 }, // extremo del brazo horizontal (x≈744)
    { nombre: "P2", arista: 5, ancho_nominal_mm: 300 }, // extremo del brazo vertical (z≈744)
  ],
});

// ─── TS-300-065-18-Z — T escalera, ancho 300, ala 65
// El orden de la lista se conserva (measuredLadder usa la primera y la segunda); los nombres siguen al maestro: P2 tronco z_max, P3 derivación x_max. La arista x_min (1189 mm) es larguero del tronco.
export const TS_300_065_18_Z: EscaleraOutline = defineEscaleraOutline({
  source_file: "TS-300-065-18-Z.STEP",
  bbox_local: { x_max: 743.462, z_max: 1189, y_height_mm: 65 },
  baseAnchoMm: 298.9,
  polygon: [
    [0.004, 0],
    [298.9, 0],
    [298.9, 208.914],
    [534.459, 444.473],
    [743.462, 444.473],
    [743.462, 744.437],
    [534.548, 744.437],
    [298.989, 979.997],
    [298.985, 1189],
    [0, 1189],
  ],
  edge_boundary: ["z_min", null, null, null, "x_max", null, null, null, "z_max", "x_min"],
  bocas: [
    { nombre: "P1", arista: 0, ancho_nominal_mm: 300 }, // tronco z_min
    { nombre: "P3", arista: 4, ancho_nominal_mm: 300 }, // derivación x_max (P3 según el catálogo, 4e2ebd3)
    { nombre: "P2", arista: 8, ancho_nominal_mm: 300 }, // tronco z_max
  ],
});

// ─── XS-300-065-18-Z — cruz escalera, ancho 300, ala 65
// 16 vértices, cruz simétrica.
export const XS_300_065_18_Z: EscaleraOutline = defineEscaleraOutline({
  source_file: "XS-300-065-18-Z.STEP",
  bbox_local: { x_max: 1187.936, z_max: 1187.936, y_height_mm: 65 },
  baseAnchoMm: 298.9,
  polygon: [
    [0, 444.562],
    [208.914, 444.562],
    [444.473, 209.003],
    [444.473, 0],
    [743.374, 0],
    [743.374, 208.914],
    [978.933, 444.473],
    [1187.936, 444.473],
    [1187.936, 743.37],
    [979.022, 743.373],
    [743.462, 978.933],
    [743.459, 1187.936],
    [444.562, 1187.936],
    [444.562, 979.022],
    [209.003, 743.462],
    [0, 743.459],
  ],
  edge_boundary: [null, null, null, "z_min", null, null, null, "x_max", null, null, null, "z_max", null, null, null, "x_min"],
  bocas: [
    { nombre: "P1", arista: 3, ancho_nominal_mm: 300 }, // brazo z_min
    { nombre: "P2", arista: 7, ancho_nominal_mm: 300 }, // brazo x_max
    { nombre: "P3", arista: 11, ancho_nominal_mm: 300 }, // brazo z_max
    { nombre: "P4", arista: 15, ancho_nominal_mm: 300 }, // brazo x_min
  ],
});

// ─── RIS-15-065-18-Z — reducción escalera 300→150, ala 65
// La arista 0 (149,5 mm) es el tramo recto del lateral quebrado, no una boca. buildRISRecipe no usa baseAnchoMm (polígono fijo); se declara por consistencia.
export const RIS_15_065_18_Z: EscaleraOutline = defineEscaleraOutline({
  source_file: "RIS-15-065-18-Z.STEP",
  bbox_local: { x_max: 298.9, z_max: 450, y_height_mm: 65 },
  baseAnchoMm: 298.9,
  polygon: [
    [148.896, 0],
    [148.9, 149.503],
    [298.9, 299.503],
    [298.9, 450],
    [0.004, 450],
    [0, 0],
  ],
  edge_boundary: [null, null, "x_max", "z_max", "x_min", "z_min"],
  bocas: [
    { nombre: "P1", arista: 5, ancho_nominal_mm: 150 }, // boca angosta z_min
    { nombre: "P2", arista: 3, ancho_nominal_mm: 300 }, // boca ancha z_max
  ],
});

export const ESCALERA_OUTLINES_BY_SKU = {
  "SAM_TRES-300-065-18-Z": TRES_300_065_18_Z,
  "SAM_CS-300-45-065-18-Z": CS_300_45_065_18_Z,
  "SAM_CS-300-90-065-18-Z": CS_300_90_065_18_Z,
  "SAM_TS-300-065-18-Z": TS_300_065_18_Z,
  "SAM_XS-300-065-18-Z": XS_300_065_18_Z,
  "SAM_RIS-15-065-18-Z": RIS_15_065_18_Z,
} as const;

export type EscaleraSku = keyof typeof ESCALERA_OUTLINES_BY_SKU;

export function getEscaleraOutline(sku: string | null | undefined): EscaleraOutline | null {
  if (!sku) return null;
  return (ESCALERA_OUTLINES_BY_SKU as Record<string, EscaleraOutline>)[sku] ?? null;
}
