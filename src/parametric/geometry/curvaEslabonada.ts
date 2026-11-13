/**
 * Curva ESLABONADA (vertical, articulada): una cadena de eslabones con ángulo por
 * instancia. Dos piezas con el mismo mecanismo:
 *   - perforada: EPS-{ancho}-Z, "ESLABÓN UNIVERSAL — Curva eslabonada Smarttray"
 *     (el catálogo la vende POR ESLABÓN);
 *   - escalera: CUS-{ancho}-5-{ala}-{espesor}-{G|Z}, "CURVA VERTICAL (Articulated
 *     Bend)": cada código trae 5 eslabones.
 *
 * GEOMETRÍA — declarada por el operador (2026-11-13), con esa procedencia:
 *   - radio de giro = ancho de la bandeja (se toma sobre el eje de la pieza);
 *   - cada articulación cubre 22,5°;
 *   - eslabones N = techo(θ / 22,5°) + 1 (90° → 5, 45° → 3);
 *   - longitud de eje = el polígono real de N−1 cuerdas sobre ese radio, no el arco;
 *   - la boca de salida es la de entrada girada θ alrededor del centro;
 *   - ángulo por defecto 90°, modificable por instancia.
 * Ángulos que no son múltiplo de 22,5°: θ se reparte en las N−1 articulaciones
 * por igual (cada una ≤ 22,5°); en los múltiplos da exactamente cuerdas de 22,5°.
 *
 * CONTRADICE AL CATÁLOGO (anotado, no corregido): el catálogo no declara ángulo
 * ni rango, y su radio es otro. Trae un gráfico "radio aprox. por cantidad de
 * eslabones" (EPS: 3→150, 4→200, 5→260, 6→330 mm…; CUS línea Z: 3→125, 4→210,
 * 5→294, 6→376 mm…, cargado como radio_mm = 294 en las 12 CUS Z, "referencia no
 * especificada"). La regla del operador da radio = ancho (300 mm en 300).
 *
 * DIBUJO: esquemático. Una banda del ancho de la bandeja barriendo θ sobre el
 * polígono de cuerdas; los eslabones no se modelan uno por uno.
 *
 * Marco canónico (el de la CUPS, para que la colocación sea la misma): perfil en
 * el plano XY, extrusión en Z ∈ [−ancho, 0]. Boca P1 en el origen con normal
 * (−1, 0, 0); la curva avanza hacia +X y gira hacia −Y. El sentido (sube/baja)
 * sólo cambia el marco de la boca de entrada (como en la CUPS): con 'sube' su
 * "arriba de sección" es −Y (hacia donde gira); con 'baja', +Y.
 */
import type { GeometryRecipe, PortDef, SentidoVertical } from './outlines';

// La regla numérica (eslabones, cuerdas, longitud de eje) vive en ../reglaEslabones:
// no es geometría y la usan módulos de workspace (cómputo, cambio de ángulo).
export {
  GRADOS_POR_ARTICULACION, ANGULO_ESLABONADA_POR_DEFECTO, ANGULO_ESLABONADA_MIN, ANGULO_ESLABONADA_MAX,
  PROCEDENCIA_ESLABONADA, eslabonesPara, medidasEslabonada, type MedidasEslabonada,
} from '../reglaEslabones';
import { medidasEslabonada, PROCEDENCIA_ESLABONADA } from '../reglaEslabones';

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

const areaFirmada = (p: readonly V2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

export function buildCurvaEslabonadaRecipe(params: { ancho_mm: number; ala_mm: number; angulo_deg: number; sentido: SentidoVertical }): GeometryRecipe {
  const { ancho_mm, ala_mm, angulo_deg } = params;
  const m = medidasEslabonada(ancho_mm, angulo_deg);
  const R = m.radioMm;
  const h = ala_mm / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  // Centro del giro (0, −R); vértice k del polígono de cuerdas en φk = k·α.
  const radial = (phi: number): V2 => [Math.sin(rad(phi)), Math.cos(rad(phi))];
  const punto = (phi: number, r: number): V2 => { const u = radial(phi); return [r * u[0], -R + r * u[1]]; };
  const exterior: V2[] = [];
  const interior: V2[] = [];
  for (let k = 0; k <= m.articulaciones; k++) {
    const phi = k * m.gradosPorArticulacion;
    // En las articulaciones la banda se ingletea (bisectriz = radial); en los extremos, cara plana a la boca.
    const off = k === 0 || k === m.articulaciones ? h : h / Math.cos(rad(m.gradosPorArticulacion / 2));
    exterior.push(punto(phi, R + off));
    interior.push(punto(phi, R - off));
  }
  let polygon: V2[] = [...exterior, ...interior.reverse()];
  if (areaFirmada(polygon) < 0) polygon = polygon.reverse();

  const zc = -ancho_mm / 2;
  const sube = params.sentido === 'sube';
  // Boca de entrada (marco de la CUPS: normal −X; u a lo largo de la extrusión; v "arriba de sección").
  const u1: V3 = sube ? [0, 0, -1] : [0, 0, 1];
  const v1: V3 = sube ? [0, -1, 0] : [0, 1, 0];
  // Rotación −θ alrededor de Z (la que lleva la dirección de avance +X a la de salida).
  const c = Math.cos(rad(angulo_deg));
  const s = Math.sin(rad(angulo_deg));
  const rot = (v: V3): V3 => [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
  const salida = punto(angulo_deg, R);
  const P1: PortDef = { name: 'P1', center: [0, 0, zc], normal: [-1, 0, 0], ancho_mm, ala_mm, u_dir: u1, v_dir: v1, kind: 'operational' };
  const P2: PortDef = {
    name: 'P2',
    center: [salida[0], salida[1], zc],
    normal: rot([1, 0, 0]),
    ancho_mm,
    ala_mm,
    // La sección se transporta con el giro; u se invierte para que u × v = normal exterior.
    u_dir: [-u1[0], -u1[1], -u1[2]],
    v_dir: rot(v1),
    kind: 'operational',
  };
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return {
    extrudeAlongY: false,
    polygon,
    height: ancho_mm,
    translate: [0, 0, -ancho_mm],
    ports: [P1, P2],
    bboxMin: [Math.min(...xs), Math.min(...ys), -ancho_mm],
    bboxMax: [Math.max(...xs), Math.max(...ys), 0],
    notes: [
      `Curva eslabonada esquemática: ${m.eslabones} eslabones, ${m.articulaciones} articulaciones de ${m.gradosPorArticulacion.toFixed(2)}°, radio ${R} mm, eje ${m.longitudEjeMm.toFixed(1)} mm.`,
      `Procedencia: ${PROCEDENCIA_ESLABONADA}.`,
      `Sentido: ${sube ? 'ascendente' : 'descendente'} (cambia sólo el marco de la boca de entrada).`,
    ],
  };
}
