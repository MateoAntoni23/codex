/**
 * libraryBlock — la "biblioteca" (calibración del usuario) como bloque de archivo
 * y las reglas para no destruirla al abrir un proyecto.
 *
 * La biblioteca = overrides de mapping + approvals + aporteOverrides del
 * `catalogConfigStore`. Su autoridad en esta máquina es `localStorage`
 * (`codex:catalogConfig:v1`). Reglas del hito 1:
 *   - Abrir/importar un proyecto NO modifica la biblioteca local.
 *   - Si el archivo trae una copia distinta, se avisa y el usuario elige:
 *     seguir con la local (por defecto), adoptar la del archivo, o cancelar.
 *   - Adoptar guarda antes una copia de la biblioteca anterior bajo otra clave
 *     (`codex:catalogConfig:v1:backup:<ISO>`).
 *   - Un archivo sin bloque de biblioteca no cambia nada.
 *
 * Archivos fileVersion 1 sólo traen `catalogConfig.overrides`: se interpretan como
 * bloque PARCIAL (sólo overrides). Comparar/adoptar un bloque parcial no toca
 * approvals ni aporteOverrides locales.
 */
import type { ProductPortMapping } from '../workspace/catalogPortMapping';
import type { PatternApproval } from './patternApprovals';
import { isAporteRule, type AporteRule } from './aporteTrazado';

export const LIBRARY_BLOCK_VERSION = 'codex:library/1';
export const LIBRARY_STORAGE_KEY = 'codex:catalogConfig:v1';
export const LIBRARY_BACKUP_PREFIX = 'codex:catalogConfig:v1:backup:';

export interface LibrarySnapshot {
  overrides: Record<string, ProductPortMapping>;
  approvals: Record<string, PatternApproval>;
  aporteOverrides: Record<string, AporteRule>;
}

/** Bloque de biblioteca tal como viaja en el archivo de proyecto (fileVersion 2). */
export interface LibraryBlock extends LibrarySnapshot {
  version: typeof LIBRARY_BLOCK_VERSION;
}

/** Biblioteca leída de un archivo: completa (v2) o sólo overrides (v1). */
export interface FileLibrary {
  /** `true` si el archivo sólo trae overrides (fileVersion 1). */
  partial: boolean;
  overrides: Record<string, ProductPortMapping>;
  approvals?: Record<string, PatternApproval>;
  aporteOverrides?: Record<string, AporteRule>;
}

export const emptyLibrary = (): LibrarySnapshot => ({
  overrides: {},
  approvals: {},
  aporteOverrides: {},
});

export function isLibraryEmpty(l: LibrarySnapshot): boolean {
  return (
    Object.keys(l.overrides).length === 0 &&
    Object.keys(l.approvals).length === 0 &&
    Object.keys(l.aporteOverrides).length === 0
  );
}

/** JSON con claves ordenadas: igualdad estructural independiente del orden. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** ¿La biblioteca del archivo difiere de la local? (parcial: sólo overrides). */
export function libraryDiffers(local: LibrarySnapshot, file: FileLibrary): boolean {
  if (canonicalJson(local.overrides) !== canonicalJson(file.overrides)) return true;
  if (file.partial) return false;
  return (
    canonicalJson(local.approvals) !== canonicalJson(file.approvals ?? {}) ||
    canonicalJson(local.aporteOverrides) !== canonicalJson(file.aporteOverrides ?? {})
  );
}

