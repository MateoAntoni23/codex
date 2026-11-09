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
  getEffectiveMapping,
  setPortMappingOverrides,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';
import { calibrationHash } from './patternIdentity';
import {
  computeApprovalInfo,
  type ApprovalInfo,
  type PatternApproval,
} from './patternApprovals';

const STORAGE_KEY = 'codex:catalogConfig:v1';

interface Persisted {
  version: 'codex:catalogConfig/1';
  overrides: Record<string, ProductPortMapping>;
  /** Aprobaciones por producto; ausente en archivos antiguos → sin aprobaciones. */
  approvals?: Record<string, PatternApproval>;
  savedAt: string;
}

interface PersistedRead {
  overrides: Record<string, ProductPortMapping>;
  approvals: Record<string, PatternApproval>;
}

function readStorage(): PersistedRead {
  if (typeof localStorage === 'undefined') return { overrides: {}, approvals: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { overrides: {}, approvals: {} };
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.version !== 'codex:catalogConfig/1') return { overrides: {}, approvals: {} };
    return {
      overrides: parsed.overrides ?? {},
      approvals: parsed.approvals ?? {},
    };
  } catch {
    return { overrides: {}, approvals: {} };
  }
}

function writeStorage(
  overrides: Record<string, ProductPortMapping>,
  approvals: Record<string, PatternApproval>,
): void {
  if (typeof localStorage === 'undefined') return;
  const payload: Persisted = {
    version: 'codex:catalogConfig/1',
    overrides,
    approvals,
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
  approvals: Readonly<Record<string, PatternApproval>>;
  hydrated: boolean;
  /** Carga desde localStorage y sincroniza con el motor. Idempotente. */
  hydrate: () => void;
  /** Define o reemplaza un override para un producto. */
  upsertOverride: (productId: string, mapping: ProductPortMapping) => void;
  /** Elimina un override — el producto vuelve al default. */
  removeOverride: (productId: string) => void;
  /** Reemplaza todos los overrides (usar para import de archivo). */
  replaceAll: (overrides: Record<string, ProductPortMapping>) => void;
  /**
   * Aprueba el patrón para `productId` fijando la revisión del maestro y el
   * hash de la calibración actual. Si no hay override, usa el default; igual
   * queda aprobado (la aprobación es independiente de que haya override).
   */
  approveProduct: (productId: string, masterRevision: number) => void;
  /** Revoca la aprobación de un producto (si existía). */
  revokeApproval: (productId: string) => void;
  /** Reemplaza todas las aprobaciones (usar para import de archivo). */
  replaceApprovals: (approvals: Record<string, PatternApproval>) => void;
  /**
   * Devuelve el estado efectivo de aprobación para un producto: 'none' si no
   * hay aprobación persistida; 'current' si coincide con la calibración y
   * revisión actuales; 'outdated' si cambió algo desde la aprobación.
   */
  getApprovalInfo: (productId: string, masterRevision: number | undefined) => ApprovalInfo;
  /** Serializa a JSON portable (overrides + approvals). */
  serialize: () => string;
}

export const useCatalogConfigStore = create<State>((set, get) => ({
  overrides: {},
  approvals: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const { overrides, approvals } = readStorage();
    setPortMappingOverrides(overrides);
    set({ overrides, approvals, hydrated: true });
  },
  upsertOverride: (productId, mapping) => {
    const next = { ...get().overrides, [productId]: mapping };
    setPortMappingOverrides(next);
    writeStorage(next, get().approvals);
    set({ overrides: next });
  },
  removeOverride: (productId) => {
    const next = { ...get().overrides };
    delete next[productId];
    setPortMappingOverrides(next);
    writeStorage(next, get().approvals);
    set({ overrides: next });
  },
  replaceAll: (overrides) => {
    setPortMappingOverrides(overrides);
    writeStorage(overrides, get().approvals);
    set({ overrides });
  },
  approveProduct: (productId, masterRevision) => {
    const mapping = getEffectiveMapping(productId);
    const approval: PatternApproval = {
      approvedAtRevision: masterRevision,
      approvedAtCalibrationHash: calibrationHash(mapping),
      approvedAt: new Date().toISOString(),
    };
    const nextApprovals = { ...get().approvals, [productId]: approval };
    writeStorage(get().overrides, nextApprovals);
    set({ approvals: nextApprovals });
  },
  revokeApproval: (productId) => {
    if (!(productId in get().approvals)) return;
    const next = { ...get().approvals };
    delete next[productId];
    writeStorage(get().overrides, next);
    set({ approvals: next });
  },
  replaceApprovals: (approvals) => {
    writeStorage(get().overrides, approvals);
    set({ approvals });
  },
  getApprovalInfo: (productId, masterRevision) => {
    const stored = get().approvals[productId];
    const mapping = getEffectiveMapping(productId);
    const currentHash = calibrationHash(mapping);
    return computeApprovalInfo(stored, masterRevision, currentHash);
  },
  serialize: () => {
    const payload: Persisted = {
      version: 'codex:catalogConfig/1',
      overrides: get().overrides,
      approvals: get().approvals,
      savedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  },
}));
