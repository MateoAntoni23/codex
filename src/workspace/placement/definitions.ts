/**
 * definitions — definición efectiva VIGENTE de un producto (receta + calibración
 * de la biblioteca), con su huella, y la tabla de definiciones guardadas del
 * trazado (`definiciones_ws`).
 *
 * La pieza colocada referencia una definición guardada por huella; la vigente
 * sólo se usa para colocar piezas nuevas y para detectar desactualización (A-6).
 */
import type { Piece, Product, TrayInput } from '../../tray/model';
import { buildRecipeFromProduct, resolveRecipe } from '../parametricBridge';
import { resolveRecipeForProduct } from '../resolvedPortGeometry';
import { findMasterForProduct } from '../../configurator/masterModels';
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

export type DefinitionResult =
  | { ok: true; def: StoredDefinition; huella: string }
  | { ok: false; motivo: string };

/**
 * Definición efectiva vigente del producto. `longitud_mm` sólo aplica a tramos
 * rectos (largo editable). Error con motivo si el producto no tiene modelo o si
 * su contorno gira otro ángulo que el declarado (modelo no resuelto): una pieza
 * así no se coloca.
 */
export function resolveDefinition(product: Product, opts?: { longitud_mm?: number | null }): DefinitionResult {
  const d = buildDefinition(product, opts);
  if (!d.ok) return d;
  const bad = angleMismatch(d.def);
  return bad ? { ok: false, motivo: bad.motivo } : d;
}

/**
 * Definición construida SIN verificar el ángulo. Sólo para medir y diagnosticar
 * (p. ej. la prueba de ángulos); para colocar se usa `resolveDefinition`.
 */
export function buildDefinition(product: Product, opts?: { longitud_mm?: number | null }): DefinitionResult {
  const entry = resolveRecipe(product);
  if (!entry) return { ok: false, motivo: `sin modelo paramétrico para ${product.sku ?? product.producto_id}` };
  const takesLength = entry.piece_kind === 'tramo_recto' || entry.recipe === 'escalera:tramo_recto';
  const longitud = takesLength && opts?.longitud_mm && opts.longitud_mm > 0 ? opts.longitud_mm : null;
  let raw;
  try {
    raw = buildRecipeFromProduct(product, entry, longitud ? { longitud_mm: longitud } : undefined);
  } catch (e) {
    return { ok: false, motivo: `no se pudo construir la receta: ${e instanceof Error ? e.message : String(e)}` };
  }
  const resolved = resolveRecipeForProduct(raw, product.producto_id);
  const master = findMasterForProduct(product as Record<string, unknown>);
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
  });
  return { ok: true, def, huella: definitionHash(def) };
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
