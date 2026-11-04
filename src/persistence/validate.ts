import { SCHEMA_VERSION, type ProjectData } from './schema';
import type { DomainObject, ObjectType, Vec3mm } from '../types/domain';

const KNOWN_TYPES: ReadonlySet<string> = new Set(['floor', 'building', 'panel', 'motor']);

function assertFinite(val: unknown, field: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`${field} debe ser un número finito, se recibió: ${JSON.stringify(val)}`);
  }
  return val;
}

function validateVec3mm(raw: unknown, path: string): Vec3mm {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} debe ser un objeto, se recibió: ${JSON.stringify(raw)}`);
  }
  const obj = raw as Record<string, unknown>;
  return {
    x: assertFinite(obj.x, `${path}.x`),
    y: assertFinite(obj.y, `${path}.y`),
    z: assertFinite(obj.z, `${path}.z`),
  };
}

function validateDimensions(
  raw: unknown,
  path: string,
  type: ObjectType,
): { width: number; depth: number; height: number } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path} debe ser un objeto`);
  }
  const d = raw as Record<string, unknown>;
  const width = assertFinite(d.width, `${path}.width`);
  const depth = assertFinite(d.depth, `${path}.depth`);
  const height = assertFinite(d.height, `${path}.height`);

  if (width <= 0) throw new Error(`${path}.width debe ser positivo`);
  if (depth <= 0) throw new Error(`${path}.depth debe ser positivo`);
  if (height < 0) throw new Error(`${path}.height no puede ser negativo`);
  // height=0 is only valid for 'floor' (flat plane)
  if (type !== 'floor' && height === 0) {
    throw new Error(`${path}.height debe ser positivo para tipo "${type}"`);
  }
  return { width, depth, height };
}

function validateObject(raw: unknown, index: number): DomainObject {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`objeto[${index}] debe ser un objeto`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    throw new Error(`objeto[${index}].id debe ser un string no vacío`);
  }
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    throw new Error(`objeto[${index}].name debe ser un string no vacío`);
  }
  if (typeof obj.type !== 'string' || !KNOWN_TYPES.has(obj.type)) {
    throw new Error(`objeto[${index}].type desconocido: "${String(obj.type)}"`);
  }

  const type = obj.type as ObjectType;
  const position = validateVec3mm(obj.position, `objeto[${index}].position`);
  const dimensions = validateDimensions(obj.dimensions, `objeto[${index}].dimensions`, type);

  return { id: obj.id, name: obj.name, type, position, dimensions };
}

/** Valida en tiempo de ejecución un ProjectData crudo. Lanza Error si es inválido. */
export function validateProjectData(raw: unknown): ProjectData {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('El archivo no contiene un objeto JSON válido');
  }
  const data = raw as Record<string, unknown>;

  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Versión de esquema incompatible: se esperaba ${SCHEMA_VERSION}, se recibió ${JSON.stringify(data.schemaVersion)}`,
    );
  }

  if (!Array.isArray(data.objects)) {
    throw new Error('objects debe ser un array');
  }

  const objects: DomainObject[] = data.objects.map((obj, i) => validateObject(obj, i));

  const ids = new Set<string>();
  for (const obj of objects) {
    if (ids.has(obj.id)) {
      throw new Error(`ID duplicado: "${obj.id}"`);
    }
    ids.add(obj.id);
  }

  const projectOrigin = validateVec3mm(data.projectOrigin, 'projectOrigin');

  return { schemaVersion: SCHEMA_VERSION, objects, projectOrigin };
}
