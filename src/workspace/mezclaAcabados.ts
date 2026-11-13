/**
 * Mezcla de acabados — decisión del OPERADOR (2026-11-13), por práctica de obra.
 *
 *   Se PERMITE unir piezas de acabados distintos dentro del mismo tipo de
 *   bandeja (ocurre en obra), pero el sistema lo MARCA: no puede pasar
 *   desapercibido en el cómputo. Es un AVISO, no una unión inválida: las cuatro
 *   condiciones de B-3 siguen decidiendo la validez.
 *
 * Procedencia (textual, para que nadie lo lea como dicho por el fabricante):
 *   "declarado por el operador, contradice REV-032 (fuente del catálogo)".
 * REV-032 es la fila de la fuente F-005 del catálogo que declara "sin
 * compatibilidad con otras familias" y que deja 38 pares "no compatible" entre
 * acabados de un mismo tipo de bandeja (14 perforada Z↔ZN/ZB, 24 escalera G↔Z).
 * Esas filas dejan de bloquear SÓLO para estos pares; el resto de la tabla no cambia.
 *
 * "Mismo tipo de bandeja" se declara acá, explícito (no se deduce de nombres):
 *   - perforada Smarttray: SAM-STP-Z (zincada) y SAM-STP-ZN (color: ZN negro, ZB blanco);
 *   - escalera Smarttray: SAM-STE-Z (galvanizado en origen) y SAM-STE-G (galvanizado en caliente).
 * La escalera tradicional (SAM-ESC-TRL) es otra línea, sin catálogo propio: no entra.
 *
 * El acabado de cada pieza sale del código del SKU (sufijo Z, ZN, ZB, G); si el
 * SKU no lo trae, del de su familia.
 */
import type { CatalogCompatibility, Product, TrayInput } from '../tray/model';

export const PROCEDENCIA_MEZCLA = 'declarado por el operador, contradice REV-032 (fuente del catálogo)';

export const DECISION_MEZCLA = {
  id: 'OP-2026-11-13-mezcla-acabados',
  fecha: '2026-11-13',
  texto: 'Se permite unir piezas de acabados distintos dentro del mismo tipo de bandeja (ocurre en obra); el sistema lo marca y no invalida la unión.',
  procedencia: PROCEDENCIA_MEZCLA,
} as const;

export interface GrupoTipoBandeja {
  readonly id: string;
  readonly nombre: string;
  readonly familias: readonly string[];
}

export const GRUPOS_TIPO_BANDEJA: readonly GrupoTipoBandeja[] = [
  { id: 'perforada-smarttray', nombre: 'perforada Smarttray', familias: ['SAM-STP-Z', 'SAM-STP-ZN'] },
  { id: 'escalera-smarttray', nombre: 'escalera Smarttray', familias: ['SAM-STE-Z', 'SAM-STE-G'] },
];

const NOMBRE_ACABADO: Record<string, string> = {
  Z: 'Z (chapa pregalvanizada en origen)',
  ZN: 'ZN (color negro)',
  ZB: 'ZB (color blanco)',
  G: 'G (galvanizado por inmersión en caliente)',
};
/** Acabado por defecto de la familia, si el SKU no trae el código. */
const ACABADO_FAMILIA: Record<string, string> = { 'SAM-STP-Z': 'Z', 'SAM-STE-Z': 'Z', 'SAM-STE-G': 'G', 'SAM-STP-ZN': 'ZN' };

const familiaDe = (p: Product) => (p as Record<string, unknown>).familia_id as string | undefined;

export function grupoDe(p: Product | null | undefined): GrupoTipoBandeja | null {
  const f = p ? familiaDe(p) : undefined;
  return (f && GRUPOS_TIPO_BANDEJA.find((g) => g.familias.includes(f))) || null;
}

export interface Acabado { readonly codigo: string; readonly nombre: string }

/** Acabado de una pieza de un grupo declarado; null fuera de los grupos. */
export function acabadoDe(p: Product | null | undefined): Acabado | null {
  if (!p || !grupoDe(p)) return null;
  const suf = String(p.sku ?? '').split('-').pop() ?? '';
  const codigo = NOMBRE_ACABADO[suf] ? suf : ACABADO_FAMILIA[familiaDe(p)!];
  return codigo ? { codigo, nombre: NOMBRE_ACABADO[codigo] } : null;
}

