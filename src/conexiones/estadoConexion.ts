/**
 * Estado de cada conexión del Excel frente al trazado, y de cada circuito guardado
 * frente al Excel (etapa 1 del encargo de conexiones importadas).
 *
 * Conexión, en este orden (el primero que aplica):
 *   - no-se-traza   — EQUIPOTENCIALIDAD, PUESTA_A_TIERRA, NEUMATICA (se listan, con el motivo);
 *   - trazada / desactualizada — hay un circuito ligado; desactualizada si su recorrido
 *     quedó viejo, si la conexión cambió en el Excel o si cambió el equipo de un extremo;
 *   - sin-resolver  — falta el equipo de un extremo (sin equipoId y sin emparejado manual);
 *   - sin-ubicar    — el equipo existe pero no está ubicado en la escena;
 *   - sin-enlace    — el equipo está en la escena pero no tiene enlace con la bandeja;
 *   - sin-trazar    — se puede trazar.
 * Sólo `sin-trazar` es trazable.
 *
 * Extremo: el equipoId del Excel manda. El emparejado manual sólo cuenta si el Excel
 * no trae equipoId, y se muestra como del operador (nunca como dato del Excel).
 */
import type { TrayInput } from '../tray/model';
import type { EquipmentElement } from '../types/domain-v2';
import type { ConexionImportada, ImportedCatalog, ServicioConexion, TendidoImportado } from '../import/types';
import { circuitosOf, estadoCircuito, type CircuitoGuardado } from '../workspace/recorridos/circuitosGuardados';
import { bajadaDeEquipo } from '../workspace/equipos/bajada';
import { declaradoOf, type RolExtremo } from './declarado';

export const SERVICIOS_TRAZABLES: readonly ServicioConexion[] = ['POTENCIA', 'CONTROL', 'INSTRUMENTACION', 'COMUNICACION'];
export const ORDEN_SERVICIOS: readonly ServicioConexion[] = ['POTENCIA', 'CONTROL', 'INSTRUMENTACION', 'COMUNICACION', 'EQUIPOTENCIALIDAD', 'PUESTA_A_TIERRA', 'NEUMATICA'];

export const MOTIVO_NO_SE_TRAZA: Readonly<Partial<Record<ServicioConexion, string>>> = {
  EQUIPOTENCIALIDAD: 'No se traza en esta versión: la equipotencialidad no es un circuito; el motor arma el PE y sus puntos equipotenciales desde su propia sección (D-20).',
  PUESTA_A_TIERRA: 'No se traza en esta versión: la puesta a tierra no es un circuito; el motor arma el PE desde su propia sección (D-20).',
  NEUMATICA: 'No se traza en esta versión: es un tubo de aire comprimido, no un cable; la bandeja y el motor sólo tratan cables.',
};

export type CodigoEstado = 'no-se-traza' | 'sin-resolver' | 'sin-ubicar' | 'sin-enlace' | 'sin-trazar' | 'trazada' | 'desactualizada';

export const TEXTO_ESTADO: Readonly<Record<CodigoEstado, string>> = {
  'no-se-traza': 'no se traza',
  'sin-resolver': 'equipos sin resolver',
  'sin-ubicar': 'equipo sin ubicar en la escena',
  'sin-enlace': 'equipo sin enlace a bandeja',
  'sin-trazar': 'sin trazar',
  trazada: 'trazada',
  desactualizada: 'desactualizada',
};

export type Extremo =
  | { readonly fuente: 'excel'; readonly equipoId: string; readonly texto: string; readonly elemento: EquipmentElement | null }
  | { readonly fuente: 'operador'; readonly texto: string; readonly elemento: EquipmentElement | null; readonly elementoId: string }
  | { readonly fuente: 'ninguna'; readonly texto: string };

export interface EstadoConexion {
  readonly conexion: ConexionImportada;
  /** Sus tendidos en el Excel actual. */
  readonly tendidos: readonly TendidoImportado[];
  readonly codigo: CodigoEstado;
  readonly motivos: readonly string[];
  readonly origen: Extremo;
  readonly destino: Extremo;
  readonly circuito: CircuitoGuardado | null;
  readonly trazable: boolean;
}

const elementoDeEquipoId = (elements: readonly EquipmentElement[], equipoId: string) =>
  elements.find((e) => e.importedRef?.equipoId === equipoId) ?? elements.find((e) => e.id === equipoId) ?? null;

