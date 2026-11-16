/**
 * Segregación con banda divisoria (etapa 3, parte B, 2026-11-14).
 *
 * El operador separa potencia de maniobra e instrumentación con una banda
 * divisoria a lo largo de un tramo recto. Piezas del catálogo (tipo «separador»,
 * familia SAM-SMT-ACC, compatibles SÓLO con rectas, «accesorio interior»):
 *   - escalera: BDS090G / BDS115G (espesor 1,24 mm), BDS090Z / BDS115Z (0,71 mm),
 *     por ala (90 / 115);
 *   - perforada: BDS01Z, código único SIN espesor publicado en el catálogo. Su
 *     espesor es 0,71 mm DECLARADO POR EL OPERADOR (2026-11-14) por analogía con
 *     la chapa de la bandeja perforada — no medido (`ESPESORES_DECLARADOS`).
 *
 * REGLA DEL OPERADOR, declarada con esa procedencia (`PROCEDENCIA_REGLA`):
 *   - al ancho útil se le descuenta primero el espesor de la banda;
 *   - lo que queda se reparte entre los grupos SEGÚN LA CANTIDAD DE CABLES de
 *     cada grupo (no mitad y mitad).
 *
 * CONDICIÓN DEL OPERADOR: EL MOTOR NO DEBE SABER QUE LA BANDA EXISTE. Se guarda
 * en la clave workspace-only `bandas_ws` (no viaja: `tray/store.ts` WS_ONLY); no
 * se declara como accesorio ni se cambia el ancho de la bandeja. Por eso la
 * ocupación de una bandeja segregada la calcula la APP (`ocupacionSegregada`) y
 * se muestra como cálculo de la app, distinguida de lo que calculó el motor —la
 * misma separación que los componentes de unión agregados por la app—. La
 * ocupación que el motor calcula para esa pieza (sin banda) no se usa.
 *
 * Grupos: potencia | maniobra + instrumentación. El PE va en el grupo de
 * potencia y cuenta como un cable: REGLA DECLARADA POR EL OPERADOR (2026-11-14,
 * `CRITERIO_PE`): el conductor de protección va con el sistema de potencia y
 * ocupa ancho como cualquier cable.
 *
 * Criterios de la app (declarados, no del operador):
 *   - Ancho útil = el del catálogo si existe, si no el nominal (como el motor,
 *     D-04). Ocupación de cada grupo: cables en contacto en una capa
 *     (W = Σ n·D, como D-02). Reserva con el criterio del motor (D-05:
 *     W ≤ (1 − r)·W_grupo) sobre el ancho del grupo. Altura: el diámetro mayor
 *     contra el ala nominal (como el motor, D-08).
 *   - Espesor: el del catálogo; si no lo publica, el declarado por el operador
 *     con su procedencia (BDS01Z). Sin ninguno de los dos no se calcula: NO
 *     VERIFICABLE, con el motivo.
 *
 * Cómputo: una banda por tramo segregado (la banda SÍ se computa). El catálogo no
 * publica longitud comercial ni unidad de compra: se informa la longitud a cubrir.
 */
import type { CatalogCompatibility, Product, TrayInput } from '../../tray/model';
import type { EquipmentElement } from '../../types/domain-v2';
import { isNeutralPe } from '../../project/emptyProject';
import { circuitosOf, estadoCircuito, TEXTO_FUNCION } from '../recorridos/circuitosGuardados';
import { cablesDelCircuito } from '../../conexiones/tendidos';
import type { ImportedCatalog } from '../../import/types';
import type { CableCatalogo } from '../cables/catalogoCables';
import { PE_CABLE_ID, peDelTrazado } from '../motor/paraMotor';
import type { CableDeclarado } from '../../conductores/biblioteca';

export const BANDAS_KEY = 'bandas_ws';

