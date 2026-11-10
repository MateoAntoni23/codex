import { describe, expect, it } from 'vitest';
import type { Piece, TrayInput } from '../../tray/model';
import {
  DEFAULT_COINCIDENCE_TOLERANCE_MM,
  findBrokenConnections,
  pieceCentroid,
  placePieceCentroid,
  removeConnections,
  translatePiece,
} from '../trayMovement';

function makeStraight(id: string, offsetX = 0): Piece {
  return {
    instancia_id: id,
    producto_id: 'SAM_TRES-300-065-18-Z',
    longitud_mm: 3000,
    puertos: {
      P1: { posicion_mm: [offsetX, 0, 100], direccion: [-1, 0, 0] },
      P2: { posicion_mm: [offsetX + 3000, 0, 100], direccion: [1, 0, 0] },
    },
  };
}

function makeEntrada(pieces: Piece[], connections: TrayInput['conexiones'] = []): TrayInput {
  return {
    version_contrato: 'trazado/1',
    piezas: pieces,
    conexiones: connections,
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '—', origen_requisito: 'test', conductores: [] },
  };
}

describe('pieceCentroid', () => {
  it('promedia posiciones de puertos', () => {
    const c = pieceCentroid(makeStraight('T-1'));
    expect(c).toEqual([1500, 0, 100]);
  });

  it('devuelve origen cuando no hay puertos', () => {
    const empty: Piece = { instancia_id: 'X', producto_id: 'Y', puertos: {} };
    expect(pieceCentroid(empty)).toEqual([0, 0, 0]);
  });
});

describe('translatePiece', () => {
  it('desplaza TODOS los puertos por el mismo delta y preserva direcciones', () => {
    const entrada = makeEntrada([makeStraight('T-1')]);
    const next = translatePiece(entrada, 'T-1', [500, -200, 50]);
    const t = next.piezas[0];
    expect(t.puertos.P1.posicion_mm).toEqual([500, -200, 150]);
    expect(t.puertos.P2.posicion_mm).toEqual([3500, -200, 150]);
    expect(t.puertos.P1.direccion).toEqual([-1, 0, 0]);
    expect(t.puertos.P2.direccion).toEqual([1, 0, 0]);
  });

  it('no muta la entrada original', () => {
    const entrada = makeEntrada([makeStraight('T-1')]);
    const snapshot = structuredClone(entrada);
    translatePiece(entrada, 'T-1', [1000, 0, 0]);
    expect(entrada).toEqual(snapshot);
  });

  it('no afecta otras piezas', () => {
    const entrada = makeEntrada([makeStraight('T-1'), makeStraight('T-2', 10000)]);
    const next = translatePiece(entrada, 'T-1', [500, 0, 0]);
    expect(next.piezas[1].puertos.P1.posicion_mm).toEqual([10000, 0, 100]);
  });

  it('es no-op cuando piezaId no existe', () => {
    const entrada = makeEntrada([makeStraight('T-1')]);
    const next = translatePiece(entrada, 'NO-EXISTE', [500, 0, 0]);
    expect(next.piezas[0].puertos.P1.posicion_mm).toEqual([0, 0, 100]);
  });
});

describe('placePieceCentroid', () => {
  it('coloca el centroide en el target desplazando todos los puertos', () => {
    const entrada = makeEntrada([makeStraight('T-1')]);
    const next = placePieceCentroid(entrada, 'T-1', [5000, 1000, 500]);
    const centroidAfter = pieceCentroid(next.piezas[0]);
    expect(centroidAfter[0]).toBeCloseTo(5000, 6);
    expect(centroidAfter[1]).toBeCloseTo(1000, 6);
    expect(centroidAfter[2]).toBeCloseTo(500, 6);
  });
});

