/**
 * Circuitos guardados: un recorrido con nombre de UN EQUIPO A OTRO (etapa 1,
 * 2026-11-13), persistido en el proyecto (clave workspace-only `circuitos_ws`
 * del trazado; no viaja al motor, que exige cable y cantidad para sus
 * `circuitos` — eso es la etapa 2).
 *
 * Recorrido: bajada del origen → su punto de salida sobre la bandeja → piezas de
 * bandeja (el camino que ya existe, `caminoEntreBocas`) → punto de salida del
 * destino → bajada al destino. Cada equipo se enlaza con la bandeja por su
 * bajada (`equipos/bajada.ts`); sin bajada vigente no hay circuito, y se dice por
 * qué. La longitud total suma la bandeja y las dos bajadas, y se guarda
 * desglosada.
 *
 * Al guardar se congela lo que se mostró: equipos, bajadas (con su firma y
 * largo), piezas atravesadas (con las bocas por las que entra y sale, su
 * longitud y la posición/dirección de esas bocas) y uniones cruzadas. Después
 * NUNCA se recalcula solo: `estadoCircuito` compara lo guardado con el proyecto
 * actual y dice si quedó desactualizado y por qué (equipo movido o borrado,
 * bajada cambiada, pieza borrada, movida o rotada, longitud cambiada, unión
 * borrada o que ya no cumple). Recalcular es una acción explícita.
 *
 * Los circuitos con extremos de boca (formato anterior a la etapa 1) no se
 * migran: un archivo que los traiga se rechaza (`validarCircuitosDeArchivo`).
 */
import type { TrayInput } from '../../tray/model';
import type { EquipmentElement } from '../../types/domain-v2';
import { checkConnection } from '../placement/joins';
import { caminoEntreBocas, longitudDeCruce, type Cruce, type FuenteLongitud, type UnionCortada } from './caminoEntreBocas';
import { enganchesOf, estadoEnganche, firmaEnganche, idDeBocaEnganche } from '../derivacion/enganche';
import { bajadaDeEquipo, bajadasOf, bocaBajada, estadoBajada, firmaBajada, idDeBocaBajada, type Bajada } from '../equipos/bajada';

export const CIRCUITOS_KEY = 'circuitos_ws';

type V3 = [number, number, number];
interface BocaGuardada { readonly posicion_mm: V3; readonly direccion: V3; readonly orientacion_seccion_ws?: V3 }

export interface CruceGuardado {
  readonly pieza: string;
  readonly entrada: string;
  readonly salida: string;
  readonly longitudMm: number | null;
  readonly fuente: FuenteLongitud | null;
  readonly bocas: Readonly<Record<string, BocaGuardada>>;
}

/** Extremo de un circuito: un equipo del proyecto. */
export interface ExtremoEquipo { readonly equipo: string }

/** Bajada usada por un circuito, congelada al guardar. */
export interface BajadaGuardada { readonly id: string; readonly firma: string; readonly longitud_mm: number }

export interface CircuitoGuardado {
  readonly id: string;
  readonly nombre: string;
  readonly origen: ExtremoEquipo;
  readonly destino: ExtremoEquipo;
  readonly bajadas: { readonly origen: BajadaGuardada; readonly destino: BajadaGuardada };
  readonly cruces: readonly CruceGuardado[];
  readonly uniones: readonly string[];
  /** Derivación en un tramo: enganches que atraviesa, con su firma al guardar. */
  readonly enganches?: ReadonlyArray<{ readonly id: string; readonly firma: string }>;
  /** Longitud por bandeja (suma de las piezas cruzadas, mm). */
  readonly bandejaMm: number;
  /** Longitud de las dos bajadas (mm). */
  readonly bajadasMm: number;
  /** Total: bandeja + bajadas (mm). Sólo es la longitud total si `completa`. */
  readonly sumaMm: number;
  /** true si todas las piezas cruzadas tienen longitud. */
  readonly completa: boolean;
  readonly guardado_iso: string;
}

/** Cualquier cambio real de una boca (no hay ruido: se comparan valores persistidos). */
const TOL_MOV_MM = 1e-6;
const TOL_GIRO_DEG = 1e-6;

export function circuitosOf(entrada: TrayInput | null | undefined): CircuitoGuardado[] {
  const t = (entrada as Record<string, unknown> | null | undefined)?.[CIRCUITOS_KEY];
  return Array.isArray(t) ? (t as CircuitoGuardado[]) : [];
}

