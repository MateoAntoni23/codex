/**
 * Guía de qué cargar (A6): cuántos tendidos del Excel casan con cada cable, y los
 * tendidos sin cable de catálogo agrupados por naturaleza, conductores y sección.
 *
 * Usa la MISMA regla de casamiento que el resto de la app (`casarTendido`): por
 * naturaleza, conductores y sección. Un declarado se compara igual que un cable del
 * catálogo.
 */
import { casarTendido } from '../conexiones/casarCable';
import type { NaturalezaTendido, TendidoImportado } from '../import/types';
import type { CableCatalogo } from '../workspace/cables/catalogoCables';
import { casableDe, type CableDeclarado } from './biblioteca';
import { cableDeTendido } from '../conexiones/tendidos';
import { declaradoOf, type DeclaradoConexiones } from '../conexiones/declarado';

type Casable = { cable_id: string; n_conductores: number; formacion: string };
const candidatosDe = (t: TendidoImportado, cables: readonly Casable[]): readonly Casable[] => {
  const r = casarTendido(t, cables);
  return r.estado === 'ninguno' ? [] : r.candidatos;
};

/** cable_id → cantidad de tendidos del Excel para los que ese cable es candidato. */
export function tendidosPorCable(
  tendidos: readonly TendidoImportado[],
  catalogo: readonly CableCatalogo[],
  declarados: readonly CableDeclarado[],
): Map<string, number> {
  const todos: Casable[] = [...catalogo, ...declarados.map(casableDe)];
  const n = new Map<string, number>();
  for (const t of tendidos) for (const c of candidatosDe(t, todos)) n.set(c.cable_id, (n.get(c.cable_id) ?? 0) + 1);
  return n;
}

export interface CombinacionSinCable {
  /** naturaleza|conductores|sección */
  readonly clave: string;
  readonly naturaleza: NaturalezaTendido;
  readonly conductores: number;
  readonly seccion_mm2: number;
  /** Tendidos que destraba cargar un cable de esta combinación. */
  readonly tendidoIds: readonly string[];
  /** Por qué no casan con el catálogo (el motivo de la regla). */
  readonly motivo: string;
  /** Declarados que ya casan con estos tendidos (designación), y cuántos cubren. */
  readonly cubiertaPor: readonly { cable_id: string; designacion: string; tendidos: number }[];
}

export interface FueraDeLaGuia {
  readonly motivo: string;
  readonly tendidoIds: readonly string[];
}

export interface GuiaSinCable {
  readonly combinaciones: readonly CombinacionSinCable[];
  /** Tendidos sin cable que no son un conductor que se pueda declarar (datos, tubos, sin datos). */
  readonly fuera: readonly FueraDeLaGuia[];
}

/**
 * Tendidos sin candidato en el catálogo del motor. Los conductores (unipolar,
 * multipolar) con conductores y sección se agrupan por combinación; el resto (datos,
 * tubos, sin conductores o sección en el Excel) va aparte, con el motivo de la regla.
 */
export function tendidosSinCable(
  tendidos: readonly TendidoImportado[],
  catalogo: readonly CableCatalogo[],
  declarados: readonly CableDeclarado[],
): GuiaSinCable {
  const grupos = new Map<string, { naturaleza: NaturalezaTendido; conductores: number; seccion: number; motivo: string; ids: string[]; tendidos: TendidoImportado[] }>();
  const fuera = new Map<string, string[]>();
  for (const t of tendidos) {
    const r = casarTendido(t, catalogo);
    if (r.estado !== 'ninguno') continue;
    const esConductor = t.naturaleza === 'CABLE_MULTIPOLAR' || t.naturaleza === 'CONDUCTOR_UNIPOLAR';
    const n = t.naturaleza === 'CONDUCTOR_UNIPOLAR' ? 1 : t.conductoresPorUnidad;
    if (!esConductor || n === undefined || t.seccionMm2 === undefined) {
      fuera.set(r.motivo, [...(fuera.get(r.motivo) ?? []), t.tendidoId]);
      continue;
    }
    const clave = `${t.naturaleza}|${n}|${t.seccionMm2}`;
    const g = grupos.get(clave) ?? { naturaleza: t.naturaleza, conductores: n, seccion: t.seccionMm2, motivo: r.motivo, ids: [], tendidos: [] };
    g.ids.push(t.tendidoId);
    g.tendidos.push(t);
    grupos.set(clave, g);
  }
  const combinaciones = [...grupos].map(([clave, g]): CombinacionSinCable => {
    const cubiertaPor = declarados
      .map((d) => ({ cable_id: d.cable_id, designacion: d.designacion, tendidos: g.tendidos.filter((t) => candidatosDe(t, [casableDe(d)]).length > 0).length }))
      .filter((x) => x.tendidos > 0);
    return { clave, naturaleza: g.naturaleza, conductores: g.conductores, seccion_mm2: g.seccion, tendidoIds: g.ids, motivo: g.motivo, cubiertaPor };
  });
  combinaciones.sort((a, b) => b.tendidoIds.length - a.tendidoIds.length || a.clave.localeCompare(b.clave));
  return { combinaciones, fuera: [...fuera].map(([motivo, tendidoIds]) => ({ motivo, tendidoIds })) };
}

/**
 * Declarados que usa un proyecto: los que lleva algún tendido de su Excel, elegidos por
 * el operador o propuestos por la regla (único candidato) — parte B. Es lo que viaja en
 * la copia del proyecto (A5). Un declarado que sólo es uno de varios candidatos, sin
 * elegir, no lo lleva ningún tendido y no viaja.
 */
export function declaradosUsados(
  declarados: readonly CableDeclarado[],
  tendidos: readonly TendidoImportado[],
  cablesCatalogo: readonly CableCatalogo[] = [],
  declarado: DeclaradoConexiones = declaradoOf(null),
): CableDeclarado[] {
  const usados = new Set<string>();
  for (const t of tendidos) {
    const d = cableDeTendido(t, cablesCatalogo, declarado, declarados).cableDeclarado;
    if (d) usados.add(d.cable_id);
  }
  return declarados.filter((d) => usados.has(d.cable_id));
}
