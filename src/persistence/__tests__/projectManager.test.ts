// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useSceneStore } from '../../store/sceneStore';
import { INITIAL_OBJECTS } from '../../store/initialObjects';
import { SCHEMA_VERSION, type ProjectData } from '../schema';

// Mock the DB module so tests run without real IndexedDB.
vi.mock('../db', () => ({
  loadProjectFromDb: vi.fn(),
  saveProjectToDb: vi.fn(),
}));

import { loadProjectFromDb, saveProjectToDb } from '../db';
import {
  initProject,
  exportProject,
  importProject,
  resetProject,
  recoverProject,
  pauseAndFlush,
  resumeAutoSave,
  _resetSaveGeneration,
  _resetInitialized,
} from '../projectManager';

const mockLoad = loadProjectFromDb as ReturnType<typeof vi.fn>;
const mockSave = saveProjectToDb as ReturnType<typeof vi.fn>;

const SAVED_PROJECT: ProjectData = {
  schemaVersion: SCHEMA_VERSION,
  projectOrigin: { x: 1000, y: 500, z: 200 },
  objects: [
    {
      id: 'motor-1',
      name: 'Motor guardado',
      type: 'motor',
      position: { x: 9000, y: 9000, z: 400 },
      dimensions: { width: 600, depth: 600, height: 800 },
    },
  ],
};

function resetStore() {
  useSceneStore.setState({
    objects: INITIAL_OBJECTS.map((o) => ({ ...o, position: { ...o.position } })),
    selectedId: null,
    projectOrigin: { x: 0, y: 0, z: 0 },
    saveStatus: 'loading',
    saveError: null,
    editingBlocked: false,
  });
}

