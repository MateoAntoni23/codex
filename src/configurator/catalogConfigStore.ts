/**
 * catalogConfigStore — estado persistente del Configurador de biblioteca.
 *
 * Qué persiste (y dónde):
 *   - `overrides`: Record<producto_id, ProductPortMapping> con overrides
 *     declarados desde el Configurador. Es el dato "del proyecto" que debe
 *     llegar al workspace, al preview y al motor Python.
 *
 * Capas de persistencia:
 *   1. Memoria del store (fuente de verdad durante la sesión).
 *   2. localStorage key `codex:catalogConfig:v1` — para que un reload
 *      recupere lo guardado sin bajar un archivo.
 *   3. Export/import de archivo JSON — único mecanismo portable entre
 *      computadoras (tarea #90). Firma: `codex:catalogConfig/1`.
 *
 * Sincronización con el motor:
 *   Cada vez que `overrides` cambia, el store llama a
 *   `setPortMappingOverrides(...)` para que routingRules (TS) y
 *   toMotorEntrada (motor payload) usen el mapping nuevo inmediatamente.
 *   El workspace NO necesita hacer nada: la lectura es side-effect free y
 *   se hace en cada compat lookup.
 *
 * NO persiste aquí:
 *   - Selección de producto, pestaña activa, filtros de UI — eso es local
 *     del componente.
 *   - Geometría de recetas o dimensiones — viven en el catálogo del motor.
 *
 * Diseño de API: inmutable por fuera, dos únicas mutaciones:
 *   - `upsertOverride(productId, mapping)` — reemplaza un override completo.
 *   - `removeOverride(productId)` — vuelve al default declarado.
 */
import { create } from 'zustand';
import {
  setPortMappingOverrides,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';

const STORAGE_KEY = 'codex:catalogConfig:v1';

interface Persisted {
  version: 'codex:catalogConfig/1';
  overrides: Record<string, ProductPortMapping>;
  savedAt: string;
}

function readStorage(): Record<string, ProductPortMapping> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.version !== 'codex:catalogConfig/1') return {};
    return parsed.overrides ?? {};
  } catch {
    return {};
  }
}

function writeStorage(overrides: Record<string, ProductPortMapping>): void {
  if (typeof localStorage === 'undefined') return;
  const payload: Persisted = {
    version: 'codex:catalogConfig/1',
    overrides,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or unavailable — not fatal; next export/save captures it
  }
}

interface State {
  overrides: Readonly<Record<string, ProductPortMapping>>;
  hydrated: boolean;
  /** Carga desde localStorage y sincroniza con el motor. Idempotente. */
  hydrate: () => void;
  /** Define o reemplaza un override para un producto. */
  upsertOverride: (productId: string, mapping: ProductPortMapping) => void;
  /** Elimina un override — el producto vuelve al default. */
  removeOverride: (productId: string) => void;
  /** Reemplaza todos los overrides (usar para import de archivo). */
  replaceAll: (overrides: Record<string, ProductPortMapping>) => void;
  /** Serializa a JSON portable (tarea #90 completará export/import de UI). */
  serialize: () => string;
}

export const useCatalogConfigStore = create<State>((set, get) => ({
  overrides: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const overrides = readStorage();
    setPortMappingOverrides(overrides);
    set({ overrides, hydrated: true });
  },
  upsertOverride: (productId, mapping) => {
    const next = { ...get().overrides, [productId]: mapping };
    setPortMappingOverrides(next);
    writeStorage(next);
    set({ overrides: next });
  },
  removeOverride: (productId) => {
    const next = { ...get().overrides };
    delete next[productId];
    setPortMappingOverrides(next);
    writeStorage(next);
    set({ overrides: next });
  },
  replaceAll: (overrides) => {
    setPortMappingOverrides(overrides);
    writeStorage(overrides);
    set({ overrides });
  },
  serialize: () => {
    const payload: Persisted = {
      version: 'codex:catalogConfig/1',
      overrides: get().overrides,
      savedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  },
}));
