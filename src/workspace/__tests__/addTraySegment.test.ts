import { describe, it, expect } from 'vitest';
import { validateSegmentInput, generateSegmentId, buildSegmentPiece, type Point3 } from '../addTraySegment';
import { assertInput } from '../../tray/model';
import type { TrayInput } from '../../tray/model';

// ─── validateSegmentInput ─────────────────────────────────────────────────────

describe('validateSegmentInput', () => {
  it('returns null for valid coordinates', () => {
    expect(validateSegmentInput([0, 0, 0], [3000, 0, 0])).toBeNull();
    expect(validateSegmentInput([100, 200, 300], [400, 500, 600])).toBeNull();
    expect(validateSegmentInput([0, 0, 0], [0, 0, 1000])).toBeNull(); // vertical run
  });

  it('rejects NaN in P1', () => {
    expect(validateSegmentInput([NaN, 0, 0], [3000, 0, 0])).not.toBeNull();
  });

  it('rejects NaN in P2', () => {
    expect(validateSegmentInput([0, 0, 0], [3000, NaN, 0])).not.toBeNull();
  });

  it('rejects Infinity', () => {
    expect(validateSegmentInput([Infinity, 0, 0], [0, 0, 0])).not.toBeNull();
    expect(validateSegmentInput([0, 0, 0], [0, -Infinity, 0])).not.toBeNull();
  });

  it('rejects coincident points (dist = 0)', () => {
    expect(validateSegmentInput([0, 0, 0], [0, 0, 0])).not.toBeNull();
    expect(validateSegmentInput([1234, 5678, 90], [1234, 5678, 90])).not.toBeNull();
  });

  it('rejects nearly-coincident points (dist < 1 mm)', () => {
    expect(validateSegmentInput([0, 0, 0], [0.5, 0, 0])).not.toBeNull();
    expect(validateSegmentInput([0, 0, 0], [0, 0, 0.9])).not.toBeNull();
  });

  it('accepts exactly 1 mm apart', () => {
    expect(validateSegmentInput([0, 0, 0], [1, 0, 0])).toBeNull();
  });
});

// ─── generateSegmentId ────────────────────────────────────────────────────────

describe('generateSegmentId', () => {
  it('returns SEG-1 for empty set', () => {
    expect(generateSegmentId(new Set())).toBe('SEG-1');
  });

  it('skips existing IDs sequentially', () => {
    expect(generateSegmentId(new Set(['SEG-1']))).toBe('SEG-2');
    expect(generateSegmentId(new Set(['SEG-1', 'SEG-2', 'SEG-3']))).toBe('SEG-4');
  });

  it('skips non-contiguous gaps', () => {
    expect(generateSegmentId(new Set(['SEG-1', 'SEG-3']))).toBe('SEG-2');
  });

  it('never returns an ID already in the set', () => {
    const existing = new Set(['SEG-1', 'SEG-2', 'SEG-3', 'SEG-4', 'SEG-5']);
    const id = generateSegmentId(existing);
    expect(existing.has(id)).toBe(false);
  });

  it('is not confused by IDs from other namespaces', () => {
    // Existing IDs with different formats should not affect SEG-N sequence
    const existing = new Set(['R1', 'R2', 'CON-ABC']);
    expect(generateSegmentId(existing)).toBe('SEG-1');
  });
});

// ─── buildSegmentPiece ────────────────────────────────────────────────────────

const P1_AXIS_X: Point3 = [0, 0, 0];
const P2_AXIS_X: Point3 = [3000, 0, 0];

describe('buildSegmentPiece — basic fields', () => {
  const piece = buildSegmentPiece('SEG-1', 'PRY-BDJ-001', P1_AXIS_X, P2_AXIS_X);

  it('sets instancia_id and producto_id', () => {
    expect(piece.instancia_id).toBe('SEG-1');
    expect(piece.producto_id).toBe('PRY-BDJ-001');
  });

  it('longitud_mm equals Euclidean distance between P1 and P2', () => {
    expect(piece.longitud_mm).toBeCloseTo(3000, 5);
  });

  it('port P1 position matches input', () => {
    expect(piece.puertos.P1.posicion_mm).toEqual([0, 0, 0]);
  });

  it('port P2 position matches input', () => {
    expect(piece.puertos.P2.posicion_mm).toEqual([3000, 0, 0]);
  });

  it('port P1 and P2 are present', () => {
    expect('P1' in piece.puertos).toBe(true);
    expect('P2' in piece.puertos).toBe(true);
  });
});

