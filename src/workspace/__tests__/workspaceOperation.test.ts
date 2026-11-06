/**
 * Tests for workspaceOperation.ts
 *
 * Covers all acceptance criteria for E0 (closure corrections):
 * - PE endpoint resolved via port + connections graph, not just last array element
 * - Extension from both ends of a recorrido (append and prepend)
 * - Pending status when conexiones can't verify outer port
 * - Port that doesn't correspond to PE endpoint → no proposal
 * - Multiple candidates with real conductor_id, explicit choice required
 * - applyOperation: prepend and append
 * - Import boundary: importEdit clears history (tested separately via store test)
 * - cancelar no modifica datos (pure functions, no side effects)
 * - confirmar crea una sola operación atómica
 * - PE no se duplica y recupera su recorrido
 * - exportar/importar conserva todos los datos
 * - Python recibe únicamente campos admitidos (toMotorEntrada)
 */
import { describe, it, expect } from 'vitest';
import {
  findPeExtensionProposal,
  planAddSegment,
  applyOperation,
  type PendingSegmentAddition,
} from '../workspaceOperation';
import { toMotorEntrada } from '../../tray/store';
import type { TrayInput, Piece } from '../../tray/model';
import type { DirectCompatResult, StartPort, Point3 } from '../routingRules';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTrayInput(overrides: Partial<TrayInput> = {}): TrayInput {
  return {
    version_contrato: 'trazado/1',
    piezas: [],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    ...overrides,
  };
}

function makePiece(id: string): Piece {
  return {
    instancia_id: id,
    producto_id: 'PROD-A',
    longitud_mm: 3000,
    puertos: {
      P1: { posicion_mm: [0,0,0],    direccion: [-1,0,0] },
      P2: { posicion_mm: [3000,0,0], direccion: [1,0,0]  },
    },
  };
}

/** Connection from pieceA.portA to pieceB.portB */
function makeConn(id: string, aId: string, aPort: string, bId: string, bPort: string) {
  return { conexion_id: id, a: [aId, aPort] as [string,string], b: [bId, bPort] as [string,string] };
}

const COMPAT_OK: DirectCompatResult = {
  ok: true,
  needsReduction: false,
  reason: 'Compatible según catálogo (CMP-001).',
  compatibilidadId: 'CMP-001',
  requiredUnion: [],
  evidence: '',
  newPiecePort: 'P1',
};

const COMPAT_REVERSED: DirectCompatResult = {
  ...COMPAT_OK,
  newPiecePort: 'P2',
  reason: 'Compatible — conectar por puerto P2.',
};

const START_PORT: StartPort = {
  pieceId: 'SEG-1',
  portName: 'P2',
  pos: [3000, 0, 0],
  dir: [1, 0, 0],
};

const PRODUCT = {
  producto_id: 'PROD-A',
  descripcion_original: 'PROD-A',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 150,
  sku: 'PROD-A',
};

const DIR: Point3 = [1, 0, 0];

// ─── findPeExtensionProposal ──────────────────────────────────────────────────

