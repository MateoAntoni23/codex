import type { ProjectData } from './schema';

const DB_NAME = 'codex-cable-tray-v1';
const STORE_NAME = 'project';
const PROJECT_KEY = 'current';

// Injectable factory — override in tests with fake-indexeddb
let _factory: IDBFactory | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;

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
}

function getFactory(): IDBFactory {
  if (_factory != null) return _factory;
  if (typeof indexedDB !== 'undefined') return indexedDB;
  throw new Error('IndexedDB no está disponible en este entorno');
}

function openDatabase(): Promise<IDBDatabase> {
  if (_dbPromise != null) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = getFactory().open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      _dbPromise = null; // Permite reintentar la conexión en la próxima llamada
      reject(req.error);
    };
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error('La base de datos está bloqueada por otra pestaña'));
    };
  });
  return _dbPromise;
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
