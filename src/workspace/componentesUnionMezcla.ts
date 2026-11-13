/**
 * Componentes de unión de las MEZCLAS DE ACABADOS (agregados por la app).
 *
 * El motor (vendorizado, no se toca, su resultado no se modifica) no calcula
 * componentes de unión de una conexión NO_COMPATIBLE o NO_REGISTRADA
 * (computo.py: emite una línea "bloqueada"). Con las mezclas permitidas
 * (mezclaAcabados.ts) toda unión mezclada quedaba sin bulonería en el cómputo.
 *
 * La app AGREGA líneas, identificadas como suyas:
 *   - sólo para las conexiones que la app marcó como mezcla de acabados; una
 *     NO_COMPATIBLE o NO_REGISTRADA por otro motivo queda bloqueada como antes;
 *   - los componentes se copian TAL CUAL de COMPONENTES_UNION de una fila de
 *     compatibilidad entre piezas del MISMO acabado, del mismo tipo de bandeja,
 *     ancho y ala (con preferencia por el mismo par de tipos de pieza que la
 *     conexión, y luego la de menor id). No hay regla de selección de acabado:
 *     en el catálogo todas las uniones de escalera llevan JB-CC-3/8 y todas las
 *     de perforada JB-CC-M6 (verificado por el operador sobre las 1859 filas, y
 *     por `componentesUnionMezcla.test.ts`);
 *   - si ninguna fila del mismo acabado documenta componentes, la conexión queda
 *     bloqueada y visible (no se inventa una pieza);
 *   - cada línea lleva escrito que la puso la app y por qué (PROCEDENCIA).
 */
import type { CatalogCompatibility, Product, TrayInput } from '../tray/model';
import { acabadoDe, conexionesConMezcla, grupoDe } from './mezclaAcabados';

export const PROCEDENCIA_COMPONENTES_MEZCLA =
  'unión entre acabados distintos, componentes tomados de la unión del mismo acabado; declarado por el operador';

export interface ComponenteUnion {
  readonly compatibilidad_id: string;
  readonly producto_requerido_id: string;
  readonly cantidad: number | null;
  readonly estado_evidencia?: string | null;
}

export interface LineaAgregadaApp {
  readonly producto_id: string;
  readonly sku: string | null;
  readonly descripcion: string | null;
  readonly cantidad: number | null;
  readonly unidad: string | null;
  readonly origen: { readonly conexion: string; readonly compatibilidad: string };
  readonly regla: string;
  readonly estado_cantidad: string;
  /** Marca de origen: la puso la app, no el motor. */
  readonly agregada_por_app: true;
  readonly procedencia: string;
}

