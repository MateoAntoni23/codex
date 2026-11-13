/**
 * Derivación en un tramo: se abre una boca en un punto intermedio del flanco de
 * un tramo recto, que NO se corta y NO cambia su longitud guardada.
 *
 * LA OPERACIÓN COLOCA SÓLO LA DERIVACIÓN (operador, 2026-11-13). No crea ninguna
 * bandeja de ramal: deja una boca libre a la vista y el operador continúa desde
 * ella por el camino normal de continuación, igual que desde cualquier accesorio.
 *   - perforada → la DCPS del ancho elegido, con su cara de apoyo contra el
 *     flanco en el punto de enganche. Es una pieza del trazado (el motor la
 *     computa: 1 DCPS del ancho elegido) y su boca P1 queda libre.
 *   - escalera → sin accesorio, explícito en el dato
 *     ({ tipo: 'sin_accesorio_por_familia' }): se arma cortando en obra. Lo que
 *     queda es la BOCA sobre el flanco (`enganche:<id>` del tronco), libre. Una
 *     boca de enganche sin nada continuado es un extremo libre legítimo.
 *
 * El operador elige tronco, boca de referencia, distancia, lado y el ANCHO de la
 * derivación (en perforada determina qué DCPS se computa; en escalera, el ancho
 * del corte: la huella sobre el flanco y el de la boca libre). El ancho NO tiene
 * que coincidir con el del tronco: entre tronco y derivación no hay una
 * `conexion`, así que la cuarta condición de B-3 no se aplica ahí.
 *
 * Continuar desde la boca de escalera: el camino normal arma una `conexion`
 * contra `enganche:<id>`; `asentarSalidasDeEnganche` la convierte en la `salida`
 * del enganche (la boca no es del catálogo y no viaja al motor). La
 * compatibilidad se decide contra un recto de referencia de la familia del
 * tronco con el ancho de la derivación (`origenDeBoca`).
 *
 * Persistencia: clave workspace-only `enganches_ws` del trazado (no viaja al
 * motor). Cada enganche guarda la foto del tronco al crearlo; si el tronco se
 * mueve, se acorta o se borra, `estadoEnganche` lo informa desactualizado con el
 * motivo. Nunca se recalcula solo. Los enganches de proyectos anteriores (con un
 * ramal creado por la operación) se leen igual: su salida es ese ramal.
 */
import type { Piece, Product, TrayInput } from '../../tray/model';
import { definicionEfectiva, placedOf, withDefinition } from '../placement/definitions';
import { placeDefinition, puertosFromWorld, type StoredDefinition, type V3 } from '../placement/placementCore';
import { avisoCotaNoConfirmada, findMasterById, sobreanchoDeBoca } from '../../configurator/masterModels';

export const ENGANCHES_KEY = 'enganches_ws';
/** Pseudo-boca del tronco en el enganche: por ella sale/entra un recorrido (y, en escalera, se continúa). */
export const bocaEnganche = (id: string) => `enganche:${id}`;
export const idDeBocaEnganche = (boca: string): string | null => (boca.startsWith('enganche:') ? boca.slice('enganche:'.length) : null);
/** Pseudo-boca de la DCPS: su cara de apoyo contra el flanco del tronco (no es una boca del catálogo). */
export const BOCA_APOYO = 'apoyo';

export type Lado = 'izquierda' | 'derecha';
export type Familia = 'perforada' | 'escalera';

export const MOTIVO_SIN_ACCESORIO_ESCALERA = 'escalera: la derivación no consume accesorio; se arma cortando en obra';

export type AccesorioEnganche =
  | {
      readonly tipo: 'producto';
      readonly producto_id: string;
      /** Instancia de la DCPS en el trazado. */
      readonly pieza: string;
      readonly profundidad_mm: number;
      readonly procedencia: string;
    }
  | { readonly tipo: 'sin_accesorio_por_familia'; readonly familia: 'escalera'; readonly motivo: string };

interface BocaFoto { readonly posicion_mm: V3; readonly direccion: V3; readonly orientacion_seccion_ws?: V3 }

