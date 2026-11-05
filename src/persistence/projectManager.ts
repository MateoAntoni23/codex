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

/**
 * Conjunto de todas las escrituras en vuelo (auto-save, flush, recuperación).
 * pauseAndFlush espera TODAS antes del flush final.
 * El debounce no garantiza escrituras no concurrentes; se usa un Set para rastrearlas.
 */
const _inflightWrites = new Set<Promise<void>>();

/**
 * Estado de la operación de pausa activa. null = no hay pausa.
 * Solo la operación propietaria (identificada por token) puede cambiar o liberar este estado.
 *
 * Fases:
 *   waiting — esperando a que las escrituras en vuelo terminen
 *   writing  — escribiendo el snapshot final a IndexedDB
 *   paused   — escritura confirmada (o fallida); el caller debe llamar resumeAutoSave
 */
interface PauseOp {
  readonly token: symbol;
  readonly session: number;
  phase: 'waiting' | 'writing' | 'paused';
}
let _pauseOp: PauseOp | null = null;

/** Incrementado por initProject (nueva sesión) y por cancel() (fin de sesión).
 *  Cada llamada a recoverProject y pauseAndFlush captura myVersion = _sessionVersion;
 *  si difieren al continuar, la operación pertenece a una sesión obsoleta. */
let _sessionVersion = 0;

/** Incrementado por cada llamada a recoverProject; identifica qué recuperación
 *  es propietaria del flag _recovering para no liberarlo desde otra. */
let _recoveryToken = 0;

/**
 * Error lanzado por pauseAndFlush cuando la escritura del flush falla.
 * Incluye pauseToken para que el caller pueda llamar resumeAutoSave y desbloquear el editor.
 */
export class PauseFlushError extends Error {
  readonly pauseToken: symbol;
  constructor(message: string, pauseToken: symbol) {
    super(message);
    this.name = 'PauseFlushError';
    this.pauseToken = pauseToken;
  }
}

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
  _pauseOp = null;
  _inflightWrites.clear();
  _sessionVersion = 0;
  _recoveryToken = 0;
}

function _trackWrite(p: Promise<void>): void {
  _inflightWrites.add(p);
  // .catch suppresses the unhandled rejection on the finally-chain (the caller awaits p directly)
  p.finally(() => _inflightWrites.delete(p)).catch(() => {});
}

// ─── Sesión de auto-save ──────────────────────────────────────────────────────

/**
 * Instala una única suscripción de guardado automático con debounce de 1 s.
 * El estado y la generación se actualizan INMEDIATAMENTE en la suscripción.
 * Los callbacks comprueban `cancelled` antes de modificar saveStatus,
 * evitando que una escritura en vuelo afecte una sesión posterior.
 * Cancela cualquier sesión anterior antes de instalar la nueva.
 * Registra cada escritura en _inflightWrites vía _trackWrite para que
 * pauseAndFlush pueda esperar todas antes del flush final.
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
        _trackWrite(writePromise);
        try {
          await writePromise;
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
  ++_sessionVersion; // nueva sesión

  let cancelled = false;

  function cancel() {
    cancelled = true;
    ++_sessionVersion;        // invalida operaciones en vuelo de esta sesión
    _recovering = false;      // permite nuevo recover tras remount
    _pauseOp = null;          // libera pausa activa; resumeAutoSave con tokens de esta sesión rechazará
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
 * Pausa el guardado automático, espera TODAS las escrituras en vuelo, captura
 * el estado de memoria actual y lo persiste en IndexedDB. Bloquea toda
 * modificación del editor durante la pausa.
 *
 * Retorna { snapshot, pauseToken }. pauseToken es el identificador de esta pausa;
 * debe pasarse a resumeAutoSave. En caso de fallo en la escritura lanza
 * PauseFlushError (que también expone pauseToken) para que el caller pueda
 * desbloquear el editor llamando resumeAutoSave con ese token.
 *
 * Garantías:
 * - _pauseOp se establece ANTES de cualquier await (fase 'waiting'); segunda
 *   llamada concurrente rechaza inmediatamente.
 * - Rechaza si una recuperación está en curso o si la carga inicial no terminó.
 * - Espera TODAS las escrituras en vuelo (_inflightWrites) antes del flush final,
 *   incluidas escrituras de sesiones previas. resumeAutoSave bloquea durante
 *   las fases 'waiting' y 'writing'.
 * - Solo la operación propietaria (token) puede cambiar o liberar _pauseOp;
 *   el finally de una pausa antigua no altera el estado de una pausa posterior.
 * - Verifica identidad de sesión antes Y después de la escritura del flush.
 * - cancel() limpia _pauseOp; resumeAutoSave con tokens de esta sesión rechazará.
 */
