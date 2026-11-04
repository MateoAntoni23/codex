import { create } from 'zustand';
import type { DomainObject } from '../types/domain';

// Escena de ejemplo — posiciones y dimensiones en milímetros, Z vertical
const INITIAL_OBJECTS: DomainObject[] = [
  {
    id: 'floor-1',
    name: 'Piso',
    type: 'floor',
    position: { x: 0, y: 0, z: 0 },
    dimensions: { width: 30000, depth: 30000, height: 0 },
  },
  {
    id: 'building-1',
    name: 'Nave Industrial',
    type: 'building',
    position: { x: 0, y: 0, z: 0 },
    dimensions: { width: 20000, depth: 15000, height: 8000 },
  },
  {
    id: 'panel-1',
    name: 'Tablero Eléctrico',
    type: 'panel',
    position: { x: -7000, y: 2000, z: 1000 },
    dimensions: { width: 800, depth: 400, height: 2000 },
  },
  {
    id: 'motor-1',
    name: 'Motor Eléctrico',
    type: 'motor',
    position: { x: 4000, y: 4000, z: 400 },
    dimensions: { width: 600, depth: 600, height: 800 },
  },
];

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
