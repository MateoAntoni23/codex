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

/** `true` si alguna pieza no tiene colocación (proyecto anterior o pieza heredada). */
export function needsMigration(entrada: TrayInput | null | undefined): boolean {
  return !!entrada?.piezas.some((p) => !p.colocacion);
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
    const fit = verifyGeometricFit(product, piece);
    if (!fit) return fail('las bocas guardadas no corresponden a las del modelo');
    if (!fit.matches) {
      return fail(`no encaja con el modelo vigente (desvío ${fit.posErrorMm.toFixed(1)} mm / ${fit.dirErrorDeg.toFixed(1)}°, tolerancia 2 mm / 1,5°)`);
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
