import { SCHEMA_VERSION, type ProjectData } from './schema';
import { validateProjectData } from './validate';
import { loadProjectFromDb, saveProjectToDb } from './db';
import { INITIAL_OBJECTS } from '../store/initialObjects';
import type { useSceneStore as StoreType } from '../store/sceneStore';
import type { DomainObject, Vec3mm } from '../types/domain';

type Store = typeof StoreType;

function snapshotData(store: Store): ProjectData {
  const { objects, projectOrigin } = store.getState();
  return {
    schemaVersion: SCHEMA_VERSION,
    objects: objects.map((o) => ({
      ...o,
      position: { ...o.position },
      dimensions: { ...o.dimensions },
    })),
    projectOrigin: { ...projectOrigin },
  };
}

// ─── Módulo de estado ────────────────────────────────────────────────────────

let _saveGeneration = 0;
let _initialized = false;

/** Cancel handle del ciclo de initProject (retornado como cleanup del efecto). */
let _cancelInit: (() => void) | null = null;

/** Cancel handle de la suscripción de auto-save. */
let _cancelAutoSave: (() => void) | null = null;

/** true mientras recoverProject está esperando la escritura en IndexedDB.
 *  Impide recuperaciones simultáneas e indica al UI que está en proceso. */
let _recovering = false;

/** true mientras pauseAndFlush está activo. Impide nuevas pausas simultáneas. */
let _paused = false;

/**
 * Promesa de la escritura de auto-save más reciente aún en vuelo.
 * pauseAndFlush la espera antes de hacer el flush final.
 */
let _inflightWritePromise: Promise<void> | null = null;

/** Incrementado por initProject (nueva sesión) y por cancel() (fin de sesión).
 *  Cada llamada a recoverProject y pauseAndFlush captura myVersion = _sessionVersion;
 *  si difieren al continuar, la operación pertenece a una sesión obsoleta. */
let _sessionVersion = 0;

/** Incrementado por cada llamada a recoverProject; identifica qué recuperación
 *  es propietaria del flag _recovering para no liberarlo desde otra. */
let _recoveryToken = 0;

// ─── Helpers de test ─────────────────────────────────────────────────────────

export function _resetSaveGeneration(): void {
  _saveGeneration = 0;
}

export function _resetInitialized(): void {
  _cancelInit?.();
  _cancelInit = null;
  _cancelAutoSave?.();
  _cancelAutoSave = null;
  _recovering = false;
  _paused = false;
  _inflightWritePromise = null;
  _sessionVersion = 0;
  _recoveryToken = 0;
}

// ─── Sesión de auto-save ──────────────────────────────────────────────────────

/**
 * Instala una única suscripción de guardado automático con debounce de 1 s.
 * El estado y la generación se actualizan INMEDIATAMENTE en la suscripción.
 * Los callbacks comprueban `cancelled` antes de modificar saveStatus,
 * evitando que una escritura en vuelo afecte una sesión posterior.
 * Cancela cualquier sesión anterior antes de instalar la nueva.
 * Registra la escritura en vuelo en _inflightWritePromise para que
 * pauseAndFlush pueda esperarla antes del flush final.
 */