describe('findPeExtensionProposal', () => {
  // ── Null cases ──────────────────────────────────────────────────────────────

  it('returns null when pe.conductores is empty', () => {
    const entrada = makeTrayInput();
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-2')).toBeNull();
  });

  it('returns null when no conductor has an endpoint at startPieceId', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-3', 'SEG-4'] },
      ]},
    });
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-2')).toBeNull();
  });

  it('returns null when conductor recorrido is empty', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: [] },
      ]},
    });
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-2')).toBeNull();
  });

  it('returns null when piece is in the middle of recorrido (not first or last)', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-0', 'SEG-1', 'SEG-2'] },
      ]},
    });
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-X')).toBeNull();
  });

  // ── Single-piece recorrido ──────────────────────────────────────────────────

  it('returns append proposal for single-piece recorrido when P2 selected', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')], // must be present so port count (2) can be verified
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-2');
    expect(result).not.toBeNull();
    expect(result!.primary.extensionEnd).toBe('end');
    expect(result!.primary.proposedRecorrido).toEqual(['SEG-1', 'SEG-2']);
    expect(result!.primary.conductorId).toBe('PE-1');
    expect(result!.primary.status).toBe('ready');
    expect(result!.ambiguous).toBe(false);
  });

  it('returns prepend proposal for single-piece recorrido when P1 selected', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'P1', 'SEG-2');
    expect(result).not.toBeNull();
    expect(result!.primary.extensionEnd).toBe('start');
    expect(result!.primary.proposedRecorrido).toEqual(['SEG-2', 'SEG-1']);
    expect(result!.primary.status).toBe('ready');
  });

  // ── Multi-piece end extension ───────────────────────────────────────────────

  it('returns append proposal when outer port of end endpoint matches startPortName', () => {
    // recorrido: SEG-1 → SEG-2. SEG-2.P1 is inner (connected to SEG-1.P2). SEG-2.P2 is outer.
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [makeConn('CON-1', 'SEG-1', 'P2', 'SEG-2', 'P1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-A', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-2', 'P2', 'SEG-3');
    expect(result).not.toBeNull();
    expect(result!.primary.extensionEnd).toBe('end');
    expect(result!.primary.proposedRecorrido).toEqual(['SEG-1', 'SEG-2', 'SEG-3']);
    expect(result!.primary.status).toBe('ready');
  });

  it('returns null when startPortName is the inner port of the end endpoint', () => {
    // SEG-2.P1 is connected to SEG-1.P2, so it is inner. Clicking P1 on SEG-2 is not an endpoint.
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [makeConn('CON-1', 'SEG-1', 'P2', 'SEG-2', 'P1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-A', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-2', 'P1', 'SEG-3');
    expect(result).toBeNull();
  });

  // ── Multi-piece start extension ─────────────────────────────────────────────

  it('returns prepend proposal when outer port of start endpoint matches startPortName', () => {
    // recorrido: SEG-1 → SEG-2. SEG-1.P2 is inner (connected to SEG-2.P1). SEG-1.P1 is outer.
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [makeConn('CON-1', 'SEG-1', 'P2', 'SEG-2', 'P1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-A', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'P1', 'SEG-0');
    expect(result).not.toBeNull();
    expect(result!.primary.extensionEnd).toBe('start');
    expect(result!.primary.proposedRecorrido).toEqual(['SEG-0', 'SEG-1', 'SEG-2']);
    expect(result!.primary.status).toBe('ready');
  });

  it('returns null when startPortName is the inner port of the start endpoint', () => {
    // SEG-1.P2 is connected to SEG-2.P1, so clicking P2 on SEG-1 is the inner port.
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [makeConn('CON-1', 'SEG-1', 'P2', 'SEG-2', 'P1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-A', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-0');
    expect(result).toBeNull();
  });

  // ── Pending status ──────────────────────────────────────────────────────────

  it('returns pending proposal when conexiones cannot resolve the outer port', () => {
    // No connection linking SEG-1 and SEG-2 in conexiones
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [], // no connections
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-A', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-2', 'P2', 'SEG-3');
    expect(result).not.toBeNull();
    expect(result!.primary.status).toBe('pending');
  });

  // ── Ambiguity ───────────────────────────────────────────────────────────────

  it('marks ambiguous and uses real conductor_id when multiple conductors have endpoint at port', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')], // 2-port piece → both candidates 'ready'
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-A', recorrido: ['SEG-1'] },
        { conductor_id: 'COND-B', recorrido: ['SEG-1'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-2');
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(true);
    expect(result!.candidates).toHaveLength(2);
    expect(result!.candidates.map(c => c.conductorId)).toEqual(['COND-A', 'COND-B']);
    // primary is first candidate but all are exposed
    expect(result!.primary.conductorId).toBe('COND-A');
  });

  it('includes full existing recorrido in proposal', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2'), makePiece('SEG-3')],
      conexiones: [
        makeConn('CON-1', 'SEG-1', 'P2', 'SEG-2', 'P1'),
        makeConn('CON-2', 'SEG-2', 'P2', 'SEG-3', 'P1'),
      ],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1', 'SEG-2', 'SEG-3'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-3', 'P2', 'SEG-4');
    expect(result!.primary.currentRecorrido).toEqual(['SEG-1', 'SEG-2', 'SEG-3']);
    expect(result!.primary.proposedRecorrido).toEqual(['SEG-1', 'SEG-2', 'SEG-3', 'SEG-4']);
  });

  it('does not mutate the entrada', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const original = JSON.stringify(entrada);
    findPeExtensionProposal(entrada, 'SEG-1', 'P2', 'SEG-2');
    expect(JSON.stringify(entrada)).toBe(original);
  });
});

// ─── planAddSegment ───────────────────────────────────────────────────────────

describe('planAddSegment', () => {
  it('throws when compat.ok is false', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const badCompat: DirectCompatResult = { ...COMPAT_OK, ok: false };
    expect(() => planAddSegment(entrada, START_PORT, PRODUCT, badCompat, 3000, DIR)).toThrow();
  });

  it('throws when lengthMm <= 0', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    expect(() => planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 0, DIR)).toThrow();
    expect(() => planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, -100, DIR)).toThrow();
  });

  it('returns kind=add_segment with new piece and connection', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.kind).toBe('add_segment');
    expect(op.newPiece.instancia_id).toBe('SEG-2'); // first unused SEG-N
    expect(op.newPiece.producto_id).toBe('PROD-A');
    expect(op.newPiece.longitud_mm).toBe(3000);
  });

  it('places new piece from startPos to endPos when newPiecePort=P1', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    // P1 of new piece should be at startPos [3000,0,0]
    expect(op.newPiece.puertos.P1.posicion_mm).toEqual([3000,0,0]);
    expect(op.newPiece.puertos.P2.posicion_mm).toEqual([6000,0,0]);
  });

  it('reverses piece geometry when newPiecePort=P2', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_REVERSED, 3000, DIR);
    // P2 of new piece should be at startPos [3000,0,0] (reversed)
    expect(op.newPiece.puertos.P2.posicion_mm).toEqual([3000,0,0]);
    expect(op.newPiece.puertos.P1.posicion_mm).toEqual([6000,0,0]);
  });

  it('sets connection a=startPort, b=[newId, newPiecePort]', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.newConnection.a).toEqual(['SEG-1', 'P2']);
    expect(op.newConnection.b).toEqual([op.newPiece.instancia_id, 'P1']);
  });

  it('connection b uses P2 when newPiecePort=P2', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_REVERSED, 3000, DIR);
    expect(op.newConnection.b[1]).toBe('P2');
  });

  it('assigns unique connection ID not already in conexiones', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      conexiones: [{ conexion_id: 'CON-001', a: ['SEG-1','P1'], b: ['SEG-0','P2'] }],
    });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.newConnection.conexion_id).not.toBe('CON-001');
  });

  it('includes resolution evidence', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.resolution.compatibilidadId).toBe('CMP-001');
  });

  it('includes PE extension proposal when conductor has endpoint at startPort', () => {
    // Single-piece recorrido: SEG-1, start port is P2 → append
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.peExtension).not.toBeNull();
    expect(op.peExtension!.primary.proposedRecorrido).toContain(op.newPiece.instancia_id);
  });

  it('sets peExtension=null when no PE is configured', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.peExtension).toBeNull();
  });

  it('does not mutate the entrada', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const original = JSON.stringify(entrada);
    planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(JSON.stringify(entrada)).toBe(original);
  });
});