export function resolverExtremo(c: ConexionImportada, rol: RolExtremo, entrada: TrayInput | null | undefined, elements: readonly EquipmentElement[]): Extremo {
  const equipoId = rol === 'origen' ? c.origenEquipoId : c.destinoEquipoId;
  const texto = (rol === 'origen' ? c.origenTextoOriginal : c.destinoTextoOriginal) ?? '';
  if (equipoId) return { fuente: 'excel', equipoId, texto, elemento: elementoDeEquipoId(elements, equipoId) };
  const manual = declaradoOf(entrada).emparejados[c.conexionId]?.[rol];
  if (manual) return { fuente: 'operador', texto, elementoId: manual.equipo, elemento: elements.find((e) => e.id === manual.equipo) ?? null };
  return { fuente: 'ninguna', texto };
}

/** Campos de la conexión que cambiaron entre lo guardado al trazar y el Excel actual. */
export function camposCambiados(antes: ConexionImportada, ahora: ConexionImportada): Array<{ campo: string; antes: unknown; ahora: unknown }> {
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(ahora)])].sort();
  const out: Array<{ campo: string; antes: unknown; ahora: unknown }> = [];
  for (const k of claves) {
    const a = (antes as unknown as Record<string, unknown>)[k];
    const b = (ahora as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ campo: k, antes: a, ahora: b });
  }
  return out;
}

const valor = (v: unknown) => (v === undefined ? 'sin dato' : String(v));

/** Estado de un circuito guardado frente al Excel: ligado (y si su conexión cambió o ya no está) o fuera del Excel. */
export type RelacionConExcel =
  | { readonly tipo: 'fuera-del-excel' }
  | { readonly tipo: 'ligado'; readonly conexionId: string; readonly motivos: readonly string[]; readonly enElExcel: boolean };

export function relacionConExcel(entrada: TrayInput | null | undefined, catalog: ImportedCatalog | null, c: CircuitoGuardado): RelacionConExcel {
  const v = declaradoOf(entrada).vinculos[c.id];
  if (!v) return { tipo: 'fuera-del-excel' };
  const ahora = catalog?.conexiones.find((x) => x.conexionId === v.conexionId);
  if (!ahora) return { tipo: 'ligado', conexionId: v.conexionId, motivos: [`la conexión ${v.conexionId} ya no está en el Excel`], enElExcel: false };
  const cambios = camposCambiados(v.conexion, ahora);
  const motivos = cambios.length
    ? [`la conexión ${v.conexionId} cambió en el Excel: ${cambios.map((x) => `${x.campo} (${valor(x.antes)} → ${valor(x.ahora)})`).join('; ')}`]
    : [];
  // Tendidos (etapa 2): sólo si el vínculo los guardó al trazar.
  if (v.tendidos) {
    const ahoraT = (catalog?.tendidos ?? []).filter((t) => t.conexionId === v.conexionId);
    const antes = new Map(v.tendidos.map((t) => [t.tendidoId, t]));
    const hoy = new Map(ahoraT.map((t) => [t.tendidoId, t]));
    for (const [id, t] of antes) {
      const n = hoy.get(id);
      if (!n) { motivos.push(`el tendido ${id} ya no está en el Excel`); continue; }
      const c = camposCambiados(t as unknown as ConexionImportada, n as unknown as ConexionImportada);
      if (c.length) motivos.push(`el tendido ${id} cambió en el Excel: ${c.map((x) => `${x.campo} (${valor(x.antes)} → ${valor(x.ahora)})`).join('; ')}`);
    }
    for (const id of hoy.keys()) if (!antes.has(id)) motivos.push(`el Excel suma el tendido ${id}`);
  }
  return { tipo: 'ligado', conexionId: v.conexionId, enElExcel: true, motivos };
}

const idEquipo = (x: Extremo) => (x.fuente === 'excel' ? x.elemento?.id ?? null : x.fuente === 'operador' ? x.elementoId : null);
const textoExtremo = (rol: RolExtremo, x: Extremo) => `${rol} «${x.texto || 'sin texto'}»`;

