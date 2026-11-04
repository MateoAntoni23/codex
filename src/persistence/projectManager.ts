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

/** Cancel handle de la suscripción de auto-save.
 *  Puede ser establecido por initProject (carga exitosa) o por recoverProject. */
let _cancelAutoSave: (() => void) | null = null;

// ─── Helpers de test ─────────────────────────────────────────────────────────

/** Reset interno — solo para pruebas. */
export function _resetSaveGeneration(): void {
  _saveGeneration = 0;
}

/** Cancela la sesión activa (init + auto-save) y resetea flags — solo para pruebas. */
export function _resetInitialized(): void {
  _cancelInit?.();
  _cancelInit = null;
  _cancelAutoSave?.();
  _cancelAutoSave = null;
}

// ─── Auto-save session ───────────────────────────────────────────────────────

/**
 * Instala una única suscripción de guardado automático con debounce de 1 s.
 * El estado y la generación se actualizan INMEDIATAMENTE en la suscripción;
 * la escritura real se pospone para coalescer cambios rápidos.
 * Cancela cualquier suscripción previa antes de instalar la nueva.
 * Los callbacks verifican `cancelled` antes de modificar saveStatus,
 * evitando que una escritura en vuelo afecte una sesión posterior.
 */
function _startAutoSaveSession(store: Store): void {
  _cancelAutoSave?.(); // asegura una única suscripción activa

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

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Inicializa el proyecto: carga desde IndexedDB si existe, luego activa el
 * guardado automático. Retorna { cancel, ready } de forma sincrónica.
 * Usar `cancel` como cleanup del useEffect evita dobles suscripciones en
 * React Strict Mode y cancela la carga si el componente se desmonta antes
 * de que termine.
 * El auto-save NO se activa si la carga falla; usar `recoverProject` para
 * restaurar el guardado tras un error de carga.
 * Llamadas adicionales sin cancel previo son ignoradas.
 */
export function initProject(store: Store): { cancel: () => void; ready: Promise<void> } {
  if (_initialized) {
    return { cancel: () => {}, ready: Promise.resolve() };
  }
  _initialized = true;

  let cancelled = false;

  function cancel() {
    cancelled = true;
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
 * Recuperación tras fallo de carga. Valida el origen (archivo o escena por
 * defecto), pide confirmación, guarda en la base de datos ANTES de modificar
 * el store y, solo si la transacción confirma, hidrata el store y reactiva
 * el guardado automático.
 *
 * Garantías:
 * - Cancelar o recibir un archivo inválido no altera el store.
 * - Si la escritura falla, el store conserva los datos previos y se informa
 *   el error; el usuario puede reintentar o exportar.
 * - Tras el éxito se instala una única suscripción de auto-save.
 */
export async function recoverProject(
  store: Store,
  source: 'reset' | File,
  confirm: (msg: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let objects: DomainObject[];
  let projectOrigin: Vec3mm;

  if (source === 'reset') {
    const proceed = confirm(
      '¿Restablecer la escena de ejemplo?\nSe perderán todos los cambios del proyecto actual.',
    );
    if (!proceed) return { ok: false, error: 'Restablecimiento cancelado' };
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

    objects = validated.objects;
    projectOrigin = validated.projectOrigin;
  }

  // Guardar ANTES de hidratar: si la transacción falla, el store no se modifica.
  const dataToSave: ProjectData = { schemaVersion: SCHEMA_VERSION, objects, projectOrigin };
  store.getState().setSaveStatus('saving', null);

  try {
    await saveProjectToDb(dataToSave);
  } catch (err) {
    store.getState().setSaveStatus('error', `Error al recuperar: ${String(err)}`);
    return { ok: false, error: `Error al guardar: ${String(err)}` };
  }

  // La transacción confirmó: hidratar store y reactivar auto-save.
  store.getState().hydrateProject(objects, projectOrigin);
  store.getState().setSaveStatus('saved', null);
  _startAutoSaveSession(store);

  return { ok: true };
}

/**
 * Exporta el proyecto como archivo JSON descargable.
 * El origen se expresa en mm respecto del sistema global.
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
 * Valida antes de modificar el proyecto y pide confirmación al usuario.
 * Un archivo inválido no altera el proyecto existente.
 * Para recuperar tras un fallo de carga usar `recoverProject`.
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
 * Restablece la escena de ejemplo después de pedir confirmación (flujo normal).
 * Para recuperar tras un fallo de carga usar `recoverProject`.
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
