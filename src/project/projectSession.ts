/**
 * projectSession — ciclo de vida del proyecto del espacio de trabajo.
 *
 *   - Autoguardado local en IndexedDB (`projectDb.ts`, base propia) con restauración
 *     al abrir y estado visible (restaurando / guardado / guardando / error).
 *   - Acciones de proyecto: nuevo, abrir archivo, guardar copia.
 *   - Abrir un archivo NO toca la biblioteca local salvo que el usuario elija
 *     "adoptar" ante una diferencia (ver `configurator/libraryBlock.ts`).
 *
 * Decisiones:
 *   - El proyecto = elementos + evidencia + meta + trazado + catálogo importado, más
 *     el estado de sesión (nombre de archivo y selección). El historial de
 *     deshacer NO se persiste (hito posterior: historial unificado).
 *   - La biblioteca NO se autoguarda aquí: su autoridad es localStorage
 *     (`codex:catalogConfig:v1`) y ya persiste por su propio store.
 *   - Un fallo de escritura en IndexedDB sólo cambia el estado a "error": nunca
 *     modifica los stores en memoria; se reintenta con el siguiente cambio o con
 *     "Reintentar".
 *   - Autoguardado con debounce corto; una sola escritura en vuelo (si hubo cambios
 *     durante la escritura se vuelve a escribir al terminar).
 */
import { loadStaticCatalog } from '../catalog/staticCatalog';
import { migrarBibliotecaPorSku } from '../configurator/migracionCalibracion';
import { create } from 'zustand';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useRoutingStore } from '../workspace/useRoutingStore';
import { useTrayStore } from '../tray/store';
import { useCatalogConfigStore } from '../configurator/catalogConfigStore';
import {
  exportWorkspace,
  extractMeta,
  importWorkspace,
  type ParsedWorkspaceFile,
} from '../workspace/workspaceFile';
import { emptyTrayInput } from './emptyProject';
import {
  RECORD_SCHEMA,
  quarantineCurrentRecord,
  readCurrentRecord,
  writeCurrentRecord,
  type ProjectRecord,
} from './projectDb';
import {
  backupLocalLibrary,
  describeLibraryDiff,
  libraryDiffers,
  type FileLibrary,
  type LibrarySnapshot,
} from '../configurator/libraryBlock';
import type { ImportedCatalog } from '../import/types';
import type { TrayInput } from '../tray/model';

// ─── Estado visible ──────────────────────────────────────────────────────────

export type SavePhase = 'restoring' | 'idle' | 'saving' | 'saved' | 'error';

interface ProjectStatus {
  phase: SavePhase;
  /** ISO del último guardado confirmado en IndexedDB. */
  savedAt: string | null;
  error: string | null;
  /** Aviso informativo (p. ej. registro dañado apartado al restaurar). */
  notice: string | null;
  /** `true` cuando terminó la restauración inicial. */
  booted: boolean;
  /** Si es `true` no se escribe (no se pudo apartar un registro ilegible). */
  blocked: boolean;
}

export const useProjectStatusStore = create<ProjectStatus>(() => ({
  phase: 'restoring',
  savedAt: null,
  error: null,
  notice: null,
  booted: false,
  blocked: false,
}));

const status = (p: Partial<ProjectStatus>) => useProjectStatusStore.setState(p);

// ─── Snapshot ────────────────────────────────────────────────────────────────

interface SessionState {
  fileName: string | null;
  selectedEquipId: string | null;
  selectedTrayId: string | null;
  selectedSupportId: string | null;
}

/** Arma el registro a persistir a partir del estado actual de los stores. */
export function buildRecord(): ProjectRecord {
  const w = useWorkspaceStore.getState();
  const t = useTrayStore.getState();
  const session: SessionState = {
    fileName: w.fileName,
    selectedEquipId: w.selectedEquipId,
    selectedTrayId: w.selectedTrayId,
    selectedSupportId: w.selectedSupportId,
  };
  return {
    schema: RECORD_SCHEMA,
    savedAt: new Date().toISOString(),
    project: {
      projectV2: { schemaVersion: 2, elements: w.elements, evidence: w.evidence, ...w.projectMeta },
      trayInput: t.entrada ?? emptyTrayInput(),
      importedCatalog: w.importedCatalog,
    },
    session,
  };
}

