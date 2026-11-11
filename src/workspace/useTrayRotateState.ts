// B-4 — estado de la herramienta "Rotar tramo": pivote, eje y ángulo (el último
// aplicado o el que se está arrastrando), y si el giro es libre (tecla Shift).
// La confirmación de uniones que dejarían de cumplir reutiliza useTrayMoveState
// (el mismo aviso que al mover).
import { create } from 'zustand';
import type { EjeMundo, PivoteRotacion } from './trayRotation';

interface State {
  pivote: PivoteRotacion;
  eje: EjeMundo;
  /** Ángulo en grados: el del arrastre en curso o el último aplicado; editable. */
  anguloDeg: number;
  /** Shift apretado: sin paso de 15°. */
  libre: boolean;
  setPivote: (p: PivoteRotacion) => void;
  setEje: (e: EjeMundo) => void;
  setAngulo: (deg: number) => void;
  setLibre: (on: boolean) => void;
  reset: () => void;
}

export const useTrayRotateState = create<State>((set) => ({
  pivote: 'centro',
  eje: 'Z',
  anguloDeg: 0,
  libre: false,
  setPivote: (pivote) => set({ pivote }),
  setEje: (eje) => set({ eje }),
  setAngulo: (anguloDeg) => set({ anguloDeg }),
  setLibre: (libre) => set({ libre }),
  reset: () => set({ pivote: 'centro', eje: 'Z', anguloDeg: 0, libre: false }),
}));
