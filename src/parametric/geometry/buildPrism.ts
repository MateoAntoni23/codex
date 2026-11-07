/**
 * buildPrism — construye una BufferGeometry de prisma recto a partir de un
 * polígono 2D. Base de las reconstrucciones procedurales STP-Z.
 *
 * Convención (crítica para que normales y bocas coincidan con el STEP):
 *
 *  - `polygon` lista pares (u, v) en el plano del polígono, con orientación
 *    CCW visto desde el sentido positivo del eje de extrusión.
 *
 *  - Si `extrudeAlongY === true`:
 *      (u, v) se interpreta como (x, z) en el marco canónico (horizontales).
 *      Polígono CCW visto desde +Y (interior a la izquierda del caminante;
 *      shoelace en (x, z) sin negar queda negativo).
 *      El prisma se extruye en +Y desde y=0 hasta y=height (= ala).
 *      Tapa inferior normal −Y; tapa superior +Y; muros con normal exterior
 *      en el plano XZ.
 *
 *  - Si `extrudeAlongY === false`:
 *      (u, v) se interpreta como (x, y) en el marco canónico (pieza vertical
 *      CUPS). Polígono CCW visto desde +Z (shoelace positiva en (x, y)).
 *      El prisma se extruye en +Z desde z=0 hasta z=height (= ancho).
 *      Tapa inferior normal −Z; tapa superior +Z; muros con normal exterior
 *      en el plano XY.
 *
 * La geometría se devuelve ya triangulada, con atributos `position` y
 * `normal` planos (sin index). Sin UVs porque los materiales son
 * sólidos/transparentes de debugging.
 */

import * as THREE from 'three';

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

export function buildPrism(
  polygon: readonly V2[],
  height: number,
  extrudeAlongY: boolean,
): THREE.BufferGeometry {
  if (polygon.length < 3) {
    throw new Error('buildPrism: se requieren al menos 3 vértices');
  }
  if (!(height > 0)) {
    throw new Error(`buildPrism: height debe ser > 0 (recibido ${height})`);
  }

  // El triangulador de three.js espera CCW estándar en (U, V) con shoelace
  // positiva. Para el caso "extrudeAlongY" (polígono CCW visto desde +Y),
  // eso implica negar la segunda coordenada antes de triangular.
  const triContour = polygon.map(
    ([u, v]) => new THREE.Vector2(u, extrudeAlongY ? -v : v),
  );
  const triangles = THREE.ShapeUtils.triangulateShape(triContour, []);
  if (!triangles.length) {
    throw new Error('buildPrism: triangulación vacía (polígono degenerado o CW)');
  }

  const positions: number[] = [];
  const normals: number[] = [];

  const to3D: (u: number, v: number, w: number) => V3 = extrudeAlongY
    ? (u, v, w) => [u, w, v]
    : (u, v, w) => [u, v, w];

  const capNormalPos: V3 = extrudeAlongY ? [0, 1, 0] : [0, 0, 1];
  const capNormalNeg: V3 = extrudeAlongY ? [0, -1, 0] : [0, 0, -1];

  function pushTri(a: V3, b: V3, c: V3, n: V3): void {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    normals.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  }

  // Tapa inferior (w=0) — normal −extrude. Invertimos winding para que el
  // normal apunte hacia afuera.
  for (const tri of triangles) {
    const [a, b, c] = tri;
    const pa = polygon[a];
    const pb = polygon[b];
    const pc = polygon[c];
    pushTri(
      to3D(pa[0], pa[1], 0),
      to3D(pc[0], pc[1], 0),
      to3D(pb[0], pb[1], 0),
      capNormalNeg,
    );
  }

  // Tapa superior (w=height) — normal +extrude. Winding directa.
  for (const tri of triangles) {
    const [a, b, c] = tri;
    const pa = polygon[a];
    const pb = polygon[b];
    const pc = polygon[c];
    pushTri(
      to3D(pa[0], pa[1], height),
      to3D(pb[0], pb[1], height),
      to3D(pc[0], pc[1], height),
      capNormalPos,
    );
  }

  // Muros laterales. Normal exterior por producto cruz entre la dirección de
  // avance a→b y el eje de extrusión (+Y ó +Z según el modo). Resultado:
  //   Y-up: (du, 0, dv) × (0, 1, 0) = (−dv, 0, du)
  //   Z-up: (du, dv, 0) × (0, 0, 1) = ( dv, −du, 0)
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-9) continue;

    const normal: V3 = extrudeAlongY
      ? [-dv / len, 0, du / len]
      : [dv / len, -du / len, 0];

    const aBot = to3D(a[0], a[1], 0);
    const bBot = to3D(b[0], b[1], 0);
    const bTop = to3D(b[0], b[1], height);
    const aTop = to3D(a[0], a[1], height);

    // Dos triángulos CCW vistos desde el exterior:
    pushTri(aBot, bBot, bTop, normal);
    pushTri(aBot, bTop, aTop, normal);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
