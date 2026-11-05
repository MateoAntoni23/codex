/**
 * previewEditor.ts — Funciones puras para el editor de equipos de la vista de prueba.
 *
 * Separadas del componente para poder probarse sin React.
 * No importa stores ni IndexedDB.
 */

import type { Vec3, Quaternion, EquipmentElement } from '../types/domain-v2';

// ─── Tipos de borrador ────────────────────────────────────────────────────────

export interface PositionDraft { x: string; y: string; z: string }
export type PositionErrors = Partial<Record<'x' | 'y' | 'z', string>>;

export interface BoxSizeDraft { width: string; depth: string; height: string }
export type BoxSizeErrors = Partial<Record<'width' | 'depth' | 'height', string>>;

export interface CylinderSizeDraft { diameter: string; length: string }
export type CylinderSizeErrors = Partial<Record<'diameter' | 'length', string>>;

// ─── Helpers de parseo ────────────────────────────────────────────────────────

function parseFinite(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parsePositive(raw: string): number | null {
  const n = parseFinite(raw);
  return n != null && n > 0 ? n : null;
}

function dimError(raw: string): string {
  return raw.trim() === '' ? 'El campo no puede estar vacío' : 'Debe ser un número positivo';
}

function posError(raw: string): string {
  return raw.trim() === '' ? 'El campo no puede estar vacío' : 'Ingresá un número válido';
}

// ─── Validación ───────────────────────────────────────────────────────────────

export function parseName(
  name: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'El nombre no puede estar vacío' };
  return { ok: true, value: trimmed };
}

type ParsePosResult =
  | { ok: true; value: { x: number; y: number; z: number } }
  | { ok: false; errors: PositionErrors };

export function parsePositionDraft(d: PositionDraft): ParsePosResult {
  const errors: PositionErrors = {};
  const value = { x: 0, y: 0, z: 0 };
  for (const axis of ['x', 'y', 'z'] as const) {
    const n = parseFinite(d[axis]);
    if (n == null) errors[axis] = posError(d[axis]);
    else value[axis] = n;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

type ParseBoxResult =
  | { ok: true; value: { width: number; depth: number; height: number } }
  | { ok: false; errors: BoxSizeErrors };

export function parseBoxSizeDraft(d: BoxSizeDraft): ParseBoxResult {
  const errors: BoxSizeErrors = {};
  const value = { width: 0, depth: 0, height: 0 };
  for (const [k, raw] of [['width', d.width], ['depth', d.depth], ['height', d.height]] as const) {
    const n = parsePositive(raw);
    if (n == null) errors[k] = dimError(raw);
    else value[k] = n;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

type ParseCylResult =
  | { ok: true; value: { diameter: number; length: number } }
  | { ok: false; errors: CylinderSizeErrors };

export function parseCylinderSizeDraft(d: CylinderSizeDraft): ParseCylResult {
  const errors: CylinderSizeErrors = {};
  const value = { diameter: 0, length: 0 };
  for (const [k, raw] of [['diameter', d.diameter], ['length', d.length]] as const) {
    const n = parsePositive(raw);
    if (n == null) errors[k] = dimError(raw);
    else value[k] = n;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

// ─── Matemática de coordenadas ────────────────────────────────────────────────

function conjugateQuat(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function rotateVec3(q: Quaternion, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * Convierte una posición global a local en el frame del padre.
 * Inversa de: global = parent_pos + rotate(parent_rot, local)
 * → local = rotate(conjugate(parent_rot), global − parent_pos)
 */
export function globalToLocalPositionMm(
  globalPos: Vec3,
  parentGlobalPos: Vec3,
  parentGlobalRot: Quaternion,
): Vec3 {
  const diff: Vec3 = {
    x: globalPos.x - parentGlobalPos.x,
    y: globalPos.y - parentGlobalPos.y,
    z: globalPos.z - parentGlobalPos.z,
  };
  return rotateVec3(conjugateQuat(parentGlobalRot), diff);
}

// ─── Constructores de elementos (puros — devuelven nuevo elemento sin mutar) ──

export function applyNameEdit(el: EquipmentElement, name: string): EquipmentElement {
  return { ...el, name } as EquipmentElement;
}

/**
 * Aplica una nueva posición global al elemento.
 * Si tiene padre convierte de global a local antes de guardar.
 */
export function applyPositionEdit(
  el: EquipmentElement,
  globalPos: Vec3,
  parentTransform: { positionMm: Vec3; rotation: Quaternion } | null,
): EquipmentElement {
  if (el.placementStatus !== 'placed') return el;
  const localPos = parentTransform != null
    ? globalToLocalPositionMm(globalPos, parentTransform.positionMm, parentTransform.rotation)
    : globalPos;
  return {
    ...el,
    transform: { ...el.transform, positionMm: localPos },
  } as EquipmentElement;
}

/**
 * Aplica nuevas dimensiones de caja y ajusta positionMm.z para conservar la base.
 * Devuelve el elemento actualizado y childDeltaZ (Δz del centro del padre en espacio local).
 * Los hijos deben tener su positionMm.z reducido en childDeltaZ para mantener su posición global.
 */
export function applyBoxSizeEdit(
  el: EquipmentElement,
  widthMm: number,
  depthMm: number,
  heightMm: number,
): { element: EquipmentElement; childDeltaZ: number } {
  if (el.placementStatus !== 'placed' || el.geometry == null || el.geometry.kind !== 'box') {
    return { element: el, childDeltaZ: 0 };
  }
  const childDeltaZ = (heightMm - el.geometry.heightMm) / 2;
  return {
    element: {
      ...el,
      geometry: { kind: 'box', widthMm, depthMm, heightMm },
      transform: {
        ...el.transform,
        positionMm: { ...el.transform.positionMm, z: el.transform.positionMm.z + childDeltaZ },
      },
    } as EquipmentElement,
    childDeltaZ,
  };
}

/**
 * Aplica nuevas dimensiones de cilindro y ajusta positionMm.z para conservar la base.
 */
export function applyCylinderSizeEdit(
  el: EquipmentElement,
  diameterMm: number,
  lengthMm: number,
): { element: EquipmentElement; childDeltaZ: number } {
  if (el.placementStatus !== 'placed' || el.geometry == null || el.geometry.kind !== 'cylinder') {
    return { element: el, childDeltaZ: 0 };
  }
  const childDeltaZ = (lengthMm - el.geometry.lengthMm) / 2;
  return {
    element: {
      ...el,
      geometry: { kind: 'cylinder', diameterMm, lengthMm },
      transform: {
        ...el.transform,
        positionMm: { ...el.transform.positionMm, z: el.transform.positionMm.z + childDeltaZ },
      },
    } as EquipmentElement,
    childDeltaZ,
  };
}

/**
 * Ajusta la posición local Z de un hijo cuando el padre cambia de alto.
 * El padre se desplazó childDeltaZ en su eje Z local; para mantener la posición
 * global del hijo se resta ese mismo delta de su coordenada Z local.
 */
export function adjustChildLocalZ(child: EquipmentElement, childDeltaZ: number): EquipmentElement {
  if (child.placementStatus !== 'placed') return child;
  return {
    ...child,
    transform: {
      ...child.transform,
      positionMm: {
        ...child.transform.positionMm,
        z: child.transform.positionMm.z - childDeltaZ,
      },
    },
  } as EquipmentElement;
}
