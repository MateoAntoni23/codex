// @vitest-environment jsdom
/**
 * Mallas civiles en un almacén aparte de IndexedDB (`mallasCiviles`): el autoguardado
 * normal guarda sólo la referencia y los datos de ensamblado; la malla se escribe
 * sólo cuando la parte civil cambia (importar, reemplazar, quitar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { useParteCivilStore } from '../../civil/parteCivilStore';
import type { ArchivoCivil, MallaCivil } from '../../civil/modelo';
import { emptyTrayInput } from '../emptyProject';
import { DEFAULT_PROJECT_META } from '../../workspace/workspaceFile';
import { CIVIL_MESH_STORE, WORKSPACE_DB_NAME, _setWorkspaceIdbFactory, readCivilMeshes, readCurrentRecord, writeCurrentRecord } from '../projectDb';
import { _resetBootForTests, bootProject, buildProjectCopy, claveMalla, newProject, startAutosave, useProjectStatusStore } from '../projectSession';

const b64 = (a: Float32Array | Uint32Array) => Buffer.from(a.buffer).toString('base64');
function malla(alto = 6000): MallaCivil {
  const p = new Float32Array([0, 0, 0, 300, 0, 0, 300, 300, 0, 0, 300, 0, 0, 0, alto, 300, 0, alto, 300, 300, alto, 0, 300, alto]);
  const i = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  return {
    version: 'codex:civilMalla/1', unidades: { codigo: 'mm', texto: 'milímetro' }, solidos: 1, vertices: 8,
    triangulos: 4, tolerancia_mm: 2, caja_mm: { min: [0, 0, 0], max: [300, 300, alto] }, posiciones: b64(p), indices: b64(i),
  };
}
const archivo = (over: Partial<ArchivoCivil> = {}): ArchivoCivil => ({
  id: 'c1', nombre: 'PB-columnas.stp', tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Z',
  desplazamientoMm: [0, 0, 0], giroDeg: 0, malla: malla(), importadoEn: '2026-11-15T00:00:00Z', version: 1, ...over,
});

let factory: IDBFactory;
let stop: (() => void) | null = null;
beforeEach(() => {
  factory = new IDBFactory();
  _setWorkspaceIdbFactory(factory);
  localStorage.clear();
  useWorkspaceStore.getState().reset();
  useTrayStore.getState().importEdit(emptyTrayInput());
  useParteCivilStore.getState().cargar([]);
  _resetBootForTests();
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.restoreAllMocks();
  _setWorkspaceIdbFactory(null);
});

const guardado = () => vi.waitFor(() => expect(useProjectStatusStore.getState().phase).toBe('saved'), { timeout: 4000 });

/** Cuenta las escrituras (put/delete) sobre el almacén de mallas. */
function contarEscriturasDeMallas() {
  const n = { put: 0, delete: 0 };
  const put = IDBObjectStore.prototype.put;
  const del = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...a: Parameters<typeof put>) {
    if (this.name === CIVIL_MESH_STORE) n.put++;
    return put.apply(this, a);
  });
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...a: Parameters<typeof del>) {
    if (this.name === CIVIL_MESH_STORE) n.delete++;
    return del.apply(this, a);
  });
  return n;
}

