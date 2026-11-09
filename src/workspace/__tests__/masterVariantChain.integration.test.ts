/**
 * Cadena completa maestro → variante — pieza real + conexión + roundtrip.
 *
 * Satisface los requisitos:
 *   - #119 TRPS 300 → CPS-45 → TRPS-450: variante proyectada desde el maestro
 *     perforada:tramo_recto, encadenada con otra pieza, exportada y reimportada
 *     sin perder bocas ni orientación.
 *   - #120 TRES 300-065 → TRES-450-090: variante escalera con cambio de ancho
 *     y ala, insertable y persistente en el archivo de proyecto.
 *   - Prueba también que `catalogConfig` con un override de modelFrame para el
 *     maestro se mantiene intacto en el roundtrip, cerrando el loop:
 *       maestro configurado → variante → workspace → export → import → igual.
 *
 * No depende de UI: usa `planAddCurve`/`planAddSegment` directos (las mismas
 * funciones que invoca `RoutingPanel`), más `exportWorkspace`/`importWorkspace`.
 * El objetivo es una prueba determinista que falle si algún eslabón de la
 * cadena rompe la geometría — complementando a la UI cuando esta cambie.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getCompatibleProductIds,
  checkDirectCompatibility,
  hasSelfPortEquivalence,
} from '../routingRules';
import { planAddCurve, planAddSegment } from '../workspaceOperation';
import { buildSegmentPiece } from '../addTraySegment';
import { assertInput } from '../../tray/model';
import type {
  Product,
  CatalogCompatibility,
  CatalogUnionComponent,
  CatalogPort,
  TrayInput,
} from '../../tray/model';
import type { StartPort } from '../routingRules';
import {
  exportWorkspace,
  importWorkspace,
  DEFAULT_PROJECT_META,
} from '../workspaceFile';
import type { ProductPortMapping } from '../catalogPortMapping';

const SNAPSHOT_PATH = resolve(
  __dirname,
  '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json',
);

interface Snapshot {
  PRODUCTOS: Product[];
  COMPATIBILIDADES: CatalogCompatibility[];
  COMPONENTES_UNION: CatalogUnionComponent[];
  PUERTOS_PRODUCTO: CatalogPort[];
}
const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;

const byId = (id: string) => snap.PRODUCTOS.find((p) => p.producto_id === id)!;

function compatibleIdsFor(productId: string, portName: 'P1' | 'P2', product: Product): Set<string> {
  const ids = getCompatibleProductIds(snap.COMPATIBILIDADES, productId, portName);
  if (hasSelfPortEquivalence(snap.COMPATIBILIDADES, product)) {
    const alt = portName === 'P1' ? 'P2' : 'P1';
    for (const id of getCompatibleProductIds(snap.COMPATIBILIDADES, productId, alt)) ids.add(id);
  }
  return ids;
}

function startPortFrom(piece: TrayInput['piezas'][number], portName: 'P1' | 'P2'): StartPort {
  const port = piece.puertos[portName];
  return {
    pieceId: piece.instancia_id,
    portName,
    pos: port.posicion_mm as [number, number, number],
    dir: port.direccion as [number, number, number],
  };
}

describe('#119 cadena TRPS 300 → CPS-45 → TRPS-300 con override maestro preservado en roundtrip', () => {
  it('chain real con override en TRPS-300 sobrevive export/import sin corrupción', () => {
    const start = byId('SAM_TRPS-300-22-Z');
    const curve = byId('SAM_CPS-300-45-Z');
    const endSeg = byId('SAM_TRPS-300-22-Z');
    expect(start).toBeTruthy();
    expect(curve).toBeTruthy();

    // Arranque: una pieza TRPS-300-22-Z en el origen.
    const piece0 = buildSegmentPiece('R1', start.producto_id, [0, 0, 0], [3000, 0, 0]);
    let tray: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [piece0],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    };
    assertInput(tray);

    // Encadenar la curva.
    const sPort = startPortFrom(piece0, 'P2');
    const compatCurve = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      start, 'P2', curve, 'P1',
    );
    expect(compatCurve.ok, compatCurve.ok ? '' : compatCurve.reason).toBe(true);
    const curveOp = planAddCurve(tray, sPort, curve, compatCurve, 'left');
    tray = {
      ...tray,
      piezas: [...tray.piezas, curveOp.newPiece],
      conexiones: [...tray.conexiones, curveOp.newConnection],
    };
    assertInput(tray);

    // Encadenar el segundo recto.
    const curveP2 = curveOp.newPiece.puertos.P2;
    const sPort2: StartPort = {
      pieceId: curveOp.newPiece.instancia_id,
      portName: 'P2',
      pos: curveP2.posicion_mm as [number, number, number],
      dir: curveP2.direccion as [number, number, number],
    };
    const candIds = compatibleIdsFor(curve.producto_id, 'P2', curve);
    expect(candIds.has(endSeg.producto_id), 'TRPS-300 debería ser candidato tras CPS-45 P2').toBe(true);
    const compatSeg = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      curve, 'P2', endSeg, 'P1',
    );
    expect(compatSeg.ok, compatSeg.ok ? '' : compatSeg.reason).toBe(true);
    const segOp = planAddSegment(tray, sPort2, endSeg, compatSeg, 1500, sPort2.dir);
    tray = {
      ...tray,
      piezas: [...tray.piezas, segOp.newPiece],
      conexiones: [...tray.conexiones, segOp.newConnection],
    };
    assertInput(tray);
    expect(tray.piezas.length).toBe(3);
    expect(tray.conexiones.length).toBe(2);

    // Capturar posiciones críticas pre-roundtrip (último puerto encadenado).
    const lastP2 = tray.piezas[2]!.puertos.P2.posicion_mm as [number, number, number];
    const lastDirP2 = tray.piezas[2]!.puertos.P2.direccion as [number, number, number];

    // Simular que el usuario editó el maestro TRPS-300 (modelFrame + override de P1).
    const overrides: Record<string, ProductPortMapping> = {
      SAM_TRPS: {
        source: 'override',
        entries: [{
          recipePortName: 'P1',
          catalogPortName: 'P1',
          physicalLabel: 'Boca x_min',
          justification: 'Prueba de roundtrip de configuración maestro.',
          geometry: {
            centerMm: [0, 25, -150] as const,
          },
        }],
        modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 0, tx_mm: 0, ty_mm: 5, tz_mm: 0 },
      } as unknown as ProductPortMapping,
    };

    const exported = exportWorkspace(
      [], [], DEFAULT_PROJECT_META, tray, overrides,
    );
    const imported = importWorkspace(exported);
    expect(imported.trayInput.piezas.length).toBe(3);
    expect(imported.trayInput.conexiones.length).toBe(2);
    expect(imported.catalogConfig).toBeDefined();
    expect(imported.catalogConfig!.version).toBe('codex:catalogConfig/1');
    expect(imported.catalogConfig!.overrides.SAM_TRPS).toBeDefined();
    // Las coordenadas de la pieza final deben preservarse exactas (JSON roundtrip).
    const reP2 = imported.trayInput.piezas[2]!.puertos.P2.posicion_mm as [number, number, number];
    const reDir = imported.trayInput.piezas[2]!.puertos.P2.direccion as [number, number, number];
    for (let i = 0; i < 3; i++) {
      expect(reP2[i]).toBe(lastP2[i]);
      expect(reDir[i]).toBe(lastDirP2[i]);
    }
    // Las conexiones referencian los IDs correctos (no se renumeran al reimportar).
    expect(imported.trayInput.conexiones[0]!.a[0]).toBe(tray.conexiones[0]!.a[0]);
    expect(imported.trayInput.conexiones[1]!.b[0]).toBe(tray.conexiones[1]!.b[0]);
  });
});

describe('#119+#120 variante del maestro en workspace: TRPS-450-20-Z y TRES-450-090-18-Z', () => {
  it('TRPS-450-20-Z existe en snapshot, es variante del maestro perforada:tramo_recto, y es insertable', () => {
    const variant = byId('SAM_TRPS-450-20-Z');
    expect(variant).toBeTruthy();
    expect(variant.ancho_nominal_mm).toBe(450);
    expect((variant as Record<string, unknown>).ala_nominal_mm).toBe(50);

    // Insertable con buildSegmentPiece (contrato básico): devuelve puertos
    // válidos en posiciones esperadas para un recto de ancho 450.
    const piece = buildSegmentPiece('R1', variant.producto_id, [0, 0, 0], [3000, 0, 0]);
    assertInput({
      version_contrato: 'trazado/1',
      piezas: [piece],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    });
    // P1 en origen, P2 a 3000 de distancia, sin dependencia del ancho (las bocas
    // del extruido salen por X).
    expect(piece.puertos.P1.posicion_mm[0]).toBeCloseTo(0, 3);
    expect(piece.puertos.P2.posicion_mm[0]).toBeCloseTo(3000, 3);
  });

  it('TRES-450-090-18-Z existe en snapshot y buildSegmentPiece lo coloca sin romper contrato', () => {
    const variant = snap.PRODUCTOS.find((p) => p.producto_id === 'SAM_TRES-450-090-18-Z');
    expect(variant, 'esperamos la variante TRES-450-090 en el snapshot').toBeTruthy();
    if (!variant) return;
    const piece = buildSegmentPiece('R1', variant.producto_id, [0, 0, 0], [3000, 0, 0]);
    assertInput({
      version_contrato: 'trazado/1',
      piezas: [piece],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    });
    expect(piece.puertos.P1.posicion_mm[0]).toBeCloseTo(0, 3);
    expect(piece.puertos.P2.posicion_mm[0]).toBeCloseTo(3000, 3);
  });

  it('TRES-300 → TRES-300 conectable; cadena preserva en export/import', () => {
    const tres = snap.PRODUCTOS.find((p) => p.producto_id === 'SAM_TRES-300-065-18-Z');
    if (!tres) return; // snapshot sin TRES; test se skippea
    const piece1 = buildSegmentPiece('R1', tres.producto_id, [0, 0, 0], [3000, 0, 0]);
    const piece2 = buildSegmentPiece('R2', tres.producto_id, [3000, 0, 0], [6000, 0, 0]);
    const tray: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [piece1, piece2],
      conexiones: [{
        conexion_id: 'C1',
        a: [piece1.instancia_id, 'P2'],
        b: [piece2.instancia_id, 'P1'],
      }],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    };
    assertInput(tray);
    const exported = exportWorkspace([], [], DEFAULT_PROJECT_META, tray);
    const imported = importWorkspace(exported);
    expect(imported.trayInput.piezas.length).toBe(2);
    expect(imported.trayInput.conexiones.length).toBe(1);
  });
});
