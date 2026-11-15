/**
 * Etapa 1 del encargo de conexiones importadas: estado de cada conexión del Excel,
 * emparejado manual aparte de lo importado, «Trazar» ligado, reimportación.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../workspace/catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../workspace/placement/definitions';
import { conLongitudesEje } from '../../workspace/placement/longitudesEje';
import { placeDefinition, puertosFromWorld, type V3, type WorldPort } from '../../workspace/placement/placementCore';
import { crearBajada } from '../../workspace/equipos/bajada';
import { geometriaPuntoEnTramo } from '../../workspace/derivacion/enganche';
import { borrarCircuito, circuitosOf, guardarCircuito } from '../../workspace/recorridos/circuitosGuardados';
import { toMotorEntrada } from '../../tray/store';
import type { EquipmentElement } from '../../types/domain-v2';
import type { Product, TrayInput } from '../../tray/model';
import type { ConexionImportada, ImportedCatalog } from '../../import/types';
import { DECLARADO_KEY, declaradoOf, emparejar } from '../declarado';
import { estadosDeConexiones, relacionConExcel } from '../estadoConexion';
import { recalcularConExcel, retrazarConexion, trazarConexion } from '../acciones';
import { circuitosParaMotor } from '../../workspace/motor/paraMotor';
import { construirCatalogoCables, idDeCable } from '../../workspace/cables/catalogoCables';
import { elegirCable } from '../declarado';
import type { TendidoImportado } from '../../import/types';

const snapshot = JSON.parse(readFileSync(resolve(__dirname, '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const productos = new Map(snapshot.PRODUCTOS.map((p) => [p.producto_id, p]));

beforeAll(async () => {
  clearPortMappingOverrides();
  await seedStaticCatalog();
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

/** R1 ─ R2, rectos de 2000 mm. */
function tramo(): TrayInput {
  let t = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput;
  const bocas = new Map<string, WorldPort[]>();
  for (const [id, en] of [['R1', undefined], ['R2', ['R1', 'P2']]] as const) {
    const d = definicionEfectiva(productos.get('SAM_TRPS-300-22-Z')!, { longitud_mm: 2000 });
    if (!d.ok) throw new Error(d.motivo);
    const boca = en ? bocas.get(en[0])!.find((p) => p.name === en[1])! : undefined;
    const pl = placeDefinition({
      def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1',
      startPos: boca ? boca.pos : [0, 0, 0], entryDir: boca ? boca.normal : [1, 0, 0], sectionUp: (boca ? boca.vDir : [0, 0, 1]) as V3,
    });
    bocas.set(id, pl.ports);
    t = withDefinition(t, d.huella, d.def);
    const pieza = conLongitudesEje({ instancia_id: id, producto_id: 'SAM_TRPS-300-22-Z', longitud_mm: 2000, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never, d.def);
    t = { ...t, piezas: [...t.piezas, pieza] };
    if (en) t = { ...t, conexiones: [...t.conexiones, { conexion_id: `${en[0]}-${id}`, a: [...en], b: [id, 'P1'] }] };
  }
  return t;
}

function equipo(id: string, name: string, pos: readonly number[], equipoId: string | null, placed = true): EquipmentElement {
  return {
    id, name, tag: null, aliases: [], category: 'electrical_panel', parentId: null, geometry: null,
    importedRef: equipoId ? { equipoId, libroId: 'libro' } : null,
    ...(placed
      ? { placementStatus: 'placed', transform: { positionMm: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }
      : { placementStatus: 'unplaced', transform: null }),
  } as unknown as EquipmentElement;
}

/** TD-EX (EQ-0011) enlazado en R1; TAB-A (EQ-0009) enlazado en R2; MOT (EQ-0020) en la escena sin enlace. */
function proyecto() {
  let t = tramo();
  const g1 = geometriaPuntoEnTramo(t, productos, { tronco: 'R1', desde_boca: 'P1', distancia_mm: 200, lado: 'izquierda' });
  const g2 = geometriaPuntoEnTramo(t, productos, { tronco: 'R2', desde_boca: 'P2', distancia_mm: 100, lado: 'derecha' });
  if (!g1.ok || !g2.ok) throw new Error('geometría');
  const elements = [
    equipo('EQ-0011', 'TD-EX', g1.F.map((x, i) => x + [0, 800, 0][i]), 'EQ-0011'),
    equipo('EQ-0009', 'TAB-A', g2.F.map((x, i) => x + [0, -500, 0][i]), 'EQ-0009'),
    equipo('EQ-0020', 'MOT-1', [5000, 3000, 0], 'EQ-0020'),
    equipo('EQ-0030', 'BOMBA sin ubicar', [0, 0, 0], 'EQ-0030', false),
    equipo('el-manual', 'Caja manual', g2.F.map((x, i) => x + [0, -900, 0][i]), null),
  ];
  for (const [eq, tronco, desde, d, lado] of [['EQ-0011', 'R1', 'P1', 200, 'izquierda'], ['EQ-0009', 'R2', 'P2', 100, 'derecha']] as const) {
    const b = crearBajada(t, productos, elements, { equipo: eq, tronco, desde_boca: desde, distancia_mm: d, lado });
    if (!b.ok) throw new Error(b.motivo);
    t = b.entrada;
  }
  return { t, elements };
}

const cx = (id: string, extra: Partial<ConexionImportada>): ConexionImportada => ({
  conexionId: id, servicio: 'POTENCIA', descripcion: `desc ${id}`, origenTextoOriginal: 'TD-EX', destinoTextoOriginal: 'TAB-A',
  proyecto: 'SEC', estadoAlcance: 'NUEVO', origenEquipoId: 'EQ-0011', destinoEquipoId: 'EQ-0009', ...extra,
});

function catalogo(conexiones: ConexionImportada[]): ImportedCatalog {
  return {
    meta: { formatoId: 'ELS-IMP-EQCX', formatoVersion: '1.0', nombreArchivo: 'x.xlsx', fileHash: 'h', importedAt: '' },
    equipos: [], componentes: [], atributos: [], conexiones, tendidos: [], alias: [], pendientes: [], trazabilidad: [], catalogoAtributos: [], listas: {},
  };
}

const CAT = catalogo([
  cx('CX-0001', { circuitoTag: 'F-TAB-A', tensionV: 380 }),
  cx('CX-0002', { destinoEquipoId: undefined, destinoTextoOriginal: 'CAJA-X' }),
  cx('CX-0003', { destinoEquipoId: 'EQ-0030', destinoTextoOriginal: 'BOMBA' }),
  cx('CX-0004', { destinoEquipoId: 'EQ-0020', destinoTextoOriginal: 'MOT-1', servicio: 'CONTROL' }),
  cx('CX-0005', { destinoEquipoId: 'EQ-0099', destinoTextoOriginal: 'NO-COLOCADO' }),
  cx('CX-0006', { servicio: 'NEUMATICA' }),
  cx('CX-0007', { servicio: 'EQUIPOTENCIALIDAD', origenEquipoId: undefined, destinoEquipoId: undefined }),
  cx('CX-0008', { servicio: 'COMUNICACION' }),
]);

const estadoDe = (t: TrayInput, elements: readonly EquipmentElement[], id: string, cat = CAT) =>
  estadosDeConexiones(cat, t, elements).find((e) => e.conexion.conexionId === id)!;

describe('estado de cada conexión del Excel', () => {
  it('cada estado con su motivo; sólo «sin trazar» es trazable', () => {
    const { t, elements } = proyecto();
    const est = Object.fromEntries(estadosDeConexiones(CAT, t, elements).map((e) => [e.conexion.conexionId, e]));
    expect(est['CX-0001']).toMatchObject({ codigo: 'sin-trazar', trazable: true });
    expect(est['CX-0002'].codigo).toBe('sin-resolver');
    expect(est['CX-0002'].motivos[0]).toMatch(/destino «CAJA-X».*emparejalo a mano/);
    expect(est['CX-0003'].codigo).toBe('sin-ubicar');
    expect(est['CX-0005']).toMatchObject({ codigo: 'sin-ubicar' });
    expect(est['CX-0005'].motivos[0]).toMatch(/EQ-0099 «NO-COLOCADO».*no está en la escena/);
    expect(est['CX-0004'].codigo).toBe('sin-enlace');
    expect(est['CX-0004'].motivos[0]).toMatch(/MOT-1.*no tiene enlace con la bandeja/);
    expect(est['CX-0006'].codigo).toBe('no-se-traza');
    expect(est['CX-0006'].motivos[0]).toMatch(/tubo de aire/);
    expect(est['CX-0007'].codigo).toBe('no-se-traza');
    expect(est['CX-0008']).toMatchObject({ codigo: 'sin-trazar', trazable: true }); // COMUNICACION se traza
    expect(Object.values(est).filter((e) => e.trazable).map((e) => e.conexion.conexionId)).toEqual(['CX-0001', 'CX-0008']);
  });

  it('control negativo: una conexión sin equipo resuelto no es trazable y «Trazar» se niega', () => {
    const { t, elements } = proyecto();
    const e = estadoDe(t, elements, 'CX-0002');
    expect(e.trazable).toBe(false);
    const r = trazarConexion(t, elements, e);
    expect(r.ok).toBe(false);
    expect(circuitosOf(t)).toHaveLength(0);
  });

  it('emparejado a mano: dato del operador, aparte; no toca lo importado ni aparece como del Excel', () => {
    const { t, elements } = proyecto();
    const antes = structuredClone(CAT);
    // Con un enlace a bandeja para la caja manual, para poder trazar.
    const b = crearBajada(t, productos, elements, { equipo: 'el-manual', tronco: 'R2', desde_boca: 'P2', distancia_mm: 400, lado: 'derecha' });
    if (!b.ok) throw new Error(b.motivo);
    const t2 = emparejar(b.entrada, 'CX-0002', 'destino', 'el-manual');
    const e = estadoDe(t2, elements, 'CX-0002');
    expect(e.destino).toMatchObject({ fuente: 'operador', elementoId: 'el-manual', texto: 'CAJA-X' });
    expect(e.codigo).toBe('sin-trazar');
    expect(declaradoOf(t2).emparejados['CX-0002'].destino).toMatchObject({ equipo: 'el-manual', procedencia: 'operador' });
    // Lo importado sigue igual: el Excel no trae destino.
    expect(CAT).toEqual(antes);
    expect(e.conexion.destinoEquipoId).toBeUndefined();
    // Control negativo: el emparejado nunca se presenta como dato del Excel.
    expect(e.destino.fuente).not.toBe('excel');
    // Si el Excel pasa a traer el equipo, manda el Excel.
    const cat2 = catalogo(CAT.conexiones.map((c) => (c.conexionId === 'CX-0002' ? { ...c, destinoEquipoId: 'EQ-0009' } : c)));
    expect(estadoDe(t2, elements, 'CX-0002', cat2).destino).toMatchObject({ fuente: 'excel', equipoId: 'EQ-0009' });
    // Quitar el emparejado.
    expect(declaradoOf(emparejar(t2, 'CX-0002', 'destino', null)).emparejados['CX-0002']).toBeUndefined();
  });
});

describe('Trazar desde una conexión', () => {
  it('crea el circuito con origen y destino puestos, ligado a la conexión', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001'));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.circuitoId).toBe('CIR-CX-0001');
    const c = circuitosOf(r.entrada)[0];
    expect(c).toMatchObject({ id: 'CIR-CX-0001', nombre: 'F-TAB-A', origen: { equipo: 'EQ-0011' }, destino: { equipo: 'EQ-0009' } });
    expect(c.cruces.map((x) => x.pieza)).toEqual(['R1', 'R2']);
    expect(declaradoOf(r.entrada).vinculos['CIR-CX-0001']).toMatchObject({ conexionId: 'CX-0001', procedencia: 'operador' });
    expect(estadoDe(r.entrada, elements, 'CX-0001')).toMatchObject({ codigo: 'trazada', trazable: false });
    expect(relacionConExcel(r.entrada, CAT, c)).toEqual({ tipo: 'ligado', conexionId: 'CX-0001', motivos: [], enElExcel: true });
  });

  it('un circuito armado a mano queda «fuera del Excel»', () => {
    const { t, elements } = proyecto();
    const g = guardarCircuito(t, elements, 'A mano', { equipo: 'EQ-0011' }, { equipo: 'EQ-0009' });
    if (!g.ok) throw new Error(g.motivo);
    expect(relacionConExcel(g.entrada, CAT, g.circuito)).toEqual({ tipo: 'fuera-del-excel' });
    // No liga la conexión: sigue sin trazar.
    expect(estadoDe(g.entrada, elements, 'CX-0001').codigo).toBe('sin-trazar');
  });

  it('lo declarado no viaja al motor', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(emparejar(t, 'CX-0002', 'destino', 'el-manual'), elements, estadoDe(t, elements, 'CX-0001'));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.entrada).toHaveProperty(DECLARADO_KEY);
    const m = toMotorEntrada(r.entrada, { elements });
    expect(m).not.toHaveProperty(DECLARADO_KEY);
    expect(JSON.stringify(m)).not.toContain('CX-0001');
  });

  it('borrar el circuito se lleva el vínculo', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001'));
    if (!r.ok) throw new Error(r.motivo);
    const t2 = borrarCircuito(r.entrada, 'CIR-CX-0001');
    expect(declaradoOf(t2).vinculos).toEqual({});
    expect(estadoDe(t2, elements, 'CX-0001').codigo).toBe('sin-trazar');
  });
});

