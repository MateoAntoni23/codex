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
import {
  defaultAporteForMaster,
  isAporteRule,
  type AporteRule,
} from './aporteTrazado';
import { findMasterForProduct, type MasterModel } from './masterModels';

const STORAGE_KEY = 'codex:catalogConfig:v1';

interface Persisted {
  version: 'codex:catalogConfig/1';
  overrides: Record<string, ProductPortMapping>;
  /** Aprobaciones por producto; ausente en archivos antiguos → sin aprobaciones. */
  approvals?: Record<string, PatternApproval>;
  /**
   * Aporte al trazado por producto (configuración persistente — ver
   * `aporteTrazado.ts`). Ausente en archivos antiguos → se usa el default
   * derivado del maestro.
   */
  aporteOverrides?: Record<string, AporteRule>;
  savedAt: string;
}

interface PersistedRead {
  overrides: Record<string, ProductPortMapping>;
  approvals: Record<string, PatternApproval>;
  aporteOverrides: Record<string, AporteRule>;
}

function sanitizeAporteOverrides(raw: unknown): Record<string, AporteRule> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, AporteRule> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isAporteRule(v)) out[k] = v;
  }
  return out;
}

function readStorage(): PersistedRead {
  if (typeof localStorage === 'undefined') {
    return { overrides: {}, approvals: {}, aporteOverrides: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { overrides: {}, approvals: {}, aporteOverrides: {} };
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.version !== 'codex:catalogConfig/1') {
      return { overrides: {}, approvals: {}, aporteOverrides: {} };
    }
    return {
      overrides: parsed.overrides ?? {},
      approvals: parsed.approvals ?? {},
      aporteOverrides: sanitizeAporteOverrides(parsed.aporteOverrides),
    };
  } catch {
    return { overrides: {}, approvals: {}, aporteOverrides: {} };
  }
}

function writeStorage(
  overrides: Record<string, ProductPortMapping>,
  approvals: Record<string, PatternApproval>,
  aporteOverrides: Record<string, AporteRule>,
): void {
  if (typeof localStorage === 'undefined') return;
  const payload: Persisted = {
    version: 'codex:catalogConfig/1',
    overrides,
    approvals,
    aporteOverrides,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or unavailable — not fatal; next export/save captures it
  }
}

/**
 * Resultado efectivo del aporte al trazado: la regla a aplicar más la
 * procedencia (default derivado del maestro vs override explícito del
 * usuario). Se usa para mostrar en UI "default" vs "override", y para
 * registrar la regla activa en export/import sin ambigüedad.
 */
export interface EffectiveAporte {
  readonly rule: AporteRule;
  readonly source: 'default' | 'override';
}

interface State {
  overrides: Readonly<Record<string, ProductPortMapping>>;
  approvals: Readonly<Record<string, PatternApproval>>;
  aporteOverrides: Readonly<Record<string, AporteRule>>;
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
  /**
   * Define o reemplaza la regla de aporte al trazado para un producto.
   *
   * ⚠️  Configuración persistente — NO integrada al cómputo real todavía. Ver
   * `aporteTrazado.ts`.
   */
  upsertAporte: (productId: string, rule: AporteRule) => void;
  /** Elimina el override de aporte para un producto (vuelve al default). */
  removeAporte: (productId: string) => void;
  /** Reemplaza todos los overrides de aporte (usar para import). */
  replaceAporteOverrides: (aporteOverrides: Record<string, AporteRule>) => void;
  /**
   * Devuelve la regla de aporte efectiva para un producto + maestro. Si no hay
   * override persistido, deriva el default desde `defaultAporteForMaster`.
   */
  getEffectiveAporte: (
    productId: string,
    master: MasterModel | null,
  ) => EffectiveAporte | null;
  /** Serializa a JSON portable (overrides + approvals + aporteOverrides). */
  serialize: () => string;
}

export const useCatalogConfigStore = create<State>((set, get) => ({
  overrides: {},
  approvals: {},
  aporteOverrides: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const { overrides, approvals, aporteOverrides } = readStorage();
    setPortMappingOverrides(overrides);
    set({ overrides, approvals, aporteOverrides, hydrated: true });
  },
  upsertOverride: (productId, mapping) => {
    const next = { ...get().overrides, [productId]: mapping };
    setPortMappingOverrides(next);
    writeStorage(next, get().approvals, get().aporteOverrides);
    set({ overrides: next });
  },
  removeOverride: (productId) => {
    const next = { ...get().overrides };
    delete next[productId];
    setPortMappingOverrides(next);
    writeStorage(next, get().approvals, get().aporteOverrides);
    set({ overrides: next });
  },
  replaceAll: (overrides) => {
    setPortMappingOverrides(overrides);
    writeStorage(overrides, get().approvals, get().aporteOverrides);
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
    writeStorage(get().overrides, nextApprovals, get().aporteOverrides);
    set({ approvals: nextApprovals });
  },
  revokeApproval: (productId) => {
    if (!(productId in get().approvals)) return;
    const next = { ...get().approvals };
    delete next[productId];
    writeStorage(get().overrides, next, get().aporteOverrides);
    set({ approvals: next });
  },
  replaceApprovals: (approvals) => {
    writeStorage(get().overrides, approvals, get().aporteOverrides);
    set({ approvals });
  },
  getApprovalInfo: (productId, masterRevision) => {
    const approvals = get().approvals;
    let stored = approvals[productId];
    // Si no hay aprobación directa, buscamos una aprobación en un SKU que
    // comparta calibración efectiva: calibration hash igual ⇒ geometría +
    // bocas + marco iguales ⇒ aprobar uno vale para todos. Se recorren
    // alfabéticamente para que el resultado sea estable entre sesiones.
    const mapping = getEffectiveMapping(productId);
    const currentHash = calibrationHash(mapping);
    if (!stored) {
      const candidateIds = Object.keys(approvals).sort();
      for (const id of candidateIds) {
        if (id === productId) continue;
        const candidateApproval = approvals[id];
        if (candidateApproval.approvedAtCalibrationHash === currentHash) {
          stored = candidateApproval;
          break;
        }
      }
    }
    return computeApprovalInfo(stored, masterRevision, currentHash);
  },
  upsertAporte: (productId, rule) => {
    if (!isAporteRule(rule)) return;
    const next = { ...get().aporteOverrides, [productId]: rule };
    writeStorage(get().overrides, get().approvals, next);
    set({ aporteOverrides: next });
  },
  removeAporte: (productId) => {
    if (!(productId in get().aporteOverrides)) return;
    const next = { ...get().aporteOverrides };
    delete next[productId];
    writeStorage(get().overrides, get().approvals, next);
    set({ aporteOverrides: next });
  },
  replaceAporteOverrides: (aporteOverrides) => {
    const sanitized = sanitizeAporteOverrides(aporteOverrides);
    writeStorage(get().overrides, get().approvals, sanitized);
    set({ aporteOverrides: sanitized });
  },
  getEffectiveAporte: (productId, master) => {
    const override = get().aporteOverrides[productId];
    if (override) return { rule: override, source: 'override' };
    if (!master) return null;
    return { rule: defaultAporteForMaster(master), source: 'default' };
  },
  serialize: () => {
    const payload: Persisted = {
      version: 'codex:catalogConfig/1',
      overrides: get().overrides,
      approvals: get().approvals,
      aporteOverrides: get().aporteOverrides,
      savedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  },
}));

// `findMasterForProduct` is re-exported here only to signal it is part of the
// public store surface — the UI can derive the effective aporte in one call
// without duplicating the master-resolution logic.
export { findMasterForProduct };
