/**
 * technicalEditor.ts — Funciones puras para editar datos técnicos en la vista de prueba.
 * No importa stores, React ni IndexedDB.
 */

import type {
  EquipmentElement, FieldEvidence, Datum, TechnicalByCategory, Quaternion,
} from '../types/domain-v2';
import { rotateVec3 } from './previewEditor';

// ─── Tipos de borrador ────────────────────────────────────────────────────────

export interface CommonTechnicalDraft {
  manufacturer: string;   // '' = desconocido
  model:        string;
}

export interface MotorTechnicalDraft {
  power:        string;                   // número positivo o '' = desconocido
  powerUnit:    'kW' | 'HP';
  voltage:      string;                   // V; positivo o ''
  phases:       '' | '1' | '3';
  plateCurrent: string;                   // A; positivo o ''
  efficiency:   string;                   // 0 < x ≤ 1 o ''
  powerFactor:  string;                   // 0 < x ≤ 1 o ''
  start:        '' | 'direct' | 'star_delta' | 'softstarter' | 'vfd' | 'other';
}

export interface SensorTechnicalDraft {
  measuredVariable:  string;
  rangeMin:          string;   // ambos o ninguno
  rangeMax:          string;
  rangeUnit:         string;
  supplyVoltage:     string;   // positivo o ''
  supplyCurrentType: '' | 'AC' | 'DC';
  signal:            '' | 'DI' | '4_20mA' | '0_10V' | 'RTD' | 'bus' | 'other';
}

export interface PanelTechnicalDraft {
  ipRating:     string;   // texto libre o ''
  ratedCurrent: string;   // A; positivo o ''
}

export type TechDraftErrors = Partial<Record<string, string>>;

type ApplyTechResult =
  | { ok: true;  element: EquipmentElement; newEvidence: FieldEvidence[] }
  | { ok: false; errors: TechDraftErrors };

// ─── Helpers de parseo ────────────────────────────────────────────────────────

