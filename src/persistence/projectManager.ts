import { SCHEMA_VERSION, type ProjectData } from './schema';
import { validateProjectData } from './validate';
import { loadProjectFromDb, saveProjectToDb } from './db';
import { INITIAL_OBJECTS } from '../store/initialObjects';
import type { useSceneStore as StoreType } from '../store/sceneStore';

type Store = typeof StoreType;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

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

let _saveGeneration = 0;

/** Reset the generation counter — for testing only. */
export function _resetSaveGeneration(): void {
  _saveGeneration = 0;
}

/**
 * Inicializa el proyecto: carga desde IndexedDB si existe, luego activa el
 * guardado automático. Debe llamarse una sola vez al arrancar la aplicación.
 * No escribe en la base de datos antes de terminar la carga.
 */
export async function initProject(store: Store): Promise<void> {
  store.getState().setSaveStatus('loading', null);
  try {
    const saved = await loadProjectFromDb();
    if (saved != null) {
      const validated = validateProjectData(saved);
      store.getState().hydrateProject(validated.objects, validated.projectOrigin);
      store.getState().setSaveStatus('saved', null);
    } else {
      store.getState().setSaveStatus('idle', null);
    }
  } catch (err) {
    store.getState().setSaveStatus('error', `Error al cargar: ${String(err)}`);
  }

  // Auto-save: starts AFTER the initial load, preventing overwriting existing data.
  const triggerSave = debounce(async () => {
    const myGen = ++_saveGeneration;
    store.getState().setSaveStatus('saving', null);
    try {
      await saveProjectToDb(snapshotData(store));
      if (myGen === _saveGeneration) {
        store.getState().setSaveStatus('saved', null);
      }
    } catch (err) {
      if (myGen === _saveGeneration) {
        store.getState().setSaveStatus('error', `Error al guardar: ${String(err)}`);
      }
    }
  }, 1000);

  store.subscribe((state, prev) => {
    if (state.objects !== prev.objects || state.projectOrigin !== prev.projectOrigin) {
      triggerSave();
    }
  });
}

/**
 * Exporta el proyecto como archivo JSON descargable.
 * El origen se expresa en mm respecto del sistema global.
 */
export function exportProject(store: Store): void {
  const data = snapshotData(store);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `proyecto-bandejas-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Importa un proyecto desde un archivo JSON.
 * Valida antes de modificar el proyecto y pide confirmación al usuario.
 * Un archivo inválido no altera el proyecto existente.
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
 * Restablece la escena de ejemplo después de pedir confirmación.
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