beforeEach(() => {
  resetStore();
  _resetSaveGeneration();
  _resetInitialized();
  mockLoad.mockReset();
  mockSave.mockReset();
  mockSave.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Helper: start initProject and wait for the load phase to complete.
async function init(opts?: { load?: unknown }) {
  if (opts?.load !== undefined) {
    mockLoad.mockResolvedValue(opts.load);
  }
  const { cancel, ready } = initProject(useSceneStore);
  await ready;
  return cancel;
}

// Duck-typed file to avoid jsdom File.text() encoding quirks.
function makeFile(content: string): File {
  return { text: () => Promise.resolve(content) } as unknown as File;
}

// ─── initProject — sin datos guardados ───────────────────────────────────────

describe('initProject — sin datos guardados', () => {
  it('mantiene los objetos iniciales cuando no hay datos en la DB', async () => {
    await init({ load: null });
    expect(useSceneStore.getState().objects.some((o) => o.id === 'panel-1')).toBe(true);
  });

  it('establece saveStatus=idle cuando no hay datos guardados', async () => {
    await init({ load: null });
    expect(useSceneStore.getState().saveStatus).toBe('idle');
  });
});

// ─── initProject — con datos guardados ───────────────────────────────────────

describe('initProject — con datos guardados', () => {
  it('hidrata el store con los datos guardados', async () => {
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await init({});
    const state = useSceneStore.getState();
    expect(state.objects).toHaveLength(1);
    expect(state.objects[0].position).toEqual({ x: 9000, y: 9000, z: 400 });
    expect(state.projectOrigin).toEqual({ x: 1000, y: 500, z: 200 });
  });

  it('establece saveStatus=saved cuando hay datos guardados', async () => {
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await init({});
    expect(useSceneStore.getState().saveStatus).toBe('saved');
  });

  it('no sobrescribe datos guardados con la escena inicial', async () => {
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await init({});
    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ─── initProject — fallo de IndexedDB al cargar ───────────────────────────────

describe('initProject — fallo de IndexedDB al cargar', () => {
  it('establece saveStatus=error y conserva objetos en memoria', async () => {
    mockLoad.mockRejectedValue(new Error('Disco lleno'));
    await init({});
    const state = useSceneStore.getState();
    expect(state.saveStatus).toBe('error');
    expect(state.saveError).toMatch(/cargar/);
    expect(state.objects.length).toBeGreaterThan(0);
  });

  it('no activa el auto-save tras un fallo de carga', async () => {
    vi.useFakeTimers();
    mockLoad.mockRejectedValue(new Error('DB error'));
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1, y: 2, z: 3 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).not.toHaveBeenCalled();
    expect(useSceneStore.getState().saveStatus).toBe('error');
  });
});

// ─── exportProject ────────────────────────────────────────────────────────────

describe('exportProject', () => {
  it('crea un elemento <a> con href blob y hace click (simula descarga)', () => {
    const clicks: string[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicks.push('clicked');
        });
      }
      return el;
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:fake-url'),
      revokeObjectURL: vi.fn(),
    });

    exportProject(useSceneStore);
    expect(clicks).toHaveLength(1);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

// ─── importProject ────────────────────────────────────────────────────────────

describe('importProject', () => {
  it('rechaza JSON inválido sin modificar el store', async () => {
    const before = useSceneStore.getState().objects.map((o) => o.id);
    const result = await importProject(useSceneStore, makeFile('no-json{{{'), vi.fn());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/);
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(before);
  });

  it('rechaza ProjectData inválido sin modificar el store', async () => {
    const invalid = JSON.stringify({ schemaVersion: 99, objects: [], projectOrigin: { x: 0, y: 0, z: 0 } });
    const before = useSceneStore.getState().objects.map((o) => o.id);
    const result = await importProject(useSceneStore, makeFile(invalid), vi.fn());
    expect(result.ok).toBe(false);
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(before);
  });

  it('cancela la importación si confirm devuelve false', async () => {
    const valid = JSON.stringify(SAVED_PROJECT);
    const before = useSceneStore.getState().objects.map((o) => o.id);
    const result = await importProject(useSceneStore, makeFile(valid), () => false);
    expect(result).toEqual({ ok: false, error: 'Importación cancelada' });
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(before);
  });

  it('importa y hidrata el store cuando confirm devuelve true', async () => {
    const valid = JSON.stringify(SAVED_PROJECT);
    const result = await importProject(useSceneStore, makeFile(valid), () => true);
    expect(result.ok).toBe(true);
    expect(useSceneStore.getState().objects).toHaveLength(1);
    expect(useSceneStore.getState().objects[0].id).toBe('motor-1');
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 1000, y: 500, z: 200 });
  });

  it('exportar e importar conserva posiciones y origen', async () => {
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 3333, y: 4444, z: 1000 });
    useSceneStore.getState().setProjectOrigin({ x: 100, y: 200, z: 0 });

    const { objects, projectOrigin } = useSceneStore.getState();
    const exportedJson = JSON.stringify({ schemaVersion: SCHEMA_VERSION, objects, projectOrigin });

    resetStore();

    await importProject(useSceneStore, makeFile(exportedJson), () => true);

    const panel = useSceneStore.getState().objects.find((o) => o.id === 'panel-1');
    expect(panel?.position).toEqual({ x: 3333, y: 4444, z: 1000 });
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 100, y: 200, z: 0 });
  });
});

// ─── resetProject ─────────────────────────────────────────────────────────────

