// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { useCatalogConfigStore } from '../../configurator/catalogConfigStore';
import { clearPortMappingOverrides } from '../../workspace/catalogPortMapping';
import { PREVIEW_ELEMENTS } from '../../preview/previewData';
import { emptyTrayInput } from '../emptyProject';
import {
  CURRENT_KEY,
  WORKSPACE_DB_NAME,
  WORKSPACE_STORE,
  _setWorkspaceIdbFactory,
  readCurrentRecord,
  writeCurrentRecord,
} from '../projectDb';
import {
  _resetBootForTests,
  bootProject,
  buildProjectCopy,
  newProject,
  openProjectText,
  retrySave,
  saveNow,
  startAutosave,
  useProjectStatusStore,
  type LibraryChoice,
} from '../projectSession';
import { _setIdbFactory, _resetIdbFactory, saveProjectToDb, loadProjectFromDb, DB_NAME } from '../../persistence/db';
import { INITIAL_OBJECTS } from '../../store/initialObjects';
import { SCHEMA_VERSION } from '../../persistence/schema';
import { LIBRARY_STORAGE_KEY, LIBRARY_BACKUP_PREFIX } from '../../configurator/libraryBlock';
import type { ProductPortMapping } from '../../workspace/catalogPortMapping';
import type { PatternApproval } from '../../configurator/patternApprovals';
import type { AporteRule } from '../../configurator/aporteTrazado';

const FIXTURE = resolve(__dirname, '../../../e2e/fixtures/user-report-20261107.workspace.json');

function resetAll(): void {
  localStorage.clear();
  clearPortMappingOverrides();
  useCatalogConfigStore.setState({ overrides: {}, approvals: {}, aporteOverrides: {}, hydrated: true });
  useWorkspaceStore.getState().reset();
  useTrayStore.getState().importEdit(emptyTrayInput());
  _resetBootForTests();
}

/** Estado "del proyecto" comparable (sin historiales ni flags de UI). */
function projectState() {
  const w = useWorkspaceStore.getState();
  const t = useTrayStore.getState().entrada;
  return {
    elements: w.elements,
    evidence: w.evidence,
    projectMeta: w.projectMeta,
    importedCatalog: w.importedCatalog,
    tray: t,
  };
}

const MAPPING: ProductPortMapping = {
  productId: 'SAM_TPS-300-Z',
  source: 'override',
  overrideReason: 'calibración de prueba',
  overrideAt: '2026-11-09T10:00:00Z',
  entries: [{ recipePortName: 'tronco_P1', catalogPortName: 'P3', physicalLabel: 'x', justification: 'y' }],
};
const APPROVAL: PatternApproval = {
  approvedAtRevision: 2,
  approvedAtCalibrationHash: 'h1',
  approvedAt: '2026-11-09T11:00:00Z',
};
const APORTE: AporteRule = { kind: 'fijo-mm', valueMm: 450 };

const choose = (c: LibraryChoice) => vi.fn(async () => c);

let currentFactory: IDBFactory;
beforeEach(() => {
  currentFactory = new IDBFactory();
  _setWorkspaceIdbFactory(currentFactory);
  resetAll();
});
afterEach(() => {
  vi.restoreAllMocks();
  _setWorkspaceIdbFactory(null);
});

describe('proyecto vacío por defecto', () => {
  it('el trazado vacío es válido, sin piezas ni equipos, con pe neutro documentado', () => {
    const t = emptyTrayInput();
    expect(t.piezas).toEqual([]);
    expect(t.pe).toMatchObject({ seccion_requerida_mm2: 0, cable_id: '', conductores: [] });
    expect(useWorkspaceStore.getState().elements).toEqual([]);
    expect(useWorkspaceStore.getState().evidence).toEqual([]);
  });

  it('los equipos de demostración son una acción explícita (idempotente)', () => {
    useWorkspaceStore.getState().loadDemoEquipment();
    expect(useWorkspaceStore.getState().elements.length).toBe(PREVIEW_ELEMENTS.length);
    useWorkspaceStore.getState().loadDemoEquipment();
    expect(useWorkspaceStore.getState().elements.length).toBe(PREVIEW_ELEMENTS.length);
  });
});