describe('reimportar', () => {
  it('si la conexión cambió, el circuito queda marcado con el motivo; no se borra ni se recalcula solo; retrazar lo pone al día', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001'));
    if (!r.ok) throw new Error(r.motivo);
    const cat2 = catalogo(CAT.conexiones.map((c) => (c.conexionId === 'CX-0001' ? { ...c, tensionV: 400 } : c)));
    const e = estadoDe(r.entrada, elements, 'CX-0001', cat2);
    expect(e.codigo).toBe('desactualizada');
    expect(e.motivos.join()).toMatch(/CX-0001 cambió en el Excel: tensionV \(380 → 400\)/);
    expect(circuitosOf(r.entrada)).toHaveLength(1);
    const rt = retrazarConexion(r.entrada, elements, e);
    if (!rt.ok) throw new Error(rt.motivo);
    expect(estadoDe(rt.entrada, elements, 'CX-0001', cat2).codigo).toBe('trazada');
  });

  it('si el Excel cambia el equipo de un extremo, el circuito queda desactualizado; recalcular toma el nuevo', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001'));
    if (!r.ok) throw new Error(r.motivo);
    const b = crearBajada(r.entrada, productos, elements, { equipo: 'el-manual', tronco: 'R2', desde_boca: 'P2', distancia_mm: 400, lado: 'derecha' });
    if (!b.ok) throw new Error(b.motivo);
    const el2 = elements.map((e) => (e.id === 'el-manual' ? { ...e, importedRef: { equipoId: 'EQ-0050', libroId: 'l' } } : e));
    const cat2 = catalogo(CAT.conexiones.map((c) => (c.conexionId === 'CX-0001' ? { ...c, destinoEquipoId: 'EQ-0050' } : c)));
    const e = estadoDe(b.entrada, el2, 'CX-0001', cat2);
    expect(e.codigo).toBe('desactualizada');
    expect(e.motivos.join()).toMatch(/equipo de destino ya no es el del circuito \(EQ-0009 → el-manual\)/);
    const rc = recalcularConExcel(b.entrada, el2, cat2, 'CIR-CX-0001');
    if (!rc.ok) throw new Error(rc.motivo);
    expect(circuitosOf(rc.entrada)[0].destino.equipo).toBe('el-manual');
    expect(estadoDe(rc.entrada, el2, 'CX-0001', cat2).codigo).toBe('trazada');
  });

  it('si la conexión desapareció, el circuito sigue y dice por qué', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001'));
    if (!r.ok) throw new Error(r.motivo);
    const cat2 = catalogo(CAT.conexiones.filter((c) => c.conexionId !== 'CX-0001'));
    const c = circuitosOf(r.entrada)[0];
    expect(relacionConExcel(r.entrada, cat2, c)).toMatchObject({ tipo: 'ligado', enElExcel: false, motivos: ['la conexión CX-0001 ya no está en el Excel'] });
    expect(circuitosOf(r.entrada)).toHaveLength(1);
  });

  it('el emparejado manual sobrevive a la reimportación', () => {
    const { t, elements } = proyecto();
    const t2 = emparejar(t, 'CX-0002', 'destino', 'el-manual');
    const cat2 = catalogo(CAT.conexiones.map((c) => ({ ...c, descripcion: `${c.descripcion} rev1` })));
    expect(estadoDe(t2, elements, 'CX-0002', cat2).destino).toMatchObject({ fuente: 'operador', elementoId: 'el-manual' });
  });
});