type ParsedRecord =
  | { ok: true; project: ParsedWorkspaceFile; stored: StoredProject; session: SessionState }
  | { ok: false; reason: string };

interface StoredProject {
  projectV2: { elements: never[]; evidence: never[] } & Record<string, unknown>;
  trayInput: TrayInput;
  importedCatalog: ImportedCatalog | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Valida un registro leído de IndexedDB con las mismas reglas que un archivo de
 * proyecto (`importWorkspace`). Si es válido se aplica el contenido GUARDADO tal
 * cual (no la copia normalizada): así recargar reproduce el estado exacto.
 */
export function parseRecord(raw: unknown): ParsedRecord {
  try {
    if (!isObj(raw) || raw.schema !== RECORD_SCHEMA || !isObj(raw.project)) {
      return { ok: false, reason: 'registro con formato desconocido' };
    }
    const p = raw.project as Record<string, unknown>;
    const asFile = JSON.stringify({
      fileVersion: 2,
      exportedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
      projectV2: p.projectV2,
      trayInput: p.trayInput,
      ...(p.importedCatalog
        ? { importedCatalog: { version: 'codex:importedCatalog/1', catalog: p.importedCatalog } }
        : {}),
    });
    const validated = importWorkspace(asFile);
    const s = isObj(raw.session) ? raw.session : {};
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      ok: true,
      project: validated,
      stored: {
        projectV2: p.projectV2 as StoredProject['projectV2'],
        trayInput: p.trayInput as TrayInput,
        importedCatalog: (p.importedCatalog as ImportedCatalog | null) ?? null,
      },
      session: {
        fileName: str(s.fileName),
        selectedEquipId: str(s.selectedEquipId),
        selectedTrayId: str(s.selectedTrayId),
        selectedSupportId: str(s.selectedSupportId),
      },
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Restauración y autoguardado ─────────────────────────────────────────────

let bootPromise: Promise<void> | null = null;

/** Restaura el último proyecto autoguardado (una sola vez por carga de página). */
export function bootProject(): Promise<void> {
  if (!bootPromise) bootPromise = doBoot();
  return bootPromise;
}

/** Sólo pruebas: permite volver a ejecutar bootProject(). */
export function _resetBootForTests(): void {
  bootPromise = null;
  status({ phase: 'restoring', savedAt: null, error: null, notice: null, booted: false, blocked: false });
}

async function doBoot(): Promise<void> {
  status({ phase: 'restoring' });
  let raw: unknown;
  try {
    raw = await readCurrentRecord();
  } catch (e) {
    // No se pudo leer: trabajar en memoria, pero NO escribir encima de un registro
    // que quizá exista y no pudimos leer.
    status({
      phase: 'error',
      error: `No se pudo leer el proyecto guardado: ${errMsg(e)}`,
      blocked: true,
      booted: true,
    });
    return;
  }
  if (raw == null) {
    status({ phase: 'idle', booted: true });
    return;
  }
  const parsed = parseRecord(raw);
  if (!parsed.ok) {
    try {
      const key = await quarantineCurrentRecord(raw);
      status({
        phase: 'idle',
        booted: true,
        notice: `El proyecto guardado estaba dañado (${parsed.reason}); se apartó como "${key}" y se abrió un proyecto vacío.`,
      });
    } catch (e) {
      status({
        phase: 'error',
        error: `El proyecto guardado está dañado (${parsed.reason}) y no se pudo apartar: ${errMsg(e)}`,
        blocked: true,
        booted: true,
      });
    }
    return;
  }
  const { stored, session } = parsed;
  const proj = stored.projectV2 as unknown as ParsedWorkspaceFile['projectV2'];
  applyProject({
    elements: proj.elements,
    evidence: proj.evidence,
    meta: extractMeta(proj),
    trayInput: stored.trayInput,
    importedCatalog: stored.importedCatalog,
    fileName: session.fileName,
  });
  restoreSelection(session);
  status({ phase: 'saved', savedAt: typeof (raw as ProjectRecord).savedAt === 'string' ? (raw as ProjectRecord).savedAt : null, booted: true });
}

function restoreSelection(s: SessionState): void {
  const w = useWorkspaceStore.getState();
  if (s.selectedEquipId && w.elements.some((e) => e.id === s.selectedEquipId)) w.selectEquip(s.selectedEquipId);
  else if (s.selectedTrayId) w.selectTray(s.selectedTrayId);
  else if (s.selectedSupportId) w.selectSupport(s.selectedSupportId);
}

function errMsg(e: unknown): string {
  if (e instanceof DOMException) return `${e.name}${e.message ? `: ${e.message}` : ''}`;
  return e instanceof Error ? e.message : String(e);
}

const DEBOUNCE_MS = 500;
let writing: Promise<void> | null = null;
let version = 0; // se incrementa en cada cambio detectado
let writtenVersion = 0;

function tracked() {
  const w = useWorkspaceStore.getState();
  const t = useTrayStore.getState();
  return [
    w.elements, w.evidence, w.projectMeta, w.importedCatalog, w.fileName,
    w.selectedEquipId, w.selectedTrayId, w.selectedSupportId, t.entrada,
  ];
}

/** Escribe el estado actual en IndexedDB. Nunca modifica los stores. */
export async function saveNow(): Promise<void> {
  if (useProjectStatusStore.getState().blocked) return;
  if (writing) {
    await writing;
    if (writtenVersion >= version) return;
  }
  const target = version;
  status({ phase: 'saving', error: null });
  writing = (async () => {
    try {
      await writeCurrentRecord(buildRecord());
      writtenVersion = target;
      if (version > target) {
        // Hubo cambios durante la escritura: el siguiente ciclo del debounce los guarda.
        status({ phase: 'saving', savedAt: new Date().toISOString() });
      } else {
        status({ phase: 'saved', savedAt: new Date().toISOString(), error: null });
      }
    } catch (e) {
      status({ phase: 'error', error: `No se pudo guardar en este equipo: ${errMsg(e)}` });
    }
  })();
  try {
    await writing;
  } finally {
    writing = null;
  }
}

/**
 * Suscribe el autoguardado a los stores. Debe llamarse DESPUÉS de `bootProject()`:
 * si se suscribiera antes, un estado vacío podría pisar el proyecto guardado.
 * Devuelve la función que cancela la suscripción.
 */
export function startAutosave(): () => void {
  let prev = tracked();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveNow();
    }, DEBOUNCE_MS);
  };
  const onChange = () => {
    const cur = tracked();
    if (cur.every((v, i) => v === prev[i])) return;
    prev = cur;
    version++;
    if (!useProjectStatusStore.getState().blocked) {
      status({ phase: 'saving' });
      schedule();
    }
  };
  const unsubW = useWorkspaceStore.subscribe(onChange);
  const unsubT = useTrayStore.subscribe(onChange);
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      void saveNow();
    }
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return () => {
    unsubW();
    unsubT();
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
  };
}