export interface Enganche {
  readonly id: string;
  readonly tronco: string;
  readonly desde_boca: string;
  /** Desde el centro de `desde_boca`, a lo largo del tronco, hasta el centro del enganche (mm). */
  readonly distancia_mm: number;
  readonly lado: Lado;
  readonly familia: Familia;
  /** Ancho de la derivación (mm): el de la DCPS en perforada, el del corte en escalera. */
  readonly ramal_ancho_mm: number;
  /** Largo que ocupa sobre el flanco del tronco (mm). */
  readonly huella_mm: number;
  readonly huella_procedencia: string;
  readonly accesorio: AccesorioEnganche;
  /**
   * Por dónde sigue el recorrido del otro lado del enganche: [pieza, boca].
   * Perforada: [DCPS, 'apoyo']. Escalera: lo continuado desde la boca, o ['', '']
   * mientras la boca está libre.
   */
  readonly salida: readonly [string, string];
  /** Escalera: la boca sobre el flanco (posición, dirección hacia afuera y "arriba" de sección). */
  readonly boca?: BocaFoto;
  /** Escalera: recto de referencia (familia del tronco, ancho de la derivación) contra el que se decide qué se continúa. */
  readonly ref_producto_id?: string;
  /** Foto del tronco al crear el enganche (para avisar si cambia). */
  readonly ref_tronco: { readonly longitud_mm: number; readonly bocas: Readonly<Record<string, BocaFoto>> };
  /**
   * Incertidumbres que el operador tiene que ver al colocar (p. ej. la cota de
   * boca de una DCPS sin STEP propio).
   */
  readonly advertencias?: readonly string[];
  readonly creado_iso: string;
}

export function enganchesOf(entrada: TrayInput | null | undefined): Enganche[] {
  const t = (entrada as Record<string, unknown> | null | undefined)?.[ENGANCHES_KEY];
  return Array.isArray(t) ? (t as Enganche[]) : [];
}

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: readonly number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): V3 => mul(a, 1 / norm(a));
const fmt = (x: number) => x.toFixed(1);

/** Familia del tronco según el patrón de su definición guardada. */
export function familiaDe(def: StoredDefinition): Familia | null {
  if (def.patron.startsWith('master:perforada:')) return 'perforada';
  if (def.patron.startsWith('master:escalera:')) return 'escalera';
  return null;
}

/** La DCPS de un ancho (perforada), o null. */
export function dcpsParaAncho(productos: ReadonlyMap<string, Product>, ancho: number): Product | null {
  for (const p of productos.values()) {
    if (String(p.sku).startsWith('DCPS-') && p.ancho_nominal_mm === ancho) return p;
  }
  return null;
}

const familiaId = (p: Product) => (p as Record<string, unknown>).familia_id;
const alaNominal = (p: Product) => (p as Record<string, unknown>).ala_nominal_mm;

/** Recto de la familia del tronco con el ancho dado (mismo ala): referencia para continuar desde una boca de escalera. */
export function rectoDeReferencia(productos: ReadonlyMap<string, Product>, tronco: Product, ancho: number): Product | null {
  const cands = [...productos.values()]
    .filter((p) => p.tipo_pieza === 'recta' && familiaId(p) === familiaId(tronco) && alaNominal(p) === alaNominal(tronco) && p.ancho_nominal_mm === ancho)
    .sort((a, b) => a.producto_id.localeCompare(b.producto_id));
  return cands[0] ?? null;
}

/** Anchos elegibles para una derivación sobre ese tronco (perforada: los de las DCPS; escalera: los rectos de su familia y ala). */
export function anchosDeDerivacion(productos: ReadonlyMap<string, Product>, tronco: Product, familia: Familia): number[] {
  const out = new Set<number>();
  for (const p of productos.values()) {
    if (typeof p.ancho_nominal_mm !== 'number') continue;
    if (familia === 'perforada') { if (String(p.sku).startsWith('DCPS-')) out.add(p.ancho_nominal_mm); }
    else if (p.tipo_pieza === 'recta' && familiaId(p) === familiaId(tronco) && alaNominal(p) === alaNominal(tronco)) out.add(p.ancho_nominal_mm);
  }
  return [...out].sort((a, b) => a - b);
}

/** Huella y profundidad de una DCPS, medidas sobre su definición (planta en XZ: apoyo en z mín, boca en z máx). */
export function medidasDCPS(def: StoredDefinition): { huella_mm: number; profundidad_mm: number } {
  const xs = def.mesh.polygon.map((p) => p[0]);
  const zs = def.mesh.polygon.map((p) => p[1]);
  return { huella_mm: Math.max(...xs) - Math.min(...xs), profundidad_mm: Math.max(...zs) - Math.min(...zs) };
}

