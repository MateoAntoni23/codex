/**
 * Etapa 2 del encargo de conexiones importadas: los cables salen de los tendidos.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { construirCatalogoCables, idDeCable, type CableCatalogo } from '../../workspace/cables/catalogoCables';
import { parseWorkbook } from '../../import/parser';
import type { ConexionImportada, ImportedCatalog, TendidoImportado } from '../../import/types';
import type { TrayInput } from '../../tray/model';
import type { CircuitoGuardado } from '../../workspace/recorridos/circuitosGuardados';
import { circuitosParaMotor, PE_CABLE_ID } from '../../workspace/motor/paraMotor';
import { conDeclarado, declaradoOf, elegirCable, vincular } from '../declarado';
import { cableDeTendido, cablesDelCircuito, cobrePorRegla, faltaConExcel, TEXTO_PROCEDENCIA } from '../tendidos';
import { casarTendido } from '../casarCable';
import { relacionConExcel } from '../estadoConexion';

const DS = ['prysmian_sintenax_valio_2020', 'prysmian_superastic_flex_2026'].map((f) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../vendor/motor_bandejas/datos/cables/${f}.json`), 'utf-8')));
const IDS = DS.flatMap((d) => d.tablas.flatMap((t: { filas: [string][] }) => t.filas.map((r) => idDeCable(d.dataset_id, t as never, r[0])!)));
const r = construirCatalogoCables(DS, IDS);
if (!r.ok) throw new Error(r.motivo);
const CABLES: readonly CableCatalogo[] = r.cables;

const td = (id: string, extra: Partial<TendidoImportado>): TendidoImportado => ({
  tendidoId: id, conexionId: 'CX-0001', naturaleza: 'CABLE_MULTIPOLAR', funcion: '3F+PE', cantidadUnidades: 1,
  incluyePe: 'NO_APLICA', apantallado: 'NO_INDICADO', estadoAlcance: 'NUEVO', fuenteHoja: 'CONDUCTORES', ...extra,
});
const VACIO = declaradoOf(null);

describe('cable de cada tendido, con su procedencia', () => {
  it('un único candidato se propone, con esa procedencia', () => {
    // 3×1,5 Cu: el aluminio tripolar arranca en 4 mm².
    const k = cableDeTendido(td('CB-1', { conductoresPorUnidad: 3, seccionMm2: 1.5 }), CABLES, VACIO);
    expect(k).toMatchObject({ procedencia: 'unico-candidato', motivoSinCable: null });
    expect(k.cable?.cable_id).toBe('PRY-SVALIO-CU-3x1.5');
  });

  it('regla del operador: cobre contra aluminio de la misma formación → se propone el cobre, a la vista como regla', () => {
    const t = td('CB-2', { conductoresPorUnidad: 4, seccionMm2: 10 });
    expect(casarTendido(t, CABLES).estado).toBe('varios');
    const k = cableDeTendido(t, CABLES, VACIO);
    expect(k.cable?.cable_id).toBe('PRY-SVALIO-CU-4x10');
    expect(k.procedencia).toBe('regla-cobre');
    // Control negativo: no se presenta como dato del Excel ni como único candidato.
    expect(k.procedencia).not.toBe('unico-candidato');
    expect(TEXTO_PROCEDENCIA['regla-cobre']).toMatch(/regla del operador.*cobre.*el Excel no trae material/);
    // El operador lo cambia a aluminio en ese tendido.
    const d = declaradoOf(elegirCable(conDeclarado({} as TrayInput, VACIO), 'CB-2', 'PRY-SVALIO-AL-4x10'));
    const al = cableDeTendido(t, CABLES, d);
    expect(al).toMatchObject({ procedencia: 'operador' });
    expect(al.cable?.cable_id).toBe('PRY-SVALIO-AL-4x10');
    expect(cableDeTendido(td('CB-3', { conductoresPorUnidad: 4, seccionMm2: 10 }), CABLES, d).procedencia).toBe('regla-cobre'); // sólo ese tendido
  });

  it('la regla no decide si los candidatos difieren en otra cosa que el material: elige el operador', () => {
    const t = td('CB-4', { naturaleza: 'CONDUCTOR_UNIPOLAR', funcion: 'FASES', conductoresPorUnidad: 1, seccionMm2: 16 });
    expect(casarTendido(t, CABLES).estado).toBe('varios'); // Sintenax Cu y Superastic Cu
    expect(cobrePorRegla((casarTendido(t, CABLES) as unknown as { candidatos: CableCatalogo[] }).candidatos)).toBeNull();
    const k = cableDeTendido(t, CABLES, VACIO);
    expect(k).toMatchObject({ cable: null, procedencia: null, motivoSinCable: '2 candidatos en el catálogo: elegí uno' });
  });

  it('nunca un cable por defecto: sin candidato queda sin cable, con el motivo', () => {
    const k = cableDeTendido(td('CB-5', { funcion: '3F+N+PE', conductoresPorUnidad: 5, seccionMm2: 6 }), CABLES, VACIO);
    expect(k).toMatchObject({ cable: null, procedencia: null, candidatos: [] });
    expect(k.motivoSinCable).toMatch(/5 conductores/);
  });

  it('el operador puede dejarlo sin cable de catálogo', () => {
    const d = declaradoOf(elegirCable(conDeclarado({} as TrayInput, VACIO), 'CB-1', null));
    expect(cableDeTendido(td('CB-1', { conductoresPorUnidad: 3, seccionMm2: 1.5 }), CABLES, d)).toMatchObject({ cable: null, procedencia: 'operador' });
  });

  it('diámetro del Excel distinto del de catálogo: aviso con los dos números', () => {
    const k = cableDeTendido(td('CB-6', { conductoresPorUnidad: 3, seccionMm2: 1.5, diametroExteriorMm: 12 }), CABLES, VACIO);
    expect(k.avisos[0]).toMatch(/Excel \(12 mm\).*catálogo \([\d,]+ mm\).*el motor con el suyo/);
    expect(cableDeTendido(td('CB-7', { conductoresPorUnidad: 3, seccionMm2: 1.5, diametroExteriorMm: k.cable!.diametro_exterior_mm }), CABLES, VACIO).avisos).toEqual([]);
  });
});

// ─── Circuito ligado → motor ─────────────────────────────────────────────────

const CX: ConexionImportada = {
  conexionId: 'CX-0001', servicio: 'POTENCIA', descripcion: 'x', origenTextoOriginal: 'A', destinoTextoOriginal: 'B',
  proyecto: 'P', estadoAlcance: 'NUEVO', origenEquipoId: 'EQ-1', destinoEquipoId: 'EQ-2',
};
const TENDIDOS = [
  td('CB-F', { naturaleza: 'CONDUCTOR_UNIPOLAR', funcion: 'FASES', conductoresPorUnidad: 1, seccionMm2: 150, cantidadUnidades: 6 }),
  td('CB-PE', { naturaleza: 'CONDUCTOR_UNIPOLAR', funcion: 'PE', conductoresPorUnidad: 1, seccionMm2: 95, cantidadUnidades: 1 }),
  td('CB-5', { funcion: '3F+N+PE', conductoresPorUnidad: 5, seccionMm2: 6, cantidadUnidades: 1 }),
];
const cat = (conexiones: ConexionImportada[], tendidos: TendidoImportado[]): ImportedCatalog => ({
  meta: { formatoId: 'ELS-IMP-EQCX', formatoVersion: '1.0', nombreArchivo: 'x', fileHash: 'h', importedAt: '' },
  equipos: [], componentes: [], atributos: [], conexiones, tendidos, alias: [], pendientes: [], trazabilidad: [], catalogoAtributos: [], listas: {},
});
/** Circuito guardado mínimo: sin bajadas ni piezas que validar (estadoCircuito no encuentra motivos). */
const CIRC: CircuitoGuardado = {
  id: 'CIR-CX-0001', nombre: 'F-TAB-A', origen: { equipo: 'EQ-1' }, destino: { equipo: 'EQ-2' },
  bajadas: { origen: { id: 'BAJ-1', firma: '', longitud_mm: 0 }, destino: { id: 'BAJ-2', firma: '', longitud_mm: 0 } },
  cruces: [], uniones: [], bandejaMm: 0, bajadasMm: 0, sumaMm: 0, completa: true, guardado_iso: '',
};
function entradaCon(c: ConexionImportada, tendidos: TendidoImportado[]): TrayInput {
  const base = { version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {}, circuitos_ws: [{ ...CIRC, cruces: [{ pieza: 'R1', entrada: 'P1', salida: 'P2', longitudMm: 1, fuente: null, bocas: {} }, { pieza: 'R2', entrada: 'P1', salida: 'P2', longitudMm: 1, fuente: null, bocas: {} }] }] } as unknown as TrayInput;
  return vincular(base, 'CIR-CX-0001', c, tendidos);
}

