/**
 * Tests de M1b: respaldo transaccional y recuperación para migración v1→v2.
 *
 * Cobertura:
 *  T1 — Migración exitosa conserva respaldo exacto
 *  T2 — Aborto tras escritura revierte toda la transacción (vía STALE_V1_DATA)
 *  T3 — Entrada inválida no altera almacenamiento
 *  T4 — Proyecto cambiado durante preparación no se sobrescribe
 *  T5 — Respaldo existente se conserva (BACKUP_EXISTS)
 *  T6 — Restauración recupera contenido y conserva estado desplazado
 *  T7 — Instalación desde BD existente v1 funciona sin pérdida de datos
 *  T8 — Las pruebas v1 existentes siguen pasando (integración db.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  _setIdbFactory,
  _setDbForTesting,
  _resetIdbFactory,
  loadProjectFromDb,
  saveProjectToDb,
  getDb,
  DB_NAME,
} from '../db';
import {
  prepareMigrationWithBackup,
  listMigrationBackups,
  readMigrationBackup,
  restoreFromBackup,
  listDisplacedProjects,
  readDisplacedProject,
  restoreFromDisplaced,
  MigrationOperationError,
  type MigrationBackupEntry,
} from '../migration-backup';
import { SCHEMA_VERSION, type ProjectData } from '../schema';
import { INITIAL_OBJECTS } from '../../store/initialObjects';

// ─── Helper: proxy de BD que aborta en la N-ésima escritura ──────────────────

/**
 * Envuelve una IDBDatabase de forma que la N-ésima llamada a put/add dentro
 * de cualquier transacción llame a tx.abort() en lugar de completar.
 * Permite verificar que las escrituras previas son revertidas.
 */