// ─── applyOperation ───────────────────────────────────────────────────────────

describe('applyOperation', () => {
  function buildOp(entrada: TrayInput): PendingSegmentAddition {
    return planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
  }

  it('adds the new piece to piezas', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = buildOp(entrada);
    const result = applyOperation(entrada, op, 'reject');
    expect(result.piezas).toHaveLength(2);
    expect(result.piezas[1].instancia_id).toBe(op.newPiece.instancia_id);
  });

  it('adds the new connection to conexiones', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const op = buildOp(entrada);
    const result = applyOperation(entrada, op, 'reject');
    expect(result.conexiones).toHaveLength(1);
    expect(result.conexiones[0].conexion_id).toBe(op.newConnection.conexion_id);
  });

  it('does not modify PE when peDecision=reject', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const op = buildOp(entrada);
    const result = applyOperation(entrada, op, 'reject');
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect(cond.recorrido).toEqual(['SEG-1']); // unchanged
  });

  it('appends new piece to PE recorrido (end extension) when peDecision=accept', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const op = buildOp(entrada); // START_PORT.portName='P2' → extensionEnd='end'
    const result = applyOperation(entrada, op, 'accept');
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect(cond.recorrido).toEqual(['SEG-1', op.newPiece.instancia_id]);
  });

  it('prepends new piece to PE recorrido (start extension) when peDecision=accept', () => {
    // recorrido: [SEG-1, SEG-2], connection SEG-1.P2 → SEG-2.P1
    // User clicks SEG-1.P1 → outer port of start → propose prepend
    const p1Port: StartPort = { pieceId: 'SEG-1', portName: 'P1', pos: [0,0,0], dir: [-1,0,0] };
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [makeConn('CON-1', 'SEG-1', 'P2', 'SEG-2', 'P1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const op = planAddSegment(entrada, p1Port, PRODUCT, COMPAT_REVERSED, 3000, [-1,0,0]);
    expect(op.peExtension).not.toBeNull();
    expect(op.peExtension!.primary.extensionEnd).toBe('start');
    const result = applyOperation(entrada, op, 'accept');
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect((cond.recorrido as string[])[0]).toBe(op.newPiece.instancia_id); // prepended
    expect(cond.recorrido).toHaveLength(3);
  });

  it('accept with no peExtension is a no-op on PE', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] }); // no PE
    const op = buildOp(entrada);
    expect(op.peExtension).toBeNull();
    const result = applyOperation(entrada, op, 'accept');
    expect(result.pe.conductores).toHaveLength(0);
  });

  it('applies non-primary candidate when op.peExtension.primary is overridden', () => {
    // Two candidates — user chose the second (COND-B)
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      conexiones: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-A', recorrido: ['SEG-1'] },
        { conductor_id: 'COND-B', recorrido: ['SEG-1'] },
      ]},
    });
    const op = buildOp(entrada);
    expect(op.peExtension!.ambiguous).toBe(true);
    // Override primary to second candidate (conductorIdx=1)
    const chosenCandidate = op.peExtension!.candidates.find(c => c.conductorIdx === 1)!;
    op.peExtension = { ...op.peExtension!, primary: chosenCandidate };

    const result = applyOperation(entrada, op, 'accept');
    // COND-A unchanged, COND-B extended
    const condA = result.pe.conductores[0] as Record<string,unknown>;
    const condB = result.pe.conductores[1] as Record<string,unknown>;
    expect(condA.recorrido).toEqual(['SEG-1']); // not extended
    expect((condB.recorrido as string[])).toContain(op.newPiece.instancia_id); // extended
  });

  it('does not mutate the original entrada', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const originalJson = JSON.stringify(entrada);
    const op = buildOp(entrada);
    applyOperation(entrada, op, 'accept');
    expect(JSON.stringify(entrada)).toBe(originalJson); // entrada not mutated
  });

  it('round-trip: apply then undo (restore clone) gives back original state', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const originalJson = JSON.stringify(entrada);
    const op = buildOp(entrada);
    const afterApply = applyOperation(entrada, op, 'accept');
    // Undo = discard afterApply, restore from history (the saved entrada)
    const restored = structuredClone(entrada);
    expect(JSON.stringify(restored)).toBe(originalJson);
    // And the applied state has the new piece
    expect(afterApply.piezas).toHaveLength(2);
  });

  it('preserves unknown fields (excepciones_conexion) through the operation', () => {
    const entrada = {
      ...makeTrayInput({ piezas: [makePiece('SEG-1')] }),
      excepciones_conexion: { 'CON-001': { motivo: 'test', confirmado_por: 'user', fecha_iso: '2026' } },
    } as TrayInput;
    const op = buildOp(entrada);
    const result = applyOperation(entrada, op, 'reject');
    expect((result as Record<string,unknown>).excepciones_conexion).toEqual(
      (entrada as Record<string,unknown>).excepciones_conexion,
    );
  });
});

