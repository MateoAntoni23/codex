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
 *
 * Biblioteca de conductores, parte B: los cables DECLARADOS POR EL OPERADOR entran a la
 * misma regla (naturaleza, conductores, sección) como candidatos, al lado de los del
 * catálogo del motor. Un tendido lleva un cable de catálogo (`cable`) o uno declarado
 * (`cableDeclarado`), nunca los dos. Un declarado no viaja al motor: la ocupación de las
 * bandejas por las que pasa la calcula la app (`conductores/ocupacionApp.ts`). La regla
 * del cobre sigue siendo sólo entre cables del catálogo (misma línea y tipo).
 */
import type { ConexionImportada, ImportedCatalog, TendidoImportado } from '../import/types';
import type { CableCatalogo } from '../workspace/cables/catalogoCables';
import { casarTendido, type CableCasable, type CasamientoCable } from './casarCable';
import { casableDe, esIdDeclarado, type CableDeclarado } from '../conductores/biblioteca';
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

/** Se dice siempre al lado de un cable declarado: de dónde sale y qué pasa con el cálculo. */
export const TEXTO_DECLARADO = 'declarado por el operador (biblioteca de conductores): no viaja al motor; la ocupación de sus bandejas la calcula la app';

/** Tolerancia para avisar que el diámetro del Excel difiere del de catálogo (mm). */
const TOL_DIAMETRO_MM = 0.05;