function wrapDbAbortOnNthWrite(realDb: IDBDatabase, n: number): IDBDatabase {
  return new Proxy(realDb, {
    get(dbTarget, dbProp) {
      if (dbProp !== 'transaction') {
        const v = Reflect.get(dbTarget, dbProp, dbTarget);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(dbTarget) : v;
      }

      return function(...txArgs: Parameters<IDBDatabase['transaction']>): IDBTransaction {
        const realTx: IDBTransaction = (dbTarget.transaction as (...a: unknown[]) => IDBTransaction)
          .apply(dbTarget, txArgs);
        let writeCount = 0;

        return new Proxy(realTx, {
          get(txTarget, txProp) {
            if (txProp === 'objectStore') {
              return function(storeName: string): IDBObjectStore {
                const realStore: IDBObjectStore = txTarget.objectStore(storeName);

                return new Proxy(realStore, {
                  get(storeTarget, storeProp) {
                    if (storeProp === 'put' || storeProp === 'add') {
                      return function(...writeArgs: unknown[]): IDBRequest {
                        writeCount++;
                        if (writeCount >= n) {
                          realTx.abort();
                          return null as unknown as IDBRequest;
                        }
                        return (storeTarget[storeProp as 'put'] as (...a: unknown[]) => IDBRequest)
                          .apply(storeTarget, writeArgs);
                      };
                    }
                    const v = Reflect.get(storeTarget, storeProp, storeTarget);
                    return typeof v === 'function'
                      ? (v as (...a: unknown[]) => unknown).bind(storeTarget)
                      : v;
                  },
                });
              };
            }

            const v = Reflect.get(txTarget, txProp, txTarget);
            return typeof v === 'function'
              ? (v as (...a: unknown[]) => unknown).bind(txTarget)
              : v;
          },

          set(txTarget, txProp, value) {
            return Reflect.set(txTarget, txProp, value);
          },
        });
      };
    },
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_V1: ProjectData = {
  schemaVersion: SCHEMA_VERSION,
  objects: INITIAL_OBJECTS,
  projectOrigin: { x: 0, y: 0, z: 0 },
};

const VALID_V1_B: ProjectData = {
  schemaVersion: SCHEMA_VERSION,
  objects: [INITIAL_OBJECTS[0]],
  projectOrigin: { x: 100, y: 200, z: 0 },
};

const DETERMINISTIC_OPTIONS = {
  backupId: 'test-backup-001',
  timestamp: '2026-11-04T12:00:00.000Z',
  recordedAt: '1970-01-01T00:00:00.000Z',
};

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let idbFactory: IDBFactory;

beforeEach(() => {
  idbFactory = new IDBFactory();
  _setIdbFactory(idbFactory);
});

afterEach(() => {
  _resetIdbFactory();
});

// ─── T1: Migración exitosa conserva respaldo exacto ───────────────────────────

describe('T1: prepareMigrationWithBackup — migración exitosa', () => {
  it('resuelve con backupId e incidents', async () => {
    await saveProjectToDb(VALID_V1);

    const result = await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    expect(result.backupId).toBe('test-backup-001');
    expect(Array.isArray(result.incidents)).toBe(true);
    // VALID_V1 usa INITIAL_OBJECTS: motor simétrico → sin incidentes
    expect(result.incidents).toHaveLength(0);
  });

  it('el respaldo contiene exactamente los datos v1 y v2', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    const backup: MigrationBackupEntry = await readMigrationBackup('test-backup-001');
    expect(backup.id).toBe('test-backup-001');
    expect(backup.kind).toBe('migration');
    expect(backup.timestamp).toBe(DETERMINISTIC_OPTIONS.timestamp);
    expect(backup.v1Data).toEqual(VALID_V1);
    expect(backup.v2Data.schemaVersion).toBe(2);
    expect(backup.v2Data.elements).toHaveLength(INITIAL_OBJECTS.length);
  });

  it('el proyecto v1 activo NO es reemplazado por la migración', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1);
    expect(active?.schemaVersion).toBe(1);
  });

  it('listMigrationBackups devuelve el respaldo creado', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    const list = await listMigrationBackups();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('test-backup-001');
    expect(list[0].timestamp).toBe(DETERMINISTIC_OPTIONS.timestamp);
    expect(list[0].incidentCount).toBe(0);
  });

  it('es determinístico: dos llamadas con mismas opciones (backupId distinto) producen mismos datos v2', async () => {
    await saveProjectToDb(VALID_V1);

    const r1 = await prepareMigrationWithBackup(VALID_V1, { ...DETERMINISTIC_OPTIONS, backupId: 'b-det-1' });
    const r2 = await prepareMigrationWithBackup(VALID_V1, { ...DETERMINISTIC_OPTIONS, backupId: 'b-det-2' });

    const backup1 = await readMigrationBackup('b-det-1');
    const backup2 = await readMigrationBackup('b-det-2');

    expect(JSON.stringify(backup1.v2Data)).toBe(JSON.stringify(backup2.v2Data));
    expect(r1.incidents).toEqual(r2.incidents);
  });

  it('motor asimétrico genera incidente MOTOR_DEPTH_WIDTH_MISMATCH', async () => {
    const asymV1: ProjectData = {
      schemaVersion: SCHEMA_VERSION,
      objects: [
        {
          id: 'motor-asym',
          name: 'Motor Asim',
          type: 'motor',
          position: { x: 0, y: 0, z: 450 },
          dimensions: { width: 500, depth: 600, height: 900 },
        },
      ],
      projectOrigin: { x: 0, y: 0, z: 0 },
    };

    await saveProjectToDb(asymV1);
    const result = await prepareMigrationWithBackup(asymV1, {
      ...DETERMINISTIC_OPTIONS,
      backupId: 'b-asym',
    });

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0].code).toBe('MOTOR_DEPTH_WIDTH_MISMATCH');

    const backup = await readMigrationBackup('b-asym');
    expect(backup.incidents).toHaveLength(1);
  });
});

// ─── T2: Aborto revierte toda la transacción ──────────────────────────────────

describe('T2: aborto de transacción revierte escrituras', () => {
  it('STALE_V1_DATA aborta sin escribir nada', async () => {
    // La DB está vacía; pasamos VALID_V1 como si lo hubiéramos leído
    // pero la DB NO tiene ese v1 → fingerprint no coincide → STALE_V1_DATA
    const error = await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('STALE_V1_DATA');

    // Verificar que no se escribió nada
    const list = await listMigrationBackups();
    expect(list).toHaveLength(0);
  });

  it('después de STALE_V1_DATA el proyecto activo sigue igual', async () => {
    await saveProjectToDb(VALID_V1);

    // Simulamos "datos estancados" pasando VALID_V1_B cuando la DB tiene VALID_V1
    const error = await prepareMigrationWithBackup(VALID_V1_B, {
      ...DETERMINISTIC_OPTIONS,
      backupId: 'b-stale',
    }).catch(e => e);

    expect((error as MigrationOperationError).code).toBe('STALE_V1_DATA');

    // El proyecto activo sigue siendo VALID_V1
    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1);

    // No se escribió ningún respaldo
    const list = await listMigrationBackups();
    expect(list).toHaveLength(0);
  });
});

