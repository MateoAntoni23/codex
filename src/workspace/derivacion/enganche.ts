/**
 * Derivación en un tramo: una pieza se engancha a un punto intermedio del flanco
 * de un tramo recto, que NO se corta y NO cambia su longitud guardada.
 *
 * LA UNIÓN (común a perforada y escalera): el operador elige un tramo recto, una
 * boca de referencia, la distancia desde esa boca hasta el centro del enganche y
 * el lado. El ramal sale perpendicular al flanco. Su ancho NO tiene que coincidir
 * con el del tronco: la cuarta condición de B-3 no se aplica entre tronco y ramal
 * (el enganche no es una `conexion`); sí entre la boca del accesorio y el tramo
 * que se le conecta, que es una unión normal.
 *
 * EL ACCESORIO (por familia):
 *   - perforada → una DCPS del ANCHO DEL RAMAL, colocada con su cara de apoyo
 *     contra el flanco; es una pieza del trazado (el motor la computa) y el ramal
 *     se une a su boca P1. Sin DCPS de ese ancho → inválido con motivo.
 *   - escalera → sin accesorio, explícito en el dato
 *     ({ tipo: 'sin_accesorio_por_familia' }): se arma cortando en obra. El ramal
 *     queda enganchado directamente al flanco.
 *
 * Persistencia: clave workspace-only `enganches_ws` del trazado (no viaja al
 * motor). Cada enganche guarda la foto del tronco al crearlo; si el tronco se
 * mueve, se acorta o se borra, `estadoEnganche` lo informa desactualizado con el
 * motivo. Nunca se recalcula solo.
 */
import type { Piece, Product, TrayInput } from '../../tray/model';
import { definicionEfectiva, placedOf, withDefinition } from '../placement/definitions';
import { placeDefinition, puertosFromWorld, type StoredDefinition, type V3 } from '../placement/placementCore';

export const ENGANCHES_KEY = 'enganches_ws';
/** Pseudo-boca del tronco por la que sale/entra un recorrido hacia el ramal. */
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
  readonly ramal_ancho_mm: number;
  /** Largo que ocupa sobre el flanco del tronco (mm). */
  readonly huella_mm: number;
  readonly huella_procedencia: string;
  readonly accesorio: AccesorioEnganche;
  /** Por dónde sigue el recorrido del otro lado del enganche: [pieza, boca]. */
  readonly salida: readonly [string, string];
  /** Foto del tronco al crear el enganche (para avisar si cambia). */
  readonly ref_tronco: { readonly longitud_mm: number; readonly bocas: Readonly<Record<string, BocaFoto>> };
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

/** La DCPS de un ancho de ramal (perforada), o null. */
export function dcpsParaAncho(productos: ReadonlyMap<string, Product>, ancho: number): Product | null {
  for (const p of productos.values()) {
    if (String(p.sku).startsWith('DCPS-') && p.ancho_nominal_mm === ancho) return p;
  }
  return null;
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
  /** Tramo recto que sale como ramal (su ancho es el del ramal). */
  readonly ramal_producto_id: string;
  readonly ramal_longitud_mm: number;
}

function idLibre(usados: ReadonlySet<string>, prefijo: string): string {
  let k = 1;
  while (usados.has(`${prefijo}-${k}`)) k++;
  return `${prefijo}-${k}`;
}

/** Tramo con 2 bocas de un producto recto, con colocación y definición. */
function troncoDe(entrada: TrayInput, productos: ReadonlyMap<string, Product>, id: string):
  { ok: true; piece: Piece; def: StoredDefinition; L: number; familia: Familia } | { ok: false; motivo: string } {
  const piece = entrada.piezas.find((p) => p.instancia_id === id);
  if (!piece) return { ok: false, motivo: `el tronco ${id} no existe` };
  const prod = productos.get(piece.producto_id);
  if (prod?.tipo_pieza !== 'recta' || typeof piece.longitud_mm !== 'number') return { ok: false, motivo: 'el tronco tiene que ser un tramo recto' };
  const placed = placedOf(entrada, piece);
  if (!placed) return { ok: false, motivo: 'el tronco no tiene colocación resuelta' };
  const familia = familiaDe(placed.def);
  if (!familia) return { ok: false, motivo: `familia del tronco no soportada (${placed.def.patron})` };
  return { ok: true, piece, def: placed.def, L: piece.longitud_mm, familia };
}