// ─── Etapa 2: al motor, un circuito por tendido de potencia con cable ────────

const DS = ['prysmian_sintenax_valio_2020', 'prysmian_superastic_flex_2026'].map((f) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../vendor/motor_bandejas/datos/cables/${f}.json`), 'utf-8')));
const IDS = DS.flatMap((d) => d.tablas.flatMap((t: { filas: [string][] }) => t.filas.map((r) => idDeCable(d.dataset_id, t as never, r[0])!)));
const CC = construirCatalogoCables(DS, IDS);
const CABLES = CC.ok ? CC.cables : [];

const tend = (id: string, extra: Partial<TendidoImportado>): TendidoImportado => ({
  tendidoId: id, conexionId: 'CX-0001', naturaleza: 'CONDUCTOR_UNIPOLAR', funcion: 'FASES', cantidadUnidades: 1, conductoresPorUnidad: 1,
  incluyePe: 'NO_APLICA', apantallado: 'NO_INDICADO', estadoAlcance: 'NUEVO', fuenteHoja: 'CONDUCTORES', ...extra,
});

describe('etapa 2 — al motor', () => {
  const TENDIDOS = [
    tend('CB-001', { seccionMm2: 150, cantidadUnidades: 6, designacion: '2×(3×1×150)' }),
    tend('CB-002', { funcion: 'NEUTRO', seccionMm2: 35 }),
    tend('CB-003', { funcion: 'PE', seccionMm2: 95, designacion: '1×95 V/A' }),
    tend('CB-004', { naturaleza: 'CABLE_MULTIPOLAR', funcion: '3F+N+PE', conductoresPorUnidad: 5, seccionMm2: 6 }),
  ];
  const cat2 = { ...CAT, tendidos: [...TENDIDOS, tend('CB-900', { conexionId: 'CX-0004', naturaleza: 'CABLE_MULTIPOLAR', funcion: 'SENAL_CONTROL', conductoresPorUnidad: 2, seccionMm2: 1.5 })] };

  it('un circuito por tendido de potencia con cable, todos con el mismo recorrido; el de 5 conductores queda con su motivo', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001', cat2));
    if (!r.ok) throw new Error(r.motivo);
    const m = circuitosParaMotor(r.entrada, elements, IDS, { catalog: cat2, cables: CABLES });
    expect(m.enviados).toEqual([
      { circuito_id: 'CIR-CX-0001-CB-001', funcion: 'potencia', cable_id: 'PRY-SVALIO-CU-1x150', cantidad: 6, separado: false, recorrido: ['R1', 'R2'] },
      { circuito_id: 'CIR-CX-0001-CB-002', funcion: 'potencia', cable_id: 'PRY-SVALIO-CU-1x35', cantidad: 1, separado: false, recorrido: ['R1', 'R2'] },
      { circuito_id: 'CIR-CX-0001-CB-003', funcion: 'potencia', cable_id: 'PRY-SVALIO-CU-1x95', cantidad: 1, separado: false, recorrido: ['R1', 'R2'] },
    ]);
    expect(m.noEnviados).toEqual([expect.objectContaining({ id: 'CIR-CX-0001-CB-004', tendidoId: 'CB-004', conexionId: 'CX-0001', potenciaSinCable: true, piezas: ['R1', 'R2'] })]);
    expect(m.noEnviados[0].motivo).toMatch(/5 conductores/);
    // El PE del trazado (el del motor) sigue saliendo de su sección: viaja aparte, una sola vez.
    const salida = toMotorEntrada(r.entrada, { elements, idsCables: IDS, excel: { catalog: cat2, cables: CABLES } });
    expect((salida.circuitos as Array<{ cable_id: string }>).filter((c) => c.cable_id === 'PRY-SASTFLEX-CU-1x16')).toEqual([]);
    expect((salida.pe as { cable_id: string }).cable_id).toBe('PRY-SASTFLEX-CU-1x16');
  });

  it('elegir aluminio en un tendido cambia lo que viaja; dejarlo sin cable lo saca y lo lista', () => {
    const { t, elements } = proyecto();
    const r = trazarConexion(t, elements, estadoDe(t, elements, 'CX-0001', cat2));
    if (!r.ok) throw new Error(r.motivo);
    const e2 = elegirCable(elegirCable(r.entrada, 'CB-001', 'PRY-SVALIO-AL-1x150'), 'CB-002', null);
    const m = circuitosParaMotor(e2, elements, IDS, { catalog: cat2, cables: CABLES });
    expect(m.enviados.map((c) => [c.circuito_id, c.cable_id])).toEqual([['CIR-CX-0001-CB-001', 'PRY-SVALIO-AL-1x150'], ['CIR-CX-0001-CB-003', 'PRY-SVALIO-CU-1x95']]);
    expect(m.noEnviados.filter((n) => n.potenciaSinCable).map((n) => n.tendidoId)).toEqual(['CB-002', 'CB-004']);
  });

  it('el circuito de una conexión de CONTROL no viaja (D-11), con sus tendidos medidos igual', () => {
    const { t, elements } = proyecto();
    const b = crearBajada(t, productos, elements, { equipo: 'EQ-0020', tronco: 'R2', desde_boca: 'P2', distancia_mm: 600, lado: 'izquierda' });
    if (!b.ok) throw new Error(b.motivo);
    const els = elements.map((e) => (e.id === 'EQ-0020' ? { ...e, transform: { ...(e as { transform: object }).transform } } : e)) as typeof elements;
    const r = trazarConexion(b.entrada, els, estadoDe(b.entrada, els, 'CX-0004', cat2));
    if (!r.ok) throw new Error(r.motivo);
    const m = circuitosParaMotor(r.entrada, els, IDS, { catalog: cat2, cables: CABLES });
    expect(m.enviados).toEqual([]);
    expect(m.noEnviados[0].motivo).toMatch(/D-11/);
  });
});