/** Resumen legible de las diferencias, para el aviso al usuario. */
export function describeLibraryDiff(local: LibrarySnapshot, file: FileLibrary): string[] {
  const lines: string[] = [];
  const cmp = (label: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    if (canonicalJson(a) === canonicalJson(b)) return;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    const onlyLocal = ka.filter((k) => !(k in b)).length;
    const onlyFile = kb.filter((k) => !(k in a)).length;
    const changed = ka.filter((k) => k in b && canonicalJson(a[k]) !== canonicalJson(b[k])).length;
    lines.push(
      `${label}: local ${ka.length}, archivo ${kb.length} (${onlyLocal} sólo local, ${onlyFile} sólo archivo, ${changed} distintos)`,
    );
  };
  cmp('Calibraciones (overrides)', local.overrides, file.overrides);
  if (!file.partial) {
    cmp('Aprobaciones', local.approvals, file.approvals ?? {});
    cmp('Aporte al trazado', local.aporteOverrides, file.aporteOverrides ?? {});
  }
  return lines;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseOverrides(raw: unknown, ctx: string): Record<string, ProductPortMapping> {
  if (!isObj(raw)) throw new Error(`${ctx}: overrides debe ser un objeto`);
  const out: Record<string, ProductPortMapping> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isObj(value)) throw new Error(`${ctx}: override "${id}" inválido`);
    if (value.source !== 'default' && value.source !== 'override') {
      throw new Error(`${ctx}: "${id}".source inválido`);
    }
    if (!Array.isArray(value.entries)) throw new Error(`${ctx}: "${id}".entries debe ser array`);
    out[id] = value as unknown as ProductPortMapping;
  }
  return out;
}

function parseApprovals(raw: unknown): Record<string, PatternApproval> {
  if (!isObj(raw)) throw new Error('library: approvals debe ser un objeto');
  const out: Record<string, PatternApproval> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (
      !isObj(v) ||
      typeof v.approvedAtRevision !== 'number' ||
      typeof v.approvedAtCalibrationHash !== 'string' ||
      typeof v.approvedAt !== 'string'
    ) {
      throw new Error(`library: aprobación "${id}" inválida`);
    }
    out[id] = v as unknown as PatternApproval;
  }
  return out;
}

function parseAporte(raw: unknown): Record<string, AporteRule> {
  if (!isObj(raw)) throw new Error('library: aporteOverrides debe ser un objeto');
  const out: Record<string, AporteRule> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!isAporteRule(v)) throw new Error(`library: aporte "${id}" inválido`);
    out[id] = v;
  }
  return out;
}

/** Valida un bloque `library` de un archivo fileVersion 2 (los tres mapas obligatorios). */
export function parseLibraryBlock(raw: unknown): FileLibrary | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) throw new Error('library: bloque inválido');
  if (raw.version !== LIBRARY_BLOCK_VERSION) {
    throw new Error(`library: versión no soportada (${String(raw.version)})`);
  }
  return {
    partial: false,
    overrides: parseOverrides(raw.overrides, 'library'),
    approvals: parseApprovals(raw.approvals),
    aporteOverrides: parseAporte(raw.aporteOverrides),
  };
}

/** Bloque parcial a partir del `catalogConfig` de un archivo fileVersion 1. */
export function libraryFromCatalogConfig(overrides: Record<string, ProductPortMapping>): FileLibrary {
  return { partial: true, overrides };
}

/** Arma el bloque de archivo; `null` si la biblioteca está vacía (no se escribe). */
export function toLibraryBlock(l: LibrarySnapshot): LibraryBlock | null {
  if (isLibraryEmpty(l)) return null;
  return {
    version: LIBRARY_BLOCK_VERSION,
    overrides: l.overrides,
    approvals: l.approvals,
    aporteOverrides: l.aporteOverrides,
  };
}

/**
 * Guarda una copia de la biblioteca local ANTERIOR bajo otra clave de localStorage.
 * Devuelve la clave, o `null` si localStorage no está disponible/falla.
 * Si no había nada guardado, la copia contiene la biblioteca vacía serializada.
 */
export function backupLocalLibrary(current: LibrarySnapshot): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const key = `${LIBRARY_BACKUP_PREFIX}${new Date().toISOString()}`;
    const raw =
      localStorage.getItem(LIBRARY_STORAGE_KEY) ??
      JSON.stringify({
        version: 'codex:catalogConfig/1',
        ...current,
        savedAt: new Date().toISOString(),
      });
    localStorage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}
