import { describe, expect, it } from 'vitest';
import type { Piece } from '../../tray/model';
import { rotatePiece, rotatePieceAroundAxis, translatePiece, normalizeDeg, resolvePivot } from '../pieceTransforms';

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

describe('rotatePieceAroundAxis — rotación alrededor de eje arbitrario', () => {
  function makeLShape(): Piece {
    // L-shape: P1 en (0,0,100) mirando -X; P2 en (0,3000,100) mirando +Y.
    return {
      instancia_id: 'L-1',
      producto_id: 'TEST',
      puertos: {
        P1: { posicion_mm: [0, 0, 100], direccion: [-1, 0, 0] },
        P2: { posicion_mm: [0, 3000, 100], direccion: [0, 1, 0] },
      },
    };
  }

  it('rotar alrededor de eje de P1 deja P1 inmóvil (posición y dirección)', () => {
    const p = makeLShape();
    // Rotación 60° alrededor del eje de P1 (-1,0,0) pasando por (0,0,100).
    const r = rotatePieceAroundAxis(p, p.puertos.P1.direccion, 60, p.puertos.P1.posicion_mm);
    expect(r.puertos.P1.posicion_mm[0]).toBeCloseTo(0, 6);
    expect(r.puertos.P1.posicion_mm[1]).toBeCloseTo(0, 6);
    expect(r.puertos.P1.posicion_mm[2]).toBeCloseTo(100, 6);
    expect(r.puertos.P1.direccion[0]).toBeCloseTo(-1, 6);
    expect(r.puertos.P1.direccion[1]).toBeCloseTo(0, 6);
    expect(r.puertos.P1.direccion[2]).toBeCloseTo(0, 6);
  });

  it('rotar 90° alrededor de eje de P1 (-X) manda P2 de +Y a -Z', () => {
    const p = makeLShape();
    const r = rotatePieceAroundAxis(p, p.puertos.P1.direccion, 90, p.puertos.P1.posicion_mm);
    // P2 relativa al pivote: (0,3000,0). Rotada 90° alrededor de -X → Rodrigues.
    // k=(-1,0,0), v=(0,3000,0): k×v = (0,0,-3000); v·cos90 + (k×v)·sin90 = (0,0,-3000).
    // Posición absoluta: (0, 0, 100-3000) = (0, 0, -2900).
    expect(r.puertos.P2.posicion_mm[0]).toBeCloseTo(0, 3);
    expect(r.puertos.P2.posicion_mm[1]).toBeCloseTo(0, 3);
    expect(r.puertos.P2.posicion_mm[2]).toBeCloseTo(-2900, 3);
    // Dirección P2: (0,1,0) rotada 90° alrededor de (-1,0,0): k×v=(0,0,-1); v·0 + (0,0,-1)·1 = (0,0,-1).
    expect(r.puertos.P2.direccion[0]).toBeCloseTo(0, 6);
    expect(r.puertos.P2.direccion[1]).toBeCloseTo(0, 6);
    expect(r.puertos.P2.direccion[2]).toBeCloseTo(-1, 6);
  });

  it('rotar 360° alrededor de cualquier eje es identidad', () => {
    const p = makeLShape();
    const r = rotatePieceAroundAxis(p, [0.5, 0.5, 0.707], 360, [10, 20, 30]);
    for (const port of ['P1', 'P2'] as const) {
      for (let i = 0; i < 3; i++) {
        expect(r.puertos[port].posicion_mm[i]).toBeCloseTo(p.puertos[port].posicion_mm[i], 3);
        expect(r.puertos[port].direccion[i]).toBeCloseTo(p.puertos[port].direccion[i], 6);
      }
    }
  });

  it('acepta eje no unitario (lo normaliza internamente)', () => {
    const p = makeLShape();
    // Eje (−2, 0, 0) debe comportarse como (−1, 0, 0) tras normalizar.
    const r1 = rotatePieceAroundAxis(p, [-2, 0, 0], 90, [0, 0, 100]);
    const r2 = rotatePieceAroundAxis(p, [-1, 0, 0], 90, [0, 0, 100]);
    expect(r1.puertos.P2.posicion_mm[2]).toBeCloseTo(r2.puertos.P2.posicion_mm[2], 6);
  });

  it('preserva unitariedad de direcciones tras rotación con ángulo no trivial', () => {
    const p = makeLShape();
    const r = rotatePieceAroundAxis(p, [1, 1, 1], 37.5, [0, 0, 100]);
    for (const port of ['P1', 'P2'] as const) {
      const d = r.puertos[port].direccion;
      const norm = Math.hypot(d[0], d[1], d[2]);
      expect(norm).toBeCloseTo(1, 6);
    }
  });

  it('eje nulo devuelve la pieza sin cambios', () => {
    const p = makeLShape();
    const r = rotatePieceAroundAxis(p, [0, 0, 0], 90, [0, 0, 0]);
    expect(r).toBe(p);
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

  it('preserva orientacion_seccion_ws intacta tras trasladar', () => {
    const p: Piece = {
      instancia_id: 'T-up',
      producto_id: 'TEST',
      puertos: {
        P1: { posicion_mm: [0, 0, 0], direccion: [-1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
        P2: { posicion_mm: [3000, 0, 0], direccion: [1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
      },
    };
    const r = translatePiece(p, [500, -200, 100]);
    for (const name of ['P1', 'P2'] as const) {
      expect(r.puertos[name].orientacion_seccion_ws).toEqual([0, 0, 1]);
    }
  });
});

describe('orientacion_seccion_ws — transformación bajo rotación', () => {
  /**
   * Regresión #220: toda rotación de pieza DEBE transformar el vector
   * orientacion_seccion_ws coherentemente con la dirección del puerto, para
   * que el campo persistido no quede desactualizado tras mover/girar. Caso
   * crítico: rotación 90° alrededor de Z sobre una boca horizontal:
   * vDir=[0,0,1] y direccion=[1,0,0]. Tras rotar 90° en Z, direccion pasa a
   * [0,1,0] y vDir DEBE seguir siendo [0,0,1] (es perpendicular a Z, no rota).
   * Caso complementario: rotación 90° en X debe mandar vDir de [0,0,1] a
   * [0,-1,0] (siguiendo el mismo convenio de la matriz).
   */
  function makeWithVDir(): Piece {
    return {
      instancia_id: 'V-1',
      producto_id: 'TEST',
      puertos: {
        P1: { posicion_mm: [0, 0, 100], direccion: [-1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
        P2: { posicion_mm: [3000, 0, 100], direccion: [1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
      },
    };
  }

  it('rotatePiece 90° en Z deja vDir invariante y lo mantiene perpendicular a direccion', () => {
    const p = makeWithVDir();
    const r = rotatePiece(p, 'Z', 90, { kind: 'centroid' });
    for (const name of ['P1', 'P2'] as const) {
      const v = r.puertos[name].orientacion_seccion_ws!;
      expect(v[0]).toBeCloseTo(0, 6);
      expect(v[1]).toBeCloseTo(0, 6);
      expect(v[2]).toBeCloseTo(1, 6);
      const d = r.puertos[name].direccion;
      expect(Math.abs(v[0] * d[0] + v[1] * d[1] + v[2] * d[2])).toBeLessThan(1e-6);
    }
  });

  it('rotatePiece 90° en X transforma vDir de [0,0,1] a [0,-1,0]', () => {
    const p = makeWithVDir();
    const r = rotatePiece(p, 'X', 90, { kind: 'centroid' });
    const v = r.puertos.P1.orientacion_seccion_ws!;
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(-1, 6);
    expect(v[2]).toBeCloseTo(0, 6);
  });

  it('rotatePiece preserva la unitariedad de orientacion_seccion_ws bajo ángulo arbitrario', () => {
    const p = makeWithVDir();
    const r = rotatePiece(p, 'Y', 37.3, { kind: 'centroid' });
    const v = r.puertos.P1.orientacion_seccion_ws!;
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6);
  });

  it('rotatePieceAroundAxis preserva la unitariedad y aplica rodrigues al vector', () => {
    const p = makeWithVDir();
    // Rotación alrededor del eje de P1 (−X) por 90°: vDir=[0,0,1] rotado
    // alrededor de k=(−1,0,0) por 90° con Rodrigues: v·0 + (k×v)·1 + k·(k·v)·1
    // k×v = (−1,0,0)×(0,0,1) = (0·1 − 0·0, 0·0 − (−1)·1, (−1)·0 − 0·0) = (0, 1, 0).
    // Resultado: [0, 1, 0].
    const r = rotatePieceAroundAxis(p, [-1, 0, 0], 90, [0, 0, 100]);
    const v = r.puertos.P1.orientacion_seccion_ws!;
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(1, 6);
    expect(v[2]).toBeCloseTo(0, 6);
  });

  it('rotación coherente: tras rotar, vDir sigue perpendicular a direccion', () => {
    const p = makeWithVDir();
    for (const axis of ['X', 'Y', 'Z'] as const) {
      for (const angle of [37, 90, 123, -45]) {
        const r = rotatePiece(p, axis, angle, { kind: 'centroid' });
        for (const name of ['P1', 'P2'] as const) {
          const v = r.puertos[name].orientacion_seccion_ws!;
          const d = r.puertos[name].direccion;
          const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
          expect(Math.abs(dot), `axis=${axis} angle=${angle} ${name} dot=${dot}`).toBeLessThan(1e-6);
        }
      }
    }
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