describe('resetProject', () => {
  it('no hace nada si confirm devuelve false', () => {
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 999 });
    resetProject(useSceneStore, () => false);
    expect(useSceneStore.getState().objects.find((o) => o.id === 'panel-1')?.position.x).toBe(999);
  });

  it('restablece los objetos iniciales si confirm devuelve true', () => {
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 999 });
    resetProject(useSceneStore, () => true);
    const panel = useSceneStore.getState().objects.find((o) => o.id === 'panel-1');
    const initial = INITIAL_OBJECTS.find((o) => o.id === 'panel-1');
    expect(panel?.position).toEqual(initial?.position);
  });

  it('restablece el origen a {0,0,0}', () => {
    useSceneStore.getState().setProjectOrigin({ x: 500, y: 300, z: 100 });
    resetProject(useSceneStore, () => true);
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ─── auto-save — debounce y escritura ────────────────────────────────────────

describe('auto-save — debounce y escritura', () => {
  it('saveStatus cambia a saving inmediatamente al modificar (antes del debounce)', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    await init({});

    expect(useSceneStore.getState().saveStatus).toBe('idle');
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 1000 });

    // Subscription fires synchronously — no timer advance needed
    expect(useSceneStore.getState().saveStatus).toBe('saving');
  });

  it('guarda el estado tras 1 s de inactividad', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 1000 });
    expect(mockSave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0] as ProjectData;
    expect(saved.objects.find((o) => o.id === 'panel-1')?.position).toEqual({
      x: 999,
      y: 999,
      z: 1000,
    });
  });

  it('múltiples cambios rápidos producen un solo auto-save (debounce)', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 100, y: 0, z: 1000 });
    await vi.advanceTimersByTimeAsync(500);
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 200, y: 0, z: 1000 });
    await vi.advanceTimersByTimeAsync(500);
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 300, y: 0, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0] as ProjectData;
    expect(saved.objects.find((o) => o.id === 'panel-1')?.position.x).toBe(300);
  });

  it('la carga inicial no dispara el auto-save', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await init({});

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ─── auto-save — fallo de almacenamiento ─────────────────────────────────────

describe('auto-save — fallo de almacenamiento', () => {
  it('saveStatus pasa a error y los objetos en memoria se conservan', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockRejectedValue(new Error('Sin espacio'));
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1, y: 2, z: 3 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(useSceneStore.getState().saveStatus).toBe('error');
    expect(useSceneStore.getState().saveError).toMatch(/Sin espacio/);
    expect(useSceneStore.getState().objects.find((o) => o.id === 'panel-1')?.position).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });
});

// ─── auto-save — cancelación durante escritura en vuelo ──────────────────────

describe('auto-save — cancelación durante escritura en vuelo', () => {
  it('write en vuelo no modifica saveStatus tras cancel', async () => {
    vi.useFakeTimers();
    let resolveSave!: () => void;
    mockSave.mockReturnValue(new Promise<void>((r) => { resolveSave = r; }));
    mockLoad.mockResolvedValue(null);

    const { cancel, ready } = initProject(useSceneStore);
    await ready;

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1, y: 1, z: 1 });
    await vi.advanceTimersByTimeAsync(1100); // timer dispara, write iniciado

    expect(mockSave).toHaveBeenCalledOnce();

    cancel(); // cancela sesión mientras write está en vuelo
    resolveSave(); // write completa
    await Promise.resolve(); // deja correr el callback

    // El callback comprueba cancelled → no modifica saveStatus
    expect(useSceneStore.getState().saveStatus).toBe('saving');
  });
});

// ─── initProject — ciclo de vida (React Strict Mode) ─────────────────────────