export async function pauseAndFlush(
  store: Store,
): Promise<{ snapshot: ProjectData; pauseToken: symbol }> {
  if (_pauseOp != null) return Promise.reject(new Error('pauseAndFlush ya está en curso'));
  if (_recovering) return Promise.reject(new Error('No se puede pausar durante una recuperación'));
  if (store.getState().saveStatus === 'loading') {
    return Promise.reject(new Error('No se puede pausar durante la carga inicial'));
  }

  const myToken = Symbol('pause');
  const mySession = _sessionVersion;
  _pauseOp = { token: myToken, session: mySession, phase: 'waiting' };

  // Bloquea toda modificación del editor
  store.getState().setEditingBlocked(true);

  // Cancela suscripción y temporizador pendiente sin descartar la memoria
  _cancelAutoSave?.();

  // Fase waiting: espera TODAS las escrituras en vuelo
  if (_inflightWrites.size > 0) {
    await Promise.all([..._inflightWrites].map(p => p.catch(() => {})));
  }

  // Verifica que la sesión siga vigente y que somos los dueños de la pausa
  if (_sessionVersion !== mySession || _pauseOp?.token !== myToken) {
    return Promise.reject(new Error('Sesión cancelada durante pauseAndFlush'));
  }

  // Transición a fase writing
  _pauseOp = { token: myToken, session: mySession, phase: 'writing' };
  const snapshot = snapshotData(store);

  const flushWrite = saveProjectToDb(snapshot);
  _trackWrite(flushWrite);
  try {
    await flushWrite;

    // Verifica sesión también tras la escritura
    if (_sessionVersion !== mySession || _pauseOp?.token !== myToken) {
      throw new Error('Sesión cancelada durante pauseAndFlush');
    }

    // Transición a fase paused (éxito): el caller llama resumeAutoSave cuando corresponda
    _pauseOp = { token: myToken, session: mySession, phase: 'paused' };
    return { snapshot, pauseToken: myToken };
  } catch (err) {
    if (_pauseOp?.token === myToken) {
      // La operación sigue siendo nuestra: mantener estado 'paused' para permitir resumeAutoSave
      _pauseOp = { token: myToken, session: mySession, phase: 'paused' };
      throw new PauseFlushError(err instanceof Error ? err.message : String(err), myToken);
    }
    // Sesión cancelada: _pauseOp ya fue limpiado por cancel(); propagar error original
    throw err;
  }
}

/**
 * Reanuda el guardado automático después de pauseAndFlush.
 * Desbloquea el editor e instala una nueva suscripción de auto-save.
 * pauseToken debe ser el identificador retornado por pauseAndFlush (o el
 * expuesto en PauseFlushError si la escritura falló).
 * Lanza si no hay pausa activa con ese token o si aún está en fase waiting/writing.
 */
export function resumeAutoSave(store: Store, pauseToken: symbol): void {
  const op = _pauseOp;
  if (op == null) {
    throw new Error('No hay pausa activa para reanudar');
  }
  if (op.phase !== 'paused') {
    throw new Error('No se puede reanudar: pauseAndFlush está en progreso');
  }
  if (op.token !== pauseToken) {
    throw new Error('Identificador de pausa inválido');
  }
  _pauseOp = null;
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
 * - Rechaza inmediatamente si hay una pausa activa (pauseAndFlush en curso).
 */
export async function recoverProject(
  store: Store,
  source: 'reset' | File,
  confirm: (msg: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (_pauseOp != null) return { ok: false, error: 'El editor está en pausa' };
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

  const recoverWrite = saveProjectToDb(dataToSave);
  _trackWrite(recoverWrite);
  try {
    await recoverWrite;
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
  if (_pauseOp == null) { _startAutoSaveSession(store); }

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
  if (_pauseOp != null) return { ok: false, error: 'El editor está en pausa' };

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
  if (_pauseOp != null) return;
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