export const PROCEDENCIA_REGLA =
  'Regla declarada por el operador (2026-11-13): al ancho útil se le descuenta primero el espesor de la banda divisoria, y lo que queda se reparte entre los grupos según la cantidad de cables de cada grupo (no mitad y mitad).';
export const PROCEDENCIA_CALCULO =
  'Cálculo de la app, no del motor: el motor no sabe que la banda existe (condición del operador); no se le declara, no se le cambia el ancho y no viaja en el trazado. La ocupación que el motor calcula para esta pieza (sin banda) no se usa.';
export const CRITERIO_PE =
  'Regla declarada por el operador (2026-11-14): el PE va en el grupo de potencia y cuenta como un cable más en el reparto; el conductor de protección va con el sistema de potencia y ocupa ancho como cualquier cable.';
export const CRITERIO_OCUPACION =
  'Cada grupo: cables en contacto en una sola capa, W = Σ n·D (como D-02 del motor); reserva con el criterio del motor (D-05: W ≤ (1 − r)·W_grupo) sobre el ancho del grupo; altura contra el ala nominal (D-08).';
export const NOTA_COMPUTO =
  'Una banda por tramo segregado. El catálogo no publica longitud comercial ni unidad de compra de la banda: se informa la longitud a cubrir. La fijación (JB-CC-M6 en escalera) no declara cantidad.';

/**
 * Espesores de banda que el catálogo no publica, declarados por el operador.
 * BDS01Z: 0,71 mm por analogía con la chapa de la bandeja perforada; no es una medida.
 */
export const ESPESORES_DECLARADOS: Readonly<Record<string, { readonly mm: number; readonly procedencia: string }>> = {
  SAM_BDS01Z: {
    mm: 0.71,
    procedencia: 'declarado por el operador (2026-11-14) por analogía con la chapa de la bandeja perforada; no medido',
  },
};

/** Espesor de una banda: el del catálogo o, si no lo publica, el declarado por el operador. null si no hay ninguno. */
export function espesorDeBanda(p: Product | undefined): { mm: number; procedencia: string } | null {
  if (!p) return null;
  const e = (p as Record<string, unknown>).espesor_chapa_mm;
  if (typeof e === 'number' && e > 0) return { mm: e, procedencia: 'catálogo' };
  return ESPESORES_DECLARADOS[p.producto_id] ?? null;
}

export interface Banda { readonly pieza: string; readonly producto_id: string; readonly creado_iso: string }

export function bandasOf(entrada: TrayInput | null | undefined): Banda[] {
  const t = (entrada as Record<string, unknown> | null | undefined)?.[BANDAS_KEY];
  return Array.isArray(t) ? (t as Banda[]) : [];
}
export const bandaDePieza = (entrada: TrayInput | null | undefined, pieza: string) => bandasOf(entrada).find((b) => b.pieza === pieza) ?? null;
const conBandas = (entrada: TrayInput, lista: readonly Banda[]) => ({ ...entrada, [BANDAS_KEY]: lista }) as TrayInput;

/** Bandas del catálogo compatibles con el producto de una pieza (accesorio interior, confirmadas). */
export function bandasCompatibles(
  productoPieza: string,
  compatibilidades: readonly CatalogCompatibility[],
  productos: ReadonlyMap<string, Product>,
): Product[] {
  const ids = new Set<string>();
  for (const c of compatibilidades) {
    const r = c as unknown as Record<string, unknown>;
    if (r.producto_b_id !== productoPieza || r.tipo_conexion !== 'accesorio interior' || r.estado_compatibilidad !== 'confirmada') continue;
    const a = productos.get(String(r.producto_a_id));
    if (a && a.tipo_pieza === 'separador') ids.add(a.producto_id);
  }
  return [...ids].sort().map((id) => productos.get(id)!);
}

