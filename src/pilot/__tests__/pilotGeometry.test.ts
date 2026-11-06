/**
 * Pruebas geométricas: placement se compone correctamente; las bocas acompañan
 * al modelo cuando la pieza gira o se traslada; mm Z-up → m Y-up es consistente.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPlacement,
  rotateDirByPlacement,
  rotZ,
  worldDirToViewer,
  worldMmToViewer,
  wrapYaw,
  rungPositions,
  IDENTITY_PLACEMENT,
} from '../pilotGeometry';
import type { Placement } from '../pilotGeometry';
import { getRecto, getTe } from '../pilotAdapter';
import type { Vec3 } from '../types';

const TOL = 1e-9;

function approxEq(a: Vec3 | readonly [number, number, number], b: Vec3 | readonly [number, number, number], tol = TOL) {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(tol);
}

describe('rotZ', () => {
  it('rota 90° antihorario: (1,0,0) → (0,1,0)', () => {
    approxEq(rotZ([1, 0, 0], Math.PI / 2), [0, 1, 0]);
  });
  it('rota 180°: (1,2,3) → (-1,-2,3)', () => {
    approxEq(rotZ([1, 2, 3], Math.PI), [-1, -2, 3]);
  });
});

describe('applyPlacement', () => {
  it('identidad preserva el punto', () => {
    approxEq(applyPlacement([5, -3, 2], IDENTITY_PLACEMENT), [5, -3, 2]);
  });
  it('yaw 90° + offset se componen en el orden rotación→traslación', () => {
    const pm: Placement = { yawRad: Math.PI / 2, offsetMm: [100, 0, 0] };
    // (1,0,0) rotado 90° → (0,1,0) + (100,0,0) → (100,1,0)
    approxEq(applyPlacement([1, 0, 0], pm), [100, 1, 0]);
  });
});

describe('boca sigue a la pieza bajo placement', () => {
  const recto = getRecto();
  const p2Local = recto.bocas.P2.center_local as Vec3;
  const nP1Local = recto.bocas.P1.normal_saliente_local as Vec3;

  it('traslación: P2 queda en (P2_local + offset) y normal P1 queda igual (dirección)', () => {
    const pm: Placement = { yawRad: 0, offsetMm: [1000, 500, 0] };
    const p2 = applyPlacement(p2Local, pm);
    approxEq(p2, [p2Local[0] + 1000, p2Local[1] + 500, p2Local[2]]);
    const nP1 = rotateDirByPlacement(nP1Local, pm);
    approxEq(nP1, nP1Local);
  });

  it('yaw 90° rota los centros y las normales de forma consistente', () => {
    const pm: Placement = { yawRad: Math.PI / 2, offsetMm: [0, 0, 0] };
    const p2 = applyPlacement(p2Local, pm);
    // (x,y,z) → (-y, x, z)
    approxEq(p2, [-p2Local[1], p2Local[0], p2Local[2]]);
    // Normal P1 local ~ (-1,0,0). Rotada 90° → (0,-1,0)
    const nP1 = rotateDirByPlacement(nP1Local, pm);
    expect(Math.hypot(nP1[0], nP1[1], nP1[2])).toBeCloseTo(1, 10);
    approxEq(nP1, [-nP1Local[1], nP1Local[0], nP1Local[2]], 1e-12);
  });

  it('T: las tres bocas se mantienen coplanares (Z=0) tras rotar y trasladar', () => {
    const te = getTe();
    const pm: Placement = { yawRad: Math.PI, offsetMm: [1234, -500, 0] };
    for (const k of ['P1', 'P2', 'P3'] as const) {
      const c = (te.bocas[k].center_local as Vec3);
      const w = applyPlacement(c, pm);
      expect(Math.abs(w[2])).toBeLessThan(1e-9);
    }
  });
});

describe('conversiones de visor', () => {
  it('mm Z-up → m Y-up: (1000, 2000, 500) → (1, 0.5, -2)', () => {
    approxEq(worldMmToViewer([1000, 2000, 500]), [1, 0.5, -2]);
  });
  it('dir Z-up → Y-up conserva magnitud', () => {
    const d = worldDirToViewer([3, 4, 0]);
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(5, 10);
  });
});

describe('utilidades', () => {
  it('wrapYaw devuelve [0, 2π)', () => {
    expect(wrapYaw(0)).toBeCloseTo(0);
    expect(wrapYaw(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10);
    expect(wrapYaw(5 * Math.PI)).toBeCloseTo(Math.PI, 10);
  });
  it('rungPositions coloca travesaños en extremos y reparte interiores', () => {
    const xs = rungPositions(3000, 11, 50);
    expect(xs[0]).toBe(50);
    expect(xs[xs.length - 1]).toBe(2950);
    expect(xs.length).toBe(13);
  });
});
