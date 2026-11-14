/**
 * CURVA AJUSTABLE de escalera — CAS-{ancho}-{ala}-{espesor}-{G|Z}, tipo_pieza
 * «curva horizontal» (giro a izquierda o derecha visto desde arriba). Ángulo por
 * instancia. Regla del operador en ../reglaCurvaAjustable.ts (radio interior =
 * ancho, eje = 1,5 × ancho, rango 1°–90° provisional); el catálogo no declara
 * ángulo ni radio.
 *
 * DIBUJO esquemático, como las eslabonadas: una banda curva del ancho de la
 * bandeja (entre el radio interior y el exterior) barriendo el ángulo, con el
 * alto del ala. No es un modelo medido.
 *
 * Marco canónico, el de las curvas planas de escalera (CS): polígono en el plano
 * XZ (planta), extruido en Y ∈ [0, ala]. Centro del giro en el origen. Boca P1 en
 * φ = 0 sobre el eje (R_eje, ala/2, 0), normal exterior (0, 0, −1): la pieza
 * avanza hacia +Z y gira alrededor del centro. P2 = P1 girada θ alrededor del
 * centro, normal = la dirección de avance a θ. Bocas con la convención de
 * `portOnEdge` (u = (n_z, 0, −n_x), v = +Y). La otra mano (giro al otro lado) es
 * la definición espejada, como en cualquier pieza asimétrica.
 */
import type { GeometryRecipe, PortDef } from './outlines';
import { medidasCurvaAjustable, PROCEDENCIA_CURVA_AJUSTABLE } from '../reglaCurvaAjustable';

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

const areaFirmada = (p: readonly V2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/** Paso máximo del barrido al dibujar el arco (grados). */
const PASO_DIBUJO_DEG = 3;

function boca(name: string, centro: V3, normal: V3, ancho_mm: number, ala_mm: number): PortDef {
  return {
    name,
    center: centro,
    normal,
    ancho_mm,
    ala_mm,
    u_dir: [normal[2], 0, -normal[0]],
    v_dir: [0, 1, 0],
    kind: 'operational',
  };
}

export function buildCurvaAjustableRecipe(params: { ancho_mm: number; ala_mm: number; angulo_deg: number }): GeometryRecipe {
  const { ancho_mm, ala_mm, angulo_deg } = params;
  const m = medidasCurvaAjustable(ancho_mm, angulo_deg);
  const rad = (d: number) => (d * Math.PI) / 180;
  const punto = (phi: number, r: number): V2 => [r * Math.cos(rad(phi)), r * Math.sin(rad(phi))];
  const pasos = Math.max(2, Math.ceil(angulo_deg / PASO_DIBUJO_DEG));
  const exterior: V2[] = [];
  const interior: V2[] = [];
  for (let k = 0; k <= pasos; k++) {
    const phi = (angulo_deg * k) / pasos;
    exterior.push(punto(phi, m.radioExteriorMm));
    interior.push(punto(phi, m.radioInteriorMm));
  }
  let polygon: V2[] = [...exterior, ...interior.reverse()];
  // Misma orientación que los contornos de las CS (área positiva en x, z).
  if (areaFirmada(polygon) < 0) polygon = polygon.reverse();

  const h = ala_mm / 2;
  const c = Math.cos(rad(angulo_deg));
  const s = Math.sin(rad(angulo_deg));
  const P1 = boca('P1', [m.radioEjeMm, h, 0], [0, 0, -1], ancho_mm, ala_mm);
  const P2 = boca('P2', [m.radioEjeMm * c, h, m.radioEjeMm * s], [-s, 0, c], ancho_mm, ala_mm);
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  return {
    extrudeAlongY: true,
    polygon,
    height: ala_mm,
    translate: [0, 0, 0],
    ports: [P1, P2],
    bboxMin: [Math.min(...xs), 0, Math.min(...zs)],
    bboxMax: [Math.max(...xs), ala_mm, Math.max(...zs)],
    notes: [
      `Curva ajustable esquemática: ${angulo_deg}°, radio interior ${m.radioInteriorMm} mm, eje ${m.radioEjeMm} mm, exterior ${m.radioExteriorMm} mm; longitud de eje ${m.longitudEjeMm.toFixed(1)} mm (arco).`,
      `Procedencia: ${PROCEDENCIA_CURVA_AJUSTABLE}.`,
    ],
  };
}