// ─── T3: Entrada inválida no altera almacenamiento ────────────────────────────

describe('T3: entrada inválida no altera almacenamiento', () => {
  it('v1 con schemaVersion incorrecto no modifica la BD', async () => {
    await saveProjectToDb(VALID_V1);

    const invalidV1 = { schemaVersion: 99, objects: [], projectOrigin: { x: 0, y: 0, z: 0 } };

    const error = await prepareMigrationWithBackup(
      invalidV1 as unknown as ProjectData,
      { ...DETERMINISTIC_OPTIONS, backupId: 'b-invalid' },
    ).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('INVALID_V1');

    // BD no modificada: v1 activo intacto
    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1);
    // Sin respaldos nuevos
    const list = await listMigrationBackups();
    expect(list).toHaveLength(0);
  });

  it('null como entrada lanza INVALID_V1', async () => {
    await saveProjectToDb(VALID_V1);

    const error = await prepareMigrationWithBackup(
      null as unknown as ProjectData,
      DETERMINISTIC_OPTIONS,
    ).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('INVALID_V1');
  });
});

// ─── T4: Proyecto cambiado durante preparación no se sobrescribe ──────────────

describe('T4: stale-data check — proyecto cambió entre pre-lectura y transacción', () => {
  it('rechaza migración si el v1 activo fue modificado después de la pre-lectura', async () => {
    // Simula: el usuario pre-lee VALID_V1
    await saveProjectToDb(VALID_V1);
    // Simula: auto-save escribe VALID_V1_B antes de que se ejecute la transacción
    await saveProjectToDb(VALID_V1_B);

    // Ahora intentamos migrar con el VALID_V1 "pre-leído" (que ya no coincide con la BD)
    const error = await prepareMigrationWithBackup(VALID_V1, {
      ...DETERMINISTIC_OPTIONS,
      backupId: 'b-stale-change',
    }).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('STALE_V1_DATA');

    // La BD sigue con VALID_V1_B (no fue alterada)
    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1_B);

    // Sin respaldos
    const list = await listMigrationBackups();
    expect(list).toHaveLength(0);
  });

  it('acepta migración cuando v1 no cambió', async () => {
    await saveProjectToDb(VALID_V1);

    // Sin modificación entre la pre-lectura y la transacción
    const result = await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    expect(result.backupId).toBe('test-backup-001');
  });
});

// ─── T5: Respaldo existente se conserva ───────────────────────────────────────

describe('T5: BACKUP_EXISTS — no sobreescribir respaldos silenciosamente', () => {
  it('rechaza una segunda migración con el mismo backupId', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // Segundo intento con mismo backupId
    const error = await prepareMigrationWithBackup(VALID_V1, {
      ...DETERMINISTIC_OPTIONS,
      backupId: 'test-backup-001',
    }).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('BACKUP_EXISTS');
  });

  it('el respaldo original no fue modificado tras el intento fallido', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // Intentamos sobreescribir
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS).catch(() => {});

    // El respaldo original sigue intacto
    const backup = await readMigrationBackup('test-backup-001');
    expect(backup.v1Data).toEqual(VALID_V1);
    expect(backup.timestamp).toBe(DETERMINISTIC_OPTIONS.timestamp);

    // Sólo existe un respaldo
    const list = await listMigrationBackups();
    expect(list).toHaveLength(1);
  });

  it('permite crear un respaldo con distinto backupId', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    const r2 = await prepareMigrationWithBackup(VALID_V1, {
      ...DETERMINISTIC_OPTIONS,
      backupId: 'test-backup-002',
    });

    expect(r2.backupId).toBe('test-backup-002');
    const list = await listMigrationBackups();
    expect(list).toHaveLength(2);
  });
});

