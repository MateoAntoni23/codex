import type { EquipmentElement, FieldEvidence } from '../types/domain-v2';
import type { TrayInput } from '../tray/model';
import { assertInput } from '../tray/model';

export interface WorkspaceFileV1 {
  fileVersion: 1;
  exportedAt: string;
  equipment: EquipmentElement[];
  evidence: FieldEvidence[];
  trayInput: TrayInput;
}

export function exportWorkspace(
  equipment: EquipmentElement[],
  evidence: FieldEvidence[],
  trayInput: TrayInput,
): string {
  const file: WorkspaceFileV1 = {
    fileVersion: 1,
    exportedAt: new Date().toISOString(),
    equipment,
    evidence,
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
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new Error('Formato de archivo inválido');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.fileVersion !== 1) {
    throw new Error(`Versión de archivo no soportada: ${String(obj.fileVersion)}`);
  }
  if (!Array.isArray(obj.equipment)) {
    throw new Error('El campo "equipment" debe ser un array');
  }
  if (!Array.isArray(obj.evidence)) {
    throw new Error('El campo "evidence" debe ser un array');
  }
  assertInput(obj.trayInput);
  return {
    fileVersion: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    equipment: obj.equipment as EquipmentElement[],
    evidence: obj.evidence as FieldEvidence[],
    trayInput: obj.trayInput as TrayInput,
  };
}