describe('initProject — ciclo de vida (React Strict Mode)', () => {
  it('segunda llamada sin cleanup es ignorada (no duplica suscripciones)', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    const { ready: r1 } = initProject(useSceneStore);
    await r1;
    const { ready: r2 } = initProject(useSceneStore); // sin cancel previo → ignorada
    await r2;

    useSceneStore.getState().updateObjectPosition('motor-1', { x: 1, y: 1, z: 1 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('cleanup/remount (Strict Mode): una sola suscripción activa después del remount', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(SAVED_PROJECT);

    const { cancel, ready: r1 } = initProject(useSceneStore);
    await r1;
    cancel();

    const { ready: r2 } = initProject(useSceneStore);
    await r2;

    useSceneStore.getState().updateObjectPosition('motor-1', { x: 1, y: 1, z: 1 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('cancelar durante carga: no hidrata ni activa el auto-save', async () => {
    vi.useFakeTimers();
    let resolveLoad!: (v: ProjectData | null) => void;
    mockLoad.mockReturnValue(
      new Promise<ProjectData | null>((r) => { resolveLoad = r; }),
    );

    const { cancel, ready } = initProject(useSceneStore);
    cancel();
    resolveLoad(SAVED_PROJECT);
    await ready;

    expect(useSceneStore.getState().objects).not.toHaveLength(1);
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1, y: 1, z: 1 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ─── recoverProject — recuperación tras fallo de carga ───────────────────────

describe('recoverProject — recuperación tras fallo de carga', () => {
  async function failedInit() {
    mockLoad.mockRejectedValue(new Error('DB rota'));
    await init({});
    expect(useSceneStore.getState().saveStatus).toBe('error');
  }

  it('importar → guarda antes de hidratar → activa auto-save', async () => {
    vi.useFakeTimers();
    await failedInit();

    const result = await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);

    expect(result.ok).toBe(true);
    // Guardó el contenido importado
    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0] as ProjectData;
    expect(saved.objects[0].id).toBe('motor-1');
    // Hidratación completada
    expect(useSceneStore.getState().objects[0].id).toBe('motor-1');
    expect(useSceneStore.getState().saveStatus).toBe('saved');

    // Auto-save ahora activo
    _resetSaveGeneration();
    mockSave.mockClear();
    useSceneStore.getState().updateObjectPosition('motor-1', { x: 1, y: 1, z: 1 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('restablecer → guarda escena inicial y activa auto-save', async () => {
    vi.useFakeTimers();
    await failedInit();

    const result = await recoverProject(useSceneStore, 'reset', () => true);

    expect(result.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0] as ProjectData;
    expect(saved.objects.some((o) => o.id === 'panel-1')).toBe(true);
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
    expect(useSceneStore.getState().saveStatus).toBe('saved');

    // Auto-save activo
    _resetSaveGeneration();
    mockSave.mockClear();
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 50, y: 50, z: 50 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('cancelar importación durante recuperación no modifica el store', async () => {
    await failedInit();
    const originalIds = useSceneStore.getState().objects.map((o) => o.id);

    const result = await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => false);

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(originalIds);
  });

  it('cancelar restablecimiento durante recuperación no modifica el store', async () => {
    await failedInit();
    const originalIds = useSceneStore.getState().objects.map((o) => o.id);

    const result = await recoverProject(useSceneStore, 'reset', () => false);

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(originalIds);
  });

  it('importación inválida durante recuperación no modifica el store', async () => {
    await failedInit();
    const originalIds = useSceneStore.getState().objects.map((o) => o.id);

    const result = await recoverProject(useSceneStore, makeFile('{invalid}'), () => true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/);
    expect(mockSave).not.toHaveBeenCalled();
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(originalIds);
  });

  it('fallo de escritura: conserva datos en memoria, status=error, no hidrata', async () => {
    await failedInit();
    const originalIds = useSceneStore.getState().objects.map((o) => o.id);
    mockSave.mockRejectedValue(new Error('sin espacio'));

    const result = await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/guardar/);
    // Store no modificado
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(originalIds);
    expect(useSceneStore.getState().saveStatus).toBe('error');
  });

  it('edición posterior a recuperación confirma auto-save activo', async () => {
    vi.useFakeTimers();
    await failedInit();

    await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);

    _resetSaveGeneration();
    mockSave.mockClear();
    useSceneStore.getState().updateObjectPosition('motor-1', { x: 500, y: 500, z: 500 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
    expect(useSceneStore.getState().saveStatus).toBe('saved');
  });

  it('fallo de carga → recuperar → editar → segundo guardado', async () => {
    vi.useFakeTimers();
    await failedInit();

    // Recuperación exitosa
    await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    expect(mockSave).toHaveBeenCalledOnce(); // guardado de recuperación

    // Edición posterior activa auto-save
    _resetSaveGeneration();
    mockSave.mockClear();
    useSceneStore.getState().updateObjectPosition('motor-1', { x: 1, y: 2, z: 3 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
    const saved = mockSave.mock.calls[0][0] as ProjectData;
    expect(saved.objects[0].position).toEqual({ x: 1, y: 2, z: 3 });
  });
});

// ─── recoverProject — bloqueo de operaciones concurrentes ────────────────────

describe('recoverProject — bloqueo y estado recovering', () => {
  it('recuperación pendiente bloquea nuevas recuperaciones (saveStatus=recovering)', async () => {
    let resolveSave!: () => void;
    mockSave.mockReturnValue(new Promise<void>((r) => { resolveSave = r; }));
    mockLoad.mockRejectedValue(new Error('DB rota'));
    await init({});

    // Primera recuperación: bloqueará en la escritura
    const recoveryPromise = recoverProject(
      useSceneStore,
      makeFile(JSON.stringify(SAVED_PROJECT)),
      () => true,
    );
    await Promise.resolve(); // source.text() tick → llega a setSaveStatus('recovering')

    expect(useSceneStore.getState().saveStatus).toBe('recovering');

    // Intento simultáneo de recuperación: debe rechazarse inmediatamente
    const second = await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/curso/);

    // Completar la primera recuperación
    resolveSave();
    const first = await recoveryPromise;
    expect(first.ok).toBe(true);
    expect(useSceneStore.getState().saveStatus).toBe('saved');
  });

  it('write de auto-save anterior no afecta el proyecto recuperado', async () => {
    vi.useFakeTimers();
    let resolveOldSave!: () => void;
    mockSave
      .mockReturnValueOnce(new Promise<void>((r) => { resolveOldSave = r; }))
      .mockResolvedValue(undefined);

    mockLoad.mockResolvedValue(null);
    await init({});

    // Disparar auto-save
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 50, y: 0, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100); // timer dispara, write anterior en vuelo

    // Iniciar recuperación (cancela la sesión de auto-save anterior)
    const recoveryPromise = recoverProject(
      useSceneStore,
      makeFile(JSON.stringify(SAVED_PROJECT)),
      () => true,
    );

    // El write anterior completa: su callback tiene cancelled=true → no-op
    resolveOldSave();

    const result = await recoveryPromise;

    expect(result.ok).toBe(true);
    expect(useSceneStore.getState().saveStatus).toBe('saved');
    expect(useSceneStore.getState().objects[0].id).toBe('motor-1');
  });

  it('cancelar sesión durante escritura: no hidrata ni activa suscripción', async () => {
    let resolveSave!: () => void;
    mockSave.mockReturnValue(new Promise<void>((r) => { resolveSave = r; }));
    mockLoad.mockRejectedValue(new Error('DB rota'));
    const { cancel, ready } = initProject(useSceneStore);
    await ready;

    const recoveryPromise = recoverProject(
      useSceneStore,
      makeFile(JSON.stringify(SAVED_PROJECT)),
      () => true,
    );

    await Promise.resolve(); // source.text() → llega a fase de escritura
    expect(useSceneStore.getState().saveStatus).toBe('recovering');

    cancel(); // desmontaje de la aplicación durante la escritura
    resolveSave();
    const result = await recoveryPromise;

    expect(result.ok).toBe(false);
    // Store no fue hidratado: SAVED_PROJECT tiene 1 objeto, el store inicial tiene más
    expect(useSceneStore.getState().objects).not.toHaveLength(1);
    // El origen tampoco fue reemplazado por el de SAVED_PROJECT
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('fallo de escritura conserva datos y permite reintentar', async () => {
    mockLoad.mockRejectedValue(new Error('DB rota'));
    await init({});
    const originalIds = useSceneStore.getState().objects.map((o) => o.id);

    // Primer intento falla
    mockSave.mockRejectedValueOnce(new Error('sin espacio'));
    const r1 = await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    expect(r1.ok).toBe(false);
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(originalIds);
    expect(useSceneStore.getState().saveStatus).toBe('error');

    // Segundo intento (reintento) tiene éxito
    mockSave.mockResolvedValue(undefined);
    const r2 = await recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    expect(r2.ok).toBe(true);
    expect(useSceneStore.getState().saveStatus).toBe('saved');
    expect(useSceneStore.getState().objects[0].id).toBe('motor-1');
  });
});

// ─── recoverProject — identidad de sesión ─────────────────────────────────────

describe('recoverProject — identidad de sesión', () => {
  it('recuperación de sesión anterior no hidrata ni cambia estado de sesión nueva', async () => {
    mockLoad.mockRejectedValue(new Error('DB rota'));
    let resolveSaveA!: () => void;
    mockSave.mockReturnValueOnce(new Promise<void>((r) => { resolveSaveA = r; }));
    const { cancel: cancelA, ready: readyA } = initProject(useSceneStore);
    await readyA;

    const recoveryA = recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    await Promise.resolve(); // source.text() tick → llega a fase de escritura
    expect(useSceneStore.getState().saveStatus).toBe('recovering');

    cancelA(); // sesión A termina

    mockLoad.mockResolvedValue(null);
    const { ready: readyB } = initProject(useSceneStore);
    await readyB; // sesión B, carga exitosa → 'idle'
    expect(useSceneStore.getState().saveStatus).toBe('idle');

    resolveSaveA();
    const resultA = await recoveryA;

    expect(resultA.ok).toBe(false);
    expect(useSceneStore.getState().saveStatus).toBe('idle'); // B intacto
    expect(useSceneStore.getState().objects).not.toHaveLength(1); // no hidratado
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('cancelar mientras source.text() está pendiente: no pide confirmación ni escribe', async () => {
    mockLoad.mockRejectedValue(new Error('DB rota'));
    let resolveText!: (s: string) => void;
    const slowFile = {
      text: () => new Promise<string>((r) => { resolveText = r; }),
    } as unknown as File;
    const confirmFn = vi.fn(() => true);

    const { cancel, ready } = initProject(useSceneStore);
    await ready;

    const recoveryPromise = recoverProject(useSceneStore, slowFile, confirmFn);
    cancel(); // sesión cancelada antes de que text() resuelva

    resolveText(JSON.stringify(SAVED_PROJECT));
    const result = await recoveryPromise;

    expect(result.ok).toBe(false);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('recuperación antigua no libera el bloqueo de una nueva', async () => {
    mockLoad.mockRejectedValue(new Error('DB rota'));
    let resolveSaveA!: () => void;
    mockSave.mockReturnValueOnce(new Promise<void>((r) => { resolveSaveA = r; }));
    const { cancel: cancelA, ready: readyA } = initProject(useSceneStore);
    await readyA;

    const recoveryA = recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    await Promise.resolve(); // A llega a fase de escritura

    cancelA(); // _recovering = false → permite que B inicie

    mockLoad.mockRejectedValue(new Error('B error'));
    let resolveSaveB!: () => void;
    mockSave.mockReturnValueOnce(new Promise<void>((r) => { resolveSaveB = r; }));
    const { ready: readyB } = initProject(useSceneStore);
    await readyB;

    const recoveryB = recoverProject(useSceneStore, makeFile(JSON.stringify(SAVED_PROJECT)), () => true);
    await Promise.resolve(); // B llega a fase de escritura
    expect(useSceneStore.getState().saveStatus).toBe('recovering');

    resolveSaveA(); // escritura de A completa — no debe liberar el bloqueo de B
    await Promise.resolve();
    expect(useSceneStore.getState().saveStatus).toBe('recovering'); // B sigue bloqueado

    resolveSaveB();
    const resultB = await recoveryB;
    expect(resultB.ok).toBe(true);
    expect(useSceneStore.getState().saveStatus).toBe('saved');

    const resultA = await recoveryA;
    expect(resultA.ok).toBe(false);
  });
});

// ─── pauseAndFlush — flush de edición pendiente en debounce ──────────────────

describe('pauseAndFlush — flush conserva edición pendiente del debounce', () => {
  it('captura y guarda una edición cuyo timer todavía no disparó', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 888, z: 1000 });
    // Timer aún no disparó (debounce 1s)
    expect(mockSave).not.toHaveBeenCalled();

    const snapshot = await pauseAndFlush(useSceneStore);

    // El flush guardó la edición
    expect(mockSave).toHaveBeenCalledOnce();
    expect(snapshot.objects.find((o) => o.id === 'panel-1')?.position).toEqual({
      x: 999, y: 888, z: 1000,
    });

    // Lo que se guardó en DB también tiene la edición
    const saved = mockSave.mock.calls[0][0] as ProjectData;
    expect(saved.objects.find((o) => o.id === 'panel-1')?.position.x).toBe(999);
  });

  it('el snapshot retornado es el estado real de memoria', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    await init({});

    useSceneStore.getState().setProjectOrigin({ x: 100, y: 200, z: 0 });
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 50, y: 60, z: 1000 });

    const snapshot = await pauseAndFlush(useSceneStore);

    expect(snapshot.projectOrigin).toEqual({ x: 100, y: 200, z: 0 });
    expect(snapshot.objects.find((o) => o.id === 'panel-1')?.position).toEqual({
      x: 50, y: 60, z: 1000,
    });
  });
});

// ─── pauseAndFlush — espera escrituras en vuelo ───────────────────────────────

describe('pauseAndFlush — espera escrituras demoradas anteriores', () => {
  it('aguarda la escritura de auto-save ya iniciada antes de hacer el flush', async () => {
    vi.useFakeTimers();

    let resolveAutoSave!: () => void;
    // Primera llamada a saveProjectToDb (auto-save): queda pendiente
    mockSave
      .mockReturnValueOnce(new Promise<void>((r) => { resolveAutoSave = r; }))
      .mockResolvedValue(undefined);

    mockLoad.mockResolvedValue(null);
    await init({});

    // Disparar auto-save y avanzar el timer para que comience la escritura
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1, y: 2, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100); // timer dispara, write en vuelo

    expect(mockSave).toHaveBeenCalledOnce(); // escritura 1 iniciada pero pendiente

    // pauseAndFlush debe esperar la escritura en vuelo
    let flushResolved = false;
    const flushPromise = pauseAndFlush(useSceneStore).then((s) => {
      flushResolved = true;
      return s;
    });

    // Flush no resolvió aún (esperando la escritura del auto-save)
    await Promise.resolve();
    await Promise.resolve();
    expect(flushResolved).toBe(false);

    // Completar la escritura del auto-save
    resolveAutoSave();
    await flushPromise;

    expect(flushResolved).toBe(true);
    // Dos escrituras: auto-save + flush
    expect(mockSave).toHaveBeenCalledTimes(2);
  });

  it('si la escritura en vuelo falla, el flush procede igualmente', async () => {
    vi.useFakeTimers();

    let rejectAutoSave!: (e: Error) => void;
    mockSave
      .mockReturnValueOnce(new Promise<void>((_, r) => { rejectAutoSave = r; }))
      .mockResolvedValue(undefined);

    mockLoad.mockResolvedValue(null);
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 5, y: 6, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSave).toHaveBeenCalledOnce();

    const flushPromise = pauseAndFlush(useSceneStore);

    // Falla la escritura del auto-save
    rejectAutoSave(new Error('disco lleno'));
    const snapshot = await flushPromise;

    // Flush completó de todas formas (segunda llamada)
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(snapshot).toBeDefined();
  });
});

// ─── pauseAndFlush — fallo conserva memoria ──────────────────────────────────

describe('pauseAndFlush — fallo conserva memoria y permite recuperación', () => {
  it('si el flush falla, el store no cambia y editingBlocked sigue true', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    await init({});

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 77, y: 88, z: 1000 });
    const stateBefore = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')?.position;

    mockSave.mockRejectedValue(new Error('sin espacio'));

    await expect(pauseAndFlush(useSceneStore)).rejects.toThrow('sin espacio');

    // Memoria intacta
    const stateAfter = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')?.position;
    expect(stateAfter).toEqual(stateBefore);

    // Editor queda bloqueado (caller debe llamar resumeAutoSave)
    expect(useSceneStore.getState().editingBlocked).toBe(true);
  });

  it('exportProject puede exportar el estado en memoria tras un fallo de flush', () => {
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 42, y: 0, z: 1000 });

    // Simulamos que editingBlocked es true (pausa activa)
    useSceneStore.getState().setEditingBlocked(true);

    const clicks: string[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => { clicks.push('clicked'); });
      return el;
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:fake'),
      revokeObjectURL: vi.fn(),
    });

    exportProject(useSceneStore);
    expect(clicks).toHaveLength(1); // exportación completó a pesar del bloqueo

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useSceneStore.getState().setEditingBlocked(false);
  });
});

// ─── pauseAndFlush — cancelación/reanudación sin duplicar suscripciones ──────

describe('pauseAndFlush — cancelación/reanudación no duplica suscripciones', () => {
  it('después de resumeAutoSave hay exactamente una suscripción activa', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    // Pausa y luego reanuda
    await pauseAndFlush(useSceneStore);
    resumeAutoSave(useSceneStore);

    // Reset generación para contar limpias
    _resetSaveGeneration();
    mockSave.mockClear();

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 10, y: 10, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100);

    // Solo un save (no duplicado)
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('múltiples ciclos pause/resume no acumulan suscripciones', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    for (let i = 0; i < 3; i++) {
      await pauseAndFlush(useSceneStore);
      resumeAutoSave(useSceneStore);
    }

    _resetSaveGeneration();
    mockSave.mockClear();

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 20, y: 20, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
  });
});

// ─── pauseAndFlush — bloqueo de modificaciones ───────────────────────────────

describe('pauseAndFlush — bloquea modificaciones durante la pausa', () => {
  it('updateObjectPosition es no-op cuando editingBlocked=true', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    const before = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')?.position.x;

    await pauseAndFlush(useSceneStore);
    // Editor bloqueado
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 9999, y: 0, z: 1000 });

    const after = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')?.position.x;
    expect(after).toBe(before); // no cambió
  });

  it('setProjectOrigin es no-op cuando editingBlocked=true', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    await pauseAndFlush(useSceneStore);
    useSceneStore.getState().setProjectOrigin({ x: 5000, y: 5000, z: 0 });

    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('importProject rechaza con error cuando el editor está en pausa', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    await pauseAndFlush(useSceneStore);

    const result = await importProject(
      useSceneStore,
      makeFile(JSON.stringify(SAVED_PROJECT)),
      () => true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pausa/);
  });

  it('resetProject es no-op cuando el editor está en pausa', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    const originalIds = useSceneStore.getState().objects.map((o) => o.id);
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1234, y: 0, z: 1000 });

    await pauseAndFlush(useSceneStore);

    resetProject(useSceneStore, () => true);

    // Objetos no fueron restablecidos
    expect(useSceneStore.getState().objects.map((o) => o.id)).toEqual(originalIds);
  });

  it('recoverProject rechaza con error cuando el editor está en pausa', async () => {
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    await pauseAndFlush(useSceneStore); // activa _paused = true

    const result = await recoverProject(
      useSceneStore,
      makeFile(JSON.stringify(SAVED_PROJECT)),
      () => true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pausa/);
  });
});