// ─── T6: Restauración recupera contenido y conserva estado desplazado ─────────

describe('T6: restoreFromBackup — recupera v1 y conserva proyecto desplazado', () => {
  it('restaura el v1 original como proyecto activo', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // Simula que el usuario modifica el proyecto después de la migración
    await saveProjectToDb(VALID_V1_B);

    await restoreFromBackup('test-backup-001', { restoredAt: '2026-11-04T13:00:00.000Z' });

    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1);
  });

  it('conserva el proyecto desplazado en migration-backups', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // El proyecto activo es VALID_V1_B al momento de restaurar
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'displaced-test-backup-001',
    });

    const entry = await readDisplacedProject('displaced-test-backup-001');
    expect(entry.kind).toBe('displaced');
    expect(entry.backupId).toBe('test-backup-001');
    expect(entry.data).toEqual(VALID_V1_B);
  });

  it('dos restauraciones con estados activos distintos conservan ambos desplazados', async () => {
    const VALID_V1_C: ProjectData = {
      schemaVersion: SCHEMA_VERSION,
      objects: [],
      projectOrigin: { x: 50, y: 100, z: 0 },
    };

    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // Primera restauración desplaza VALID_V1_B
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-first',
    });

    // Segunda restauración desplaza VALID_V1_C
    await saveProjectToDb(VALID_V1_C);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T14:00:00.000Z',
      displacedId: 'disp-second',
    });

    // Ambas entradas desplazadas deben existir
    const disp1 = await readDisplacedProject('disp-first');
    expect(disp1.data).toEqual(VALID_V1_B);

    const disp2 = await readDisplacedProject('disp-second');
    expect(disp2.data).toEqual(VALID_V1_C);

    // El proyecto activo es el v1 restaurado desde el backup
    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1);

    // listDisplacedProjects muestra las dos
    const displaced = await listDisplacedProjects();
    expect(displaced.map(d => d.id).sort()).toEqual(['disp-first', 'disp-second']);
  });

  it('rechaza restauración si ya existe una entrada displaced con el mismo ID (add no put)', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-fixed',
    });

    // Segundo intento con el mismo displacedId → IndexedDB debe rechazarlo
    await saveProjectToDb(VALID_V1_B);
    const error = await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T14:00:00.000Z',
      displacedId: 'disp-fixed',
    }).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('TRANSACTION_ABORTED');
  });

  it('el respaldo original sigue disponible después de restaurar', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await restoreFromBackup('test-backup-001');

    const backup = await readMigrationBackup('test-backup-001');
    expect(backup.id).toBe('test-backup-001');
    expect(backup.v1Data).toEqual(VALID_V1);
  });

  it('restore con backupId inexistente lanza BACKUP_NOT_FOUND', async () => {
    const error = await restoreFromBackup('no-existe').catch(e => e);
    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('BACKUP_NOT_FOUND');
  });

  it('listMigrationBackups no incluye entradas displaced', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await restoreFromBackup('test-backup-001');

    const list = await listMigrationBackups();
    // Solo debe aparecer el respaldo de migración, no el displaced
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('test-backup-001');
  });
});

// ─── T7: Instalación desde BD v1 existente funciona sin pérdida de datos ──────

