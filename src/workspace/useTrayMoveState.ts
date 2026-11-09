// Estado efímero del movimiento de bandeja: snapshot pre-drag + conexiones que
// se romperían al confirmar. Vive aparte del workspace store para no acoplar
// el modelo de bandejas (TrayInput) con el resto del store de workspace.
//
// Flujo esperado:
//   1. Al iniciar un drag, el componente de escena guarda `snapshot` (entrada
//      pre-drag) y mantiene el delta transitorio sobre `entrada` del tray store.
//   2. Al soltar, computa `brokenConexionIds` sobre el post-drag.
//   3. Si NO hay rotas: commit silencioso llamando a `commitMove(snapshot)` —
//      pushea snapshot al history del tray store y mantiene el post-drag.
//   4. Si hay rotas: `requestConfirm(detail)` — el modal del inspector decide:
//      - `resolveAccept()`: commit + remueve conexiones rotas (una entrada
//        atómica en history que abarca move + disconnect).
//      - `resolveCancel()`: restaura snapshot (no toca history).

import { create } from 'zustand';
import type { TrayInput } from '../tray/model';

export interface PendingTrayMove {
  pieceId: string;
  /** Entrada previa al drag — restaurar aquí al cancelar. */
  snapshot: TrayInput;
  /** IDs de conexiones cuyas bocas ya no coinciden tras el drag. */
  brokenConexionIds: string[];
}

interface State {
  pending: PendingTrayMove | null;
  /** Pide confirmación al usuario cuando el drag deja uniones rotas. */
  requestConfirm: (detail: PendingTrayMove) => void;
  /** Limpia el estado — llamado por los handlers del modal tras resolver. */
  clear: () => void;
}

export const useTrayMoveState = create<State>((set) => ({
  pending: null,
  requestConfirm: (detail) => set({ pending: detail }),
  clear: () => set({ pending: null }),
}));