function conCircuitos(entrada: TrayInput, lista: readonly CircuitoGuardado[]): TrayInput {
  return { ...entrada, [CIRCUITOS_KEY]: lista } as TrayInput;
}

const nombreEquipo = (elements: readonly EquipmentElement[], id: string) => elements.find((e) => e.id === id)?.name ?? id;

/** Recorrido entre dos equipos, sin guardar: lo que se muestra antes de guardarlo como circuito. */
export type ResultadoEntreEquipos =
  | {
      readonly ok: true;
      readonly bajadaOrigen: Bajada;
      readonly bajadaDestino: Bajada;
      readonly cruces: readonly Cruce[];
      readonly uniones: readonly string[];
      readonly enganches: readonly string[];
      readonly bandejaMm: number;
      readonly bajadasMm: number;
      readonly sumaMm: number;
      readonly completa: boolean;
    }
  | { readonly ok: false; readonly motivo: string; readonly unionesCortadas: readonly UnionCortada[] };

export function caminoEntreEquipos(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  origen: ExtremoEquipo,
  destino: ExtremoEquipo,
): ResultadoEntreEquipos {
  const sinCamino = (motivo: string): ResultadoEntreEquipos => ({ ok: false, motivo, unionesCortadas: [] });
  for (const [rol, x] of [['origen', origen], ['destino', destino]] as const) {
    if (!elements.some((e) => e.id === x.equipo)) return sinCamino(`el equipo de ${rol} no existe en el proyecto (${x.equipo})`);
  }
  if (origen.equipo === destino.equipo) return sinCamino('origen y destino son el mismo equipo');
  const bajadas: Bajada[] = [];
  for (const x of [origen, destino]) {
    const b = bajadaDeEquipo(entrada, x.equipo);
    if (!b) return sinCamino(`el equipo ${nombreEquipo(elements, x.equipo)} no tiene enlace con la bandeja`);
    const est = estadoBajada(entrada, elements, b);
    if (!est.vigente) return sinCamino(`el enlace ${b.id} del equipo ${nombreEquipo(elements, x.equipo)} está desactualizado: ${est.motivos.join('; ')}`);
    bajadas.push(b);
  }
  const [bo, bd] = bajadas;
  const r = caminoEntreBocas(entrada, { pieza: bo.tronco, boca: bocaBajada(bo.id) }, { pieza: bd.tronco, boca: bocaBajada(bd.id) });
  if (!r.ok) return r;
  const bajadasMm = bo.longitud_mm + bd.longitud_mm;
  return {
    ok: true, bajadaOrigen: bo, bajadaDestino: bd, cruces: r.cruces, uniones: r.uniones, enganches: r.enganches,
    bandejaMm: r.sumaMm, bajadasMm, sumaMm: r.sumaMm + bajadasMm, completa: r.completa,
  };
}

function construir(entrada: TrayInput, elements: readonly EquipmentElement[], id: string, nombre: string, origen: ExtremoEquipo, destino: ExtremoEquipo):
  { ok: true; circuito: CircuitoGuardado } | { ok: false; motivo: string } {
  const r = caminoEntreEquipos(entrada, elements, origen, destino);
  if (!r.ok) return { ok: false, motivo: r.motivo };
  const piezas = new Map(entrada.piezas.map((p) => [p.instancia_id, p]));
  const cruces: CruceGuardado[] = r.cruces.map((c) => {
    const p = piezas.get(c.pieza)!;
    const bocas: Record<string, BocaGuardada> = {};
    for (const b of [c.entrada, c.salida]) {
      const q = p.puertos[b];
      if (!q) continue; // pseudo-boca (enganche, bajada) o cara de apoyo: la cubre su firma
      bocas[b] = {
        posicion_mm: [...q.posicion_mm] as V3,
        direccion: [...q.direccion] as V3,
        // Girar una pieza sobre su propio eje sólo cambia la orientación de la sección.
        ...(q.orientacion_seccion_ws ? { orientacion_seccion_ws: [...q.orientacion_seccion_ws] as V3 } : {}),
      };
    }
    return { pieza: c.pieza, entrada: c.entrada, salida: c.salida, longitudMm: c.longitudMm, fuente: c.fuente, bocas };
  });
  const guardar = (b: Bajada): BajadaGuardada => ({ id: b.id, firma: firmaBajada(b), longitud_mm: b.longitud_mm });
  return {
    ok: true,
    circuito: {
      id, nombre, origen: { equipo: origen.equipo }, destino: { equipo: destino.equipo },
      bajadas: { origen: guardar(r.bajadaOrigen), destino: guardar(r.bajadaDestino) },
      cruces, uniones: [...r.uniones],
      ...(r.enganches.length ? { enganches: r.enganches.map((eid) => ({ id: eid, firma: firmaEnganche(enganchesOf(entrada).find((x) => x.id === eid)!) })) } : {}),
      bandejaMm: r.bandejaMm, bajadasMm: r.bajadasMm, sumaMm: r.sumaMm, completa: r.completa, guardado_iso: new Date().toISOString(),
    },
  };
}

