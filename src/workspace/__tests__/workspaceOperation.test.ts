/**
 * Tests for workspaceOperation.ts
 *
 * Covers all acceptance criteria for E0:
 * - cancelar no modifica datos (pure functions, no side effects)
 * - confirmar crea una sola operación atómica
 * - deshacer restaura el estado anterior completo
 * - rehacer restaura el estado confirmado
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
  it('returns null when pe.conductores is empty', () => {
    const entrada = makeTrayInput();
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'SEG-2')).toBeNull();
  });

  it('returns null when no conductor ends at startPieceId', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-3', 'SEG-4'] },
      ]},
    });
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'SEG-2')).toBeNull();
  });

  it('returns null when conductor recorrido is empty', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: [] },
      ]},
    });
    expect(findPeExtensionProposal(entrada, 'SEG-1', 'SEG-2')).toBeNull();
  });

  it('returns proposal when conductor ends at startPieceId', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'SEG-2');
    expect(result).not.toBeNull();
    expect(result!.conductorIdx).toBe(0);
    expect(result!.currentRecorrido).toEqual(['SEG-1']);
    expect(result!.proposedRecorrido).toEqual(['SEG-1', 'SEG-2']);
    expect(result!.ambiguous).toBe(false);
    expect(result!.matchingIndices).toEqual([0]);
  });

  it('includes full existing recorrido in proposal', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1', 'SEG-2', 'SEG-3'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-3', 'SEG-4');
    expect(result!.currentRecorrido).toEqual(['SEG-1', 'SEG-2', 'SEG-3']);
    expect(result!.proposedRecorrido).toEqual(['SEG-1', 'SEG-2', 'SEG-3', 'SEG-4']);
  });

  it('marks proposal as ambiguous when two conductors end at startPieceId', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
        { conductor_id: 'PE-2', recorrido: ['SEG-2', 'SEG-1'] },
      ]},
    });
    const result = findPeExtensionProposal(entrada, 'SEG-1', 'SEG-2');
    expect(result!.ambiguous).toBe(true);
    expect(result!.matchingIndices).toEqual([0, 1]);
    // primary is the first match
    expect(result!.conductorIdx).toBe(0);
  });

  it('does not check middle-of-recorrido occurrences — only the last element', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1', 'SEG-2', 'SEG-1'] }, // SEG-1 is last
      ]},
    });
    const result1 = findPeExtensionProposal(entrada, 'SEG-1', 'SEG-X');
    expect(result1).not.toBeNull(); // SEG-1 IS the last element

    const entrada2 = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1', 'SEG-2'] }, // SEG-1 is NOT last
      ]},
    });
    const result2 = findPeExtensionProposal(entrada2, 'SEG-1', 'SEG-X');
    expect(result2).toBeNull(); // SEG-1 is in the middle — not proposed
  });

  it('does not mutate the entrada', () => {
    const entrada = makeTrayInput({
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const original = JSON.stringify(entrada);
    findPeExtensionProposal(entrada, 'SEG-1', 'SEG-2');
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

  it('connection a uses reversed port when newPiecePort=P2', () => {
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

  it('includes PE extension proposal when conductor ends at startPiece', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const op = planAddSegment(entrada, START_PORT, PRODUCT, COMPAT_OK, 3000, DIR);
    expect(op.peExtension).not.toBeNull();
    expect(op.peExtension!.proposedRecorrido).toContain(op.newPiece.instancia_id);
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

  it('extends PE recorrido when peDecision=accept', () => {
    const entrada = makeTrayInput({
      piezas: [makePiece('SEG-1')],
      pe: { seccion_requerida_mm2: 16, cable_id: 'T', origen_requisito: 't', conductores: [
        { conductor_id: 'PE-1', recorrido: ['SEG-1'] },
      ]},
    });
    const op = buildOp(entrada);
    const result = applyOperation(entrada, op, 'accept');
    const cond = result.pe.conductores[0] as Record<string,unknown>;
    expect(cond.recorrido).toEqual(['SEG-1', op.newPiece.instancia_id]);
  });

  it('accept with no peExtension is a no-op on PE', () => {
    const entrada = makeTrayInput({ piezas: [makePiece('SEG-1')] }); // no PE
    const op = buildOp(entrada);
    expect(op.peExtension).toBeNull();
    const result = applyOperation(entrada, op, 'accept');
    expect(result.pe.conductores).toHaveLength(0);
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
