import type { EquipmentElement, FieldEvidence, ProjectDataV2 } from '../types/domain-v2';
import type { TrayInput } from '../tray/model';
import { assertInput } from '../tray/model';
import { validateProjectDataV2 } from '../persistence/validate-v2';
import type { ProductPortMapping } from './catalogPortMapping';
import type { ImportedCatalog } from '../import/types';
import {
  libraryFromCatalogConfig,
  parseLibraryBlock,
  toLibraryBlock,
  type FileLibrary,
  type LibraryBlock,
  type LibrarySnapshot,
} from '../configurator/libraryBlock';
import type { PatternApproval } from '../configurator/patternApprovals';
import type { AporteRule } from '../configurator/aporteTrazado';

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
 *
 * Opcional desde v1: `catalogConfig` lleva los overrides declarados en el
 * Configurador de biblioteca (mapping boca-receta ↔ puerto-catálogo). Si está
 * ausente al importar, se interpreta como "sin overrides" — equivalente a
 * limpiar la configuración. Esto hace que un proyecto sea portable entre
 * computadoras incluyendo decisiones del Configurador, sin depender de
 * localStorage del equipo.
 */
export interface CatalogConfigBlock {
  version: 'codex:catalogConfig/1';
  overrides: Record<string, ProductPortMapping>;
}

/**
 * Catálogo ELS-IMP-EQCX serializado como parte del proyecto (A11).
 * Se guarda tal cual lo devuelve el parser — así no hay pérdida entre save/load,
 * incluidos valores vigente=NO, PENDIENTES completos y trazabilidad.
 *
 * El `version` del bloque es independiente del `meta.formatoVersion`: el primero
 * describe la forma de persistencia; el segundo, el formato Excel originador.
 */
export interface ImportedCatalogBlock {
  version: 'codex:importedCatalog/1';
  catalog: ImportedCatalog;
}

export interface WorkspaceFileV1 {
  fileVersion: 1;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
  catalogConfig?: CatalogConfigBlock;
  importedCatalog?: ImportedCatalogBlock;
}

/**
 * Workspace file format v2 (hito 1).
 *
 * Igual que v1 pero con el bloque `library`: copia COMPLETA de la biblioteca del
 * usuario (overrides, approvals y aporteOverrides). Se omite si la biblioteca está
 * vacía. v2 ya no escribe `catalogConfig` (v1) — `library.overrides` lo reemplaza.
 * El lector acepta v1 y v2.
 */
export interface WorkspaceFileV2 {
  fileVersion: 2;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
  library?: LibraryBlock;
  importedCatalog?: ImportedCatalogBlock;
}

/**
 * Resultado normalizado de leer un archivo v1 o v2. `library` es la biblioteca que
 * trae el archivo (completa en v2; parcial —sólo overrides— en v1); `null` si el
 * archivo no trae ninguna, en cuyo caso abrirlo no debe tocar la biblioteca local.
 * `catalogConfig` se conserva para archivos v1 (compatibilidad de lectura).
 */
export interface ParsedWorkspaceFile {
  fileVersion: 1 | 2;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
  library: FileLibrary | null;
  catalogConfig?: CatalogConfigBlock;
  importedCatalog?: ImportedCatalogBlock;
}

export function exportWorkspace(
  elements: EquipmentElement[],
  evidence: FieldEvidence[],
  meta: ProjectMeta,
  trayInput: TrayInput,
  catalogOverrides?: Record<string, ProductPortMapping>,
  importedCatalog?: ImportedCatalog | null,
  library?: {
    approvals?: Record<string, PatternApproval>;
    aporteOverrides?: Record<string, AporteRule>;
  },
): string {
  const projectV2: ProjectDataV2 = {
    schemaVersion: 2,
    elements,
    evidence,
    ...meta,
  };
  const file: WorkspaceFileV2 = {
    fileVersion: 2,
    exportedAt: new Date().toISOString(),
    projectV2,
    trayInput,
  };
  // Biblioteca completa (overrides + approvals + aporteOverrides). Se omite si
  // está vacía — evita diffs ruidosos y avisos inútiles al abrir.
  const snapshot: LibrarySnapshot = {
    overrides: catalogOverrides ?? {},
    approvals: library?.approvals ?? {},
    aporteOverrides: library?.aporteOverrides ?? {},
  };
  const block = toLibraryBlock(snapshot);
  if (block) file.library = block;
  if (importedCatalog) {
    file.importedCatalog = {
      version: 'codex:importedCatalog/1',
      catalog: importedCatalog,
    };
  }
  return JSON.stringify(file, null, 2);
}

