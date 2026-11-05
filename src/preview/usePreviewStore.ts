/**
 * usePreviewStore — estado mínimo de la vista de prueba v2.
 *
 * Solo gestiona la selección; no tiene saveStatus, editingBlocked
 * ni ninguna operación de IndexedDB. El aislamiento de persistencia
 * es estructural: este módulo no importa projectManager ni db.
 */

import { create } from 'zustand';

interface PreviewState {
  selectedId: string | null;
  select: (id: string) => void;
  clearSelection: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
}));