export interface ParamsEnganche {
  readonly tronco: string;
  readonly desde_boca: string;
  readonly distancia_mm: number;
  readonly lado: Lado;
  /** Ancho de la derivación (mm). Perforada: elige la DCPS que se computa. Escalera: ancho del corte. */
  readonly ancho_mm: number;
}

function idLibre(usados: ReadonlySet<string>, prefijo: string): string {
  let k = 1;
  while (usados.has(`${prefijo}-${k}`)) k++;
  return `${prefijo}-${k}`;
}

/** Tramo con 2 bocas de un producto recto, con colocación y definición. También lo usa la bajada a un equipo. */
export function troncoDe(entrada: TrayInput, productos: ReadonlyMap<string, Product>, id: string):
  { ok: true; piece: Piece; product: Product; def: StoredDefinition; L: number; familia: Familia } | { ok: false; motivo: string } {
  const piece = entrada.piezas.find((p) => p.instancia_id === id);
  if (!piece) return { ok: false, motivo: `el tronco ${id} no existe` };
  const prod = productos.get(piece.producto_id);
  if (!prod || prod.tipo_pieza !== 'recta' || typeof piece.longitud_mm !== 'number') return { ok: false, motivo: 'el tronco tiene que ser un tramo recto' };
  const placed = placedOf(entrada, piece);
  if (!placed) return { ok: false, motivo: 'el tronco no tiene colocación resuelta' };
  const familia = familiaDe(placed.def);
  if (!familia) return { ok: false, motivo: `familia del tronco no soportada (${placed.def.patron})` };
  return { ok: true, piece, product: prod, def: placed.def, L: piece.longitud_mm, familia };
}

/**
 * Punto sobre un tramo recto, elegido como el enganche de una derivación:
 * boca de referencia, distancia a lo largo del tramo desde su centro y lado.
 * Lo comparten la derivación en un tramo y la bajada a un equipo.
 */
export interface PuntoEnTramo {
  readonly tronco: string;
  readonly desde_boca: string;
  /** Desde el centro de `desde_boca`, a lo largo del tramo (mm). */
  readonly distancia_mm: number;
  readonly lado: Lado;
}

/**
 * Valida el punto (boca P1/P2, distancia dentro del tramo) y da su geometría:
 * A sobre el eje, F sobre el flanco del lado elegido, s hacia afuera, up de sección.
 */
export function geometriaPuntoEnTramo(entrada: TrayInput, productos: ReadonlyMap<string, Product>, p: PuntoEnTramo):
  | { ok: true; piece: Piece; product: Product; def: StoredDefinition; L: number; familia: Familia; A: V3; F: V3; s: V3; up: V3 }
  | { ok: false; motivo: string } {
  const t = troncoDe(entrada, productos, p.tronco);
  if (!t.ok) return t;
  const { piece, def, L } = t;
  if (!piece.puertos[p.desde_boca] || !['P1', 'P2'].includes(p.desde_boca)) return { ok: false, motivo: `el tronco no tiene la boca ${p.desde_boca}` };
  if (!(p.distancia_mm >= 0) || !(p.distancia_mm <= L)) return { ok: false, motivo: `la distancia ${fmt(p.distancia_mm)} mm está fuera del tronco (0–${fmt(L)} mm)` };
  const B = piece.puertos[p.desde_boca];
  const u = unit(mul(B.direccion, -1));
  const up = unit((B.orientacion_seccion_ws as V3 | undefined) ?? [0, 0, 1]);
  const izq = unit(cross(up, u));
  const s = p.lado === 'izquierda' ? izq : mul(izq, -1);
  const portT = def.ports.find((q) => q.name === p.desde_boca)!;
  const A = add(B.posicion_mm, mul(u, p.distancia_mm));
  const F = add(A, mul(s, portT.ancho_mm / 2));
  return { ...t, A, F, s, up };
}

