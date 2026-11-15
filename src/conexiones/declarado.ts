/**
 * Lo que el operador DECLARA sobre las conexiones del Excel, guardado APARTE de lo
 * importado (encargo de conexiones importadas, 2026-11-15).
 *
 * Dónde: clave `conexiones_ws` del trazado (workspace-only: nunca viaja al motor,
 * ver `WS_ONLY` en `tray/store.ts`). No va dentro de `importedCatalog` (lo importado
 * es la fuente y no se toca) ni dentro de cada circuito: `recalcularCircuito` de una
 * app anterior rearma el circuito y sólo conserva `cable`, así que un campo nuevo
 * del circuito se perdería en silencio. Un bloque nuevo del archivo de proyecto
 * también: la app anterior lo descartaría al guardar. Una clave desconocida del
 * trazado, en cambio, la app anterior la conserva (todas sus ediciones copian la
 * entrada con `...entrada`). Sin subir la versión del archivo.
 *
 * Qué guarda, con su procedencia (`operador`) y fecha:
 *   - `emparejados`: el equipo de la escena que el operador asignó a un extremo que el
 *     Excel no resuelve (sin equipoId). No modifica la conexión importada.
 *   - `vinculos`: qué circuito guardado traza qué conexión, con la conexión tal como
 *     estaba al trazar (para decir qué cambió al reimportar). Los circuitos ligados se
 *     llaman `CIR-<conexionId>`: una app anterior numera `CIR-<n>` y nunca reusa ese
 *     id para otro circuito, así que un vínculo no puede quedar pegado a otro.
 * Todo se indexa por ids del Excel: sobrevive a una reimportación.
 */
import type { TrayInput } from '../tray/model';
import type { ConexionImportada } from '../import/types';

export const DECLARADO_KEY = 'conexiones_ws';
export const PROCEDENCIA_OPERADOR = 'operador' as const;

export type RolExtremo = 'origen' | 'destino';

export interface EmparejadoManual {
  /** Elemento de la escena elegido por el operador. */
  readonly equipo: string;
  readonly procedencia: typeof PROCEDENCIA_OPERADOR;
  readonly declarado_iso: string;
}

export interface VinculoCircuito {
  readonly conexionId: string;
  /** La conexión del Excel tal como estaba al trazar. */
  readonly conexion: ConexionImportada;
  readonly procedencia: typeof PROCEDENCIA_OPERADOR;
  readonly vinculado_iso: string;
}

export interface DeclaradoConexiones {
  readonly version: 1;
  readonly emparejados: Readonly<Record<string, Partial<Record<RolExtremo, EmparejadoManual>>>>;
  /** Por id de circuito. */
  readonly vinculos: Readonly<Record<string, VinculoCircuito>>;
}

const VACIO: DeclaradoConexiones = { version: 1, emparejados: {}, vinculos: {} };
const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function declaradoOf(entrada: TrayInput | null | undefined): DeclaradoConexiones {
  const d = (entrada as Record<string, unknown> | null | undefined)?.[DECLARADO_KEY];
  if (!esObj(d) || d.version !== 1) return VACIO;
  return {
    version: 1,
    emparejados: esObj(d.emparejados) ? (d.emparejados as DeclaradoConexiones['emparejados']) : {},
    vinculos: esObj(d.vinculos) ? (d.vinculos as DeclaradoConexiones['vinculos']) : {},
  };
}

export function conDeclarado(entrada: TrayInput, d: DeclaradoConexiones): TrayInput {
  return { ...entrada, [DECLARADO_KEY]: d } as TrayInput;
}

export const idCircuitoDeConexion = (conexionId: string) => `CIR-${conexionId}`;

export function emparejar(entrada: TrayInput, conexionId: string, rol: RolExtremo, equipo: string | null): TrayInput {
  const d = declaradoOf(entrada);
  const actual = { ...(d.emparejados[conexionId] ?? {}) };
  if (equipo) actual[rol] = { equipo, procedencia: PROCEDENCIA_OPERADOR, declarado_iso: new Date().toISOString() };
  else delete actual[rol];
  const emparejados = { ...d.emparejados };
  if (Object.keys(actual).length) emparejados[conexionId] = actual;
  else delete emparejados[conexionId];
  return conDeclarado(entrada, { ...d, emparejados });
}

export function vincular(entrada: TrayInput, circuitoId: string, conexion: ConexionImportada): TrayInput {
  const d = declaradoOf(entrada);
  return conDeclarado(entrada, {
    ...d,
    vinculos: { ...d.vinculos, [circuitoId]: { conexionId: conexion.conexionId, conexion: structuredClone(conexion), procedencia: PROCEDENCIA_OPERADOR, vinculado_iso: new Date().toISOString() } },
  });
}

/** Al borrar un circuito: se va su vínculo (el circuito ya no traza la conexión). */
export function desvincular(entrada: TrayInput, circuitoId: string): TrayInput {
  const d = declaradoOf(entrada);
  if (!d.vinculos[circuitoId]) return entrada;
  const vinculos = { ...d.vinculos };
  delete vinculos[circuitoId];
  return conDeclarado(entrada, { ...d, vinculos });
}

/** Al recalcular un circuito ligado: la conexión vuelve a tomarse como está ahora en el Excel. */
export function revincular(entrada: TrayInput, circuitoId: string, conexion: ConexionImportada): TrayInput {
  return declaradoOf(entrada).vinculos[circuitoId] ? vincular(entrada, circuitoId, conexion) : entrada;
}