export interface Mezcla {
  readonly grupo: string;
  readonly acabadoA: Acabado;
  readonly acabadoB: Acabado;
  readonly skuA: string;
  readonly skuB: string;
  /** Texto del aviso, con los dos acabados nombrados y la procedencia. */
  readonly texto: string;
}

/** Mezcla de acabados entre dos piezas del mismo tipo de bandeja, o null si no la hay. */
export function mezclaDeAcabados(a: Product | null | undefined, b: Product | null | undefined): Mezcla | null {
  const g = grupoDe(a);
  if (!a || !b || !g || grupoDe(b)?.id !== g.id) return null;
  const aa = acabadoDe(a);
  const ab = acabadoDe(b);
  if (!aa || !ab || aa.codigo === ab.codigo) return null;
  return {
    grupo: g.nombre, acabadoA: aa, acabadoB: ab, skuA: String(a.sku), skuB: String(b.sku),
    texto: `mezcla de acabados: ${a.sku} ${aa.nombre} ↔ ${b.sku} ${ab.nombre} — ${PROCEDENCIA_MEZCLA}`,
  };
}

/**
 * ¿Esta fila "no compatible" de la tabla es de REV-032 entre acabados de un mismo
 * tipo de bandeja? Son las que la decisión del operador deja sin efecto.
 */
export function esBloqueoREV032Superado(row: CatalogCompatibility, a: Product, b: Product): boolean {
  return row.estado_compatibilidad === 'no compatible' && familiaDe(a) !== familiaDe(b) && mezclaDeAcabados(a, b) !== null;
}

/** Enganches de derivación (clave `enganches_ws`, ver derivacion/enganche.ts); leídos acá sin importar ese módulo. */
function enganchesDe(entrada: TrayInput): Array<{ id: string; tronco: string; salida: readonly [string, string] }> {
  const t = (entrada as unknown as Record<string, unknown>).enganches_ws;
  return Array.isArray(t) ? t : [];
}

export interface MezclaEnTrazado {
  /** 'conexion': unión entre bocas; 'enganche': derivación en tramo (tronco ↔ lo que sale del flanco). */
  readonly tipo: 'conexion' | 'enganche';
  readonly id: string;
  readonly piezas: readonly [string, string];
  readonly mezcla: Mezcla;
}

/** Todas las uniones del trazado con mezcla de acabados: conexiones y enganches de derivación. */
export function mezclasDelTrazado(entrada: TrayInput | null | undefined, productos: ReadonlyMap<string, Product>): MezclaEnTrazado[] {
  if (!entrada) return [];
  const prod = (pieza: string) => {
    const p = entrada.piezas.find((x) => x.instancia_id === pieza);
    return p ? productos.get(p.producto_id) : undefined;
  };
  const out: MezclaEnTrazado[] = [];
  for (const c of entrada.conexiones) {
    const m = mezclaDeAcabados(prod(c.a[0]), prod(c.b[0]));
    if (m) out.push({ tipo: 'conexion', id: c.conexion_id, piezas: [c.a[0], c.b[0]], mezcla: m });
  }
  for (const e of enganchesDe(entrada)) {
    if (!e.salida[0]) continue;
    const m = mezclaDeAcabados(prod(e.tronco), prod(e.salida[0]));
    if (m) out.push({ tipo: 'enganche', id: e.id, piezas: [e.tronco, e.salida[0]], mezcla: m });
  }
  return out;
}

/** Mezclas en las que participa una pieza (ficha de la pieza). */
export function mezclasDePieza(entrada: TrayInput | null | undefined, productos: ReadonlyMap<string, Product>, pieza: string): MezclaEnTrazado[] {
  return mezclasDelTrazado(entrada, productos).filter((m) => m.piezas.includes(pieza));
}

/** Ids de las conexiones con mezcla de acabados (para leer el resultado del motor en Resultados). */
export function conexionesConMezcla(entrada: TrayInput | null | undefined, productos: ReadonlyMap<string, Product>): Set<string> {
  return new Set(mezclasDelTrazado(entrada, productos).filter((m) => m.tipo === 'conexion').map((m) => m.id));
}
