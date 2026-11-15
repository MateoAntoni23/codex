/**
 * Trazar una conexión del Excel: crea el circuito guardado de equipo a equipo con el
 * camino que ya existe (`guardarCircuito`), con origen y destino resueltos, id
 * `CIR-<conexionId>`, y lo liga a la conexión (vínculo declarado, aparte de lo
 * importado). Retrazar recalcula el recorrido con los equipos de ahora y toma la
 * conexión como está ahora en el Excel. Nada se hace solo.
 */
import type { TrayInput } from '../tray/model';
import type { EquipmentElement } from '../types/domain-v2';
import type { ImportedCatalog } from '../import/types';
import { guardarCircuito, recalcularCircuito } from '../workspace/recorridos/circuitosGuardados';
import { declaradoOf, idCircuitoDeConexion, vincular } from './declarado';
import { equiposDe, estadosDeConexiones, resolverExtremo, type EstadoConexion } from './estadoConexion';

export const nombreDeCircuito = (e: EstadoConexion) => e.conexion.circuitoTag?.trim() || e.conexion.conexionId;

export function trazarConexion(entrada: TrayInput, elements: readonly EquipmentElement[], e: EstadoConexion):
  { ok: true; entrada: TrayInput; circuitoId: string } | { ok: false; motivo: string } {
  const eq = equiposDe(e);
  if (!eq) return { ok: false, motivo: `no se puede trazar: ${e.motivos.join('; ') || 'la conexión no es trazable'}` };
  const id = idCircuitoDeConexion(e.conexion.conexionId);
  let nombre = nombreDeCircuito(e);
  let r = guardarCircuito(entrada, elements, nombre, { equipo: eq.origen }, { equipo: eq.destino }, undefined, undefined, id);
  if (!r.ok && /ya hay un circuito llamado/.test(r.motivo)) {
    nombre = `${nombre} (${e.conexion.conexionId})`;
    r = guardarCircuito(entrada, elements, nombre, { equipo: eq.origen }, { equipo: eq.destino }, undefined, undefined, id);
  }
  if (!r.ok) return r;
  return { ok: true, entrada: vincular(r.entrada, id, e.conexion, e.tendidos), circuitoId: id };
}

export function retrazarConexion(entrada: TrayInput, elements: readonly EquipmentElement[], e: EstadoConexion):
  { ok: true; entrada: TrayInput } | { ok: false; motivo: string } {
  if (!e.circuito) return { ok: false, motivo: 'la conexión no tiene circuito' };
  const ids = (['origen', 'destino'] as const).map((rol) => {
    const x = resolverExtremo(e.conexion, rol, entrada, elements);
    return x.fuente === 'excel' ? x.elemento?.id ?? null : x.fuente === 'operador' ? x.elementoId : null;
  });
  if (!ids[0] || !ids[1]) return { ok: false, motivo: 'falta resolver un equipo de la conexión' };
  const r = recalcularCircuito(entrada, elements, e.circuito.id, { origen: { equipo: ids[0] }, destino: { equipo: ids[1] } });
  if (!r.ok) return r;
  return { ok: true, entrada: vincular(r.entrada, e.circuito.id, e.conexion, e.tendidos) };
}

/**
 * «Recalcular» de la tabla de circuitos: un circuito ligado a una conexión que sigue en
 * el Excel se retraza (equipos y conexión de ahora); uno fuera del Excel, o cuya
 * conexión ya no está, se recalcula como siempre (y sigue marcado).
 */
export function recalcularConExcel(entrada: TrayInput, elements: readonly EquipmentElement[], catalog: ImportedCatalog | null, id: string):
  { ok: true; entrada: TrayInput } | { ok: false; motivo: string } {
  const v = declaradoOf(entrada).vinculos[id];
  const e = v ? estadosDeConexiones(catalog, entrada, elements).find((x) => x.conexion.conexionId === v.conexionId && x.circuito?.id === id) : undefined;
  return e ? retrazarConexion(entrada, elements, e) : recalcularCircuito(entrada, elements, id);
}
