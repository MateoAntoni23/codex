/**
 * Geometría de escalera dibujada desde la DEFINICIÓN (B-2).
 *
 * Antes la escalera se dibujaba con un generador propio (`ladderGeometry`)
 * alimentado por las bocas y las medidas del catálogo, y con un contorno
 * buscado por SKU que en la práctica nunca se encontraba (el índice usa el
 * producto_id `SAM_…` y se consultaba con el `sku`). Ahora una pieza de
 * escalera con definición se dibuja desde esa definición, como cualquier otra:
 *   - largueros: las aristas del polígono que NO son bocas, como paredes de
 *     alto = alto de extrusión de la definición (el ala);
 *   - planta: una placa delgada con el polígono, para ver el área de la bandeja.
 *
 * Qué arista es boca no se guarda aparte: para cada boca de la definición se
 * toma la arista cuyo punto medio (a media altura, en el marco local) está más
 * cerca de su centro y cuya normal saliente apunta igual (± 30°). Si una boca
 * no encuentra arista así (p. ej. una calibración grande), no se quita ningún
 * larguero por ella: se dibuja de más, nunca de menos.
 *
 * Sólo piezas que se extruyen en Y (planta en XZ). Las demás (curva vertical)
 * usan el prisma macizo de siempre.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPrism } from '../../parametric/geometry/buildPrism';
import { buildDefinitionGeometry, meshLocalMatrix, type Mano, type StoredDefinition } from './placementCore';

/** Espesor visual de un larguero (mm). Sólo representación; no es una cota. */
export const ESPESOR_LARGUERO_VISUAL_MM = 4;
/** Espesor visual de la placa de planta (mm). Sólo representación. */
export const ESPESOR_PLANTA_VISUAL_MM = 2;
const COS_30 = Math.cos(Math.PI / 6);

type V2 = readonly [number, number];

/** Índices de arista del polígono que corresponden a bocas de la definición. */
export function aristasDeBoca(def: StoredDefinition): Set<number> {
  const out = new Set<number>();
  if (!def.mesh.extrudeAlongY) return out;
  const poly = def.mesh.polygon;
  const n = poly.length;
  const m = meshLocalMatrix(def, 'nativa');
  const [tx, ty, tz] = def.mesh.translate;
  const h = def.mesh.height;
  const aristas = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const mid = new THREE.Vector3((a[0] + b[0]) / 2 + tx, h / 2 + ty, (a[1] + b[1]) / 2 + tz).applyMatrix4(m);
    const nrm = new THREE.Vector3(dz / L, 0, -dx / L).transformDirection(m);
    return { mid, nrm };
  });
  for (const port of def.ports) {
    const c = new THREE.Vector3(...port.center);
    const pn = new THREE.Vector3(...port.normal).normalize();
    let best = -1;
    let bestD = Infinity;
    aristas.forEach((e, i) => {
      if (e.nrm.dot(pn) < COS_30) return;
      const d = e.mid.distanceTo(c);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) out.add(best);
  }
  return out;
}

/** Pared delgada sobre la arista a→b, hacia adentro del polígono CCW. */
function pared(a: V2, b: V2, h: number): THREE.BufferGeometry | null {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  if (L < 1e-6) return null;
  // Normal saliente (dz, −dx)/L; hacia adentro = la opuesta.
  const ix = (-dz / L) * ESPESOR_LARGUERO_VISUAL_MM;
  const iz = (dx / L) * ESPESOR_LARGUERO_VISUAL_MM;
  const quad: Array<[number, number]> = [
    [a[0], a[1]],
    [b[0], b[1]],
    [b[0] + ix, b[1] + iz],
    [a[0] + ix, a[1] + iz],
  ];
  // buildPrism exige el mismo sentido que los polígonos de pieza.
  return buildPrism(quad, h, true);
}

/** Geometría local de una pieza de escalera: largueros + planta, desde la definición. */
export function buildLadderDefinitionGeometry(def: StoredDefinition, mano: Mano): THREE.BufferGeometry {
  if (!def.mesh.extrudeAlongY) return buildDefinitionGeometry(def, mano);
  const poly = def.mesh.polygon;
  const n = poly.length;
  const bocas = aristasDeBoca(def);
  const partes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    if (bocas.has(i)) continue;
    const g = pared(poly[i], poly[(i + 1) % n], def.mesh.height);
    if (g) partes.push(g.index ? g.toNonIndexed() : g);
  }
  const planta = buildPrism(poly as Array<[number, number]>, ESPESOR_PLANTA_VISUAL_MM, true);
  partes.push(planta.index ? planta.toNonIndexed() : planta);
  for (const g of partes) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const geom = mergeGeometries(partes, false);
  if (!geom) return buildDefinitionGeometry(def, mano);
  const [tx, ty, tz] = def.mesh.translate;
  if (tx !== 0 || ty !== 0 || tz !== 0) geom.translate(tx, ty, tz);
  const m = meshLocalMatrix(def, mano);
  geom.applyMatrix4(m);
  if (m.determinant() < 0) {
    // misma corrección de orientación que buildDefinitionGeometry
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const t = arr[(i + 1) * 3 + k];
        arr[(i + 1) * 3 + k] = arr[(i + 2) * 3 + k];
        arr[(i + 2) * 3 + k] = t;
      }
    }
    pos.needsUpdate = true;
  }
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
