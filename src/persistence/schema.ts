import type { DomainObject, Vec3mm } from '../types/domain';

export const SCHEMA_VERSION = 1 as const;

export interface ProjectData {
  schemaVersion: typeof SCHEMA_VERSION;
  objects: DomainObject[];
  projectOrigin: Vec3mm;
}
