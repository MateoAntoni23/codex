/**
 * Bajada: el enlace entre un equipo y la red de bandejas (etapa 1, 2026-11-13).
 *
 * El operador elige un equipo y un punto de salida sobre un tramo recto, igual
 * que el enganche de una derivación (tramo, distancia desde una boca, lado: la
 * misma maquinaria, `derivacion/enganche.ts` → `geometriaPuntoEnTramo`). Desde
 * ese punto del flanco baja el cable hasta el equipo.
 *
 * Reglas DECLARADAS POR EL OPERADOR (2026-11-13), con esa procedencia:
 *   - La bajada es un tramo recto desde el punto de salida de la bandeja hasta el
 *     punto de conexión del equipo. Es cable al aire o por caño, NO bandeja: su
 *     longitud cuenta en la longitud del circuito y NO computa ninguna pieza de
 *     bandeja (no agrega piezas ni conexiones al trazado; no viaja al motor).
 *   - Punto de conexión del equipo = el centro del equipo, es decir su posición
 *     guardada (los equipos no tienen un punto de conexión propio; su caja o
 *     cilindro se dibuja centrado en esa posición).
 *
 * Persistencia: clave workspace-only `bajadas_ws` del trazado (como
 * `enganches_ws`). Cada bajada guarda la foto del tramo y la posición del equipo
 * al crearla. Si el equipo se mueve o se borra, o el tramo se mueve, cambia de
 * largo o se borra, `estadoBajada` la informa desactualizada con su motivo.
 * Nada se recalcula solo.
 *
 * Por el lado del recorrido, el tramo tiene una pseudo-boca `bajada:<id>` (como
 * `enganche:<id>`): el camino entre dos equipos va de la pseudo-boca de la
 * bajada del origen a la de la bajada del destino (`recorridos/caminoEntreBocas.ts`).
 */
import type { Product, TrayInput } from '../../tray/model';
import type { EquipmentElement, Quaternion, Vec3 } from '../../types/domain-v2';
import { fotoTronco, geometriaPuntoEnTramo, motivosTronco, type PuntoEnTramo } from '../derivacion/enganche';

export const BAJADAS_KEY = 'bajadas_ws';
export const bocaBajada = (id: string) => `bajada:${id}`;
export const idDeBocaBajada = (boca: string): string | null => (boca.startsWith('bajada:') ? boca.slice('bajada:'.length) : null);

export const PROCEDENCIA_BAJADA =
  'declarado por el operador (2026-11-13): la bajada es un tramo recto de cable al aire o por caño, no bandeja; su longitud cuenta en el circuito y no computa ninguna pieza de bandeja';
export const PROCEDENCIA_PUNTO_EQUIPO =
  'declarado por el operador (2026-11-13): punto de conexión = centro del equipo (su posición guardada); los equipos no tienen un punto de conexión propio';

type V3 = [number, number, number];

interface BocaFoto { readonly posicion_mm: V3; readonly direccion: V3; readonly orientacion_seccion_ws?: V3 }

export interface Bajada extends PuntoEnTramo {
  readonly id: string;
  /** Id del equipo (elemento del proyecto). */
  readonly equipo: string;
  /** Punto de salida sobre el flanco del tramo (mm, mundo). */
  readonly punto_salida_mm: V3;
  /** Punto de conexión del equipo al crear la bajada (mm, mundo). */
  readonly punto_equipo_mm: V3;
  /** Largo de la bajada: distancia recta entre los dos puntos (mm). */
  readonly longitud_mm: number;
  readonly procedencia: string;
  readonly punto_equipo_procedencia: string;
  /** Foto del tramo al crear la bajada (para avisar si cambia). */
  readonly ref_tronco: { readonly longitud_mm: number; readonly bocas: Readonly<Record<string, BocaFoto>> };
  readonly creado_iso: string;
}

export function bajadasOf(entrada: TrayInput | null | undefined): Bajada[] {
  const t = (entrada as Record<string, unknown> | null | undefined)?.[BAJADAS_KEY];
  return Array.isArray(t) ? (t as Bajada[]) : [];
}

export function bajadaDeEquipo(entrada: TrayInput | null | undefined, equipo: string): Bajada | null {
  return bajadasOf(entrada).find((b) => b.equipo === equipo) ?? null;
}

const conBajadas = (entrada: TrayInput, lista: readonly Bajada[]): TrayInput => ({ ...entrada, [BAJADAS_KEY]: lista }) as TrayInput;

// ─── Posición global del equipo ──────────────────────────────────────────────

function rotar(q: Quaternion, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
}
const componer = (a: Quaternion, b: Quaternion): Quaternion => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/**
 * Punto de conexión del equipo (mm, mundo): su posición guardada; si tiene padre,
 * compuesta con la de sus ancestros (todos tienen que estar ubicados).
 */