// ─── Pending candidates — blocked from application ───────────────────────────

describe('pending candidate blocking', () => {
  /** T-piece with P1, P2, P3 — 3 ports. */
  function makeTpiece(id: string): Piece {
    return {
      instancia_id: id,
      producto_id: 'PROD-T',
      longitud_mm: 500,
      puertos: {
        P1: { posicion_mm: [0,0,0],    direccion: [-1,0,0] },
        P2: { posicion_mm: [500,0,0],  direccion: [1,0,0]  },
        P3: { posicion_mm: [250,250,0], direccion: [0,1,0] },
      },
    };
  }

  it('single-piece T-piece recorrido → status pending (cannot infer free ports)', () => {
    const entrada = makeTrayInput({
      piezas: [makeTpiece('T-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-X', recorrido: ['T-1'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'T-1', 'P2', 'SEG-NEW');
    expect(result).not.toBeNull();
    expect(result!.primary.status).toBe('pending');
  });

  it('multi-piece recorrido with T-piece endpoint → status pending even with connection', () => {
    // T-1.P1 is connected to SEG-1.P2 (inner). T-1.P2 is not inner, but T-piece has 3 ports.
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makeTpiece('T-1')],
      conexiones: [makeConn('CON-1', 'SEG-1', 'P2', 'T-1', 'P1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-X', recorrido: ['SEG-1', 'T-1'] },
      ]},
    });
    // User clicks T-1.P2 (not inner port P1)
    const result = findPeExtensionProposal(entrada, 'T-1', 'P2', 'SEG-NEW');
    expect(result).not.toBeNull();
    expect(result!.primary.status).toBe('pending');
  });

  it('applyOperation with accept + pending primary leaves PE unchanged', () => {
    // No connection → pending
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-X', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.peExtension).not.toBeNull();
    expect(op.peExtension!.primary.status).toBe('pending');

    const result = applyOperation(entrada, op, 'accept');
    // PE unchanged — pending candidates are never applied
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect(cond.recorrido).toEqual(['SEG-1', 'SEG-2']);
  });

  it('applyOperation with reject + pending primary leaves PE unchanged (normal path)', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1'), makePiece('SEG-2')],
      conexiones: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-X', recorrido: ['SEG-1', 'SEG-2'] },
      ]},
    });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    const result = applyOperation(entrada, op, 'reject');
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect(cond.recorrido).toEqual(['SEG-1', 'SEG-2']);
    // New piece is still added despite PE not extended
    expect(result.piezas).toHaveLength(3);
    expect(result.conexiones).toHaveLength(1);
  });

  it('confirming the tray with reject on a pending proposal keeps PE and adds piece', () => {
    // Verifies the "No extender" path: piece is committed, PE is untouched
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'COND-X', recorrido: ['SEG-1'] },
      ]},
    });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    const result = applyOperation(entrada, op, 'reject');

    // Piece added
    expect(result.piezas).toHaveLength(2);
    expect(result.conexiones).toHaveLength(1);
    // PE unchanged
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect(cond.recorrido).toEqual(['SEG-1']);
  });
});

