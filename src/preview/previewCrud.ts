/**
 * previewCrud.ts — Funciones puras para agregar, duplicar y eliminar equipos.
 * No importa stores, React ni IndexedDB.
 */

import type { EquipmentElement, FieldEvidence, Datum } from '../types/domain-v2';
import { IDENTITY_QUATERNION } from '../types/domain-v2';
import { createManualEvidence } from './technicalEditor';

// ─── Generador de IDs ─────────────────────────────────────────────────────────

let _crudIdCounter = 0;

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${(++_crudIdCounter).toString(36)}`;
}

// ─── Tipos de spec para creación ──────────────────────────────────────────────

export type CreatableCategory = 'motor' | 'sensor' | 'electrical_panel';

export type AddElementSpec = {
  category: CreatableCategory;
  name: string;
  placement:
    | { placementStatus: 'unplaced' }
    | { placementStatus: 'placed'; positionMm: { x: number; y: number; z: number } };
  geometry:
    | { kind: 'box'; widthMm: number; depthMm: number; heightMm: number }
    | { kind: 'cylinder'; diameterMm: number; lengthMm: number }
    | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unknownDatum<T>(): Datum<T> {
  return { value: null, status: 'unknown', evidenceIds: [] };
}

const DEFAULT_LOCATION = {
  kind: 'unassigned' as const,
  factoryId: null as null,
  subareaId: null as null,
  description: null as null,
};

// ─── Creación ─────────────────────────────────────────────────────────────────

export function createNewElement(spec: AddElementSpec): EquipmentElement {
  const id = generateId(spec.category);

  const basePlacement =
    spec.placement.placementStatus === 'unplaced'
      ? ({ placementStatus: 'unplaced', transform: null } as const)
      : ({
          placementStatus: 'placed',
          transform: {
            positionMm: spec.placement.positionMm,
            rotation: { ...IDENTITY_QUATERNION },
          },
        } as const);

  const common = {
    id,
    tag: null as null,
    aliases: [] as string[],
    name: spec.name,
    physicalLocation: DEFAULT_LOCATION,
    condition: 'new' as const,
    lifecycle: 'active' as const,
    parentId: null as null,
    geometry: spec.geometry,
    mounting: 'floor' as const,
    manufacturer: unknownDatum<string>(),
    model: unknownDatum<string>(),
    version: 1,
    ...basePlacement,
  };

  if (spec.category === 'motor') {
    return {
      ...common,
      category: 'motor' as const,
      technical: {
        power:       unknownDatum(),
        voltage:     unknownDatum(),
        phases:      unknownDatum(),
        plateCurrent: unknownDatum(),
        efficiency:  unknownDatum(),
        powerFactor: unknownDatum(),
        start:       unknownDatum(),
      },
    } as EquipmentElement;
  }

  if (spec.category === 'sensor') {
    return {
      ...common,
      category: 'sensor' as const,
      technical: {
        measuredVariable: unknownDatum(),
        range:            unknownDatum(),
        supply:           unknownDatum(),
        signal:           unknownDatum(),
      },
    } as EquipmentElement;
  }

  // electrical_panel
  return {
    ...common,
    category: 'electrical_panel' as const,
    technical: {
      ipRating:     unknownDatum(),
      ratedCurrent: unknownDatum(),
    },
  } as EquipmentElement;
}

// ─── Duplicación ──────────────────────────────────────────────────────────────

function downgradeVerified<T>(datum: Datum<T>): Datum<T> {
  return datum.status === 'verified' ? { ...datum, status: 'provided' } : datum;
}

function downgradeTechnicalVerified(el: EquipmentElement): EquipmentElement['technical'] {
  // All technical fields are Datum<T>; downgrade any 'verified' → 'provided'.
  const tech = el.technical as Record<string, Datum<unknown>>;
  const result: Record<string, Datum<unknown>> = {};
  for (const [k, v] of Object.entries(tech)) {
    result[k] = downgradeVerified(v);
  }
  return result as EquipmentElement['technical'];
}

export function duplicateElement(
  original: EquipmentElement,
): { duplicate: EquipmentElement; provenance: FieldEvidence } {
  const newId = generateId(`dup-${original.category}`);

  const provenance = createManualEvidence(newId, '_provenance', {
    action: 'duplicated_from',
    sourceId: original.id,
    sourceName: original.name,
  });

  const duplicate: EquipmentElement = {
    ...original,
    id:           newId,
    tag:          null,
    aliases:      [],
    name:         `Copia de ${original.name}`,
    parentId:     null,
    version:      1,
    manufacturer: downgradeVerified(original.manufacturer),
    model:        downgradeVerified(original.model),
    technical:    downgradeTechnicalVerified(original),
  } as EquipmentElement;

  return { duplicate, provenance };
}

// ─── Dependencias de eliminación ──────────────────────────────────────────────

export interface DeleteCheck {
  canDelete: boolean;
  blockers: string[];
}

export function checkDeleteDependencies(
  el: EquipmentElement,
  allElements: EquipmentElement[],
): DeleteCheck {
  const blockers: string[] = [];
  const children = allElements.filter((e) => e.parentId === el.id);
  if (children.length > 0) {
    const names = children.map((c) => `"${c.name}"`).join(', ');
    blockers.push(
      `Tiene ${children.length} elemento(s) hijo(s): ${names}. Desasociá los hijos antes de eliminar.`,
    );
  }
  return { canDelete: blockers.length === 0, blockers };
}
