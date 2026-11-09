import { create } from 'zustand';
import type { Point3 } from './routingRules';

export type RoutingStep = 'selectingPort' | 'configuringSegment' | 'confirmingReduction';

export interface StartPort {
  pieceId: string;
  portName: string;
  pos: Point3;
  dir: Point3;
  /**
   * Eje "arriba de sección" en mundo propagado del FreePort seleccionado.
   * Necesario para que planAddSegment/Curve/Accessory armen el marco del
   * puerto cuando la continuación es vertical (p.ej. salida de CUPS).
   */
  sectionUp?: Point3;
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

  /** Turn direction for horizontal curve insertion. */
  turnDirection: 'left' | 'right';

  /**
   * Para accesorios con 3+ bocas (TPS, XPS, CUPS) — nombre del puerto de la
   * pieza nueva por el que entra la conexión con el puerto origen. En
   * rectos/curvas (2 puertos) se ignora y se asume 'P1'.
   */
  entryPortName: string | null;

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
  setTurnDirection(dir: 'left' | 'right'): void;
  setEntryPortName(name: string | null): void;
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
  turnDirection: 'left',
  entryPortName: null,

  activate: () =>
    set({ active: true, step: 'selectingPort', startPort: null, hoveredPieceId: null, selectedProductId: '', entryPortName: null }),

  deactivate: () =>
    set({
      active: false,
      step: 'selectingPort',
      startPort: null,
      hoveredPieceId: null,
      reductionProductId: null,
      reductionPortToExisting: '',
      entryPortName: null,
    }),

  hoverPiece: (id) => set({ hoveredPieceId: id }),

  // Al seleccionar un puerto de arranque, blanquear `selectedProductId` para
  // que el usuario elija explícitamente la continuación (antes se
  // preseleccionaba el producto de la pieza origen, lo que provocaba un
  // preview con la forma de la pieza origen incluso cuando el inspector
  // mostraba otro SKU: ver fix stale-preview y routingPreviewSwap spec).
  selectStartPort: (port) => set({ startPort: port, step: 'configuringSegment', selectedProductId: '', entryPortName: null }),

  setProduct: (id) => set({ selectedProductId: id, entryPortName: null }),

  setLength: (mm) => set({ previewLengthMm: mm }),

  toggleSnap: () => set((s) => ({ snapToAxis: !s.snapToAxis })),

  proceedToReduction: () => set({ step: 'confirmingReduction', reductionProductId: null }),

  setReductionProduct: (id) => set({ reductionProductId: id }),

  setReductionLength: (mm) => set({ reductionLengthMm: mm }),

  setReductionPortToExisting: (port) => set({ reductionPortToExisting: port }),

  setTurnDirection: (dir) => set({ turnDirection: dir }),

  setEntryPortName: (name) => set({ entryPortName: name }),

  back: () =>
    set((s) => {
      if (s.step === 'confirmingReduction') {
        return { step: 'configuringSegment' as RoutingStep };
      }
      return { step: 'selectingPort' as RoutingStep, startPort: null, selectedProductId: '', entryPortName: null };
    }),
}));