/** Foto del tramo (largo y bocas) para avisar después si cambió. */
export function fotoTronco(piece: Piece): { longitud_mm: number; bocas: Record<string, BocaFoto> } {
  const bocas: Record<string, BocaFoto> = {};
  for (const [nombre, q] of Object.entries(piece.puertos)) {
    bocas[nombre] = {
      posicion_mm: [...q.posicion_mm] as V3,
      direccion: [...q.direccion] as V3,
      ...(q.orientacion_seccion_ws ? { orientacion_seccion_ws: [...q.orientacion_seccion_ws] as V3 } : {}),
    };
  }
  return { longitud_mm: piece.longitud_mm as number, bocas };
}

/** Motivos por los que un punto sobre el tramo quedó desactualizado: tramo borrado, de otro largo, movido o rotado. */
export function motivosTronco(entrada: TrayInput, tronco: string, ref: { readonly longitud_mm: number; readonly bocas: Readonly<Record<string, BocaFoto>> }): string[] {
  const motivos: string[] = [];
  const t = entrada.piezas.find((p) => p.instancia_id === tronco);
  if (!t) return [`el tronco ${tronco} ya no existe`];
  if (t.longitud_mm !== ref.longitud_mm) motivos.push(`el tronco cambió de largo (${fmt(ref.longitud_mm)} → ${fmt(t.longitud_mm ?? NaN)} mm)`);
  for (const [b, f] of Object.entries(ref.bocas)) {
    const q = t.puertos[b];
    if (!q) { motivos.push(`el tronco ya no tiene la boca ${b}`); break; }
    const d = norm(sub(q.posicion_mm, f.posicion_mm));
    const g = Math.max(angDeg(q.direccion, f.direccion), f.orientacion_seccion_ws && q.orientacion_seccion_ws ? angDeg(q.orientacion_seccion_ws, f.orientacion_seccion_ws) : 0);
    if (d > TOL_MOV || g > TOL_MOV) { motivos.push(`el tronco se movió o rotó (boca ${b}: ${d.toFixed(2)} mm, ${g.toFixed(2)}°)`); break; }
  }
  return motivos;
}

/** Longitud del tramo desde una de sus bocas hasta un punto sobre él (persistida: distancia guardada y largo del tramo). */
export function distanciaBocaAPunto(tronco: Piece, boca: string, p: Pick<PuntoEnTramo, 'desde_boca' | 'distancia_mm'>): number | null {
  if (typeof tronco.longitud_mm !== 'number') return null;
  return boca === p.desde_boca ? p.distancia_mm : tronco.longitud_mm - p.distancia_mm;
}

/** Intervalo que ocupa un enganche sobre el tronco, medido desde P1 (mm). */
function intervaloDesdeP1(desde: string, d: number, huella: number, L: number): [number, number] {
  const c = desde === 'P1' ? d : L - d;
  return [c - huella / 2, c + huella / 2];
}

/**
 * Crea el enganche y, en perforada, coloca la DCPS. Sólo eso: ninguna bandeja.
 * Devuelve el trazado nuevo o el motivo por el que no se puede. No modifica el tronco.
 */