export function guardarCircuito(entrada: TrayInput, elements: readonly EquipmentElement[], nombre: string, origen: ExtremoEquipo, destino: ExtremoEquipo):
  { ok: true; entrada: TrayInput; circuito: CircuitoGuardado } | { ok: false; motivo: string } {
  const n = nombre.trim();
  if (!n) return { ok: false, motivo: 'el circuito necesita un nombre' };
  const lista = circuitosOf(entrada);
  if (lista.some((c) => c.nombre.toLowerCase() === n.toLowerCase())) return { ok: false, motivo: `ya hay un circuito llamado "${n}"` };
  const usados = new Set(lista.map((c) => c.id));
  let k = lista.length + 1;
  while (usados.has(`CIR-${k}`)) k++;
  const r = construir(entrada, elements, `CIR-${k}`, n, origen, destino);
  if (!r.ok) return r;
  return { ok: true, entrada: conCircuitos(entrada, [...lista, r.circuito]), circuito: r.circuito };
}

/** Recalcula un circuito con el proyecto actual (acción explícita del operador). Conserva id y nombre. */
export function recalcularCircuito(entrada: TrayInput, elements: readonly EquipmentElement[], id: string): { ok: true; entrada: TrayInput } | { ok: false; motivo: string } {
  const lista = circuitosOf(entrada);
  const c = lista.find((x) => x.id === id);
  if (!c) return { ok: false, motivo: `no existe el circuito ${id}` };
  const r = construir(entrada, elements, c.id, c.nombre, c.origen, c.destino);
  if (!r.ok) return r;
  return { ok: true, entrada: conCircuitos(entrada, lista.map((x) => (x.id === id ? r.circuito : x))) };
}

export function borrarCircuito(entrada: TrayInput, id: string): TrayInput {
  return conCircuitos(entrada, circuitosOf(entrada).filter((c) => c.id !== id));
}

const angDeg = (a: readonly number[], b: readonly number[]) => {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return (Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 180) / Math.PI;
};
const fmt = (x: number) => x.toFixed(2);

/**
 * ¿El circuito guardado sigue valiendo con el proyecto actual? No recalcula:
 * lista los motivos por los que quedó desactualizado. `etiqueta` da el nombre
 * visible de una pieza (por defecto, su id).
 */
