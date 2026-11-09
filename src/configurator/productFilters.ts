/**
 * productFilters — helpers compartidos para la cascada de filtros del catálogo.
 *
 * Qué resuelve:
 *   El Configurador y el formulario "Agregar tramo" del workspace deben filtrar
 *   el catálogo exactamente de la misma manera (misma ordenación, mismas
 *   opciones derivadas de los filtros anteriores, mismo tratamiento de
 *   "no declarado"). Duplicar los helpers lleva a divergencia silenciosa
 *   cuando se cambia una regla en un lado y no en el otro.
 *
 * Qué define:
 *   - `Filters` / `EMPTY_FILTERS`                   — forma del estado.
 *   - `FilterOptions` / `computeFilterOptions`      — cascada
 *     sistema → tipo → ancho → ala → acabado → espesor.
 *   - `matchesFilter`                               — predicado único para la
 *     lista filtrada.
 *   - `applyCascade`                                — helper que, al cambiar un
 *     filtro, limpia los dependientes aguas abajo (evita estados imposibles).
 *   - Helpers `alaOf` / `anchoOf` / `espesorOf` / `acabadoOf` /
 *     `familiaIdOf`                                — accesores por producto,
 *     centralizan la lógica de "no declarado".
 *   - Formatters `formatAlaOption` / `formatAnchoOption` /
 *     `formatAcabadoOption` / `formatEspesorOption`  — textos de UI.
 *
 * Dependencia estricta: el orden de la cascada es
 *   sistema → tipo → ancho → ala → acabado → espesor.
 * Cambiar ese orden implica cambiar el estudio UX; no se modifica por acá sin
 * revisar los dos consumidores.
 */
import type { CatalogFamily, Product } from '../tray/model';
import { classifySistema, SISTEMAS, type Sistema } from './sistemaClassifier';

export const ALA_NO_DECLARADA = '__sin_ala__';
export const ANCHO_NO_DECLARADO = '__sin_ancho__';
export const ACABADO_NO_DECLARADO = '__sin_acabado__';
export const ESPESOR_NO_DECLARADO = '__sin_espesor__';

export interface Filters {
  text: string;
  sistema: Sistema | '';
  tipoPieza: string;
  ancho: string;
  ala: string;
  acabado: string;
  espesor: string;
}

export const EMPTY_FILTERS: Filters = {
  text: '',
  sistema: '',
  tipoPieza: '',
  ancho: '',
  ala: '',
  acabado: '',
  espesor: '',
};

export interface FilterOptions {
  readonly sistemas: readonly Sistema[];
  readonly tiposPieza: readonly string[];
  readonly anchos: readonly string[];
  readonly alas: readonly string[];
  readonly acabados: readonly string[];
  readonly espesores: readonly string[];
}

export function alaOf(p: Product): string {
  const raw = (p as Record<string, unknown>).ala_nominal_mm;
  return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ALA_NO_DECLARADA;
}

export function anchoOf(p: Product): string {
  return typeof p.ancho_nominal_mm === 'number' && Number.isFinite(p.ancho_nominal_mm)
    ? String(p.ancho_nominal_mm)
    : ANCHO_NO_DECLARADO;
}

export function espesorOf(p: Product): string {
  const raw = (p as Record<string, unknown>).espesor_chapa_mm;
  return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ESPESOR_NO_DECLARADO;
}

export function familiaIdOf(p: Product): string | undefined {
  const v = (p as Record<string, unknown>).familia_id;
  return typeof v === 'string' ? v : undefined;
}

export function acabadoOf(p: Product, familiasById: Map<string, CatalogFamily>): string {
  const fid = familiaIdOf(p);
  if (!fid) return ACABADO_NO_DECLARADO;
  const fam = familiasById.get(fid);
  const v = fam?.acabado_normalizado;
  return typeof v === 'string' && v.length > 0 ? v : ACABADO_NO_DECLARADO;
}

export function matchesFilter(
  p: Product,
  f: Filters,
  familiasById: Map<string, CatalogFamily>,
): boolean {
  if (f.sistema && classifySistema(familiaIdOf(p)) !== f.sistema) return false;
  if (f.tipoPieza && p.tipo_pieza !== f.tipoPieza) return false;
  if (f.ancho && anchoOf(p) !== f.ancho) return false;
  if (f.ala && alaOf(p) !== f.ala) return false;
  if (f.acabado && acabadoOf(p, familiasById) !== f.acabado) return false;
  if (f.espesor && espesorOf(p) !== f.espesor) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    const hay = [p.producto_id, p.sku, p.descripcion_original]
      .map((s) => (s ?? '').toLowerCase())
      .some((s) => s.includes(q));
    if (!hay) return false;
  }
  return true;
}

