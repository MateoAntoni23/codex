/**
 * Tests for addCurvePiece.ts
 *
 * Covers E2 acceptance criteria:
 * - computeTurnPerp: left and right directions for principal axes
 * - computeCurveExitPort: 90° left, 90° right, 45° — P2 position and exit direction
 * - buildCurvePiece: port conventions, arc length, assertInput compatibility
 * - generateCurveId: unique IDs without collisions
 * - Geometric continuity: P2 of a curve connects to P1 of a following curve
 */
import { describe, it, expect } from 'vitest';
import {
  computeTurnPerp,
  computeCurveExitPort,
  buildCurvePiece,
  generateCurveId,
  type Point3,
} from '../addCurvePiece';
import { assertInput } from '../../tray/model';
import type { TrayInput } from '../../tray/model';

const EPS = 1e-9;
function near(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}
function nearVec(a: Point3, b: Point3, eps = 1e-6): void {
  expect(near(a[0], b[0], eps)).toBe(true);
  expect(near(a[1], b[1], eps)).toBe(true);
  expect(near(a[2], b[2], eps)).toBe(true);
}

// ─── computeTurnPerp ─────────────────────────────────────────────────────────

describe('computeTurnPerp', () => {
  it('left of +X is +Y', () => {
    nearVec(computeTurnPerp([1, 0, 0], 'left'), [0, 1, 0]);
  });

  it('right of +X is -Y', () => {
    nearVec(computeTurnPerp([1, 0, 0], 'right'), [0, -1, 0]);
  });

  it('left of +Y is -X', () => {
    nearVec(computeTurnPerp([0, 1, 0], 'left'), [-1, 0, 0]);
  });

  it('right of +Y is +X', () => {
    nearVec(computeTurnPerp([0, 1, 0], 'right'), [1, 0, 0]);
  });

  it('result is a unit vector', () => {
    const v = computeTurnPerp([1, 0, 0], 'left');
    expect(near(Math.hypot(v[0], v[1], v[2]), 1)).toBe(true);
  });
});

// ─── computeCurveExitPort ─────────────────────────────────────────────────────

describe('computeCurveExitPort', () => {
  const p1: Point3 = [0, 0, 0];
  const R = 300; // mm

  it('90° left from +X: P2 at R*[1,1,0], exitDir = [0,1,0]', () => {
    const entryDir: Point3 = [1, 0, 0];
    const turnPerp = computeTurnPerp(entryDir, 'left');
    const { pos, dir } = computeCurveExitPort(p1, entryDir, turnPerp, 90, R);
    nearVec(pos, [R, R, 0]);
    nearVec(dir, [0, 1, 0]);
  });

  it('90° right from +X: P2 at R*[1,-1,0], exitDir = [0,-1,0]', () => {
    const entryDir: Point3 = [1, 0, 0];
    const turnPerp = computeTurnPerp(entryDir, 'right');
    const { pos, dir } = computeCurveExitPort(p1, entryDir, turnPerp, 90, R);
    nearVec(pos, [R, -R, 0]);
    nearVec(dir, [0, -1, 0]);
  });

  it('45° left from +X: P2 at R*[sin45, 1-cos45, 0], exitDir has mag 1', () => {
    const entryDir: Point3 = [1, 0, 0];
    const turnPerp = computeTurnPerp(entryDir, 'left');
    const { pos, dir } = computeCurveExitPort(p1, entryDir, turnPerp, 45, R);
    const θ = Math.PI / 4;
    expect(near(pos[0], R * Math.sin(θ), 1e-6)).toBe(true);
    expect(near(pos[1], R * (1 - Math.cos(θ)), 1e-6)).toBe(true);
    expect(near(pos[2], 0, 1e-6)).toBe(true);
    // exit direction must be unit vector
    expect(near(Math.hypot(dir[0], dir[1], dir[2]), 1)).toBe(true);
  });

  it('45° left from +X: exitDir is sin45*[0,1,0] + cos45*[1,0,0]', () => {
    const entryDir: Point3 = [1, 0, 0];
    const turnPerp = computeTurnPerp(entryDir, 'left');
    const { dir } = computeCurveExitPort(p1, entryDir, turnPerp, 45, R);
    const s = Math.sin(Math.PI / 4);
    nearVec(dir, [s, s, 0], 1e-6);
  });

  it('P2 at non-zero p1 offset is correctly translated', () => {
    const p1off: Point3 = [1000, 500, 0];
    const entryDir: Point3 = [1, 0, 0];
    const turnPerp = computeTurnPerp(entryDir, 'left');
    const { pos } = computeCurveExitPort(p1off, entryDir, turnPerp, 90, R);
    nearVec(pos, [1000 + R, 500 + R, 0]);
  });
});

// ─── buildCurvePiece ─────────────────────────────────────────────────────────

