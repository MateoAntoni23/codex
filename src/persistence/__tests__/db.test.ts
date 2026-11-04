import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { _setIdbFactory, _resetIdbFactory, loadProjectFromDb, saveProjectToDb } from '../db';
import { SCHEMA_VERSION, type ProjectData } from '../schema';

const SAMPLE: ProjectData = {
  schemaVersion: SCHEMA_VERSION,
  projectOrigin: { x: 100, y: 200, z: 300 },
  objects: [
    {
      id: 'panel-1',
      name: 'Tablero',
      type: 'panel',
      position: { x: -7000, y: 2000, z: 1000 },
      dimensions: { width: 800, depth: 400, height: 2000 },
    },
  ],
};

beforeEach(() => {
  _setIdbFactory(new IDBFactory());
});

afterEach(() => {
  _resetIdbFactory();
});

describe('loadProjectFromDb', () => {
  it('devuelve null si no hay datos guardados', async () => {
    const result = await loadProjectFromDb();
    expect(result).toBeNull();
  });
});

describe('saveProjectToDb + loadProjectFromDb', () => {
  it('guarda y recupera el proyecto correctamente', async () => {
    await saveProjectToDb(SAMPLE);
    const loaded = await loadProjectFromDb();
    expect(loaded).toEqual(SAMPLE);
  });

  it('sobrescribe con la última escritura', async () => {
    await saveProjectToDb(SAMPLE);
    const updated: ProjectData = {
      ...SAMPLE,
      projectOrigin: { x: 500, y: 600, z: 700 },
    };
    await saveProjectToDb(updated);
    const loaded = await loadProjectFromDb();
    expect(loaded?.projectOrigin).toEqual({ x: 500, y: 600, z: 700 });
  });

  it('conserva posiciones y origen con precisión exacta', async () => {
    const data: ProjectData = {
      ...SAMPLE,
      projectOrigin: { x: -1234, y: 5678, z: 999 },
      objects: [
        {
          ...SAMPLE.objects[0],
          position: { x: -7000, y: 2000, z: 1000 },
        },
      ],
    };
    await saveProjectToDb(data);
    const loaded = await loadProjectFromDb();
    expect(loaded?.objects[0].position).toEqual({ x: -7000, y: 2000, z: 1000 });
    expect(loaded?.projectOrigin).toEqual({ x: -1234, y: 5678, z: 999 });
  });

  it('carga aislada entre tests (cada test usa una DB fresca)', async () => {
    // Si hubiera datos del test anterior, falla — pero la DB es fresca por beforeEach.
    const result = await loadProjectFromDb();
    expect(result).toBeNull();
  });
});
