/**
 * Circuitos guardados: un recorrido entre dos bocas con nombre, persistido en el
 * proyecto (clave workspace-only `circuitos_ws` del trazado; no viaja al motor,
 * que exige cable y cantidad para sus `circuitos`).
 *
 * Al guardar se congela lo que se mostró: origen, destino, piezas atravesadas
 * (con las bocas por las que entra y sale, su longitud y la posición/dirección
 * de esas bocas) y uniones cruzadas. Después NUNCA se recalcula solo:
 * `estadoCircuito` compara lo guardado con el trazado actual y dice si quedó
 * desactualizado y por qué (pieza borrada, movida o rotada, longitud cambiada,
 * unión borrada o que ya no cumple). Recalcular es una acción explícita.
 */
import type { TrayInput } from '../../tray/model';
import { checkConnection } from '../placement/joins';
import { caminoEntreBocas, longitudDeCruce, type Boca, type FuenteLongitud } from './caminoEntreBocas';

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

export interface CircuitoGuardado {
  readonly id: string;
  readonly nombre: string;
  readonly origen: Boca;
  readonly destino: Boca;
  readonly cruces: readonly CruceGuardado[];
  readonly uniones: readonly string[];
  readonly sumaMm: number;
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

function construir(entrada: TrayInput, id: string, nombre: string, origen: Boca, destino: Boca): { ok: true; circuito: CircuitoGuardado } | { ok: false; motivo: string } {
  const r = caminoEntreBocas(entrada, origen, destino);
  if (!r.ok) return { ok: false, motivo: r.motivo };
  const piezas = new Map(entrada.piezas.map((p) => [p.instancia_id, p]));
  const cruces: CruceGuardado[] = r.cruces.map((c) => {
    const p = piezas.get(c.pieza)!;
    const bocas: Record<string, BocaGuardada> = {};
    for (const b of [c.entrada, c.salida]) {
      const q = p.puertos[b];
      bocas[b] = {
        posicion_mm: [...q.posicion_mm] as V3,
        direccion: [...q.direccion] as V3,
        // Girar una pieza sobre su propio eje sólo cambia la orientación de la sección.
        ...(q.orientacion_seccion_ws ? { orientacion_seccion_ws: [...q.orientacion_seccion_ws] as V3 } : {}),
      };
    }
    return { pieza: c.pieza, entrada: c.entrada, salida: c.salida, longitudMm: c.longitudMm, fuente: c.fuente, bocas };
  });
  return {
    ok: true,
    circuito: { id, nombre, origen, destino, cruces, uniones: [...r.uniones], sumaMm: r.sumaMm, completa: r.completa, guardado_iso: new Date().toISOString() },
  };
}

export function guardarCircuito(entrada: TrayInput, nombre: string, origen: Boca, destino: Boca): { ok: true; entrada: TrayInput; circuito: CircuitoGuardado } | { ok: false; motivo: string } {
  const n = nombre.trim();
  if (!n) return { ok: false, motivo: 'el circuito necesita un nombre' };
  const lista = circuitosOf(entrada);
  if (lista.some((c) => c.nombre.toLowerCase() === n.toLowerCase())) return { ok: false, motivo: `ya hay un circuito llamado "${n}"` };
  const usados = new Set(lista.map((c) => c.id));
  let k = lista.length + 1;
  while (usados.has(`CIR-${k}`)) k++;
  const r = construir(entrada, `CIR-${k}`, n, origen, destino);
  if (!r.ok) return r;
  return { ok: true, entrada: conCircuitos(entrada, [...lista, r.circuito]), circuito: r.circuito };
}

/** Recalcula un circuito con el trazado actual (acción explícita del operador). Conserva id y nombre. */
export function recalcularCircuito(entrada: TrayInput, id: string): { ok: true; entrada: TrayInput } | { ok: false; motivo: string } {
  const lista = circuitosOf(entrada);
  const c = lista.find((x) => x.id === id);
  if (!c) return { ok: false, motivo: `no existe el circuito ${id}` };
  const r = construir(entrada, c.id, c.nombre, c.origen, c.destino);
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
 * ¿El circuito guardado sigue valiendo con el trazado actual? No recalcula:
 * lista los motivos por los que quedó desactualizado. `etiqueta` da el nombre
 * visible de una pieza (por defecto, su id).
 */
export function estadoCircuito(
  entrada: TrayInput,
  c: CircuitoGuardado,
  etiqueta: (pieza: string) => string = (p) => p,
): { vigente: true } | { vigente: false; motivos: string[] } {
  const motivos: string[] = [];
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
    const ahora = longitudDeCruce(p, cr.entrada, cr.salida).longitudMm;
    if (ahora !== cr.longitudMm && !(ahora !== null && cr.longitudMm !== null && Math.abs(ahora - cr.longitudMm) <= TOL_MOV_MM)) {
      const t = (x: number | null) => (x === null ? 'sin longitud' : `${fmt(x)} mm`);
      motivos.push(`la longitud de la pieza ${etiqueta(cr.pieza)} cambió (${t(cr.longitudMm)} → ${t(ahora)})`);
    }
  }
  for (const u of c.uniones) {
    const con = entrada.conexiones.find((x) => x.conexion_id === u);
    if (!con) { motivos.push(`la unión ${u} ya no existe`); continue; }
    const chk = checkConnection(entrada, con);
    if (!chk || !chk.ok) motivos.push(`la unión ${u} ya no cumple${chk ? `: ${chk.motivos.join('; ')}` : ''}`);
  }
  return motivos.length ? { vigente: false, motivos } : { vigente: true };
}
