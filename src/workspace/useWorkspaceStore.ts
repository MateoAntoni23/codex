import { create } from 'zustand';
import { PREVIEW_ELEMENTS, PREVIEW_EVIDENCE } from '../preview/previewData';
import { evidenceToRemoveOnDelete, duplicateElement } from '../preview/previewCrud';
import { DEFAULT_PROJECT_META, type ProjectMeta } from './workspaceFile';
import type { EquipmentElement, FieldEvidence, Vec3 } from '../types/domain-v2';
import type { ImportedCatalog } from '../import/types';
import { buildElementFromImported } from '../import/placement';

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

  // Catálogo importado desde Excel ELS-IMP-EQCX. Se persiste tal cual para que
  // A11 (round-trip save/load) conserve estados/alternativas/pendientes.
  // El inspector sabe mostrar la ficha técnica incluso sin ubicación 3D (A10).
  importedCatalog: ImportedCatalog | null;
  selectedImportedEquipoId: string | null;

  // Historial equipment-only (posición + alta/baja + vínculo importado)
  equipHistory: EquipmentElement[][];
  equipFuture: EquipmentElement[][];

  // Equipment actions
  selectEquip: (id: string | null) => void;
  updateElement: (el: EquipmentElement) => void;
  addElement: (el: EquipmentElement) => void;
  removeElement: (id: string) => void;
  addEvidence: (ev: FieldEvidence) => void;
  duplicateEquip: (id: string) => void;
  undoEquip: () => void;
  redoEquip: () => void;
  /**
   * Toma un snapshot del estado actual de `elements` y lo empuja al historial
   * SIN mutar `elements`. Se usa al comenzar un drag en escena para que la
   * secuencia completa de movimientos sea un único paso deshacible.
   */
  beginEquipCheckpoint: () => void;
  /**
   * Actualiza un elemento sin tocar el historial. Pensado para los frames
   * intermedios de un drag: el checkpoint ya quedó empujado al iniciar.
   */
  updateElementTransient: (el: EquipmentElement) => void;

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
  loadFile: (
    elements: EquipmentElement[],
    evidence: FieldEvidence[],
    meta: ProjectMeta,
    fileName: string,
    importedCatalog?: ImportedCatalog | null,
  ) => void;
  markDirty: () => void;
  markSaved: (fileName: string) => void;
  reset: () => void;

  // Catálogo importado
  setImportedCatalog: (c: ImportedCatalog | null) => void;
  selectImportedEquipo: (id: string | null) => void;

  // Puente importado → operativo
  /**
   * Coloca un equipo del catálogo importado en la escena:
   *  - Si ya existe un EquipmentElement con el mismo equipoId → selecciona.
   *  - Si no, crea uno nuevo con id = equipoId, geometría por defecto para la
   *    categoría y lo deja en 'placed' en positionMm (o 'unplaced' si null).
   * Devuelve el id del elemento resultante, o null si el equipo no se encontró.
   */
  placeImportedEquipo: (equipoId: string, positionMm: Vec3 | null) => string | null;
  /**
   * Vincula un elemento existente con un equipo importado sin crear duplicados.
   * Mantiene identidad, posición, geometría, jerarquía y ficha del elemento;
   * sólo setea importedRef. Si otro elemento ya estaba vinculado al mismo
   * equipoId, el vínculo se transfiere (el anterior queda desvinculado).
   */
  linkImportedToElement: (elementId: string, equipoId: string) => void;
  /** Rompe el vínculo con el catálogo importado dejando el elemento operativo intacto. */
  unlinkElement: (elementId: string) => void;
}

function copyElements(els: EquipmentElement[]): EquipmentElement[] {
  return els.map((e) => ({ ...e }));
}