function _startAutoSaveSession(store: Store): void {
  _cancelAutoSave?.();

  let cancelled = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const unsub = store.subscribe((state, prev) => {
    if (state.objects !== prev.objects || state.projectOrigin !== prev.projectOrigin) {
      const myGen = ++_saveGeneration;
      store.getState().setSaveStatus('saving', null);

      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        if (cancelled) return;
        const writePromise = saveProjectToDb(snapshotData(store));
        _inflightWritePromise = writePromise;
        try {
          await writePromise;
          if (!cancelled && myGen === _saveGeneration) {
            store.getState().setSaveStatus('saved', null);
          }
        } catch (err) {
          if (!cancelled && myGen === _saveGeneration) {
            store.getState().setSaveStatus('error', `Error al guardar: ${String(err)}`);
          }
        } finally {
          if (_inflightWritePromise === writePromise) _inflightWritePromise = null;
        }
      }, 1000);
    }
  });

  function cancelAutoSave() {
    cancelled = true;
    if (debounceTimer != null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    unsub();
    if (_cancelAutoSave === cancelAutoSave) _cancelAutoSave = null;
  }

  _cancelAutoSave = cancelAutoSave;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa el proyecto: carga desde IndexedDB si existe, luego activa el
 * guardado automático. Retorna { cancel, ready } de forma sincrónica.
 * El auto-save NO se activa si la carga falla; usar recoverProject.
 * Llamadas adicionales sin cancel previo son ignoradas.
 */
export function initProject(store: Store): { cancel: () => void; ready: Promise<void> } {
  if (_initialized) {
    return { cancel: () => {}, ready: Promise.resolve() };
  }
  _initialized = true;
  ++_sessionVersion; // nueva sesión

  let cancelled = false;

  function cancel() {
    cancelled = true;
    ++_sessionVersion;        // invalida operaciones en vuelo de esta sesión
    _recovering = false;      // permite nuevo recover tras remount
    _paused = false;          // permite nueva pausa tras remount
    store.getState().setEditingBlocked(false); // desbloquea editor para próxima sesión
    _cancelAutoSave?.();
    _initialized = false;
    if (_cancelInit === cancel) _cancelInit = null;
  }

  _cancelInit = cancel;

  store.getState().setSaveStatus('loading', null);

  const ready = (async () => {
    let loadOk = false;
    try {
      const saved = await loadProjectFromDb();
      if (cancelled) return;
      if (saved != null) {
        const validated = validateProjectData(saved);
        store.getState().hydrateProject(validated.objects, validated.projectOrigin);
        store.getState().setSaveStatus('saved', null);
      } else {
        store.getState().setSaveStatus('idle', null);
      }
      loadOk = true;
    } catch (err) {
      if (cancelled) return;
      store.getState().setSaveStatus('error', `Error al cargar: ${String(err)}`);
    }

    if (!loadOk || cancelled) return;

    _startAutoSaveSession(store);
  })();

  return { cancel, ready };
}

/**
 * Pausa el guardado automático, espera escrituras en vuelo, captura el estado
 * de memoria actual y lo persiste en IndexedDB. Bloquea toda modificación del
 * editor durante la pausa. Resuelve con el snapshot confirmado (oncomplete).
 *
 * Garantías:
 * - _paused se establece ANTES de cualquier await; una segunda llamada concurrente
 *   recibe un rechazo inmediato.
 * - Cancela el temporizador de debounce sin descartar la memoria.
 * - Espera la escritura en vuelo antes del flush final (si hubiera una).
 * - Si falla: conserva la memoria en el store y permite exportar; el editor
 *   queda bloqueado hasta que el caller llame a resumeAutoSave.
 * - Verifica identidad de sesión antes del flush para no modificar una sesión
 *   posterior iniciada desde otro contexto.
 */
export async function pauseAndFlush(store: Store): Promise<ProjectData> {
  if (_paused) return Promise.reject(new Error('pauseAndFlush ya está en curso'));
  _paused = true;
  const myVersion = _sessionVersion;

  // Bloquea toda modificación del editor
  store.getState().setEditingBlocked(true);

  // Cancela suscripción y temporizador pendiente sin descartar la memoria
  _cancelAutoSave?.();

  // Espera la escritura en vuelo (si la hay) antes del flush final
  if (_inflightWritePromise != null) {
    await _inflightWritePromise.catch(() => {
      // Ignoramos el error de la escritura anterior; el flush capturará el estado actual
    });
  }

  // Verifica que la sesión siga vigente (cancel() pudo haberse llamado mientras esperábamos)
  if (_sessionVersion !== myVersion) {
    return Promise.reject(new Error('Sesión cancelada durante pauseAndFlush'));
  }

  // Captura el estado de memoria actual (incluye edits pendientes del debounce)
  const snapshot = snapshotData(store);

  // Persiste y espera oncomplete
  try {
    await saveProjectToDb(snapshot);
    return snapshot;
  } catch (err) {
    // Fallo: conservar memoria (no modificamos el store), permitir exportar.
    // El editor queda bloqueado hasta que el caller llame a resumeAutoSave.
    throw err;
  }
}

/**
 * Reanuda el guardado automático después de pauseAndFlush.
 * Desbloquea el editor e instala una nueva suscripción de auto-save.
 * Idempotente: seguro llamar aunque no haya pausa activa.
 */
export function resumeAutoSave(store: Store): void {
  _paused = false;
  store.getState().setEditingBlocked(false);
  _startAutoSaveSession(store);
}

/**
 * Recuperación tras fallo de carga. Garantías:
 * - _recovering se establece ANTES de cualquier await; una segunda llamada
 *   concurrente recibe { ok:false } inmediatamente.
 * - myVersion captura la identidad de sesión al inicio; tras cada await se
 *   verifica que la sesión siga vigente antes de modificar el store.
 * - myToken identifica qué recuperación es dueña de _recovering; solo esa
 *   operación lo libera, impidiendo que una antigua libere el bloqueo de una nueva.
 * - La sesión de auto-save previa se cancela antes de iniciar la escritura.
 * - Se escribe en IndexedDB ANTES de modificar el store; si la transacción
 *   falla, el store conserva su estado anterior.
 * - Si falla, _recovering vuelve a false y el usuario puede reintentar.
 * - Rechaza inmediatamente si el editor está bloqueado por pauseAndFlush.
 */
export async function recoverProject(
  store: Store,
  source: 'reset' | File,
  confirm: (msg: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (_paused) return { ok: false, error: 'El editor está en pausa' };
  if (_recovering) return { ok: false, error: 'Recuperación ya en curso' };
  _recovering = true; // bloqueo sincrónico antes de cualquier await
  const myToken = ++_recoveryToken;
  const myVersion = _sessionVersion;

  let objects: DomainObject[];
  let projectOrigin: Vec3mm;

  if (source === 'reset') {
    const proceed = confirm(
      '¿Restablecer la escena de ejemplo?\nSe perderán todos los cambios del proyecto actual.',
    );
    if (!proceed) {
      _recovering = false;
      return { ok: false, error: 'Restablecimiento cancelado' };
    }
    objects = INITIAL_OBJECTS.map((o) => ({
      ...o,
      position: { ...o.position },
      dimensions: { ...o.dimensions },
    }));
    projectOrigin = { x: 0, y: 0, z: 0 };
  } else {
    let raw: unknown;
    try {
      const text = await source.text();
      raw = JSON.parse(text);
    } catch {
      if (_recoveryToken === myToken) _recovering = false;
      return { ok: false, error: 'El archivo no es un JSON válido' };
    }

    // Verificar sesión tras el primer await (source.text()).
    if (_sessionVersion !== myVersion) {
      if (_recoveryToken === myToken) _recovering = false;
      return { ok: false, error: 'Sesión cancelada' };
    }

    let validated: ProjectData;
    try {
      validated = validateProjectData(raw);
    } catch (err) {
      if (_recoveryToken === myToken) _recovering = false;
      return { ok: false, error: String(err) };
    }

    const proceed = confirm(
      '¿Reemplazar el proyecto actual con el archivo importado?\nEsta acción no se puede deshacer.',
    );
    if (!proceed) {
      if (_recoveryToken === myToken) _recovering = false;
      return { ok: false, error: 'Importación cancelada' };
    }

    // Verificación defensiva antes de escribir (confirm es síncrono pero la
    // sesión pudo haber cambiado si confirm disparó efectos secundarios).
    if (_sessionVersion !== myVersion) {
      if (_recoveryToken === myToken) _recovering = false;
      return { ok: false, error: 'Sesión cancelada' };
    }

    objects = validated.objects;
    projectOrigin = validated.projectOrigin;
  }

  // Pausa el auto-save previo antes de escribir para evitar que una escritura
  // en vuelo sobrescriba el proyecto recuperado o modifique saveStatus.
  _cancelAutoSave?.();
  store.getState().setSaveStatus('recovering', null);

  const dataToSave: ProjectData = { schemaVersion: SCHEMA_VERSION, objects, projectOrigin };

  try {
    await saveProjectToDb(dataToSave);
  } catch (err) {
    if (_recoveryToken === myToken) _recovering = false;
    if (_sessionVersion === myVersion) {
      store.getState().setSaveStatus('error', `Error al recuperar: ${String(err)}`);
    }
    return { ok: false, error: `Error al guardar: ${String(err)}` };
  }

  // Solo libera el bloqueo si esta operación aún lo posee.
  if (_recoveryToken === myToken) _recovering = false;

  // Cancelar estos callbacks no aborta la transacción IndexedDB ya comprometida;
  // los datos pueden estar ya persistidos. Simplemente declinamos hidratar el store.
  if (_sessionVersion !== myVersion) {
    return { ok: false, error: 'Sesión cancelada' };
  }

  store.getState().hydrateProject(objects, projectOrigin);
  store.getState().setSaveStatus('saved', null);
  _startAutoSaveSession(store);

  return { ok: true };
}

/**
 * Exporta el proyecto como archivo JSON descargable.
 */
export function exportProject(store: Store): void {
  try {
    const data = snapshotData(store);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `proyecto-bandejas-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    store.getState().setSaveStatus('error', `Error al exportar: ${String(err)}`);
  }
}

/**
 * Importa un proyecto desde un archivo JSON (flujo normal, sin fallo de carga).
 * Para recuperar tras un fallo de carga usar recoverProject.
 * Rechaza si el editor está bloqueado por pauseAndFlush.
 */
export async function importProject(
  store: Store,
  file: File,
  confirm: (msg: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (_paused) return { ok: false, error: 'El editor está en pausa' };

  let raw: unknown;
  try {
    const text = await file.text();
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido' };
  }

  let validated: ProjectData;
  try {
    validated = validateProjectData(raw);
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  const proceed = confirm(
    '¿Reemplazar el proyecto actual con el archivo importado?\nEsta acción no se puede deshacer.',
  );
  if (!proceed) return { ok: false, error: 'Importación cancelada' };

  store.getState().hydrateProject(validated.objects, validated.projectOrigin);
  return { ok: true };
}

/**
 * Restablece la escena de ejemplo (flujo normal).
 * Para recuperar tras un fallo de carga usar recoverProject.
 * No hace nada si el editor está bloqueado por pauseAndFlush.
 */
export function resetProject(store: Store, confirm: (msg: string) => boolean): void {
  if (_paused) return;
  const proceed = confirm(
    '¿Restablecer la escena de ejemplo?\nSe perderán todos los cambios del proyecto actual.',
  );
  if (!proceed) return;
  store.getState().hydrateProject(
    INITIAL_OBJECTS.map((o) => ({
      ...o,
      position: { ...o.position },
      dimensions: { ...o.dimensions },
    })),
    { x: 0, y: 0, z: 0 },
  );
}
