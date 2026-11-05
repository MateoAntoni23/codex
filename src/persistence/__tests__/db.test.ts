import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  _setIdbFactory,
  _resetIdbFactory,
  _setDbForTesting,
  loadProjectFromDb,
  saveProjectToDb,
  getDb,
  readActiveFormat,
  readV2ProjectFromDb,
  saveV2ProjectToDb,
  registerVersionChangeListener,
  DB_NAME,
  STORE_NAME,
  PROJECT_KEY,
  BACKUP_STORE,
  V2_STORE,
  CONFIG_STORE,
  ACTIVE_FORMAT_KEY,
  V2WriteError,
  type ActiveFormatMetadata,
} from '../db';
import { SCHEMA_VERSION, type ProjectData } from '../schema';

const SAMPLE: ProjectData = {
  schemaVersion: SCHEMA_VERSION,
  projectOrigin: { x: 100, y: 200, z: 300 },
  objects: [
    {
      id: 'panel-1',
      name: 'Tablero',
      type: 'panel',
      position: { x: -7000, y: 2000, z: 1000 },
      dimensions: { width: 800, depth: 400, height: 2000 },
    },
  ],
};

beforeEach(() => {
  _setIdbFactory(new IDBFactory());
});

afterEach(() => {
  _resetIdbFactory();
});

// ─── Tests existentes (comportamiento v1) ─────────────────────────────────────

describe('loadProjectFromDb', () => {
  it('devuelve null si no hay datos guardados', async () => {
    const result = await loadProjectFromDb();
    expect(result).toBeNull();
  });
});

describe('saveProjectToDb + loadProjectFromDb', () => {
  it('guarda y recupera el proyecto correctamente', async () => {
    await saveProjectToDb(SAMPLE);
    const loaded = await loadProjectFromDb();
    expect(loaded).toEqual(SAMPLE);
  });

  it('sobrescribe con la última escritura', async () => {
    await saveProjectToDb(SAMPLE);
    const updated: ProjectData = {
      ...SAMPLE,
      projectOrigin: { x: 500, y: 600, z: 700 },
    };
    await saveProjectToDb(updated);
    const loaded = await loadProjectFromDb();
    expect(loaded?.projectOrigin).toEqual({ x: 500, y: 600, z: 700 });
  });

  it('conserva posiciones y origen con precisión exacta', async () => {
    const data: ProjectData = {
      ...SAMPLE,
      projectOrigin: { x: -1234, y: 5678, z: 999 },
      objects: [
        {
          ...SAMPLE.objects[0],
          position: { x: -7000, y: 2000, z: 1000 },
        },
      ],
    };
    await saveProjectToDb(data);
    const loaded = await loadProjectFromDb();
    expect(loaded?.objects[0].position).toEqual({ x: -7000, y: 2000, z: 1000 });
    expect(loaded?.projectOrigin).toEqual({ x: -1234, y: 5678, z: 999 });
  });

  it('carga aislada entre tests (cada test usa una DB fresca)', async () => {
    const result = await loadProjectFromDb();
    expect(result).toBeNull();
  });
});

describe('saveProjectToDb — aborto de transacción', () => {
  it('rechaza cuando la transacción aborta después del put', async () => {
    const abortErr = new DOMException('abort test', 'AbortError');

    const mockTx = {
      objectStore: () => ({ put: () => ({}) }),
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
      error: abortErr,
    };

    const mockDb = {
      transaction: () => mockTx,
    } as unknown as IDBDatabase;

    _setDbForTesting(mockDb);

    const p = saveProjectToDb(SAMPLE);
    await Promise.resolve();
    mockTx.onabort?.();

    await expect(p).rejects.toBe(abortErr);
  });
});

// ─── I1: upgrade DB v2 → v3 conserva stores y datos ─────────────────────────