/** Reintenta el guardado tras un error (botón "Reintentar"). */
export function retrySave(): void {
  version++;
  void saveNow();
}

// ─── Aplicar un proyecto a los stores ────────────────────────────────────────

interface ProjectContent {
  elements: ParsedWorkspaceFile['projectV2']['elements'];
  evidence: ParsedWorkspaceFile['projectV2']['evidence'];
  meta: ReturnType<typeof extractMeta>;
  trayInput: TrayInput;
  importedCatalog: ImportedCatalog | null;
  fileName: string | null;
}

function applyProject(c: ProjectContent): void {
  useWorkspaceStore.getState().loadFile(c.elements, c.evidence, c.meta, c.fileName ?? '', c.importedCatalog);
  if (c.fileName === null) useWorkspaceStore.setState({ fileName: null });
  // importEdit reinicia historial/futuro: deshacer nunca cruza proyectos.
  useTrayStore.getState().importEdit(c.trayInput);
  useRoutingStore.getState().deactivate();
}

// ─── Acciones de proyecto ────────────────────────────────────────────────────

/** ¿Hay algo que se perdería al reemplazar el proyecto? */
export function hasProjectContent(): boolean {
  const w = useWorkspaceStore.getState();
  const t = useTrayStore.getState().entrada;
  return (
    w.elements.length > 0 ||
    w.evidence.length > 0 ||
    w.importedCatalog !== null ||
    (t !== null &&
      (t.piezas.length > 0 || t.conexiones.length > 0 || t.circuitos.length > 0 || t.soportes.length > 0))
  );
}