async function clavesDeMallas(): Promise<string[]> {
  const db: IDBDatabase = await new Promise((res, rej) => {
    const r = factory.open(WORKSPACE_DB_NAME);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const keys: IDBValidKey[] = await new Promise((res) => {
    const r = db.transaction(CIVIL_MESH_STORE).objectStore(CIVIL_MESH_STORE).getAllKeys();
    r.onsuccess = () => res(r.result);
  });
  db.close();
  return keys.map(String).sort();
}

async function reabrir(): Promise<void> {
  stop?.();
  stop = null;
  useParteCivilStore.getState().cargar([]);
  _resetBootForTests();
  await bootProject();
}

describe('mallas civiles en un almacén aparte', () => {
  it('current lleva la referencia y el ensamblado; la malla va en mallasCiviles y vuelve al reabrir', async () => {
    await bootProject();
    stop = startAutosave();
    const a = archivo({ desplazamientoMm: [1000, 2000, 0], giroDeg: 15 });
    useParteCivilStore.getState().cargar([a]);
    await guardado();

    const rec = (await readCurrentRecord()) as { project: { parteCivil: Record<string, unknown>[] } };
    expect(rec.project.parteCivil).toHaveLength(1);
    expect(rec.project.parteCivil[0]).not.toHaveProperty('malla');
    expect(rec.project.parteCivil[0]).toMatchObject({ id: 'c1', mallaRef: 'c1@1', giroDeg: 15, desplazamientoMm: [1000, 2000, 0] });
    expect(JSON.stringify(rec).length).toBeLessThan(2000); // sin base64 de la malla
    expect((await readCivilMeshes(['c1@1'])).get('c1@1')).toEqual(a.malla);

    await reabrir();
    expect(useParteCivilStore.getState().archivos).toEqual([a]);
    // La copia del proyecto sigue llevando la malla adentro.
    const copia = JSON.parse(buildProjectCopy().json);
    expect(copia.parteCivil.archivos[0].malla).toEqual(a.malla);
  });

  it('mover una bandeja, cambiar el proyecto o mover la nave NO reescribe la malla', async () => {
    await bootProject();
    stop = startAutosave();
    useParteCivilStore.getState().cargar([archivo()]);
    await guardado();

    const n = contarEscriturasDeMallas();
    useWorkspaceStore.getState().loadDemoEquipment();
    await guardado();
    useTrayStore.getState().importEdit({ ...emptyTrayInput() });
    await guardado();
    useParteCivilStore.getState().actualizar('c1', { giroDeg: 30, desplazamientoMm: [5, 6, 7] });
    await guardado();
    expect(n).toEqual({ put: 0, delete: 0 });
    const rec = (await readCurrentRecord()) as { project: { parteCivil: Record<string, unknown>[] } };
    expect(rec.project.parteCivil[0]).toMatchObject({ giroDeg: 30, desplazamientoMm: [5, 6, 7] });

    // Tampoco después de reabrir: lo leído ya está guardado.
    await reabrir();
    stop = startAutosave();
    useWorkspaceStore.getState().loadDemoEquipment();
    useWorkspaceStore.getState().removeElement(useWorkspaceStore.getState().elements[0].id);
    await guardado();
    expect(n).toEqual({ put: 0, delete: 0 });
  });

  it('importar escribe una malla, reemplazar escribe la nueva y borra la vieja, quitar la borra', async () => {
    await bootProject();
    stop = startAutosave();
    const n = contarEscriturasDeMallas();
    const s = useParteCivilStore.getState();
    s.setPendiente({ modo: 'nuevo', nombreArchivo: 'PB-columnas.stp', malla: malla(), tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Z' });
    const id = useParteCivilStore.getState().confirmarPendiente()!;
    await guardado();
    expect(n.put).toBe(1);
    expect(await clavesDeMallas()).toEqual([`${id}@1`]);

    useParteCivilStore.getState().setPendiente({ modo: 'reemplazar', reemplazaId: id, nombreArchivo: 'PB-columnas-v2.stp', malla: malla(7000), tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Z' });
    useParteCivilStore.getState().confirmarPendiente();
    await guardado();
    expect(n.put).toBe(2);
    expect(await clavesDeMallas()).toEqual([`${id}@2`]);
    await reabrir();
    expect(useParteCivilStore.getState().archivos[0].malla.caja_mm.max[2]).toBe(7000);

    stop = startAutosave();
    useParteCivilStore.getState().quitar(id);
    await guardado();
    expect(await clavesDeMallas()).toEqual([]);
  });

  it('nuevo proyecto borra las mallas del anterior', async () => {
    await bootProject();
    stop = startAutosave();
    useParteCivilStore.getState().cargar([archivo(), archivo({ id: 'c2', nombre: 'P1-losa.stp', tipo: 'losa' })]);
    await guardado();
    expect(await clavesDeMallas()).toEqual(['c1@1', 'c2@1']);
    newProject();
    await guardado();
    expect(await clavesDeMallas()).toEqual([]);
  });

  it('si falta la malla de un archivo, el proyecto se abre igual sin ese archivo y se avisa', async () => {
    // Registro que nombra una malla que no está en el equipo.
    await writeCurrentRecord(
      {
        schema: 'codex:workspaceProject/2',
        savedAt: '2026-11-15T00:00:00Z',
        project: {
          projectV2: { schemaVersion: 2, elements: [], evidence: [], ...DEFAULT_PROJECT_META },
          trayInput: emptyTrayInput(),
          importedCatalog: null,
          parteCivil: [{ ...(({ malla: _m, ...r }) => r)(archivo()), mallaRef: 'c1@1' }],
        },
      },
      { poner: [], conservar: new Set() },
    );
    _resetBootForTests();
    await bootProject();
    expect(useProjectStatusStore.getState().phase).toBe('saved');
    expect(useParteCivilStore.getState().archivos).toEqual([]);
    expect(useProjectStatusStore.getState().notice).toMatch(/PB-columnas\.stp/);
  });

  it('un registro con la malla adentro (formato previo de esta rama) se sigue abriendo', async () => {
    const a = archivo();
    await writeCurrentRecord({
      schema: 'codex:workspaceProject/2',
      savedAt: '2026-11-15T00:00:00Z',
      project: { projectV2: { schemaVersion: 2, elements: [], evidence: [], ...DEFAULT_PROJECT_META }, trayInput: emptyTrayInput(), importedCatalog: null, parteCivil: [a] },
    });
    await bootProject();
    expect(useParteCivilStore.getState().archivos).toEqual([a]);
    // Al guardar de nuevo pasa al almacén aparte.
    stop = startAutosave();
    useParteCivilStore.getState().actualizar('c1', { giroDeg: 1 });
    await guardado();
    expect(await clavesDeMallas()).toEqual([claveMalla(a)]);
  });
});
