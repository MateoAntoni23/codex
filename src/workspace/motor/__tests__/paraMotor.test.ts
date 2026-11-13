/**
 * Lo que viaja al motor (etapa 3, parte A): circuitos de potencia y PE del trazado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../placement/definitions';
import { placeDefinition, puertosFromWorld, type V3, type WorldPort } from '../../placement/placementCore';
import { translatePiece } from '../../trayMovement';
import { crearBajada } from '../../equipos/bajada';
import { guardarCircuito, MOTIVO_D11, type CableDeCircuito } from '../../recorridos/circuitosGuardados';
import { circuitosParaMotor, PE_CABLE_ID, PE_SECCION_MM2, peDelTrazado } from '../paraMotor';
import type { Product, TrayInput } from '../../../tray/model';
import type { EquipmentElement } from '../../../types/domain-v2';

const VENDOR = resolve(__dirname, '../../../../vendor/motor_bandejas');
const snapshot = JSON.parse(readFileSync(resolve(VENDOR, 'datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
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

/** R1 ─ R2 ─ T(tronco) ─ R3 ;  T derivación ─ R4 */
function cadena(): TrayInput {
  let t = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput;
  const bocas = new Map<string, WorldPort[]>();
  const colocar = (id: string, productoId: string, entrada: string, en?: [string, string], L = 1000) => {
    const d = definicionEfectiva(productos.get(productoId)!, { longitud_mm: L });
    if (!d.ok) throw new Error(d.motivo);
    const boca = en ? bocas.get(en[0])!.find((p) => p.name === en[1])! : undefined;
    const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: entrada,
      startPos: boca ? boca.pos : [0, 0, 0], entryDir: boca ? boca.normal : [1, 0, 0], sectionUp: (boca ? boca.vDir : [0, 0, 1]) as V3 });
    bocas.set(id, pl.ports);
    t = withDefinition(t, d.huella, d.def);
    const recto = productos.get(productoId)!.tipo_pieza === 'recta';
    t = { ...t, piezas: [...t.piezas, { instancia_id: id, producto_id: productoId, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion, ...(recto ? { longitud_mm: L } : {}) } as never] };
    if (en) t = { ...t, conexiones: [...t.conexiones, { conexion_id: `${en[0]}-${id}`, a: en, b: [id, entrada] }] };
  };
  colocar('R1', 'SAM_TRPS-300-22-Z', 'P1');
  colocar('R2', 'SAM_TRPS-300-22-Z', 'P1', ['R1', 'P2'], 1500);
  colocar('T', 'SAM_TPS-300-Z', 'tronco_P1', ['R2', 'P2']);
  colocar('R3', 'SAM_TRPS-300-22-Z', 'P1', ['T', 'tronco_P2'], 2000);
  colocar('R4', 'SAM_TRPS-300-22-Z', 'P1', ['T', 'boca_derivacion'], 800);
  return t;
}