describe('buildSegmentPiece — direction unit vectors', () => {
  const mag = (d: number[]) => Math.hypot(...d);

  it('P1 direction has magnitude 1', () => {
    const piece = buildSegmentPiece('SEG-1', 'P', P1_AXIS_X, P2_AXIS_X);
    expect(mag(piece.puertos.P1.direccion)).toBeCloseTo(1, 6);
  });

  it('P2 direction has magnitude 1', () => {
    const piece = buildSegmentPiece('SEG-1', 'P', P1_AXIS_X, P2_AXIS_X);
    expect(mag(piece.puertos.P2.direccion)).toBeCloseTo(1, 6);
  });

  it('directions are antiparallel (opposite signs)', () => {
    const piece = buildSegmentPiece('SEG-1', 'P', P1_AXIS_X, P2_AXIS_X);
    const d1 = piece.puertos.P1.direccion;
    const d2 = piece.puertos.P2.direccion;
    for (let i = 0; i < 3; i++) {
      expect(d1[i] + d2[i]).toBeCloseTo(0, 6);
    }
  });

  it('P1 direction points away from P2 (outward)', () => {
    const piece = buildSegmentPiece('SEG-1', 'P', P1_AXIS_X, P2_AXIS_X);
    expect(piece.puertos.P1.direccion[0]).toBeCloseTo(-1, 5); // ← away from P2
  });

  it('P2 direction points away from P1 (outward)', () => {
    const piece = buildSegmentPiece('SEG-1', 'P', P1_AXIS_X, P2_AXIS_X);
    expect(piece.puertos.P2.direccion[0]).toBeCloseTo(1, 5); // → away from P1
  });

  it('diagonal piece has unit-length directions', () => {
    const piece = buildSegmentPiece('SEG-2', 'P', [0, 0, 0], [1000, 1000, 0]);
    expect(mag(piece.puertos.P1.direccion)).toBeCloseTo(1, 6);
    expect(mag(piece.puertos.P2.direccion)).toBeCloseTo(1, 6);
  });

  it('vertical piece has unit-length directions', () => {
    const piece = buildSegmentPiece('SEG-3', 'P', [0, 0, 0], [0, 0, 2000]);
    expect(mag(piece.puertos.P1.direccion)).toBeCloseTo(1, 6);
    expect(mag(piece.puertos.P2.direccion)).toBeCloseTo(1, 6);
  });
});

describe('buildSegmentPiece — assertInput compatibility', () => {
  const makeInput = (piece: ReturnType<typeof buildSegmentPiece>): TrayInput => ({
    version_contrato: 'trazado/1',
    piezas: [piece],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 16, cable_id: 'PRY-SVALIO-CU-1x35', origen_requisito: 'TEST', conductores: [] },
  });

  it('axis-X piece passes assertInput', () => {
    const piece = buildSegmentPiece('SEG-1', 'PRY-BDJ-001', P1_AXIS_X, P2_AXIS_X);
    expect(() => assertInput(makeInput(piece))).not.toThrow();
  });

  it('diagonal piece passes assertInput', () => {
    const piece = buildSegmentPiece('SEG-1', 'PRY-BDJ-001', [0, 0, 0], [1000, 1000, 0]);
    expect(() => assertInput(makeInput(piece))).not.toThrow();
  });

  it('vertical piece passes assertInput', () => {
    const piece = buildSegmentPiece('SEG-1', 'PRY-BDJ-001', [0, 0, 500], [0, 0, 3500]);
    expect(() => assertInput(makeInput(piece))).not.toThrow();
  });

  it('two pieces with unique IDs pass assertInput together', () => {
    const a = buildSegmentPiece('SEG-1', 'P1', [0, 0, 0], [3000, 0, 0]);
    const b = buildSegmentPiece('SEG-2', 'P1', [3000, 0, 0], [6000, 0, 0]);
    expect(() => assertInput({ ...makeInput(a), piezas: [a, b] })).not.toThrow();
  });
});
