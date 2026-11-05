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
  /** true mientras pauseAndFlush está activo; bloquea todas las modificaciones. */
  editingBlocked: boolean;
  selectObject: (id: string) => void;
  clearSelection: () => void;
  /** Reemplaza la posición del objeto indicado de forma inmutable. No-op si editingBlocked. */
  updateObjectPosition: (id: string, position: Vec3mm) => void;
  /** Establece el origen del proyecto. No mueve objetos. No-op si editingBlocked. */
  setProjectOrigin: (origin: Vec3mm) => void;
  /** Actualiza el estado del guardado local. */
  setSaveStatus: (status: SaveStatus, error: string | null) => void;
  /** Reemplaza objetos y origen (p.ej. al cargar o importar). Limpia la selección. No-op si editingBlocked. */
  hydrateProject: (objects: DomainObject[], projectOrigin: Vec3mm) => void;
  /** Bloquea o desbloquea las modificaciones del editor. */
  setEditingBlocked: (blocked: boolean) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  objects: INITIAL_OBJECTS,
  selectedId: null,
  projectOrigin: { x: 0, y: 0, z: 0 },
  saveStatus: 'loading', // "Cargando..." hasta que initProject complete
  saveError: null,
  editingBlocked: false,
  selectObject: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
  updateObjectPosition: (id, position) =>
    set((state) => {
      if (state.editingBlocked) return {};
      return {
        objects: state.objects.map((o) =>
          o.id === id ? { ...o, position: { ...position } } : o,
        ),
      };
    }),
  setProjectOrigin: (origin) =>
    set((state) => {
      if (state.editingBlocked) return {};
      return { projectOrigin: { ...origin } };
    }),
  setSaveStatus: (status, error) => set({ saveStatus: status, saveError: error }),
  hydrateProject: (objects, projectOrigin) =>
    set((state) => {
      if (state.editingBlocked) return {};
      return { objects, projectOrigin: { ...projectOrigin }, selectedId: null };
    }),
  setEditingBlocked: (blocked) => set({ editingBlocked: blocked }),
}));
