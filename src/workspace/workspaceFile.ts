import type { EquipmentElement, FieldEvidence, ProjectDataV2 } from '../types/domain-v2';
import type { TrayInput } from '../tray/model';
import { assertInput } from '../tray/model';
import { validateProjectDataV2 } from '../persistence/validate-v2';

/**
 * The non-elements, non-evidence fields of ProjectDataV2.
 * Stored in the workspace store so round-trips preserve origin, factories, etc.
 */
export type ProjectMeta = Omit<ProjectDataV2, 'schemaVersion' | 'elements' | 'evidence'>;

export const DEFAULT_PROJECT_META: ProjectMeta = {
  projectOrigin: { x: 0, y: 0, z: 0 },
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

/**
 * Workspace file format v1.
 *
 * Equipment and evidence are wrapped in a full ProjectDataV2 structure so they
 * can be validated with validateProjectDataV2 (strict per-datum validation,
 * quaternion normalization, parentId coherence, etc.).
 * projectOrigin, factories and all other graph entities survive the round-trip.
 */
export interface WorkspaceFileV1 {
  fileVersion: 1;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
}

export function exportWorkspace(
  elements: EquipmentElement[],
  evidence: FieldEvidence[],
  meta: ProjectMeta,
  trayInput: TrayInput,
): string {
  const projectV2: ProjectDataV2 = {
    schemaVersion: 2,
    elements,
    evidence,
    ...meta,
  };
  const file: WorkspaceFileV1 = {
    fileVersion: 1,
    exportedAt: new Date().toISOString(),
    projectV2,
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

  // Validate equipment + evidence (and origin, factories, etc.) through validateProjectDataV2
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

/** Extract ProjectMeta from a validated ProjectDataV2. */
export function extractMeta(pv2: ProjectDataV2): ProjectMeta {
  const { schemaVersion: _sv, elements: _el, evidence: _ev, ...meta } = pv2;
  return meta;
}