// ─── pauseAndFlush — sesión cancelada no afecta sesión posterior ──────────────

describe('pauseAndFlush — sesión cancelada no modifica sesión posterior', () => {
  it('cancel durante flush no deja al editor bloqueado en la nueva sesión', async () => {
    vi.useFakeTimers();
    let resolveFlushSave!: () => void;
    mockLoad.mockResolvedValue(null);
    // Primera llamada (flush): queda pendiente; segunda (auto-save): resuelve rápido
    mockSave
      .mockReturnValueOnce(new Promise<void>((r) => { resolveFlushSave = r; }))
      .mockResolvedValue(undefined);

    const { cancel, ready } = initProject(useSceneStore);
    await ready;

    const flushPromise = pauseAndFlush(useSceneStore);

    // Cancel durante el flush (sesión A termina)
    cancel();

    // Nueva sesión B comienza
    mockLoad.mockResolvedValue(null);
    const { ready: readyB } = initProject(useSceneStore);
    await readyB;

    // Sesión B: editor NO bloqueado
    expect(useSceneStore.getState().editingBlocked).toBe(false);

    // Completar el flush de sesión A (write ya enviado a IDB, no se puede cancelar)
    resolveFlushSave();
    await flushPromise.catch(() => {}); // sesión A rechaza por session check o resuelve

    // Sesión B sigue sin bloqueo
    expect(useSceneStore.getState().editingBlocked).toBe(false);
  });
});

// ─── pauseAndFlush — segunda llamada concurrente rechaza ─────────────────────

describe('pauseAndFlush — segunda llamada concurrente rechaza inmediatamente', () => {
  it('segunda llamada sin resume previo recibe rechazo', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    const first = pauseAndFlush(useSceneStore);
    const second = pauseAndFlush(useSceneStore);

    await expect(second).rejects.toThrow(/en curso/);
    await first; // limpieza

    resumeAutoSave(useSceneStore);
  });
});

// ─── resumeAutoSave — reanuda auto-save normalmente ──────────────────────────

describe('resumeAutoSave — reanuda el auto-save y desbloquea el editor', () => {
  it('después del resume, una edición activa el auto-save', async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    await init({});

    await pauseAndFlush(useSceneStore);
    expect(useSceneStore.getState().editingBlocked).toBe(true);

    resumeAutoSave(useSceneStore);
    expect(useSceneStore.getState().editingBlocked).toBe(false);

    _resetSaveGeneration();
    mockSave.mockClear();

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 500, y: 500, z: 1000 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(mockSave).toHaveBeenCalledOnce();
    expect(useSceneStore.getState().saveStatus).toBe('saved');
  });
});