/**
 * Cascada de opciones: cada nivel se calcula sobre el subconjunto filtrado por
 * los niveles anteriores. Garantiza que cada selector ofrezca sólo opciones
 * realmente existentes para la selección actual.
 *
 * Importante: NO aplica el filtro de texto ni el nivel propio sobre el cálculo
 * de su propia lista (p.ej. `ancho` se calcula sobre bySistema+byTipo; no sobre
 * byAncho). Si se filtrara por su propio valor, un cambio de valor podría
 * dejar la UI vacía inesperadamente.
 */
export function computeFilterOptions(
  products: readonly Product[],
  filters: Filters,
  familiasById: Map<string, CatalogFamily>,
): FilterOptions {
  const bySistema = filters.sistema
    ? products.filter((p) => classifySistema(familiaIdOf(p)) === filters.sistema)
    : [...products];
  const byTipo = filters.tipoPieza
    ? bySistema.filter((p) => p.tipo_pieza === filters.tipoPieza)
    : bySistema;
  const byAncho = filters.ancho
    ? byTipo.filter((p) => anchoOf(p) === filters.ancho)
    : byTipo;
  const byAla = filters.ala
    ? byAncho.filter((p) => alaOf(p) === filters.ala)
    : byAncho;
  const byAcabado = filters.acabado
    ? byAla.filter((p) => acabadoOf(p, familiasById) === filters.acabado)
    : byAla;

  const tiposPieza = Array.from(new Set(bySistema.map((p) => p.tipo_pieza))).sort();
  const anchos = Array.from(new Set(byTipo.map(anchoOf))).sort((a, b) => {
    if (a === ANCHO_NO_DECLARADO) return 1;
    if (b === ANCHO_NO_DECLARADO) return -1;
    return Number(a) - Number(b);
  });
  const alas = Array.from(new Set(byAncho.map(alaOf))).sort((a, b) => {
    if (a === ALA_NO_DECLARADA) return 1;
    if (b === ALA_NO_DECLARADA) return -1;
    return Number(a) - Number(b);
  });
  const acabados = Array.from(new Set(byAla.map((p) => acabadoOf(p, familiasById)))).sort();
  const espesores = Array.from(new Set(byAcabado.map(espesorOf))).sort((a, b) => {
    if (a === ESPESOR_NO_DECLARADO) return 1;
    if (b === ESPESOR_NO_DECLARADO) return -1;
    return Number(a) - Number(b);
  });

  return {
    sistemas: SISTEMAS.map((s) => s.id),
    tiposPieza,
    anchos,
    alas,
    acabados,
    espesores,
  };
}

/**
 * Cuando el usuario cambia un filtro, los dependientes aguas abajo (más
 * específicos) deben limpiarse — mantener su valor anterior genera estados
 * imposibles (p.ej. quedarte con `ala=65` aunque cambiaste a un sistema que no
 * tiene ala 65).
 */
export function applyCascade(
  current: Filters,
  field: keyof Filters,
  value: string,
): Filters {
  const next: Filters = { ...current, [field]: value };
  // Orden canónico: sistema → tipoPieza → ancho → ala → acabado → espesor.
  // Al cambiar uno, limpiamos los posteriores. `text` NO participa en la
  // cascada (es búsqueda libre y sobrevive a cambios de otros niveles).
  const chain: readonly (keyof Filters)[] = [
    'sistema',
    'tipoPieza',
    'ancho',
    'ala',
    'acabado',
    'espesor',
  ];
  const idx = chain.indexOf(field);
  if (idx >= 0) {
    for (let i = idx + 1; i < chain.length; i++) {
      (next as Record<keyof Filters, string>)[chain[i]] = '';
    }
  }
  return next;
}

// ─── Formatters para la UI (no dependen del componente) ─────────────────────

export function formatAlaOption(k: string): string {
  return k === ALA_NO_DECLARADA ? 'Ala no declarada' : `${k} mm`;
}
export function formatAnchoOption(k: string): string {
  return k === ANCHO_NO_DECLARADO ? 'Ancho no declarado' : `${k} mm`;
}
export function formatAcabadoOption(k: string): string {
  return k === ACABADO_NO_DECLARADO ? 'Acabado no declarado' : k;
}
export function formatEspesorOption(k: string): string {
  return k === ESPESOR_NO_DECLARADO ? 'Espesor no declarado' : `${k} mm`;
}

/**
 * Construye el índice familia_id → CatalogFamily. Centralizado para evitar que
 * cada componente lo reconstruya con lógica propia.
 */
export function buildFamiliasById(familias: readonly CatalogFamily[]): Map<string, CatalogFamily> {
  const m = new Map<string, CatalogFamily>();
  for (const f of familias) m.set(f.familia_id, f);
  return m;
}