describe('T7: upgrade de BD v1 existente a v2 — sin pérdida de datos', () => {
  it('conserva v1 existente después del upgrade del schema de BD', async () => {
    // Paso 1: Abrir la BD a versión 1 manualmente con el mismo nombre y escribir v1
    await new Promise<void>((resolve, reject) => {
      const req = idbFactory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('project');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('project', 'readwrite');
        tx.objectStore('project').put(VALID_V1, 'current');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Paso 2: Ahora db.ts abre la misma BD a versión 2 (onupgradeneeded agrega stores)
    // loadProjectFromDb() dispara openDatabase() con versión 2
    const loaded = await loadProjectFromDb();
    expect(loaded).toEqual(VALID_V1);
  });

  it('los nuevos stores están disponibles después del upgrade', async () => {
    // Setup: crear la BD a versión 1 con datos
    await new Promise<void>((resolve, reject) => {
      const req = idbFactory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('project');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('project', 'readwrite');
        tx.objectStore('project').put(VALID_V1, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Trigger upgrade to v2
    await saveProjectToDb(VALID_V1);

    // Ahora migration-backup store debe funcionar
    const list = await listMigrationBackups();
    expect(list).toHaveLength(0);

    // Y una migración completa también debe funcionar
    const result = await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    expect(result.backupId).toBe('test-backup-001');
  });
});

// ─── T8: Pruebas v1 existentes siguen pasando ────────────────────────────────

describe('T8: integración — las operaciones v1 no se ven afectadas', () => {
  it('saveProjectToDb + loadProjectFromDb sigue funcionando', async () => {
    await saveProjectToDb(VALID_V1);
    const loaded = await loadProjectFromDb();
    expect(loaded).toEqual(VALID_V1);
  });

  it('sobrescribir v1 no interfiere con respaldos de migración', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // Escritura normal de v1 (como haría el auto-save)
    await saveProjectToDb(VALID_V1_B);

    // El respaldo sigue intacto
    const backup = await readMigrationBackup('test-backup-001');
    expect(backup.v1Data).toEqual(VALID_V1);

    // El activo es el nuevo VALID_V1_B
    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1_B);
  });

  it('BD vacía → loadProjectFromDb devuelve null (sin cambio)', async () => {
    const result = await loadProjectFromDb();
    expect(result).toBeNull();
  });

  it('múltiples migraciones con distintos backupId son independientes', async () => {
    await saveProjectToDb(VALID_V1);

    await prepareMigrationWithBackup(VALID_V1, { ...DETERMINISTIC_OPTIONS, backupId: 'b-multi-1' });
    await prepareMigrationWithBackup(VALID_V1, { ...DETERMINISTIC_OPTIONS, backupId: 'b-multi-2' });
    await prepareMigrationWithBackup(VALID_V1, { ...DETERMINISTIC_OPTIONS, backupId: 'b-multi-3' });

    const list = await listMigrationBackups();
    expect(list).toHaveLength(3);
    expect(list.map(b => b.id).sort()).toEqual(['b-multi-1', 'b-multi-2', 'b-multi-3']);
  });
});

// ─── readMigrationBackup — edge cases ─────────────────────────────────────────

describe('readMigrationBackup — edge cases', () => {
  it('lanza BACKUP_NOT_FOUND para ID inexistente', async () => {
    const error = await readMigrationBackup('no-existe').catch(e => e);
    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('BACKUP_NOT_FOUND');
  });

  it('round-trip JSON: los datos v2 sobreviven serialización', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    const backup = await readMigrationBackup('test-backup-001');
    const serialized = JSON.stringify(backup.v2Data);
    const deserialized = JSON.parse(serialized) as unknown;

    // Re-validar el v2 tras round-trip
    const { validateProjectDataV2 } = await import('../validate-v2');
    expect(() => validateProjectDataV2(deserialized)).not.toThrow();
  });
});

// ─── T9: Atomicidad — aborto tras escritura revierte todo ────────────────────

describe('T9: atomicidad — aborto después de escritura deja stores intactos', () => {
  it('migración: aborto tras escribir backup revierte backup y v2 preparado', async () => {
    await saveProjectToDb(VALID_V1);
    const realDb = await getDb();

    // Proxy que aborta en el 2° write (V2_STORE.put), después del backup
    _setDbForTesting(wrapDbAbortOnNthWrite(realDb, 2));

    const error = await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('TRANSACTION_ABORTED');

    // Verificar con la BD real: sin escrituras parciales
    _setDbForTesting(realDb);

    const list = await listMigrationBackups();
    expect(list).toHaveLength(0);

    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1);
  });

  it('restauración: aborto tras escribir displaced deja proyecto activo intacto', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await saveProjectToDb(VALID_V1_B);

    const realDb = await getDb();

    // Proxy que aborta en el 2° write (STORE_NAME.put con restoredV1)
    _setDbForTesting(wrapDbAbortOnNthWrite(realDb, 2));

    const error = await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-atomic',
    }).catch(e => e);

    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('TRANSACTION_ABORTED');

    // Verificar con la BD real
    _setDbForTesting(realDb);

    // Proyecto activo sigue siendo VALID_V1_B (no fue reemplazado)
    const active = await loadProjectFromDb();
    expect(active).toEqual(VALID_V1_B);

    // Sin entrada displaced parcial
    const displaced = await listDisplacedProjects();
    expect(displaced).toHaveLength(0);
  });
});