/** Snapshot previo a una mutación de elementos. Cap MAX_HIST para no crecer sin fin. */
const MAX_HIST = 20;
function pushEquipHistory(history: EquipmentElement[][], current: EquipmentElement[]) {
  return [...history.slice(-(MAX_HIST - 1)), copyElements(current)];
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
  importedCatalog: null,
  selectedImportedEquipoId: null,
  equipHistory: [],
  equipFuture: [],

  selectEquip: (id) => set({ selectedEquipId: id, selectedTrayId: null, selectedSupportId: null, selectedImportedEquipoId: null }),
  selectTray: (id) => set({ selectedTrayId: id, selectedEquipId: null, selectedSupportId: null, selectedImportedEquipoId: null }),
  selectSupport: (id) => set({ selectedSupportId: id, selectedEquipId: null, selectedTrayId: null, selectedImportedEquipoId: null }),

  updateElement: (el) =>
    set((s) => ({
      equipHistory: pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:  [],
      elements:     s.elements.map((e) => (e.id === el.id ? el : e)),
      dirty:        true,
    })),

  addElement: (el) =>
    set((s) => ({
      equipHistory:    pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:     [],
      elements:        [...s.elements, el],
      selectedEquipId: el.id,
      dirty:           true,
    })),

  removeElement: (id) =>
    set((s) => {
      const toRemove = new Set(evidenceToRemoveOnDelete(id, s.elements, s.evidence));
      return {
        equipHistory:    pushEquipHistory(s.equipHistory, s.elements),
        equipFuture:     [],
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
      equipHistory:    pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:     [],
      elements:        [...s.elements, duplicate],
      evidence:        [...s.evidence, provenance],
      selectedEquipId: duplicate.id,
      dirty:           true,
    });
  },

  undoEquip: () => {
    const { elements, equipHistory, equipFuture, selectedEquipId } = get();
    if (!equipHistory.length) return;
    const prev = equipHistory[equipHistory.length - 1];
    const nextFuture = [...equipFuture, copyElements(elements)].slice(-MAX_HIST);
    const stillExists = selectedEquipId && prev.some((e) => e.id === selectedEquipId);
    set({
      elements:        prev,
      equipHistory:    equipHistory.slice(0, -1),
      equipFuture:     nextFuture,
      selectedEquipId: stillExists ? selectedEquipId : null,
      dirty:           true,
    });
  },

  redoEquip: () => {
    const { elements, equipHistory, equipFuture, selectedEquipId } = get();
    if (!equipFuture.length) return;
    const next = equipFuture[equipFuture.length - 1];
    const nextHistory = [...equipHistory, copyElements(elements)].slice(-MAX_HIST);
    const stillExists = selectedEquipId && next.some((e) => e.id === selectedEquipId);
    set({
      elements:        next,
      equipHistory:    nextHistory,
      equipFuture:     equipFuture.slice(0, -1),
      selectedEquipId: stillExists ? selectedEquipId : null,
      dirty:           true,
    });
  },

  beginEquipCheckpoint: () =>
    set((s) => ({
      equipHistory: pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:  [],
    })),

  updateElementTransient: (el) =>
    set((s) => ({
      elements: s.elements.map((e) => (e.id === el.id ? el : e)),
      dirty:    true,
    })),

  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),

  activateConnectionTool: () => set({ connectionToolActive: true, connectionPortA: null, selectedEquipId: null, selectedTrayId: null, selectedSupportId: null }),
  deactivateConnectionTool: () => set({ connectionToolActive: false, connectionPortA: null }),
  setConnectionPortA: (port) => set({ connectionPortA: port }),

  loadFile: (elements, evidence, meta, fileName, importedCatalog) =>
    set({
      elements:            copyElements(elements),
      evidence:            [...evidence],
      projectMeta:         { ...meta },
      fileName,
      dirty:               false,
      selectedEquipId:     null,
      selectedTrayId:      null,
      selectedSupportId:   null,
      selectedImportedEquipoId: null,
      connectionToolActive: false,
      connectionPortA:     null,
      // `undefined` = sin cambios respecto a lo cargado. `null` o un catálogo = reemplazar.
      importedCatalog:     importedCatalog === undefined ? null : importedCatalog,
      equipHistory:        [],
      equipFuture:         [],
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
      selectedImportedEquipoId: null,
      layers:          { ...DEFAULT_LAYERS },
      fileName:        null,
      dirty:           false,
      connectionToolActive: false,
      connectionPortA: null,
      importedCatalog: null,
      equipHistory:    [],
      equipFuture:     [],
    }),

  setImportedCatalog: (c) =>
    set((s) => {
      if (!c) return { importedCatalog: null, dirty: true };
      // Reconciliar elementos vinculados al catálogo que se reemplaza.
      // Regla clave: la identidad se preserva (equipoId). El transform NUNCA se toca.
      // Sólo se actualizan tag/name y el libroId para reflejar el libro actual.
      const equiposById = new Map(c.equipos.map((e) => [e.equipoId, e] as const));
      const newLibroId = c.meta.fileHash;
      const elements = s.elements.map((el) => {
        const equipoId = el.importedRef?.equipoId;
        if (!equipoId) return el;
        const eq = equiposById.get(equipoId);
        if (!eq) return el; // Huérfano: no se toca; la UI lo muestra para que el usuario decida.
        const nextName = eq.descripcion?.trim() || eq.tag || el.name;
        const nextTag = eq.tag || null;
        const changed = el.tag !== nextTag || el.name !== nextName || el.importedRef!.libroId !== newLibroId;
        if (!changed) return el;
        return {
          ...el,
          tag: nextTag,
          name: nextName,
          importedRef: { equipoId, libroId: newLibroId },
        };
      });
      return { importedCatalog: c, elements, dirty: true };
    }),
  selectImportedEquipo: (id) => set({ selectedImportedEquipoId: id, selectedEquipId: null, selectedTrayId: null, selectedSupportId: null }),

  placeImportedEquipo: (equipoId, positionMm) => {
    const s = get();
    const catalog = s.importedCatalog;
    if (!catalog) return null;
    const equipo = catalog.equipos.find((e) => e.equipoId === equipoId);
    if (!equipo) return null;

    // Si ya existe un elemento vinculado a este equipoId, seleccionarlo (no duplicar).
    const existing = s.elements.find(
      (e) => e.importedRef?.equipoId === equipoId || e.id === equipoId,
    );
    if (existing) {
      set({
        selectedEquipId: existing.id,
        selectedImportedEquipoId: null,
        selectedTrayId: null,
        selectedSupportId: null,
      });
      return existing.id;
    }

    const el = buildElementFromImported(equipo, {
      libroId: catalog.meta.fileHash,
      positionMm,
    });
    set({
      equipHistory: pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:  [],
      elements:     [...s.elements, el],
      selectedEquipId: el.id,
      selectedImportedEquipoId: null,
      selectedTrayId: null,
      selectedSupportId: null,
      dirty: true,
    });
    return el.id;
  },

  linkImportedToElement: (elementId, equipoId) => {
    const s = get();
    const catalog = s.importedCatalog;
    if (!catalog) return;
    const equipo = catalog.equipos.find((e) => e.equipoId === equipoId);
    if (!equipo) return;
    const libroId = catalog.meta.fileHash;

    const updated = s.elements.map((e) => {
      // Rompe vínculo previo con el mismo equipoId para evitar dos elementos
      // apuntando al mismo registro importado.
      if (e.id !== elementId && e.importedRef?.equipoId === equipoId) {
        return { ...e, importedRef: null };
      }
      if (e.id === elementId) {
        return { ...e, importedRef: { equipoId, libroId } };
      }
      return e;
    });
    set({
      equipHistory: pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:  [],
      elements:     updated,
      dirty:        true,
    });
  },

  unlinkElement: (elementId) => {
    set((s) => ({
      equipHistory: pushEquipHistory(s.equipHistory, s.elements),
      equipFuture:  [],
      elements:     s.elements.map((e) =>
        e.id === elementId ? { ...e, importedRef: null } : e,
      ),
      dirty:        true,
    }));
  },
}));
