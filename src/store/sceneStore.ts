import { create } from 'zustand';
import type { DomainObject, Vec3mm } from '../types/domain';
import { INITIAL_OBJECTS } from './initialObjects';

interface SceneState {
  objects: DomainObject[];
  selectedId: string | null;
  /** Origen del proyecto en coordenadas globales (mm). */
  projectOrigin: Vec3mm;
  selectObject: (id: string) => void;
  clearSelection: () => void;
  /** Reemplaza la posición del objeto indicado de forma inmutable. */
  updateObjectPosition: (id: string, position: Vec3mm) => void;
  /** Establece el origen del proyecto. No mueve objetos. */
  setProjectOrigin: (origin: Vec3mm) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  objects: INITIAL_OBJECTS,
  selectedId: null,
  projectOrigin: { x: 0, y: 0, z: 0 },
  selectObject: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
  updateObjectPosition: (id, position) =>
    set((state) => ({
      objects: state.objects.map((o) =>
        o.id === id ? { ...o, position: { ...position } } : o,
      ),
    })),
  setProjectOrigin: (origin) => set({ projectOrigin: { ...origin } }),
}));
