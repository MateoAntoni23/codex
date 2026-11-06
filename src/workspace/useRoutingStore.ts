import { create } from 'zustand';
import type { Point3 } from './routingRules';

export type RoutingStep = 'selectingPort' | 'configuringSegment' | 'confirmingReduction';

export interface StartPort {
  pieceId: string;
  portName: string;
  pos: Point3;
  dir: Point3;
}

export interface RoutingState {
  active: boolean;
  step: RoutingStep;
  hoveredPieceId: string | null;
  startPort: StartPort | null;

  /** producto_id of the new straight piece */
  selectedProductId: string;
  previewLengthMm: number;
  snapToAxis: boolean;

  /** producto_id of the chosen reduction (only used in confirmingReduction step) */
  reductionProductId: string | null;
  reductionLengthMm: number;
  /** Which port of the chosen reduction connects to the existing piece ('P1' or 'P2') */
  reductionPortToExisting: string;

  activate(): void;
  deactivate(): void;
  hoverPiece(id: string | null): void;
  selectStartPort(port: StartPort): void;
  setProduct(id: string): void;
  setLength(mm: number): void;
  toggleSnap(): void;
  proceedToReduction(): void;
  setReductionProduct(id: string): void;
  setReductionLength(mm: number): void;
  setReductionPortToExisting(port: string): void;
  back(): void;
}

export const useRoutingStore = create<RoutingState>((set) => ({
  active: false,
  step: 'selectingPort',
  hoveredPieceId: null,
  startPort: null,
  selectedProductId: '',
  previewLengthMm: 3000,
  snapToAxis: false,
  reductionProductId: null,
  reductionLengthMm: 300,
  reductionPortToExisting: '',

  activate: () =>
    set({ active: true, step: 'selectingPort', startPort: null, hoveredPieceId: null, selectedProductId: '' }),

  deactivate: () =>
    set({
      active: false,
      step: 'selectingPort',
      startPort: null,
      hoveredPieceId: null,
      reductionProductId: null,
      reductionPortToExisting: '',
    }),

  hoverPiece: (id) => set({ hoveredPieceId: id }),

  selectStartPort: (port) => set({ startPort: port, step: 'configuringSegment' }),

  setProduct: (id) => set({ selectedProductId: id }),

  setLength: (mm) => set({ previewLengthMm: mm }),

  toggleSnap: () => set((s) => ({ snapToAxis: !s.snapToAxis })),

  proceedToReduction: () => set({ step: 'confirmingReduction', reductionProductId: null }),

  setReductionProduct: (id) => set({ reductionProductId: id }),

  setReductionLength: (mm) => set({ reductionLengthMm: mm }),

  setReductionPortToExisting: (port) => set({ reductionPortToExisting: port }),

  back: () =>
    set((s) => {
      if (s.step === 'confirmingReduction') {
        return { step: 'configuringSegment' as RoutingStep };
      }
      return { step: 'selectingPort' as RoutingStep, startPort: null, selectedProductId: '' };
    }),
}));
