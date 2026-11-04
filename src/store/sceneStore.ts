import { create } from 'zustand';
import type { DomainObject } from '../types/domain';
import { INITIAL_OBJECTS } from './initialObjects';

interface SceneState {
  objects: DomainObject[];
  selectedId: string | null;
  selectObject: (id: string) => void;
  clearSelection: () => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  objects: INITIAL_OBJECTS,
  selectedId: null,
  selectObject: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
}));
