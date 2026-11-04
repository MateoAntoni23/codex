import { create } from 'zustand';
import type { DomainObject, Vec3mm } from '../types/domain';
import { INITIAL_OBJECTS } from './initialObjects';

export type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'recovering' | 'error';

interface SceneState {
  objects: DomainObject[];
  selectedId: string | null;
  /** Origen del proyecto en coordenadas globales (mm). */
  projectOrigin: Vec3mm;
  /** Estado del guardado local en IndexedDB. */
  saveStatus: SaveStatus;
  saveError: string | null;
  selectObject: (id: string) => void;
  clearSelection: () => void;
  /** Reemplaza la posición del objeto indicado de forma inmutable. */
  updateObjectPosition: (id: string, position: Vec3mm) => void;
  /** Establece el origen del proyecto. No mueve objetos. */
  setProjectOrigin: (origin: Vec3mm) => void;
  /** Actualiza el estado del guardado local. */
  setSaveStatus: (status: SaveStatus, error: string | null) => void;
  /** Reemplaza objetos y origen (p.ej. al cargar o importar). Limpia la selección. */
  hydrateProject: (objects: DomainObject[], projectOrigin: Vec3mm) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  objects: INITIAL_OBJECTS,
  selectedId: null,
  projectOrigin: { x: 0, y: 0, z: 0 },
  saveStatus: 'loading', // "Cargando..." hasta que initProject complete
  saveError: null,
  selectObject: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
  updateObjectPosition: (id, position) =>
    set((state) => ({
      objects: state.objects.map((o) =>
        o.id === id ? { ...o, position: { ...position } } : o,
      ),
    })),
  setProjectOrigin: (origin) => set({ projectOrigin: { ...origin } }),
  setSaveStatus: (status, error) => set({ saveStatus: status, saveError: error }),
  hydrateProject: (objects, projectOrigin) =>
    set({ objects, projectOrigin: { ...projectOrigin }, selectedId: null }),
}));