export function puntoDeConexionEquipo(elements: readonly EquipmentElement[], id: string): { ok: true; punto: V3 } | { ok: false; motivo: string } {
  const porId = new Map(elements.map((e) => [e.id, e]));
  const el = porId.get(id);
  if (!el) return { ok: false, motivo: `el equipo ${id} no existe` };
  const cadena: EquipmentElement[] = [];
  const vistos = new Set<string>();
  for (let x: EquipmentElement | undefined = el; x; x = x.parentId ? porId.get(x.parentId) : undefined) {
    if (vistos.has(x.id)) return { ok: false, motivo: `el equipo ${el.name} tiene una cadena de padres circular` };
    vistos.add(x.id);
    if (x.placementStatus !== 'placed') {
      return { ok: false, motivo: x === el ? `el equipo ${el.name} no está ubicado en la escena` : `el equipo ${el.name} está dentro de ${x.name}, que no está ubicado` };
    }
    cadena.unshift(x);
    if (x.parentId && !porId.has(x.parentId)) return { ok: false, motivo: `falta el equipo padre de ${x.name}` };
  }
  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let rot: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
  for (const x of cadena) {
    if (x.placementStatus !== 'placed') break; // ya validado arriba
    const p = rotar(rot, x.transform.positionMm);
    pos = { x: pos.x + p.x, y: pos.y + p.y, z: pos.z + p.z };
    rot = componer(rot, x.transform.rotation);
  }
  return { ok: true, punto: [pos.x, pos.y, pos.z] };
}

// ─── Crear, borrar, estado ───────────────────────────────────────────────────

export interface ParamsBajada extends PuntoEnTramo {
  readonly equipo: string;
}

const fmt = (x: number) => x.toFixed(1);
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Crea el enlace equipo ↔ bandeja. No agrega piezas ni conexiones: sólo la
 * bajada. Un equipo tiene a lo sumo una bajada (para cambiarla, se borra y se
 * crea otra).
 */
export function crearBajada(
  entrada: TrayInput,
  productos: ReadonlyMap<string, Product>,
  elements: readonly EquipmentElement[],
  p: ParamsBajada,
): { ok: true; entrada: TrayInput; bajada: Bajada } | { ok: false; motivo: string } {
  const el = elements.find((e) => e.id === p.equipo);
  if (!el) return { ok: false, motivo: 'elegí un equipo' };
  const ya = bajadaDeEquipo(entrada, p.equipo);
  if (ya) return { ok: false, motivo: `el equipo ${el.name} ya tiene el enlace ${ya.id}; borralo para crear otro` };
  const eq = puntoDeConexionEquipo(elements, p.equipo);
  if (!eq.ok) return eq;
  const g = geometriaPuntoEnTramo(entrada, productos, p);
  if (!g.ok) return g;
  const usados = new Set(bajadasOf(entrada).map((b) => b.id));
  let k = 1;
  while (usados.has(`BAJ-${k}`)) k++;
  const bajada: Bajada = {
    id: `BAJ-${k}`,
    equipo: p.equipo,
    tronco: p.tronco,
    desde_boca: p.desde_boca,
    distancia_mm: p.distancia_mm,
    lado: p.lado,
    punto_salida_mm: [...g.F] as V3,
    punto_equipo_mm: eq.punto,
    longitud_mm: dist(g.F, eq.punto),
    procedencia: PROCEDENCIA_BAJADA,
    punto_equipo_procedencia: PROCEDENCIA_PUNTO_EQUIPO,
    ref_tronco: fotoTronco(g.piece),
    creado_iso: new Date().toISOString(),
  };
  return { ok: true, entrada: conBajadas(entrada, [...bajadasOf(entrada), bajada]), bajada };
}

export function borrarBajada(entrada: TrayInput, id: string): TrayInput {
  return conBajadas(entrada, bajadasOf(entrada).filter((b) => b.id !== id));
}

/** Movimiento mínimo que se informa: cualquier cambio real (se comparan valores persistidos). */
const TOL_MOV_MM = 1e-6;

/**
 * ¿La bajada sigue valiendo? No recalcula: lista los motivos (equipo borrado,
 * sin ubicar o movido; tramo borrado, de otro largo, movido o rotado).
 */
export function estadoBajada(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  b: Bajada,
): { vigente: true } | { vigente: false; motivos: string[] } {
  const motivos: string[] = [];
  const el = elements.find((e) => e.id === b.equipo);
  if (!el) motivos.push(`el equipo ${b.equipo} ya no existe`);
  else {
    const eq = puntoDeConexionEquipo(elements, b.equipo);
    if (!eq.ok) motivos.push(eq.motivo);
    else {
      const d = dist(eq.punto, b.punto_equipo_mm);
      if (d > TOL_MOV_MM) motivos.push(`el equipo ${el.name} se movió (${fmt(d)} mm)`);
    }
  }
  motivos.push(...motivosTronco(entrada, b.tronco, b.ref_tronco).map((m) => `${m} (punto de salida de ${b.id})`));
  return motivos.length ? { vigente: false, motivos } : { vigente: true };
}

/** Firma de una bajada para detectar cambios desde que un circuito la usó. */
export function firmaBajada(b: Bajada): string {
  return JSON.stringify([b.equipo, b.tronco, b.desde_boca, b.distancia_mm, b.lado, b.punto_equipo_mm, b.longitud_mm]);
}
