/**
 * joins — verificación geométrica de uniones (A-7).
 *
 * Una unión entre la boca A y la boca B es válida si:
 *   - distancia entre centros ≤ D-14 posición (1 mm);
 *   - ángulo entre la normal de A y la opuesta de la normal de B ≤ D-14 ángulo (1°);
 *   - ángulo entre las orientaciones transversales (fondo de bandeja hacia arriba)
 *     de A y B ≤ D-14 ángulo (1°), SIN módulo 180° (una sección invertida no une);
 *   - (B-3, cuarta condición) la SECCIÓN coincide:
 *       · ancho de boca: |La − Lb| ≤ tolAnchoMm(La, Lb). El ancho de cada boca
 *         es el de su definición guardada (borde medido del modelo); en una
 *         reducción cada boca tiene el suyo y se compara con su vecina;
 *       · ala: si el catálogo declara alas distintas para las dos piezas, la
 *         unión es inválida. Si declara la misma y la boca del modelo mide otra
 *         cosa, es un AVISO de modelo ("la boca del modelo mide X y el catálogo
 *         declara Y"), no una unión inválida (caso CUPS: 36,56 mm contra 50).
 *     Si falta el dato (pieza sin definición, o sin ala declarada) la condición
 *     se informa "no verificable" (aviso); no se inventa.
 *
 * Las tolerancias de posición y ángulo se leen de `decisiones_producto.json` del
 * motor: el frontend no puede ser más permisivo que el motor.
 *
 * Mezcla de acabados (mezclaAcabados.ts): con el catálogo a mano, una unión entre
 * acabados distintos del mismo tipo de bandeja lleva un AVISO con los dos acabados
 * nombrados y su procedencia. No cambia `ok`: la validez la deciden las cuatro
 * condiciones de arriba.
 */
import decisiones from '../../../vendor/motor_bandejas/datos/decisiones_producto.json';
import type { Piece, Product, TrayInput } from '../../tray/model';
import { mezclaDeAcabados } from '../mezclaAcabados';
import { angleDeg, type V3 } from './placementCore';
import { placedOf } from './definitions';
import { findMasterById, sobreanchoDeBoca } from '../../configurator/masterModels';

const dec = decisiones as Record<string, unknown>;
export const TOL_POS_MM = Number(dec['D-14_tolerancia_posicion_mm']);
export const TOL_ANG_DEG = Number(dec['D-14_tolerancia_angulo_grados']);

/**
 * Desvío relativo máximo entre el ancho MEDIDO de una boca y el ancho nominal
 * del producto, sobre todas las definiciones del catálogo (361 con modelo):
 * 0,3782 % (CPS-45: 1,134 mm en 300 y 2,269 mm en 600; el perfil de la curva
 * 45 escala con el ancho). Redondeado hacia arriba. `anchoBocaJoins.test.ts`
 * lo recalcula sobre el catálogo y falla si algún modelo lo supera.
 */
export const DESVIO_ANCHO_RELATIVO = 0.00379;

/**
 * Tolerancia de ancho entre dos bocas: cada una puede apartarse del nominal
 * hasta DESVIO_ANCHO_RELATIVO, en sentidos opuestos → 2 × r × max(La, Lb)
 * (≈ 2,27 mm en 300). Discrimina: el paso más chico entre anchos nominales
 * del catálogo es 6 mm (44 → 50), y 2 × r × 50 = 0,38 mm (la prueba lo
 * verifica para cada par de anchos consecutivos).
 *
 * Es la ÚNICA regla general. Una familia cuyas bocas miden sistemáticamente más
 * que el nominal (la DCPS lateral: + 1,315 mm) lo declara en su maestro
 * (`sobreanchoBoca`) y se compara contra nominal + ese corrimiento.
 */
export function tolAnchoMm(a: number, b: number): number {
  return 2 * DESVIO_ANCHO_RELATIVO * Math.max(a, b);
}

/**
 * Ala del modelo contra ala declarada: por debajo de la tolerancia de posición
 * de la unión (D-14, 1 mm) la diferencia no se distingue de un error de
 * posición. Las diferencias reales del catálogo son 0 o ≥ 13,44 mm (CUPS/CUS).
 */
export const TOL_ALA_MODELO_MM = TOL_POS_MM;
/** Alas declaradas por el catálogo: números enteros en mm; se comparan exactas. */
const TOL_ALA_CATALOGO_MM = 1e-6;

