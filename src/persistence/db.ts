import type { ProjectData } from './schema';
import type { ProjectDataV2 } from './schema-v2';

export const DB_NAME = 'codex-cable-tray-v1';
export const STORE_NAME = 'project';
export const PROJECT_KEY = 'current';
/** Object store para respaldos de migración v1→v2 y proyectos desplazados. */
export const BACKUP_STORE = 'migration-backups';
/** Object store para el proyecto v2 preparado (inactivo hasta activación en I_act). */
export const V2_STORE = 'project-v2';
export const V2_KEY = 'current';
/** Object store para metadatos de formato activo. Creado en DB v3; no activa v2. */
export const CONFIG_STORE = 'config';
export const ACTIVE_FORMAT_KEY = 'active-format';

/**
 * Metadatos escritos en CONFIG_STORE cuando v2 está activo.
 * Ausencia de esta entrada (null) significa formato activo v1.
 */
export interface ActiveFormatMetadata {
  version: 2;
  generation: number;
}

export type V2WriteErrorCode = 'FORMAT_NOT_ACTIVE' | 'GENERATION_MISMATCH' | 'TRANSACTION_ABORTED';

export class V2WriteError extends Error {
  readonly code: V2WriteErrorCode;
  constructor(code: V2WriteErrorCode, message: string) {
    super(message);
    this.name = 'V2WriteError';
    this.code = code;
  }
}

// DB version history:
//   1 — esquema inicial: solo 'project'
//   2 — agrega 'migration-backups' y 'project-v2' para M1b
//   3 — agrega 'config' para metadatos de formato activo (I1); estructural, NO activa v2
const DB_VERSION = 3;

// Injectable factory — override in tests with fake-indexeddb
let _factory: IDBFactory | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;
let _versionChangeListeners: Set<() => void> = new Set();

/** Override the IDBFactory used by all DB operations. Resets the cached connection. */
export function _setIdbFactory(factory: IDBFactory): void {
  _factory = factory;
  _dbPromise = null;
}

/** Inject an already-open IDBDatabase (skips openDatabase). For testing tx-level errors. */
export function _setDbForTesting(db: IDBDatabase): void {
  _dbPromise = Promise.resolve(db);
}

/** Restore the global IDBFactory and reset the cached connection. */
export function _resetIdbFactory(): void {
  _factory = null;
  _dbPromise = null;
  _versionChangeListeners.clear();
}

/**
 * Registra un callback que se invoca cuando la conexión recibe un evento versionchange
 * (otra pestaña o contexto está actualizando la BD). Retorna una función de cancelación.
 * No introduce dependencias circulares: db.ts solo almacena la función; el caller decide qué hacer.
 */
export function registerVersionChangeListener(cb: () => void): () => void {
  _versionChangeListeners.add(cb);
  return () => {
    _versionChangeListeners.delete(cb);
  };
}

function notifyVersionChange(): void {
  _versionChangeListeners.forEach((cb) => cb());
}

function getFactory(): IDBFactory {
  if (_factory != null) return _factory;
  if (typeof indexedDB !== 'undefined') return indexedDB;
  throw new Error('IndexedDB no está disponible en este entorno');
}

function openDatabase(): Promise<IDBDatabase> {
  if (_dbPromise != null) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    // settled prevents a late onsuccess (after onblocked rejected) from resolving a new promise
    let settled = false;
    const req = getFactory().open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Versión 1: store de proyecto activo v1
      if (event.oldVersion < 1) {
        db.createObjectStore(STORE_NAME);
      }
      // Versión 2: agrega stores de migración (no modifica datos existentes)
      if (event.oldVersion < 2) {
        db.createObjectStore(BACKUP_STORE);
        db.createObjectStore(V2_STORE);
      }
      // Versión 3: agrega store de metadatos de configuración (estructural, no activa v2)
      if (event.oldVersion < 3) {
        db.createObjectStore(CONFIG_STORE);
      }
    };
    req.onsuccess = () => {
      if (settled) return; // onblocked ya rechazó; ignorar esta apertura tardía
      settled = true;
      const db = req.result;
      // Cierra la conexión y notifica si otra pestaña necesita actualizar el esquema
      db.onversionchange = () => {
        _dbPromise = null;
        db.close();
        notifyVersionChange();
      };
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      _dbPromise = null; // Permite reintentar la conexión en la próxima llamada
      reject(req.error);
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      // Invalidamos la caché para que el próximo intento no reutilice esta apertura bloqueada
      _dbPromise = null;
      reject(new Error('La base de datos está bloqueada por otra pestaña'));
    };
  });
  return _dbPromise;
}

