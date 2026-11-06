/**
 * pilotAdapter.ts — carga y valida pilot-geometry-reconstruction.json.
 *
 * Entrada: JSON del paquete piloto del auditor (schema_version="4"), importado
 * como módulo. Invariantes verificadas:
 *   (1) schema_version === "4" y las 4 piezas presentes (recto, curva_90, te, reduccion).
 *   (2) R_3x3 ortonormal con det=+1 (tolerancia 1e-9).
 *   (3) Todas las normales_salientes_local unitarias (tolerancia 1e-9).
 *   (4) Todas las V1..V6 PASS por pieza.
 *
 * Cualquier falla lanza error — la vista no se monta con datos corruptos.
 * No se copian coordenadas manualmente desde JSON a componentes React: todo
 * acceso pasa por los getters validados exportados aquí.
 */

import rawJson from './pilot-geometry-reconstruction.json';
import type {
  PilotReconstruction,
  Pieza,
  PiezaId,
  PiezaRecto,
  PiezaCurva,
  PiezaTe,
  PiezaReduccion,
  Mat3,
  Vec3,
} from './types';

const TOL_DET = 1e-9;
const TOL_UNIT = 1e-9;

export class PilotValidationError extends Error {
  constructor(message: string) {
    super(`[pilotAdapter] ${message}`);
    this.name = 'PilotValidationError';
  }
}

function isMat3(m: unknown): m is Mat3 {
  if (!Array.isArray(m) || m.length !== 3) return false;
  return m.every((row) => Array.isArray(row) && row.length === 3 && row.every((v) => Number.isFinite(v)));
}

function determinant(m: Mat3): number {
  const [a, b, c] = m;
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

function transposeMul(m: Mat3): Mat3 {
  // m^T · m
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = m[0][i] * m[0][j] + m[1][i] * m[1][j] + m[2][i] * m[2][j];
    }
  }
  return [
    [out[0][0], out[0][1], out[0][2]],
    [out[1][0], out[1][1], out[1][2]],
    [out[2][0], out[2][1], out[2][2]],
  ];
}

function assertOrthonormalDetPlus1(m: Mat3, where: string): void {
  if (!isMat3(m)) throw new PilotValidationError(`${where}: R_3x3 no es matriz 3x3 finita`);
  const det = determinant(m);
  if (Math.abs(det - 1) > TOL_DET) {
    throw new PilotValidationError(`${where}: det(R)=${det}, se esperaba +1 (tol=${TOL_DET})`);
  }
  const mtm = transposeMul(m);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const expected = i === j ? 1 : 0;
      if (Math.abs(mtm[i][j] - expected) > TOL_DET) {
        throw new PilotValidationError(`${where}: (R^T·R)[${i}][${j}]=${mtm[i][j]}, se esperaba ${expected}`);
      }
    }
  }
}

function assertUnit(v: Vec3, where: string): void {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isFinite(x))) {
    throw new PilotValidationError(`${where}: normal no es Vec3 finito`);
  }
  const n = Math.hypot(v[0], v[1], v[2]);
  if (Math.abs(n - 1) > TOL_UNIT) {
    throw new PilotValidationError(`${where}: |normal|=${n}, se esperaba 1 (tol=${TOL_UNIT})`);
  }
}

function assertAllValidationsPass(pieza: Pieza, pieceName: string): void {
  const v = pieza.validaciones;
  const keys: Array<keyof typeof v> = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  for (const k of keys) {
    if (v[k] !== true) {
      throw new PilotValidationError(`${pieceName}: validación ${k} no está PASS`);
    }
  }
}

function validateBocas(pieza: Pieza, pieceName: string): void {
  const bocas = pieza.bocas as Record<string, { normal_saliente_local: unknown }>;
  for (const pKey of Object.keys(bocas)) {
    const n = bocas[pKey].normal_saliente_local;
    assertUnit(n as Vec3, `${pieceName}.bocas.${pKey}.normal_saliente_local`);
  }
}

function validate(data: unknown): PilotReconstruction {
  const d = data as PilotReconstruction;
  if (d.schema_version !== '4') {
    throw new PilotValidationError(`schema_version="${d.schema_version}", se esperaba "4"`);
  }
  const requiredPieces: PiezaId[] = ['recto', 'curva_90', 'te', 'reduccion'];
  for (const p of requiredPieces) {
    if (!d.piezas || !(p in d.piezas)) {
      throw new PilotValidationError(`falta la pieza "${p}" en piezas{}`);
    }
  }
  for (const p of requiredPieces) {
    const pieza = d.piezas[p];
    assertOrthonormalDetPlus1(pieza.marco_local.R_3x3, `${p}.marco_local.R_3x3`);
    validateBocas(pieza, p);
    assertAllValidationsPass(pieza, p);
  }
  return d;
}

const DATA: PilotReconstruction = validate(rawJson);

export function getPilotData(): PilotReconstruction {
  return DATA;
}

export function getRecto(): PiezaRecto {
  return DATA.piezas.recto;
}
export function getCurva(): PiezaCurva {
  return DATA.piezas.curva_90;
}
export function getTe(): PiezaTe {
  return DATA.piezas.te;
}
export function getReduccion(): PiezaReduccion {
  return DATA.piezas.reduccion;
}

export const PILOT_PIECE_IDS: PiezaId[] = ['recto', 'curva_90', 'te', 'reduccion'];

/** Exportados para tests — no usar en componentes de producción. */
export const __internal = { validate, determinant, transposeMul };
