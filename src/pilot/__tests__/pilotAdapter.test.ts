/**
 * Pruebas del adaptador: la carga válida pasa; detecta R con det≠1 y normal no unitaria.
 * No relaja las tolerancias — el objetivo es que la UI no monte datos corruptos.
 */

import { describe, expect, it } from 'vitest';
import {
  getPilotData,
  getRecto,
  getCurva,
  getTe,
  getReduccion,
  PILOT_PIECE_IDS,
  PilotValidationError,
  __internal,
} from '../pilotAdapter';
import type { Mat3, Vec3 } from '../types';

describe('pilotAdapter (carga válida)', () => {
  it('carga las 4 piezas y schema_version=4', () => {
    const d = getPilotData();
    expect(d.schema_version).toBe('4');
    expect(Object.keys(d.piezas).sort()).toEqual(['curva_90', 'recto', 'reduccion', 'te']);
  });

  it('todas las piezas tienen V1..V6 PASS', () => {
    const d = getPilotData();
    for (const id of PILOT_PIECE_IDS) {
      const v = d.piezas[id].validaciones;
      for (const k of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const) {
        expect(v[k]).toBe(true);
      }
    }
  });

  it('R de cada pieza es ortonormal con det=+1 (tol 1e-9)', () => {
    const d = getPilotData();
    for (const id of PILOT_PIECE_IDS) {
      const R = d.piezas[id].marco_local.R_3x3;
      expect(Math.abs(__internal.determinant(R) - 1)).toBeLessThan(1e-9);
    }
  });

  it('todas las normales_salientes_local son unitarias (tol 1e-9)', () => {
    const d = getPilotData();
    for (const id of PILOT_PIECE_IDS) {
      const bocas = d.piezas[id].bocas as Record<string, { normal_saliente_local: Vec3 }>;
      for (const k of Object.keys(bocas)) {
        const n = bocas[k].normal_saliente_local;
        const mag = Math.hypot(n[0], n[1], n[2]);
        expect(Math.abs(mag - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('exporta cada pieza con su tipo correcto', () => {
    expect(getRecto().tipo).toBe('recto');
    expect(getCurva().tipo).toBe('curva');
    expect(getTe().tipo).toBe('te');
    expect(getReduccion().tipo).toBe('reduccion');
  });

  it('la curva declara su geometría provisional explícita', () => {
    const c = getCurva();
    expect(c.geometria_curva_provisional.estado.toLowerCase()).toMatch(/provisional/);
    expect(c.recorrido_central_local.estado.toLowerCase()).toMatch(/provisional/);
  });
});

describe('pilotAdapter (detección de datos corruptos)', () => {
  it('rechaza R no ortonormal', () => {
    const base = getPilotData();
    const badR: Mat3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 2], // det=2
    ];
    const corrupted = {
      ...base,
      piezas: {
        ...base.piezas,
        recto: {
          ...base.piezas.recto,
          marco_local: { ...base.piezas.recto.marco_local, R_3x3: badR },
        },
      },
    };
    expect(() => __internal.validate(corrupted)).toThrowError(PilotValidationError);
  });

  it('rechaza normal no unitaria', () => {
    const base = getPilotData();
    const corrupted = {
      ...base,
      piezas: {
        ...base.piezas,
        te: {
          ...base.piezas.te,
          bocas: {
            ...base.piezas.te.bocas,
            P1: {
              ...base.piezas.te.bocas.P1,
              normal_saliente_local: [2, 0, 0] as Vec3,
            },
          },
        },
      },
    };
    expect(() => __internal.validate(corrupted)).toThrowError(PilotValidationError);
  });

  it('rechaza schema_version distinto a "4"', () => {
    const base = getPilotData();
    expect(() => __internal.validate({ ...base, schema_version: '3' })).toThrowError(
      PilotValidationError,
    );
  });

  it('rechaza validación Vx en false', () => {
    const base = getPilotData();
    const corrupted = {
      ...base,
      piezas: {
        ...base.piezas,
        reduccion: {
          ...base.piezas.reduccion,
          validaciones: { ...base.piezas.reduccion.validaciones, V2: false },
        },
      },
    };
    expect(() => __internal.validate(corrupted)).toThrowError(PilotValidationError);
  });
});
