/**
 * Pure functions for planning and applying workspace operations.
 * No side effects — all functions are deterministic and testable.
 *
 * Separation:
 *   plan*   → builds a PendingOperation (no writes)
 *   apply*  → returns a new TrayInput (pure, structuredClone-based)
 *
 * PE rule: one conductor per tray, not one per circuit.
 * Extension is proposed only when the conductor's recorrido ends at the
 * selected port's piece. Ambiguity is surfaced, never silently resolved.
 */
import type { Piece, TrayInput } from '../tray/model';
import type { Product } from '../tray/model';
import type { DirectCompatResult, StartPort, Point3 } from './routingRules';
import { buildSegmentPiece, generateSegmentId } from './addTraySegment';
import { computeEndpoint, generateConnectionId } from './routingRules';

// ─── PE extension ─────────────────────────────────────────────────────────────

export interface PeExtensionProposal {
  /** Index in pe.conductores[] of the primary conductor to extend. */
  conductorIdx: number;
  /** Current recorrido of the primary conductor. */
  currentRecorrido: string[];
  /** Proposed recorrido with newPieceId appended at the end. */
  proposedRecorrido: string[];
  /** All conductor indices whose recorrido ends at startPieceId (for display). */
  matchingIndices: number[];
  /** True when more than one conductor ends at startPieceId. */
  ambiguous: boolean;
}

/**
 * Checks whether any PE conductor's recorrido ends at startPieceId.
 * Returns a proposal for extending that conductor, or null if none matches.
 *
 * Rules enforced here:
 * - Only the LAST element of recorrido is checked (routing extends one end at a time).
 * - If multiple conductors end there, the proposal is marked ambiguous and the
 *   primary is the first match. The UI must surface the ambiguity.
 * - Does NOT propose extension if pe.conductores is empty.
 */
export function findPeExtensionProposal(
  entrada: TrayInput,
  startPieceId: string,
  newPieceId: string,
): PeExtensionProposal | null {
  const conductores = entrada.pe?.conductores;
  if (!Array.isArray(conductores) || conductores.length === 0) return null;

  const matchingIndices: number[] = [];
  for (let i = 0; i < conductores.length; i++) {
    const cond = conductores[i];
    if (!cond || typeof cond !== 'object' || !Array.isArray(cond.recorrido)) continue;
    const rec = cond.recorrido as unknown[];
    if (rec.length > 0 && rec[rec.length - 1] === startPieceId) {
      matchingIndices.push(i);
    }
  }

  if (matchingIndices.length === 0) return null;

  const primaryIdx = matchingIndices[0];
  const primaryCond = conductores[primaryIdx] as Record<string, unknown>;
  const currentRecorrido = [...(primaryCond.recorrido as string[])];

  return {
    conductorIdx: primaryIdx,
    currentRecorrido,
    proposedRecorrido: [...currentRecorrido, newPieceId],
    matchingIndices,
    ambiguous: matchingIndices.length > 1,
  };
}

// ─── Pending operation types ──────────────────────────────────────────────────

export interface PendingSegmentAddition {
  kind: 'add_segment';
  /** New piece to push into piezas[]. */
  newPiece: Piece;
  /** New connection to push into conexiones[]. */
  newConnection: { conexion_id: string; a: [string, string]; b: [string, string] };
  /** Compatibility evidence (for display and audit trail). */
  resolution: DirectCompatResult;
  /** PE extension proposal, or null when no PE is configured or none ends here. */
  peExtension: PeExtensionProposal | null;
}

export type PendingOperation = PendingSegmentAddition;

// ─── Plan ─────────────────────────────────────────────────────────────────────

/**
 * Plans a straight-segment addition from a free port.
 * Does NOT modify entrada. Returns a PendingOperation for preview and commit.
 *
 * Throws if compat.ok is false or lengthMm ≤ 0 — callers must guard.
 */
export function planAddSegment(
  entrada: TrayInput,
  startPort: StartPort,
  newProduct: Product,
  compat: DirectCompatResult,
  lengthMm: number,
  effectiveDir: Point3,
): PendingSegmentAddition {
  if (!compat.ok) throw new Error('planAddSegment: compat.ok must be true');
  if (lengthMm <= 0) throw new Error('planAddSegment: lengthMm must be > 0');

  const pieceIds = new Set(entrada.piezas.map((p) => p.instancia_id));
  const connIds  = new Set(entrada.conexiones.map((c) => c.conexion_id));

  const newId   = generateSegmentId(pieceIds);
  const startPos = startPort.pos;
  const endPos   = computeEndpoint(startPos, effectiveDir, lengthMm);

  // newPiecePort tells which port of the new piece sits at the connection point.
  // 'P2' means the piece is geometrically reversed so P2 is at startPos.
  const newPiecePort = compat.newPiecePort;
  const newPiece = newPiecePort === 'P2'
    ? buildSegmentPiece(newId, newProduct.producto_id, endPos, startPos)
    : buildSegmentPiece(newId, newProduct.producto_id, startPos, endPos);

  const connId = generateConnectionId(connIds);
  const newConnection = {
    conexion_id: connId,
    a: [startPort.pieceId, startPort.portName] as [string, string],
    b: [newId, newPiecePort] as [string, string],
  };

  const peExtension = findPeExtensionProposal(entrada, startPort.pieceId, newId);

  return { kind: 'add_segment', newPiece, newConnection, resolution: compat, peExtension };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * Applies a PendingOperation to a TrayInput and returns the new state.
 * Does NOT modify entrada (uses structuredClone internally).
 *
 * peDecision:
 *   'accept' — extend the matched PE conductor's recorrido (if peExtension present)
 *   'reject' — leave PE unchanged
 */
export function applyOperation(
  entrada: TrayInput,
  op: PendingOperation,
  peDecision: 'accept' | 'reject',
): TrayInput {
  const next = structuredClone(entrada) as TrayInput;

  if (op.kind === 'add_segment') {
    next.piezas.push(op.newPiece);
    next.conexiones.push(op.newConnection);

    if (peDecision === 'accept' && op.peExtension !== null && Array.isArray(next.pe?.conductores)) {
      const conductor = next.pe.conductores[op.peExtension.conductorIdx];
      if (conductor && Array.isArray(conductor.recorrido)) {
        (conductor as Record<string,unknown>).recorrido = op.peExtension.proposedRecorrido;
      }
    }
  }

  return next;
}
