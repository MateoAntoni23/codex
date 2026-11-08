/**
 * Reproducción determinística del escenario reportado:
 *   TRPS-300-22-Z → CPS-300-90-Z (left/right) → TRPS-300-22-Z
 *
 * No depende del navegador. Usa catálogo real + las mismas funciones que
 * RoutingPanel.commitDirect: planAddSegment, planAddCurve, applyOperation.
 * Luego re-ejecuta placeRecipe + verifyGeometricFit sobre cada pieza
 * resultante — es exactamente lo que hace TrayObjects.ParametricMesh al
 * renderizar la pieza confirmada.
 *
 * Verifica que:
 *   - La pieza confirmada se renderiza con los mismos P1/P2 que almacenó
 *     planAddCurve (o sea, preview y confirmed producen la misma malla).
 *   - El P2 de la curva coincide con el P1 del siguiente tramo recto.
 *   - El chirality elegido por verifyGeometricFit coincide con el usado
 *     por planAddCurve.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkDirectCompatibility,
} from '../routingRules';
import { planAddCurve, planAddSegment, applyOperation } from '../workspaceOperation';
import {
  resolveRecipe,
  placeRecipe,
  verifyGeometricFit,
  chiralityForTurn,
} from '../parametricBridge';
import { buildSegmentPiece } from '../addTraySegment';
import type {
  Product,
  CatalogCompatibility,
  CatalogUnionComponent,
  CatalogPort,
  TrayInput,
  Piece,
} from '../../tray/model';
import type { StartPort } from '../routingRules';

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

const TRPS = snap.PRODUCTOS.find((p) => p.producto_id === 'SAM_TRPS-300-22-Z')!;
const CPS90 = snap.PRODUCTOS.find((p) => p.producto_id === 'SAM_CPS-300-90-Z')!;

function fmt(v: readonly [number, number, number]): string {
  return `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`;
}

function dumpPiece(label: string, piece: Piece, product: Product): string {
  const p1 = piece.puertos.P1!;
  const p2 = piece.puertos.P2!;
  const fit = verifyGeometricFit(product, piece);
  const entry = resolveRecipe(product);
  const lines: string[] = [];
  lines.push(`─── ${label} (${piece.instancia_id} / ${product.sku}) ─────────`);
  lines.push(`  stored P1 pos=${fmt(p1.posicion_mm as [number, number, number])}  dir=${fmt(p1.direccion as [number, number, number])}`);
  lines.push(`  stored P2 pos=${fmt(p2.posicion_mm as [number, number, number])}  dir=${fmt(p2.direccion as [number, number, number])}`);
  lines.push(`  recipe entry: ${entry?.recipe ?? '(none)'}`);
  lines.push(`  fit: chirality=${fit?.chirality ?? '-'}  p2PosErrMm=${fit?.p2PosErrorMm.toFixed(4) ?? '-'}  p2DirErrDeg=${fit?.p2DirErrorDeg.toFixed(4) ?? '-'}  matches=${fit?.matches ?? '-'}`);
  if (entry && fit) {
    const startPos = p1.posicion_mm as [number, number, number];
    const entryDir: [number, number, number] = [-p1.direccion[0], -p1.direccion[1], -p1.direccion[2]];
    const overrides = entry.piece_kind === 'tramo_recto'
      ? { longitud_mm: piece.longitud_mm ?? undefined }
      : undefined;
    const placed = placeRecipe(product, entry, startPos, entryDir, fit.chirality, overrides);
    lines.push(`  RE-RENDER placeRecipe → P1=${fmt(placed.p1.pos)}  P2=${fmt(placed.p2.pos)}`);
    lines.push(`  ΔP2 (re-rendered − stored) = ${fmt([
      placed.p2.pos[0] - (p2.posicion_mm as number[])[0],
      placed.p2.pos[1] - (p2.posicion_mm as number[])[1],
      placed.p2.pos[2] - (p2.posicion_mm as number[])[2],
    ] as [number, number, number])}`);
  }
  return lines.join('\n');
}

function dumpConnections(entrada: TrayInput): string {
  const lines: string[] = [];
  lines.push('─── Conexiones ─────────────────────────────────────────');
  for (const c of entrada.conexiones) {
    lines.push(`  ${c.conexion_id}: ${c.a[0]}.${c.a[1]} ↔ ${c.b[0]}.${c.b[1]}`);
  }
  for (const c of entrada.conexiones) {
    const [aId, aPort] = c.a;
    const [bId, bPort] = c.b;
    const pa = entrada.piezas.find((p) => p.instancia_id === aId)!.puertos[aPort];
    const pb = entrada.piezas.find((p) => p.instancia_id === bId)!.puertos[bPort];
    const dx = (pa.posicion_mm as number[])[0] - (pb.posicion_mm as number[])[0];
    const dy = (pa.posicion_mm as number[])[1] - (pb.posicion_mm as number[])[1];
    const dz = (pa.posicion_mm as number[])[2] - (pb.posicion_mm as number[])[2];
    const gap = Math.hypot(dx, dy, dz);
    lines.push(`    gap=${gap.toFixed(4)} mm  (a@${fmt(pa.posicion_mm as [number, number, number])}  b@${fmt(pb.posicion_mm as [number, number, number])})`);
  }
  return lines.join('\n');
}

function buildInitialTray(): TrayInput {
  // Primer TRPS: horizontal en +X, P1 en origen, P2 a 3000 mm sobre +X.
  const first = buildSegmentPiece('T1', TRPS.producto_id, [0, 0, 0], [3000, 0, 0]);
  const tray: TrayInput = {
    version_contrato: 'trazado/1',
    piezas: [first],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
  };
  return tray;
}

function startPortOf(tray: TrayInput, pieceId: string, portName: 'P1' | 'P2'): StartPort {
  const piece = tray.piezas.find((p) => p.instancia_id === pieceId)!;
  const port = piece.puertos[portName]!;
  return {
    pieceId,
    portName,
    pos: port.posicion_mm as [number, number, number],
    dir: port.direccion as [number, number, number],
  };
}

function runScenario(turn: 'left' | 'right'): { tray: TrayInput; dump: string } {
  let tray = buildInitialTray();

  // Secuencia: desde T1.P2, agregar curva CPS90 con dirección 'turn';
  // luego desde la pieza curva su P2, agregar otro tramo recto.
  const sp1 = startPortOf(tray, 'T1', 'P2');
  const curveCompat = checkDirectCompatibility(
    { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
    TRPS, 'P2', CPS90, 'P1',
  );
  expect(curveCompat.ok, `compat TRPS.P2↔CPS.P1 failed: ${curveCompat.reason}`).toBe(true);
  const curveOp = planAddCurve(tray, sp1, CPS90, curveCompat, turn);
  tray = applyOperation(tray, curveOp, 'reject');

  const curveId = curveOp.newPiece.instancia_id;
  const sp2 = startPortOf(tray, curveId, 'P2');
  const straightCompat = checkDirectCompatibility(
    { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
    CPS90, 'P2', TRPS, 'P1',
  );
  expect(straightCompat.ok, `compat CPS.P2↔TRPS.P1 failed: ${straightCompat.reason}`).toBe(true);
  const straightOp = planAddSegment(tray, sp2, TRPS, straightCompat, 3000, sp2.dir);
  tray = applyOperation(tray, straightOp, 'reject');

  const pieces = tray.piezas;
  const dump = [
    `╔══ Escenario TRPS → CPS-90 (${turn}) → TRPS ══╗`,
    ...pieces.map((p, i) => {
      const product = p.producto_id === TRPS.producto_id ? TRPS : CPS90;
      return dumpPiece(`Pieza ${i + 1}`, p, product);
    }),
    dumpConnections(tray),
  ].join('\n\n');
  return { tray, dump };
}

describe('TRPS→CPS→TRPS: stored vs re-rendered (ParametricMesh path)', () => {
  it('escenario RIGHT: cada pieza re-renderiza en su mismo P1/P2 almacenado', () => {
    const { tray, dump } = runScenario('right');
    // eslint-disable-next-line no-console
    console.log(dump);
    for (const piece of tray.piezas) {
      const product = piece.producto_id === TRPS.producto_id ? TRPS : CPS90;
      const fit = verifyGeometricFit(product, piece);
      expect(fit, `fit null para ${piece.instancia_id}`).not.toBeNull();
      expect(fit!.matches, `fit no coincide en ${piece.instancia_id}: p2PosErr=${fit!.p2PosErrorMm}, p2DirErr=${fit!.p2DirErrorDeg}`).toBe(true);
    }
    // Chequear gap en la conexión CPS.P2 ↔ T2.P1
    for (const c of tray.conexiones) {
      const pa = tray.piezas.find((p) => p.instancia_id === c.a[0])!.puertos[c.a[1]]!;
      const pb = tray.piezas.find((p) => p.instancia_id === c.b[0])!.puertos[c.b[1]]!;
      const gap = Math.hypot(
        (pa.posicion_mm as number[])[0] - (pb.posicion_mm as number[])[0],
        (pa.posicion_mm as number[])[1] - (pb.posicion_mm as number[])[1],
        (pa.posicion_mm as number[])[2] - (pb.posicion_mm as number[])[2],
      );
      expect(gap, `gap entre ${c.a[0]}.${c.a[1]} y ${c.b[0]}.${c.b[1]} = ${gap}`).toBeLessThan(0.1);
    }
  });

  it('escenario LEFT: cada pieza re-renderiza en su mismo P1/P2 almacenado', () => {
    const { tray, dump } = runScenario('left');
    // eslint-disable-next-line no-console
    console.log(dump);
    for (const piece of tray.piezas) {
      const product = piece.producto_id === TRPS.producto_id ? TRPS : CPS90;
      const fit = verifyGeometricFit(product, piece);
      expect(fit, `fit null para ${piece.instancia_id}`).not.toBeNull();
      expect(fit!.matches, `fit no coincide en ${piece.instancia_id}: p2PosErr=${fit!.p2PosErrorMm}, p2DirErr=${fit!.p2DirErrorDeg}`).toBe(true);
    }
    for (const c of tray.conexiones) {
      const pa = tray.piezas.find((p) => p.instancia_id === c.a[0])!.puertos[c.a[1]]!;
      const pb = tray.piezas.find((p) => p.instancia_id === c.b[0])!.puertos[c.b[1]]!;
      const gap = Math.hypot(
        (pa.posicion_mm as number[])[0] - (pb.posicion_mm as number[])[0],
        (pa.posicion_mm as number[])[1] - (pb.posicion_mm as number[])[1],
        (pa.posicion_mm as number[])[2] - (pb.posicion_mm as number[])[2],
      );
      expect(gap, `gap entre ${c.a[0]}.${c.a[1]} y ${c.b[0]}.${c.b[1]} = ${gap}`).toBeLessThan(0.1);
    }
  });

  it('escenario RIGHT: el chirality elegido por verifyGeometricFit coincide con el usado por planAddCurve', () => {
    const { tray } = runScenario('right');
    const curvePiece = tray.piezas.find((p) => p.producto_id === CPS90.producto_id)!;
    const fit = verifyGeometricFit(CPS90, curvePiece)!;
    expect(fit.chirality).toBe(chiralityForTurn('right'));
  });

  it('escenario LEFT: el chirality elegido por verifyGeometricFit coincide con el usado por planAddCurve', () => {
    const { tray } = runScenario('left');
    const curvePiece = tray.piezas.find((p) => p.producto_id === CPS90.producto_id)!;
    const fit = verifyGeometricFit(CPS90, curvePiece)!;
    expect(fit.chirality).toBe(chiralityForTurn('left'));
  });
});
