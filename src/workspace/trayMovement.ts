// Movimiento geométrico de piezas de bandeja. Helpers puros — no tocan el store.
//
// Modelo: una pieza no tiene transform propio; su posición está codificada en
// las posiciones globales mm de sus puertos. "Mover" una pieza = trasladar
// TODOS sus puertos por el mismo delta (dirección de cada boca no cambia).
//
// Las conexiones no guardan geometría; se expresan como (pieza_a, puerto_a) ↔
// (pieza_b, puerto_b). Una conexión queda "rota" cuando las posiciones de sus
// dos puertos dejan de coincidir dentro de una tolerancia pequeña. Por
// convenio usamos 1 mm — compatible con `assertInput` del motor, que valida
// unitariedad de direcciones pero no coincidencia de posiciones.

import type { Point, TrayInput, Piece } from '../tray/model';

/** Centroide geométrico (mm) = promedio de las posiciones de sus puertos. */
export function pieceCentroid(piece: Piece): Point {
  const ports = Object.values(piece.puertos);
  if (ports.length === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  for (const port of ports) {
    sx += port.posicion_mm[0];
    sy += port.posicion_mm[1];
    sz += port.posicion_mm[2];
  }
  return [sx / ports.length, sy / ports.length, sz / ports.length];
}

/**
 * Devuelve una nueva TrayInput con TODOS los puertos de `piezaId` desplazados
 * por `delta` (mm). Dirección de cada boca intacta. Non-mutating.
 */
export function translatePiece(
  entrada: TrayInput,
  piezaId: string,
  delta: readonly [number, number, number],
): TrayInput {
  const next = structuredClone(entrada);
  const piece = next.piezas.find((p) => p.instancia_id === piezaId);
  if (!piece) return next;
  for (const port of Object.values(piece.puertos)) {
    port.posicion_mm[0] += delta[0];
    port.posicion_mm[1] += delta[1];
    port.posicion_mm[2] += delta[2];
  }
  return next;
}

/**
 * Coloca el centroide de `piezaId` en `targetCentroid` (mm) desplazando todos
 * sus puertos por la diferencia respecto al centroide actual. Non-mutating.
 */
export function placePieceCentroid(
  entrada: TrayInput,
  piezaId: string,
  targetCentroid: readonly [number, number, number],
): TrayInput {
  const piece = entrada.piezas.find((p) => p.instancia_id === piezaId);
  if (!piece) return entrada;
  const c = pieceCentroid(piece);
  return translatePiece(entrada, piezaId, [
    targetCentroid[0] - c[0],
    targetCentroid[1] - c[1],
    targetCentroid[2] - c[2],
  ]);
}

/** Tolerancia por defecto para considerar "unión conservada" (1 mm). */
export const DEFAULT_COINCIDENCE_TOLERANCE_MM = 1;

/**
 * Lista las conexiones que involucran a `piezaId` cuya coincidencia geométrica
 * se perdió: los dos puertos están a > toleranceMm de distancia. Las
 * conexiones cuyos puertos ya no existen (porque la pieza contraparte
 * desapareció) también se reportan como rotas.
 *
 * No muta entrada. Se puede usar sobre el estado DESPUÉS de trasladar la pieza
 * para saber qué conexiones quedarían desalineadas si confirmáramos el
 * movimiento.
 */
export function findBrokenConnections(
  entrada: TrayInput,
  piezaId: string,
  toleranceMm = DEFAULT_COINCIDENCE_TOLERANCE_MM,
): string[] {
  const tol2 = toleranceMm * toleranceMm;
  const broken: string[] = [];
  for (const conn of entrada.conexiones) {
    if (conn.a[0] !== piezaId && conn.b[0] !== piezaId) continue;
    const pa = entrada.piezas.find((p) => p.instancia_id === conn.a[0]);
    const pb = entrada.piezas.find((p) => p.instancia_id === conn.b[0]);
    const portA = pa?.puertos[conn.a[1]];
    const portB = pb?.puertos[conn.b[1]];
    if (!portA || !portB) {
      broken.push(conn.conexion_id);
      continue;
    }
    const dx = portA.posicion_mm[0] - portB.posicion_mm[0];
    const dy = portA.posicion_mm[1] - portB.posicion_mm[1];
    const dz = portA.posicion_mm[2] - portB.posicion_mm[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > tol2) broken.push(conn.conexion_id);
  }
  return broken;
}

/** Devuelve una nueva TrayInput sin las conexiones listadas. Non-mutating. */
export function removeConnections(entrada: TrayInput, conexionIds: readonly string[]): TrayInput {
  if (conexionIds.length === 0) return entrada;
  const drop = new Set(conexionIds);
  const next = structuredClone(entrada);
  next.conexiones = next.conexiones.filter((c) => !drop.has(c.conexion_id));
  return next;
}
