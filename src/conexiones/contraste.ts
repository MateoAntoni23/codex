/**
 * Etapa 3 — contraste de lo trazado contra la ingeniería del Excel.
 *
 * Sólo comparaciones entre números que ya existen; la app no hace cálculo eléctrico.
 * Cada fila lleva los dos valores con su origen. Si falta un dato, se dice cuál; no se
 * supone. Nunca impide nada.
 *
 *   - longitud: longitud trazada del circuito (bandeja + bajadas) contra `refIngLongitudM`
 *     de la conexión. Si la trazada es mayor, la caída de tensión del Excel se verificó con
 *     una longitud menor: es el aviso más importante.
 *   - corriente: corriente de diseño de la conexión (`refIngCorrienteDisenoA`) contra la
 *     corriente admisible del tendido (`refIngIzA`), las dos del Excel. No aplica a
 *     neutro, PE, equipotencial, datos ni aire.
 *   - metraje: longitud trazada × cantidad del tendido contra `refIngMetrajeCompraM`.
 */
import type { TrayInput } from '../tray/model';
import type { EquipmentElement } from '../types/domain-v2';
import type { ConexionImportada, ImportedCatalog, TendidoImportado } from '../import/types';
import { circuitosOf, estadoCircuito, type CircuitoGuardado } from '../workspace/recorridos/circuitosGuardados';
import { declaradoOf } from './declarado';
import { tendidosDe } from './tendidos';

export type TipoContraste = 'longitud' | 'corriente' | 'metraje';
/** aviso: lo trazado no cierra con la ingeniería · ok: cierra · falta: no se puede comparar · no-aplica. */
export type EstadoContraste = 'aviso' | 'ok' | 'falta' | 'no-aplica';

export interface Valor {
  readonly valor: number | null;
  readonly unidad: string;
  /** De dónde sale: «Excel, CONEXIONES.ref_ing_longitud_m (PM 02/11)» o «trazado: bandeja + bajadas». */
  readonly origen: string;
}

export interface FilaContraste {
  readonly circuitoId: string;
  readonly circuito: string;
  readonly conexionId: string;
  readonly tendidoId: string | null;
  readonly tipo: TipoContraste;
  readonly estado: EstadoContraste;
  /** El valor de la ingeniería (Excel). */
  readonly ingenieria: Valor;
  /** El otro término: lo trazado (longitud, metraje) o el tendido (corriente). */
  readonly comparado: Valor;
  readonly texto: string;
}

export const TEXTO_TIPO: Readonly<Record<TipoContraste, string>> = {
  longitud: 'Longitud trazada vs. longitud de ingeniería',
  corriente: 'Corriente de diseño vs. corriente admisible del tendido',
  metraje: 'Metraje trazado vs. metraje de compra',
};

const SIN_CORRIENTE = new Set<TendidoImportado['funcion']>(['NEUTRO', 'PE', 'EQUIPOTENCIAL', 'DATOS', 'AIRE_COMPRIMIDO']);
const n2 = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const n1 = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1 });

/** Longitud trazada del circuito, en m, con la advertencia si no es definitiva. */
function longitudTrazada(entrada: TrayInput, elements: readonly EquipmentElement[], c: CircuitoGuardado): { m: number; nota: string | null; completa: boolean } {
  const notas: string[] = [];
  if (!c.completa) notas.push(`incompleta: alguna pieza no tiene longitud, la trazada es al menos ${n2(c.sumaMm / 1000)} m`);
  if (!estadoCircuito(entrada, elements, c).vigente) notas.push('el circuito está desactualizado: es la longitud guardada, recalculalo');
  return { m: c.sumaMm / 1000, nota: notas.length ? notas.join('; ') : null, completa: c.completa };
}

function filasDeLongitud(base: Omit<FilaContraste, 'tipo' | 'estado' | 'ingenieria' | 'comparado' | 'texto' | 'tendidoId'>, cx: ConexionImportada, L: ReturnType<typeof longitudTrazada>): FilaContraste {
  const ref = cx.refIngLongitudM ?? null;
  const ingenieria: Valor = { valor: ref, unidad: 'm', origen: `Excel, longitud de ingeniería de ${cx.conexionId}${cx.refIngLongitudOrigen ? ` (${cx.refIngLongitudOrigen})` : ''}` };
  const comparado: Valor = { valor: L.m, unidad: 'm', origen: `trazado: bandeja + bajadas${L.nota ? ` — ${L.nota}` : ''}` };
  const fila = { ...base, tendidoId: null, tipo: 'longitud' as const, ingenieria, comparado };
  if (ref === null) return { ...fila, estado: 'falta', texto: `No se compara: el Excel no trae la longitud de ingeniería (ref_ing_longitud_m) de ${cx.conexionId}.` };
  if (L.m > ref) {
    return {
      ...fila, estado: 'aviso',
      texto: `La longitud trazada (${n2(L.m)} m) es mayor que la de ingeniería (${n2(ref)} m): la caída de tensión del Excel se verificó con una longitud menor.`,
    };
  }
  if (!L.completa) return { ...fila, estado: 'falta', texto: `No se puede concluir: la longitud trazada está incompleta (al menos ${n2(L.m)} m) y no supera la de ingeniería (${n2(ref)} m).` };
  return { ...fila, estado: 'ok', texto: `La longitud trazada (${n2(L.m)} m) no supera la de ingeniería (${n2(ref)} m).` };
}

