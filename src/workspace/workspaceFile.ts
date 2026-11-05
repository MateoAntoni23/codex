import type { EquipmentElement, FieldEvidence, ProjectDataV2 } from '../types/domain-v2';
import type { TrayInput } from '../tray/model';
import { assertInput } from '../tray/model';
import { validateProjectDataV2 } from '../persistence/validate-v2';

/**
 * Workspace file format v1.
 *
 * Equipment and evidence are wrapped in a full ProjectDataV2 structure so they
 * can be validated with validateProjectDataV2 (strict per-datum validation,
 * quaternion normalization, parentId coherence, etc.). Empty arrays are used
 * for ports, connections, and other graph entities not yet supported here.
 */
export interface WorkspaceFileV1 {
  fileVersion: 1;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
}

function toProjectV2(
  elements: EquipmentElement[],
  evidence: FieldEvidence[],
): ProjectDataV2 {
  return {
    schemaVersion: 2,
    projectOrigin: { x: 0, y: 0, z: 0 },
    elements,
    evidence,
    factories: [],
    subareas: [],
    elementServices: [],
    ports: [],
    connections: [],
    cableCores: [],
    internalLinks: [],
    functionalRelations: [],
    migrationIncidents: [],
  };
}

export function exportWorkspace(
  elements: EquipmentElement[],
  evidence: FieldEvidence[],
  trayInput: TrayInput,
): string {
  const file: WorkspaceFileV1 = {
    fileVersion: 1,
    exportedAt: new Date().toISOString(),
    projectV2: toProjectV2(elements, evidence),
    trayInput,
  };
  return JSON.stringify(file, null, 2);
}

export function importWorkspace(raw: string): WorkspaceFileV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El archivo no es JSON válido');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Formato de archivo inválido');
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.fileVersion !== 1) {
    throw new Error(`Versión de archivo no soportada: ${String(obj.fileVersion)}`);
  }

  // Validate equipment + evidence through validateProjectDataV2
  const projectV2 = validateProjectDataV2(obj.projectV2);

  // Validate tray input — assertInput throws on invalid contracts
  assertInput(obj.trayInput);

  return {
    fileVersion: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    projectV2,
    trayInput: obj.trayInput as TrayInput,
  };
}
