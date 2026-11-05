import { describe, it, expect } from 'vitest';
import { validateSupportInput, generateSupportId, buildSupport, pieceLength } from '../addSupport';
import type { Piece } from '../../tray/model';

// ─── pieceLength ──────────────────────────────────────────────────────────────

describe('pieceLength', () => {
  const makePiece = (p1: [number,number,number], p2: [number,number,number]): Piece => ({
    instancia_id: 'R1', producto_id: 'P', longitud_mm: 0,
    puertos: {
      P1: { posicion_mm: p1, direccion: [-1, 0, 0] },
      P2: { posicion_mm: p2, direccion: [1, 0, 0] },
    },
  });

  it('computes length along X', () => {
    expect(pieceLength(makePiece([0,0,0], [3000,0,0]))).toBeCloseTo(3000, 5);
  });

  it('computes length for a diagonal piece', () => {
    expect(pieceLength(makePiece([0,0,0], [1000,1000,0]))).toBeCloseTo(Math.sqrt(2)*1000, 3);
  });

  it('returns 0 when ports are missing', () => {
    const piece: Piece = { instancia_id: 'X', producto_id: 'P', puertos: {} };
    expect(pieceLength(piece)).toBe(0);
  });
});

// ─── validateSupportInput ─────────────────────────────────────────────────────

describe('validateSupportInput', () => {
  const ok = (distancia = 750, len = 3000) =>
    validateSupportInput('R1', 'PRD-001', 'SIS-001', distancia, len);

  it('returns null for valid inputs', () => {
    expect(ok()).toBeNull();
  });

  it('rejects empty instanciaId', () => {
    expect(validateSupportInput('', 'P', 'SIS-001', 750, 3000)).not.toBeNull();
  });

  it('rejects empty productoId', () => {
    expect(validateSupportInput('R1', '', 'SIS-001', 750, 3000)).not.toBeNull();
  });

  it('rejects blank sistemaSoporteId', () => {
    expect(validateSupportInput('R1', 'P', '   ', 750, 3000)).not.toBeNull();
  });

  it('rejects non-finite distancia', () => {
    expect(ok(NaN)).not.toBeNull();
    expect(ok(Infinity)).not.toBeNull();
  });

  it('rejects negative distancia', () => {
    expect(ok(-1)).not.toBeNull();
    expect(ok(-0.001)).not.toBeNull();
  });

  it('rejects distancia exceeding piece length', () => {
    expect(validateSupportInput('R1', 'P', 'SIS-001', 3001, 3000)).not.toBeNull();
  });

  it('accepts distancia exactly equal to piece length', () => {
    expect(validateSupportInput('R1', 'P', 'SIS-001', 3000, 3000)).toBeNull();
  });

  it('accepts distancia = 0', () => {
    expect(ok(0)).toBeNull();
  });

  it('skips length check when piezaLen is 0 (unknown length)', () => {
    expect(validateSupportInput('R1', 'P', 'SIS-001', 99999, 0)).toBeNull();
  });
});

// ─── generateSupportId ────────────────────────────────────────────────────────

describe('generateSupportId', () => {
  it('returns SUP-1 for empty set', () => {
    expect(generateSupportId(new Set())).toBe('SUP-1');
  });

  it('skips existing IDs', () => {
    expect(generateSupportId(new Set(['SUP-1', 'SUP-2']))).toBe('SUP-3');
  });

  it('never returns an ID in the set', () => {
    const existing = new Set(['SUP-1', 'SUP-2', 'SUP-3']);
    expect(existing.has(generateSupportId(existing))).toBe(false);
  });

  it('is not confused by IDs from other namespaces', () => {
    expect(generateSupportId(new Set(['SEG-1', 'S1', 'S2']))).toBe('SUP-1');
  });
});

// ─── buildSupport ─────────────────────────────────────────────────────────────

describe('buildSupport', () => {
  const s = buildSupport('SUP-1', 'R1', 'SAM_STS-300-Z', 'SIS-001', 750);

  it('sets all fields', () => {
    expect(s.soporte_id).toBe('SUP-1');
    expect(s.instancia_id).toBe('R1');
    expect(s.producto_id).toBe('SAM_STS-300-Z');
    expect(s.sistema_soporte_id).toBe('SIS-001');
    expect(s.distancia_desde_P1_mm).toBe(750);
  });

  it('round-trips through JSON without loss', () => {
    const restored = JSON.parse(JSON.stringify(s));
    expect(restored).toEqual(s);
  });
});
