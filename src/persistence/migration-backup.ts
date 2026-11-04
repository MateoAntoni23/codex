/**
 * migration-backup.ts — API de respaldo transaccional y recuperación para la
 * migración v1 → v2 (M1b).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTADO: preparada pero NO activada en producción.
 * La aplicación sigue leyendo y escribiendo schemaVersion=1 hasta activación
 * explícita posterior a M1b (requiere que visor, inspector y persistencia
 * puedan trabajar con v2 o que exista un adaptador validado).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * GARANTÍAS
 * ─────────
 * 1. Atomicidad: backup de v1, proyecto v2 y project-v2 se escriben en una
 *    única transacción IndexedDB. Si la transacción aborta, no queda ninguna
 *    escritura parcial.
 * 2. Detecta datos estancados: lee el v1 activo *dentro* de la transacción y
 *    lo compara con el v1 pasado como argumento. Si difieren, aborta sin
 *    sobrescribir nada.
 * 3. No sobreescribe respaldos: si ya existe un respaldo con el mismo ID,
 *    la operación se rechaza.
 * 4. Restauración no destructiva: al restaurar un respaldo, el proyecto
 *    activo desplazado se conserva en la misma store bajo la clave
 *    `displaced-{backupId}`.
 * 5. Resolución sólo en oncomplete: las promesas se resuelven únicamente
 *    cuando IndexedDB confirma que los datos están persistidos.
 *
 * LÍMITES CONOCIDOS
 * ─────────────────
 * • Equipos de vacío: solenoid_valve.operatingPressure.minBar ≥ 0 (presión
 *   relativa). Aplicaciones de vacío (presión negativa) no son soportadas
 *   por los contratos v2 actuales. Se documentarán en M3 cuando se modele
 *   la categoría completa.
 * • No hay interfaz de usuario para recuperación en esta entrega.
 * • listMigrationBackups() devuelve todos los registros en memoria sin
 *   paginación; adecuado para los volúmenes esperados en M1b.
 *
 * COORDINACIÓN CON EL GUARDADO AUTOMÁTICO (futura activación)
 * ────────────────────────────────────────────────────────────
 * El auto-save de projectManager.ts tiene un debounce de 1 s. Al activar
 * la migración en una entrega futura, deberá:
 *   1. Llamar a `_cancelAutoSave()` antes de leer el v1 que se pasará a
 *      `prepareMigrationWithBackup`.
 *   2. Esperar explícitamente a que se complete cualquier escritura en vuelo:
 *      consultar `saveStatus !== 'saving'` es insuficiente, ya que solo
 *      refleja el estado del debounce, no la confirmación de IndexedDB
 *      (oncomplete). Se requiere una operación de pausa que aguarde la
 *      resolución de la promesa de guardado en vuelo antes de continuar.
 *   3. Pasar el v1 leído inmediatamente a `prepareMigrationWithBackup`.
 *   4. No reactivar el auto-save v1 tras activar v2: una vez que el proyecto
 *      activo es v2, el guardado debe operar sobre el nuevo formato.
 * Sin este protocolo, la comprobación de datos estancados puede rechazar
 * la migración por una escritura de auto-save entre la pre-lectura y la
 * transacción.
 */

import type { ProjectData } from './schema';
import type { ProjectDataV2, MigrationIncident } from '../types/domain-v2';
import { validateProjectData } from './validate';
import { validateProjectDataV2 } from './validate-v2';
import { migrateV1ToV2 } from './migrate-v1-to-v2';
import {
  getDb,
  STORE_NAME,
  PROJECT_KEY,
  BACKUP_STORE,
  V2_STORE,
  V2_KEY,
} from './db';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Registro de respaldo de migración almacenado en IndexedDB. */
export interface MigrationBackupEntry {
  id: string;
  kind: 'migration';
  timestamp: string;
  /** Huella JSON del v1 usado para preparar la migración. */
  v1Fingerprint: string;
  v1Data: ProjectData;
  v2Data: ProjectDataV2;
  incidents: MigrationIncident[];
}