describe('circuito ligado: lleva todos los tendidos; al motor, uno por tendido de potencia con cable', () => {
  const elements = [{ id: 'EQ-1' }, { id: 'EQ-2' }] as never;

  it('lleva todos sus tendidos', () => {
    const e = entradaCon(CX, TENDIDOS);
    const items = cablesDelCircuito(e, cat([CX], TENDIDOS), CABLES, { ...CIRC });
    expect(items.map((k) => [k.tendidoId, k.cable_id, k.cantidad, k.procedencia])).toEqual([
      ['CB-F', 'PRY-SVALIO-CU-1x150', 6, 'regla-cobre'],
      ['CB-PE', 'PRY-SVALIO-CU-1x95', 1, 'regla-cobre'],
      ['CB-5', null, 1, null],
    ]);
    expect(faltaConExcel(e, cat([CX], TENDIDOS), CABLES, CIRC)).toEqual([expect.stringMatching(/el tendido CB-5 no lleva cable de catálogo/)]);
  });

  it('control: un circuito ligado de CONTROL no viaja (D-11); uno cuya conexión cambió en el Excel tampoco', () => {
    const ctl = { ...CX, servicio: 'CONTROL' as const };
    const e = entradaCon(ctl, []);
    const r1 = circuitosParaMotor(e, elements, IDS, { catalog: cat([ctl], []), cables: CABLES });
    expect(r1.enviados).toEqual([]);
    expect(r1.noEnviados[0].motivo).toMatch(/D-11/);
    const cambiada = { ...CX, tensionV: 400 };
    const r2 = circuitosParaMotor(entradaCon(CX, TENDIDOS), elements, IDS, { catalog: cat([cambiada], TENDIDOS), cables: CABLES });
    expect(r2.noEnviados[0].motivo).toMatch(/Desactualizado respecto del Excel.*tensionV/);
  });

  it('reimportar: un tendido que cambió, desapareció o se sumó marca el circuito', () => {
    const e = entradaCon(CX, TENDIDOS);
    const nuevos = [{ ...TENDIDOS[0], seccionMm2: 185 }, TENDIDOS[2], td('CB-N', { conductoresPorUnidad: 3, seccionMm2: 4 })];
    const rel = relacionConExcel(e, cat([CX], nuevos), CIRC);
    expect(rel).toMatchObject({ tipo: 'ligado' });
    expect((rel as unknown as { motivos: string[] }).motivos).toEqual([
      'el tendido CB-F cambió en el Excel: seccionMm2 (150 → 185)',
      'el tendido CB-PE ya no está en el Excel',
      'el Excel suma el tendido CB-N',
    ]);
  });
});