export interface JoinCheck {
  readonly ok: boolean;
  /** Distancia entre centros (mm). */
  readonly huecoMm: number;
  /** Ángulo entre normal A y −normal B (°). */
  readonly anguloDeg: number;
  /** Giro: ángulo entre orientaciones transversales (°); null si alguna falta. */
  readonly giroDeg: number | null;
  /** Anchos de boca A y B (mm); null si alguno no se conoce. */
  readonly anchosMm: readonly [number, number] | null;
  readonly motivos: string[];
  /** Avisos que no invalidan (giro/sección no verificables, ala del modelo distinta de la declarada). */
  readonly avisos: string[];
}

export interface PortLike {
  posicion_mm: readonly number[];
  direccion: readonly number[];
  orientacion_seccion_ws?: readonly number[];
  /** Sección de la boca según su definición (modelo). */
  ancho_mm?: number;
  ala_mm?: number;
  /** Ala que declara el catálogo para el producto (al colocar la pieza). */
  ala_catalogo_mm?: number;
  /** Sobreancho de boca declarado por la familia (maestro): se descuenta al comparar anchos. */
  sobreancho_mm?: number;
}

const fmt = (x: number) => x.toFixed(2).replace(/\.?0+$/, '');

/** Aviso de modelo para una boca: el ala medida difiere de la declarada. */
export function avisoAlaModelo(alaModelo: number, alaCatalogo: number): string | null {
  return Math.abs(alaModelo - alaCatalogo) > TOL_ALA_MODELO_MM
    ? `la boca del modelo mide ${fmt(alaModelo)} mm de ala y el catálogo declara ${fmt(alaCatalogo)} mm`
    : null;
}

export function checkJoin(a: PortLike, b: PortLike): JoinCheck {
  const d = [0, 1, 2].map((i) => a.posicion_mm[i] - b.posicion_mm[i]);
  const huecoMm = Math.hypot(d[0], d[1], d[2]);
  const anguloDeg = angleDeg(a.direccion, (b.direccion as number[]).map((x) => -x));
  const giroDeg = a.orientacion_seccion_ws && b.orientacion_seccion_ws
    ? angleDeg(a.orientacion_seccion_ws, b.orientacion_seccion_ws)
    : null;
  const motivos: string[] = [];
  if (huecoMm > TOL_POS_MM) motivos.push(`hueco ${huecoMm.toFixed(2)} mm > ${TOL_POS_MM} mm`);
  if (anguloDeg > TOL_ANG_DEG) motivos.push(`ángulo ${anguloDeg.toFixed(2)}° > ${TOL_ANG_DEG}°`);
  const avisos: string[] = [];
  // Una pieza heredada sin orientación transversal guardada (y sin pose) no
  // permite verificar el giro: se informa como "no verificable", no se inventa.
  if (giroDeg === null) avisos.push('giro no verificable: una de las bocas no tiene orientación transversal');
  else if (giroDeg > TOL_ANG_DEG) motivos.push(`giro ${giroDeg.toFixed(2)}° > ${TOL_ANG_DEG}°`);

  // Cuarta condición — ancho.
  const anchosMm = typeof a.ancho_mm === 'number' && typeof b.ancho_mm === 'number' ? [a.ancho_mm, b.ancho_mm] as const : null;
  if (anchosMm === null) avisos.push('ancho no verificable: una de las bocas no tiene definición');
  else {
    // Se descuenta el sobreancho que declara la familia (si lo declara) antes de la regla general.
    const ea = anchosMm[0] - (a.sobreancho_mm ?? 0);
    const eb = anchosMm[1] - (b.sobreancho_mm ?? 0);
    const tol = tolAnchoMm(ea, eb);
    if (Math.abs(ea - eb) > tol) {
      const desc = (L: number, s?: number) => (s ? `${fmt(L)} (− sobreancho ${fmt(s)} de la familia = ${fmt(L - s)})` : fmt(L));
      motivos.push(`ancho de boca ${desc(anchosMm[0], a.sobreancho_mm)} mm ≠ ${desc(anchosMm[1], b.sobreancho_mm)} mm (tolerancia ${fmt(tol)} mm)`);
    }
  }
  // Cuarta condición — ala.
  const catA = a.ala_catalogo_mm;
  const catB = b.ala_catalogo_mm;
  if (typeof catA !== 'number' || typeof catB !== 'number') {
    avisos.push('ala no verificable: el catálogo no declara el ala de una de las piezas');
  } else if (Math.abs(catA - catB) > TOL_ALA_CATALOGO_MM) {
    motivos.push(`alas distintas en el catálogo: ${fmt(catA)} mm ≠ ${fmt(catB)} mm`);
  } else {
    for (const [lado, p] of [['A', a], ['B', b]] as const) {
      const av = typeof p.ala_mm === 'number' ? avisoAlaModelo(p.ala_mm, catA) : null;
      if (av) avisos.push(`ala (boca ${lado}): ${av}`);
    }
  }
  return { ok: motivos.length === 0, huecoMm, anguloDeg, giroDeg, anchosMm, motivos, avisos };
}