export function crearEnganche(entrada: TrayInput, productos: ReadonlyMap<string, Product>, p: ParamsEnganche):
  { ok: true; entrada: TrayInput; enganche: Enganche } | { ok: false; motivo: string } {
  const t = geometriaPuntoEnTramo(entrada, productos, p);
  if (!t.ok) return t;
  const { piece, product: troncoProd, L, familia, F, s, up } = t;
  const ancho = p.ancho_mm;
  if (!(typeof ancho === 'number' && ancho > 0)) return { ok: false, motivo: 'elegí el ancho de la derivación' };

  // Accesorio por familia.
  let dcps: { prod: Product; def: StoredDefinition; huella: string; medidas: { huella_mm: number; profundidad_mm: number } } | null = null;
  let ref: Product | null = null;
  let huella_mm: number;
  let huella_procedencia: string;
  if (familia === 'perforada') {
    const prod = dcpsParaAncho(productos, ancho);
    if (!prod) return { ok: false, motivo: `no hay DCPS de ${ancho} mm en el catálogo` };
    const d = definicionEfectiva(prod);
    if (!d.ok) return { ok: false, motivo: `la DCPS ${prod.sku} no tiene definición: ${d.motivo}` };
    const medidas = medidasDCPS(d.def);
    dcps = { prod, def: d.def, huella: d.huella, medidas };
    huella_mm = medidas.huella_mm;
    huella_procedencia = `cara de apoyo de la ${prod.sku} (patrón ${d.def.patron})`;
  } else {
    ref = rectoDeReferencia(productos, troncoProd, ancho);
    if (!ref) return { ok: false, motivo: `no hay tramo recto de ${ancho} mm en la familia del tronco para continuar desde la boca` };
    huella_mm = ancho;
    huella_procedencia = 'escalera: el corte en obra ocupa el ancho de la derivación';
  }

  // Cabe en el tronco y no se superpone con otro enganche del mismo lado.
  const [a, b] = intervaloDesdeP1(p.desde_boca, p.distancia_mm, huella_mm, L);
  if (a < -1e-9 || b > L + 1e-9) {
    const exceso = a < 0 ? -a : b - L;
    const extremo = a < 0 ? 'P1' : 'P2';
    return { ok: false, motivo: `la huella de ${fmt(huella_mm)} mm no entra en el tronco: se pasa ${fmt(exceso)} mm del extremo ${extremo}` };
  }
  for (const e of enganchesOf(entrada)) {
    if (e.tronco !== p.tronco || e.lado !== p.lado) continue;
    const [c, d2] = intervaloDesdeP1(e.desde_boca, e.distancia_mm, e.huella_mm, L);
    const solape = Math.min(b, d2) - Math.max(a, c);
    if (solape > 1e-9) return { ok: false, motivo: `se superpone ${fmt(solape)} mm con el enganche ${e.id} del mismo lado` };
  }

  const ids = new Set(entrada.piezas.map((x) => x.instancia_id));
  const engId = idLibre(new Set(enganchesOf(entrada).map((e) => e.id)), 'ENG');
  let next: TrayInput = { ...entrada, piezas: [...entrada.piezas], conexiones: [...entrada.conexiones] };
  let accesorio: AccesorioEnganche;
  let salida: [string, string];
  let boca: BocaFoto | undefined;

  if (dcps) {
    const dcpsId = idLibre(ids, 'DER');
    const bocaPos = add(F, mul(s, dcps.medidas.profundidad_mm));
    const pl = placeDefinition({ def: dcps.def, huella: dcps.huella, mano: 'nativa', entryPortName: 'P1', startPos: bocaPos, entryDir: mul(s, -1), sectionUp: up });
    const procedencia = `profundidad de la cara de apoyo a la boca, medida sobre la definición de la ${dcps.prod.sku} (patrón ${dcps.def.patron})`;
    const pieza: Piece = {
      instancia_id: dcpsId,
      producto_id: dcps.prod.producto_id,
      puertos: puertosFromWorld(pl.ports),
      colocacion: {
        ...pl.colocacion,
        longitudes_eje: { [`P1|${BOCA_APOYO}`]: { mm: dcps.medidas.profundidad_mm, regla: 'profundidad_derivacion', procedencia } },
      },
    };
    next = withDefinition(next, dcps.huella, dcps.def);
    next.piezas.push(pieza);
    accesorio = { tipo: 'producto', producto_id: dcps.prod.producto_id, pieza: dcpsId, profundidad_mm: dcps.medidas.profundidad_mm, procedencia };
    salida = [dcpsId, BOCA_APOYO];
  } else {
    accesorio = { tipo: 'sin_accesorio_por_familia', familia: 'escalera', motivo: MOTIVO_SIN_ACCESORIO_ESCALERA };
    salida = ['', ''];
    boca = { posicion_mm: F, direccion: s, orientacion_seccion_ws: up };
  }

  const sob = dcps ? sobreanchoDeBoca(findMasterById(dcps.def.patron), ancho) : null;
  const advertencias = sob && !sob.confirmado ? [avisoCotaNoConfirmada(String(dcps!.prod.sku), sob)] : [];
  const enganche: Enganche = {
    id: engId, tronco: p.tronco, desde_boca: p.desde_boca, distancia_mm: p.distancia_mm, lado: p.lado,
    familia, ramal_ancho_mm: ancho, huella_mm, huella_procedencia, accesorio, salida,
    ...(boca ? { boca } : {}),
    ...(ref ? { ref_producto_id: ref.producto_id } : {}),
    ref_tronco: fotoTronco(piece),
    ...(advertencias.length ? { advertencias } : {}),
    creado_iso: new Date().toISOString(),
  };
  next = { ...next, [ENGANCHES_KEY]: [...enganchesOf(entrada), enganche] } as TrayInput;
  return { ok: true, entrada: next, enganche };
}

