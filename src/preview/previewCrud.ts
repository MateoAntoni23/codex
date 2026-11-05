/**
 * previewCrud.ts — Funciones puras para agregar, duplicar y eliminar equipos.
 * No importa stores ni React.
 */

import type { EquipmentElement, FieldEvidence, Datum, Placement } from '../types/domain-v2';
import { IDENTITY_QUATERNION } from '../types/domain-v2';
import { resolveGlobalTransform } from '../scene/v2-adapter';
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

  const basePlacement: Placement =
    spec.placement.placementStatus === 'unplaced'
      ? { placementStatus: 'unplaced', transform: null }
      : {
          placementStatus: 'placed',
          transform: {
            positionMm: spec.placement.positionMm,
            rotation: { ...IDENTITY_QUATERNION },
          },
        };

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
        power:        unknownDatum(),
        voltage:      unknownDatum(),
        phases:       unknownDatum(),
        plateCurrent: unknownDatum(),
        efficiency:   unknownDatum(),
        powerFactor:  unknownDatum(),
        start:        unknownDatum(),
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

/**
 * Remapea los evidenceIds de un datum para que apunten a nuevos registros
 * propiedad de la copia. Popula `idMap` (old→new) y agrega a `out` los
 * registros copiados con `elementOrConnectionId` del nuevo dueño.
 */
function remapDatumEvidence<T>(
  datum: Datum<T>,
  newOwnerId: string,
  allEvidence: FieldEvidence[],
  idMap: Map<string, string>,
  out: FieldEvidence[],
): Datum<T> {
  if (datum.evidenceIds.length === 0) return datum;
  const newIds = datum.evidenceIds.map((eid) => {
    if (!idMap.has(eid)) {
      const newEid = generateId('ev-dup');
      idMap.set(eid, newEid);
      const src = allEvidence.find((ev) => ev.id === eid);
      if (src) {
        out.push({ ...src, id: newEid, elementOrConnectionId: newOwnerId });
      }
    }
    return idMap.get(eid)!;
  });
  return { ...datum, evidenceIds: newIds };
}

function downgradeAndRemapTechnical(
  el: EquipmentElement,
  newOwnerId: string,
  allEvidence: FieldEvidence[],
  idMap: Map<string, string>,
  out: FieldEvidence[],
): EquipmentElement['technical'] {
  const tech = el.technical as Record<string, Datum<unknown>>;
  const result: Record<string, Datum<unknown>> = {};
  for (const [k, v] of Object.entries(tech)) {
    result[k] = remapDatumEvidence(downgradeVerified(v), newOwnerId, allEvidence, idMap, out);
  }
  return result as EquipmentElement['technical'];
}

/**
 * Duplica un elemento con ID único y sin herencia de jerarquía.
 * - Si el original es hijo, resuelve su transformación global.
 * - Si algún ancestro está sin ubicar, la copia también queda sin ubicar.
 * - Los evidenceIds de cada datum se remapean a nuevos registros propios de la
 *   copia; así al eliminar el original sus evidencias no dejan referencias
 *   colgantes en la copia. Los registros originales no se modifican.
 */