export function estadosDeConexiones(catalog: ImportedCatalog | null, entrada: TrayInput | null | undefined, elements: readonly EquipmentElement[]): EstadoConexion[] {
  if (!catalog) return [];
  const circuitos = circuitosOf(entrada);
  const vinculos = declaradoOf(entrada).vinculos;
  const circuitoDe = new Map<string, CircuitoGuardado>();
  for (const c of circuitos) {
    const v = vinculos[c.id];
    if (v && !circuitoDe.has(v.conexionId)) circuitoDe.set(v.conexionId, c);
  }
  return catalog.conexiones.map((cx): EstadoConexion => {
    const origen = resolverExtremo(cx, 'origen', entrada, elements);
    const destino = resolverExtremo(cx, 'destino', entrada, elements);
    const circuito = circuitoDe.get(cx.conexionId) ?? null;
    const tendidos = catalog.tendidos.filter((t) => t.conexionId === cx.conexionId);
    const base = { conexion: cx, tendidos, origen, destino, circuito };
    const motivoNo = MOTIVO_NO_SE_TRAZA[cx.servicio];
    if (motivoNo) return { ...base, codigo: 'no-se-traza', motivos: [motivoNo], trazable: false };

    if (circuito && entrada) {
      const motivos: string[] = [];
      const est = estadoCircuito(entrada, elements, circuito);
      if (!est.vigente) motivos.push(...est.motivos);
      const rel = relacionConExcel(entrada, catalog, circuito);
      if (rel.tipo === 'ligado') motivos.push(...rel.motivos);
      for (const [rol, x, guardado] of [['origen', origen, circuito.origen.equipo], ['destino', destino, circuito.destino.equipo]] as const) {
        const id = idEquipo(x);
        if (id !== guardado) motivos.push(`el equipo de ${rol} ya no es el del circuito (${guardado} → ${id ?? 'sin resolver'})`);
      }
      return { ...base, codigo: motivos.length ? 'desactualizada' : 'trazada', motivos, trazable: false };
    }

    const sinResolver = (['origen', 'destino'] as const).flatMap((rol) => {
      const x = rol === 'origen' ? origen : destino;
      if (x.fuente === 'ninguna') return [`el Excel no trae el equipo de ${textoExtremo(rol, x)}: emparejalo a mano`];
      if (x.fuente === 'operador' && !x.elemento) return [`el equipo emparejado a mano para el ${rol} (${x.elementoId}) ya no está en el proyecto`];
      return [];
    });
    if (sinResolver.length) return { ...base, codigo: 'sin-resolver', motivos: sinResolver, trazable: false };

    const sinUbicar = (['origen', 'destino'] as const).flatMap((rol) => {
      const x = rol === 'origen' ? origen : destino;
      if (x.fuente !== 'excel') return [];
      if (!x.elemento) return [`el equipo de ${rol} (${x.equipoId} «${x.texto}») no está en la escena: ubicalo en la etapa Equipos`];
      if (x.elemento.placementStatus !== 'placed') return [`el equipo de ${rol} (${x.elemento.name}) no está ubicado en la escena`];
      return [];
    });
    if (sinUbicar.length) return { ...base, codigo: 'sin-ubicar', motivos: sinUbicar, trazable: false };

    const ids = [idEquipo(origen)!, idEquipo(destino)!];
    if (ids[0] === ids[1]) return { ...base, codigo: 'sin-resolver', motivos: ['origen y destino son el mismo equipo'], trazable: false };
    const sinEnlace = (['origen', 'destino'] as const).flatMap((rol, i) => {
      if (bajadaDeEquipo(entrada, ids[i])) return [];
      const x = rol === 'origen' ? origen : destino;
      const nombre = x.fuente === 'ninguna' ? x.texto : x.elemento?.name ?? ids[i];
      return [`el equipo de ${rol} (${nombre}) no tiene enlace con la bandeja`];
    });
    if (sinEnlace.length) return { ...base, codigo: 'sin-enlace', motivos: sinEnlace, trazable: false };

    return { ...base, codigo: 'sin-trazar', motivos: [], trazable: true };
  });
}

/** Ids de equipo (elementos de la escena) de una conexión trazable. */
export function equiposDe(e: EstadoConexion): { origen: string; destino: string } | null {
  if (!e.trazable) return null;
  const o = idEquipo(e.origen);
  const d = idEquipo(e.destino);
  return o && d ? { origen: o, destino: d } : null;
}
