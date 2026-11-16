/**
 * Biblioteca de conductores, parte B — ocupación de las bandejas que llevan cables
 * declarados por el operador.
 *
 * Un cable declarado NUNCA viaja al motor (su contrato sólo admite cables de su
 * catálogo). Entonces, en una bandeja por la que pasa alguno, la ocupación que calcula el
 * motor no los ve: no se usa. La calcula la APP, con el mismo mecanismo que la banda
 * divisoria (`segregacion/bandaDivisoria.ts`), marcada como cálculo de la app y separada
 * del resultado del motor:
 *   - bandeja con banda divisoria: ya la calcula la app (`ocupacionSegregada`); los
 *     declarados entran ahí con su diámetro declarado, en su grupo;
 *   - bandeja sin banda (`ocupacionConDeclarados`): lo mismo que el motor cuenta —los
 *     cables de potencia (D-11: mando y señal no tienen reglas en el motor) y el PE que
 *     recorre la pieza—, más los declarados de potencia. Una sola capa en contacto
 *     (W = Σ n·D, D-02), reserva D-05 sobre el ancho de referencia, altura contra el ala
 *     (D-08). Los de mando, señal y comunicación —de catálogo o declarados— se listan como
 *     no contados, como en el motor.
 * Bandeja mixta (catálogo + declarados): manda la app, y se dice por qué, nombrando los
 * declarados. Un declarado sin diámetro exterior que entraría en la suma deja la bandeja
 * SIN ocupación calculable, y se dice cuál falta completar. Nunca se estima.
 */
import type { Product, TrayInput } from '../tray/model';
import type { EquipmentElement } from '../types/domain-v2';
import {
  bandaDePieza, crucesDePieza, evaluarGrupo, motivoSinDiametro, nombrarDeclarados, ocupacionSegregada, referenciasDePieza,
  type DatosOcupacion, type DeclaradoEnPieza, type OcupacionGrupo, type OcupacionSegregada,
} from '../workspace/segregacion/bandaDivisoria';

export const PROCEDENCIA_DECLARADOS =
  'Cálculo de la app, no del motor: por esta bandeja pasan cables declarados por el operador, que no viajan al motor (su contrato sólo admite cables de su catálogo). La ocupación que el motor calcula para esta pieza (sin ellos) no se usa.';
export const CRITERIO_DECLARADOS =
  'Se cuenta lo mismo que cuenta el motor —potencia y el PE que recorre la pieza; mando, señal y comunicación no (D-11)— más los declarados de potencia, con su diámetro declarado. Una capa en contacto, W = Σ n·D (D-02); reserva con el criterio del motor (D-05: W ≤ (1 − r)·W_ref); altura: el diámetro mayor contra el ala nominal (D-08). La masa por pieza y los vanos siguen siendo los del motor, que no incluyen los declarados.';

const MOTIVO_D11_APP = 'mando, señal o comunicación: el motor no los cuenta (D-11) y la app tampoco, en una bandeja sin banda divisoria';

export type OcupacionConDeclarados =
  | {
      readonly pieza: string; readonly calculada: true;
      /** Por qué manda la app, nombrando los declarados. */
      readonly porque: string;
      readonly mixta: boolean;
      readonly declarados: readonly DeclaradoEnPieza[];
      readonly ancho_util_mm: number; readonly base_ancho: 'util' | 'nominal'; readonly ala_mm: number | null; readonly reserva_solicitada_pct: number | null;
      readonly grupo: OcupacionGrupo;
      readonly excluidos: ReadonlyArray<{ nombre: string; motivo: string }>;
    }
  | {
      readonly pieza: string; readonly calculada: false;
      readonly porque: string;
      readonly declarados: readonly DeclaradoEnPieza[];
      readonly motivo: string;
      /** Declarados que faltan completar (sin diámetro exterior). */
      readonly faltan: readonly DeclaradoEnPieza[];
    };

/**
 * Ocupación de la app de una pieza SIN banda por la que pasa al menos un cable
 * declarado. null si la pieza tiene banda (la calcula `ocupacionSegregada`) o si no
 * pasa ningún declarado (manda el motor).
 */
export function ocupacionConDeclarados(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  productos: ReadonlyMap<string, Product>,
  diametros: ReadonlyMap<string, number>,
  pieza: string,
  excel: DatosOcupacion,
): OcupacionConDeclarados | null {
  if (bandaDePieza(entrada, pieza)) return null;
  if (!excel.declarados?.length) return null;
  const { cables, excluidos, declarados } = crucesDePieza(entrada, elements, diametros, pieza, excel);
  if (!declarados.length) return null;
  const mixta = [...cables.potencia, ...cables.control].some((k) => !k.declarado && k.origen !== 'PE');
  const porque = `${mixta ? 'Bandeja mixta (catálogo del motor + declarados): manda' : 'Manda'} el cálculo de la app porque por esta bandeja pasan cables declarados por el operador, que el motor no conoce: ${nombrarDeclarados(declarados)}.`;
  // Sólo bloquea un declarado sin diámetro que entraría en la suma (potencia); uno de mando no entra (D-11).
  const faltan = declarados.filter((d) => d.diametro_mm === null && d.grupos.includes('potencia'));
  if (faltan.length) return { pieza, calculada: false, porque, declarados, motivo: motivoSinDiametro(faltan), faltan };
  const p = entrada.piezas.find((x) => x.instancia_id === pieza);
  const tp = p ? productos.get(p.producto_id) : undefined;
  if (!p || !tp) return { pieza, calculada: false, porque, declarados, motivo: 'la pieza ya no está en el trazado', faltan: [] };
  const { W, base, ala, rPct } = referenciasDePieza(entrada, tp);
  if (W === null) return { pieza, calculada: false, porque, declarados, motivo: 'la bandeja no tiene ancho en el catálogo', faltan: [] };
  // Acá ningún declarado de potencia está sin diámetro: los «sin diámetro» que quedan son de mando (no entran igual).
  const noContados = [
    ...excluidos.map((x) => (x.motivo.includes('no tiene diámetro exterior') ? { ...x, motivo: `${MOTIVO_D11_APP}; además, ${x.motivo}` } : x)),
    ...cables.control.map((k) => ({ nombre: k.origen, motivo: MOTIVO_D11_APP })),
  ];
  return {
    pieza, calculada: true, porque, mixta, declarados, ancho_util_mm: W, base_ancho: base, ala_mm: ala, reserva_solicitada_pct: rPct,
    grupo: evaluarGrupo('potencia', cables.potencia, W, rPct, ala), excluidos: noContados,
  };
}

/** Lo que la app calcula para una pieza, si la calcula ella: segregada o con declarados. null: manda el motor. */
export type OcupacionDeLaApp =
  | { readonly tipo: 'segregada'; readonly o: OcupacionSegregada }
  | { readonly tipo: 'declarados'; readonly o: OcupacionConDeclarados };

export function ocupacionDeLaApp(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  productos: ReadonlyMap<string, Product>,
  diametros: ReadonlyMap<string, number>,
  pieza: string,
  excel: DatosOcupacion,
): OcupacionDeLaApp | null {
  const seg = ocupacionSegregada(entrada, elements, productos, diametros, pieza, excel);
  if (seg) return { tipo: 'segregada', o: seg };
  const dec = ocupacionConDeclarados(entrada, elements, productos, diametros, pieza, excel);
  return dec ? { tipo: 'declarados', o: dec } : null;
}