/** Proyecto desplazado al restaurar un respaldo. */
export interface DisplacedProjectEntry {
  id: string;
  kind: 'displaced';
  backupId: string;
  restoredAt: string;
  data: ProjectData;
}

/** Resumen sin datos completos para listados. */
export interface MigrationBackupSummary {
  id: string;
  timestamp: string;
  incidentCount: number;
}

/** Resumen de proyecto desplazado para listados. */
export interface DisplacedProjectSummary {
  id: string;
  backupId: string;
  restoredAt: string;
}

/** Resultado de una migración exitosa. */
export interface PrepareMigrationResult {
  backupId: string;
  incidents: MigrationIncident[];
}

/** Opciones para prepareMigrationWithBackup. */
export interface PrepareMigrationOptions {
  /**
   * ID determinístico del respaldo. Si se omite, se genera con Date.now().
   * Inyectar en tests para reproducibilidad.
   */
  backupId?: string;
  /**
   * Timestamp ISO 8601 para el registro del respaldo.
   * Por defecto: new Date().toISOString() (no determinístico en prod).
   */
  timestamp?: string;
  /**
   * recordedAt para las evidencias generadas por migrateV1ToV2.
   * Por defecto: '1970-01-01T00:00:00.000Z' (determinístico).
   */
  recordedAt?: string;
}

// ─── Errores tipados ──────────────────────────────────────────────────────────

export type MigrationErrorCode =
  | 'STALE_V1_DATA'       // v1 cambió entre la pre-lectura y la transacción
  | 'BACKUP_EXISTS'       // ya existe un respaldo con ese ID
  | 'INVALID_V1'          // validateProjectData falló
  | 'INVALID_V2'          // validateProjectDataV2 falló
  | 'BACKUP_NOT_FOUND'    // ID de respaldo no existe
  | 'TRANSACTION_ABORTED';

export class MigrationOperationError extends Error {
  constructor(
    public readonly code: MigrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MigrationOperationError';
  }
}

// ─── prepareMigrationWithBackup ───────────────────────────────────────────────

/**
 * Prepara la migración v1→v2 con respaldo atómico.
 *
 * @param v1Snapshot - Proyecto v1 pre-leído (con `loadProjectFromDb`).
 *   La función lo valida internamente.
 * @param options - Opciones de control de ID y timestamps.
 *
 * Flujo:
 *   1. Valida v1Snapshot; falla rápido con INVALID_V1 si es inválido.
 *   2. Ejecuta migrateV1ToV2 (puro, sin efectos).
 *   3. Valida el v2 resultante; falla con INVALID_V2 si es inválido.
 *   4. Abre transacción readwrite sobre [project, migration-backups, project-v2].
 *   5. Dentro de la transacción: re-lee v1, compara con v1Snapshot
 *      (STALE_V1_DATA si difiere), verifica que el backupId no exista
 *      (BACKUP_EXISTS si ya está), escribe respaldo y proyecto v2.
 *   6. Resuelve únicamente en transaction.oncomplete.
 */
