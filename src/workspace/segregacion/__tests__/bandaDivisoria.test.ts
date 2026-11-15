/**
 * Segregación con banda divisoria (etapa 3, parte B): regla del operador,
 * calculada por la app; el motor no sabe que la banda existe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../placement/definitions';
import { placeDefinition, puertosFromWorld } from '../../placement/placementCore';
import { crearBajada } from '../../equipos/bajada';
import { guardarCircuito } from '../../recorridos/circuitosGuardados';
import { construirCatalogoCables } from '../../cables/catalogoCables';
import { toMotorEntrada } from '../../../tray/store';
import { bandasCompatibles, colocarBanda, computoBandas, espesorDeBanda, ocupacionSegregada, quitarBanda } from '../bandaDivisoria';
import type { CatalogCompatibility, Product, TrayInput } from '../../../tray/model';
import type { EquipmentElement } from '../../../types/domain-v2';

const VENDOR = resolve(__dirname, '../../../../vendor/motor_bandejas');
const snapshot = JSON.parse(readFileSync(resolve(VENDOR, 'datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[] };
const productos = new Map(snapshot.PRODUCTOS.map((p) => [p.producto_id, p]));
const compat = snapshot.COMPATIBILIDADES;
const datasets = readdirSync(resolve(VENDOR, 'datos/cables')).sort().map((f) => JSON.parse(readFileSync(resolve(VENDOR, 'datos/cables', f), 'utf8')));
const idsMotor = (JSON.parse(readFileSync(resolve(__dirname, '../../cables/__tests__/fixtures/cable_ids_motor.json'), 'utf8')) as { cable_ids: string[] }).cable_ids;
const cat = construirCatalogoCables(datasets, idsMotor);
if (!cat.ok) throw new Error(cat.motivo);
const D = new Map(cat.cables.map((c) => [c.cable_id, c.diametro_exterior_mm]));

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

function tramo(productoId: string): TrayInput {
  const t0 = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], reserva_solicitada_pct: 20,
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput;
  const d = definicionEfectiva(productos.get(productoId)!, { longitud_mm: 3000 });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t = withDefinition(t0, d.huella, d.def);
  return { ...t, piezas: [{ instancia_id: 'R1', producto_id: productoId, longitud_mm: 3000, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion }] };
}
const eq = (id: string, pos: number[]) => ({
  id, name: id, tag: null, category: 'pump', parentId: null, placementStatus: 'placed',
  transform: { positionMm: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
}) as unknown as EquipmentElement;
const ELS = [eq('A', [0, 1000, 0]), eq('B', [3000, 1000, 0])];

/** Escalera 300 ala 90 Z con potencia (3×50 × 2) y maniobra (4×2,5 × 1) entre A y B. */
function proyecto(productoId = 'SAM_TRES-300-090-18-Z') {
  let t = tramo(productoId);
  for (const [e, desde] of [['A', 'P1'], ['B', 'P2']] as const) {
    const b = crearBajada(t, productos, ELS, { equipo: e, tronco: 'R1', desde_boca: desde, distancia_mm: 100, lado: 'izquierda' });
    if (!b.ok) throw new Error(b.motivo);
    t = b.entrada;
  }
  for (const [nombre, o, d, cable_id, cantidad, funcion] of [
    ['Fuerza', 'A', 'B', 'PRY-SVALIO-CU-3x50', 2, 'potencia'],
    ['Mando', 'B', 'A', 'PRY-SVALIO-CU-4x2.5', 1, 'maniobra'],
  ] as const) {
    const g = guardarCircuito(t, ELS, nombre, { equipo: o }, { equipo: d }, { cable_id, cantidad, separado: false, funcion });
    if (!g.ok) throw new Error(g.motivo);
    t = g.entrada;
  }
  return t;
}