export function colocarBanda(
  entrada: TrayInput,
  pieza: string,
  productoBanda: string,
  compatibilidades: readonly CatalogCompatibility[],
  productos: ReadonlyMap<string, Product>,
): { ok: true; entrada: TrayInput } | { ok: false; motivo: string } {
  const p = entrada.piezas.find((x) => x.instancia_id === pieza);
  if (!p) return { ok: false, motivo: `la pieza ${pieza} no existe` };
  if (productos.get(p.producto_id)?.tipo_pieza !== 'recta') return { ok: false, motivo: 'la banda divisoria va sólo en tramos rectos' };
  const compat = bandasCompatibles(p.producto_id, compatibilidades, productos);
  if (!compat.some((b) => b.producto_id === productoBanda)) {
    return { ok: false, motivo: compat.length ? 'esa banda no es compatible con este tramo' : 'el catálogo no tiene banda divisoria compatible con este tramo' };
  }
  if (bandaDePieza(entrada, pieza)) return { ok: false, motivo: 'este tramo ya tiene banda divisoria' };
  return { ok: true, entrada: conBandas(entrada, [...bandasOf(entrada), { pieza, producto_id: productoBanda, creado_iso: new Date().toISOString() }]) };
}

export function quitarBanda(entrada: TrayInput, pieza: string): TrayInput {
  return conBandas(entrada, bandasOf(entrada).filter((b) => b.pieza !== pieza));
}

// ─── Ocupación de una bandeja segregada (cálculo de la app) ──────────────────

export type Grupo = 'potencia' | 'control';
export const TEXTO_GRUPO: Readonly<Record<Grupo, string>> = { potencia: 'Potencia', control: 'Maniobra e instrumentación' };

export interface CableEnGrupo {
  readonly origen: string;
  readonly cable_id: string;
  readonly cantidad: number;
  readonly diametro_mm: number;
  /** Cable declarado por el operador (biblioteca de conductores): diámetro declarado, no del catálogo del motor. */
  readonly declarado?: boolean;
}
export interface OcupacionGrupo {
  readonly grupo: Grupo;
  readonly cables: readonly CableEnGrupo[];
  readonly n_cables: number;
  readonly ancho_asignado_mm: number;
  readonly ancho_ocupado_mm: number;
  readonly diametro_max_mm: number;
  readonly reserva_libre_pct: number | null;
  readonly cabe: boolean;
  readonly cumple_reserva: boolean | null;
  readonly estado: 'CUMPLE' | 'NO_CUMPLE_ANCHO' | 'NO_CUMPLE_RESERVA' | 'NO_CUMPLE_ALTURA' | 'NO_VERIFICABLE_SIN_RESERVA' | 'SIN_CABLES';
}

/** Un cable declarado por el operador que pasa por la pieza (biblioteca de conductores, parte B). */
export interface DeclaradoEnPieza {
  readonly cable_id: string;
  readonly designacion: string;
  readonly diametro_mm: number | null;
  readonly grupos: readonly Grupo[];
  /** Tendidos (etiquetas) que lo llevan por esta pieza. */
  readonly tendidos: readonly string[];
}

export type OcupacionSegregada =
  | {
      readonly pieza: string; readonly banda: string; readonly calculada: true;
      readonly espesor_banda_mm: number; readonly espesor_procedencia: string; readonly ancho_util_mm: number; readonly base_ancho: 'util' | 'nominal';
      readonly ancho_disponible_mm: number; readonly ala_mm: number | null; readonly reserva_solicitada_pct: number | null;
      readonly grupos: readonly OcupacionGrupo[];
      readonly excluidos: ReadonlyArray<{ nombre: string; motivo: string }>;
      /** Declarados que pasan por la pieza (entran en la suma con su diámetro declarado). */
      readonly declarados: readonly DeclaradoEnPieza[];
    }
  | { readonly pieza: string; readonly banda: string; readonly calculada: false; readonly motivo: string; readonly declarados?: readonly DeclaradoEnPieza[] };

const red = (x: number) => Math.round(x * 1000) / 1000;