describe('autoguardado y restauración (IndexedDB propia)', () => {
  it('sin registro previo: arranca vacío, estado idle y no escribe nada', async () => {
    await bootProject();
    const s = useProjectStatusStore.getState();
    expect(s).toMatchObject({ phase: 'idle', booted: true });
    expect(await readCurrentRecord()).toBeNull();
  });

  it('guarda cambios (guardando → guardado) y los restaura tras "recargar"', async () => {
    await bootProject();
    const stop = startAutosave();
    useWorkspaceStore.getState().loadDemoEquipment();
    useTrayStore.getState().edit(
      JSON.parse(readFileSync(FIXTURE, 'utf8')).trayInput, // piezas + uniones reales
    );
    expect(useProjectStatusStore.getState().phase).toBe('saving');
    await vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('saved'), { timeout: 4000 });
    stop();

    const before = structuredClone(projectState());
    const beforeFile = useWorkspaceStore.getState().fileName;

    // "Recarga": se pierde todo el estado en memoria y se vuelve a arrancar.
    useWorkspaceStore.getState().reset();
    useTrayStore.getState().importEdit(emptyTrayInput());
    expect(useWorkspaceStore.getState().elements).toEqual([]);
    _resetBootForTests();
    await bootProject();

    expect(structuredClone(projectState())).toEqual(before);
    expect(useWorkspaceStore.getState().fileName).toBe(beforeFile);
    expect(useProjectStatusStore.getState().phase).toBe('saved');
    // Restaurar no cuenta como "cambios sin copia en archivo".
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it('restaura también el nombre de archivo y la selección', async () => {
    await bootProject();
    const stop = startAutosave();
    useWorkspaceStore.getState().loadDemoEquipment();
    const id = useWorkspaceStore.getState().elements[0].id;
    useWorkspaceStore.getState().selectEquip(id);
    useWorkspaceStore.getState().markSaved('mi-proyecto.json');
    await vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('saved'), { timeout: 4000 });
    stop();

    useWorkspaceStore.getState().reset();
    _resetBootForTests();
    await bootProject();
    expect(useWorkspaceStore.getState().fileName).toBe('mi-proyecto.json');
    expect(useWorkspaceStore.getState().selectedEquipId).toBe(id);
  });

  it('A7: un fallo de escritura muestra error y NO altera el estado en memoria', async () => {
    await bootProject();
    const stop = startAutosave();
    useWorkspaceStore.getState().loadDemoEquipment();
    await vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('saved'), { timeout: 4000 });

    // La próxima escritura falla (p. ej. cuota llena).
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('cuota excedida', 'QuotaExceededError');
    });
    useWorkspaceStore.getState().removeElement(useWorkspaceStore.getState().elements[0].id);
    const memory = structuredClone(projectState());
    await vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('error'), { timeout: 4000 });
    expect(useProjectStatusStore.getState().error).toMatch(/QuotaExceededError/);
    expect(structuredClone(projectState())).toEqual(memory); // memoria intacta
    expect(useWorkspaceStore.getState().elements.length).toBe(PREVIEW_ELEMENTS.length - 1);

    // Lo guardado antes del fallo sigue siendo el último estado bueno.
    put.mockRestore();
    const stored = (await readCurrentRecord()) as { project: { projectV2: { elements: unknown[] } } };
    expect(stored.project.projectV2.elements.length).toBe(PREVIEW_ELEMENTS.length);

    // Reintentar con IndexedDB sana guarda el estado actual.
    retrySave();
    await vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('saved'), { timeout: 4000 });
    const after = (await readCurrentRecord()) as { project: { projectV2: { elements: unknown[] } } };
    expect(after.project.projectV2.elements.length).toBe(PREVIEW_ELEMENTS.length - 1);
    stop();
  });

  it('un registro dañado se aparta (no se pisa) y se abre un proyecto vacío con aviso', async () => {
    await writeCurrentRecord({
      schema: 'codex:workspaceProject/1',
      savedAt: new Date().toISOString(),
      project: { projectV2: { schemaVersion: 2, elements: 'roto' }, trayInput: {} },
    });
    await bootProject();
    const s = useProjectStatusStore.getState();
    expect(s.booted).toBe(true);
    expect(s.notice).toMatch(/dañado/);
    expect(useWorkspaceStore.getState().elements).toEqual([]);
    expect(await readCurrentRecord()).toBeNull(); // 'current' liberado
    // …pero el original quedó guardado bajo otra clave.
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = currentFactory.open(WORKSPACE_DB_NAME);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const keys = await new Promise<IDBValidKey[]>((res) => {
      const r = db.transaction(WORKSPACE_STORE).objectStore(WORKSPACE_STORE).getAllKeys();
      r.onsuccess = () => res(r.result);
    });
    db.close();
    expect(keys.some((k) => String(k).startsWith('corrupt:'))).toBe(true);
    expect(keys).not.toContain(CURRENT_KEY);
  });

  it('A6: no abre ni altera la base del editor inicial', async () => {
    const factory = new IDBFactory();
    _setWorkspaceIdbFactory(factory);
    _setIdbFactory(factory);
    try {
      const legacy = { schemaVersion: SCHEMA_VERSION, objects: INITIAL_OBJECTS, projectOrigin: { x: 0, y: 0, z: 0 } } as const;
      await saveProjectToDb(legacy as never);
      const legacyBefore = JSON.stringify(await loadProjectFromDb());

      await bootProject();
      const stop = startAutosave();
      useWorkspaceStore.getState().loadDemoEquipment();
      newProject();
      useWorkspaceStore.getState().loadDemoEquipment();
      await vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('saved'), { timeout: 4000 });
      stop();

      expect(JSON.stringify(await loadProjectFromDb())).toBe(legacyBefore);
      const names = (await factory.databases()).map((d) => d.name).sort();
      expect(names).toEqual([DB_NAME, WORKSPACE_DB_NAME].sort());
      // El editor inicial nunca recibió una clave del espacio de trabajo.
      const wsRec = (await readCurrentRecord()) as { schema: string };
      expect(wsRec.schema).toBe('codex:workspaceProject/1');
    } finally {
      _resetIdbFactory();
    }
  });
});

