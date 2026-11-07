/**
 * useParametricStore — estado local de la vista paramétrica experimental.
 *
 * Aislado: sin persistencia, sin impacto en proyectos ni en el motor Python.
 */

import { create } from 'zustand';
import { PARAMETRIC_CATALOG, type ViewId } from './catalog';

interface ParametricState {
  readonly recipe: string;
  readonly view: ViewId;
  readonly selectedPort: string | null;
  readonly showAxes: boolean;
  readonly showPorts: boolean;
  readonly showNormals: boolean;
  readonly showTrajectory: boolean;
  readonly compareOriginal: boolean;
  setRecipe(recipe: string): void;
  setView(view: ViewId): void;
  selectPort(port: string | null): void;
  toggleAxes(): void;
  togglePorts(): void;
  toggleNormals(): void;
  toggleTrajectory(): void;
  toggleCompareOriginal(): void;
  reset(): void;
}

const INITIAL_RECIPE = PARAMETRIC_CATALOG[0].recipe;

export const useParametricStore = create<ParametricState>((set) => ({
  recipe: INITIAL_RECIPE,
  view: 'reconstruction',
  selectedPort: null,
  showAxes: true,
  showPorts: true,
  showNormals: true,
  showTrajectory: true,
  compareOriginal: false,
  setRecipe(recipe) {
    set({ recipe, selectedPort: null });
  },
  setView(view) {
    set({ view, selectedPort: null });
  },
  selectPort(port) {
    set({ selectedPort: port });
  },
  toggleAxes() {
    set((s) => ({ showAxes: !s.showAxes }));
  },
  togglePorts() {
    set((s) => ({ showPorts: !s.showPorts }));
  },
  toggleNormals() {
    set((s) => ({ showNormals: !s.showNormals }));
  },
  toggleTrajectory() {
    set((s) => ({ showTrajectory: !s.showTrajectory }));
  },
  toggleCompareOriginal() {
    set((s) => ({ compareOriginal: !s.compareOriginal }));
  },
  reset() {
    set({
      recipe: INITIAL_RECIPE,
      view: 'reconstruction',
      selectedPort: null,
      showAxes: true,
      showPorts: true,
      showNormals: true,
      showTrajectory: true,
      compareOriginal: false,
    });
  },
}));

export function findEntry(recipe: string) {
  const entry = PARAMETRIC_CATALOG.find((e) => e.recipe === recipe);
  if (!entry) throw new Error(`recipe desconocida: ${recipe}`);
  return entry;
}