/** Excel, catálogo de cables y declarados del operador (conexiones importadas, etapa 2; biblioteca de conductores, parte B). */
export interface DatosOcupacion {
  readonly catalog: ImportedCatalog | null;
  readonly cables: readonly CableCatalogo[];
  readonly declarados?: readonly CableDeclarado[];
}

/** Lo que cruza una pieza, por grupo, con lo que no se cuenta y los declarados. */
export interface CrucesDePieza {
  readonly cables: Readonly<Record<Grupo, CableEnGrupo[]>>;
  readonly excluidos: Array<{ nombre: string; motivo: string }>;
  readonly declarados: DeclaradoEnPieza[];
}

/**
 * Cables de los circuitos guardados que cruzan la pieza (vigentes), por grupo, más los
 * conductores del PE que la recorren (en potencia, `CRITERIO_PE`). Un cable declarado
 * entra con SU diámetro declarado; sin diámetro no entra y queda en `declarados` con
 * `diametro_mm: null` (el llamador decide: la pieza no tiene ocupación calculable).
 */
export function crucesDePieza(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  diametros: ReadonlyMap<string, number>,
  pieza: string,
  excel?: DatosOcupacion,
): CrucesDePieza {
  const cables: Record<Grupo, CableEnGrupo[]> = { potencia: [], control: [] };
  const excluidos: Array<{ nombre: string; motivo: string }> = [];
  const decl = new Map<string, { cable_id: string; designacion: string; diametro_mm: number | null; grupos: Set<Grupo>; tendidos: string[] }>();
  for (const c of circuitosOf(entrada)) {
    if (!c.cruces.some((x) => x.pieza === pieza)) continue;
    if (!estadoCircuito(entrada, elements, c).vigente) { excluidos.push({ nombre: c.nombre, motivo: 'desactualizado: recalculalo' }); continue; }
    const items = cablesDelCircuito(entrada, excel?.catalog ?? null, excel?.cables ?? [], c, excel?.declarados ?? []);
    if (!items.length) { excluidos.push({ nombre: c.nombre, motivo: 'ligado a una conexión que ya no está en el Excel: no se cuenta' }); continue; }
    for (const k of items) {
      if (!k.cable_id || !k.cantidad || !k.funcion) { excluidos.push({ nombre: k.etiqueta, motivo: `${k.motivoSinCable ?? 'sin cable'}: no se cuenta` }); continue; }
      const g: Grupo = k.funcion === 'potencia' ? 'potencia' : 'control';
      if (k.declarado) {
        const dd = k.declarado.diametro_exterior_mm;
        const x = decl.get(k.declarado.cable_id) ?? { cable_id: k.declarado.cable_id, designacion: k.declarado.designacion, diametro_mm: dd, grupos: new Set<Grupo>(), tendidos: [] };
        x.grupos.add(g);
        x.tendidos.push(k.etiqueta);
        decl.set(x.cable_id, x);
        if (dd === null) { excluidos.push({ nombre: k.etiqueta, motivo: `el cable declarado ${k.declarado.designacion} (${k.declarado.cable_id}) no tiene diámetro exterior: completalo en la biblioteca de conductores` }); continue; }
        cables[g].push({ origen: `${k.etiqueta} (${TEXTO_FUNCION[k.funcion]}; declarado por el operador)`, cable_id: k.cable_id, cantidad: k.cantidad, diametro_mm: dd, declarado: true });
        continue;
      }
      const d = diametros.get(k.cable_id);
      if (d === undefined) { excluidos.push({ nombre: k.etiqueta, motivo: `el cable ${k.cable_id} no está en el catálogo` }); continue; }
      cables[g].push({ origen: `${k.etiqueta} (${TEXTO_FUNCION[k.funcion]})`, cable_id: k.cable_id, cantidad: k.cantidad, diametro_mm: d });
    }
  }
  // PE: los conductores que recorren la pieza, en el grupo de potencia.
  const pe = isNeutralPe(entrada.pe) ? peDelTrazado(entrada)?.pe : entrada.pe;
  const nPe = (pe?.conductores ?? []).filter((k) => {
    const rec = (k as { recorrido?: unknown[] }).recorrido ?? [];
    return rec.some((t) => (typeof t === 'string' ? t : (t as { instancia?: string })?.instancia) === pieza);
  }).length;
  const dPe = diametros.get(pe?.cable_id ?? PE_CABLE_ID);
  if (nPe && dPe !== undefined) cables.potencia.push({ origen: 'PE', cable_id: pe!.cable_id, cantidad: nPe, diametro_mm: dPe });
  return { cables, excluidos, declarados: [...decl.values()].map((x) => ({ ...x, grupos: [...x.grupos] })) };
}

