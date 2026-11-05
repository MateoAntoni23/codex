import { create } from 'zustand';
import { PREVIEW_ELEMENTS, PREVIEW_EVIDENCE } from '../preview/previewData';
import { evidenceToRemoveOnDelete, duplicateElement } from '../preview/previewCrud';
import { DEFAULT_PROJECT_META, type ProjectMeta } from './workspaceFile';
import type { EquipmentElement, FieldEvidence } from '../types/domain-v2';

export type LayerKey = 'infrastructure' | 'equipment' | 'trays' | 'supports' | 'pe';

export interface WorkspaceState {
  // Equipment state
  elements: EquipmentElement[];
  evidence: FieldEvidence[];

  // Full ProjectDataV2 metadata (origin, factories, etc.) — persisted across edits
  projectMeta: ProjectMeta;

  // Selection
  selectedEquipId: string | null;
  selectedTrayId: string | null;
  selectedSupportId: string | null;

  // Layer visibility
  layers: Record<LayerKey, boolean>;

  // File state
  fileName: string | null;
  dirty: boolean;

  // Connection tool state
  connectionToolActive: boolean;
  connectionPortA: [string, string] | null; // [instancia_id, puerto_id]

  // Equipment actions
  selectEquip: (id: string | null) => void;
  updateElement: (el: EquipmentElement) => void;
  addElement: (el: EquipmentElement) => void;
  removeElement: (id: string) => void;
  addEvidence: (ev: FieldEvidence) => void;
  duplicateEquip: (id: string) => void;

  // Tray / support selection
  selectTray: (id: string | null) => void;
  selectSupport: (id: string | null) => void;

  // Layer actions
  toggleLayer: (key: LayerKey) => void;

  // Connection tool
  activateConnectionTool: () => void;
  deactivateConnectionTool: () => void;
  setConnectionPortA: (port: [string, string] | null) => void;

  // Import/reset
  loadFile: (elements: EquipmentElement[], evidence: FieldEvidence[], meta: ProjectMeta, fileName: string) => void;
  markDirty: () => void;
  markSaved: (fileName: string) => void;
  reset: () => void;
}

function copyElements(els: EquipmentElement[]): EquipmentElement[] {
  return els.map((e) => ({ ...e }));
}

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  infrastructure: true,
  equipment: true,
  trays: true,
  supports: true,
  pe: true,
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  elements: copyElements(PREVIEW_ELEMENTS),
  evidence: [...PREVIEW_EVIDENCE],
  projectMeta: { ...DEFAULT_PROJECT_META },
  selectedEquipId: null,
  selectedTrayId: null,
  selectedSupportId: null,
  layers: { ...DEFAULT_LAYERS },
  fileName: null,
  dirty: false,
  connectionToolActive: false,
  connectionPortA: null,

  selectEquip: (id) => set({ selectedEquipId: id, selectedTrayId: null, selectedSupportId: null }),
  selectTray: (id) => set({ selectedTrayId: id, selectedEquipId: null, selectedSupportId: null }),
  selectSupport: (id) => set({ selectedSupportId: id, selectedEquipId: null, selectedTrayId: null }),

  updateElement: (el) =>
    set((s) => ({
      elements: s.elements.map((e) => (e.id === el.id ? el : e)),
      dirty: true,
    })),

  addElement: (el) =>
    set((s) => ({
      elements: [...s.elements, el],
      selectedEquipId: el.id,
      dirty: true,
    })),

  removeElement: (id) =>
    set((s) => {
      const toRemove = new Set(evidenceToRemoveOnDelete(id, s.elements, s.evidence));
      return {
        elements:        s.elements.filter((e) => e.id !== id),
        evidence:        s.evidence.filter((ev) => !toRemove.has(ev.id)),
        selectedEquipId: s.selectedEquipId === id ? null : s.selectedEquipId,
        dirty:           true,
      };
    }),

  addEvidence: (ev) => set((s) => ({ evidence: [...s.evidence, ev], dirty: true })),

  duplicateEquip: (id) => {
    const s = get();
    const el = s.elements.find((e) => e.id === id);
    if (!el) return;
    const { duplicate, provenance } = duplicateElement(el, s.elements);
    set({
      elements:        [...s.elements, duplicate],
      evidence:        [...s.evidence, provenance],
      selectedEquipId: duplicate.id,
      dirty:           true,
    });
  },

  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),

  activateConnectionTool: () => set({ connectionToolActive: true, connectionPortA: null, selectedEquipId: null, selectedTrayId: null, selectedSupportId: null }),
  deactivateConnectionTool: () => set({ connectionToolActive: false, connectionPortA: null }),
  setConnectionPortA: (port) => set({ connectionPortA: port }),

  loadFile: (elements, evidence, meta, fileName) =>
    set({
      elements:            copyElements(elements),
      evidence:            [...evidence],
      projectMeta:         { ...meta },
      fileName,
      dirty:               false,
      selectedEquipId:     null,
      selectedTrayId:      null,
      selectedSupportId:   null,
      connectionToolActive: false,
      connectionPortA:     null,
    }),

  markDirty: () => set({ dirty: true }),
  markSaved: (fileName) => set({ fileName, dirty: false }),

  reset: () =>
    set({
      elements:        copyElements(PREVIEW_ELEMENTS),
      evidence:        [...PREVIEW_EVIDENCE],
      projectMeta:     { ...DEFAULT_PROJECT_META },
      selectedEquipId: null,
      selectedTrayId:  null,
      selectedSupportId: null,
      layers:          { ...DEFAULT_LAYERS },
      fileName:        null,
      dirty:           false,
      connectionToolActive: false,
      connectionPortA: null,
    }),
}));