describe('acciones de proyecto', () => {
  it('guardar copia funciona con el proyecto vacío y sin motor', () => {
    const { json, name } = buildProjectCopy();
    const f = JSON.parse(json);
    expect(f.fileVersion).toBe(2);
    expect(f.projectV2.elements).toEqual([]);
    expect(f.trayInput.piezas).toEqual([]);
    expect('library' in f).toBe(false); // biblioteca vacía: sin bloque
    expect(name).toMatch(/^workspace-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('nuevo deja el proyecto vacío y NO toca la biblioteca', async () => {
    useWorkspaceStore.getState().loadDemoEquipment();
    useCatalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', MAPPING);
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    newProject();
    expect(useWorkspaceStore.getState().elements).toEqual([]);
    expect(useTrayStore.getState().entrada?.piezas).toEqual([]);
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBe(raw);
  });

  it('A3: abrir el fixture v1 → guardar copia → abrir de nuevo deja todo idéntico', async () => {
    const text = readFileSync(FIXTURE, 'utf8');
    const r1 = await openProjectText(text, 'user-report.json', choose('local'));
    expect(r1.status).toBe('opened');
    const first = structuredClone(projectState());
    const original = JSON.parse(text);

    // Contra el ORIGINAL: el validador sólo agrega `importedRef: null` a equipos que no lo traen.
    const norm = (els: unknown[]) =>
      (els as Array<Record<string, unknown>>).map((e) => {
        const { importedRef, ...rest } = e;
        return importedRef === null || importedRef === undefined ? rest : e;
      });
    expect(norm(first.elements)).toEqual(norm(original.projectV2.elements));
    expect(first.evidence).toEqual(original.projectV2.evidence);
    expect(first.tray).toEqual(original.trayInput);
    expect(first.tray?.piezas).toHaveLength(7);
    expect(first.tray?.conexiones).toHaveLength(6);
    expect(first.tray?.circuitos).toHaveLength(2);
    expect(first.tray?.soportes).toHaveLength(9);
    expect(first.elements).toHaveLength(9);
    expect(first.evidence).toHaveLength(4);

    const { json } = buildProjectCopy();
    newProject();
    const r2 = await openProjectText(json, 'copia.json', choose('local'));
    expect(r2.status).toBe('opened');
    expect(structuredClone(projectState())).toEqual(first); // idéntico, sin normalizar nada
  });

  it('un archivo inválido no deja cambios a medias', async () => {
    useWorkspaceStore.getState().loadDemoEquipment();
    const before = structuredClone(projectState());
    const r = await openProjectText('{"fileVersion":2,"projectV2":{},"trayInput":{}}', 'roto.json', choose('local'));
    expect(r.status).toBe('error');
    expect(structuredClone(projectState())).toEqual(before);
  });
});

describe('biblioteca protegida', () => {
  function withLibrary() {
    useCatalogConfigStore.getState().upsertOverride('SAM_TPS-300-Z', MAPPING);
    useCatalogConfigStore.setState({
      approvals: { 'SAM_TPS-300-Z': APPROVAL },
      aporteOverrides: { 'SAM_TPS-300-Z': APORTE },
    });
    useCatalogConfigStore.getState().replaceApprovals({ 'SAM_TPS-300-Z': APPROVAL });
    useCatalogConfigStore.getState().replaceAporteOverrides({ 'SAM_TPS-300-Z': APORTE });
  }

  it('B-2.6: adoptar un proyecto con biblioteca por SKU (codex:library/1) la migra a calibración por patrón', async () => {
    const { json } = buildProjectCopy();
    const file = JSON.parse(json);
    file.library = {
      version: 'codex:library/1',
      overrides: {
        'SAM_TPS-300-Z': {
          productId: 'SAM_TPS-300-Z',
          source: 'override',
          entries: [
            { recipePortName: 'tronco_P1', catalogPortName: 'P1', physicalLabel: 'P1', justification: 'x', geometry: { installRotationDeg: 10 } },
            { recipePortName: 'tronco_P2', catalogPortName: 'P2', physicalLabel: 'P2', justification: 'x' },
            { recipePortName: 'boca_derivacion', catalogPortName: 'P3', physicalLabel: 'P3', justification: 'x' },
          ],
        },
      },
      approvals: {},
      aporteOverrides: {},
    };
    const r = await openProjectText(JSON.stringify(file), 'viejo.json', choose('adopt'));
    expect(r).toMatchObject({ status: 'opened', libraryAdopted: true });
    const st = useCatalogConfigStore.getState();
    // Los nombres se conservan, sin geometría…
    expect(st.overrides['SAM_TPS-300-Z'].entries.map((e) => e.catalogPortName)).toEqual(['P1', 'P2', 'P3']);
    expect(st.overrides['SAM_TPS-300-Z'].entries.every((e) => !e.geometry)).toBe(true);
    // …y la geometría pasó a ser la corrección del patrón (giro axial de 10° en tronco_P1).
    const patron = Object.values(st.calibracion.patrones)[0];
    expect(patron.bocas.tronco_P1.giro_deg.axial).toBeCloseTo(10, 9);
  });

  it('A4: guardar copia contiene overrides + approvals + aporteOverrides; vaciar y adoptar los restaura', async () => {
    withLibrary();
    const { json } = buildProjectCopy();
    const lib = JSON.parse(json).library;
    expect(lib.version).toBe('codex:library/2');
    expect(Object.keys(lib.overrides)).toEqual(['SAM_TPS-300-Z']);
    expect(Object.keys(lib.approvals)).toEqual(['SAM_TPS-300-Z']);
    expect(Object.keys(lib.aporteOverrides)).toEqual(['SAM_TPS-300-Z']);
    const savedLocal = localStorage.getItem(LIBRARY_STORAGE_KEY);

    // Vaciar la biblioteca (memoria + localStorage).
    useCatalogConfigStore.getState().replaceLibrary({ overrides: {}, approvals: {}, aporteOverrides: {} });
    expect(useCatalogConfigStore.getState().approvals).toEqual({});

    const chooser = choose('adopt');
    const r = await openProjectText(json, 'copia.json', chooser);
    expect(chooser).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ status: 'opened', libraryAdopted: true });
    const st = useCatalogConfigStore.getState();
    expect(Object.keys(st.overrides)).toEqual(['SAM_TPS-300-Z']);
    expect(st.approvals['SAM_TPS-300-Z']).toEqual(APPROVAL);
    expect(st.aporteOverrides['SAM_TPS-300-Z']).toEqual(APORTE);
    // y quedó persistido en localStorage con los tres.
    const persisted = JSON.parse(localStorage.getItem(LIBRARY_STORAGE_KEY)!);
    expect(Object.keys(persisted.overrides)).toHaveLength(1);
    expect(Object.keys(persisted.approvals)).toHaveLength(1);
    expect(Object.keys(persisted.aporteOverrides)).toHaveLength(1);
    expect(savedLocal).not.toBeNull();
  });

  it('adoptar guarda antes una copia de la biblioteca anterior bajo otra clave', async () => {
    withLibrary();
    const { json } = buildProjectCopy();
    // La local pasa a ser distinta de la del archivo.
    useCatalogConfigStore.getState().replaceLibrary({ overrides: {}, approvals: {}, aporteOverrides: { X: { kind: 'longitud' } } });
    const anterior = localStorage.getItem(LIBRARY_STORAGE_KEY)!;
    const r = await openProjectText(json, 'copia.json', choose('adopt'));
    expect(r.status === 'opened' && r.backupKey).toBeTruthy();
    const key = (r as { backupKey: string }).backupKey;
    expect(key.startsWith(LIBRARY_BACKUP_PREFIX)).toBe(true);
    expect(localStorage.getItem(key)).toBe(anterior); // byte a byte
  });

  it('seguir con la local (por defecto) y cancelar NO modifican la biblioteca; cancelar tampoco el proyecto', async () => {
    withLibrary();
    const { json } = buildProjectCopy();
    useCatalogConfigStore.getState().replaceLibrary({ overrides: {}, approvals: {}, aporteOverrides: {} });
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);

    const keep = await openProjectText(json, 'c.json', choose('local'));
    expect(keep).toMatchObject({ status: 'opened', libraryAdopted: false });
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBe(raw);
    expect(useCatalogConfigStore.getState().approvals).toEqual({});

    useWorkspaceStore.getState().loadDemoEquipment();
    const before = structuredClone(projectState());
    const cancel = await openProjectText(json, 'c.json', choose('cancel'));
    expect(cancel.status).toBe('cancelled');
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBe(raw);
    expect(structuredClone(projectState())).toEqual(before);
  });

  it('si la biblioteca del archivo es igual a la local no hay aviso', async () => {
    withLibrary();
    const { json } = buildProjectCopy();
    const chooser = choose('cancel');
    const r = await openProjectText(json, 'c.json', chooser);
    expect(chooser).not.toHaveBeenCalled();
    expect(r.status).toBe('opened');
  });

  it('A5: un archivo sin bloque de biblioteca deja codex:catalogConfig:v1 byte a byte igual (y no pregunta)', async () => {
    withLibrary();
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const chooser = choose('adopt'); // si preguntara, adoptaría: no debe llamarse
    const r = await openProjectText(readFileSync(FIXTURE, 'utf8'), 'user-report.json', chooser); // v1 sin catalogConfig
    expect(r.status).toBe('opened');
    expect(chooser).not.toHaveBeenCalled();
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBe(raw);
    // También un v2 sin bloque (biblioteca vacía al guardar).
    const v2 = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    v2.fileVersion = 2;
    await openProjectText(JSON.stringify(v2), 'v2-sin-library.json', chooser);
    expect(chooser).not.toHaveBeenCalled();
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBe(raw);
  });

  it('archivo v1 con catalogConfig: aviso parcial; adoptar sólo reemplaza overrides', async () => {
    withLibrary();
    const v1 = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    v1.catalogConfig = {
      version: 'codex:catalogConfig/1',
      overrides: { 'SAM_XPS-300-Z': { ...MAPPING, productId: 'SAM_XPS-300-Z' } },
    };
    const seen: Array<{ partial: boolean }> = [];
    const r = await openProjectText(JSON.stringify(v1), 'v1.json', async (c) => {
      seen.push({ partial: c.partial });
      return 'adopt';
    });
    expect(seen).toEqual([{ partial: true }]);
    expect(r).toMatchObject({ status: 'opened', libraryAdopted: true });
    const st = useCatalogConfigStore.getState();
    expect(Object.keys(st.overrides)).toEqual(['SAM_XPS-300-Z']);
    expect(st.approvals['SAM_TPS-300-Z']).toEqual(APPROVAL); // intactas
    expect(st.aporteOverrides['SAM_TPS-300-Z']).toEqual(APORTE);
  });

  it('si no se puede guardar la copia de respaldo, no se adopta', async () => {
    withLibrary();
    const { json } = buildProjectCopy();
    useCatalogConfigStore.getState().replaceLibrary({ overrides: {}, approvals: {}, aporteOverrides: {} });
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    const r = await openProjectText(json, 'c.json', choose('adopt'));
    setItem.mockRestore();
    expect(r.status).toBe('error');
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBe(raw);
    expect(useCatalogConfigStore.getState().approvals).toEqual({});
  });
});

describe('saveNow sin bloqueos', () => {
  it('una escritura manual persiste el estado actual', async () => {
    await bootProject();
    useWorkspaceStore.getState().loadDemoEquipment();
    await saveNow();
    expect(useProjectStatusStore.getState().phase).toBe('saved');
    expect(await readCurrentRecord()).not.toBeNull();
  });
});
