/**
 * Fixture-generator: construye el TrayInput post-construcción para los
 * escenarios TRPS → CPS-90 (left/right) → TRPS que consume la E2E
 * `trpsCpsAlignment` (Playwright) desde e2e/fixtures/tray-{left,right}.json.
 *
 * En una corrida normal NO toca los fixtures versionados: escribe lo generado
 * en test-results/ (ignorado por git) y comprueba que coincide con el fixture
 * versionado, salvo las marcas de tiempo (`fecha_iso`). Antes los reescribía en
 * cada `npm test`, lo que ensuciaba el árbol y llegó a colarse en un commit.
 *
 * Para regenerar los versionados a propósito (p. ej. tras cambiar la
 * construcción), en PowerShell:
 *   $env:CODEX_UPDATE_E2E_FIXTURES='1'; npx vitest run src/workspace/__tests__/buildE2eFixtures.test.ts
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const GENERATED_DIR = resolve(__dirname, '../../../test-results/e2e-fixtures-generados');

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

/** Copia sin marcas de tiempo: lo único que cambia entre corridas. */
function sinFechas(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (k, v) => (k === 'fecha_iso' ? undefined : v)));
}

describe('fixtures/buildFixtures', () => {
  it('right/left: lo generado coincide con el fixture versionado (sin reescribirlo)', () => {
    const update = process.env.CODEX_UPDATE_E2E_FIXTURES === '1';
    mkdirSync(GENERATED_DIR, { recursive: true });
    for (const turn of ['right', 'left'] as const) {
      const name = `tray-${turn}.json`;
      const generated = buildScenario(turn);
      const text = JSON.stringify(generated, null, 2);
      writeFileSync(resolve(GENERATED_DIR, name), text);
      if (update) {
        writeFileSync(resolve(FIXTURE_DIR, name), text);
        continue;
      }
      const versioned = JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), 'utf-8'));
      expect(
        sinFechas(generated),
        `${name} desactualizado: regenerar con CODEX_UPDATE_E2E_FIXTURES=1 (ver cabecera)`,
      ).toEqual(sinFechas(versioned));
    }
  });
});
