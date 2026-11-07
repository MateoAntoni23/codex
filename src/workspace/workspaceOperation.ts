/**
 * Pure functions for planning and applying workspace operations.
 * No side effects — all functions are deterministic and testable.
 *
 * Separation:
 *   plan*   → builds a PendingOperation (no writes)
 *   apply*  → returns a new TrayInput (pure, structuredClone-based)
 *
 * PE rule: one conductor per tray, not one per circuit.
 * Extension uses the port+connections graph to resolve the physical endpoint of
 * each recorrido. Ambiguity is surfaced and requires explicit user choice.
 */
import type { Piece, TrayInput } from '../tray/model';
import type { Product } from '../tray/model';
import type { DirectCompatResult, StartPort, Point3 } from './routingRules';
import { buildSegmentPiece, generateSegmentId } from './addTraySegment';
import { buildCurvePiece, generateCurveId, computeTurnPerp } from './addCurvePiece';
import { computeEndpoint, generateConnectionId } from './routingRules';
import { resolveRecipe, placeRecipe, chiralityForTurn } from './parametricBridge';

// ─── PE extension ─────────────────────────────────────────────────────────────

export interface PeConductorCandidate {
  conductorIdx: number;
  /** Real conductor_id from data (not invented). */
  conductorId: string;
  /** Which end of the recorrido will be extended. */
  extensionEnd: 'start' | 'end';
  currentRecorrido: string[];
  /** Proposed recorrido with newPieceId prepended (start) or appended (end). */
  proposedRecorrido: string[];
  /**
   * 'ready' — outer port confirmed from conexiones graph, matches startPortName.
   * 'pending' — conexiones insufficient to verify outer port; proposal is speculative.
   */
  status: 'ready' | 'pending';
}

export interface PeExtensionProposal {
  /** All conductors with a physical endpoint at the selected port. */
  candidates: PeConductorCandidate[];
  /** Default primary (candidates[0]). UI may override with user's explicit choice. */
  primary: PeConductorCandidate;
  /** True when candidates.length > 1 — UI must require explicit choice. */
  ambiguous: boolean;
}

/**
 * Finds the connection that links endpointPieceId to neighborPieceId and returns
 * the inner port of endpointPiece (the port connected toward the rest of the recorrido).
 * Returns null when no such connection exists in conexiones.
 *
 * Intentionally does NOT infer the outer port via "if P1 then P2" — that assumption
 * is only valid for 2-port pieces and must be checked separately.
 */
function resolveInnerPort(
  conexiones: Array<{ conexion_id: string; a: [string, string]; b: [string, string] }>,
  endpointPieceId: string,
  neighborPieceId: string,
): { innerPort: string } | null {
  for (const conn of conexiones) {
    const [aId, aPort] = conn.a;
    const [bId, bPort] = conn.b;
    if (aId === endpointPieceId && bId === neighborPieceId) {
      return { innerPort: aPort };
    }
    if (bId === endpointPieceId && aId === neighborPieceId) {
      return { innerPort: bPort };
    }
  }
  return null;
}

/**
 * Determines whether startPortName is the outer (free) endpoint port.
 *
 * Returns:
 *   'ready'          — confirmed: startPortName is the outer port of a 2-port piece.
 *   'pending'        — inner port found but piece has >2 ports (T/X), or piece missing.
 *   'not_applicable' — startPortName is the inner port (connects toward the recorrido).
 *   'no_connection'  — no connection in conexiones links endpointPiece to neighbor.
 */
function classifyEndpoint(
  entrada: TrayInput,
  startPieceId: string,
  startPortName: string,
  neighborPieceId: string,
): 'ready' | 'pending' | 'not_applicable' | 'no_connection' {
  const resolved = resolveInnerPort(entrada.conexiones, startPieceId, neighborPieceId);
  if (resolved === null) return 'no_connection';
  if (resolved.innerPort === startPortName) return 'not_applicable';

  // startPortName is not the inner port.
  // Safe to call 'ready' only for exactly-2-port pieces where the other port is unambiguously the outer.
  const piece = entrada.piezas.find((p) => p.instancia_id === startPieceId);
  if (!piece) return 'pending';
  return Object.keys(piece.puertos).length === 2 ? 'ready' : 'pending';
}

