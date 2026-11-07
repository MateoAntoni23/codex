/**
 * useCalibrationStore — ajustes manuales por (receta, vista) para la malla GLB.
 *
 * Alcance: SÓLO la malla visible. No modifica los centros/normales/direcciones
 * de las bocas; esos datos son técnicos (modo B). Esto es "modo A": alineación
 * del mesh al marco canónico cuando la corrección de pipeline deja residuos
 * geométricos (ej.: perfiles reales que no son rectángulos barridos).
 *
 * Persistencia: localStorage (clave `parametric.calibrations.v1`). La clave
 * lógica es `${recipe}:${view}`. El valor incluye `source_version` para que un
 * cambio del artefacto GLB marque la calibración como "pendiente de revisión"
 * sin aplicarla automáticamente.
 */

import { create } from 'zustand';

export interface Calibration {
  readonly tx_mm: number;
  readonly ty_mm: number;
  readonly tz_mm: number;
  readonly rx_deg: number;
  readonly ry_deg: number;
  readonly rz_deg: number;
  /** Versión del GLB con la que se afinó esta calibración (de catalog.ts). */
  readonly source_version: string;
  /** Marca ISO de la última edición. */
  readonly updated_at: string;
}

export const IDENTITY_CALIBRATION: Calibration = {
  tx_mm: 0,
  ty_mm: 0,
  tz_mm: 0,
  rx_deg: 0,
  ry_deg: 0,
  rz_deg: 0,
  source_version: '',
  updated_at: '',
};

export type CalibrationKey = string; // `${recipe}:${view}`

export interface CalibrationExport {
  readonly schema: 'parametric-calibrations';
  readonly version: 1;
  readonly exported_at: string;
  readonly calibrations: Record<CalibrationKey, Calibration>;
}

interface PreviewSlot {
  readonly key: CalibrationKey;
  readonly value: Calibration;
  /** Valor previo (para Cancel/Reset). `null` si no existía calibración. */
  readonly base: Calibration | null;
}

interface CalibrationState {
  readonly calibrations: Record<CalibrationKey, Calibration>;
  readonly preview: PreviewSlot | null;

  /** Calibración persistida para una clave (sin tener en cuenta preview). */
  getCalibration(key: CalibrationKey): Calibration | undefined;

  /** Guarda una calibración definitiva (no preview). */
  setCalibration(key: CalibrationKey, value: Calibration): void;

  /** Elimina la calibración persistida para esa clave. */
  clearCalibration(key: CalibrationKey): void;

  /** Inicia preview a partir del valor guardado (o identidad si no hay). */
  beginPreview(key: CalibrationKey, sourceVersion: string): void;

  /** Actualiza campos del preview. Requiere preview activo con la misma clave. */
  updatePreview(patch: Partial<Omit<Calibration, 'source_version' | 'updated_at'>>): void;

  /** Aplica el preview actual (lo copia a `calibrations`) y lo limpia. */
  applyPreview(): void;

  /** Descarta el preview actual sin aplicar. */
  cancelPreview(): void;

  /** Resetea la calibración persistida y el preview para esa clave. */
  resetCalibration(key: CalibrationKey): void;

  /** Vuelca todas las calibraciones a JSON. */
  exportAll(): CalibrationExport;

  /** Importa (fusiona) un dump JSON. Devuelve conteo de entradas aceptadas. */
  importAll(dump: unknown): number;
}

const STORAGE_KEY = 'parametric.calibrations.v1';

function loadFromStorage(): Record<CalibrationKey, Calibration> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<CalibrationKey, Calibration> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const cal = normalizeCalibration(v);
      if (cal) out[k] = cal;
    }
    return out;
  } catch {
    return {};
  }
}

function saveToStorage(calibrations: Record<CalibrationKey, Calibration>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(calibrations));
  } catch {
    // silencioso: localStorage lleno o deshabilitado — no es fatal
  }
}

function normalizeCalibration(v: unknown): Calibration | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const num = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : 0);
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  return {
    tx_mm: num('tx_mm'),
    ty_mm: num('ty_mm'),
    tz_mm: num('tz_mm'),
    rx_deg: num('rx_deg'),
    ry_deg: num('ry_deg'),
    rz_deg: num('rz_deg'),
    source_version: str('source_version'),
    updated_at: str('updated_at'),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useCalibrationStore = create<CalibrationState>((set, get) => ({
  calibrations: loadFromStorage(),
  preview: null,

  getCalibration(key) {
    return get().calibrations[key];
  },

  setCalibration(key, value) {
    const next = { ...get().calibrations, [key]: { ...value, updated_at: nowIso() } };
    saveToStorage(next);
    set({ calibrations: next });
  },

  clearCalibration(key) {
    const curr = get().calibrations;
    if (!(key in curr)) return;
    const next = { ...curr };
    delete next[key];
    saveToStorage(next);
    set({ calibrations: next });
  },

  beginPreview(key, sourceVersion) {
    const existing = get().calibrations[key];
    const base = existing ?? null;
    const seed: Calibration = existing
      ? { ...existing }
      : { ...IDENTITY_CALIBRATION, source_version: sourceVersion, updated_at: '' };
    set({ preview: { key, value: seed, base } });
  },

  updatePreview(patch) {
    const p = get().preview;
    if (!p) return;
    set({ preview: { ...p, value: { ...p.value, ...patch } } });
  },

  applyPreview() {
    const p = get().preview;
    if (!p) return;
    const value: Calibration = { ...p.value, updated_at: nowIso() };
    const next = { ...get().calibrations, [p.key]: value };
    saveToStorage(next);
    set({ calibrations: next, preview: null });
  },

  cancelPreview() {
    set({ preview: null });
  },

  resetCalibration(key) {
    const curr = get().calibrations;
    const next = { ...curr };
    delete next[key];
    saveToStorage(next);
    const p = get().preview;
    const preview = p && p.key === key ? null : p;
    set({ calibrations: next, preview });
  },

  exportAll() {
    return {
      schema: 'parametric-calibrations',
      version: 1,
      exported_at: nowIso(),
      calibrations: get().calibrations,
    };
  },

  importAll(dump) {
    if (!dump || typeof dump !== 'object') return 0;
    const d = dump as Record<string, unknown>;
    const payload = (d.calibrations && typeof d.calibrations === 'object') ? d.calibrations : d;
    let count = 0;
    const next = { ...get().calibrations };
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      const cal = normalizeCalibration(v);
      if (cal) {
        next[k] = cal;
        count += 1;
      }
    }
    saveToStorage(next);
    set({ calibrations: next });
    return count;
  },
}));

/** Construye la clave `${recipe}:${view}` que usa el store. */
export function calibrationKey(recipe: string, view: string): CalibrationKey {
  return `${recipe}:${view}`;
}

/**
 * Determina si una calibración guardada está "obsoleta" respecto a la versión
 * actual del artefacto GLB (indicada por `catalog.source_version`). Útil para
 * marcar en UI que fue afinada para un build anterior.
 */
export function isStale(cal: Calibration | undefined, currentSourceVersion: string): boolean {
  if (!cal) return false;
  if (!cal.source_version) return false;
  return cal.source_version !== currentSourceVersion;
}
