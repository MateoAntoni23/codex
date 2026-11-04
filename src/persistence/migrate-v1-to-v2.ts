/**
 * migrate-v1-to-v2.ts — Pure, deterministic migration from ProjectData (v1)
 * to ProjectDataV2.
 *
 * Constraints:
 * - Pure and deterministic: no Date.now(), Math.random(), DOM, or IndexedDB.
 * - Does NOT mutate the input object.
 * - Validates the v1 input first using the existing validateProjectData.
 * - Evidence IDs are deterministic: ev-mig-{elementId} and ev-inc-{elementId}-{code}.
 */

import { validateProjectData } from './validate';
import type { ProjectData } from './schema';
import type {
  ProjectDataV2,
  EquipmentElement,
  MigrationIncident,
  FieldEvidence,
  Vec3,
} from '../types/domain-v2';
import { IDENTITY_QUATERNION } from '../types/domain-v2';

export interface MigrationResult {
  data: ProjectDataV2;
  incidents: MigrationIncident[];
}

/**
 * Migrates a validated ProjectData (schemaVersion=1) to ProjectDataV2
 * (schemaVersion=2).
 *
 * @param input - A raw ProjectData object (will be validated first).
 * @param options.recordedAt - ISO 8601 timestamp to stamp evidence records.
 *   Defaults to '1970-01-01T00:00:00.000Z' for determinism.
 */
export function migrateV1ToV2(
  input: ProjectData,
  options: { recordedAt: string } = { recordedAt: '1970-01-01T00:00:00.000Z' },
): MigrationResult {
  const validated = validateProjectData(input);
  const { recordedAt } = options;

  const elements: EquipmentElement[] = [];
  const evidence: FieldEvidence[] = [];
  const incidents: MigrationIncident[] = [];

  for (const obj of validated.objects) {
    const evId = `ev-mig-${obj.id}`;

    const baseEvidence: FieldEvidence = {
      id: evId,
      elementOrConnectionId: obj.id,
      fieldPath: '',
      source: 'migration',
      fileChecksum: null,
      sheet: null,
      row: null,
      cell: null,
      formula: null,
      rawValue: obj,
      author: null,
      recordedAt,
    };
    evidence.push(baseEvidence);

    const positionMm: Vec3 = {
      x: obj.position.x,
      y: obj.position.y,
      z: obj.position.z,
    };

    const commonBase = {
      id: obj.id,
      name: obj.name,
      tag: null as null,
      aliases: [] as string[],
      condition: 'unknown' as const,
      lifecycle: 'active' as const,
      parentId: null as null,
      mounting: 'unknown' as const,
      manufacturer: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
      model: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
      physicalLocation: {
        kind: 'unassigned' as const,
        factoryId: null as null,
        subareaId: null as null,
        description: null as null,
      },
      version: 1,
      placementStatus: 'placed' as const,
      transform: {
        positionMm,
        rotation: { ...IDENTITY_QUATERNION },
      },
    };

    let element: EquipmentElement;

    if (obj.type === 'floor') {
      element = {
        ...commonBase,
        category: 'infrastructure',
        geometry: {
          kind: 'plane',
          widthMm: obj.dimensions.width,
          depthMm: obj.dimensions.depth,
        },
        technical: {
          role: {
            value: 'floor',
            status: 'provided',
            evidenceIds: [evId],
          },
        },
      } as EquipmentElement;
    } else if (obj.type === 'building') {
      element = {
        ...commonBase,
        category: 'infrastructure',
        geometry: {
          kind: 'box',
          widthMm: obj.dimensions.width,
          depthMm: obj.dimensions.depth,
          heightMm: obj.dimensions.height,
        },
        technical: {
          role: {
            value: 'building',
            status: 'provided',
            evidenceIds: [evId],
          },
        },
      } as EquipmentElement;
    } else if (obj.type === 'panel') {
      element = {
        ...commonBase,
        category: 'electrical_panel',
        geometry: {
          kind: 'box',
          widthMm: obj.dimensions.width,
          depthMm: obj.dimensions.depth,
          heightMm: obj.dimensions.height,
        },
        technical: {
          ipRating: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          ratedCurrent: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
        },
      } as EquipmentElement;
    } else {
      // motor
      const { width, depth, height } = obj.dimensions;

      if (depth !== width) {
        const incidentCode = 'MOTOR_DEPTH_WIDTH_MISMATCH';
        const incidentId = `ev-inc-${obj.id}-${incidentCode}`;
        const incident: MigrationIncident = {
          id: incidentId,
          elementId: obj.id,
          field: 'geometry',
          code: incidentCode,
          originalValues: { width, depth, height },
          message: `Motor "${obj.id}": depth (${depth}) ≠ width (${width}). Se usó width como diámetro.`,
        };
        incidents.push(incident);

        const incEvidence: FieldEvidence = {
          id: incidentId,
          elementOrConnectionId: obj.id,
          fieldPath: 'geometry',
          source: 'migration',
          fileChecksum: null,
          sheet: null,
          row: null,
          cell: null,
          formula: null,
          rawValue: obj,
          author: null,
          recordedAt,
        };
        evidence.push(incEvidence);
      }

      element = {
        ...commonBase,
        category: 'motor',
        // diameterMm = width, lengthMm = height (design decision #10)
        geometry: {
          kind: 'cylinder',
          diameterMm: width,
          lengthMm: height,
        },
        technical: {
          power: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          voltage: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          phases: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          plateCurrent: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          efficiency: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          powerFactor: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
          start: { value: null, status: 'unknown' as const, evidenceIds: [] as string[] },
        },
      } as EquipmentElement;
    }

    elements.push(element);
  }

  const projectOrigin: Vec3 = {
    x: validated.projectOrigin.x,
    y: validated.projectOrigin.y,
    z: validated.projectOrigin.z,
  };

  const data: ProjectDataV2 = {
    schemaVersion: 2,
    projectOrigin,
    elements,
    ports: [],
    connections: [],
    cableCores: [],
    internalLinks: [],
    functionalRelations: [],
    factories: [],
    subareas: [],
    elementServices: [],
    evidence,
    migrationIncidents: incidents,
  };

  return { data, incidents };
}
