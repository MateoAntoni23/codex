/**
 * Etapa 2 — los cables de un circuito ligado salen de los tendidos de su conexión.
 *
 * Un circuito ligado lleva TODOS los tendidos de su conexión: una lista de cables sobre
 * el mismo recorrido. Los tendidos se leen del Excel actual (no se copian al circuito);
 * lo único que se guarda es la elección del operador (`declarado.cables`).
 *
 * Cable de cada tendido, con su procedencia a la vista:
 *   - `operador`        — lo eligió el operador (o lo dejó sin cable de catálogo);
 *   - `unico-candidato` — el único cable del catálogo del motor que casa por naturaleza,
 *                         conductores y sección del Excel (`casarCable.ts`);
 *   - `regla-cobre`     — REGLA DEL OPERADOR: candidatos que sólo difieren en el material →
 *                         se propone el de cobre. El operador lo cambia en ese tendido.
 * Sin cable: varios candidatos sin regla que decida, ninguno, o elegido así. Nunca un
 * cable por defecto. Lo que no tiene cable se mide igual y no viaja al motor.
 */
import type { ConexionImportada, ImportedCatalog, TendidoImportado } from '../import/types';
import type { CableCatalogo } from '../workspace/cables/catalogoCables';
import { casarTendido, type CasamientoCable } from './casarCable';
import { declaradoOf, type DeclaradoConexiones } from './declarado';
import type { TrayInput } from '../tray/model';
import { faltaParaCalcular, type CircuitoGuardado, type FuncionCircuito } from '../workspace/recorridos/circuitosGuardados';

export const REGLA_COBRE = {
  procedencia: 'regla del operador (2026-11-15)',
  texto: 'Cuando los candidatos sólo difieren en el material, se propone el de cobre: el Excel no trae material y el operador trabaja en cobre salvo excepción.',
} as const;

export type ProcedenciaCable = 'operador' | 'unico-candidato' | 'regla-cobre';

export const TEXTO_PROCEDENCIA: Readonly<Record<ProcedenciaCable, string>> = {
  operador: 'elegido por el operador',
  'unico-candidato': 'único candidato del catálogo por naturaleza, conductores y sección del Excel',
  'regla-cobre': `propuesto por la ${REGLA_COBRE.procedencia}: cobre (el Excel no trae material)`,
};

/** Tolerancia para avisar que el diámetro del Excel difiere del de catálogo (mm). */
const TOL_DIAMETRO_MM = 0.05;

export interface CableDeTendido {
  readonly tendido: TendidoImportado;
  readonly casamiento: CasamientoCable;
  /** Candidatos que se ofrecen para elegir (vacío si ninguno casa). */
  readonly candidatos: readonly CableCatalogo[];
  /** El cable que lleva el tendido, o null. */
  readonly cable: CableCatalogo | null;
  /** De dónde salió `cable` (o la decisión de no llevar ninguno, si la tomó el operador). */
  readonly procedencia: ProcedenciaCable | null;
  /** Por qué no lleva cable (si no lleva). */
  readonly motivoSinCable: string | null;
  /** Avisos: diámetro distinto, elección que ya no casa con el Excel. */
  readonly avisos: readonly string[];
}

const nf = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 2 });

/** ¿Los candidatos son la misma formación y sólo cambia el material, con uno solo de cobre? Devuelve ese. */
export function cobrePorRegla(candidatos: readonly CableCatalogo[]): CableCatalogo | null {
  if (candidatos.length < 2) return null;
  const clave = (c: CableCatalogo) => `${c.linea}|${c.tipo}|${c.n_conductores}|${c.formacion}`;
  if (new Set(candidatos.map(clave)).size !== 1) return null;
  if (new Set(candidatos.map((c) => c.material)).size !== candidatos.length) return null;
  const cu = candidatos.filter((c) => c.material === 'cobre');
  return cu.length === 1 ? cu[0] : null;
}