describe('buildCurvePiece', () => {
  const p1: Point3 = [0, 0, 0];
  const R = 300;

  it('IDs and produto_id are stored', () => {
    const piece = buildCurvePiece('CRV-1', 'PROD-CRV-90', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 90, R);
    expect(piece.instancia_id).toBe('CRV-1');
    expect(piece.producto_id).toBe('PROD-CRV-90');
  });

  it('P1.direction = -entryDir (outward at entry)', () => {
    const entryDir: Point3 = [1, 0, 0];
    const piece = buildCurvePiece('CRV-1', 'P', p1, entryDir, computeTurnPerp(entryDir, 'left'), 90, R);
    nearVec(piece.puertos['P1'].direccion as Point3, [-1, 0, 0]);
  });

  it('P2.direction = exitDir for 90° left', () => {
    const entryDir: Point3 = [1, 0, 0];
    const piece = buildCurvePiece('CRV-1', 'P', p1, entryDir, computeTurnPerp(entryDir, 'left'), 90, R);
    nearVec(piece.puertos['P2'].direccion as Point3, [0, 1, 0]);
  });

  it('P2.direction = exitDir for 90° right', () => {
    const entryDir: Point3 = [1, 0, 0];
    const piece = buildCurvePiece('CRV-1', 'P', p1, entryDir, computeTurnPerp(entryDir, 'right'), 90, R);
    nearVec(piece.puertos['P2'].direccion as Point3, [0, -1, 0]);
  });

  it('longitud_eje_mm = R * PI/2 for 90°', () => {
    const piece = buildCurvePiece('CRV-1', 'P', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 90, R);
    expect(near(piece.longitud_eje_mm!, R * Math.PI / 2, 1e-6)).toBe(true);
  });

  it('longitud_eje_mm = R * PI/4 for 45°', () => {
    const piece = buildCurvePiece('CRV-1', 'P', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 45, R);
    expect(near(piece.longitud_eje_mm!, R * Math.PI / 4, 1e-6)).toBe(true);
  });

  it('no longitud_mm (straight-segment field)', () => {
    const piece = buildCurvePiece('CRV-1', 'P', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 90, R);
    expect(piece.longitud_mm).toBeUndefined();
  });

  it('P1.posicion_mm equals p1', () => {
    const piece = buildCurvePiece('CRV-1', 'P', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 90, R);
    nearVec(piece.puertos['P1'].posicion_mm as Point3, [0, 0, 0]);
  });

  it('P2.posicion_mm correct for 90° left', () => {
    const piece = buildCurvePiece('CRV-1', 'P', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 90, R);
    nearVec(piece.puertos['P2'].posicion_mm as Point3, [R, R, 0]);
  });

  it('assertInput accepts a tray with a curve piece', () => {
    const piece = buildCurvePiece('CRV-1', 'PROD-CRV', p1, [1, 0, 0], computeTurnPerp([1, 0, 0], 'left'), 90, R);
    const tray: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [piece],
      conexiones: [],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    };
    expect(() => assertInput(tray)).not.toThrow();
  });
});

// ─── Geometric continuity ─────────────────────────────────────────────────────

describe('Geometric continuity: curve P2 connects to next curve P1', () => {
  it('exit direction of first curve equals -P1.dir of second curve', () => {
    const R = 300;
    const p1: Point3 = [0, 0, 0];
    const entryDir: Point3 = [1, 0, 0];
    const tp = computeTurnPerp(entryDir, 'left');
    const piece1 = buildCurvePiece('CRV-1', 'P', p1, entryDir, tp, 90, R);

    // P2 of piece1 becomes P1 of piece2
    const p2Pos = piece1.puertos['P2'].posicion_mm as Point3;
    const exitDir = piece1.puertos['P2'].direccion as Point3;
    const tp2 = computeTurnPerp(exitDir, 'left');
    const piece2 = buildCurvePiece('CRV-2', 'P', p2Pos, exitDir, tp2, 90, R);

    // piece2.P1.direction = -exitDir of piece1
    const p1Dir2 = piece2.puertos['P1'].direccion as Point3;
    nearVec(p1Dir2, [-exitDir[0], -exitDir[1], -exitDir[2]]);
  });
});

// ─── generateCurveId ─────────────────────────────────────────────────────────

describe('generateCurveId', () => {
  it('generates CRV-1 for empty set', () => {
    expect(generateCurveId(new Set())).toBe('CRV-1');
  });

  it('skips existing IDs', () => {
    expect(generateCurveId(new Set(['CRV-1', 'CRV-2']))).toBe('CRV-3');
  });

  it('does not collide with SEG-N identifiers', () => {
    const existing = new Set(['SEG-1', 'SEG-2']);
    expect(generateCurveId(existing)).toBe('CRV-1');
  });
});