/** Proyecto nuevo y vacío. NO toca la biblioteca. */
export function newProject(): void {
  useWorkspaceStore.getState().reset();
  useTrayStore.getState().importEdit(emptyTrayInput());
  useRoutingStore.getState().deactivate();
}

export function localLibrary(): LibrarySnapshot {
  const c = useCatalogConfigStore.getState();
  return {
    overrides: c.overrides as LibrarySnapshot['overrides'],
    approvals: c.approvals as LibrarySnapshot['approvals'],
    aporteOverrides: c.aporteOverrides as LibrarySnapshot['aporteOverrides'],
    calibracion: c.calibracion,
  };
}

/** Serializa el proyecto actual (fileVersion 2, con biblioteca completa). Funciona sin motor. */
export function buildProjectCopy(): { json: string; name: string } {
  const w = useWorkspaceStore.getState();
  const lib = localLibrary();
  const json = exportWorkspace(
    w.elements,
    w.evidence,
    w.projectMeta,
    useTrayStore.getState().entrada ?? emptyTrayInput(),
    lib.overrides,
    w.importedCatalog,
    { approvals: lib.approvals, aporteOverrides: lib.aporteOverrides, calibracion: lib.calibracion },
  );
  return { json, name: `workspace-${new Date().toISOString().slice(0, 10)}.json` };
}

export type LibraryChoice = 'local' | 'adopt' | 'cancel';

export interface LibraryConflict {
  fileName: string;
  differences: string[];
  partial: boolean;
}

export type OpenResult =
  | { status: 'opened'; libraryAdopted: boolean; backupKey: string | null }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

/**
 * Abre un proyecto desde el texto de un archivo (fileVersion 1 ó 2).
 * Orden: validar → (si la biblioteca del archivo difiere) preguntar → recién
 * entonces aplicar. Cancelar o fallar no deja ningún cambio a medias.
 */
export async function openProjectText(
  text: string,
  fileName: string,
  chooseLibrary: (c: LibraryConflict) => Promise<LibraryChoice>,
): Promise<OpenResult> {
  let parsed: ParsedWorkspaceFile;
  try {
    parsed = importWorkspace(text);
  } catch (e) {
    return { status: 'error', error: errMsg(e) };
  }
  let adopted = false;
  let backupKey: string | null = null;
  const local = localLibrary();
  const fileLib: FileLibrary | null = parsed.library;
  if (fileLib && libraryDiffers(local, fileLib)) {
    const choice = await chooseLibrary({
      fileName,
      differences: describeLibraryDiff(local, fileLib),
      partial: fileLib.partial,
    });
    if (choice === 'cancel') return { status: 'cancelled' };
    if (choice === 'adopt') {
      backupKey = backupLocalLibrary(local);
      if (!backupKey) {
        return {
          status: 'error',
          error: 'No se pudo guardar la copia de la biblioteca anterior; no se adoptó la del archivo.',
        };
      }
      // Biblioteca por SKU (formato anterior): se migra a calibración por patrón (B-2.6).
      let aAdoptar: FileLibrary = fileLib;
      if (fileLib.porSku) {
        const cat = await loadStaticCatalog();
        const r = migrarBibliotecaPorSku(fileLib.overrides, cat.productos);
        aAdoptar = { ...fileLib, overrides: r.overridesNombres, calibracion: r.biblioteca };
      }
      const ok = useCatalogConfigStore.getState().replaceLibrary(aAdoptar, { partial: fileLib.partial });
      if (!ok) {
        return { status: 'error', error: 'No se pudo escribir la biblioteca adoptada en este equipo.' };
      }
      adopted = true;
    }
  }
  applyProject({
    elements: parsed.projectV2.elements,
    evidence: parsed.projectV2.evidence,
    meta: extractMeta(parsed.projectV2),
    trayInput: parsed.trayInput,
    importedCatalog: parsed.importedCatalog?.catalog ?? null,
    fileName,
  });
  return { status: 'opened', libraryAdopted: adopted, backupKey };
}
