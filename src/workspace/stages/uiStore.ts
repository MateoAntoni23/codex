/**
 * uiStore — estado de interfaz que NO es parte del proyecto:
 *   - etapa activa (en memoria; se puede abrir una etapa con `?etapa=`),
 *   - tema claro/oscuro (preferencia por navegador en localStorage
 *     `codex:ui:theme`; nunca viaja en el archivo de proyecto),
 *   - herramienta activa de cada etapa,
 *   - el formulario abierto en el inspector (interfaz, 2026-11-14: los formularios
 *     viven en el inspector, no en el panel izquierdo),
 *   - el panel inferior (tablas anchas) y su pestaña.
 */
import { create } from 'zustand';
import { isStageId, type StageId } from './stageModel';

export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'codex:ui:theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function initialStage(): StageId {
  if (typeof window === 'undefined') return 'equipos';
  const v = new URLSearchParams(window.location.search).get('etapa');
  return isStageId(v) ? v : 'equipos';
}

export type EquiposTool = 'seleccionar' | 'ubicar' | 'mover' | 'rotar';
export type BandejasTool = 'seleccionar' | 'continuar' | 'tramo' | 'unir' | 'soporte' | 'derivacion';

/** Formulario abierto en el inspector. Los que nacen de una pieza traen esa pieza ya elegida. */
export type Formulario =
  | { readonly tipo: 'tramo' }
  | { readonly tipo: 'soporte' }
  | { readonly tipo: 'derivacion'; readonly tronco?: string }
  | { readonly tipo: 'enlace'; readonly tronco?: string; readonly equipo?: string }
  | { readonly tipo: 'circuito' }
  | { readonly tipo: 'medir'; readonly origen?: { readonly pieza: string; readonly boca: string } }
  | { readonly tipo: 'equipo-nuevo' };

export type PestanaInferior = 'circuitos' | 'computo' | 'motor' | 'avisos';

interface UiState {
  stage: StageId;
  theme: Theme;
  bandejasTool: BandejasTool;
  formulario: Formulario | null;
  panelInferior: boolean;
  pestanaInferior: PestanaInferior;
  setStage: (s: StageId) => void;
  abrirFormulario: (f: Formulario | null) => void;
  setPanelInferior: (abierto: boolean) => void;
  verPestana: (p: PestanaInferior) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setBandejasTool: (t: BandejasTool) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  stage: initialStage(),
  theme: typeof localStorage === 'undefined' ? 'dark' : readTheme(),
  bandejasTool: 'seleccionar',
  formulario: null,
  panelInferior: initialStage() === 'resultados',
  pestanaInferior: 'circuitos',
  // Cambiar de etapa cierra el formulario; Resultados abre el panel inferior.
  setStage: (stage) => set({ stage, formulario: null, ...(stage === 'resultados' ? { panelInferior: true } : {}) }),
  abrirFormulario: (formulario) => {
    const tool = formulario && (formulario.tipo === 'tramo' || formulario.tipo === 'soporte' || formulario.tipo === 'derivacion') ? formulario.tipo : 'seleccionar';
    set({ formulario, bandejasTool: tool });
  },
  setPanelInferior: (panelInferior) => set({ panelInferior }),
  verPestana: (pestanaInferior) => set({ pestanaInferior, panelInferior: true }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // sin almacenamiento: el tema vale sólo para esta sesión
    }
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  // Las herramientas de formulario (tramo, soporte, derivación) abren su formulario en el inspector.
  setBandejasTool: (bandejasTool) => set({
    bandejasTool,
    formulario: bandejasTool === 'tramo' || bandejasTool === 'soporte' || bandejasTool === 'derivacion' ? { tipo: bandejasTool } : null,
  }),
}));

/** `?dev=1` muestra el menú de desarrollo (acciones de prueba). */
export function isDevMenuEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dev') === '1';
}