/**
 * Checks whether any PE conductor's recorrido has a physical endpoint at startPieceId
 * on the port identified by startPortName. Uses the conexiones graph to verify
 * which port of the endpoint piece is free (outer) vs. connected to its neighbor (inner).
 *
 * Rules enforced here:
 * - Checks both ends (recorrido[0] and recorrido[last]) of each conductor.
 * - For length-1 recorrido: both ports are free; 2-port piece → 'ready', T/X → 'pending'.
 * - For multi-piece: uses classifyEndpoint to find the inner port and confirm piece is
 *   exactly 2-port before marking 'ready'. T/X pieces or missing connections → 'pending'.
 * - If startPortName is the inner port → not applicable (not an extension point).
 * - Pieces in the middle of a recorrido are never proposed.
 * - Candidates with status 'pending' are shown but cannot be applied.
 * - Returns all candidates; ambiguous when candidates.length > 1.
 */
export function findPeExtensionProposal(
  entrada: TrayInput,
  startPieceId: string,
  startPortName: string,
  newPieceId: string,
): PeExtensionProposal | null {
  const conductores = entrada.pe?.conductores;
  if (!Array.isArray(conductores) || conductores.length === 0) return null;

  const candidates: PeConductorCandidate[] = [];

  for (let i = 0; i < conductores.length; i++) {
    const cond = conductores[i];
    if (!cond || typeof cond !== 'object' || !Array.isArray(cond.recorrido)) continue;
    const rec = cond.recorrido as string[];
    if (rec.length === 0) continue;

    const conductorId =
      typeof (cond as Record<string, unknown>).conductor_id === 'string'
        ? (cond as Record<string, unknown>).conductor_id as string
        : `cond-${i}`;

    // Length-1 recorrido: no neighbor to look up — both ports are potentially outer.
    // 2-port piece: safe to call 'ready'. T/X (3+ ports): can't confirm all ports are free.
    if (rec.length === 1 && rec[0] === startPieceId) {
      const piece = entrada.piezas.find((p) => p.instancia_id === startPieceId);
      const portCount = piece ? Object.keys(piece.puertos).length : 0;
      const extensionEnd: 'start' | 'end' = startPortName === 'P1' ? 'start' : 'end';
      candidates.push({
        conductorIdx: i,
        conductorId,
        extensionEnd,
        currentRecorrido: [...rec],
        proposedRecorrido: extensionEnd === 'end' ? [...rec, newPieceId] : [newPieceId, ...rec],
        status: portCount === 2 ? 'ready' : 'pending',
      });
      continue;
    }

    // End endpoint: recorrido[last]
    if (rec[rec.length - 1] === startPieceId) {
      const cls = classifyEndpoint(entrada, startPieceId, startPortName, rec[rec.length - 2]);
      if (cls === 'not_applicable') {
        // startPortName is the inner port — not an extension point
      } else {
        candidates.push({
          conductorIdx: i, conductorId, extensionEnd: 'end',
          currentRecorrido: [...rec],
          proposedRecorrido: [...rec, newPieceId],
          status: cls === 'ready' ? 'ready' : 'pending',
        });
      }
    }

    // Start endpoint: recorrido[0] (length > 1, so it's distinct from the end)
    if (rec[0] === startPieceId && rec.length > 1) {
      const cls = classifyEndpoint(entrada, startPieceId, startPortName, rec[1]);
      if (cls === 'not_applicable') {
        // startPortName is the inner port — not an extension point
      } else {
        candidates.push({
          conductorIdx: i, conductorId, extensionEnd: 'start',
          currentRecorrido: [...rec],
          proposedRecorrido: [newPieceId, ...rec],
          status: cls === 'ready' ? 'ready' : 'pending',
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  return {
    candidates,
    primary: candidates[0],
    ambiguous: candidates.length > 1,
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

  const peExtension = findPeExtensionProposal(
    entrada, startPort.pieceId, startPort.portName, newId,
  );

  return { kind: 'add_segment', newPiece, newConnection, resolution: compat, peExtension };
}

/**
 * Plans a horizontal curve addition from a free port.
 * Does NOT modify entrada. Returns a PendingOperation for preview and commit.
 *
 * radiusMm is the INTERIOR radius from the catalog; centerline radius is computed
 * internally as radio_mm + ancho_nominal_mm / 2.
 *
 * Throws if compat.ok is false or if angulo_grados is missing on the product.
 */
export function planAddCurve(
  entrada: TrayInput,
  startPort: StartPort,
  newProduct: Product,
  compat: DirectCompatResult,
  turnDirection: 'left' | 'right',
): PendingSegmentAddition {
  if (!compat.ok) throw new Error('planAddCurve: compat.ok must be true');

  const angleDeg = (newProduct as Record<string, unknown>).angulo_grados as number | undefined;
  if (!angleDeg || angleDeg <= 0) throw new Error('planAddCurve: angulo_grados must be > 0');

  const pieceIds = new Set(entrada.piezas.map((p) => p.instancia_id));
  const connIds  = new Set(entrada.conexiones.map((c) => c.conexion_id));

  const newId = generateCurveId(pieceIds);
  const entryDir = startPort.dir;

  // newPiecePort tells which port of the new curve connects to the existing piece.
  // Catalog entries for curves use P1 as the entry port; compat.newPiecePort reflects this.
  const newPiecePort = compat.newPiecePort;
  if (newPiecePort !== 'P1') {
    // P2-entry curves are not documented in the current catalog — guard defensively.
    throw new Error(`planAddCurve: unexpected newPiecePort '${newPiecePort}'; only P1 entry is supported`);
  }

  // Preferimos la receta paramétrica medida del STEP cuando existe: así la
  // trayectoria y el P2 de la pieza confirmada coinciden con el preview
  // (no hay "arco sustituto" de 450 mm). Caemos al fallback cuando el
  // producto no está en el catálogo paramétrico.
  const parametricEntry = resolveRecipe(newProduct);
  let newPiece: Piece;
  if (parametricEntry && parametricEntry.piece_kind === 'curva_horizontal') {
    const chirality = chiralityForTurn(turnDirection);
    const placed = placeRecipe(newProduct, parametricEntry, startPort.pos, entryDir, chirality);
    const arcLenMm = radiansToArcLengthForPlacement(placed.p1.pos, placed.p2.pos, angleDeg);
    newPiece = {
      instancia_id: newId,
      producto_id: newProduct.producto_id,
      longitud_eje_mm: arcLenMm,
      puertos: {
        P1: {
          posicion_mm: [placed.p1.pos[0], placed.p1.pos[1], placed.p1.pos[2]],
          direccion: [placed.p1.outwardNormal[0], placed.p1.outwardNormal[1], placed.p1.outwardNormal[2]],
        },
        P2: {
          posicion_mm: [placed.p2.pos[0], placed.p2.pos[1], placed.p2.pos[2]],
          direccion: [placed.p2.outwardNormal[0], placed.p2.outwardNormal[1], placed.p2.outwardNormal[2]],
        },
      },
    };
  } else {
    const radioInterior = ((newProduct as Record<string, unknown>).radio_mm as number | undefined) ?? 300;
    const radiusMm = radioInterior + (newProduct.ancho_nominal_mm ?? 0) / 2;
    const turnPerp = computeTurnPerp(entryDir, turnDirection);
    newPiece = buildCurvePiece(newId, newProduct.producto_id, startPort.pos, entryDir, turnPerp, angleDeg, radiusMm);
  }

  const connId = generateConnectionId(connIds);
  const newConnection = {
    conexion_id: connId,
    a: [startPort.pieceId, startPort.portName] as [string, string],
    b: [newId, newPiecePort] as [string, string],
  };

  const peExtension = findPeExtensionProposal(
    entrada, startPort.pieceId, startPort.portName, newId,
  );

  return { kind: 'add_segment', newPiece, newConnection, resolution: compat, peExtension };
}

/**
 * Longitud de arco deducida del P1 y P2 reales colocados por el puente y del
 * ángulo nominal de la curva. R_chord = ‖P2−P1‖; R_centerline = chord / (2·sin(θ/2));
 * arc = R·θ. Se calcula en vez de aproximar al valor de fallback (300+ancho/2).
 */
function radiansToArcLengthForPlacement(
  p1: [number, number, number],
  p2: [number, number, number],
  angleDeg: number,
): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  const chord = Math.hypot(dx, dy, dz);
  const θ = (angleDeg * Math.PI) / 180;
  const half = θ / 2;
  const sinHalf = Math.sin(half);
  if (sinHalf < 1e-9) return chord;
  const R = chord / (2 * sinHalf);
  return R * θ;
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * Applies a PendingOperation to a TrayInput and returns the new state.
 * Does NOT modify entrada (uses structuredClone internally).
 *
 * peDecision:
 *   'accept' — extend the matched PE conductor's recorrido using proposal.primary
 *   'reject' — leave PE unchanged
 *
 * To use a non-primary candidate, mutate op.peExtension.primary before calling.
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
      const primary = op.peExtension.primary;
      // Pending candidates cannot be applied — they were not verified from conexiones.
      if (primary.status !== 'pending') {
        const conductor = next.pe.conductores[primary.conductorIdx];
        if (conductor && Array.isArray(conductor.recorrido)) {
          (conductor as Record<string, unknown>).recorrido = primary.proposedRecorrido;
        }
      }
    }
  }

  return next;
}
