import type { EquipmentElement, FieldEvidence, ProjectDataV2 } from '../types/domain-v2';
import type { TrayInput } from '../tray/model';
import { assertInput } from '../tray/model';
import { validateProjectDataV2 } from '../persistence/validate-v2';
import type { ProductPortMapping } from './catalogPortMapping';
import type { ImportedCatalog } from '../import/types';
import { validarCircuitosDeArchivo } from './recorridos/circuitosGuardados';
import {
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

/**
 * Formato de archivo de proyecto vigente: fileVersion 3 (2026-11-13, etapa 1 —
 * circuitos de equipo a equipo).
 *
 * El proyecto completo: equipos y evidencia dentro de un ProjectDataV2 (se
 * validan con validateProjectDataV2), el trazado (`trayInput`, con sus claves
 * workspace-only: definiciones, enganches, bajadas, circuitos guardados), el
 * bloque `library` (copia COMPLETA de la biblioteca del usuario; se omite si
 * está vacía) y el catálogo importado.
 *
 * CORTE LIMPIO (declarado por el operador, 2026-11-13: no hay proyectos
 * guardados): un archivo de una versión anterior (fileVersion 1 ó 2) NO se abre.
 * La app avisa que no es compatible y no intenta repararlo ni migrarlo.
 */
export const FILE_VERSION = 3;

export interface WorkspaceFileV3 {
  fileVersion: 3;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
  library?: LibraryBlock;
  importedCatalog?: ImportedCatalogBlock;
}

/**
 * Resultado de leer un archivo v3. `library` es la biblioteca que trae el
 * archivo; `null` si no trae ninguna, en cuyo caso abrirlo no debe tocar la
 * biblioteca local.
 */
export interface ParsedWorkspaceFile {
  fileVersion: 3;
  exportedAt: string;
  projectV2: ProjectDataV2;
  trayInput: TrayInput;
  library: FileLibrary | null;
  importedCatalog?: ImportedCatalogBlock;
}

/** Aviso al abrir un archivo de una versión anterior: no es compatible y no se repara. */
export function motivoVersionNoCompatible(fileVersion: unknown): string {
  return typeof fileVersion === 'number' && fileVersion < FILE_VERSION
    ? `El archivo es de una versión anterior de la app (versión de archivo ${fileVersion}) y no es compatible con esta (versión ${FILE_VERSION}). No se intenta repararlo.`
    : `Versión de archivo no soportada: ${String(fileVersion)}`;
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
    /** B-2.5: calibración por patrón. */
    calibracion?: LibrarySnapshot['calibracion'];
  },
): string {
  const projectV2: ProjectDataV2 = {
    schemaVersion: 2,
    elements,
    evidence,
    ...meta,
  };
  const file: WorkspaceFileV3 = {
    fileVersion: 3,
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
    ...(library?.calibracion ? { calibracion: library.calibracion } : {}),
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

  if (obj.fileVersion !== FILE_VERSION) throw new Error(motivoVersionNoCompatible(obj.fileVersion));

  // Validate equipment + evidence (and origin, factories, etc.) through validateProjectDataV2
  const projectV2 = validateProjectDataV2(obj.projectV2);

  // Validate tray input — assertInput throws on invalid contracts
  assertInput(obj.trayInput);
  // Circuitos guardados: extremos de equipo (los de boca, formato anterior, se rechazan).
  validarCircuitosDeArchivo(obj.trayInput);

  const library: FileLibrary | null = parseLibraryBlock(obj.library);
  const importedCatalog = parseImportedCatalog(obj.importedCatalog);

  return {
    fileVersion: FILE_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    projectV2,
    trayInput: obj.trayInput as TrayInput,
    library,
    ...(importedCatalog ? { importedCatalog } : {}),
  };
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