/** Sección de una boca: la del modelo (definición guardada) y el ala declarada al colocar. */
export function seccionDeBoca(entrada: TrayInput, piece: Piece, puerto: string): { ancho_mm?: number; ala_mm?: number; ala_catalogo_mm?: number; sobreancho_mm?: number } | null {
  const placed = placedOf(entrada, piece);
  if (!placed) return null;
  const p = placed.def.ports.find((q) => q.name === puerto);
  const cat = placed.colocacion.definicion.params.ala_mm;
  const anchoProd = placed.def.params.ancho_mm;
  const sob = typeof anchoProd === 'number' ? sobreanchoDeBoca(findMasterById(placed.def.patron), anchoProd)?.mm : undefined;
  return {
    ...(p ? { ancho_mm: p.ancho_mm, ala_mm: p.ala_mm } : {}),
    ...(typeof cat === 'number' ? { ala_catalogo_mm: cat } : {}),
    ...(typeof sob === 'number' ? { sobreancho_mm: sob } : {}),
  };
}

/** Boca del trazado con su sección (si la definición la conoce). */
export function bocaConSeccion(entrada: TrayInput, piece: Piece, puerto: string): PortLike | null {
  const port = piece.puertos[puerto];
  if (!port) return null;
  return { ...(port as PortLike), ...(seccionDeBoca(entrada, piece, puerto) ?? {}) };
}

/**
 * Avisos de modelo de una pieza (ficha y Resultados): bocas cuyo ala medida
 * difiere de la que declara el catálogo. No invalidan; la pieza se coloca.
 */
export function avisosDeModelo(entrada: TrayInput | null | undefined, piece: Piece): string[] {
  const placed = placedOf(entrada, piece);
  const cat = placed?.colocacion.definicion.params.ala_mm;
  if (!placed || typeof cat !== 'number') return [];
  const out: string[] = [];
  for (const p of placed.def.ports) {
    const av = avisoAlaModelo(p.ala_mm, cat);
    if (av) out.push(`${p.name}: ${av}`);
  }
  return out;
}

/** Prefijo del aviso de mezcla de acabados en `JoinCheck.avisos`. */
export const AVISO_MEZCLA_PREFIJO = 'mezcla de acabados:';

/**
 * Verifica una conexión del trazado; null si falta alguna pieza o boca. Con el
 * catálogo (`productos`), agrega el aviso de mezcla de acabados si corresponde.
 */
export function checkConnection(entrada: TrayInput, c: { a: [string, string]; b: [string, string] }, productos?: ReadonlyMap<string, Product>): JoinCheck | null {
  const pa = entrada.piezas.find((p) => p.instancia_id === c.a[0]);
  const pb = entrada.piezas.find((p) => p.instancia_id === c.b[0]);
  const A = pa && bocaConSeccion(entrada, pa, c.a[1]);
  const B = pb && bocaConSeccion(entrada, pb, c.b[1]);
  if (!A || !B) return null;
  const r = checkJoin(A, B);
  const m = productos ? mezclaDeAcabados(productos.get(pa!.producto_id), productos.get(pb!.producto_id)) : null;
  return m ? { ...r, avisos: [...r.avisos, m.texto] } : r;
}

/** Conexiones que involucran a `pieceIds` y no cumplen A-7 (o perdieron una boca). */
export function invalidConnections(entrada: TrayInput, pieceIds?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const c of entrada.conexiones) {
    if (pieceIds && !pieceIds.has(c.a[0]) && !pieceIds.has(c.b[0])) continue;
    const r = checkConnection(entrada, c);
    if (!r || !r.ok) out.push(c.conexion_id);
  }
  return out;
}

export function formatJoin(r: JoinCheck): string {
  const ancho = r.anchosMm === null
    ? 'no verificable'
    : Math.abs(r.anchosMm[0] - r.anchosMm[1]) < 0.005 ? `${fmt(r.anchosMm[0])} mm` : `${fmt(r.anchosMm[0])}/${fmt(r.anchosMm[1])} mm`;
  return `hueco ${r.huecoMm.toFixed(2)} mm · ángulo ${r.anguloDeg.toFixed(2)}° · giro ${r.giroDeg === null ? 'no verificable' : `${r.giroDeg.toFixed(2)}°`} · ancho ${ancho}`;
}

export type { V3, Piece };
