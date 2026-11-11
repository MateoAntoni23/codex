/**
 * A-10 / PA6 — migración de proyectos anteriores y A-6 / PA5 — una pieza
 * colocada no cambia al cambiar la biblioteca hasta aceptar la actualización.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStaticCatalog, seedStaticCatalog, type StaticCatalog } from '../../../catalog/staticCatalog';
import {
  clearCatalogPortIndex,
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  setMasterResolver,
  setPortMappingOverrides,
} from '../../catalogPortMapping';
import { matchesCatalogNominal, migrateTray, MOTIVO_NOMINAL_CATALOGO } from '../migration';
import { outdatedPieces, placedOf, resolveDefinition, updateOutdatedPieces, withDefinition } from '../definitions';
import { placeDefinition, puertosFromWorld, worldPorts } from '../placementCore';
import { invalidConnections } from '../joins';
import type { Point, Product, TrayInput, TrayPort } from '../../../tray/model';

let cat: StaticCatalog;
let products: Map<string, Product>;

beforeAll(async () => {
  clearPortMappingOverrides();
  cat = await loadStaticCatalog();
  await seedStaticCatalog();
  products = new Map(cat.productos.map((p) => [p.producto_id, p]));
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

describe('PA6 — migración del fixture user-report-20261107', () => {
  it('deduce la pose una vez; las que no encajan quedan sin resolver con su motivo y sus bocas', () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, '../../../../e2e/fixtures/user-report-20261107.workspace.json'), 'utf8'));
    const original: TrayInput = file.trayInput;
    const before = JSON.stringify(original);
    const { entrada, report } = migrateTray(original, products);
    // El original (lo leído del archivo) no se modifica.
    expect(JSON.stringify(original)).toBe(before);
    expect(report.total).toBe(original.piezas.length);
    expect(report.resueltas + report.sinResolver.length).toBe(report.total);
    // Toda pieza tiene colocación: resuelta (con su definición guardada) o sin resolver.
    for (const p of entrada.piezas) {
      expect(p.colocacion).toBeDefined();
      if (p.colocacion!.estado === 'resuelta') expect(placedOf(entrada, p)).not.toBeNull();
    }
    // Las sin resolver conservan exactamente sus bocas.
    for (const u of report.sinResolver) {
      const a = original.piezas.find((p) => p.instancia_id === u.id)!;
      const b = entrada.piezas.find((p) => p.instancia_id === u.id)!;
      expect(b.puertos).toEqual(a.puertos);
    }
    // CS1 reproduce la geometría nominal del catálogo (brazos R+W = 600): su
    // motivo dice que el modelo medido difiere, no que el archivo esté mal.
    // T1 no es nominal (semibrazos 300, derivación a 450 del eje del tronco,
    // contra 600 nominal): conserva el motivo general con su desvío.
    const motivo = (id: string) => report.sinResolver.find((u) => u.id === id)?.motivo;
    expect(motivo('CS1')).toBe(`${MOTIVO_NOMINAL_CATALOGO} (desvío 5.2 mm / 0.2°, tolerancia 2 mm / 1,5°)`);
    expect(motivo('T1')).toBe('no encaja con el modelo vigente (desvío 330.8 mm / 0.0°, tolerancia 2 mm / 1,5°)');
    // Una segunda pasada no hace nada (la pose se deduce una sola vez).
    expect(migrateTray(entrada, products).report.total).toBe(0);
    // Informe para el PR.
    // eslint-disable-next-line no-console
    console.log('[PA6]', JSON.stringify({
      total: report.total, resueltas: report.resueltas,
      maxDesvioMm: Number(report.maxDesvioMm.toFixed(4)), maxDesvioDeg: Number(report.maxDesvioDeg.toFixed(4)),
      sinResolver: report.sinResolver,
      unionesInvalidasTrasMigrar: invalidConnections(entrada),
    }));
  });
});

describe('matchesCatalogNominal — geometría nominal deducida del catálogo', () => {
  const port = (posicion_mm: Point, direccion: Point): TrayPort => ({ posicion_mm, direccion });
  it('curva 90° R300 interior W300: brazos 600 → nominal; 597 → no', () => {
    const cs = products.get('SAM_CS-300-90-065-18-Z')!;
    const mk = (b: number) => ({
      instancia_id: 'C', producto_id: cs.producto_id,
      puertos: { P1: port([0, -b, 0], [0, -1, 0]), P2: port([b, 0, 0], [1, 0, 0]) },
    });
    expect(matchesCatalogNominal(cs, mk(600))).toBe(true);
    expect(matchesCatalogNominal(cs, mk(600.9))).toBe(true);
    expect(matchesCatalogNominal(cs, mk(597))).toBe(false);
  });
  it('T: semibrazos y derivación a 600 → nominal; la T1 del fixture (300/450) no', () => {
    const ts = products.get('SAM_TS-300-065-18-Z')!;
    const mk = (semi: number, der: number) => ({
      instancia_id: 'T', producto_id: ts.producto_id,
      puertos: { P1: port([-semi, 0, 0], [-1, 0, 0]), P2: port([semi, 0, 0], [1, 0, 0]), P3: port([0, der, 0], [0, 1, 0]) },
    });
    expect(matchesCatalogNominal(ts, mk(600, 600))).toBe(true);
    expect(matchesCatalogNominal(ts, mk(300, 450))).toBe(false);
  });
  it('sin radio publicado o curva de 45°: no se deduce nominal', () => {
    const cps = products.get('SAM_CPS-300-90-Z')!; // perforada: radio no declarado
    const cs45 = products.get('SAM_CS-300-45-065-18-Z')!;
    const piece = { instancia_id: 'X', producto_id: '', puertos: { P1: port([0, -600, 0], [0, -1, 0]), P2: port([600, 0, 0], [1, 0, 0]) } };
    expect(matchesCatalogNominal(cps, piece)).toBe(false);
    expect(matchesCatalogNominal(cs45, piece)).toBe(false);
  });
});

describe('PA5 — editar la calibración no cambia piezas ya colocadas', () => {
  it('el cuerpo y las bocas siguen iguales hasta aceptar "actualizar"', () => {
    const tps = products.get('SAM_TPS-300-Z')!;
    const d0 = resolveDefinition(tps);
    if (!d0.ok) throw new Error(d0.motivo);
    const placed = placeDefinition({ def: d0.def, huella: d0.huella, mano: 'nativa', entryPortName: 'tronco_P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    let tray: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [{ instancia_id: 'T', producto_id: tps.producto_id, puertos: puertosFromWorld(placed.ports), colocacion: placed.colocacion }],
      conexiones: [], circuitos: [], soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
    };
    tray = withDefinition(tray, d0.huella, d0.def);
    const portsBefore = JSON.stringify(tray.piezas[0].puertos);

    // El operador calibra el patrón (giro del modelo) en el configurador.
    setPortMappingOverrides({
      'SAM_TPS-300-Z': { productId: 'SAM_TPS-300-Z', source: 'override', entries: [], modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 90, tx_mm: 0, ty_mm: 0, tz_mm: 0 } },
    });
    try {
      // La pieza colocada NO cambia: se dibuja desde su definición guardada.
      const p = placedOf(tray, tray.piezas[0])!;
      expect(p.colocacion.definicion.huella).toBe(d0.huella);
      expect(JSON.stringify(puertosFromWorld(worldPorts(p.def, p.colocacion.mano, p.colocacion.pose)))).toBe(portsBefore);
      // …pero se indica que difiere de la vigente.
      const out = outdatedPieces(tray, products);
      expect(out.map((o) => o.id)).toEqual(['T']);
      // Aceptar la actualización adopta la vigente (deshacible: devuelve un trazado nuevo).
      const { entrada: upd, updated } = updateOutdatedPieces(tray, products);
      expect(updated).toEqual(['T']);
      expect(upd.piezas[0].colocacion!.estado === 'resuelta' && upd.piezas[0].colocacion!.definicion.huella).not.toBe(d0.huella);
      expect(JSON.stringify(upd.piezas[0].puertos)).not.toBe(portsBefore);
      expect(JSON.stringify(tray.piezas[0].puertos)).toBe(portsBefore); // el original no se tocó
    } finally {
      clearPortMappingOverrides();
    }
  });
});
