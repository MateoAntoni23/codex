/**
 * Longitudes de eje de una pieza, calculadas AL COLOCARLA desde su definición
 * (modelo medido) con una regla declarada, y persistidas en la colocación.
 * `recorridos/caminoEntreBocas.ts` sólo suma lo persistido: no llama a esto.
 *
 * Reglas (una por familia; sin regla → null con motivo, nunca un valor inventado):
 *
 *   - CURVA ESLABONADA (master:perforada:curva_eslabonada, EPS, y
 *     master:escalera:curva_eslabonada, CUS): el POLÍGONO REAL de N−1 cuerdas
 *     sobre radio = ancho (regla declarada por el operador; no el arco). Se
 *     exige que la cadena de cuerdas termine en los centros de las bocas.
 *
 *   - CURVA VERTICAL (patrones master:perforada:curva_vertical_interior y
 *     master:perforada:curva_vertical_exterior, construidos con el perfil medido
 *     de la CUPS-300-A-Z; la CUS ya no, ver curvaEslabonada.ts):
 *     longitud de la LÍNEA MEDIA DEL PERFIL — promedio de los vértices
 *     homólogos de la pared exterior y la interior (`lineaMediaPerfilCUPS`).
 *     Se exige que sus extremos coincidan con los centros de las bocas de la
 *     definición (TOL_EXTREMO_MM); si no, no se guarda.
 *
 *   - T y X (definiciones de 3 o 4 bocas): entrada → centro → salida, los dos
 *     semiejes. CENTRO = punto más cercano (mínimos cuadrados) a los ejes de
 *     todas las bocas (recta por el centro de cada boca según su normal). Se
 *     exige que ese punto quede a ≤ TOL_POS_MM (D-14, 1 mm) de cada eje; si no,
 *     no hay centro común y no se guarda. Semieje = distancia del centro de la
 *     boca al centro de la pieza.
 *
 * Las curvas horizontales ya guardan `longitud_eje_mm` al colocarse (arco de la
 * cuerda medida y el ángulo del catálogo; ver `workspaceOperation.planAddCurve`)
 * y los tramos rectos su `longitud_mm`: no pasan por acá.
 */
import { lineaMediaPerfilCUPS } from '../../parametric/geometry/outlines';
import { medidasEslabonada, PROCEDENCIA_ESLABONADA } from '../../parametric/geometry/curvaEslabonada';
import type { StoredDefinition } from './placementCore';
import decisiones from '../../../vendor/motor_bandejas/datos/decisiones_producto.json';

/** D-14 (posición), leído del motor como en `joins.ts` (sin importarlo: evita un ciclo con definitions). */
const TOL_POS_MM = Number((decisiones as Record<string, unknown>)['D-14_tolerancia_posicion_mm']);

export interface LongitudTramo {
  /** Longitud de eje entre las dos bocas (mm). */
  readonly mm: number;
  readonly regla: 'linea_media_perfil' | 'semiejes_centro' | 'profundidad_derivacion' | 'poligono_eslabones';
  /** De dónde sale: modelo/patrón y cómo se obtuvo el centro o el eje. */
  readonly procedencia: string;
}

/** Longitudes por par de bocas; clave `claveTramo(a, b)` (independiente del orden). */
export type LongitudesEje = Readonly<Record<string, LongitudTramo>>;

export const claveTramo = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const PATRONES_CURVA_VERTICAL: ReadonlySet<string> = new Set([
  'master:perforada:curva_vertical_interior',
  'master:perforada:curva_vertical_exterior',
]);

export const PATRONES_CURVA_ESLABONADA: ReadonlySet<string> = new Set([
  'master:perforada:curva_eslabonada',
  'master:escalera:curva_eslabonada',
]);

/** Extremos de la línea media contra centros de boca: redondeo de la transcripción (0,01 mm). */
export const TOL_EXTREMO_MM = 0.01;

type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);

/** Distancia de un punto a la recta (c, n). */
function distARecta(p: V3, c: V3, n: V3): number {
  const d = sub(p, c);
  const t = dot(d, n) / dot(n, n);
  return len([d[0] - t * n[0], d[1] - t * n[1], d[2] - t * n[2]]);
}

/** Punto más cercano (mínimos cuadrados) a un conjunto de rectas; null si son paralelas. */
export function centroDeEjes(ejes: ReadonlyArray<{ c: V3; n: V3 }>): [number, number, number] | null {
  // Σ (I − n̂n̂ᵀ) x = Σ (I − n̂n̂ᵀ) c
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (const { c, n } of ejes) {
    const L = len(n);
    const u = [n[0] / L, n[1] / L, n[2] / L];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const m = (i === j ? 1 : 0) - u[i] * u[j];
        A[i][j] += m;
        b[i] += m * c[j];
      }
    }
  }
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  const col = (k: number) => A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

/**
 * Lo que se persiste al colocar: la pieza con `colocacion.longitudes_eje` (y
 * `longitud_eje_mm` si es de dos bocas) cuando la definición tiene regla. Sin
 * regla, la pieza vuelve igual. Es la función que usa la colocación real
 * (`workspaceOperation.pieceFromPlacement`).
 */
