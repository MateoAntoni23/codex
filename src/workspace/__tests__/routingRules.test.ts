import { describe, it, expect } from 'vitest';
import {
  getOccupiedPorts,
  getFreePorts,
  snapDirectionToAxis,
  computeEndpoint,
  checkDirectCompatibility,
  findReductionCandidates,
  generateConnectionId,
} from '../routingRules';
import type { FreePort, Point3 } from '../routingRules';
import type { Piece, Product } from '../../tray/model';

// ─── helpers ──────────────────────────────────────────────────────────────────

const makePiece = (id: string, ports: Record<string, { pos: Point3; dir: Point3 }>): Piece => ({
  instancia_id: id,
  producto_id: 'P',
  puertos: Object.fromEntries(
    Object.entries(ports).map(([name, { pos, dir }]) => [
      name,
      { posicion_mm: pos, direccion: dir },
    ]),
  ),
});

const makeProduct = (
  id: string,
  ancho: number | null,
  familia: string | null,
  tipo = 'recta',
): Product => ({
  producto_id: id,
  descripcion_original: id,
  tipo_pieza: tipo,
  ancho_nominal_mm: ancho,
  sku: id,
  ...(familia ? { familia_id: familia } : {}),
});

const P1: Point3 = [0, 0, 0];
const P2: Point3 = [3000, 0, 0];
const DIR_P1: Point3 = [-1, 0, 0];
const DIR_P2: Point3 = [1, 0, 0];

const piece1 = makePiece('R1', {
  P1: { pos: P1, dir: DIR_P1 },
  P2: { pos: P2, dir: DIR_P2 },
});
const piece2 = makePiece('R2', {
  P1: { pos: P2, dir: DIR_P1 },
  P2: { pos: [6000, 0, 0], dir: DIR_P2 },
});

// ─── getOccupiedPorts ─────────────────────────────────────────────────────────

describe('getOccupiedPorts', () => {
  it('returns empty set for no connections', () => {
    expect(getOccupiedPorts([])).toEqual(new Set());
  });

  it('marks both ends of a connection', () => {
    const occ = getOccupiedPorts([{ conexion_id: 'C1', a: ['R1', 'P2'], b: ['R2', 'P1'] }]);
    expect(occ.has('R1:P2')).toBe(true);
    expect(occ.has('R2:P1')).toBe(true);
    expect(occ.has('R1:P1')).toBe(false);
  });
});

// ─── getFreePorts ─────────────────────────────────────────────────────────────

describe('getFreePorts', () => {
  it('returns all ports when no connections', () => {
    const free = getFreePorts([piece1], []);
    expect(free).toHaveLength(2);
    expect(free.map((f) => f.portName).sort()).toEqual(['P1', 'P2']);
  });

  it('excludes occupied ports', () => {
    const free = getFreePorts(
      [piece1, piece2],
      [{ conexion_id: 'C1', a: ['R1', 'P2'], b: ['R2', 'P1'] }],
    );
    const keys = free.map((f) => `${f.pieceId}:${f.portName}`);
    expect(keys).not.toContain('R1:P2');
    expect(keys).not.toContain('R2:P1');
    expect(keys).toContain('R1:P1');
    expect(keys).toContain('R2:P2');
  });

  it('returns empty array for no pieces', () => {
    expect(getFreePorts([], [])).toEqual([]);
  });

  it('free port carries position and direction', () => {
    const free = getFreePorts([piece1], []);
    const p1Port = free.find((f) => f.portName === 'P1') as FreePort;
    expect(p1Port.pos).toEqual([0, 0, 0]);
    expect(p1Port.dir).toEqual([-1, 0, 0]);
  });
});

// ─── snapDirectionToAxis ──────────────────────────────────────────────────────

describe('snapDirectionToAxis', () => {
  it('snaps dominant X+', () => {
    expect(snapDirectionToAxis([0.9, 0.1, 0.1])).toEqual([1, 0, 0]);
  });

  it('snaps dominant X-', () => {
    expect(snapDirectionToAxis([-0.9, 0.1, 0.1])).toEqual([-1, 0, 0]);
  });

  it('snaps dominant Y', () => {
    expect(snapDirectionToAxis([0.1, 0.8, 0.3])).toEqual([0, 1, 0]);
  });

  it('snaps dominant Z', () => {
    expect(snapDirectionToAxis([0.1, 0.2, 0.9])).toEqual([0, 0, 1]);
  });

  it('handles unit axis without change', () => {
    expect(snapDirectionToAxis([1, 0, 0])).toEqual([1, 0, 0]);
    expect(snapDirectionToAxis([0, 0, -1])).toEqual([0, 0, -1]);
  });
});

// ─── computeEndpoint ─────────────────────────────────────────────────────────