export function estadoCircuito(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  c: CircuitoGuardado,
  etiqueta: (pieza: string) => string = (p) => p,
): { vigente: true } | { vigente: false; motivos: string[] } {
  const motivos: string[] = [];
  // Extremos: el equipo y su bajada, tal como se guardaron.
  for (const [rol, x, g] of [['origen', c.origen, c.bajadas.origen], ['destino', c.destino, c.bajadas.destino]] as const) {
    const nombre = nombreEquipo(elements, x.equipo);
    if (!elements.some((e) => e.id === x.equipo)) { motivos.push(`el equipo de ${rol} (${x.equipo}) ya no existe`); continue; }
    const b = bajadasOf(entrada).find((y) => y.id === g.id);
    if (!b || b.equipo !== x.equipo) { motivos.push(`el enlace ${g.id} del equipo ${nombre} ya no existe`); continue; }
    if (firmaBajada(b) !== g.firma) { motivos.push(`el enlace ${g.id} del equipo ${nombre} cambió`); continue; }
    const est = estadoBajada(entrada, elements, b);
    if (!est.vigente) motivos.push(...est.motivos);
  }
  const piezas = new Map(entrada.piezas.map((p) => [p.instancia_id, p]));
  for (const cr of c.cruces) {
    const p = piezas.get(cr.pieza);
    if (!p) { motivos.push(`la pieza ${etiqueta(cr.pieza)} ya no existe`); continue; }
    let movida = false;
    for (const [b, g] of Object.entries(cr.bocas)) {
      const q = p.puertos[b];
      if (!q) { motivos.push(`la pieza ${etiqueta(cr.pieza)} ya no tiene la boca ${b}`); movida = true; continue; }
      const d = Math.hypot(q.posicion_mm[0] - g.posicion_mm[0], q.posicion_mm[1] - g.posicion_mm[1], q.posicion_mm[2] - g.posicion_mm[2]);
      const a = Math.max(
        angDeg(q.direccion, g.direccion),
        g.orientacion_seccion_ws && q.orientacion_seccion_ws ? angDeg(q.orientacion_seccion_ws, g.orientacion_seccion_ws) : 0,
      );
      if (d > TOL_MOV_MM || a > TOL_GIRO_DEG) {
        motivos.push(`la pieza ${etiqueta(cr.pieza)} se movió o rotó (boca ${b}: ${fmt(d)} mm, ${fmt(a)}°)`);
        movida = true;
        break;
      }
    }
    if (movida) continue;
    // Un punto de salida (bajada) o enganche que ya no existe lo informa su propio motivo.
    const puntoFaltante = [cr.entrada, cr.salida].some((b) => {
      const ib = idDeBocaBajada(b);
      const ie = idDeBocaEnganche(b);
      return (ib !== null && !bajadasOf(entrada).some((x) => x.id === ib)) || (ie !== null && !enganchesOf(entrada).some((x) => x.id === ie));
    });
    if (puntoFaltante) continue;
    const ahora = longitudDeCruce(p, cr.entrada, cr.salida, enganchesOf(entrada), bajadasOf(entrada)).longitudMm;
    if (ahora !== cr.longitudMm && !(ahora !== null && cr.longitudMm !== null && Math.abs(ahora - cr.longitudMm) <= TOL_MOV_MM)) {
      const t = (x: number | null) => (x === null ? 'sin longitud' : `${fmt(x)} mm`);
      motivos.push(`la longitud de la pieza ${etiqueta(cr.pieza)} cambió (${t(cr.longitudMm)} → ${t(ahora)})`);
    }
  }
  for (const g of c.enganches ?? []) {
    const e = enganchesOf(entrada).find((x) => x.id === g.id);
    if (!e) { motivos.push(`el enganche ${g.id} ya no existe`); continue; }
    if (firmaEnganche(e) !== g.firma) { motivos.push(`el enganche ${g.id} cambió`); continue; }
    const est = estadoEnganche(entrada, null, e);
    if (!est.vigente) motivos.push(`el enganche ${g.id} quedó desactualizado: ${est.motivos.join('; ')}`);
  }
  for (const u of c.uniones) {
    const con = entrada.conexiones.find((x) => x.conexion_id === u);
    if (!con) { motivos.push(`la unión ${u} ya no existe`); continue; }
    const chk = checkConnection(entrada, con);
    if (!chk || !chk.ok) motivos.push(`la unión ${u} ya no cumple${chk ? `: ${chk.motivos.join('; ')}` : ''}`);
  }
  const unicos = [...new Set(motivos)];
  return unicos.length ? { vigente: false, motivos: unicos } : { vigente: true };
}

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Al abrir un archivo: los circuitos guardados tienen que tener extremos de
 * equipo. Los de extremos de boca (formato anterior a la etapa 1) se rechazan:
 * no se migran ni se reparan. Lanza con el motivo.
 */
export function validarCircuitosDeArchivo(trayInput: unknown): void {
  if (!esObj(trayInput)) return;
  const lista = trayInput[CIRCUITOS_KEY];
  if (lista === undefined) return;
  if (!Array.isArray(lista)) throw new Error(`${CIRCUITOS_KEY} debe ser una lista`);
  for (const c of lista) {
    const nombre = esObj(c) && typeof c.nombre === 'string' ? `"${c.nombre}"` : '(sin nombre)';
    const extremoEquipo = (x: unknown) => esObj(x) && typeof x.equipo === 'string' && x.equipo.length > 0;
    if (!esObj(c) || !extremoEquipo(c.origen) || !extremoEquipo(c.destino)) {
      const deBoca = esObj(c) && esObj(c.origen) && typeof c.origen.boca === 'string';
      throw new Error(
        deBoca
          ? `el circuito ${nombre} va de una boca de bandeja a otra (formato anterior): no es compatible con esta versión, que une equipos. No se intenta repararlo.`
          : `el circuito ${nombre} no tiene equipos de origen y destino válidos`,
      );
    }
  }
}