function parsePositiveOrNull(raw: string): number | null | 'invalid' {
  if (raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return 'invalid';
  return n;
}

function parseZeroToOneOrNull(raw: string): number | null | 'invalid' {
  if (raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1) return 'invalid';
  return n;
}

// ─── Datum con evidencia ──────────────────────────────────────────────────────

function buildDatum<T>(
  current: Datum<T>,
  newValue: T | null,
  fieldPath: string,
  rawDraft: unknown,
  elementId: string,
  newEvidence: FieldEvidence[],
): Datum<T> {
  const changed = JSON.stringify(current.value) !== JSON.stringify(newValue);
  let evidenceIds = current.evidenceIds;
  if (changed) {
    const ev = createManualEvidence(elementId, fieldPath, rawDraft);
    newEvidence.push(ev);
    evidenceIds = [...current.evidenceIds, ev.id];
  }
  if (newValue === null) return { value: null, status: 'unknown', evidenceIds };
  // No marcar verificado automáticamente; edición manual → 'provided'.
  return { value: newValue, status: 'provided', evidenceIds };
}

// ─── Evidencia manual ─────────────────────────────────────────────────────────

export function createManualEvidence(
  elementId: string,
  fieldPath: string,
  rawValue: unknown,
): FieldEvidence {
  return {
    id:                     `ev-manual-${elementId}-${fieldPath.replace(/\./g, '_')}-${Date.now()}`,
    elementOrConnectionId:  elementId,
    fieldPath,
    source:                 'manual',
    fileChecksum:           null,
    sheet:                  null,
    row:                    null,
    cell:                   null,
    formula:                null,
    rawValue,
    author:                 null,
    recordedAt:             new Date().toISOString(),
  };
}

// ─── Inclinación ──────────────────────────────────────────────────────────────

/**
 * Devuelve true si el eje Z local no apunta a +Z global.
 * En ese caso el cálculo de "apoyar en piso" requiere geometría adicional.
 */
export function isElementInclined(rotation: Quaternion): boolean {
  const localZ = rotateVec3(rotation, { x: 0, y: 0, z: 1 });
  return Math.abs(localZ.z - 1) > 1e-4;
}

// ─── Sync borradores desde el elemento ───────────────────────────────────────

export function syncCommonDraft(el: EquipmentElement): CommonTechnicalDraft {
  return {
    manufacturer: el.manufacturer.value ?? '',
    model:        el.model.value ?? '',
  };
}

export function syncMotorDraft(technical: TechnicalByCategory['motor']): MotorTechnicalDraft {
  return {
    power:        technical.power.value != null ? String(technical.power.value.value) : '',
    powerUnit:    technical.power.value?.unit ?? 'kW',
    voltage:      technical.voltage.value != null ? String(technical.voltage.value.value) : '',
    phases:       technical.phases.value != null ? (String(technical.phases.value) as '1' | '3') : '',
    plateCurrent: technical.plateCurrent.value != null ? String(technical.plateCurrent.value.value) : '',
    efficiency:   technical.efficiency.value != null ? String(technical.efficiency.value) : '',
    powerFactor:  technical.powerFactor.value != null ? String(technical.powerFactor.value) : '',
    start:        technical.start.value ?? '',
  };
}

export function syncSensorDraft(technical: TechnicalByCategory['sensor']): SensorTechnicalDraft {
  return {
    measuredVariable:  technical.measuredVariable.value ?? '',
    rangeMin:          technical.range.value != null ? String(technical.range.value.min) : '',
    rangeMax:          technical.range.value != null ? String(technical.range.value.max) : '',
    rangeUnit:         technical.range.value?.unit ?? '',
    supplyVoltage:     technical.supply.value != null ? String(technical.supply.value.voltageV) : '',
    supplyCurrentType: technical.supply.value?.currentType ?? '',
    signal:            technical.signal.value ?? '',
  };
}

export function syncPanelDraft(technical: TechnicalByCategory['electrical_panel']): PanelTechnicalDraft {
  return {
    ipRating:     technical.ipRating.value ?? '',
    ratedCurrent: technical.ratedCurrent.value != null ? String(technical.ratedCurrent.value.value) : '',
  };
}

// ─── Aplicación de borradores ─────────────────────────────────────────────────

export function applyMotorTechnicalDraft(
  el: EquipmentElement,
  draft: MotorTechnicalDraft,
  commonDraft: CommonTechnicalDraft,
): ApplyTechResult {
  if (el.category !== 'motor') return { ok: false, errors: { _: 'Categoría no es motor' } };

  const errors: TechDraftErrors = {};

  const powerVal       = parsePositiveOrNull(draft.power);
  const voltageVal     = parsePositiveOrNull(draft.voltage);
  const plateCurrentVal = parsePositiveOrNull(draft.plateCurrent);
  const efficiencyVal  = parseZeroToOneOrNull(draft.efficiency);
  const powerFactorVal = parseZeroToOneOrNull(draft.powerFactor);

  if (powerVal       === 'invalid') errors.power        = 'Debe ser un número positivo';
  if (voltageVal     === 'invalid') errors.voltage      = 'Debe ser un número positivo';
  if (plateCurrentVal === 'invalid') errors.plateCurrent = 'Debe ser un número positivo';
  if (efficiencyVal  === 'invalid') errors.efficiency   = 'Debe ser entre 0 y 1 (exclusivo cero)';
  if (powerFactorVal === 'invalid') errors.powerFactor  = 'Debe ser entre 0 y 1 (exclusivo cero)';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const newEvidence: FieldEvidence[] = [];
  const id   = el.id;
  const tech = el.technical;

  const bd = <T,>(
    current: Datum<T>, newValue: T | null, fp: string, raw: unknown,
  ): Datum<T> => buildDatum(current, newValue, fp, raw, id, newEvidence);

  const newPower = bd(
    tech.power,
    powerVal !== null ? { value: powerVal as number, unit: draft.powerUnit } : null,
    'technical.power', draft.power,
  );
  const newVoltage = bd(
    tech.voltage,
    voltageVal !== null ? { value: voltageVal as number, unit: 'V' as const } : null,
    'technical.voltage', draft.voltage,
  );
  const phasesNum: 1 | 3 | null = draft.phases === '1' ? 1 : draft.phases === '3' ? 3 : null;
  const newPhases       = bd(tech.phases,       phasesNum,                        'technical.phases',       draft.phases);
  const newPlateCurrent = bd(
    tech.plateCurrent,
    plateCurrentVal !== null ? { value: plateCurrentVal as number, unit: 'A' as const } : null,
    'technical.plateCurrent', draft.plateCurrent,
  );
  const newEfficiency  = bd(tech.efficiency,  efficiencyVal  !== null ? efficiencyVal  as number : null, 'technical.efficiency',  draft.efficiency);
  const newPowerFactor = bd(tech.powerFactor, powerFactorVal !== null ? powerFactorVal as number : null, 'technical.powerFactor', draft.powerFactor);
  const startVal = draft.start === '' ? null : draft.start;
  const newStart = bd(tech.start, startVal, 'technical.start', draft.start);

  const newManufacturer = bd(el.manufacturer, commonDraft.manufacturer.trim() || null, 'manufacturer', commonDraft.manufacturer);
  const newModel        = bd(el.model,        commonDraft.model.trim()        || null, 'model',        commonDraft.model);

  return {
    ok: true,
    element: {
      ...el,
      manufacturer: newManufacturer,
      model:        newModel,
      technical: {
        power: newPower, voltage: newVoltage, phases: newPhases,
        plateCurrent: newPlateCurrent, efficiency: newEfficiency,
        powerFactor: newPowerFactor, start: newStart,
      },
    } as EquipmentElement,
    newEvidence,
  };
}

export function applySensorTechnicalDraft(
  el: EquipmentElement,
  draft: SensorTechnicalDraft,
  commonDraft: CommonTechnicalDraft,
): ApplyTechResult {
  if (el.category !== 'sensor') return { ok: false, errors: { _: 'Categoría no es sensor' } };

  const errors: TechDraftErrors = {};

  const minEmpty = draft.rangeMin.trim() === '';
  const maxEmpty = draft.rangeMax.trim() === '';
  let rangeVal: { min: number; max: number; unit: string } | null = null;

  if (!minEmpty || !maxEmpty) {
    if (minEmpty)  errors.rangeMin = 'Ingresá mínimo y máximo juntos';
    if (maxEmpty)  errors.rangeMax = 'Ingresá mínimo y máximo juntos';
    if (!minEmpty && !maxEmpty) {
      const minN = Number(draft.rangeMin.trim());
      const maxN = Number(draft.rangeMax.trim());
      if (!Number.isFinite(minN)) errors.rangeMin = 'Ingresá un número válido';
      if (!Number.isFinite(maxN)) errors.rangeMax = 'Ingresá un número válido';
      if (!errors.rangeMin && !errors.rangeMax) {
        if (minN >= maxN) {
          errors.rangeMax = 'El máximo debe ser mayor que el mínimo';
        } else {
          rangeVal = { min: minN, max: maxN, unit: draft.rangeUnit.trim() };
        }
      }
    }
  }

  const supplyVoltageVal = parsePositiveOrNull(draft.supplyVoltage);
  if (supplyVoltageVal === 'invalid') errors.supplyVoltage = 'Debe ser un número positivo';
  if (supplyVoltageVal !== null && supplyVoltageVal !== 'invalid' && draft.supplyCurrentType === '') {
    errors.supplyCurrentType = 'Seleccioná el tipo de corriente';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const newEvidence: FieldEvidence[] = [];
  const id   = el.id;
  const tech = el.technical;

  const bd = <T,>(
    current: Datum<T>, newValue: T | null, fp: string, raw: unknown,
  ): Datum<T> => buildDatum(current, newValue, fp, raw, id, newEvidence);

  const newMeasuredVariable = bd(
    tech.measuredVariable,
    draft.measuredVariable.trim() || null,
    'technical.measuredVariable', draft.measuredVariable,
  );
  const newRange = bd(tech.range, rangeVal, 'technical.range', `${draft.rangeMin}..${draft.rangeMax} ${draft.rangeUnit}`);

  const supplyToStore =
    supplyVoltageVal !== null
      ? { voltageV: supplyVoltageVal as number, currentType: draft.supplyCurrentType as 'AC' | 'DC' }
      : null;
  const newSupply = bd(tech.supply, supplyToStore, 'technical.supply', `${draft.supplyVoltage} ${draft.supplyCurrentType}`);

  const signalVal = draft.signal === '' ? null : draft.signal;
  const newSignal = bd(tech.signal, signalVal, 'technical.signal', draft.signal);

  const newManufacturer = bd(el.manufacturer, commonDraft.manufacturer.trim() || null, 'manufacturer', commonDraft.manufacturer);
  const newModel        = bd(el.model,        commonDraft.model.trim()        || null, 'model',        commonDraft.model);

  return {
    ok: true,
    element: {
      ...el,
      manufacturer: newManufacturer,
      model:        newModel,
      technical: {
        measuredVariable: newMeasuredVariable,
        range: newRange, supply: newSupply, signal: newSignal,
      },
    } as EquipmentElement,
    newEvidence,
  };
}

export function applyPanelTechnicalDraft(
  el: EquipmentElement,
  draft: PanelTechnicalDraft,
  commonDraft: CommonTechnicalDraft,
): ApplyTechResult {
  if (el.category !== 'electrical_panel') return { ok: false, errors: { _: 'Categoría incorrecta' } };

  const errors: TechDraftErrors = {};
  const ratedCurrentVal = parsePositiveOrNull(draft.ratedCurrent);
  if (ratedCurrentVal === 'invalid') errors.ratedCurrent = 'Debe ser un número positivo';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const newEvidence: FieldEvidence[] = [];
  const id   = el.id;
  const tech = el.technical;

  const bd = <T,>(
    current: Datum<T>, newValue: T | null, fp: string, raw: unknown,
  ): Datum<T> => buildDatum(current, newValue, fp, raw, id, newEvidence);

  const newIpRating = bd(tech.ipRating, draft.ipRating.trim() || null, 'technical.ipRating', draft.ipRating);
  const newRatedCurrent = bd(
    tech.ratedCurrent,
    ratedCurrentVal !== null ? { value: ratedCurrentVal as number, unit: 'A' as const } : null,
    'technical.ratedCurrent', draft.ratedCurrent,
  );
  const newManufacturer = bd(el.manufacturer, commonDraft.manufacturer.trim() || null, 'manufacturer', commonDraft.manufacturer);
  const newModel        = bd(el.model,        commonDraft.model.trim()        || null, 'model',        commonDraft.model);

  return {
    ok: true,
    element: {
      ...el,
      manufacturer: newManufacturer,
      model:        newModel,
      technical: { ipRating: newIpRating, ratedCurrent: newRatedCurrent },
    } as EquipmentElement,
    newEvidence,
  };
}