export function cableDeTendido(t: TendidoImportado, cables: readonly CableCatalogo[], declarado: DeclaradoConexiones): CableDeTendido {
  const casamiento = casarTendido(t, cables);
  const candidatos = casamiento.estado === 'ninguno' ? [] : casamiento.candidatos;
  const avisos: string[] = [];
  const con = (cable: CableCatalogo | null, procedencia: ProcedenciaCable | null, motivoSinCable: string | null): CableDeTendido => {
    if (cable && t.diametroExteriorMm !== undefined && Math.abs(t.diametroExteriorMm - cable.diametro_exterior_mm) > TOL_DIAMETRO_MM) {
      avisos.push(`el diámetro exterior del Excel (${nf(t.diametroExteriorMm)} mm) difiere del del cable de catálogo (${nf(cable.diametro_exterior_mm)} mm): la ocupación la calcula el motor con el suyo`);
    }
    return { tendido: t, casamiento, candidatos, cable, procedencia, motivoSinCable, avisos };
  };
  const elegido = declarado.cables[t.tendidoId];
  if (elegido) {
    if (elegido.cable_id === null) return con(null, 'operador', 'el operador lo dejó sin cable de catálogo');
    const c = cables.find((x) => x.cable_id === elegido.cable_id);
    if (!c) return con(null, 'operador', `el cable elegido (${elegido.cable_id}) no está en el catálogo del motor`);
    if (!candidatos.some((x) => x.cable_id === c.cable_id)) {
      avisos.push(`el cable elegido (${c.cable_id}) ya no casa con el tendido del Excel (naturaleza, conductores o sección cambiaron): revisalo`);
    }
    return con(c, 'operador', null);
  }
  if (casamiento.estado === 'unico') return con(casamiento.cable, 'unico-candidato', null);
  if (casamiento.estado === 'varios') {
    const cu = cobrePorRegla(casamiento.candidatos);
    if (cu) return con(cu, 'regla-cobre', null);
    return con(null, null, `${casamiento.candidatos.length} candidatos en el catálogo: elegí uno`);
  }
  return con(null, null, `sin cable de catálogo: ${casamiento.motivo}`);
}

export function tendidosDe(catalog: ImportedCatalog | null, conexionId: string): TendidoImportado[] {
  return (catalog?.tendidos ?? []).filter((t) => t.conexionId === conexionId);
}

export function cablesDeConexion(catalog: ImportedCatalog | null, conexion: ConexionImportada, cables: readonly CableCatalogo[], declarado: DeclaradoConexiones): CableDeTendido[] {
  return tendidosDe(catalog, conexion.conexionId).map((t) => cableDeTendido(t, cables, declarado));
}

// ─── Cables de un circuito guardado (a mano o ligado) ────────────────────────

/** Función del circuito según el servicio de la conexión (sólo los que se trazan). */
export const FUNCION_DE_SERVICIO: Readonly<Partial<Record<ConexionImportada['servicio'], FuncionCircuito>>> = {
  POTENCIA: 'potencia',
  CONTROL: 'maniobra',
  INSTRUMENTACION: 'instrumentacion',
  COMUNICACION: 'comunicacion',
};

export interface CableEnCircuito {
  /** Texto para el operador: «F-TAB-A · CB-001 (2×(3×1×150))» o el nombre del circuito. */
  readonly etiqueta: string;
  readonly tendidoId: string | null;
  readonly funcion: FuncionCircuito | null;
  readonly cable_id: string | null;
  readonly cantidad: number | null;
  readonly procedencia: ProcedenciaCable | 'circuito' | null;
  readonly motivoSinCable: string | null;
}

/**
 * Lo que lleva un circuito guardado: el cable elegido a mano (fuera del Excel) o, si está
 * ligado a una conexión, un ítem por tendido del Excel actual.
 */
export function cablesDelCircuito(entrada: TrayInput | null | undefined, catalog: ImportedCatalog | null, cables: readonly CableCatalogo[], c: CircuitoGuardado): CableEnCircuito[] {
  const declarado = declaradoOf(entrada);
  const v = declarado.vinculos[c.id];
  if (!v) {
    return [{
      etiqueta: c.nombre, tendidoId: null, funcion: c.cable?.funcion ?? null, cable_id: c.cable?.cable_id ?? null, cantidad: c.cable?.cantidad ?? null,
      procedencia: c.cable ? 'circuito' : null, motivoSinCable: c.cable ? null : 'sin cable',
    }];
  }
  const cx = catalog?.conexiones.find((x) => x.conexionId === v.conexionId);
  if (!cx) return [];
  const funcion = FUNCION_DE_SERVICIO[cx.servicio] ?? null;
  return tendidosDe(catalog, cx.conexionId).map((t) => {
    const k = cableDeTendido(t, cables, declarado);
    return {
      etiqueta: `${c.nombre} · ${t.tendidoId} (${t.designacion ?? t.funcion})`, tendidoId: t.tendidoId, funcion,
      cable_id: k.cable?.cable_id ?? null, cantidad: t.cantidadUnidades, procedencia: k.procedencia, motivoSinCable: k.motivoSinCable,
    };
  });
}

/**
 * Qué le falta a un circuito para calcular, con el Excel: uno ligado lista sus tendidos sin
 * cable de catálogo (se miden igual); uno fuera del Excel, lo de siempre (`faltaParaCalcular`).
 */
export function faltaConExcel(entrada: TrayInput | null | undefined, catalog: ImportedCatalog | null, cables: readonly CableCatalogo[], c: CircuitoGuardado, idsCables?: readonly string[]): string[] {
  if (!declaradoOf(entrada).vinculos[c.id]) return faltaParaCalcular(c, idsCables);
  return cablesDelCircuito(entrada, catalog, cables, c).filter((k) => !k.cable_id).map((k) => `el tendido ${k.tendidoId} no lleva cable de catálogo (${k.motivoSinCable})`);
}