/** Declarados sin diámetro, con su designación e id: «A (OP-1), B (OP-2)». */
export const nombrarDeclarados = (ds: readonly Pick<DeclaradoEnPieza, 'cable_id' | 'designacion'>[]) => ds.map((d) => `${d.designacion} (${d.cable_id})`).join(', ');

export const motivoSinDiametro = (ds: readonly DeclaradoEnPieza[]) =>
  `sin ocupación calculable: ${ds.length === 1 ? 'el cable declarado' : 'los cables declarados'} ${nombrarDeclarados(ds)} no ${ds.length === 1 ? 'tiene' : 'tienen'} diámetro exterior; completalo en la biblioteca de conductores`;

/** Ancho de referencia (útil si el catálogo lo publica, si no nominal), ala y reserva pedida. */
export function referenciasDePieza(entrada: TrayInput, tp: Product): { W: number | null; base: 'util' | 'nominal'; ala: number | null; rPct: number | null } {
  const util = (tp as Record<string, unknown>).ancho_util_mm;
  const base: 'util' | 'nominal' = typeof util === 'number' ? 'util' : 'nominal';
  const W = typeof util === 'number' ? util : typeof tp.ancho_nominal_mm === 'number' ? tp.ancho_nominal_mm : null;
  const alaRaw = (tp as Record<string, unknown>).ala_nominal_mm;
  const rRaw = (entrada as Record<string, unknown>).reserva_solicitada_pct;
  return { W, base, ala: typeof alaRaw === 'number' ? alaRaw : null, rPct: typeof rRaw === 'number' && Number.isFinite(rRaw) ? rRaw : null };
}

/** Un grupo: una capa en contacto (W = Σ n·D), reserva D-05 sobre el ancho asignado, altura contra el ala. */
export function evaluarGrupo(g: Grupo, cables: readonly CableEnGrupo[], asignado: number, rPct: number | null, ala: number | null): OcupacionGrupo {
  const ng = cables.reduce((s, k) => s + k.cantidad, 0);
  if (!ng) return { grupo: g, cables: [], n_cables: 0, ancho_asignado_mm: red(asignado), ancho_ocupado_mm: 0, diametro_max_mm: 0, reserva_libre_pct: null, cabe: true, cumple_reserva: null, estado: 'SIN_CABLES' };
  const ocupado = cables.reduce((s, k) => s + k.cantidad * k.diametro_mm, 0);
  const dMax = cables.reduce((m, k) => Math.max(m, k.diametro_mm), 0);
  const cabe = ocupado <= asignado + 1e-9;
  const libre = asignado > 0 ? ((asignado - ocupado) / asignado) * 100 : 0;
  const cumple = rPct === null ? null : ocupado <= (1 - rPct / 100) * asignado + 1e-9;
  const estado: OcupacionGrupo['estado'] = !cabe ? 'NO_CUMPLE_ANCHO'
    : cumple === null ? 'NO_VERIFICABLE_SIN_RESERVA'
    : !cumple ? 'NO_CUMPLE_RESERVA'
    : ala !== null && dMax > ala + 1e-9 ? 'NO_CUMPLE_ALTURA'
    : 'CUMPLE';
  return { grupo: g, cables, n_cables: ng, ancho_asignado_mm: red(asignado), ancho_ocupado_mm: red(ocupado), diametro_max_mm: dMax,
    reserva_libre_pct: red(libre), cabe, cumple_reserva: cumple, estado };
}

