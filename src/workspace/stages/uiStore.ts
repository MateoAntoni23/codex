/**
 * uiStore — estado de interfaz que NO es parte del proyecto:
 *   - etapa activa (en memoria; se puede abrir una etapa con `?etapa=`),
 *   - tema claro/oscuro (preferencia por navegador en localStorage
 *     `codex:ui:theme`; nunca viaja en el archivo de proyecto),
 *   - herramienta activa de cada etapa.
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
export type BandejasTool = 'seleccionar' | 'continuar' | 'tramo' | 'unir' | 'soporte';

interface UiState {
  stage: StageId;
  theme: Theme;
  bandejasTool: BandejasTool;
  setStage: (s: StageId) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setBandejasTool: (t: BandejasTool) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  stage: initialStage(),
  theme: typeof localStorage === 'undefined' ? 'dark' : readTheme(),
  bandejasTool: 'seleccionar',
  setStage: (stage) => set({ stage }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // sin almacenamiento: el tema vale sólo para esta sesión
    }
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setBandejasTool: (bandejasTool) => set({ bandejasTool }),
}));

/** `?dev=1` muestra el menú de desarrollo (acciones de prueba). */
export function isDevMenuEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dev') === '1';
}