function filaDeCorriente(base: Omit<FilaContraste, 'tipo' | 'estado' | 'ingenieria' | 'comparado' | 'texto' | 'tendidoId'>, cx: ConexionImportada, t: TendidoImportado): FilaContraste {
  const idis = cx.refIngCorrienteDisenoA ?? null;
  const iz = t.refIngIzA ?? null;
  const fila = {
    ...base, tendidoId: t.tendidoId, tipo: 'corriente' as const,
    ingenieria: { valor: idis, unidad: 'A', origen: `Excel, corriente de diseño de ${cx.conexionId}` },
    comparado: { valor: iz, unidad: 'A', origen: `Excel, corriente admisible (Iz) del tendido ${t.tendidoId}` },
  };
  if (SIN_CORRIENTE.has(t.funcion)) return { ...fila, estado: 'no-aplica', texto: `No aplica: el tendido ${t.tendidoId} es ${t.funcion}.` };
  const faltan = [idis === null ? `la corriente de diseño de ${cx.conexionId} (ref_ing_corriente_diseno_a)` : null, iz === null ? `la corriente admisible del tendido ${t.tendidoId} (ref_ing_iz_a)` : null].filter(Boolean);
  if (faltan.length) return { ...fila, estado: 'falta', texto: `No se compara: el Excel no trae ${faltan.join(' ni ')}.` };
  if (iz! < idis!) return { ...fila, estado: 'aviso', texto: `La corriente admisible del tendido ${t.tendidoId} (${n1(iz!)} A) es menor que la corriente de diseño (${n1(idis!)} A), según el propio Excel.` };
  return { ...fila, estado: 'ok', texto: `La corriente admisible del tendido ${t.tendidoId} (${n1(iz!)} A) cubre la corriente de diseño (${n1(idis!)} A).` };
}

function filaDeMetraje(base: Omit<FilaContraste, 'tipo' | 'estado' | 'ingenieria' | 'comparado' | 'texto' | 'tendidoId'>, t: TendidoImportado, L: ReturnType<typeof longitudTrazada>): FilaContraste {
  const ref = t.refIngMetrajeCompraM ?? null;
  const trazado = L.m * t.cantidadUnidades;
  const existentes = t.cantidadUnidadesExistentes !== undefined ? ` El Excel declara ${t.cantidadUnidadesExistentes} unidad(es) existente(s); no se descuentan.` : '';
  const fila = {
    ...base, tendidoId: t.tendidoId, tipo: 'metraje' as const,
    ingenieria: { valor: ref, unidad: 'm', origen: `Excel, metraje de compra del tendido ${t.tendidoId}` },
    comparado: { valor: trazado, unidad: 'm', origen: `trazado: ${n2(L.m)} m × ${t.cantidadUnidades} (cantidad del Excel)${L.nota ? ` — ${L.nota}` : ''}` },
  };
  if (ref === null) return { ...fila, estado: 'falta', texto: `No se compara: el Excel no trae el metraje de compra del tendido ${t.tendidoId} (ref_ing_metraje_compra_m).` };
  if (trazado > ref) return { ...fila, estado: 'aviso', texto: `El metraje trazado (${n2(trazado)} m) supera el de compra (${n2(ref)} m) del tendido ${t.tendidoId}.${existentes}` };
  if (!L.completa) return { ...fila, estado: 'falta', texto: `No se puede concluir: la longitud trazada está incompleta y el metraje trazado (al menos ${n2(trazado)} m) no supera el de compra (${n2(ref)} m).` };
  return { ...fila, estado: 'ok', texto: `El metraje trazado (${n2(trazado)} m) no supera el de compra (${n2(ref)} m) del tendido ${t.tendidoId}.${existentes}` };
}

/** Contraste de un circuito ligado (vacío si está fuera del Excel o su conexión ya no está). */
export function contrasteDeCircuito(entrada: TrayInput, elements: readonly EquipmentElement[], catalog: ImportedCatalog | null, c: CircuitoGuardado): FilaContraste[] {
  const v = declaradoOf(entrada).vinculos[c.id];
  const cx = v && catalog?.conexiones.find((x) => x.conexionId === v.conexionId);
  if (!cx) return [];
  const base = { circuitoId: c.id, circuito: c.nombre, conexionId: cx.conexionId };
  const L = longitudTrazada(entrada, elements, c);
  const tendidos = tendidosDe(catalog, cx.conexionId);
  return [
    filasDeLongitud(base, cx, L),
    ...tendidos.map((t) => filaDeCorriente(base, cx, t)),
    ...tendidos.map((t) => filaDeMetraje(base, t, L)),
  ];
}

export function contraste(entrada: TrayInput | null | undefined, elements: readonly EquipmentElement[], catalog: ImportedCatalog | null): FilaContraste[] {
  if (!entrada) return [];
  return circuitosOf(entrada).flatMap((c) => contrasteDeCircuito(entrada, elements, catalog, c));
}

/** Tabla copiable (tabulaciones, coma decimal, sin separador de miles). */
export function tsvContraste(filas: readonly FilaContraste[]): string {
  const num = (v: Valor) => (v.valor === null ? '' : v.valor.toLocaleString('es-AR', { maximumFractionDigits: 3, useGrouping: false }));
  return [
    ['Circuito', 'Conexión', 'Tendido', 'Contraste', 'Estado', 'Ingeniería', 'Unidad', 'Origen ingeniería', 'Comparado', 'Unidad', 'Origen comparado', 'Detalle'].join('\t'),
    ...filas.map((f) => [
      f.circuito, f.conexionId, f.tendidoId ?? '', TEXTO_TIPO[f.tipo], f.estado,
      num(f.ingenieria), f.ingenieria.unidad, f.ingenieria.origen, num(f.comparado), f.comparado.unidad, f.comparado.origen, f.texto,
    ].join('\t')),
  ].join('\r\n');
}