export function duplicateElement(
  original: EquipmentElement,
  allElements: EquipmentElement[],
  allEvidence: FieldEvidence[],
): { duplicate: EquipmentElement; provenance: FieldEvidence; remappedEvidence: FieldEvidence[] } {
  const newId = generateId(`dup-${original.category}`);

  // Determinar placement global para la copia
  let resolvedPlacement: Placement;
  if (original.parentId !== null) {
    const globalTransform = resolveGlobalTransform(original.id, allElements);
    resolvedPlacement = globalTransform !== null
      ? { placementStatus: 'placed', transform: globalTransform }
      : { placementStatus: 'unplaced', transform: null };
  } else if (original.placementStatus === 'placed') {
    resolvedPlacement = {
      placementStatus: 'placed',
      transform: {
        positionMm: { ...original.transform.positionMm },
        rotation:   { ...original.transform.rotation },
      },
    };
  } else {
    resolvedPlacement = { placementStatus: 'unplaced', transform: null };
  }

  // Remap evidence: build a stable old→new ID map shared across all datums
  const idMap = new Map<string, string>();
  const remappedEvidence: FieldEvidence[] = [];

  const manufacturer = remapDatumEvidence(
    downgradeVerified(original.manufacturer), newId, allEvidence, idMap, remappedEvidence,
  );
  const model = remapDatumEvidence(
    downgradeVerified(original.model), newId, allEvidence, idMap, remappedEvidence,
  );
  const technical = downgradeAndRemapTechnical(original, newId, allEvidence, idMap, remappedEvidence);

  const provenance = createManualEvidence(newId, '_provenance', {
    action:     'duplicated_from',
    sourceId:   original.id,
    sourceName: original.name,
  });

  const duplicate: EquipmentElement = {
    ...original,
    ...resolvedPlacement,
    id:        newId,
    tag:       null,
    aliases:   [],
    name:      `Copia de ${original.name}`,
    parentId:  null,
    version:   1,
    manufacturer,
    model,
    technical,
  } as EquipmentElement;

  return { duplicate, provenance, remappedEvidence };
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

// ─── Integridad de evidencia ──────────────────────────────────────────────────

/**
 * Reúne todos los evidenceIds referenciados por los datums de un elemento
 * (manufacturer, model y todos los campos de technical).
 */
export function collectAllEvidenceIds(el: EquipmentElement): string[] {
  const ids: string[] = [
    ...el.manufacturer.evidenceIds,
    ...el.model.evidenceIds,
  ];
  const tech = el.technical as Record<string, { evidenceIds: string[] }>;
  for (const datum of Object.values(tech)) {
    ids.push(...datum.evidenceIds);
  }
  return ids;
}

/**
 * Devuelve los IDs de evidencia que pueden retirarse cuando se elimina el
 * elemento `id`. Solo se retiran registros cuyo elementOrConnectionId sea `id`
 * y que ningún otro elemento referencia en sus evidenceIds.
 */
export function evidenceToRemoveOnDelete(
  id: string,
  elements: EquipmentElement[],
  evidence: FieldEvidence[],
): string[] {
  // IDs de evidencia referenciados por OTROS elementos
  const referencedByOthers = new Set<string>();
  for (const el of elements) {
    if (el.id === id) continue;
    for (const eid of collectAllEvidenceIds(el)) {
      referencedByOthers.add(eid);
    }
  }
  return evidence
    .filter((ev) => ev.elementOrConnectionId === id && !referencedByOthers.has(ev.id))
    .map((ev) => ev.id);
}

// ─── Validación de proyecto ───────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Valida la consistencia interna del snapshot de preview:
 * - Sin IDs de elemento duplicados.
 * - Todos los parentId referencian elementos existentes.
 * - Todos los evidenceIds en datums referencian evidencias en el array.
 * - Todas las evidencias tienen elementOrConnectionId en un elemento existente.
 */
export function validatePreviewData(
  elements: EquipmentElement[],
  evidence: FieldEvidence[],
): ValidationResult {
  const errors: string[] = [];
  const elementIds = new Set(elements.map((e) => e.id));
  const evidenceIds = new Set(evidence.map((e) => e.id));

  // Duplicados
  if (elementIds.size < elements.length) {
    errors.push('IDs de elementos duplicados detectados');
  }

  // parentId colgante
  for (const el of elements) {
    if (el.parentId !== null && !elementIds.has(el.parentId)) {
      errors.push(`"${el.id}" referencia parentId "${el.parentId}" inexistente`);
    }
  }

  // evidenceIds en datums que no existen en el array de evidencia
  for (const el of elements) {
    for (const eid of collectAllEvidenceIds(el)) {
      if (!evidenceIds.has(eid)) {
        errors.push(`"${el.id}" referencia evidencia "${eid}" inexistente en el array`);
      }
    }
  }

  // Evidencia con propietario inexistente
  for (const ev of evidence) {
    if (!elementIds.has(ev.elementOrConnectionId)) {
      errors.push(
        `Evidencia "${ev.id}" referencia elemento "${ev.elementOrConnectionId}" inexistente`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