/** Intervalo que ocupa un enganche sobre el tronco, medido desde P1 (mm). */
function intervaloDesdeP1(desde: string, d: number, huella: number, L: number): [number, number] {
  const c = desde === 'P1' ? d : L - d;
  return [c - huella / 2, c + huella / 2];
}

/**
 * Crea el enganche (y la DCPS en perforada) y el ramal. Devuelve el trazado nuevo
 * o el motivo por el que no se puede. No modifica el tronco.
 */
export function crearEnganche(entrada: TrayInput, productos: ReadonlyMap<string, Product>, p: ParamsEnganche):
  { ok: true; entrada: TrayInput; enganche: Enganche } | { ok: false; motivo: string } {
  const t = troncoDe(entrada, productos, p.tronco);
  if (!t.ok) return t;
  const { piece, def: defT, L, familia } = t;
  if (!piece.puertos[p.desde_boca] || !['P1', 'P2'].includes(p.desde_boca)) return { ok: false, motivo: `el tronco no tiene la boca ${p.desde_boca}` };
  if (!(p.distancia_mm >= 0) || !(p.distancia_mm <= L)) return { ok: false, motivo: `la distancia ${fmt(p.distancia_mm)} mm está fuera del tronco (0–${fmt(L)} mm)` };

  const ramalProd = productos.get(p.ramal_producto_id);
  if (!ramalProd || ramalProd.tipo_pieza !== 'recta' || typeof ramalProd.ancho_nominal_mm !== 'number') return { ok: false, motivo: 'el ramal tiene que ser un tramo recto con ancho declarado' };
  const ramalDef = definicionEfectiva(ramalProd, { longitud_mm: p.ramal_longitud_mm });
  if (!ramalDef.ok) return { ok: false, motivo: `el ramal no tiene definición: ${ramalDef.motivo}` };
  if (familiaDe(ramalDef.def) !== familia) return { ok: false, motivo: `el ramal (${familiaDe(ramalDef.def) ?? ramalDef.def.patron}) no es de la familia del tronco (${familia})` };
  const ancho = ramalProd.ancho_nominal_mm;

  // Accesorio por familia.
  let dcps: { prod: Product; def: StoredDefinition; huella: string; medidas: { huella_mm: number; profundidad_mm: number } } | null = null;
  let huella_mm: number;
  let huella_procedencia: string;
  if (familia === 'perforada') {
    const prod = dcpsParaAncho(productos, ancho);
    if (!prod) return { ok: false, motivo: `no hay DCPS de ${ancho} mm en el catálogo para el ramal` };
    const d = definicionEfectiva(prod);
    if (!d.ok) return { ok: false, motivo: `la DCPS ${prod.sku} no tiene definición: ${d.motivo}` };
    const medidas = medidasDCPS(d.def);
    dcps = { prod, def: d.def, huella: d.huella, medidas };
    huella_mm = medidas.huella_mm;
    huella_procedencia = `cara de apoyo de la ${prod.sku} (modelo medido / ley de escala, patrón ${d.def.patron})`;
  } else {
    huella_mm = ancho;
    huella_procedencia = 'escalera: el corte en obra ocupa el ancho del ramal';
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

  // Geometría: eje hacia adentro desde la boca de referencia, lado, flanco.
  const B = piece.puertos[p.desde_boca];
  const u = unit(mul(B.direccion, -1));
  const up = unit((B.orientacion_seccion_ws as V3 | undefined) ?? [0, 0, 1]);
  const izq = unit(cross(up, u));
  const s = p.lado === 'izquierda' ? izq : mul(izq, -1);
  const portT = defT.ports.find((q) => q.name === p.desde_boca)!;
  const A = add(B.posicion_mm, mul(u, p.distancia_mm));
  const F = add(A, mul(s, portT.ancho_mm / 2));

  const ids = new Set(entrada.piezas.map((x) => x.instancia_id));
  const engId = idLibre(new Set(enganchesOf(entrada).map((e) => e.id)), 'ENG');
  let next: TrayInput = { ...entrada, piezas: [...entrada.piezas], conexiones: [...entrada.conexiones] };
  let accesorio: AccesorioEnganche;
  let bocaRamal: { pos: V3; dir: V3 };
  let salida: [string, string];

  if (dcps) {
    const dcpsId = idLibre(ids, 'DER');
    ids.add(dcpsId);
    const bocaPos = add(F, mul(s, dcps.medidas.profundidad_mm));
    const pl = placeDefinition({ def: dcps.def, huella: dcps.huella, mano: 'nativa', entryPortName: 'P1', startPos: bocaPos, entryDir: mul(s, -1), sectionUp: up });
    const procedencia = `profundidad de la cara de apoyo a la boca, medida sobre la definición de la ${dcps.prod.sku} (patrón ${dcps.def.patron})`;
    const pieza: Piece = {
      instancia_id: dcpsId,
      producto_id: dcps.prod.producto_id,
      puertos: puertosFromWorld(pl.ports),
      colocacion: {
        ...pl.colocacion,
        longitudes_eje: { [`${'P1'}|${BOCA_APOYO}`]: { mm: dcps.medidas.profundidad_mm, regla: 'profundidad_derivacion', procedencia } },
      },
    };
    next = withDefinition(next, dcps.huella, dcps.def);
    next.piezas.push(pieza);
    accesorio = { tipo: 'producto', producto_id: dcps.prod.producto_id, pieza: dcpsId, profundidad_mm: dcps.medidas.profundidad_mm, procedencia };
    const p1 = pl.ports.find((q) => q.name === 'P1')!;
    bocaRamal = { pos: p1.pos, dir: p1.normal };
    salida = [dcpsId, BOCA_APOYO];
  } else {
    accesorio = { tipo: 'sin_accesorio_por_familia', familia: 'escalera', motivo: MOTIVO_SIN_ACCESORIO_ESCALERA };
    bocaRamal = { pos: F, dir: s };
    salida = ['', ''];
  }

  // Ramal: tramo recto saliendo de la boca, perpendicular al flanco.
  const ramalId = idLibre(ids, 'RAM');
  const plR = placeDefinition({ def: ramalDef.def, huella: ramalDef.huella, mano: 'nativa', entryPortName: 'P1', startPos: bocaRamal.pos, entryDir: bocaRamal.dir, sectionUp: up });
  next = withDefinition(next, ramalDef.huella, ramalDef.def);
  next.piezas.push({ instancia_id: ramalId, producto_id: ramalProd.producto_id, longitud_mm: p.ramal_longitud_mm, puertos: puertosFromWorld(plR.ports), colocacion: plR.colocacion });
  if (dcps) {
    const conIds = new Set(next.conexiones.map((c) => c.conexion_id));
    next.conexiones.push({ conexion_id: idLibre(conIds, 'CON-DER'), a: [accesorio.tipo === 'producto' ? accesorio.pieza : '', 'P1'], b: [ramalId, 'P1'] });
  } else {
    salida = [ramalId, 'P1'];
  }

  const fotos: Record<string, BocaFoto> = {};
  for (const [nombre, q] of Object.entries(piece.puertos)) {
    fotos[nombre] = {
      posicion_mm: [...q.posicion_mm] as V3,
      direccion: [...q.direccion] as V3,
      ...(q.orientacion_seccion_ws ? { orientacion_seccion_ws: [...q.orientacion_seccion_ws] as V3 } : {}),
    };
  }
  const enganche: Enganche = {
    id: engId, tronco: p.tronco, desde_boca: p.desde_boca, distancia_mm: p.distancia_mm, lado: p.lado,
    familia, ramal_ancho_mm: ancho, huella_mm, huella_procedencia, accesorio, salida,
    ref_tronco: { longitud_mm: L, bocas: fotos },
    creado_iso: new Date().toISOString(),
  };
  next = { ...next, [ENGANCHES_KEY]: [...enganchesOf(entrada), enganche] } as TrayInput;
  return { ok: true, entrada: next, enganche };
}

/**
 * Reglas del dato por familia (también el control negativo): perforada exige la
 * DCPS del ancho del ramal resuelta; escalera exige "sin accesorio por familia".
 */
export function validarEnganche(entrada: TrayInput, productos: ReadonlyMap<string, Product> | null, e: Enganche): string[] {
  const motivos: string[] = [];
  if (e.familia === 'perforada') {
    if (e.accesorio.tipo !== 'producto') motivos.push('perforada sin DCPS resuelta');
    else if (productos) {
      const prod = productos.get(e.accesorio.producto_id);
      if (!prod || !String(prod.sku).startsWith('DCPS-')) motivos.push(`el accesorio ${e.accesorio.producto_id} no es una DCPS`);
      else if (prod.ancho_nominal_mm !== e.ramal_ancho_mm) motivos.push(`la DCPS es de ${prod.ancho_nominal_mm} mm y el ramal de ${e.ramal_ancho_mm} mm`);
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

/** ¿El enganche sigue valiendo? Si el tronco se movió, se acortó o se borró, o el ramal ya no está: desactualizado con motivo. */
export function estadoEnganche(entrada: TrayInput, productos: ReadonlyMap<string, Product> | null, e: Enganche): { vigente: true } | { vigente: false; motivos: string[] } {
  const motivos = validarEnganche(entrada, productos, e);
  const t = entrada.piezas.find((p) => p.instancia_id === e.tronco);
  if (!t) motivos.push(`el tronco ${e.tronco} ya no existe`);
  else {
    if (t.longitud_mm !== e.ref_tronco.longitud_mm) motivos.push(`el tronco cambió de largo (${fmt(e.ref_tronco.longitud_mm)} → ${fmt(t.longitud_mm ?? NaN)} mm)`);
    for (const [b, f] of Object.entries(e.ref_tronco.bocas)) {
      const q = t.puertos[b];
      if (!q) { motivos.push(`el tronco ya no tiene la boca ${b}`); break; }
      const d = norm(sub(q.posicion_mm, f.posicion_mm));
      const g = Math.max(angDeg(q.direccion, f.direccion), f.orientacion_seccion_ws && q.orientacion_seccion_ws ? angDeg(q.orientacion_seccion_ws, f.orientacion_seccion_ws) : 0);
      if (d > TOL_MOV || g > TOL_MOV) { motivos.push(`el tronco se movió o rotó (boca ${b}: ${d.toFixed(2)} mm, ${g.toFixed(2)}°)`); break; }
    }
  }
  if (e.salida[0] && !entrada.piezas.some((p) => p.instancia_id === e.salida[0])) {
    motivos.push(e.accesorio.tipo === 'producto' ? 'la DCPS ya no está en el trazado' : 'el ramal ya no está en el trazado');
  }
  const unicos = [...new Set(motivos)];
  return unicos.length ? { vigente: false, motivos: unicos } : { vigente: true };
}

/** Bocas reales ocupadas por enganches ("pieza:boca"): no son extremos libres. */
export function bocasOcupadasPorEnganches(entrada: TrayInput | null | undefined): string[] {
  return enganchesOf(entrada)
    .filter((e) => entrada?.piezas.some((p) => p.instancia_id === e.salida[0] && p.puertos[e.salida[1]]))
    .map((e) => `${e.salida[0]}:${e.salida[1]}`);
}

/** Longitud del tronco desde una de sus bocas hasta el enganche (persistida: distancia guardada y largo del tronco). */
export function distanciaBocaAEnganche(tronco: Piece, boca: string, e: Enganche): number | null {
  if (typeof tronco.longitud_mm !== 'number') return null;
  return boca === e.desde_boca ? e.distancia_mm : tronco.longitud_mm - e.distancia_mm;
}

/** Firma de un enganche para detectar cambios desde que un circuito lo atravesó. */
export function firmaEnganche(e: Enganche): string {
  return JSON.stringify([e.tronco, e.desde_boca, e.distancia_mm, e.lado, e.ramal_ancho_mm, e.accesorio, e.salida]);
}