export async function prepareMigrationWithBackup(
  v1Snapshot: ProjectData,
  options: PrepareMigrationOptions = {},
): Promise<PrepareMigrationResult> {
  // 1. Validar v1 (falla rápido, fuera de transacción)
  let validV1: ProjectData;
  try {
    validV1 = validateProjectData(v1Snapshot);
  } catch (err) {
    throw new MigrationOperationError(
      'INVALID_V1',
      `Proyecto v1 inválido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Migrar v1→v2 (puro, determinístico)
  const { data: v2Data, incidents } = migrateV1ToV2(validV1, {
    recordedAt: options.recordedAt ?? '1970-01-01T00:00:00.000Z',
  });

  // 3. Validar v2
  try {
    validateProjectDataV2(v2Data);
  } catch (err) {
    throw new MigrationOperationError(
      'INVALID_V2',
      `Proyecto v2 generado inválido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Preparar metadatos del respaldo
  const v1Fingerprint = JSON.stringify(validV1);
  const backupId = options.backupId ?? `backup-${Date.now()}`;
  const timestamp = options.timestamp ?? new Date().toISOString();

  const db = await getDb();

  return new Promise<PrepareMigrationResult>((resolve, reject) => {
    // Flag para evitar dobles llamadas a reject tras un tx.abort() explícito
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE_NAME, BACKUP_STORE, V2_STORE], 'readwrite');
    } catch (err) {
      fail(new MigrationOperationError(
        'TRANSACTION_ABORTED',
        `No se pudo abrir la transacción: ${err instanceof Error ? err.message : String(err)}`,
      ));
      return;
    }

    tx.onerror = () => {
      fail(new MigrationOperationError(
        'TRANSACTION_ABORTED',
        `Error en transacción de migración: ${tx.error?.message ?? 'desconocido'}`,
      ));
    };
    tx.onabort = () => {
      fail(new MigrationOperationError(
        'TRANSACTION_ABORTED',
        `Transacción de migración abortada: ${tx.error?.message ?? 'sin error registrado'}`,
      ));
    };
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve({ backupId, incidents });
      }
    };

    // 5a. Leer v1 activo dentro de la transacción para detectar datos estancados
    const getV1Req = tx.objectStore(STORE_NAME).get(PROJECT_KEY);
    getV1Req.onsuccess = () => {
      const currentV1 = getV1Req.result as ProjectData | undefined;
      const currentFingerprint =
        currentV1 !== undefined ? JSON.stringify(currentV1) : null;

      if (currentFingerprint !== v1Fingerprint) {
        fail(new MigrationOperationError(
          'STALE_V1_DATA',
          'El proyecto v1 cambió entre la pre-lectura y la transacción; migración cancelada',
        ));
        tx.abort();
        return;
      }

      // 5b. Verificar que el backupId no exista ya
      const checkReq = tx.objectStore(BACKUP_STORE).get(backupId);
      checkReq.onsuccess = () => {
        if (checkReq.result !== undefined) {
          fail(new MigrationOperationError(
            'BACKUP_EXISTS',
            `Ya existe un respaldo con ID "${backupId}"; no se sobreescribirá`,
          ));
          tx.abort();
          return;
        }

        // 5c. Escribir respaldo de v1+v2
        const entry: MigrationBackupEntry = {
          id: backupId,
          kind: 'migration',
          timestamp,
          v1Fingerprint,
          v1Data: validV1,
          v2Data,
          incidents,
        };
        tx.objectStore(BACKUP_STORE).put(entry, backupId);

        // 5d. Escribir proyecto v2 preparado (inactivo, no reemplaza v1)
        tx.objectStore(V2_STORE).put(v2Data, V2_KEY);

        // Sin más requests pendientes → IndexedDB cerrará la transacción
        // y disparará oncomplete cuando los datos estén confirmados en disco.
      };
      // checkReq.onerror propagado a tx.onerror
    };
    // getV1Req.onerror propagado a tx.onerror
  });
}

// ─── Listado y lectura de respaldos ──────────────────────────────────────────

/**
 * Lista todos los respaldos de migración disponibles (kind='migration').
 * No incluye los proyectos desplazados por restauraciones.
 */