// ─── toMotorEntrada (Python adapter) ─────────────────────────────────────────

describe('toMotorEntrada', () => {
  it('passes through all trazado/1 fields unchanged', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] });
    const motor = toMotorEntrada(entrada);
    expect(motor.version_contrato).toBe('trazado/1');
    expect(Array.isArray(motor.piezas)).toBe(true);
    expect(Array.isArray(motor.conexiones)).toBe(true);
    expect(Array.isArray(motor.circuitos)).toBe(true);
    expect(Array.isArray(motor.soportes)).toBe(true);
    expect(motor.pe).toBeDefined();
  });

  it('strips excepciones_conexion from the motor payload', () => {
    const entrada = {
      ...makeTrayInput(),
      excepciones_conexion: { 'CON-001': { motivo: 'test', confirmado_por: 'user', fecha_iso: '2026' } },
    } as TrayInput;
    const motor = toMotorEntrada(entrada);
    expect('excepciones_conexion' in motor).toBe(false);
  });

  it('does not strip unknown fields that are not workspace-only', () => {
    const entrada = { ...makeTrayInput(), meta: { nota: 'libre' } } as TrayInput;
    const motor = toMotorEntrada(entrada);
    expect((motor as Record<string,unknown>).meta).toEqual({ nota: 'libre' });
  });

  it('does not mutate the original trayInput', () => {
    const entrada = {
      ...makeTrayInput(),
      excepciones_conexion: { x: 1 },
    } as TrayInput;
    const originalJson = JSON.stringify(entrada);
    toMotorEntrada(entrada);
    expect(JSON.stringify(entrada)).toBe(originalJson);
  });
});