/**
 * Ocupación por grupo de una pieza con banda (regla del operador). `diametros`:
 * diámetro exterior por cable_id (catálogo de cables). null si la pieza no tiene banda.
 * Un cable declarado por el operador entra con su diámetro declarado; si alguno no lo
 * tiene, la pieza queda sin ocupación calculable y se dice cuál falta.
 */
export function ocupacionSegregada(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  productos: ReadonlyMap<string, Product>,
  diametros: ReadonlyMap<string, number>,
  pieza: string,
  excel?: DatosOcupacion,
): OcupacionSegregada | null {
  const banda = bandaDePieza(entrada, pieza);
  if (!banda) return null;
  const bp = productos.get(banda.producto_id);
  const sku = String(bp?.sku ?? banda.producto_id);
  const p = entrada.piezas.find((x) => x.instancia_id === pieza);
  const tp = p ? productos.get(p.producto_id) : undefined;
  if (!p || !tp) return { pieza, banda: sku, calculada: false, motivo: 'la pieza ya no está en el trazado' };
  const esp = espesorDeBanda(bp);
  if (!esp) {
    return { pieza, banda: sku, calculada: false, motivo: `NO VERIFICABLE: el catálogo no publica el espesor de la ${sku}, y la regla del operador lo descuenta primero del ancho útil` };
  }
  const e = esp.mm;
  const { W, base, ala, rPct } = referenciasDePieza(entrada, tp);
  if (W === null) return { pieza, banda: sku, calculada: false, motivo: 'la bandeja no tiene ancho en el catálogo' };

  const { cables, excluidos, declarados } = crucesDePieza(entrada, elements, diametros, pieza, excel);
  const sinDiametro = declarados.filter((d) => d.diametro_mm === null);
  if (sinDiametro.length) return { pieza, banda: sku, calculada: false, motivo: motivoSinDiametro(sinDiametro), declarados };

  const disponible = W - e;
  const n = (g: Grupo) => cables[g].reduce((s, k) => s + k.cantidad, 0);
  const nTotal = n('potencia') + n('control');
  const grupos = (['potencia', 'control'] as const).map((g) => evaluarGrupo(g, cables[g], nTotal ? (disponible * n(g)) / nTotal : 0, rPct, ala));
  return { pieza, banda: sku, calculada: true, espesor_banda_mm: e, espesor_procedencia: esp.procedencia, ancho_util_mm: W, base_ancho: base, ancho_disponible_mm: red(disponible),
    ala_mm: ala, reserva_solicitada_pct: rPct, grupos, excluidos, declarados };
}

/** Cómputo de bandas: una por tramo segregado; longitud a cubrir por SKU. */
export function computoBandas(entrada: TrayInput | null | undefined, productos: ReadonlyMap<string, Product>):
  Array<{ producto_id: string; sku: string; piezas: number; longitud_mm: number; tramos: string[] }> {
  const por = new Map<string, { producto_id: string; sku: string; piezas: number; longitud_mm: number; tramos: string[] }>();
  for (const b of bandasOf(entrada)) {
    const p = entrada?.piezas.find((x) => x.instancia_id === b.pieza);
    if (!p) continue;
    const l = por.get(b.producto_id) ?? { producto_id: b.producto_id, sku: String(productos.get(b.producto_id)?.sku ?? b.producto_id), piezas: 0, longitud_mm: 0, tramos: [] };
    l.piezas += 1;
    l.longitud_mm += typeof p.longitud_mm === 'number' ? p.longitud_mm : 0;
    l.tramos.push(b.pieza);
    por.set(b.producto_id, l);
  }
  return [...por.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}
