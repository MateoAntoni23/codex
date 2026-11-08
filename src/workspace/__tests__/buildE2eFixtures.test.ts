/**
 * Fixture-generator: escribe en e2e/fixtures/*.json el TrayInput post-construcción
 * para los escenarios TRPS → CPS-90 (left/right) → TRPS. Lo consume el test e2e
 * (Playwright) para inyectar estado real sin tener que reproducir la secuencia
 * de clicks del RoutingPanel.
 *
 * Correr con: npx vitest run e2e/fixtures/buildFixtures.test.ts
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkDirectCompatibility } from '../routingRules';
import {
  planAddCurve, planAddSegment, applyOperation,
} from '../workspaceOperation';
import { buildSegmentPiece } from '../addTraySegment';
import type {
  Product, CatalogCompatibility, CatalogUnionComponent, CatalogPort,
  TrayInput,
} from '../../tray/model';
import type { StartPort } from '../routingRules';

const SNAPSHOT_PATH = resolve(
  __dirname,
  '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json',
);
const FIXTURE_DIR = resolve(__dirname, '../../../e2e/fixtures');

interface Snapshot {
  PRODUCTOS: Product[];
  COMPATIBILIDADES: CatalogCompatibility[];
  COMPONENTES_UNION: CatalogUnionComponent[];
  PUERTOS_PRODUCTO: CatalogPort[];
}
const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
const TRPS = snap.PRODUCTOS.find((p) => p.producto_id === 'SAM_TRPS-300-22-Z')!;
const CPS90 = snap.PRODUCTOS.find((p) => p.producto_id === 'SAM_CPS-300-90-Z')!;

function startPortOf(tray: TrayInput, pieceId: string, portName: 'P1' | 'P2'): StartPort {
  const piece = tray.piezas.find((p) => p.instancia_id === pieceId)!;
  const port = piece.puertos[portName]!;
  return {
    pieceId, portName,
    pos: port.posicion_mm as [number, number, number],
    dir: port.direccion as [number, number, number],
  };
}

function buildScenario(turn: 'left' | 'right'): TrayInput {
  const first = buildSegmentPiece('T1', TRPS.producto_id, [0, 0, 0], [3000, 0, 0]);
  let tray: TrayInput = {
    version_contrato: 'trazado/1',
    piezas: [first],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
  };
  const sp1 = startPortOf(tray, 'T1', 'P2');
  const curveCompat = checkDirectCompatibility(
    { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
    TRPS, 'P2', CPS90, 'P1',
  );
  if (!curveCompat.ok) throw new Error(`curveCompat ${curveCompat.reason}`);
  const curveOp = planAddCurve(tray, sp1, CPS90, curveCompat, turn);
  tray = applyOperation(tray, curveOp, 'reject');

  const sp2 = startPortOf(tray, curveOp.newPiece.instancia_id, 'P2');
  const straightCompat = checkDirectCompatibility(
    { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
    CPS90, 'P2', TRPS, 'P1',
  );
  if (!straightCompat.ok) throw new Error(`straightCompat ${straightCompat.reason}`);
  const straightOp = planAddSegment(tray, sp2, TRPS, straightCompat, 3000, sp2.dir);
  tray = applyOperation(tray, straightOp, 'reject');
  return tray;
}

describe('fixtures/buildFixtures', () => {
  it('write right/left scenarios', () => {
    const right = buildScenario('right');
    const left = buildScenario('left');
    writeFileSync(resolve(FIXTURE_DIR, 'tray-right.json'), JSON.stringify(right, null, 2));
    writeFileSync(resolve(FIXTURE_DIR, 'tray-left.json'), JSON.stringify(left, null, 2));
  });
});