export async function listMigrationBackups(): Promise<MigrationBackupSummary[]> {
  const db = await getDb();
  return new Promise<MigrationBackupSummary[]>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).getAll();
    req.onsuccess = () => {
      const all = req.result as Array<MigrationBackupEntry | DisplacedProjectEntry>;
      resolve(
        all
          .filter((e): e is MigrationBackupEntry => e.kind === 'migration')
          .map(e => ({ id: e.id, timestamp: e.timestamp, incidentCount: e.incidents.length })),
      );
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lee el contenido completo de un respaldo por ID.
 * Lanza MigrationOperationError con código BACKUP_NOT_FOUND si no existe.
 */
export async function readMigrationBackup(backupId: string): Promise<MigrationBackupEntry> {
  const db = await getDb();
  return new Promise<MigrationBackupEntry>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).get(backupId);
    req.onsuccess = () => {
      const entry = req.result as MigrationBackupEntry | DisplacedProjectEntry | undefined;
      if (!entry || entry.kind !== 'migration') {
        reject(new MigrationOperationError(
          'BACKUP_NOT_FOUND',
          `Respaldo "${backupId}" no encontrado`,
        ));
        return;
      }
      resolve(entry);
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Restauración ────────────────────────────────────────────────────────────

/** Opciones para restoreFromBackup. */
export interface RestoreFromBackupOptions {
  /**
   * Timestamp ISO 8601 del momento de restauración.
   * Por defecto: new Date().toISOString().
   */
  restoredAt?: string;
  /**
   * Clave única para la entrada desplazada en migration-backups.
   * Por defecto: `displaced-{backupId}-{Date.now()}`.
   * Inyectar en tests para reproducibilidad.
   * La operación usa `add` (no `put`): si ya existe una entrada con
   * este ID, la transacción aborta con TRANSACTION_ABORTED.
   */
  displacedId?: string;
}

/** Opciones para restoreFromDisplaced. */
export interface RestoreFromDisplacedOptions {
  /**
   * Timestamp ISO 8601 del momento de restauración.
   * Por defecto: new Date().toISOString().
   */
  restoredAt?: string;
  /**
   * Clave única para la entrada que conserva el proyecto activo desplazado.
   * Por defecto: `displaced-{displacedId}-{Date.now()}`.
   * Inyectar en tests para reproducibilidad.
   */
  displacedId?: string;
}

/**
 * Restaura el proyecto v1 desde un respaldo de migración.
 *
 * El proyecto activo desplazado se conserva en migration-backups bajo la
 * clave `displaced-{backupId}` para evitar pérdida de datos.
 *
 * La operación es atómica: si la transacción aborta, ni el proyecto activo
 * ni el displaced se modifican.
 *
 * NOTA: Esta función no rehidrata el store Zustand. La activación completa
 * requerirá llamar a store.hydrateProject() después de que la promesa
 * resuelva (coordinación pendiente para activación en entrega futura).
 */
export async function restoreFromBackup(
  backupId: string,
  options: RestoreFromBackupOptions = {},
): Promise<void> {
  // Leer y validar el respaldo fuera de la transacción (falla rápido)
  const backup = await readMigrationBackup(backupId);
  let restoredV1: ProjectData;
  try {
    restoredV1 = validateProjectData(backup.v1Data);
  } catch (err) {
    throw new MigrationOperationError(
      'INVALID_V1',
      `Datos v1 en el respaldo "${backupId}" son inválidos: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const restoredAt = options.restoredAt ?? new Date().toISOString();
  const displacedId = options.displacedId ?? `displaced-${backupId}-${Date.now()}`;
  const db = await getDb();

  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE_NAME, BACKUP_STORE], 'readwrite');
    } catch (err) {
      reject(new MigrationOperationError(
        'TRANSACTION_ABORTED',
        `No se pudo abrir la transacción de restauración: ${err instanceof Error ? err.message : String(err)}`,
      ));
      return;
    }

    tx.onerror = () =>
      reject(tx.error ?? new MigrationOperationError('TRANSACTION_ABORTED', 'Error en restauración'));
    tx.onabort = () =>
      reject(tx.error ?? new MigrationOperationError('TRANSACTION_ABORTED', 'Restauración abortada'));
    tx.oncomplete = () => resolve();

    // Leer proyecto activo para conservarlo como desplazado
    const getReq = tx.objectStore(STORE_NAME).get(PROJECT_KEY);
    getReq.onsuccess = () => {
      const currentData = getReq.result as ProjectData | undefined;

      // Conservar el proyecto activo desplazado usando add (no put) para
      // que IndexedDB rechace silenciosas colisiones de clave.
      if (currentData !== undefined) {
        const displaced: DisplacedProjectEntry = {
          id: displacedId,
          kind: 'displaced',
          backupId,
          restoredAt,
          data: currentData,
        };
        tx.objectStore(BACKUP_STORE).add(displaced, displacedId);
      }

      // Restaurar v1 como proyecto activo
      tx.objectStore(STORE_NAME).put(restoredV1, PROJECT_KEY);
    };
  });
}

// ─── Proyectos desplazados ────────────────────────────────────────────────────

/**
 * Lista todos los proyectos desplazados por restauraciones previas (kind='displaced').
 * No incluye los respaldos de migración.
 */
export async function listDisplacedProjects(): Promise<DisplacedProjectSummary[]> {
  const db = await getDb();
  return new Promise<DisplacedProjectSummary[]>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).getAll();
    req.onsuccess = () => {
      const all = req.result as Array<MigrationBackupEntry | DisplacedProjectEntry>;
      resolve(
        all
          .filter((e): e is DisplacedProjectEntry => e.kind === 'displaced')
          .map(e => ({ id: e.id, backupId: e.backupId, restoredAt: e.restoredAt })),
      );
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lee el contenido completo de un proyecto desplazado por ID.
 * Lanza MigrationOperationError con código BACKUP_NOT_FOUND si no existe.
 */
export async function readDisplacedProject(id: string): Promise<DisplacedProjectEntry> {
  const db = await getDb();
  return new Promise<DisplacedProjectEntry>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).get(id);
    req.onsuccess = () => {
      const entry = req.result as MigrationBackupEntry | DisplacedProjectEntry | undefined;
      if (!entry || entry.kind !== 'displaced') {
        reject(new MigrationOperationError(
          'BACKUP_NOT_FOUND',
          `Proyecto desplazado "${id}" no encontrado`,
        ));
        return;
      }
      resolve(entry);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Restaura un proyecto desplazado como proyecto activo.
 *
 * El proyecto activo desplazado se conserva en migration-backups bajo la
 * clave `options.displacedId` (o `displaced-{id}-{Date.now()}` por defecto).
 * Se usa `add` para que IndexedDB rechace colisiones de clave.
 *
 * La operación valida el contenido antes de restaurar (INVALID_V1 si falla).
 * Es atómica: si la transacción aborta, el proyecto activo no se modifica.
 */
export async function restoreFromDisplaced(
  id: string,
  options: RestoreFromDisplacedOptions = {},
): Promise<void> {
  const displaced = await readDisplacedProject(id);
  let restoredData: ProjectData;
  try {
    restoredData = validateProjectData(displaced.data);
  } catch (err) {
    throw new MigrationOperationError(
      'INVALID_V1',
      `Datos en proyecto desplazado "${id}" son inválidos: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const restoredAt = options.restoredAt ?? new Date().toISOString();
  const newDisplacedId = options.displacedId ?? `displaced-${id}-${Date.now()}`;
  const db = await getDb();

  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE_NAME, BACKUP_STORE], 'readwrite');
    } catch (err) {
      reject(new MigrationOperationError(
        'TRANSACTION_ABORTED',
        `No se pudo abrir la transacción: ${err instanceof Error ? err.message : String(err)}`,
      ));
      return;
    }

    tx.onerror = () =>
      reject(tx.error ?? new MigrationOperationError('TRANSACTION_ABORTED', 'Error en restauración desde desplazado'));
    tx.onabort = () =>
      reject(tx.error ?? new MigrationOperationError('TRANSACTION_ABORTED', 'Restauración desde desplazado abortada'));
    tx.oncomplete = () => resolve();

    const getReq = tx.objectStore(STORE_NAME).get(PROJECT_KEY);
    getReq.onsuccess = () => {
      const currentData = getReq.result as ProjectData | undefined;

      if (currentData !== undefined) {
        const newDisplaced: DisplacedProjectEntry = {
          id: newDisplacedId,
          kind: 'displaced',
          backupId: id,
          restoredAt,
          data: currentData,
        };
        tx.objectStore(BACKUP_STORE).add(newDisplaced, newDisplacedId);
      }

      tx.objectStore(STORE_NAME).put(restoredData, PROJECT_KEY);
    };
  });
}
