import { describe, expect, it } from 'vitest';
import type { Piece } from '../../tray/model';
import { rotatePiece, translatePiece, normalizeDeg, resolvePivot } from '../pieceTransforms';

function makeStraight(): Piece {
  return {
    instancia_id: 'T-1',
    producto_id: 'SAM_TRES-300-065-18-Z',
    longitud_mm: 3000,
    puertos: {
      P1: { posicion_mm: [0, 0, 100], direccion: [-1, 0, 0] },
      P2: { posicion_mm: [3000, 0, 100], direccion: [1, 0, 0] },
    },
  };
}

describe('rotatePiece', () => {
  it('rota 90° sobre Z con pivote en centroide mueve P1 y P2 sobre el eje Y', () => {
    const p = makeStraight();
    const r = rotatePiece(p, 'Z', 90, { kind: 'centroid' });
    // El centroide está en (1500, 0, 100); tras 90° sobre Z, P1 pasa a
    // (1500, -1500, 100) y P2 a (1500, 1500, 100).
    expect(r.puertos.P1.posicion_mm[0]).toBeCloseTo(1500, 3);
    expect(r.puertos.P1.posicion_mm[1]).toBeCloseTo(-1500, 3);
    expect(r.puertos.P1.posicion_mm[2]).toBeCloseTo(100, 3);
    expect(r.puertos.P2.posicion_mm[0]).toBeCloseTo(1500, 3);
    expect(r.puertos.P2.posicion_mm[1]).toBeCloseTo(1500, 3);
    expect(r.puertos.P2.posicion_mm[2]).toBeCloseTo(100, 3);
    // Direcciones también rotan: -X → -Y, +X → +Y
    expect(r.puertos.P1.direccion[1]).toBeCloseTo(-1, 3);
    expect(r.puertos.P2.direccion[1]).toBeCloseTo(1, 3);
  });

  it('rota con pivote en P1 deja P1 inmóvil', () => {
    const p = makeStraight();
    const r = rotatePiece(p, 'Z', 90, { kind: 'port', name: 'P1' });
    expect(r.puertos.P1.posicion_mm[0]).toBeCloseTo(0, 3);
    expect(r.puertos.P1.posicion_mm[1]).toBeCloseTo(0, 3);
    expect(r.puertos.P2.posicion_mm[0]).toBeCloseTo(0, 3);
    expect(r.puertos.P2.posicion_mm[1]).toBeCloseTo(3000, 3);
  });

  it('rota 360° deja la pieza invariante dentro de tolerancia numérica', () => {
    const p = makeStraight();
    const r = rotatePiece(p, 'Z', 360, { kind: 'centroid' });
    for (const port of ['P1', 'P2'] as const) {
      expect(r.puertos[port].posicion_mm[0]).toBeCloseTo(p.puertos[port].posicion_mm[0], 6);
      expect(r.puertos[port].posicion_mm[1]).toBeCloseTo(p.puertos[port].posicion_mm[1], 6);
      expect(r.puertos[port].direccion[0]).toBeCloseTo(p.puertos[port].direccion[0], 6);
    }
  });

  it('preserva la unitariedad de la dirección', () => {
    const p = makeStraight();
    const r = rotatePiece(p, 'Z', 37.3, { kind: 'centroid' });
    const d = r.puertos.P1.direccion;
    const norm = Math.hypot(d[0], d[1], d[2]);
    expect(norm).toBeCloseTo(1, 6);
  });

  it('rota 90° sobre Y intercambia componentes X y Z', () => {
    const p = makeStraight();
    // P1 está en (0,0,100), P2 en (3000,0,100). Pivot en P1.
    // Rotación +90° alrededor de Y envía (x,y,z) → (z, y, -x). P2 relativa al
    // pivote es (3000, 0, 0), tras rotar queda (0, 0, -3000); sumando pivote
    // (0,0,100) → (0, 0, -2900).
    const r = rotatePiece(p, 'Y', 90, { kind: 'port', name: 'P1' });
    expect(r.puertos.P2.posicion_mm[0]).toBeCloseTo(0, 3);
    expect(r.puertos.P2.posicion_mm[2]).toBeCloseTo(-2900, 3);
  });

  it('resolvePivot centroide promedia posiciones de puertos', () => {
    const p = makeStraight();
    const pv = resolvePivot(p, { kind: 'centroid' });
    expect(pv).not.toBeNull();
    expect(pv![0]).toBeCloseTo(1500, 3);
    expect(pv![2]).toBeCloseTo(100, 3);
  });
});

describe('translatePiece', () => {
  it('translada ambos puertos sin cambiar direcciones', () => {
    const p = makeStraight();
    const r = translatePiece(p, [100, 200, 300]);
    expect(r.puertos.P1.posicion_mm).toEqual([100, 200, 400]);
    expect(r.puertos.P2.posicion_mm).toEqual([3100, 200, 400]);
    expect(r.puertos.P1.direccion).toEqual([-1, 0, 0]);
  });
});

describe('normalizeDeg', () => {
  it('reduce ángulos fuera de rango', () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(-270)).toBe(90);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(-181)).toBeCloseTo(179, 3);
  });
});
