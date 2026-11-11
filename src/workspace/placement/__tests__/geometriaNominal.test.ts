/**
 * Decisión 2 (B-2): piezas sin modelo medido con GEOMETRÍA NOMINAL del
 * catálogo, con la procedencia a la vista.
 *
 *   - Un tramo recto sin modelo (FAMIQ, ancho y ala declarados) tiene
 *     definición nominal: rectángulo ancho × largo × ala, marcada
 *     "geometría nominal del catálogo, sin modelo medido".
 *   - Sus uniones se verifican igual (dos tramos nominales en línea: válida).
 *   - Un proyecto anterior con el tramo sin colocación se migra RESUELTO.
 *   - Si el catálogo no declara lo necesario, no se coloca, con motivo
 *     (control negativo: sin ala; curva sin radio ni ángulo; CAS).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, MOTIVO_ANGULO_AJUSTABLE, modeloDeProducto } from '../definitions';
import { migrateTray } from '../migration';
import { checkJoin } from '../joins';
import { placeDefinition, worldPorts } from '../placementCore';
import type { Product, TrayInput } from '../../../tray/model';

const snapshot = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const productos = new Map(snapshot.PRODUCTOS.map((p) => [p.producto_id, p]));
const FAMIQ = productos.get('FAMIQ_300708')!; // recta 100 × 50, sin modelo medido

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

describe('geometría nominal del catálogo', () => {
  it('tramo recto sin modelo: definición nominal con su procedencia', () => {
    expect(modeloDeProducto(FAMIQ)).toMatchObject({ procedencia: 'nominal', colocable: true, tipo: 'tramo_recto' });
    const d = definicionEfectiva(FAMIQ, { longitud_mm: 1200 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.def.procedencia).toEqual({ tipo: 'nominal', nota: 'geometría nominal del catálogo, sin modelo medido' });
    expect(d.def.mesh.height).toBe(50);
    expect(d.def.ports.map((p) => p.ancho_mm)).toEqual([100, 100]);
    // Las bocas quedan a 1200 mm (el largo de la instancia).
    const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    const [p1, p2] = ['P1', 'P2'].map((n) => pl.ports.find((p) => p.name === n)!);
    expect(Math.hypot(p2.pos[0] - p1.pos[0], p2.pos[1] - p1.pos[1], p2.pos[2] - p1.pos[2])).toBeCloseTo(1200, 9);
  });

  it('sus uniones se verifican igual: dos tramos nominales en línea, unión válida', () => {
    const d = definicionEfectiva(FAMIQ, { longitud_mm: 1000 });
    if (!d.ok) throw new Error(d.motivo);
    const a = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    const aP2 = a.ports.find((p) => p.name === 'P2')!;
    const b = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: aP2.pos, entryDir: aP2.normal, sectionUp: aP2.vDir });
    const bP1 = b.ports.find((p) => p.name === 'P1')!;
    expect(checkJoin(
      { posicion_mm: aP2.pos, direccion: aP2.normal, orientacion_seccion_ws: aP2.vDir },
      { posicion_mm: bP1.pos, direccion: bP1.normal, orientacion_seccion_ws: bP1.vDir },
    ).ok).toBe(true);
  });

  it('un proyecto anterior con el tramo sin colocación se migra resuelto', () => {
    const d = definicionEfectiva(FAMIQ, { longitud_mm: 2000 });
    if (!d.ok) throw new Error(d.motivo);
    const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [100, 200, 0], entryDir: [0, 1, 0], sectionUp: [0, 0, 1] });
    const wp = worldPorts(d.def, 'nativa', pl.colocacion.pose);
    const tray: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [{
        instancia_id: 'F1', producto_id: FAMIQ.producto_id, longitud_mm: 2000,
        puertos: Object.fromEntries(wp.map((p) => [p.name, { posicion_mm: p.pos, direccion: p.normal, orientacion_seccion_ws: p.vDir }])),
      } as never],
      conexiones: [], circuitos: [], soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
    };
    const { report } = migrateTray(tray, productos);
    expect(report.sinResolver).toEqual([]);
    expect(report.resueltas).toBe(1);
  });

  it('control negativo: sin lo necesario en el catálogo no se coloca, con motivo', () => {
    const sinAla = { ...(FAMIQ as unknown as Record<string, unknown>) };
    delete sinAla.ala_nominal_mm;
    const r1 = definicionEfectiva(sinAla as unknown as Product, { longitud_mm: 1000 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.motivo).toMatch(/no declara ala_nominal_mm/);

    const curvaFamiq = snapshot.PRODUCTOS.find((p) => String(p.sku).startsWith('3007') && p.tipo_pieza === 'curva horizontal')!;
    const r2 = definicionEfectiva(curvaFamiq);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.motivo).toMatch(/necesita ancho, ala, ángulo y radio/);

    const cas = snapshot.PRODUCTOS.find((p) => String(p.sku).startsWith('CAS-'))!;
    const r3 = definicionEfectiva(cas);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.motivo).toBe(MOTIVO_ANGULO_AJUSTABLE);
  });
});
