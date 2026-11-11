/**
 * migration — deduce UNA VEZ la pose de piezas de proyectos anteriores (A-10).
 *
 * Usa el mecanismo previo (`verifyGeometricFit`: boca de entrada y mano probando
 * combinaciones, tolerancia 2 mm / 1,5°) y guarda el resultado como colocación.
 * Las piezas que no encajan quedan "sin resolver": conservan sus bocas tal cual,
 * se dibujan con un marcador visible y se informan. No escribe ningún archivo:
 * opera sobre el trazado en memoria (el archivo original no se sobrescribe).
 */
import type { Piece, Product, TrayInput, TrayPort } from '../../tray/model';
import { verifyGeometricFit } from '../parametricBridge';
import { resolveDefinition, withDefinition } from './definitions';
import {
  angleDeg,
  placeDefinition,
  puertosFromWorld,
  type ColocacionSinResolver,
  type Colocacion,
  type V3,
  type StoredDefinition,
} from './placementCore';

export interface MigrationReport {
  readonly total: number;
  readonly resueltas: number;
  readonly sinResolver: ReadonlyArray<{ id: string; producto_id: string; motivo: string }>;
  /** Mayor corrimiento de una boca al pasar a bocas derivadas de la pose. */
  readonly maxDesvioMm: number;
  readonly maxDesvioDeg: number;
}

function lengthFromPiece(piece: Piece): number | null {
  if (typeof piece.longitud_mm === 'number' && piece.longitud_mm > 0) return piece.longitud_mm;
  const p1 = piece.puertos.P1;
  const p2 = piece.puertos.P2;
  if (!p1 || !p2) return null;
  const d = Math.hypot(p2.posicion_mm[0] - p1.posicion_mm[0], p2.posicion_mm[1] - p1.posicion_mm[1], p2.posicion_mm[2] - p1.posicion_mm[2]);
  return d > 0 ? d : null;
}

const unresolved = (motivo: string): ColocacionSinResolver => ({ version: 1, estado: 'sin_resolver', motivo });

/** Tolerancia de posición del motor (D-14). */
const NOMINAL_TOL_MM = 1;

export const MOTIVO_NOMINAL_CATALOGO =
  'proyecto creado con geometría nominal del catálogo; los modelos actuales provienen de medición y difieren ~5 mm';

/** Distancia del punto `p` a la recta que pasa por `o` con dirección `d`. */
function distToAxis(p: readonly number[], o: readonly number[], d: readonly number[]): number {
  const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const c = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]];
  return Math.hypot(c[0], c[1], c[2]) / Math.hypot(d[0], d[1], d[2]);
}

/**
 * ¿Las bocas guardadas reproducen la geometría nominal que se deduce del
 * catálogo? Para curvas horizontales de 90°, T y X con radio interior R y
 * ancho W publicados, el brazo nominal es R + W: la distancia de cada boca al
 * eje de una boca perpendicular. No usa medidas que el catálogo no publique
 * (45° u otros ángulos, radios no declarados → `false`). Solo explica el
 * motivo de una pieza sin resolver; no interviene en la colocación.
 */
export function matchesCatalogNominal(product: Product, piece: Piece): boolean {
  const p = product as unknown as Record<string, unknown>;
  const R = p.radio_mm;
  const W = p.ancho_nominal_mm;
  if (typeof R !== 'number' || typeof W !== 'number' || p.referencia_radio !== 'interior') return false;
  const tipo = product.tipo_pieza;
  const isCurve90 = tipo === 'curva horizontal' && p.angulo_grados === 90;
  if (!isCurve90 && tipo !== 'T' && tipo !== 'X') return false;
  const ports = Object.values(piece.puertos);
  if (ports.length < 2) return false;
  const brazo = R + W;
  for (const a of ports) {
    const perp = ports.filter((b) => b !== a && Math.abs(angleDeg(a.direccion, b.direccion) - 90) <= 1);
    if (perp.length === 0) return false;
    for (const b of perp) {
      if (Math.abs(distToAxis(a.posicion_mm, b.posicion_mm, b.direccion) - brazo) > NOMINAL_TOL_MM) return false;
    }
  }
  return true;
}

/** `true` si alguna pieza no tiene colocación (proyecto anterior o pieza heredada). */
export function needsMigration(entrada: TrayInput | null | undefined): boolean {
  return !!entrada?.piezas.some((p) => !p.colocacion);
}

/**
 * Ajuste genérico por bocas (para definiciones sin receta medida, p. ej. la
 * geometría nominal del catálogo): prueba cada boca guardada como entrada, con
 * mano nativa y espejo, coloca la definición y toma el intento de menor
 * desvío. Misma tolerancia que verifyGeometricFit (2 mm / 1,5°).
 */
