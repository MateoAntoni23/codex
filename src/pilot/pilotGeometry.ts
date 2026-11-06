/**
 * pilotGeometry.ts — geometría para la vista de prueba del piloto.
 *
 * Convenciones:
 *   - Local de pieza: mm, Z-up. X_local longitudinal, Y_local transversal,
 *     Z_local altura.
 *   - Mundo de vista: mm, Z-up. Cada pieza recibe una `placement` opcional
 *     (translación en mm + rotación alrededor de Z_mundo en radianes) para
 *     poder girarla/moverla en la vista de prueba sin tocar los datos.
 *   - Visor three.js: metros, Y-up. Conversión mm Z-up → m Y-up usada en todo
 *     el proyecto: (x,y,z) → (x/1000, z/1000, -y/1000).
 *
 * El eje Z_local de la pieza coincide con Z_mundo; por eso basta una rotación
 * plana (alrededor de Z) para transformar local → mundo. Esto cubre giros 0°,
 * 90°, 180° y 270° que los auditores solicitan probar.
 */

import type { Vec3 } from './types';

export interface Placement {
  /** Traslación en mm aplicada después de rotar en torno a Z_mundo. */
  readonly offsetMm: Vec3;
  /** Rotación alrededor del eje Z_mundo, en radianes. */
  readonly yawRad: number;
}

export const IDENTITY_PLACEMENT: Placement = {
  offsetMm: [0, 0, 0],
  yawRad: 0,
};

/** Rota un Vec3 alrededor del eje Z por `yaw` radianes (sentido antihorario). */
export function rotZ(p: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
}

/** Aplica placement: primero rotación en Z, luego traslación. */
export function applyPlacement(pLocalMm: Vec3, pm: Placement): Vec3 {
  const r = rotZ(pLocalMm, pm.yawRad);
  return [r[0] + pm.offsetMm[0], r[1] + pm.offsetMm[1], r[2] + pm.offsetMm[2]];
}

/** Rota un vector direccional (sin trasladar) por el yaw del placement. */
export function rotateDirByPlacement(dir: Vec3, pm: Placement): Vec3 {
  return rotZ(dir, pm.yawRad);
}

/** Convierte un punto en mm Z-up a coordenadas del visor (m, Y-up). */
export function worldMmToViewer(p: Vec3): readonly [number, number, number] {
  return [p[0] / 1000, p[2] / 1000, -(p[1] / 1000)];
}

/** Convierte un vector direccional mm Z-up a dirección visor Y-up (no normaliza). */
export function worldDirToViewer(d: Vec3): readonly [number, number, number] {
  return [d[0], d[2], -d[1]];
}

/**
 * Posiciones de travesaños (rungs) para una escalera recta a lo largo de X_local.
 *
 * Reparte `countInterior` travesaños uniformemente en (margin, length - margin)
 * y añade uno en cada extremo. La convención "sin fondo" se respeta en el
 * renderer: aquí solo devolvemos las posiciones X; no describimos la cara base.
 */
export function rungPositions(lengthMm: number, countInterior: number, marginMm: number): number[] {
  if (lengthMm <= 2 * marginMm) return [0, lengthMm];
  const xs: number[] = [marginMm];
  if (countInterior > 0) {
    const span = lengthMm - 2 * marginMm;
    const step = span / (countInterior + 1);
    for (let i = 1; i <= countInterior; i++) xs.push(marginMm + i * step);
  }
  xs.push(lengthMm - marginMm);
  return xs;
}

/**
 * Yaws disponibles para probar giro. 0°, 90°, 180°, 270° cubren los casos
 * que deben mantener coherencia modelo-puerto.
 */
export const YAW_STEPS_RAD = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] as const;

export function wrapYaw(rad: number): number {
  const twoPi = 2 * Math.PI;
  const r = rad % twoPi;
  return r < 0 ? r + twoPi : r;
}
