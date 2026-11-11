/**
 * definitions — definición efectiva VIGENTE de un producto (receta + calibración
 * de la biblioteca), con su huella, y la tabla de definiciones guardadas del
 * trazado (`definiciones_ws`).
 *
 * La pieza colocada referencia una definición guardada por huella; la vigente
 * sólo se usa para colocar piezas nuevas y para detectar desactualización (A-6).
 *
 * B-2 — CAMINO ÚNICO: `definicionEfectiva` es la única puerta a la geometría de
 * un producto para el espacio de trabajo y el configurador (preview,
 * confirmación, render, configurador y adaptador del motor). Ningún otro módulo
 * de esos árboles construye recetas ni lee contornos por su cuenta;
 * `caminoUnicoGeometria.test.ts` lo verifica. `modeloDeProducto` sólo clasifica
 * (tipo de pieza, si es colocable) y no entrega geometría.
 */
import type { Piece, Product, TrayInput } from '../../tray/model';
import { buildRecipeFromProduct, datosFaltantesParaMaestro, resolveParametricEntry, resolveRecipe } from '../parametricBridge';
import { calibracionVersion } from '../catalogPortMapping';
import type { PieceKind } from '../../parametric/geometry/recipes';
import { calibrarReceta } from './calibrarReceta';
import { bibliotecaVersion } from '../calibracionPatron';
import { findMasterForProduct, MASTER_MODELS } from '../../configurator/masterModels';
import { angleMismatch } from './angleCheck';
import {
  definitionFromRecipe,
  definitionHash,
  puertosFromWorld,
  worldPorts,
  type Colocacion,
  type ColocacionResuelta,
  type StoredDefinition,
} from './placementCore';

export const DEFINITIONS_KEY = 'definiciones_ws';

/**
 * Curva de ángulo ajustable (p. ej. CAS, "CURVA AJUSTABLE (Adjustable Elbow)",
 * observación "Ángulo ajustable: rango no declarado"). El ángulo lo fija el
 * montaje: debería ser un parámetro de la instancia elegido al colocar, como
 * `longitud_mm` de un tramo (pendiente; hasta entonces no hay definición).
 */
export const MOTIVO_ANGULO_AJUSTABLE =
  'curva de ángulo ajustable: el ángulo lo fija el montaje, no el producto. Hace falta indicarlo al colocar la pieza.';

export function esAnguloAjustable(product: Product): boolean {
  const r = product as unknown as Record<string, unknown>;
  return /ajustable/i.test(String(r.descripcion_original ?? '')) || /[áa]ngulo ajustable/i.test(String(r.observaciones ?? ''));
}

export type DefinitionResult =
  | { ok: true; def: StoredDefinition; huella: string; calibrada?: boolean }
  | { ok: false; motivo: string };

/** Clasificación del modelo de un producto (sin geometría). */
export interface ModeloInfo {
  /** Id del maestro (o de la receta, si no hay maestro). */
  readonly patron: string;
  /** Tipo de pieza del modelo. */
  readonly tipo: PieceKind;
  /** Clave de receta del maestro (p. ej. 'tramo_recto', 'escalera:tramo_recto'). */
  readonly recipeKey: string;
  /** El flujo interactivo sabe colocar hoy este tipo de pieza. */
  readonly colocable: boolean;
}

export type DefinicionEfectiva =
  | {
      ok: true; def: StoredDefinition; huella: string; modelo: ModeloInfo;
      /** La definición lleva una calibración de la biblioteca (marco o bocas). */
      calibrada: boolean;
    }
  | { ok: false; motivo: string; modelo: ModeloInfo | null };

/**
 * Clasificación del modelo del producto: tipo de pieza y si es colocable. No
 * entrega geometría (para eso, `definicionEfectiva`). null = sin modelo.
 */
export function modeloDeProducto(product: Product | null | undefined): ModeloInfo | null {
  if (!product) return null;
  const entry = resolveParametricEntry(product);
  if (!entry) return null;
  const master = findMasterForProduct(product as Record<string, unknown>);
  return {
    patron: master?.id ?? String(entry.recipe),
    tipo: entry.piece_kind,
    recipeKey: String(entry.recipe),
    colocable: resolveRecipe(product) !== null,
  };
}

/** Tramo recto (largo editable), perforada o escalera. */
export function esTramoRecto(m: ModeloInfo | null | undefined): boolean {
  return m?.tipo === 'tramo_recto' || m?.recipeKey === 'escalera:tramo_recto';
}

const MEMO = new Map<string, DefinicionEfectiva>();
const MEMO_MAX = 2000;

function claveMemo(product: Product, longitud: number | null | undefined): string {
  const r = product as unknown as Record<string, unknown>;
  return JSON.stringify([
    calibracionVersion(), bibliotecaVersion(), product.producto_id, product.sku, r.familia_id, product.tipo_pieza, product.ancho_nominal_mm,
    r.ala_nominal_mm, r.longitud_comercial_mm, r.angulo_grados, r.descripcion_original, r.observaciones, longitud ?? null,
  ]);
}