const eq = (id: string, pos: number[]) => ({
  id, name: id, tag: null, category: 'pump', parentId: null, placementStatus: 'placed',
  transform: { positionMm: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
}) as unknown as EquipmentElement;
const ELS = [eq('A', [0, 2000, 0]), eq('B', [3000, 2000, 0])];

function conEnlaces() {
  let t = cadena();
  for (const [e, tronco] of [['A', 'R1'], ['B', 'R3']] as const) {
    const b = crearBajada(t, productos, ELS, { equipo: e, tronco, desde_boca: 'P1', distancia_mm: 100, lado: 'izquierda' });
    if (!b.ok) throw new Error(b.motivo);
    t = b.entrada;
  }
  return t;
}
const cable = (funcion: CableDeCircuito['funcion'], cable_id = 'PRY-SVALIO-CU-3x50'): CableDeCircuito => ({ cable_id, cantidad: 2, separado: null, funcion });
const guardar = (t: TrayInput, nombre: string, c?: CableDeCircuito) => {
  const g = guardarCircuito(t, ELS, nombre, { equipo: 'A' }, { equipo: 'B' }, c);
  if (!g.ok) throw new Error(g.motivo);
  return g.entrada;
};

describe('circuitos que viajan al motor', () => {
  it('sólo potencia, con cable y vigente; separado en false; recorrido = piezas de bandeja en orden', () => {
    let t = conEnlaces();
    t = guardar(t, 'Fuerza', cable('potencia'));
    t = guardar(t, 'Mando', cable('maniobra', 'PRY-SVALIO-CU-4x2.5'));
    t = guardar(t, 'Señal', cable('instrumentacion', 'PRY-SVALIO-CU-2x1.5'));
    t = guardar(t, 'Sin cable');
    const r = circuitosParaMotor(t, ELS);
    expect(r.enviados).toEqual([
      { circuito_id: 'CIR-1', funcion: 'potencia', cable_id: 'PRY-SVALIO-CU-3x50', cantidad: 2, separado: false, recorrido: ['R1', 'R2', 'T', 'R3'] },
    ]);
    expect(r.noEnviados.map((x) => [x.nombre, x.motivo])).toEqual([
      ['Mando', `No va al motor — ${MOTIVO_D11}`],
      ['Señal', `No va al motor — ${MOTIVO_D11}`],
      ['Sin cable', 'Incompleto: le falta el cable para poder calcular'],
    ]);
    // El motivo cita D-11 y lo que no se calcula igual se mide.
    expect(r.noEnviados[0].motivo).toContain('D-11');
    expect(r.noEnviados[0].sumaMm).toBeGreaterThan(0);
  });

  it('control negativo: si la función no se mira, un circuito de maniobra viajaría y esta prueba lo detecta', () => {
    const t = guardar(conEnlaces(), 'Mando', cable('maniobra'));
    expect(circuitosParaMotor(t, ELS).enviados).toEqual([]);
  });

  it('no viaja: desactualizado (recalcular antes) ni con el cable del PE (se contaría dos veces)', () => {
    let t = guardar(conEnlaces(), 'Fuerza', cable('potencia'));
    const movida = translatePiece(t, 'R2', [0, 0, 5]);
    expect(circuitosParaMotor(movida, ELS).noEnviados[0].motivo).toMatch(/^Desactualizado \(recalculalo antes de calcular\): la pieza R2 se movió/);
    t = guardar(conEnlaces(), 'PE como fuerza', cable('potencia', PE_CABLE_ID));
    expect(circuitosParaMotor(t, ELS).noEnviados[0].motivo).toBe(`Su cable (${PE_CABLE_ID}) es el del PE: el motor lo contaría dos veces`);
  });
});

describe('PE del trazado', () => {
  it('sale de las decisiones aprobadas: D-20 = 16 mm² y el único cable unipolar de 16 mm² verde/amarillo (D-21)', () => {
    const dec = JSON.parse(readFileSync(resolve(VENDOR, 'datos/decisiones_producto.json'), 'utf8'));
    expect(dec['D-20_seccion_pe_mm2']).toBe(PE_SECCION_MM2);
    expect(dec['D-21_identificacion_pe_requerida']).toBe('verde/amarillo');
    const candidatos: string[] = [];
    for (const f of readdirSync(resolve(VENDOR, 'datos/cables'))) {
      const ds = JSON.parse(readFileSync(resolve(VENDOR, 'datos/cables', f), 'utf8'));
      for (const t of ds.tablas) {
        if (t.n_conductores !== 1 || !(t.colores ?? []).some((c: string) => c.includes('verde/amarillo'))) continue;
        for (const fila of t.filas) if (fila[0] === '16') candidatos.push(`${ds.dataset_id}:${t.tipo}`);
      }
    }
    expect(candidatos).toEqual(['PRY-SUPERASTIC-ED2026:unipolar_sin_envoltura']);
    expect(PE_CABLE_ID).toBe('PRY-SASTFLEX-CU-1x16');
  });

  it('recorre todas las piezas: un conductor principal desde un extremo y uno por ramal, con derivación PE en la T', () => {
    const g = peDelTrazado(cadena())!;
    expect(g.pe).toMatchObject({ seccion_requerida_mm2: 16, cable_id: PE_CABLE_ID });
    expect(g.pe.conductores).toEqual([
      { conductor_id: 'PE-1', recorrido: ['R1', 'R2', 'T', 'R3'], inicio: 'SP-1', fin: null },
      { conductor_id: 'PE-2', recorrido: ['T', 'R4'], inicio: 'DPE-1', fin: null },
    ]);
    expect(g.equipotencial.puntos).toEqual([
      expect.objectContaining({ punto_id: 'DPE-1', tipo: 'derivacion_pe', conductores: ['PE-1', 'PE-2'], instancias: ['T'] }),
      expect.objectContaining({ punto_id: 'SP-1', tipo: 'sistema_proteccion', conductores: ['PE-1'], instancias: [] }),
    ]);
    // Toda pieza está en algún conductor.
    const cubiertas = new Set(g.pe.conductores.flatMap((c) => (c as { recorrido: string[] }).recorrido));
    expect([...cubiertas].sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'T']);
  });

  it('dos redes sueltas: un sistema de protección cada una; sin piezas no hay PE', () => {
    const t = cadena();
    const suelto = { ...t, piezas: [...t.piezas, { ...structuredClone(t.piezas[0]), instancia_id: 'RX' }] };
    const g = peDelTrazado(suelto)!;
    expect(g.equipotencial.puntos.filter((p) => p.tipo === 'sistema_proteccion').map((p) => p.conductores)).toEqual([['PE-1'], ['PE-3']]);
    expect(peDelTrazado({ ...t, piezas: [], conexiones: [] })).toBeNull();
  });
});