/** ¿La boca de escalera de este enganche está libre? (sin salida, o lo continuado ya no está). */
function bocaLibre(entrada: TrayInput, e: Enganche): boolean {
  if (e.familia !== 'escalera' || !e.boca) return false;
  return !e.salida[0] || !entrada.piezas.some((p) => p.instancia_id === e.salida[0]);
}

export interface BocaLibreEnganche {
  readonly pieceId: string;
  readonly portName: string;
  readonly pos: V3;
  readonly dir: V3;
  readonly sectionUp: V3;
}

/** Bocas de enganche de escalera libres y vigentes, como extremos para continuar (pieza = tronco, boca = `enganche:<id>`). */
export function bocasLibresDeEnganche(entrada: TrayInput | null | undefined): BocaLibreEnganche[] {
  if (!entrada) return [];
  return enganchesOf(entrada)
    .filter((e) => bocaLibre(entrada, e) && estadoEnganche(entrada, null, e).vigente)
    .map((e) => ({
      pieceId: e.tronco,
      portName: bocaEnganche(e.id),
      pos: [...e.boca!.posicion_mm] as V3,
      dir: [...e.boca!.direccion] as V3,
      sectionUp: [...(e.boca!.orientacion_seccion_ws ?? [0, 0, 1])] as V3,
    }));
}

/**
 * Producto y boca contra los que se decide qué se puede continuar desde
 * (pieza, boca). Para una boca de enganche: el recto de referencia del enganche,
 * por su boca P2. Para cualquier otra: el producto de la pieza y esa boca.
 */
export function origenDeBoca(entrada: TrayInput | null | undefined, productos: ReadonlyMap<string, Product>, pieceId: string, portName: string):
  { product: Product; portName: string } | null {
  const id = idDeBocaEnganche(portName);
  if (id) {
    const e = enganchesOf(entrada).find((x) => x.id === id && x.tronco === pieceId);
    const ref = e?.ref_producto_id ? productos.get(e.ref_producto_id) : undefined;
    return ref ? { product: ref, portName: 'P2' } : null;
  }
  const piece = entrada?.piezas.find((p) => p.instancia_id === pieceId);
  const product = piece ? productos.get(piece.producto_id) : undefined;
  return product ? { product, portName } : null;
}

/**
 * La continuación desde una boca de enganche arma una `conexion` contra
 * `enganche:<id>` (camino normal). Esa boca no es del catálogo ni viaja al motor:
 * la conexión se quita y lo continuado pasa a ser la `salida` del enganche.
 */
export function asentarSalidasDeEnganche(entrada: TrayInput): TrayInput {
  const engs = enganchesOf(entrada);
  if (!engs.length) return entrada;
  const salidas = new Map<string, [string, string]>();
  const quedan: TrayInput['conexiones'] = [];
  for (const c of entrada.conexiones) {
    const lados: Array<[readonly [string, string], readonly [string, string]]> = [[c.a, c.b], [c.b, c.a]];
    const hit = lados.find(([x]) => {
      const id = idDeBocaEnganche(x[1]);
      return id !== null && engs.some((e) => e.id === id && e.tronco === x[0]);
    });
    if (hit) salidas.set(idDeBocaEnganche(hit[0][1])!, [hit[1][0], hit[1][1]]);
    else quedan.push(c);
  }
  if (!salidas.size) return entrada;
  const nuevos = engs.map((e) => (salidas.has(e.id) ? { ...e, salida: salidas.get(e.id)! } : e));
  return { ...entrada, conexiones: quedan, [ENGANCHES_KEY]: nuevos } as TrayInput;
}

/**
 * Reglas del dato por familia (también el control negativo): perforada exige la
 * DCPS del ancho de la derivación resuelta; escalera exige "sin accesorio por familia".
 */