describe('banda divisoria', () => {
  it('compatibles sólo con rectas, por ala y acabado', () => {
    expect(bandasCompatibles('SAM_TRES-300-090-18-Z', compat, productos).map((p) => p.sku)).toEqual(['BDS090Z']);
    expect(bandasCompatibles('SAM_TRES-300-115-18-G', compat, productos).map((p) => p.sku)).toEqual(['BDS115G']);
    expect(bandasCompatibles('SAM_TRPS-300-22-Z', compat, productos).map((p) => p.sku)).toEqual(['BDS01Z']);
    expect(bandasCompatibles('SAM_TRES-300-065-18-Z', compat, productos)).toEqual([]); // ala 65: no hay banda
    expect(bandasCompatibles('SAM_CPS-300-90-Z', compat, productos)).toEqual([]);
  });

  it('se coloca sólo si es compatible, una por tramo; se quita', () => {
    const t = proyecto();
    expect(colocarBanda(t, 'R1', 'SAM_BDS115Z', compat, productos)).toEqual({ ok: false, motivo: 'esa banda no es compatible con este tramo' });
    const r = colocarBanda(t, 'R1', 'SAM_BDS090Z', compat, productos);
    if (!r.ok) throw new Error(r.motivo);
    expect(colocarBanda(r.entrada, 'R1', 'SAM_BDS090Z', compat, productos)).toEqual({ ok: false, motivo: 'este tramo ya tiene banda divisoria' });
    expect(ocupacionSegregada(quitarBanda(r.entrada, 'R1'), ELS, productos, D, 'R1')).toBeNull();
  });

  it('regla del operador: ancho útil − espesor, repartido POR CANTIDAD DE CABLES; el PE va con potencia', () => {
    const r = colocarBanda(proyecto(), 'R1', 'SAM_BDS090Z', compat, productos);
    if (!r.ok) throw new Error(r.motivo);
    const o = ocupacionSegregada(r.entrada, ELS, productos, D, 'R1')!;
    if (!o.calculada) throw new Error(o.motivo);
    expect(o).toMatchObject({ banda: 'BDS090Z', espesor_banda_mm: 0.71, ancho_util_mm: 300, base_ancho: 'nominal', ancho_disponible_mm: 299.29, reserva_solicitada_pct: 20 });
    const [pot, ctl] = o.grupos;
    // Potencia: 2 × 3×50 (Ø 30) + 1 PE (Ø 7) = 3 cables; maniobra: 1 × 4×2,5.
    expect(pot).toMatchObject({ grupo: 'potencia', n_cables: 3, ancho_ocupado_mm: 2 * 30 + 7 });
    expect(ctl).toMatchObject({ grupo: 'control', n_cables: 1, ancho_ocupado_mm: D.get('PRY-SVALIO-CU-4x2.5') });
    expect(pot.ancho_asignado_mm).toBeCloseTo((299.29 * 3) / 4, 3);
    expect(ctl.ancho_asignado_mm).toBeCloseTo((299.29 * 1) / 4, 3);
    expect(pot.reserva_libre_pct).toBeCloseTo(((299.29 * 3) / 4 - 67) / ((299.29 * 3) / 4) * 100, 2);
    expect(pot.estado).toBe('CUMPLE');
    // Control negativo: si el reparto fuera mitad y mitad, esto falla.
    expect(pot.ancho_asignado_mm).not.toBeCloseTo(299.29 / 2, 1);
    expect(ctl.ancho_asignado_mm).not.toBeCloseTo(299.29 / 2, 1);
    // Control negativo: si no se descontara el espesor, esto falla.
    expect(pot.ancho_asignado_mm + ctl.ancho_asignado_mm).toBeCloseTo(300 - 0.71, 2);
  });

  it('BDS01Z (perforada): el catálogo no publica espesor; se usa 0,71 mm declarado por el operador por analogía, con esa procedencia', () => {
    expect((productos.get('SAM_BDS01Z') as Record<string, unknown>).espesor_chapa_mm).toBeNull();
    expect(espesorDeBanda(productos.get('SAM_BDS01Z'))).toEqual({
      mm: 0.71, procedencia: 'declarado por el operador (2026-11-14) por analogía con la chapa de la bandeja perforada; no medido',
    });
    expect(espesorDeBanda(productos.get('SAM_BDS090Z'))).toEqual({ mm: 0.71, procedencia: 'catálogo' });
    const r = colocarBanda(proyecto('SAM_TRPS-300-22-Z'), 'R1', 'SAM_BDS01Z', compat, productos);
    if (!r.ok) throw new Error(r.motivo);
    const o = ocupacionSegregada(r.entrada, ELS, productos, D, 'R1')!;
    if (!o.calculada) throw new Error(o.motivo);
    expect(o).toMatchObject({ banda: 'BDS01Z', espesor_banda_mm: 0.71, espesor_procedencia: expect.stringContaining('por analogía'), ancho_disponible_mm: 299.29 });
    expect(o.grupos[0].ancho_asignado_mm).toBeCloseTo((299.29 * 3) / 4, 3);
  });

  it('una banda sin espesor en el catálogo ni declarado sigue sin calcularse: NO VERIFICABLE', () => {
    const sinNada = new Map(productos);
    sinNada.set('SAM_BDS01Z', { ...productos.get('SAM_BDS01Z')!, producto_id: 'SAM_BDS01Z-X' } as Product);
    expect(espesorDeBanda(sinNada.get('SAM_BDS01Z'))).toBeNull();
  });

  it('el motor no sabe que la banda existe; la banda sí va al cómputo (de la app)', () => {
    const r = colocarBanda(proyecto(), 'R1', 'SAM_BDS090Z', compat, productos);
    if (!r.ok) throw new Error(r.motivo);
    const payload = toMotorEntrada(r.entrada, { elements: ELS });
    expect('bandas_ws' in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('BDS');
    // El ancho de la bandeja que viaja no cambia.
    expect((payload.piezas as Array<{ producto_id: string }>)[0].producto_id).toBe('SAM_TRES-300-090-18-Z');
    expect(computoBandas(r.entrada, productos)).toEqual([{ producto_id: 'SAM_BDS090Z', sku: 'BDS090Z', piezas: 1, longitud_mm: 3000, tramos: ['R1'] }]);
  });
});