export function conLongitudesEje<P extends { longitud_eje_mm?: number; colocacion?: unknown }>(piece: P, def: StoredDefinition): P {
  const l = longitudesDeEje(def);
  const col = piece.colocacion as { estado?: string } | undefined;
  if (!l.ok || col?.estado !== 'resuelta') return piece;
  const tramos = Object.values(l.longitudes);
  return {
    ...piece,
    ...(def.ports.length === 2 && tramos.length === 1 && piece.longitud_eje_mm === undefined ? { longitud_eje_mm: tramos[0].mm } : {}),
    colocacion: { ...col, longitudes_eje: l.longitudes },
  };
}

export type ResultadoLongitudes = { ok: true; longitudes: LongitudesEje } | { ok: false; motivo: string };

export function longitudesDeEje(def: StoredDefinition): ResultadoLongitudes {
  const ports = def.ports;
  if (PATRONES_CURVA_ESLABONADA.has(def.patron)) {
    const ancho = def.params.ancho_mm;
    const ang = def.params.angulo_deg;
    const p1 = ports.find((p) => p.name === 'P1');
    const p2 = ports.find((p) => p.name === 'P2');
    if (typeof ancho !== 'number' || typeof ang !== 'number' || !p1 || !p2) return { ok: false, motivo: 'curva eslabonada sin ancho, ángulo o bocas P1/P2' };
    const m = medidasEslabonada(ancho, ang);
    // La cadena de cuerdas tiene que unir los centros de las bocas: la cuerda total P1→P2 es 2R·sen(θ/2).
    const directa = len(sub(p2.center as V3, p1.center as V3));
    const esperada = 2 * m.radioMm * Math.sin((ang * Math.PI) / 360);
    if (Math.abs(directa - esperada) > TOL_EXTREMO_MM) {
      return { ok: false, motivo: `las bocas no están sobre el giro de radio ${m.radioMm} mm (desvío ${Math.abs(directa - esperada).toFixed(3)} mm)` };
    }
    return {
      ok: true,
      longitudes: {
        [claveTramo('P1', 'P2')]: {
          mm: m.longitudEjeMm,
          regla: 'poligono_eslabones',
          procedencia: `${m.eslabones} eslabones: ${m.articulaciones} cuerdas de ${m.gradosPorArticulacion.toFixed(2)}° sobre radio ${m.radioMm} mm (patrón ${def.patron}; ${PROCEDENCIA_ESLABONADA})`,
        },
      },
    };
  }
  if (PATRONES_CURVA_VERTICAL.has(def.patron)) {
    if (ports.length !== 2) return { ok: false, motivo: `curva vertical con ${ports.length} bocas` };
    const { puntos, longitud_mm } = lineaMediaPerfilCUPS();
    const ini = puntos[0];
    const fin = puntos[puntos.length - 1];
    const h = ports.find((p) => p.name === 'P1_horizontal');
    const v = ports.find((p) => p.name === 'P2_vertical');
    if (!h || !v) return { ok: false, motivo: 'curva vertical sin las bocas P1_horizontal y P2_vertical' };
    const desvio = Math.max(Math.hypot(h.center[0] - ini[0], h.center[1] - ini[1]), Math.hypot(v.center[0] - fin[0], v.center[1] - fin[1]));
    if (desvio > TOL_EXTREMO_MM) {
      return { ok: false, motivo: `la línea media del perfil no termina en los centros de las bocas (desvío ${desvio.toFixed(3)} mm)` };
    }
    return {
      ok: true,
      longitudes: {
        [claveTramo(h.name, v.name)]: {
          mm: longitud_mm,
          regla: 'linea_media_perfil',
          procedencia: `modelo medido (perfil del STEP CUPS-300-A-Z, patrón ${def.patron}): línea media del canal entre las dos bocas`,
        },
      },
    };
  }
  if (ports.length === 3 || ports.length === 4) {
    const ejes = ports.map((p) => ({ c: p.center as V3, n: p.normal as V3 }));
    const C = centroDeEjes(ejes);
    if (!C) return { ok: false, motivo: 'los ejes de las bocas son paralelos: no hay centro de pieza' };
    const desvio = Math.max(...ejes.map((e) => distARecta(C, e.c, e.n)));
    if (desvio > TOL_POS_MM) {
      return { ok: false, motivo: `los ejes de las bocas no se cruzan en un punto (desvío ${desvio.toFixed(2)} mm > ${TOL_POS_MM} mm)` };
    }
    const semieje = new Map(ports.map((p) => [p.name, len(sub(p.center as V3, C))]));
    const procedencia = `modelo medido (patrón ${def.patron}): centro = punto común a los ejes de las ${ports.length} bocas (desvío ${desvio.toFixed(3)} mm); semiejes desde el centro de cada boca`;
    const longitudes: Record<string, LongitudTramo> = {};
    for (let i = 0; i < ports.length; i++) {
      for (let j = i + 1; j < ports.length; j++) {
        longitudes[claveTramo(ports[i].name, ports[j].name)] = {
          mm: semieje.get(ports[i].name)! + semieje.get(ports[j].name)!,
          regla: 'semiejes_centro',
          procedencia,
        };
      }
    }
    return { ok: true, longitudes };
  }
  return { ok: false, motivo: `sin regla de longitud de eje para el patrón ${def.patron}` };
}
