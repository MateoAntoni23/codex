/**
 * Estado de la parte civil (archivos importados) y de la importación en curso.
 *
 * Es parte del PROYECTO (se autoguarda y viaja en la copia, bloque `parteCivil`),
 * pero vive fuera del trazado (`trayStore.entrada`): así nunca llega al motor.
 */
import { create } from 'zustand';
import type { ArchivoCivil, EjeVertical, MallaCivil, NivelCivil, TipoCivil } from './modelo';

/** Importación esperando que el operador declare tipo y nivel y confirme. */
export interface ImportacionPendiente {
  readonly modo: 'nuevo' | 'reemplazar';
  /** Archivo que se reemplaza (modo 'reemplazar'). */
  readonly reemplazaId?: string;
  readonly nombreArchivo: string;
  readonly malla: MallaCivil;
  readonly tipo: TipoCivil | null;
  readonly nivel: { readonly nombre: string; readonly cotaMm: number | null };
  readonly ejeVertical: EjeVertical;
}

interface ParteCivilState {
  archivos: ArchivoCivil[];
  seleccionado: string | null;
  convirtiendo: string | null;
  error: string | null;
  pendiente: ImportacionPendiente | null;

  /** Reemplaza todo (al abrir o restaurar un proyecto). */
  cargar(archivos: readonly ArchivoCivil[]): void;
  seleccionar(id: string | null): void;
  setConvirtiendo(nombre: string | null): void;
  setError(error: string | null): void;
  setPendiente(p: ImportacionPendiente | null): void;
  editarPendiente(patch: Partial<Pick<ImportacionPendiente, 'tipo' | 'ejeVertical'>> & { nivel?: Partial<ImportacionPendiente['nivel']> }): void;
  /** Confirma la importación pendiente. Devuelve el id del archivo agregado o reemplazado. */
  confirmarPendiente(): string | null;
  actualizar(id: string, patch: Partial<Pick<ArchivoCivil, 'desplazamientoMm' | 'giroDeg' | 'nivel' | 'tipo' | 'ejeVertical'>>): void;
  quitar(id: string): void;
}

const nuevoId = () => `civ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useParteCivilStore = create<ParteCivilState>((set, get) => ({
  archivos: [],
  seleccionado: null,
  convirtiendo: null,
  error: null,
  pendiente: null,

  cargar: (archivos) => set({ archivos: [...archivos], seleccionado: null, pendiente: null, error: null, convirtiendo: null }),
  seleccionar: (id) => set({ seleccionado: id }),
  setConvirtiendo: (nombre) => set({ convirtiendo: nombre }),
  setError: (error) => set({ error }),
  setPendiente: (pendiente) => set({ pendiente, error: null }),
  editarPendiente: (patch) => {
    const p = get().pendiente;
    if (!p) return;
    set({ pendiente: { ...p, ...('tipo' in patch ? { tipo: patch.tipo ?? null } : {}), ...(patch.ejeVertical ? { ejeVertical: patch.ejeVertical } : {}), nivel: { ...p.nivel, ...(patch.nivel ?? {}) } } });
  },
  confirmarPendiente: () => {
    const p = get().pendiente;
    if (!p || !p.tipo || !p.nivel.nombre.trim() || p.nivel.cotaMm === null || !Number.isFinite(p.nivel.cotaMm)) return null;
    const nivel: NivelCivil = { nombre: p.nivel.nombre.trim(), cotaMm: p.nivel.cotaMm };
    const ahora = new Date().toISOString();
    if (p.modo === 'reemplazar' && p.reemplazaId) {
      const id = p.reemplazaId;
      // Reemplazar conserva tipo, nivel y posición (desplazamiento, giro y eje): sólo cambia la malla.
      set({
        archivos: get().archivos.map((a) => (a.id === id ? { ...a, nombre: p.nombreArchivo, malla: p.malla, importadoEn: ahora, version: a.version + 1 } : a)),
        pendiente: null, seleccionado: id,
      });
      return id;
    }
    const a: ArchivoCivil = {
      id: nuevoId(), nombre: p.nombreArchivo, tipo: p.tipo, nivel, ejeVertical: p.ejeVertical,
      desplazamientoMm: [0, 0, 0], giroDeg: 0, malla: p.malla, importadoEn: ahora, version: 1,
    };
    set({ archivos: [...get().archivos, a], pendiente: null, seleccionado: a.id });
    return a.id;
  },
  actualizar: (id, patch) => set({ archivos: get().archivos.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
  quitar: (id) => set({ archivos: get().archivos.filter((a) => a.id !== id), seleccionado: get().seleccionado === id ? null : get().seleccionado }),
}));

/** Triángulos de toda la parte civil cargada. */
export function triangulosCiviles(archivos: readonly ArchivoCivil[]): number {
  return archivos.reduce((s, a) => s + a.malla.triangulos, 0);
}
