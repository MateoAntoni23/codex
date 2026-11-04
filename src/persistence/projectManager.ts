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

/** true después de que cancel() fue invocado (cleanup del efecto / desmontaje).
 *  Impide que callbacks de operaciones en vuelo modifiquen el estado de una
 *  sesión posterior. Se resetea al inicio de cada nueva sesión de initProject. */
let _sessionCancelled = false;

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
  _sessionCancelled = false;
}

// ─── Sesión de auto-save ──────────────────────────────────────────────────────

/**
 * Instala una única suscripción de guardado automático con debounce de 1 s.
 * El estado y la generación se actualizan INMEDIATAMENTE en la suscripción.
 * Los callbacks comprueban `cancelled` antes de modificar saveStatus,
 * evitando que una escritura en vuelo afecte una sesión posterior.
 * Cancela cualquier sesión anterior antes de instalar la nueva.
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
        try {
          await saveProjectToDb(snapshotData(store));
          if (!cancelled && myGen === _saveGeneration) {
            store.getState().setSaveStatus('saved', null);
          }
        } catch (err) {
          if (!cancelled && myGen === _saveGeneration) {
            store.getState().setSaveStatus('error', `Error al guardar: ${String(err)}`);
          }
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
  _sessionCancelled = false; // nueva sesión comienza sin cancelación pendiente

  let cancelled = false;

  function cancel() {
    cancelled = true;
    _sessionCancelled = true; // señal para operaciones en vuelo (recovery)
    _recovering = false;      // permite reintento tras remount
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
 * Recuperación tras fallo de carga. Garantías:
 * - _recovering se establece ANTES de cualquier await; una segunda llamada
 *   concurrente recibe { ok:false } inmediatamente.
 * - La sesión de auto-save previa se cancela (junto con sus timers y
 *   sus callbacks en vuelo) antes de iniciar la escritura.
 * - Se escribe en IndexedDB ANTES de modificar el store; si la transacción
 *   falla, el store conserva su estado anterior.
 * - Tras cada await se comprueba _sessionCancelled; si la aplicación fue
 *   desmontada durante la escritura, no se hidrata ni se activa la suscripción.
 * - Si falla, _recovering vuelve a false y el usuario puede reintentar.
 */
export async function recoverProject(
  store: Store,
  source: 'reset' | File,
  confirm: (msg: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (_recovering) return { ok: false, error: 'Recuperación ya en curso' };
  _recovering = true; // bloqueo sincrónico antes de cualquier await

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
      const text = await source.text(); // único await antes de pausar auto-save
      raw = JSON.parse(text);
    } catch {
      _recovering = false;
      return { ok: false, error: 'El archivo no es un JSON válido' };
    }

    let validated: ProjectData;
    try {
      validated = validateProjectData(raw);
    } catch (err) {
      _recovering = false;
      return { ok: false, error: String(err) };
    }

    const proceed = confirm(
      '¿Reemplazar el proyecto actual con el archivo importado?\nEsta acción no se puede deshacer.',
    );
    if (!proceed) {
      _recovering = false;
      return { ok: false, error: 'Importación cancelada' };
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
    _recovering = false;
    if (!_sessionCancelled) {
      store.getState().setSaveStatus('error', `Error al recuperar: ${String(err)}`);
    }
    return { ok: false, error: `Error al guardar: ${String(err)}` };
  }

  _recovering = false;

  // La aplicación puede haberse desmontado mientras esperábamos la escritura.
  if (_sessionCancelled) {
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
 */
export async function importProject(
  store: Store,
  file: File,
  confirm: (msg: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
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
 */
export function resetProject(store: Store, confirm: (msg: string) => boolean): void {
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
