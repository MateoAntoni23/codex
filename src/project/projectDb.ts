/**
 * projectDb — almacén IndexedDB del proyecto del espacio de trabajo.
 *
 * Es una base SEPARADA de la del editor inicial (`codex-cable-tray-v1`, ver
 * `src/persistence/db.ts`): distinto nombre de base, distinto esquema. Este módulo
 * nunca abre ni lee la base del editor inicial, y el editor inicial nunca abre
 * ésta, de modo que ninguno puede alterar los datos del otro (criterio A6).
 *
 * Esquema (versión 1):
 *   - object store `project`: clave `current` → ProjectRecord (último estado
 *     autoguardado); claves `corrupt:<ISO>` → registros ilegibles apartados al
 *     restaurar (para no sobrescribirlos con un estado vacío).
 *
 * Reemplaza (para el espacio de trabajo) a `src/persistence/db.ts` porque ese
 * módulo está atado al nombre/versión de la base del editor inicial y a su
 * esquema v1/v2; reutilizarlo habría obligado a compartir base.
 */
export const WORKSPACE_DB_NAME = 'codex-workspace-v1';
export const WORKSPACE_STORE = 'project';
export const CURRENT_KEY = 'current';
/**
 * Esquema del registro autoguardado. /2 desde la etapa 1 (2026-11-13), junto con
 * el archivo v3: un registro /1 es de una versión anterior y no se abre (se aparta).
 */
export const RECORD_SCHEMA = 'codex:workspaceProject/2';
/** Esquemas de versiones anteriores: no compatibles, no se reparan. */
export const RECORD_SCHEMAS_ANTERIORES: readonly string[] = ['codex:workspaceProject/1'];

export interface ProjectRecord {
  schema: typeof RECORD_SCHEMA;
  savedAt: string;
  /** Contenido del proyecto (misma forma que el archivo de proyecto, sin biblioteca). */
  project: unknown;
  /** Estado de la sesión (nombre de archivo, selección). Opcional. */
  session?: unknown;
}

let _factory: IDBFactory | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;

/** Sólo pruebas: inyecta un IDBFactory (fake-indexeddb) y reinicia la conexión. */
export function _setWorkspaceIdbFactory(f: IDBFactory | null): void {
  _factory = f;
  if (_dbPromise) void _dbPromise.then((d) => d.close()).catch(() => undefined);
  _dbPromise = null;
}

function factory(): IDBFactory {
  if (_factory) return _factory;
  if (typeof indexedDB !== 'undefined') return indexedDB;
  throw new Error('IndexedDB no está disponible en este entorno');
}

function open(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory().open(WORKSPACE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(WORKSPACE_STORE)) {
        req.result.createObjectStore(WORKSPACE_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        _dbPromise = null;
        db.close();
      };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error ?? new Error('No se pudo abrir la base del proyecto'));
    };
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error('La base del proyecto está bloqueada por otra pestaña'));
    };
  });
  return _dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T;
        const tx = db.transaction(WORKSPACE_STORE, mode);
        const req = fn(tx.objectStore(WORKSPACE_STORE));
        req.onsuccess = () => {
          result = req.result;
        };
        // En escritura se resuelve al CONFIRMAR la transacción (oncomplete), no al
        // aceptar la petición: sólo entonces el dato está realmente persistido.
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Error de IndexedDB'));
        tx.onabort = () => reject(tx.error ?? new Error('Transacción de IndexedDB abortada'));
      }),
  );
}

/** Lee el último proyecto autoguardado (o `null` si no hay). */
export async function readCurrentRecord(): Promise<unknown | null> {
  const v = await run('readonly', (s) => s.get(CURRENT_KEY));
  return v ?? null;
}

/** Escribe el estado actual. Rechaza si IndexedDB falla (cuota, bloqueo, etc.). */
export async function writeCurrentRecord(record: ProjectRecord): Promise<void> {
  await run('readwrite', (s) => s.put(record, CURRENT_KEY));
}

/** Aparta un registro ilegible bajo `corrupt:<ISO>` y borra `current`. */
export async function quarantineCurrentRecord(raw: unknown): Promise<string> {
  const key = `corrupt:${new Date().toISOString()}`;
  await run('readwrite', (s) => s.put(raw, key));
  await run('readwrite', (s) => s.delete(CURRENT_KEY));
  return key;
}

/** Borra el proyecto autoguardado (acción "nuevo proyecto" no lo usa: escribe vacío). */
export async function deleteCurrentRecord(): Promise<void> {
  await run('readwrite', (s) => s.delete(CURRENT_KEY));
}