export function validarEnganche(entrada: TrayInput, productos: ReadonlyMap<string, Product> | null, e: Enganche): string[] {
  const motivos: string[] = [];
  if (e.familia === 'perforada') {
    if (e.accesorio.tipo !== 'producto') motivos.push('perforada sin DCPS resuelta');
    else if (productos) {
      const prod = productos.get(e.accesorio.producto_id);
      if (!prod || !String(prod.sku).startsWith('DCPS-')) motivos.push(`el accesorio ${e.accesorio.producto_id} no es una DCPS`);
      else if (prod.ancho_nominal_mm !== e.ramal_ancho_mm) motivos.push(`la DCPS es de ${prod.ancho_nominal_mm} mm y la derivación de ${e.ramal_ancho_mm} mm`);
      else if (!definicionEfectiva(prod).ok) motivos.push(`la DCPS ${prod.sku} no tiene definición`);
    }
    if (e.accesorio.tipo === 'producto' && !entrada.piezas.some((p) => p.instancia_id === (e.accesorio as { pieza: string }).pieza)) {
      motivos.push('la DCPS ya no está en el trazado');
    }
  } else if (e.accesorio.tipo !== 'sin_accesorio_por_familia') {
    motivos.push(`escalera no lleva accesorio y tiene asignado ${e.accesorio.producto_id}`);
  }
  return motivos;
}

const angDeg = (a: readonly number[], b: readonly number[]) => (Math.atan2(norm(cross(a, b)), dot(a, b)) * 180) / Math.PI;
const TOL_MOV = 1e-6;

/** ¿El enganche sigue valiendo? Si el tronco se movió, se acortó o se borró, o la DCPS ya no está: desactualizado con motivo. */
export function estadoEnganche(entrada: TrayInput, productos: ReadonlyMap<string, Product> | null, e: Enganche): { vigente: true } | { vigente: false; motivos: string[] } {
  const motivos = validarEnganche(entrada, productos, e);
  motivos.push(...motivosTronco(entrada, e.tronco, e.ref_tronco));
  // Escalera: si lo continuado desde la boca se borró, la boca vuelve a quedar libre (no es un error).
  // Un enganche de un proyecto anterior sin boca guardada (el ramal lo creaba la operación) sí lo informa.
  if (e.salida[0] && !entrada.piezas.some((p) => p.instancia_id === e.salida[0]) && e.accesorio.tipo !== 'producto' && !e.boca) {
    motivos.push('el ramal ya no está en el trazado');
  }
  const unicos = [...new Set(motivos)];
  return unicos.length ? { vigente: false, motivos: unicos } : { vigente: true };
}

/**
 * DCPS en el trazado que no son el accesorio de ningún enganche (p. ej. de un
 * proyecto anterior, colocadas como continuación de un recto): no derivan de
 * ningún tramo, así que no son válidas.
 */
export const MOTIVO_DCPS_HUERFANA = 'DCPS sin tronco anfitrión: no deriva de ningún tramo, no es válida. Borrala y creá la derivación con la herramienta "Derivación en tramo".';
export function dcpsHuerfanas(entrada: TrayInput | null | undefined): Array<{ pieza: string; motivo: string }> {
  if (!entrada) return [];
  const usadas = new Set(enganchesOf(entrada).flatMap((e) => (e.accesorio.tipo === 'producto' ? [e.accesorio.pieza] : [])));
  return entrada.piezas
    .filter((p) => !usadas.has(p.instancia_id) && placedOf(entrada, p)?.def.patron === 'master:perforada:derivacion_lateral')
    .map((p) => ({ pieza: p.instancia_id, motivo: MOTIVO_DCPS_HUERFANA }));
}

/** Bocas reales ocupadas por enganches ("pieza:boca"): no son extremos libres. */
export function bocasOcupadasPorEnganches(entrada: TrayInput | null | undefined): string[] {
  return enganchesOf(entrada)
    .filter((e) => entrada?.piezas.some((p) => p.instancia_id === e.salida[0] && p.puertos[e.salida[1]]))
    .map((e) => `${e.salida[0]}:${e.salida[1]}`);
}

/** Longitud del tronco desde una de sus bocas hasta el enganche (persistida: distancia guardada y largo del tronco). */
export function distanciaBocaAEnganche(tronco: Piece, boca: string, e: Enganche): number | null {
  return distanciaBocaAPunto(tronco, boca, e);
}

/** Firma de un enganche para detectar cambios desde que un circuito lo atravesó. */
export function firmaEnganche(e: Enganche): string {
  return JSON.stringify([e.tronco, e.desde_boca, e.distancia_mm, e.lado, e.ramal_ancho_mm, e.accesorio, e.salida]);
}