describe('findBrokenConnections', () => {
  it('no reporta rotas cuando los puertos aún coinciden', () => {
    const t1 = makeStraight('T-1');           // P2 en (3000,0,100)
    const t2 = makeStraight('T-2', 3000);     // P1 en (3000,0,100)
    const entrada = makeEntrada([t1, t2], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
    ]);
    expect(findBrokenConnections(entrada, 'T-1')).toEqual([]);
  });

  it('reporta rotas tras trasladar una pieza más allá de la tolerancia', () => {
    const t1 = makeStraight('T-1');
    const t2 = makeStraight('T-2', 3000);
    const entrada = makeEntrada([t1, t2], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
    ]);
    const moved = translatePiece(entrada, 'T-1', [1000, 0, 0]);
    expect(findBrokenConnections(moved, 'T-1')).toEqual(['C-1']);
  });

  it('respeta la tolerancia por defecto (1 mm): delta 0.5 mm NO rompe', () => {
    const t1 = makeStraight('T-1');
    const t2 = makeStraight('T-2', 3000);
    const entrada = makeEntrada([t1, t2], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
    ]);
    const moved = translatePiece(entrada, 'T-1', [0.5, 0, 0]);
    expect(findBrokenConnections(moved, 'T-1')).toEqual([]);
  });

  it('respeta la tolerancia por defecto (1 mm): delta 2 mm SÍ rompe', () => {
    const t1 = makeStraight('T-1');
    const t2 = makeStraight('T-2', 3000);
    const entrada = makeEntrada([t1, t2], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
    ]);
    const moved = translatePiece(entrada, 'T-1', [2, 0, 0]);
    expect(findBrokenConnections(moved, 'T-1')).toEqual(['C-1']);
  });

  // Hito 2 (A-7): la tolerancia es la del motor (D-14). Una tolerancia más
  // permisiva pedida por el llamador se ignora: el frontend no puede aceptar
  // uniones que el motor rechazaría.
  it('ignora una tolerancia explícita más permisiva que D-14', () => {
    const t1 = makeStraight('T-1');
    const t2 = makeStraight('T-2', 3000);
    const entrada = makeEntrada([t1, t2], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
    ]);
    const moved = translatePiece(entrada, 'T-1', [3, 0, 0]);
    expect(findBrokenConnections(moved, 'T-1', 5)).toEqual(['C-1']);
    expect(findBrokenConnections(moved, 'T-1', 1)).toEqual(['C-1']);
  });

  it('una rotación que conserva el centro pero invierte la sección rompe la unión (giro)', () => {
    const up = { orientacion_seccion_ws: [0, 0, 1] as [number, number, number] };
    const t1 = makeStraight('T-1');
    const t2 = makeStraight('T-2', 3000);
    t1.puertos.P2 = { ...t1.puertos.P2, ...up };
    t2.puertos.P1 = { ...t2.puertos.P1, orientacion_seccion_ws: [0, 0, -1] };
    const entrada = makeEntrada([t1, t2], [{ conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] }]);
    expect(findBrokenConnections(entrada, 'T-1')).toEqual(['C-1']);
  });

  it('ignora conexiones que no involucran a la pieza movida', () => {
    const t1 = makeStraight('T-1');
    const t2 = makeStraight('T-2', 3000);
    const t3 = makeStraight('T-3', 10000);
    const entrada = makeEntrada([t1, t2, t3], [
      { conexion_id: 'C-23', a: ['T-2', 'P2'], b: ['T-3', 'P1'] },
    ]);
    const moved = translatePiece(entrada, 'T-1', [9999, 0, 0]);
    expect(findBrokenConnections(moved, 'T-1')).toEqual([]);
  });

  it('reporta como rotas las conexiones a piezas inexistentes', () => {
    const t1 = makeStraight('T-1');
    const entrada = makeEntrada([t1], [
      { conexion_id: 'C-GHOST', a: ['T-1', 'P2'], b: ['T-X', 'P1'] },
    ]);
    expect(findBrokenConnections(entrada, 'T-1')).toEqual(['C-GHOST']);
  });

  it('DEFAULT_COINCIDENCE_TOLERANCE_MM es 1', () => {
    expect(DEFAULT_COINCIDENCE_TOLERANCE_MM).toBe(1);
  });
});

describe('removeConnections', () => {
  it('filtra las conexiones listadas y conserva el resto', () => {
    const entrada = makeEntrada([makeStraight('T-1'), makeStraight('T-2', 3000)], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
      { conexion_id: 'C-2', a: ['T-1', 'P1'], b: ['T-2', 'P2'] },
    ]);
    const next = removeConnections(entrada, ['C-1']);
    expect(next.conexiones.map((c) => c.conexion_id)).toEqual(['C-2']);
  });

  it('devuelve la misma entrada cuando la lista está vacía', () => {
    const entrada = makeEntrada([makeStraight('T-1')]);
    expect(removeConnections(entrada, [])).toBe(entrada);
  });

  it('no muta la entrada original', () => {
    const entrada = makeEntrada([makeStraight('T-1'), makeStraight('T-2', 3000)], [
      { conexion_id: 'C-1', a: ['T-1', 'P2'], b: ['T-2', 'P1'] },
    ]);
    const snapshot = structuredClone(entrada);
    removeConnections(entrada, ['C-1']);
    expect(entrada).toEqual(snapshot);
  });
});