describe('I1: upgrade v2→v3 — conserva todos los stores y datos', () => {
  it('upgrade desde DB v2 existente preserva project, backups y project-v2', async () => {
    const factory = new IDBFactory();

    // Crea manualmente la DB a versión 2 con datos en los 3 stores
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME, 2);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (event.oldVersion < 1) db.createObjectStore(STORE_NAME);
        if (event.oldVersion < 2) {
          db.createObjectStore(BACKUP_STORE);
          db.createObjectStore(V2_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction([STORE_NAME, BACKUP_STORE, V2_STORE], 'readwrite');
        tx.objectStore(STORE_NAME).put(SAMPLE, PROJECT_KEY);
        tx.objectStore(BACKUP_STORE).put({ id: 'bk-1', kind: 'migration' }, 'bk-1');
        tx.objectStore(V2_STORE).put({ schemaVersion: 2 }, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Abre con nuestro módulo (versión 3) — trigger upgrade
    _setIdbFactory(factory);
    const loaded = await loadProjectFromDb();
    expect(loaded).toEqual(SAMPLE);

    // Verifica que backup y v2 se conservaron
    const db = await getDb();
    const backup = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_STORE).get('bk-1');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(backup).toEqual({ id: 'bk-1', kind: 'migration' });

    const v2data = await readV2ProjectFromDb();
    expect(v2data).toEqual({ schemaVersion: 2 });

    // CONFIG_STORE existe y está vacío (no activa v2)
    const activeFmt = await readActiveFormat();
    expect(activeFmt).toBeNull();
  });

  it('DB v3 fresca tiene los 4 stores y CONFIG_STORE vacío', async () => {
    // loadProjectFromDb abre la DB y dispara el upgrade desde 0 → 3
    const loaded = await loadProjectFromDb();
    expect(loaded).toBeNull();

    const db = await getDb();
    expect(Array.from(db.objectStoreNames)).toContain(STORE_NAME);
    expect(Array.from(db.objectStoreNames)).toContain(BACKUP_STORE);
    expect(Array.from(db.objectStoreNames)).toContain(V2_STORE);
    expect(Array.from(db.objectStoreNames)).toContain(CONFIG_STORE);

    const activeFmt = await readActiveFormat();
    expect(activeFmt).toBeNull();
  });
});

// ─── I1: readActiveFormat ─────────────────────────────────────────────────────

describe('I1: readActiveFormat', () => {
  it('devuelve null cuando no hay metadatos (formato v1 activo)', async () => {
    const result = await readActiveFormat();
    expect(result).toBeNull();
  });

  it('devuelve los metadatos cuando están escritos manualmente', async () => {
    const db = await getDb();
    const meta: ActiveFormatMetadata = { version: 2, generation: 7 };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CONFIG_STORE, 'readwrite');
      tx.objectStore(CONFIG_STORE).put(meta, ACTIVE_FORMAT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const result = await readActiveFormat();
    expect(result).toEqual({ version: 2, generation: 7 });
  });
});

// ─── I1: saveV2ProjectToDb — validación de formato y generación ───────────────

// Datos v2 mínimos válidos para tests (tipo opaco — solo verificamos que se guarda)
const SAMPLE_V2 = { schemaVersion: 2 as const } as import('../schema-v2').ProjectDataV2;

async function writeActiveFormat(db: IDBDatabase, meta: ActiveFormatMetadata): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, 'readwrite');
    tx.objectStore(CONFIG_STORE).put(meta, ACTIVE_FORMAT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('I1: saveV2ProjectToDb — rechazo cuando formato no está activo', () => {
  it('rechaza con FORMAT_NOT_ACTIVE si no hay metadatos (v1 activo)', async () => {
    const err = await saveV2ProjectToDb(SAMPLE_V2, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2WriteError);
    expect((err as V2WriteError).code).toBe('FORMAT_NOT_ACTIVE');
  });

  it('rechaza con FORMAT_NOT_ACTIVE si los metadatos no son versión 2', async () => {
    const db = await getDb();
    // Escribe algo inválido como metadato
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CONFIG_STORE, 'readwrite');
      tx.objectStore(CONFIG_STORE).put({ version: 1 }, ACTIVE_FORMAT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const err = await saveV2ProjectToDb(SAMPLE_V2, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2WriteError);
    expect((err as V2WriteError).code).toBe('FORMAT_NOT_ACTIVE');
  });

  it('rechaza con GENERATION_MISMATCH si la generación no coincide', async () => {
    const db = await getDb();
    await writeActiveFormat(db, { version: 2, generation: 5 });

    // Pasamos generación 3 cuando la actual es 5
    const err = await saveV2ProjectToDb(SAMPLE_V2, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(V2WriteError);
    expect((err as V2WriteError).code).toBe('GENERATION_MISMATCH');
  });
});

describe('I1: saveV2ProjectToDb — éxito incrementa generación atómicamente', () => {
  it('escribe los datos y actualiza la generación en la misma transacción', async () => {
    const db = await getDb();
    await writeActiveFormat(db, { version: 2, generation: 0 });

    await saveV2ProjectToDb(SAMPLE_V2, 0);

    const v2 = await readV2ProjectFromDb();
    expect(v2).toEqual(SAMPLE_V2);

    const meta = await readActiveFormat();
    expect(meta).toEqual({ version: 2, generation: 1 });
  });

  it('múltiples escrituras incrementan la generación secuencialmente', async () => {
    const db = await getDb();
    await writeActiveFormat(db, { version: 2, generation: 0 });

    await saveV2ProjectToDb(SAMPLE_V2, 0);
    await saveV2ProjectToDb(SAMPLE_V2, 1);
    await saveV2ProjectToDb(SAMPLE_V2, 2);

    const meta = await readActiveFormat();
    expect(meta?.generation).toBe(3);
  });

  it('escritura v2 fallida no modifica datos ni metadatos', async () => {
    const db = await getDb();
    await writeActiveFormat(db, { version: 2, generation: 4 });

    // Guardamos datos iniciales para comparar después
    await saveV2ProjectToDb({ ...SAMPLE_V2, schemaVersion: 2 } as typeof SAMPLE_V2, 4);
    const metaBefore = await readActiveFormat();
    expect(metaBefore?.generation).toBe(5);

    // Intento con generación incorrecta — debe rechazar sin modificar nada
    await saveV2ProjectToDb(SAMPLE_V2, 99).catch(() => {});

    const metaAfter = await readActiveFormat();
    expect(metaAfter?.generation).toBe(5); // sin cambios
  });
});

describe('I1: saveV2ProjectToDb — aborto conserva project v1 y metadatos', () => {
  it('un aborto en la tx v2 no modifica el proyecto v1 activo', async () => {
    // Escribe v1 y activa v2
    await saveProjectToDb(SAMPLE);
    const db = await getDb();
    await writeActiveFormat(db, { version: 2, generation: 0 });

    // Primera escritura v2 correcta
    await saveV2ProjectToDb(SAMPLE_V2, 0);

    // Segunda escritura con generación incorrecta (debe abortar)
    await saveV2ProjectToDb(SAMPLE_V2, 0).catch(() => {});

    // El proyecto v1 no fue tocado
    const v1 = await loadProjectFromDb();
    expect(v1).toEqual(SAMPLE);

    // La generación sigue siendo 1 (no fue sobrescrita)
    const meta = await readActiveFormat();
    expect(meta?.generation).toBe(1);
  });
});

// ─── I1: registerVersionChangeListener ───────────────────────────────────────

describe('I1: versionchange — cierra conexión e invalida caché', () => {
  it('el callback registrado se invoca cuando se dispara versionchange', async () => {
    const db = await getDb();

    let versionChangeFired = false;
    const unsubscribe = registerVersionChangeListener(() => {
      versionChangeFired = true;
    });

    // fake-indexeddb no simula tabs concurrentes; llamamos al handler directamente,
    // que es lo que openDatabase instala en db.onversionchange
    (db as IDBDatabase & { onversionchange: (() => void) | null }).onversionchange?.();

    expect(versionChangeFired).toBe(true);

    unsubscribe();
  });

  it('unsubscribe previene invocación posterior del callback', async () => {
    await getDb();

    let callCount = 0;
    const unsubscribe = registerVersionChangeListener(() => { callCount++; });

    unsubscribe(); // desregistrar antes de disparar

    const db = await getDb();
    (db as IDBDatabase & { onversionchange: (() => void) | null }).onversionchange?.();

    expect(callCount).toBe(0);
  });
});