/**
 * DEFINICIÓN EFECTIVA de un producto: la única función que entrega geometría
 * (B-2). Devuelve la definición con su huella y la clasificación del modelo, o
 * un error con motivo (sin modelo, dato del catálogo que falta, ángulo que no
 * coincide…). Pura respecto de (producto, opciones, estado de calibración):
 * el resultado se memoriza con la versión de ese estado.
 *
 * `longitud_mm` sólo aplica a tramos rectos (largo editable).
 */
export function definicionEfectiva(product: Product, opts?: { longitud_mm?: number | null }): DefinicionEfectiva {
  const key = claveMemo(product, opts?.longitud_mm);
  const hit = MEMO.get(key);
  if (hit) return hit;
  const modelo = modeloDeProducto(product);
  const d = buildDefinition(product, opts);
  let out: DefinicionEfectiva;
  if (!d.ok) out = { ok: false, motivo: d.motivo, modelo };
  else {
    const bad = angleMismatch(d.def);
    out = bad || !modelo
      ? { ok: false, motivo: bad?.motivo ?? 'sin modelo', modelo }
      : { ok: true, def: d.def, huella: d.huella, modelo, calibrada: d.calibrada === true };
  }
  if (MEMO.size >= MEMO_MAX) MEMO.clear();
  MEMO.set(key, out);
  return out;
}

/** El producto tiene definición efectiva (se puede colocar). */
export function tieneDefinicion(product: Product | null | undefined): boolean {
  return !!product && definicionEfectiva(product).ok;
}

/**
 * Definición efectiva vigente del producto (alias histórico de
 * `definicionEfectiva`). Error con motivo si el producto no tiene modelo o si
 * su contorno gira otro ángulo que el declarado (modelo no resuelto).
 */
export function resolveDefinition(product: Product, opts?: { longitud_mm?: number | null }): DefinitionResult {
  const d = definicionEfectiva(product, opts);
  return d.ok ? { ok: true, def: d.def, huella: d.huella } : { ok: false, motivo: d.motivo };
}

/**
 * Definición construida SIN verificar el ángulo. Sólo para medir y diagnosticar
 * (p. ej. la prueba de ángulos); para colocar se usa `resolveDefinition`.
 */
export function buildDefinition(product: Product, opts?: { longitud_mm?: number | null }): DefinitionResult {
  const entry = resolveRecipe(product);
  if (!entry) {
    if (esAnguloAjustable(product) && typeof (product as unknown as Record<string, unknown>).angulo_grados !== 'number') {
      // El catálogo no omite el ángulo: declara que la pieza no tiene uno fijo.
      return { ok: false, motivo: MOTIVO_ANGULO_AJUSTABLE };
    }
    const master = findMasterForProduct(product as Record<string, unknown>) ?? masterIgnorandoAla(product);
    const faltan = master ? datosFaltantesParaMaestro(master, product) : [];
    const sku = product.sku ?? product.producto_id;
    return {
      ok: false,
      motivo: faltan.length
        ? `sin definición para ${sku}: el catálogo no declara ${faltan.join(', ')}`
        : `sin modelo paramétrico para ${sku}`,
    };
  }
  const takesLength = entry.piece_kind === 'tramo_recto' || entry.recipe === 'escalera:tramo_recto';
  const longitud = takesLength && opts?.longitud_mm && opts.longitud_mm > 0 ? opts.longitud_mm : null;
  let raw;
  try {
    raw = buildRecipeFromProduct(product, entry, longitud ? { longitud_mm: longitud } : undefined);
  } catch (e) {
    return { ok: false, motivo: `no se pudo construir la receta: ${e instanceof Error ? e.message : String(e)}` };
  }
  const master = findMasterForProduct(product as Record<string, unknown>);
  // B-2.5: calibración POR PATRÓN (corrección por boca en sus ejes), no por SKU.
  const resolved = calibrarReceta(raw, product, master);
  const params: Record<string, number> = {};
  const r = product as Record<string, unknown>;
  if (typeof product.ancho_nominal_mm === 'number') params.ancho_mm = product.ancho_nominal_mm;
  if (typeof r.ala_nominal_mm === 'number') params.ala_mm = r.ala_nominal_mm as number;
  if (takesLength) {
    const L = longitud ?? (typeof r.longitud_comercial_mm === 'number' ? (r.longitud_comercial_mm as number) : null);
    if (L) params.longitud_mm = L;
  }
  if (typeof r.angulo_grados === 'number') params.angulo_deg = r.angulo_grados as number;
  const def = definitionFromRecipe({
    patron: master?.id ?? String(entry.recipe),
    revision: master ? String(master.revision) : String(entry.source_version ?? 'legacy'),
    params,
    raw,
    resolved: resolved.recipe,
    preTransform: resolved.preTransform,
    ...(resolved.info ? { calibracion: resolved.info } : {}),
  });
  return { ok: true, def, huella: definitionHash(def), calibrada: resolved.calibrada };
}

