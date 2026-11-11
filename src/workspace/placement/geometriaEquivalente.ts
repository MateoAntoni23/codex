/**
 * geometriaEquivalente — ¿dos definiciones dan la misma pieza? (B-2, decisión 3)
 *
 * La huella identifica una definición; para decidir si una pieza colocada
 * está DESACTUALIZADA, o si una aprobación sigue valiendo, se compara la
 * GEOMETRÍA resultante: la definición vigente se coloca desde la misma boca y
 * el mismo marco que la guardada, y se comparan en mundo todas las bocas
 * (centro, normal, orientación transversal, ancho y ala) y todos los vértices
 * de la malla.
 *
 * Tolerancia — se compara una definición contra otra (no dos piezas
 * montadas), así que lo que hay que tolerar es representar los mismos datos
 * con otra precisión:
 *   - las transcripciones anteriores redondeaban a 0,01 mm → hasta 0,005 mm por
 *     coordenada, 0,0071 mm por vértice; se toma 0,01 mm;
 *   - las variantes escalan el polígono del modelo por ancho/300 (uniforme), y
 *     el error de redondeo escala igual: 0,01 mm × max(1, ancho/300);
 *   - ángulo: la normal de una boca sale de su arista (≥ ~149 mm en el
 *     catálogo actual); 0,0141 mm sobre 149 mm son 0,0054° → 0,01°.
 * Por encima de eso, es un cambio real de geometría.
 */
import * as THREE from 'three';
import { buildDefinitionGeometry, placeDefinition, worldPorts, poseMatrix, type Mano, type Pose, type StoredDefinition } from './placementCore';

export const TOL_GEOM_BASE_MM = 0.01;
export const TOL_GEOM_DEG = 0.01;

export function tolGeomMm(def: StoredDefinition): number {
  const ancho = def.params.ancho_mm;
  return TOL_GEOM_BASE_MM * Math.max(1, typeof ancho === 'number' && ancho > 0 ? ancho / 300 : 1);
}

export interface Comparacion {
  readonly equivalente: boolean;
  readonly maxMm: number;
  readonly maxDeg: number;
  readonly motivo: string | null;
}

const ang = (a: readonly number[], b: readonly number[]) => {
  const cr = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  return (Math.atan2(cr, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 180) / Math.PI;
};

function verticesMundo(def: StoredDefinition, mano: Mano, pose: Pose): Float32Array {
  const g = buildDefinitionGeometry(def, mano);
  g.applyMatrix4(poseMatrix(pose));
  const arr = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const copia = new Float32Array(arr);
  g.dispose();
  return copia;
}

/**
 * Compara la pieza tal como está guardada (definición + mano + pose) con la
 * que daría la definición `nueva` colocada desde la misma boca de entrada, en
 * el mismo punto, dirección y orientación.
 */
export function compararConGuardada(
  guardada: { def: StoredDefinition; mano: Mano; pose: Pose; bocaEntrada: string },
  nueva: StoredDefinition,
): Comparacion {
  const tolMm = Math.max(tolGeomMm(guardada.def), tolGeomMm(nueva));
  const a = worldPorts(guardada.def, guardada.mano, guardada.pose);
  const entrada = a.find((p) => p.name === guardada.bocaEntrada);
  if (!entrada) return { equivalente: false, maxMm: Infinity, maxDeg: Infinity, motivo: `la boca de entrada ${guardada.bocaEntrada} no está en la definición guardada` };
  if (!nueva.ports.some((p) => p.name === guardada.bocaEntrada)) {
    return { equivalente: false, maxMm: Infinity, maxDeg: Infinity, motivo: `la definición vigente no tiene la boca ${guardada.bocaEntrada}` };
  }
  let colocada;
  try {
    colocada = placeDefinition({
      def: nueva, huella: 'comparacion', mano: guardada.mano, entryPortName: guardada.bocaEntrada,
      startPos: entrada.pos, entryDir: [-entrada.normal[0], -entrada.normal[1], -entrada.normal[2]], sectionUp: entrada.vDir,
    });
  } catch (e) {
    return { equivalente: false, maxMm: Infinity, maxDeg: Infinity, motivo: `la definición vigente no se puede colocar igual: ${e instanceof Error ? e.message : String(e)}` };
  }
  const b = worldPorts(nueva, guardada.mano, colocada.colocacion.pose);
  const nombresA = a.map((p) => p.name).sort().join(',');
  const nombresB = b.map((p) => p.name).sort().join(',');
  if (nombresA !== nombresB) return { equivalente: false, maxMm: Infinity, maxDeg: Infinity, motivo: `cambiaron las bocas (${nombresA} → ${nombresB})` };
  let maxMm = 0;
  let maxDeg = 0;
  for (const pa of a) {
    const pb = b.find((q) => q.name === pa.name)!;
    maxMm = Math.max(maxMm, Math.hypot(pa.pos[0] - pb.pos[0], pa.pos[1] - pb.pos[1], pa.pos[2] - pb.pos[2]));
    maxDeg = Math.max(maxDeg, ang(pa.normal, pb.normal), ang(pa.vDir, pb.vDir));
    const da = guardada.def.ports.find((q) => q.name === pa.name)!;
    const db = nueva.ports.find((q) => q.name === pa.name)!;
    maxMm = Math.max(maxMm, Math.abs(da.ancho_mm - db.ancho_mm), Math.abs(da.ala_mm - db.ala_mm));
  }
  const va = verticesMundo(guardada.def, guardada.mano, guardada.pose);
  const vb = verticesMundo(nueva, guardada.mano, colocada.colocacion.pose);
  if (va.length !== vb.length) return { equivalente: false, maxMm: Infinity, maxDeg, motivo: 'cambió la forma (otra cantidad de vértices)' };
  for (let i = 0; i < va.length; i += 3) {
    maxMm = Math.max(maxMm, Math.hypot(va[i] - vb[i], va[i + 1] - vb[i + 1], va[i + 2] - vb[i + 2]));
  }
  const equivalente = maxMm <= tolMm && maxDeg <= TOL_GEOM_DEG;
  return {
    equivalente,
    maxMm,
    maxDeg,
    motivo: equivalente ? null : `la geometría cambió ${maxMm.toFixed(3)} mm / ${maxDeg.toFixed(3)}° (tolerancia ${tolMm.toFixed(3)} mm / ${TOL_GEOM_DEG}°)`,
  };
}

/** Compara dos definiciones colocadas igual (origen, entrada por su primera boca común). */
export function compararDefiniciones(a: StoredDefinition, b: StoredDefinition): Comparacion {
  const boca = a.ports.find((p) => b.ports.some((q) => q.name === p.name))?.name;
  if (!boca) return { equivalente: false, maxMm: Infinity, maxDeg: Infinity, motivo: 'no comparten ninguna boca' };
  const pl = placeDefinition({ def: a, huella: 'a', mano: 'nativa', entryPortName: boca, startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  return compararConGuardada({ def: a, mano: 'nativa', pose: pl.colocacion.pose, bocaEntrada: boca }, b);
}
