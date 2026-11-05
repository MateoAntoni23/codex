/**
 * usePreviewStore — estado mutable de la vista de prueba v2.
 *
 * Gestiona los elementos editables en memoria, la selección y la evidencia manual.
 * No tiene saveStatus, editingBlocked ni ninguna operación de IndexedDB.
 * El aislamiento de persistencia es estructural: este módulo no importa
 * projectManager ni db.
 */

import { create } from 'zustand';
import { PREVIEW_ELEMENTS } from './previewData';
import type { EquipmentElement, FieldEvidence } from '../types/domain-v2';

function copyElements(elements: EquipmentElement[]): EquipmentElement[] {
  // Copia superficial de cada objeto — suficiente porque todas las mutaciones
  // crean nuevos objetos via spread; nunca se muta en lugar.
  return elements.map((e) => ({ ...e }));
}

interface PreviewState {
  elements: EquipmentElement[];
  evidence: FieldEvidence[];
  selectedId: string | null;
  select: (id: string) => void;
  clearSelection: () => void;
  updateElement: (updated: EquipmentElement) => void;
  addElement: (el: EquipmentElement) => void;
  removeElement: (id: string) => void;
  addEvidence: (ev: FieldEvidence) => void;
  resetElements: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  elements: copyElements(PREVIEW_ELEMENTS),
  evidence: [],
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),
  updateElement: (updated) =>
    set((s) => ({
      elements: s.elements.map((e) => (e.id === updated.id ? updated : e)),
    })),
  addElement: (el) =>
    set((s) => ({ elements: [...s.elements, el], selectedId: el.id })),
  removeElement: (id) =>
    set((s) => ({
      elements:   s.elements.filter((e) => e.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  addEvidence: (ev) =>
    set((s) => ({ evidence: [...s.evidence, ev] })),
  resetElements: () =>
    set({ elements: copyElements(PREVIEW_ELEMENTS), evidence: [], selectedId: null }),
}));