describe('PE: un tendido PE importado no se cuenta dos veces', () => {
  it('el cable del PE del trazado (el del motor) nunca viaja como tendido', () => {
    expect(PE_CABLE_ID).toBe('PRY-SASTFLEX-CU-1x16');
    // Un PE de 16 mm² del Excel casa con Sintenax Cu y con Superastic Cu (el del PE del trazado): elige el operador.
    const t = td('CB-PE16', { naturaleza: 'CONDUCTOR_UNIPOLAR', funcion: 'PE', conductoresPorUnidad: 1, seccionMm2: 16 });
    expect(cableDeTendido(t, CABLES, VACIO).cable).toBeNull();
  });
});

describe('sobre el Excel de ejemplo', () => {
  it('multipolares sin candidato: 125, 8 de potencia; procedencias de la propuesta', async () => {
    const buf = readFileSync(resolve(__dirname, '../../import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx'));
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const c = (await parseWorkbook(ab, 'x.xlsx')).catalog!;
    const servicio = new Map(c.conexiones.map((x) => [x.conexionId, x.servicio]));
    const multi = c.tendidos.filter((t) => t.naturaleza === 'CABLE_MULTIPOLAR');
    const sin = multi.filter((t) => casarTendido(t, CABLES).estado === 'ninguno');
    expect(sin).toHaveLength(125);
    expect(sin.filter((t) => servicio.get(t.conexionId) === 'POTENCIA').map((t) => t.tendidoId).sort()).toEqual(
      ['CB-010', 'CB-012', 'CB-014', 'CB-016', 'CB-197', 'CB-199', 'CB-206', 'CB-217'],
    );
    const proc = (p: string | null) => c.tendidos.filter((t) => cableDeTendido(t, CABLES, VACIO).procedencia === p).length;
    expect({ unico: proc('unico-candidato'), cobre: proc('regla-cobre'), sinCable: proc(null) }).toEqual({ unico: 63, cobre: 40, sinCable: 176 });
  }, 60_000);
});