describe('computeEndpoint', () => {
  it('extends along X axis', () => {
    expect(computeEndpoint([0, 0, 0], [1, 0, 0], 3000)).toEqual([3000, 0, 0]);
  });

  it('extends along Z axis', () => {
    expect(computeEndpoint([0, 0, 0], [0, 0, 1], 500)).toEqual([0, 0, 500]);
  });

  it('works from non-origin start', () => {
    const result = computeEndpoint([100, 200, 300], [0, 1, 0], 1000);
    expect(result).toEqual([100, 1200, 300]);
  });
});

// ─── checkDirectCompatibility ────────────────────────────────────────────────

describe('checkDirectCompatibility', () => {
  const p150famA = makeProduct('A', 150, 'FAM-1');
  const p150famA2 = makeProduct('B', 150, 'FAM-1');
  const p300famA = makeProduct('C', 300, 'FAM-1');
  const p150famB = makeProduct('D', 150, 'FAM-2');
  const pNoAncho = makeProduct('E', null, 'FAM-1');
  const pNoFam = makeProduct('F', 150, null);

  it('compatible when same family and same width', () => {
    const r = checkDirectCompatibility(p150famA, p150famA2);
    expect(r.ok).toBe(true);
    expect(r.needsReduction).toBe(false);
  });

  it('needs reduction when same family but different width', () => {
    const r = checkDirectCompatibility(p150famA, p300famA);
    expect(r.ok).toBe(false);
    expect(r.needsReduction).toBe(true);
  });

  it('incompatible when different family', () => {
    const r = checkDirectCompatibility(p150famA, p150famB);
    expect(r.ok).toBe(false);
    expect(r.needsReduction).toBe(false);
    expect(r.reason).toMatch(/familia/i);
  });

  it('blocks when width is null', () => {
    const r = checkDirectCompatibility(pNoAncho, p150famA);
    expect(r.ok).toBe(false);
    expect(r.needsReduction).toBe(false);
    expect(r.reason).toMatch(/ancho/i);
  });

  it('blocks when familia_id is null', () => {
    const r = checkDirectCompatibility(pNoFam, p150famA);
    expect(r.ok).toBe(false);
    expect(r.needsReduction).toBe(false);
    expect(r.reason).toMatch(/familia/i);
  });
});

// ─── findReductionCandidates ─────────────────────────────────────────────────

describe('findReductionCandidates', () => {
  const existing = makeProduct('BASE', 300, 'FAM-1', 'recta');
  const red300  = makeProduct('RED-300-150', 300, 'FAM-1', 'reducción');
  const red300b = makeProduct('RED-300-100', 300, 'FAM-1', 'reducción');
  const red150  = makeProduct('RED-150-100', 150, 'FAM-1', 'reducción');
  const redOtherFam = makeProduct('RED-OTHER', 300, 'FAM-2', 'reducción');
  const straight = makeProduct('STR', 300, 'FAM-1', 'recta');

  it('returns reductions with matching family and major ancho', () => {
    const candidates = findReductionCandidates(existing, [red300, red300b, red150, redOtherFam, straight]);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((p) => p.producto_id)).toContain('RED-300-150');
    expect(candidates.map((p) => p.producto_id)).toContain('RED-300-100');
  });

  it('excludes different family', () => {
    const candidates = findReductionCandidates(existing, [redOtherFam]);
    expect(candidates).toHaveLength(0);
  });

  it('excludes non-reduction tipos', () => {
    const candidates = findReductionCandidates(existing, [straight]);
    expect(candidates).toHaveLength(0);
  });

  it('returns empty when existing has no familia_id', () => {
    const noFam = makeProduct('X', 300, null, 'recta');
    expect(findReductionCandidates(noFam, [red300])).toHaveLength(0);
  });

  it('returns empty when existing has null ancho', () => {
    const noAncho = makeProduct('Y', null, 'FAM-1', 'recta');
    expect(findReductionCandidates(noAncho, [red300])).toHaveLength(0);
  });
});

// ─── generateConnectionId ────────────────────────────────────────────────────

describe('generateConnectionId', () => {
  it('returns CON-001 for empty set', () => {
    expect(generateConnectionId(new Set())).toBe('CON-001');
  });

  it('skips existing IDs', () => {
    expect(generateConnectionId(new Set(['CON-001', 'CON-002']))).toBe('CON-003');
  });

  it('never returns an ID in the set', () => {
    const existing = new Set(['CON-001', 'CON-002', 'CON-003']);
    expect(existing.has(generateConnectionId(existing))).toBe(false);
  });

  it('is not confused by IDs from other namespaces', () => {
    expect(generateConnectionId(new Set(['SUP-1', 'SEG-1']))).toBe('CON-001');
  });
});