export function importWorkspace(raw: string): ParsedWorkspaceFile {
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

  if (obj.fileVersion !== 1 && obj.fileVersion !== 2) {
    throw new Error(`Versión de archivo no soportada: ${String(obj.fileVersion)}`);
  }
  const fileVersion: 1 | 2 = obj.fileVersion;

  // Validate equipment + evidence (and origin, factories, etc.) through validateProjectDataV2
  const projectV2 = validateProjectDataV2(obj.projectV2);

  // Validate tray input — assertInput throws on invalid contracts
  assertInput(obj.trayInput);

  // v1: sólo `catalogConfig` (overrides) → biblioteca parcial. v2: bloque `library`.
  const catalogConfig = fileVersion === 1 ? parseCatalogConfig(obj.catalogConfig) : null;
  const library: FileLibrary | null =
    fileVersion === 2
      ? parseLibraryBlock(obj.library)
      : catalogConfig
        ? libraryFromCatalogConfig(catalogConfig.overrides)
        : null;
  const importedCatalog = parseImportedCatalog(obj.importedCatalog);

  return {
    fileVersion,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    projectV2,
    trayInput: obj.trayInput as TrayInput,
    library,
    ...(catalogConfig ? { catalogConfig } : {}),
    ...(importedCatalog ? { importedCatalog } : {}),
  };
}

function parseCatalogConfig(raw: unknown): CatalogConfigBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 'codex:catalogConfig/1') {
    throw new Error(`catalogConfig: versión no soportada (${String(obj.version)})`);
  }
  if (!obj.overrides || typeof obj.overrides !== 'object' || Array.isArray(obj.overrides)) {
    throw new Error('catalogConfig: overrides debe ser un objeto');
  }
  const overrides: Record<string, ProductPortMapping> = {};
  for (const [productId, value] of Object.entries(obj.overrides)) {
    if (!value || typeof value !== 'object') {
      throw new Error(`catalogConfig: override "${productId}" inválido`);
    }
    const v = value as Record<string, unknown>;
    if (v.source !== 'default' && v.source !== 'override') {
      throw new Error(`catalogConfig: "${productId}".source inválido`);
    }
    if (!Array.isArray(v.entries)) {
      throw new Error(`catalogConfig: "${productId}".entries debe ser array`);
    }
    overrides[productId] = value as unknown as ProductPortMapping;
  }
  return { version: 'codex:catalogConfig/1', overrides };
}

function parseImportedCatalog(raw: unknown): ImportedCatalogBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 'codex:importedCatalog/1') {
    throw new Error(`importedCatalog: versión no soportada (${String(obj.version)})`);
  }
  if (!obj.catalog || typeof obj.catalog !== 'object' || Array.isArray(obj.catalog)) {
    throw new Error('importedCatalog: catalog debe ser un objeto');
  }
  const c = obj.catalog as Partial<ImportedCatalog>;
  // Validación mínima estructural — el catálogo ya pasó por el parser+validator
  // cuando se importó; acá sólo verificamos que las colecciones existan como arrays
  // para no explotar al leer. Es decisión del contrato §9 que el libro manda; una
  // revalidación completa al abrir el proyecto sería costosa y redundante.
  const arrays: Array<keyof ImportedCatalog> = [
    'equipos', 'componentes', 'atributos', 'conexiones', 'tendidos',
    'alias', 'pendientes', 'trazabilidad', 'catalogoAtributos',
  ];
  for (const k of arrays) {
    if (!Array.isArray(c[k])) {
      throw new Error(`importedCatalog.catalog.${String(k)} debe ser array`);
    }
  }
  if (!c.meta || typeof c.meta !== 'object') {
    throw new Error('importedCatalog.catalog.meta inválido');
  }
  if (!c.listas || typeof c.listas !== 'object' || Array.isArray(c.listas)) {
    throw new Error('importedCatalog.catalog.listas debe ser objeto');
  }
  return { version: 'codex:importedCatalog/1', catalog: c as ImportedCatalog };
}

/** Extract ProjectMeta from a validated ProjectDataV2. */
export function extractMeta(pv2: ProjectDataV2): ProjectMeta {
  const { schemaVersion: _sv, elements: _el, evidence: _ev, ...meta } = pv2;
  return meta;
}
