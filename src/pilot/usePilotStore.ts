/**
 * usePilotStore.ts — estado local de la vista de prueba de geometría piloto.
 *
 * No persiste. No se comparte con el store principal: el objetivo es aislar
 * la geometría experimental y permitir que el auditor explore selección y
 * giro/traslación sin afectar proyectos existentes.
 */

import { create } from 'zustand';
import { PILOT_PIECE_IDS } from './pilotAdapter';
import { wrapYaw, YAW_STEPS_RAD } from './pilotGeometry';
import type { Placement } from './pilotGeometry';
import type { PiezaId, Vec3 } from './types';

/**
 * Posición inicial de cada pieza en el mundo de la vista (mm, Z-up).
 * Separación suficiente para que recto (3m) + ramas de T (≈1.2m) no colisionen.
 * El usuario puede trasladar cada pieza con los botones del inspector; "Reset"
 * devuelve a esta posición.
 */
export const INITIAL_LAYOUT_MM: Record<PiezaId, Vec3> = {
  recto:     [0,     0,    0],
  reduccion: [0,     2000, 0],
  te:        [0,    -2500, 0],
  curva_90:  [4000, -1500, 0],
};

export type BocaKey = 'P1' | 'P2' | 'P3';

interface Selection {
  readonly pieceId: PiezaId;
  readonly boca: BocaKey | null;
}

interface PilotState {
  readonly selection: Selection | null;
  readonly placements: Record<PiezaId, Placement>;
  selectPiece(pieceId: PiezaId): void;
  selectBoca(pieceId: PiezaId, boca: BocaKey): void;
  clearSelection(): void;
  rotateStep(pieceId: PiezaId): void;
  translate(pieceId: PiezaId, deltaMm: Vec3): void;
  resetPlacement(pieceId: PiezaId): void;
  resetAll(): void;
}

function initialPlacements(): Record<PiezaId, Placement> {
  const r: Partial<Record<PiezaId, Placement>> = {};
  for (const id of PILOT_PIECE_IDS) {
    r[id] = { offsetMm: INITIAL_LAYOUT_MM[id], yawRad: 0 };
  }
  return r as Record<PiezaId, Placement>;
}

export const usePilotStore = create<PilotState>((set, get) => ({
  selection: null,
  placements: initialPlacements(),

  selectPiece(pieceId) {
    set({ selection: { pieceId, boca: null } });
  },

  selectBoca(pieceId, boca) {
    set({ selection: { pieceId, boca } });
  },

  clearSelection() {
    set({ selection: null });
  },

  rotateStep(pieceId) {
    const curr = get().placements[pieceId];
    const idx = YAW_STEPS_RAD.findIndex((y) => Math.abs(wrapYaw(curr.yawRad) - y) < 1e-6);
    const next = YAW_STEPS_RAD[(idx + 1) % YAW_STEPS_RAD.length];
    set((s) => ({
      placements: { ...s.placements, [pieceId]: { ...curr, yawRad: next } },
    }));
  },

  translate(pieceId, deltaMm) {
    set((s) => {
      const curr = s.placements[pieceId];
      const off: Vec3 = [
        curr.offsetMm[0] + deltaMm[0],
        curr.offsetMm[1] + deltaMm[1],
        curr.offsetMm[2] + deltaMm[2],
      ];
      return { placements: { ...s.placements, [pieceId]: { ...curr, offsetMm: off } } };
    });
  },

  resetPlacement(pieceId) {
    set((s) => ({
      placements: {
        ...s.placements,
        [pieceId]: { offsetMm: INITIAL_LAYOUT_MM[pieceId], yawRad: 0 },
      },
    }));
  },

  resetAll() {
    set({ selection: null, placements: initialPlacements() });
  },
}));