/**
 * Maestro que correspondería al producto si declarara ala: sólo para nombrar en
 * el motivo el dato que falta. No habilita ninguna definición.
 */
function masterIgnorandoAla(product: Product) {
  const r = product as unknown as Record<string, unknown>;
  if (typeof r.ala_nominal_mm === 'number') return null;
  const alas = new Set<number>();
  for (const m of MASTER_MODELS) if (typeof m.catalogMatch.catalogAlaMm === 'number') alas.add(m.catalogMatch.catalogAlaMm);
  for (const ala of alas) {
    const m = findMasterForProduct({ ...r, ala_nominal_mm: ala });
    if (m) return m;
  }
  return null;
}

/** Largo de un tramo a partir de su definición guardada (si aplica). */
export function storedLength(piece: Piece): number | null {
  const c = piece.colocacion as Colocacion | undefined;
  return c?.estado === 'resuelta' && typeof c.definicion.params.longitud_mm === 'number' ? c.definicion.params.longitud_mm : null;
}

export function definitionsOf(entrada: TrayInput | null | undefined): Record<string, StoredDefinition> {
  const t = entrada?.[DEFINITIONS_KEY];
  return t && typeof t === 'object' ? (t as Record<string, StoredDefinition>) : {};
}

/** Colocación resuelta de la pieza con su definición guardada, o null. */
export function placedOf(
  entrada: TrayInput | null | undefined,
  piece: Piece,
): { colocacion: ColocacionResuelta; def: StoredDefinition } | null {
  const c = piece.colocacion as Colocacion | undefined;
  if (!c || c.estado !== 'resuelta') return null;
  const def = definitionsOf(entrada)[c.definicion.huella];
  return def ? { colocacion: c, def } : null;
}

/** Copia del trazado con la definición registrada en la tabla (no muta). */
export function withDefinition(entrada: TrayInput, huella: string, def: StoredDefinition): TrayInput {
  const table = { ...definitionsOf(entrada) };
  if (!table[huella]) table[huella] = def;
  return { ...entrada, [DEFINITIONS_KEY]: table } as TrayInput;
}

/**
 * Piezas cuya definición guardada difiere de la vigente (la biblioteca cambió
 * después de colocarlas). La pieza no cambia hasta que se acepte actualizar.
 */
export function outdatedPieces(entrada: TrayInput, products: ReadonlyMap<string, Product>): Array<{ id: string; current: DefinitionResult }> {
  const out: Array<{ id: string; current: DefinitionResult }> = [];
  for (const piece of entrada.piezas) {
    const c = piece.colocacion as Colocacion | undefined;
    if (!c || c.estado !== 'resuelta') continue;
    const product = products.get(piece.producto_id);
    if (!product) continue;
    const current = resolveDefinition(product, { longitud_mm: c.definicion.params.longitud_mm ?? null });
    if (current.ok && current.huella !== c.definicion.huella) out.push({ id: piece.instancia_id, current });
  }
  return out;
}

/**
 * Acción explícita "actualizar N piezas" (A-6): adopta la definición vigente
 * conservando la pose (misma posición y rotación) y re-deriva las bocas. Devuelve
 * el trazado nuevo (para un único `edit`, deshacible) y las uniones que dejaron
 * de cumplir, que el llamador informa.
 */
export function updateOutdatedPieces(
  entrada: TrayInput,
  products: ReadonlyMap<string, Product>,
  ids?: ReadonlySet<string>,
): { entrada: TrayInput; updated: string[] } {
  const outdated = outdatedPieces(entrada, products).filter((o) => !ids || ids.has(o.id));
  let next: TrayInput = { ...entrada, piezas: [...entrada.piezas] };
  const updated: string[] = [];
  for (const o of outdated) {
    if (!o.current.ok) continue;
    const idx = next.piezas.findIndex((p) => p.instancia_id === o.id);
    const piece = next.piezas[idx];
    const c = piece.colocacion as ColocacionResuelta;
    const colocacion: ColocacionResuelta = {
      ...c,
      definicion: { huella: o.current.huella, patron: o.current.def.patron, revision: o.current.def.revision, params: { ...o.current.def.params } },
    };
    next = withDefinition(next, o.current.huella, o.current.def);
    next.piezas[idx] = {
      ...piece,
      colocacion,
      puertos: puertosFromWorld(worldPorts(o.current.def, c.mano, c.pose)),
    };
    updated.push(o.id);
  }
  return { entrada: next, updated };
}