/**
 * Returns the open IDBDatabase instance (shared across modules).
 * Used by migration-backup.ts for multi-store transactions.
 */
export async function getDb(): Promise<IDBDatabase> {
  return openDatabase();
}

export async function loadProjectFromDb(): Promise<ProjectData | null> {
  const db = await openDatabase();
  return new Promise<ProjectData | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(PROJECT_KEY);
    req.onsuccess = () => resolve((req.result as ProjectData) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectToDb(data: ProjectData): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, PROJECT_KEY);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada al guardar'));
    tx.onerror = () => reject(tx.error ?? new Error('Error en la transacción al guardar'));
  });
}

/** Lee los metadatos del formato activo. null = formato v1 activo (sin entrada). */
export async function readActiveFormat(): Promise<ActiveFormatMetadata | null> {
  const db = await openDatabase();
  return new Promise<ActiveFormatMetadata | null>((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, 'readonly');
    const req = tx.objectStore(CONFIG_STORE).get(ACTIVE_FORMAT_KEY);
    req.onsuccess = () => resolve((req.result as ActiveFormatMetadata) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Lee el proyecto v2 preparado. null si no hay ninguno almacenado. */
export async function readV2ProjectFromDb(): Promise<ProjectDataV2 | null> {
  const db = await openDatabase();
  return new Promise<ProjectDataV2 | null>((resolve, reject) => {
    const tx = db.transaction(V2_STORE, 'readonly');
    const req = tx.objectStore(V2_STORE).get(V2_KEY);
    req.onsuccess = () => resolve((req.result as ProjectDataV2) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Guarda el proyecto v2 en una transacción atómica que:
 *   1. Lee config/active-format dentro de la misma tx.
 *   2. Rechaza con FORMAT_NOT_ACTIVE si el formato activo no es v2.
 *   3. Rechaza con GENERATION_MISMATCH si la generación no coincide.
 *   4. Escribe los datos v2 y actualiza la generación (+1) de forma atómica.
 *
 * Esta función requiere que v2 ya esté activo (I_act). No activa v2 por sí sola.
 */
export async function saveV2ProjectToDb(data: ProjectDataV2, expectedGeneration: number): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    let earlyError: V2WriteError | null = null;

    const tx = db.transaction([V2_STORE, CONFIG_STORE], 'readwrite');

    const metaReq = tx.objectStore(CONFIG_STORE).get(ACTIVE_FORMAT_KEY);
    metaReq.onsuccess = () => {
      const meta = metaReq.result as ActiveFormatMetadata | undefined;
      if (meta == null || meta.version !== 2) {
        earlyError = new V2WriteError('FORMAT_NOT_ACTIVE', 'El formato v2 no está activo');
        tx.abort();
        return;
      }
      if (meta.generation !== expectedGeneration) {
        earlyError = new V2WriteError(
          'GENERATION_MISMATCH',
          `Generación esperada ${expectedGeneration}, actual ${meta.generation}`,
        );
        tx.abort();
        return;
      }
      tx.objectStore(V2_STORE).put(data, V2_KEY);
      const updated: ActiveFormatMetadata = { version: 2, generation: meta.generation + 1 };
      tx.objectStore(CONFIG_STORE).put(updated, ACTIVE_FORMAT_KEY);
    };
    metaReq.onerror = () => {
      if (earlyError == null) {
        earlyError = new V2WriteError(
          'TRANSACTION_ABORTED',
          metaReq.error?.message ?? 'Error al leer metadatos de formato',
        );
      }
    };

    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(earlyError ?? tx.error ?? new Error('Transacción abortada al guardar v2'));
    tx.onerror = () =>
      reject(earlyError ?? tx.error ?? new Error('Error en la transacción al guardar v2'));
  });
}