export interface CompletadoMezclas {
  readonly agregadas: readonly LineaAgregadaApp[];
  /** Conexiones mezcladas cuyos componentes completó la app. */
  readonly completadas: readonly string[];
  /** Conexiones sin componentes de unión determinables (las que no se pudieron completar). */
  readonly sinComponentes: readonly string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Conexiones con una línea D-24 del motor sin componentes (bloqueada o no documentada). */
function conexionesSinComponentesDelMotor(result: unknown): string[] {
  const lineas = isObj(result) && isObj(result.computo) && Array.isArray(result.computo.lineas) ? result.computo.lineas : [];
  const out: string[] = [];
  for (const l of lineas) {
    if (!isObj(l) || !isObj(l.origen) || typeof l.origen.conexion !== 'string') continue;
    if (l.producto_id == null && (l.estado_cantidad === 'bloqueada' || l.estado_cantidad === 'no_documentada')) out.push(l.origen.conexion);
  }
  return [...new Set(out)];
}

const fam = (p: Product) => (p as Record<string, unknown>).familia_id;
const ala = (p: Product) => (p as Record<string, unknown>).ala_nominal_mm;

/** Fila del mismo acabado (mismo tipo de bandeja, ancho y ala) con componentes documentados, o null. */
export function filaMismoAcabado(
  a: Product, b: Product,
  productos: ReadonlyMap<string, Product>,
  compatibilidades: readonly CatalogCompatibility[],
  componentesPorFila: ReadonlyMap<string, readonly ComponenteUnion[]>,
): { fila: CatalogCompatibility; componentes: readonly ComponenteUnion[] } | null {
  const g = grupoDe(a);
  if (!g || grupoDe(b)?.id !== g.id) return null;
  const tipos = [a.tipo_pieza, b.tipo_pieza].sort().join('|');
  const candidatas = (indiceMismoAcabado(productos, compatibilidades, componentesPorFila).get(claveIndice(g.id, a.ancho_nominal_mm, ala(a))) ?? [])
    .map((c) => ({ ...c, mismoPar: c.tipos === tipos }));
  candidatas.sort((p, q) => Number(q.mismoPar) - Number(p.mismoPar) || p.fila.compatibilidad_id.localeCompare(q.fila.compatibilidad_id));
  return candidatas[0] ?? null;
}

type Candidata = { fila: CatalogCompatibility; componentes: readonly ComponenteUnion[]; tipos: string };
const claveIndice = (grupo: string, ancho: unknown, alaMm: unknown) => `${grupo}|${String(ancho)}|${String(alaMm)}`;
const INDICES = new WeakMap<readonly CatalogCompatibility[], WeakMap<ReadonlyMap<string, readonly ComponenteUnion[]>, Map<string, Candidata[]>>>();

/** Filas de uniones del MISMO acabado con componentes, por (tipo de bandeja, ancho, ala). Se calcula una vez por catálogo. */
function indiceMismoAcabado(
  productos: ReadonlyMap<string, Product>,
  compatibilidades: readonly CatalogCompatibility[],
  componentesPorFila: ReadonlyMap<string, readonly ComponenteUnion[]>,
): Map<string, Candidata[]> {
  let porComp = INDICES.get(compatibilidades);
  if (!porComp) INDICES.set(compatibilidades, (porComp = new WeakMap()));
  const hit = porComp.get(componentesPorFila);
  if (hit) return hit;
  const ix = new Map<string, Candidata[]>();
  for (const c of compatibilidades) {
    if (c.estado_compatibilidad === 'no compatible') continue;
    const comps = componentesPorFila.get(c.compatibilidad_id);
    if (!comps?.length) continue;
    const x = productos.get(c.producto_a_id);
    const y = c.producto_b_id ? productos.get(c.producto_b_id) : undefined;
    const g = grupoDe(x);
    if (!x || !y || !g || grupoDe(y)?.id !== g.id) continue;
    if (acabadoDe(x)?.codigo !== acabadoDe(y)?.codigo || fam(x) !== fam(y)) continue; // unión del MISMO acabado
    if (x.ancho_nominal_mm !== y.ancho_nominal_mm || ala(x) !== ala(y)) continue;
    const k = claveIndice(g.id, x.ancho_nominal_mm, ala(x));
    (ix.get(k) ?? ix.set(k, []).get(k)!).push({ fila: c, componentes: comps, tipos: [x.tipo_pieza, y.tipo_pieza].sort().join('|') });
  }
  porComp.set(componentesPorFila, ix);
  return ix;
}

const POR_FILA = new WeakMap<readonly ComponenteUnion[], Map<string, ComponenteUnion[]>>();
function componentesPorFilaDe(componentes: readonly ComponenteUnion[]): Map<string, ComponenteUnion[]> {
  let m = POR_FILA.get(componentes);
  if (!m) {
    m = new Map();
    for (const cu of componentes) (m.get(cu.compatibilidad_id) ?? m.set(cu.compatibilidad_id, []).get(cu.compatibilidad_id)!).push(cu);
    POR_FILA.set(componentes, m);
  }
  return m;
}

export function completarComponentesMezclas(
  result: unknown,
  entrada: TrayInput | null | undefined,
  productos: ReadonlyMap<string, Product>,
  compatibilidades: readonly CatalogCompatibility[],
  componentes: readonly ComponenteUnion[],
): CompletadoMezclas {
  const sinMotor = conexionesSinComponentesDelMotor(result);
  if (!entrada || !sinMotor.length) return { agregadas: [], completadas: [], sinComponentes: sinMotor };
  const mezclas = conexionesConMezcla(entrada, productos);
  const porFila = componentesPorFilaDe(componentes);
  const prodDe = (pieza: string) => productos.get(entrada.piezas.find((p) => p.instancia_id === pieza)?.producto_id ?? '');
  const agregadas: LineaAgregadaApp[] = [];
  const completadas: string[] = [];
  const sinComponentes: string[] = [];
  for (const id of sinMotor) {
    const con = entrada.conexiones.find((c) => c.conexion_id === id);
    const a = con && prodDe(con.a[0]);
    const b = con && prodDe(con.b[0]);
    // Sólo las mezclas marcadas por la app; el resto queda bloqueado como hasta ahora.
    const fila = mezclas.has(id) && a && b ? filaMismoAcabado(a, b, productos, compatibilidades, porFila) : null;
    if (!fila) { sinComponentes.push(id); continue; }
    for (const cu of fila.componentes) {
      const p = productos.get(cu.producto_requerido_id);
      agregadas.push({
        producto_id: cu.producto_requerido_id,
        sku: p?.sku ?? null,
        descripcion: (p?.descripcion_original as string | undefined) ?? null,
        cantidad: cu.cantidad,
        unidad: cu.cantidad ? 'juego' : null,
        origen: { conexion: id, compatibilidad: fila.fila.compatibilidad_id },
        regla: 'D-24: componentes de unión por conexión',
        estado_cantidad: cu.cantidad != null ? 'documentada' : 'no_documentada',
        agregada_por_app: true,
        procedencia: PROCEDENCIA_COMPONENTES_MEZCLA,
      });
    }
    completadas.push(id);
  }
  return { agregadas, completadas, sinComponentes };
}

/**
 * Controles de las líneas agregadas (los usan las pruebas): cada una con su marca
 * de procedencia, y sólo sobre conexiones marcadas como mezcla.
 */
export function problemasDeAgregadas(agregadas: readonly LineaAgregadaApp[], mezclas: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const l of agregadas) {
    if (l.agregada_por_app !== true || l.procedencia !== PROCEDENCIA_COMPONENTES_MEZCLA) out.push(`${l.origen?.conexion ?? '?'}: línea agregada sin su marca de procedencia`);
    if (!mezclas.has(l.origen?.conexion)) out.push(`${l.origen?.conexion ?? '?'}: se completaron componentes de una conexión que no es mezcla marcada`);
  }
  return out;
}
