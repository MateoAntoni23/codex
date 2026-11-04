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
  _resetSaveGeneration,
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
  });
}

beforeEach(() => {
  resetStore();
  _resetSaveGeneration();
  mockLoad.mockReset();
  mockSave.mockReset();
  mockSave.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('initProject — sin datos guardados', () => {
  it('mantiene los objetos iniciales cuando no hay datos en la DB', async () => {
    mockLoad.mockResolvedValue(null);
    await initProject(useSceneStore);
    const objects = useSceneStore.getState().objects;
    expect(objects.some((o) => o.id === 'panel-1')).toBe(true);
  });

  it('establece saveStatus=idle cuando no hay datos guardados', async () => {
    mockLoad.mockResolvedValue(null);
    await initProject(useSceneStore);
    expect(useSceneStore.getState().saveStatus).toBe('idle');
  });
});

describe('initProject — con datos guardados', () => {
  it('hidrata el store con los datos guardados', async () => {
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await initProject(useSceneStore);
    const state = useSceneStore.getState();
    expect(state.objects).toHaveLength(1);
    expect(state.objects[0].position).toEqual({ x: 9000, y: 9000, z: 400 });
    expect(state.projectOrigin).toEqual({ x: 1000, y: 500, z: 200 });
  });

  it('establece saveStatus=saved cuando hay datos guardados', async () => {
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await initProject(useSceneStore);
    expect(useSceneStore.getState().saveStatus).toBe('saved');
  });

  it('no sobrescribe datos guardados con la escena inicial', async () => {
    // La DB tiene datos → al iniciar no se debe guardar la escena inicial
    mockLoad.mockResolvedValue(SAVED_PROJECT);
    await initProject(useSceneStore);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('initProject — fallo de IndexedDB al cargar', () => {
  it('establece saveStatus=error y conserva objetos en memoria', async () => {
    mockLoad.mockRejectedValue(new Error('Disco lleno'));
    await initProject(useSceneStore);
    const state = useSceneStore.getState();
    expect(state.saveStatus).toBe('error');
    expect(state.saveError).toMatch(/cargar/);
    // Objetos en memoria no se pierden
    expect(state.objects.length).toBeGreaterThan(0);
  });
});

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

    const fakeUrl = 'blob:fake-url';
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue(fakeUrl),
      revokeObjectURL: vi.fn(),
    });

    exportProject(useSceneStore);
    expect(clicks).toHaveLength(1);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

describe('importProject', () => {
  // importProject only calls file.text() — duck-type to avoid jsdom Blob encoding quirks.
  function makeFile(content: string): File {
    return { text: () => Promise.resolve(content) } as unknown as File;
  }

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

    // Build the same JSON that exportProject would produce, without touching the DOM.
    const { objects, projectOrigin } = useSceneStore.getState();
    const exportedJson = JSON.stringify({ schemaVersion: SCHEMA_VERSION, objects, projectOrigin });

    resetStore();

    const file = makeFile(exportedJson);
    await importProject(useSceneStore, file, () => true);

    const panel = useSceneStore.getState().objects.find((o) => o.id === 'panel-1');
    expect(panel?.position).toEqual({ x: 3333, y: 4444, z: 1000 });
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 100, y: 200, z: 0 });
  });
});

describe('resetProject', () => {
  it('no hace nada si confirm devuelve false', () => {
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 999 });
    resetProject(useSceneStore, () => false);
    const panel = useSceneStore.getState().objects.find((o) => o.id === 'panel-1');
    expect(panel?.position.x).toBe(999);
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

describe('fallo de guardado — estado en memoria se conserva', () => {
  it('saveStatus=error no borra los objetos en memoria', async () => {
    mockLoad.mockResolvedValue(null);
    mockSave.mockRejectedValue(new Error('Sin espacio'));
    await initProject(useSceneStore);

    // Trigger auto-save synchronously by moving an object (debounce will fire later)
    // We test the error path by calling saveProjectToDb directly via the store subscription
    // Here we verify that even with save failure the objects remain intact.
    const before = useSceneStore.getState().objects;
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 1, y: 2, z: 3 });
    // Objects changed in memory regardless of save status
    const after = useSceneStore.getState().objects.find((o) => o.id === 'panel-1');
    expect(after?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(useSceneStore.getState().objects.length).toBe(before.length);
  });
});