// ─── T10: API de proyectos desplazados ───────────────────────────────────────

describe('T10: listDisplacedProjects + readDisplacedProject + restoreFromDisplaced', () => {
  it('listDisplacedProjects devuelve las entradas displaced y no los backups', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-001',
    });

    const displacedList = await listDisplacedProjects();
    expect(displacedList).toHaveLength(1);
    expect(displacedList[0].id).toBe('disp-001');
    expect(displacedList[0].backupId).toBe('test-backup-001');
    expect(displacedList[0].restoredAt).toBe('2026-11-04T13:00:00.000Z');

    // Los backups de migración no aparecen en la lista de desplazados
    const backups = await listMigrationBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].id).toBe('test-backup-001');
  });

  it('readDisplacedProject devuelve la entrada completa con datos v1', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-001',
    });

    const entry = await readDisplacedProject('disp-001');
    expect(entry.kind).toBe('displaced');
    expect(entry.data).toEqual(VALID_V1_B);
    expect(entry.backupId).toBe('test-backup-001');
  });

  it('readDisplacedProject lanza BACKUP_NOT_FOUND para ID inexistente', async () => {
    const error = await readDisplacedProject('no-existe').catch(e => e);
    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('BACKUP_NOT_FOUND');
  });

  it('readDisplacedProject lanza BACKUP_NOT_FOUND si el ID corresponde a un backup (no displaced)', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    const error = await readDisplacedProject('test-backup-001').catch(e => e);
    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('BACKUP_NOT_FOUND');
  });

  it('restoreFromDisplaced restaura el proyecto desplazado como activo', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);

    // Desplazar VALID_V1_B al restaurar el backup
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-001',
    });

    // Activo es ahora VALID_V1; restauramos el desplazado VALID_V1_B
    const activeBefore = await loadProjectFromDb();
    expect(activeBefore).toEqual(VALID_V1);

    await restoreFromDisplaced('disp-001', {
      restoredAt: '2026-11-04T14:00:00.000Z',
      displacedId: 'disp-002',
    });

    const activeAfter = await loadProjectFromDb();
    expect(activeAfter).toEqual(VALID_V1_B);

    // El anterior activo (VALID_V1) queda ahora desplazado
    const disp2 = await readDisplacedProject('disp-002');
    expect(disp2.data).toEqual(VALID_V1);
    expect(disp2.backupId).toBe('disp-001');
  });

  it('restoreFromDisplaced conserva el proyecto activo al desplazarlo', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-001',
    });

    await restoreFromDisplaced('disp-001', {
      restoredAt: '2026-11-04T14:00:00.000Z',
      displacedId: 'disp-002',
    });

    // Ahora hay dos entradas displaced
    const all = await listDisplacedProjects();
    expect(all.map(d => d.id).sort()).toEqual(['disp-001', 'disp-002']);
  });

  it('restoreFromDisplaced lanza BACKUP_NOT_FOUND para ID inexistente', async () => {
    const error = await restoreFromDisplaced('no-existe').catch(e => e);
    expect(error).toBeInstanceOf(MigrationOperationError);
    expect((error as MigrationOperationError).code).toBe('BACKUP_NOT_FOUND');
  });

  it('listMigrationBackups no incluye entradas displaced', async () => {
    await saveProjectToDb(VALID_V1);
    await prepareMigrationWithBackup(VALID_V1, DETERMINISTIC_OPTIONS);
    await saveProjectToDb(VALID_V1_B);
    await restoreFromBackup('test-backup-001', {
      restoredAt: '2026-11-04T13:00:00.000Z',
      displacedId: 'disp-001',
    });
    await restoreFromDisplaced('disp-001', {
      restoredAt: '2026-11-04T14:00:00.000Z',
      displacedId: 'disp-002',
    });

    const backups = await listMigrationBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].id).toBe('test-backup-001');

    const displaced = await listDisplacedProjects();
    expect(displaced).toHaveLength(2);
  });
});