function ajustePorBocas(def: StoredDefinition, piece: Piece): { entryPortName: string; chirality: 'native' | 'mirrored'; posErrorMm: number; dirErrorDeg: number; matches: boolean } | null {
  let mejor: { entryPortName: string; chirality: 'native' | 'mirrored'; posErrorMm: number; dirErrorDeg: number; matches: boolean } | null = null;
  for (const nombre of Object.keys(piece.puertos)) {
    const entry = piece.puertos[nombre] as TrayPort;
    if (!def.ports.some((p) => p.name === nombre)) continue;
    for (const mano of ['nativa', 'espejo'] as const) {
      let pl;
      try {
        pl = placeDefinition({
          def, huella: 'ajuste', mano, entryPortName: nombre, startPos: entry.posicion_mm,
          entryDir: (entry.direccion as number[]).map((x) => -x),
          ...(entry.orientacion_seccion_ws ? { sectionUp: entry.orientacion_seccion_ws as V3 } : {}),
        });
      } catch {
        continue;
      }
      let pos = 0;
      let deg = 0;
      for (const wp of pl.ports) {
        const old = piece.puertos[wp.name];
        if (!old) { pos = Infinity; break; }
        pos = Math.max(pos, Math.hypot(wp.pos[0] - old.posicion_mm[0], wp.pos[1] - old.posicion_mm[1], wp.pos[2] - old.posicion_mm[2]));
        deg = Math.max(deg, angleDeg(wp.normal, old.direccion));
      }
      if (!mejor || pos + deg < mejor.posErrorMm + mejor.dirErrorDeg) {
        mejor = { entryPortName: nombre, chirality: mano === 'espejo' ? 'mirrored' : 'native', posErrorMm: pos, dirErrorDeg: deg, matches: pos <= 2 && deg <= 1.5 };
      }
    }
  }
  return mejor;
}

export function migrateTray(
  entrada: TrayInput,
  products: ReadonlyMap<string, Product>,
): { entrada: TrayInput; report: MigrationReport } {
  const defs: Array<[string, Parameters<typeof withDefinition>[2]]> = [];
  const sinResolver: Array<{ id: string; producto_id: string; motivo: string }> = [];
  let resueltas = 0;
  let total = 0;
  let maxDesvioMm = 0;
  let maxDesvioDeg = 0;

  const piezas = entrada.piezas.map((piece) => {
    if (piece.colocacion) return piece;
    total++;
    const fail = (motivo: string): Piece => {
      sinResolver.push({ id: piece.instancia_id, producto_id: piece.producto_id, motivo });
      return { ...piece, colocacion: unresolved(motivo) };
    };
    const product = products.get(piece.producto_id);
    if (!product) return fail('el producto no está en el catálogo');
    const def = resolveDefinition(product, { longitud_mm: lengthFromPiece(piece) });
    if (!def.ok) return fail(def.motivo);
    // Geometría nominal (decisión 2): no hay receta medida para verifyGeometricFit;
    // la pose se deduce probando cada boca como entrada, con las dos manos.
    const fit = def.def.procedencia?.tipo === 'nominal' ? ajustePorBocas(def.def, piece) : verifyGeometricFit(product, piece);
    if (!fit) return fail('las bocas guardadas no corresponden a las del modelo');
    if (!fit.matches) {
      const desvio = `desvío ${fit.posErrorMm.toFixed(1)} mm / ${fit.dirErrorDeg.toFixed(1)}°, tolerancia 2 mm / 1,5°`;
      // Una pieza que reproduce la geometría nominal del catálogo no tiene datos
      // incorrectos: difiere del modelo medido. Todo proyecto anterior lo muestra.
      return fail(matchesCatalogNominal(product, piece)
        ? `${MOTIVO_NOMINAL_CATALOGO} (${desvio})`
        : `no encaja con el modelo vigente (${desvio})`);
    }
    const entry = piece.puertos[fit.entryPortName] as TrayPort | undefined;
    if (!entry) return fail(`falta la boca de entrada ${fit.entryPortName}`);
    let placed;
    try {
      placed = placeDefinition({
        def: def.def,
        huella: def.huella,
        mano: fit.chirality === 'mirrored' ? 'espejo' : 'nativa',
        entryPortName: fit.entryPortName,
        startPos: entry.posicion_mm,
        entryDir: (entry.direccion as number[]).map((x) => -x),
        ...(entry.orientacion_seccion_ws ? { sectionUp: entry.orientacion_seccion_ws as V3 } : {}),
      });
    } catch (e) {
      return fail(`no se pudo deducir la pose: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const wp of placed.ports) {
      const old = piece.puertos[wp.name];
      if (!old) continue;
      maxDesvioMm = Math.max(maxDesvioMm, Math.hypot(wp.pos[0] - old.posicion_mm[0], wp.pos[1] - old.posicion_mm[1], wp.pos[2] - old.posicion_mm[2]));
      maxDesvioDeg = Math.max(maxDesvioDeg, angleDeg(wp.normal, old.direccion));
    }
    defs.push([def.huella, def.def]);
    resueltas++;
    const colocacion: Colocacion = placed.colocacion;
    return { ...piece, colocacion, puertos: puertosFromWorld(placed.ports) };
  });

  let next: TrayInput = { ...entrada, piezas };
  for (const [h, d] of defs) next = withDefinition(next, h, d);
  return { entrada: next, report: { total, resueltas, sinResolver, maxDesvioMm, maxDesvioDeg } };
}