export interface CableDeTendido {
  readonly tendido: TendidoImportado;
  /** Casamiento contra el catálogo del motor y los declarados juntos (ids `PRY-…` y `OP-…`). */
  readonly casamiento: CasamientoCable<CableCasable>;
  /** Candidatos del catálogo que se ofrecen para elegir (vacío si ninguno casa). */
  readonly candidatos: readonly CableCatalogo[];
  /** Candidatos declarados por el operador (biblioteca de conductores). */
  readonly candidatosDeclarados: readonly CableDeclarado[];
  /** El cable de catálogo que lleva el tendido, o null. */
  readonly cable: CableCatalogo | null;
  /** El cable declarado por el operador que lleva el tendido, o null (excluyente con `cable`). */
  readonly cableDeclarado: CableDeclarado | null;
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

export function cableDeTendido(
  t: TendidoImportado,
  cables: readonly CableCatalogo[],
  declarado: DeclaradoConexiones,
  declarados: readonly CableDeclarado[] = [],
): CableDeTendido {
  const casamiento = casarTendido<CableCasable>(t, [...cables, ...declarados.map(casableDe)]);
  const ids = new Set(casamiento.estado === 'ninguno' ? [] : casamiento.candidatos.map((c) => c.cable_id));
  const candidatos = cables.filter((c) => ids.has(c.cable_id));
  const candidatosDeclarados = declarados.filter((d) => ids.has(d.cable_id));
  const avisos: string[] = [];
  const con = (cable: CableCatalogo | null, procedencia: ProcedenciaCable | null, motivoSinCable: string | null, cableDeclarado: CableDeclarado | null = null): CableDeTendido => {
    if (cable && t.diametroExteriorMm !== undefined && Math.abs(t.diametroExteriorMm - cable.diametro_exterior_mm) > TOL_DIAMETRO_MM) {
      avisos.push(`el diámetro exterior del Excel (${nf(t.diametroExteriorMm)} mm) difiere del del cable de catálogo (${nf(cable.diametro_exterior_mm)} mm): la ocupación la calcula el motor con el suyo`);
    }
    const dd = cableDeclarado?.diametro_exterior_mm ?? null;
    if (dd !== null && t.diametroExteriorMm !== undefined && Math.abs(t.diametroExteriorMm - dd) > TOL_DIAMETRO_MM) {
      avisos.push(`el diámetro exterior del Excel (${nf(t.diametroExteriorMm)} mm) difiere del del cable declarado (${nf(dd)} mm): la app calcula la ocupación con el declarado`);
    }
    return { tendido: t, casamiento, candidatos, candidatosDeclarados, cable, cableDeclarado, procedencia, motivoSinCable, avisos };
  };
  const elegido = declarado.cables[t.tendidoId];
  if (elegido) {
    if (elegido.cable_id === null) return con(null, 'operador', 'el operador lo dejó sin cable de catálogo');
    if (esIdDeclarado(elegido.cable_id)) {
      const d = declarados.find((x) => x.cable_id === elegido.cable_id);
      if (!d) return con(null, 'operador', `el cable declarado elegido (${elegido.cable_id}) no está en la biblioteca de conductores de este equipo`);
      if (!ids.has(d.cable_id)) {
        avisos.push(`el cable elegido (${d.designacion}, ${d.cable_id}) ya no casa con el tendido del Excel (cambió el Excel o se editó el declarado): revisalo`);
      }
      return con(null, 'operador', null, d);
    }
    const c = cables.find((x) => x.cable_id === elegido.cable_id);
    if (!c) return con(null, 'operador', `el cable elegido (${elegido.cable_id}) no está en el catálogo del motor`);
    if (!ids.has(c.cable_id)) {
      avisos.push(`el cable elegido (${c.cable_id}) ya no casa con el tendido del Excel (naturaleza, conductores o sección cambiaron): revisalo`);
    }
    return con(c, 'operador', null);
  }
  if (casamiento.estado === 'unico') {
    return candidatosDeclarados.length ? con(null, 'unico-candidato', null, candidatosDeclarados[0]) : con(candidatos[0], 'unico-candidato', null);
  }
  if (casamiento.estado === 'varios') {
    // La regla del cobre es entre cables del catálogo (misma línea y tipo): con un declarado entre los candidatos, elige el operador.
    const cu = candidatosDeclarados.length ? null : cobrePorRegla(candidatos);
    if (cu) return con(cu, 'regla-cobre', null);
    const n = casamiento.candidatos.length;
    return con(null, null, candidatosDeclarados.length
      ? `${n} candidatos (${candidatos.length} del catálogo y ${candidatosDeclarados.length} declarado(s) por el operador): elegí uno`
      : `${n} candidatos en el catálogo: elegí uno`);
  }
  return con(null, null, `sin cable de catálogo: ${casamiento.motivo}`);
}

export function tendidosDe(catalog: ImportedCatalog | null, conexionId: string): TendidoImportado[] {
  return (catalog?.tendidos ?? []).filter((t) => t.conexionId === conexionId);
}

export function cablesDeConexion(catalog: ImportedCatalog | null, conexion: ConexionImportada, cables: readonly CableCatalogo[], declarado: DeclaradoConexiones, declarados: readonly CableDeclarado[] = []): CableDeTendido[] {
  return tendidosDe(catalog, conexion.conexionId).map((t) => cableDeTendido(t, cables, declarado, declarados));
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
  /** Cable de catálogo (`PRY-…`) o declarado por el operador (`OP-…`). */
  readonly cable_id: string | null;
  /** El cable declarado, si `cable_id` es uno: no viaja al motor. */
  readonly declarado: CableDeclarado | null;
  readonly cantidad: number | null;
  readonly procedencia: ProcedenciaCable | 'circuito' | null;
  readonly motivoSinCable: string | null;
}

/**
 * Lo que lleva un circuito guardado: el cable elegido a mano (fuera del Excel) o, si está
 * ligado a una conexión, un ítem por tendido del Excel actual.
 */
export function cablesDelCircuito(entrada: TrayInput | null | undefined, catalog: ImportedCatalog | null, cables: readonly CableCatalogo[], c: CircuitoGuardado, declarados: readonly CableDeclarado[] = []): CableEnCircuito[] {
  const declarado = declaradoOf(entrada);
  const v = declarado.vinculos[c.id];
  if (!v) {
    return [{
      etiqueta: c.nombre, tendidoId: null, funcion: c.cable?.funcion ?? null, cable_id: c.cable?.cable_id ?? null, declarado: null, cantidad: c.cable?.cantidad ?? null,
      procedencia: c.cable ? 'circuito' : null, motivoSinCable: c.cable ? null : 'sin cable',
    }];
  }
  const cx = catalog?.conexiones.find((x) => x.conexionId === v.conexionId);
  if (!cx) return [];
  const funcion = FUNCION_DE_SERVICIO[cx.servicio] ?? null;
  return tendidosDe(catalog, cx.conexionId).map((t) => {
    const k = cableDeTendido(t, cables, declarado, declarados);
    return {
      etiqueta: `${c.nombre} · ${t.tendidoId} (${t.designacion ?? t.funcion})`, tendidoId: t.tendidoId, funcion,
      cable_id: k.cable?.cable_id ?? k.cableDeclarado?.cable_id ?? null, declarado: k.cableDeclarado, cantidad: t.cantidadUnidades, procedencia: k.procedencia, motivoSinCable: k.motivoSinCable,
    };
  });
}

/**
 * Qué le falta a un circuito para calcular, con el Excel: uno ligado lista sus tendidos sin
 * cable de catálogo (se miden igual); uno fuera del Excel, lo de siempre (`faltaParaCalcular`).
 */
export function faltaConExcel(entrada: TrayInput | null | undefined, catalog: ImportedCatalog | null, cables: readonly CableCatalogo[], c: CircuitoGuardado, idsCables?: readonly string[], declarados: readonly CableDeclarado[] = []): string[] {
  if (!declaradoOf(entrada).vinculos[c.id]) return faltaParaCalcular(c, idsCables);
  return cablesDelCircuito(entrada, catalog, cables, c, declarados).flatMap((k) =>
    !k.cable_id ? [`el tendido ${k.tendidoId} no lleva cable de catálogo (${k.motivoSinCable})`]
    : k.declarado && k.declarado.diametro_exterior_mm === null
      ? [`el tendido ${k.tendidoId} lleva un cable declarado sin diámetro exterior (${k.declarado.designacion}, ${k.declarado.cable_id}): completalo en la biblioteca de conductores`]
      : []);
}
