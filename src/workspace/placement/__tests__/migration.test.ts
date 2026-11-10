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
import { migrateTray } from '../migration';
import { outdatedPieces, placedOf, resolveDefinition, updateOutdatedPieces, withDefinition } from '../definitions';
import { placeDefinition, puertosFromWorld, worldPorts } from '../placementCore';
import { invalidConnections } from '../joins';
import type { Product, TrayInput } from '../../../tray/model';

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
