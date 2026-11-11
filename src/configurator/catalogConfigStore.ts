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
 *
 * B-2.5/B-2.6 — CALIBRACIÓN POR PATRÓN (formato v2):
 *   - La geometría de las bocas ya no vive en los overrides por SKU: es una
 *     corrección por boca del PATRÓN (`calibracion.patrones`) o una excepción
 *     explícita de una variante (`calibracion.excepciones`), ver
 *     `workspace/calibracionPatron.ts`. Los overrides quedan sólo con nombres.
 *   - Persistencia v2 en `codex:catalogConfig:v2` (`codex:catalogConfig/2`).
 *     Si sólo existe la v1, se carga tal cual y se MIGRA en segundo plano
 *     (necesita el catálogo); la clave v1 no se vuelve a escribir (es la copia
 *     del original) y además se guarda una copia fechada en
 *     `codex:catalogConfig:v1:backup:migracion-v2:<ISO>`.
 *   - `upsertOverride` con geometría (la API anterior) calibra el PATRÓN del
 *     producto: la corrección se deduce como en la migración.
 */
import { create } from 'zustand';
import {
  getEffectiveMapping,
  getProductIndexEntry,
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
import { cloneMapping } from './mappingDiff';
import type { Product } from '../tray/model';
import { loadStaticCatalog } from '../catalog/staticCatalog';
import { esVarianteMedida } from '../workspace/placement/calibrarReceta';
import {
  bibliotecaVacia,
  calibracionPara,
  esCorreccionNula,
  getBibliotecaCalibracion,
  setBibliotecaCalibracion,
  type CalibracionAplicable,
  type CorreccionBoca,
  type ExcepcionVariante,
} from '../workspace/calibracionPatron';
import { definicionEfectiva } from '../workspace/placement/definitions';
import { compararDefiniciones } from '../workspace/placement/geometriaEquivalente';
import type { StoredDefinition } from '../workspace/placement/placementCore';
import {
  definicionDeMappingAnterior,
  correccionesDeOverride,
  migrarBibliotecaPorSku,
  type BibliotecaMigrada,
  type InformeMigracion,
} from './migracionCalibracion';

const STORAGE_KEY = 'codex:catalogConfig:v1';
export const STORAGE_KEY_V2 = 'codex:catalogConfig:v2';
export const BACKUP_MIGRACION_PREFIX = 'codex:catalogConfig:v1:backup:migracion-v2:';

interface PersistedV2 {
  version: 'codex:catalogConfig/2';
  /** Overrides por SKU, SÓLO nombres de boca (la geometría está en `calibracion`). */
  overrides: Record<string, ProductPortMapping>;
  approvals?: Record<string, PatternApproval>;
  aporteOverrides?: Record<string, AporteRule>;
  calibracion: BibliotecaMigrada;
  /** Si vino de una v1: cuándo y dónde quedó la copia del original. */
  migradoDesdeV1?: { fecha: string; copia: string; informe: InformeMigracion };
  savedAt: string;
}

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

function readStorageV2(): PersistedV2 | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedV2;
    return parsed?.version === 'codex:catalogConfig/2' ? parsed : null;
  } catch {
    return null;
  }
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
): boolean {
  if (typeof localStorage === 'undefined') return false;
  // v2: la clave v1 no se vuelve a escribir (queda como copia del original).
  const prev = readStorageV2();
  const payload: PersistedV2 = {
    version: 'codex:catalogConfig/2',
    overrides,
    approvals,
    aporteOverrides,
    calibracion: getBibliotecaCalibracion() as BibliotecaMigrada,
    ...(prev?.migradoDesdeV1 ? { migradoDesdeV1: prev.migradoDesdeV1 } : {}),
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
    return true;
  } catch {
    // quota exceeded or unavailable — not fatal; next export/save captures it
    return false;
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
  /** Calibración por patrón y excepciones por variante (B-2.5). */
  calibracion: BibliotecaMigrada;
  /** Informe de la última migración desde la biblioteca por SKU (v1), si hubo. */
  informeMigracion: InformeMigracion | null;
  /** Define (o borra, con null) la corrección de una boca del patrón. */
  setCorreccionPatron: (patron: string, boca: string, correccion: CorreccionBoca | null, motivo?: string) => void;
  /** Declara (o borra, con null) la excepción de una variante; el motivo es obligatorio. */
  setExcepcion: (productoId: string, excepcion: ExcepcionVariante | null) => void;
  /** Reemplaza la biblioteca de calibración completa (import, adopción). */
  replaceCalibracion: (b: BibliotecaMigrada) => void;
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
   * Reemplaza la biblioteca (overrides + approvals + aporteOverrides) en una sola
   * escritura. Es la única vía por la que abrir un proyecto puede modificar la
   * biblioteca local, y sólo tras la elección explícita "adoptar" (ver
   * `libraryBlock.ts`). Con `partial` (archivo fileVersion 1) sólo se reemplazan
   * los overrides. Devuelve `false` si no pudo persistir en localStorage; en ese
   * caso el estado en memoria NO se modifica.
   */
  replaceLibrary: (
    lib: {
      overrides: Record<string, ProductPortMapping>;
      approvals?: Record<string, PatternApproval>;
      aporteOverrides?: Record<string, AporteRule>;
      /** B-2.5: si viene, reemplaza la calibración por patrón. */
      calibracion?: BibliotecaMigrada;
    },
    opts?: { partial?: boolean },
  ) => boolean;
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

const vaciaMigrada = (): BibliotecaMigrada => ({ ...bibliotecaVacia(), pendientes: {} });

/** Definición efectiva del producto para congelar en una aprobación. */
function definicionAprobable(productId: string): { approvedDefinicion?: StoredDefinition } {
  const product = productoDelIndice(productId);
  const d = product ? definicionEfectiva(product) : null;
  return d?.ok ? { approvedDefinicion: JSON.parse(JSON.stringify(d.def)) } : {};
}

/** Calibración de bocas que aplica hoy al producto (patrón o excepción). */
export function calibracionDelProducto(productId: string): CalibracionAplicable {
  const product = productoDelIndice(productId);
  const master = product ? findMasterForProduct(product as Record<string, unknown>) : null;
  if (!product || !master) return { origen: 'ninguna' };
  return calibracionPara(productId, master.id, esVarianteMedida(product, master));
}

/**
 * Huella de la calibración de un producto para las aprobaciones: nombres de
 * boca (mapping) + calibración de bocas que le aplica. B-2.5: la geometría ya
 * no está en el mapping, así que se suma la del patrón/excepción.
 */
export function huellaCalibracionProducto(productId: string, mapping: ProductPortMapping | null): string {
  const cal = calibracionDelProducto(productId);
  // Hash propio de la calibración (FNV-1a sobre su JSON). Antes se pasaba por
  // calibrationHash dentro de overrideReason, que ese hash no lee: la huella no
  // cambiaba al calibrar (defecto encontrado por aprobacionPorGeometria.test).
  const txt = JSON.stringify(cal);
  let h = 0x811c9dc5;
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${calibrationHash(mapping)}:${h.toString(16).padStart(8, '0')}`;
}

/** Producto (datos de catálogo) para deducir una corrección: índice sembrado. */
function productoDelIndice(productId: string): Product | null {
  const e = getProductIndexEntry(productId);
  return e ? ({ sku: productId.replace(/^SAM_/, ''), ...e, producto_id: productId } as unknown as Product) : null;
}

/**
 * Migra una biblioteca v1 (por SKU) a v2: deja la copia del original, escribe
 * la v2 y devuelve el resultado. Necesita el catálogo (asíncrono).
 */
export async function migrarBibliotecaV1(v1: {
  overrides: Record<string, ProductPortMapping>;
  approvals: Record<string, PatternApproval>;
  aporteOverrides: Record<string, AporteRule>;
}): Promise<{ biblioteca: BibliotecaMigrada; overrides: Record<string, ProductPortMapping>; informe: InformeMigracion }> {
  const cat = await loadStaticCatalog();
  const fecha = new Date().toISOString();
  const r = migrarBibliotecaPorSku(v1.overrides, cat.productos, fecha);
  if (typeof localStorage !== 'undefined') {
    try {
      const original = localStorage.getItem(STORAGE_KEY);
      const copia = `${BACKUP_MIGRACION_PREFIX}${fecha}`;
      if (original) localStorage.setItem(copia, original);
      const payload: PersistedV2 = {
        version: 'codex:catalogConfig/2',
        overrides: r.overridesNombres,
        approvals: v1.approvals,
        aporteOverrides: v1.aporteOverrides,
        calibracion: r.biblioteca,
        migradoDesdeV1: { fecha, copia, informe: r.informe },
        savedAt: fecha,
      };
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
    } catch {
      /* sin almacenamiento: queda en memoria */
    }
  }
  return { biblioteca: r.biblioteca, overrides: r.overridesNombres, informe: r.informe };
}

export const useCatalogConfigStore = create<State>((set, get) => ({
  overrides: {},
  calibracion: vaciaMigrada(),
  informeMigracion: null,
  approvals: {},
  aporteOverrides: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const v2 = readStorageV2();
    if (v2) {
      const calibracion = { ...vaciaMigrada(), ...v2.calibracion };
      setBibliotecaCalibracion(calibracion);
      setPortMappingOverrides(v2.overrides ?? {});
      set({
        overrides: v2.overrides ?? {},
        approvals: v2.approvals ?? {},
        aporteOverrides: sanitizeAporteOverrides(v2.aporteOverrides),
        calibracion,
        informeMigracion: v2.migradoDesdeV1?.informe ?? null,
        hydrated: true,
      });
      return;
    }
    const v1 = readStorage();
    setPortMappingOverrides(v1.overrides);
    set({ ...v1, hydrated: true });
    const conGeometria = Object.values(v1.overrides).some((o) => o.modelFrame || o.entries.some((e) => e.geometry));
    if (!conGeometria) return;
    // Biblioteca por SKU con geometría: se migra en segundo plano (necesita el catálogo).
    void migrarBibliotecaV1(v1).then((r) => {
      setBibliotecaCalibracion(r.biblioteca);
      setPortMappingOverrides(r.overrides);
      set({ overrides: r.overrides, calibracion: r.biblioteca, informeMigracion: r.informe });
    });
  },
  setCorreccionPatron: (patron, boca, correccion, motivo) => {
    const cal = get().calibracion;
    const prev = cal.patrones[patron] ?? { patron, bocas: {} };
    const bocas = { ...prev.bocas };
    if (correccion && !esCorreccionNula(correccion)) bocas[boca] = correccion;
    else delete bocas[boca];
    const patrones = { ...cal.patrones };
    if (Object.keys(bocas).length) patrones[patron] = { ...prev, bocas, ...(motivo ? { motivo } : {}), fecha: new Date().toISOString() };
    else delete patrones[patron];
    const next: BibliotecaMigrada = { ...cal, patrones };
    setBibliotecaCalibracion(next);
    set({ calibracion: next });
    writeStorage(get().overrides, get().approvals, get().aporteOverrides);
  },
  setExcepcion: (productoId, excepcion) => {
    if (excepcion && !excepcion.motivo.trim()) throw new Error('setExcepcion: la excepción de una variante necesita motivo');
    const cal = get().calibracion;
    const excepciones = { ...cal.excepciones };
    if (excepcion) excepciones[productoId] = excepcion;
    else delete excepciones[productoId];
    const next: BibliotecaMigrada = { ...cal, excepciones };
    setBibliotecaCalibracion(next);
    set({ calibracion: next });
    writeStorage(get().overrides, get().approvals, get().aporteOverrides);
  },
  replaceCalibracion: (b) => {
    const next = { ...vaciaMigrada(), ...b };
    setBibliotecaCalibracion(next);
    set({ calibracion: next });
    writeStorage(get().overrides, get().approvals, get().aporteOverrides);
  },
  upsertOverride: (productId, mapping) => {
    // API anterior: si trae geometría, calibra el PATRÓN del producto (B-2.5).
    const tieneGeo = !!mapping.modelFrame || mapping.entries.some((e) => e.geometry);
    let nombres = mapping;
    if (tieneGeo) {
      // La geometría sólo se quita del override si se convirtió a corrección del
      // patrón. Si no se puede, el override queda INTACTO y se registra como
      // pendiente con su motivo: nunca se descarta una calibración en silencio.
      const product = productoDelIndice(productId);
      const master = product ? findMasterForProduct(product as Record<string, unknown>) : null;
      const corr = product && master ? correccionesDeOverride(product, mapping) : null;
      if (!corr || 'motivo' in corr) {
        const motivo = !product
          ? 'el producto no está en el índice de catálogo sembrado'
          : !master ? 'el producto no corresponde a ningún patrón' : String((corr as { motivo: string }).motivo);
        const cal = get().calibracion;
        const next: BibliotecaMigrada = { ...cal, pendientes: { ...cal.pendientes, [productId]: { productoId: productId, motivo, original: mapping } } };
        setBibliotecaCalibracion(next);
        set({ calibracion: next });
        console.warn(`[catalogConfigStore] calibración de ${productId} sin convertir a patrón: ${motivo}. Se conserva el override tal cual.`);
      } else if (master) {
        {
          const cal = get().calibracion;
          const bocas = corr as Record<string, CorreccionBoca>;
          const patrones = { ...cal.patrones };
          if (Object.keys(bocas).length) {
            patrones[master.id] = {
              patron: master.id,
              bocas,
              ...(mapping.overrideReason ? { motivo: mapping.overrideReason } : {}),
              fecha: new Date().toISOString(),
            };
          } else delete patrones[master.id];
          const pendientes = { ...cal.pendientes };
          delete pendientes[productId];
          const next: BibliotecaMigrada = { ...cal, patrones, pendientes };
          setBibliotecaCalibracion(next);
          set({ calibracion: next });
        }
        const { modelFrame: _mf, ...rest } = mapping;
        nombres = { ...rest, entries: mapping.entries.map(({ geometry: _g, ...e }) => e) };
      }
    }
    const next = { ...get().overrides, [productId]: nombres };
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
    // Snapshot del mapping efectivo congelado al aprobar (hito 3). Clonamos
    // deeply para que ediciones posteriores del store NO muten la referencia.
    // Si no hay mapping efectivo (producto sin default ni override), el
    // snapshot queda undefined y la UI del diff cae al modo "sin baseline".
    const approvedMapping = mapping ? cloneMapping(mapping) : undefined;
    const approval: PatternApproval = {
      approvedAtRevision: masterRevision,
      approvedAtCalibrationHash: huellaCalibracionProducto(productId, mapping),
      approvedCalibracion: JSON.parse(JSON.stringify(calibracionDelProducto(productId))),
      ...definicionAprobable(productId),
      approvedAt: new Date().toISOString(),
      approvedMapping,
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
  replaceLibrary: (lib, opts) => {
    const overrides = lib.overrides;
    const approvals = opts?.partial ? get().approvals : (lib.approvals ?? {});
    const aporteOverrides = opts?.partial
      ? get().aporteOverrides
      : sanitizeAporteOverrides(lib.aporteOverrides ?? {});
    const prevCal = get().calibracion;
    if (lib.calibracion) setBibliotecaCalibracion({ ...vaciaMigrada(), ...lib.calibracion });
    if (!writeStorage(overrides, approvals, aporteOverrides)) {
      setBibliotecaCalibracion(prevCal);
      return false;
    }
    setPortMappingOverrides(overrides);
    set({ overrides, approvals, aporteOverrides, ...(lib.calibracion ? { calibracion: { ...vaciaMigrada(), ...lib.calibracion } } : {}) });
    return true;
  },
  getApprovalInfo: (productId, masterRevision) => {
    const approvals = get().approvals;
    let stored = approvals[productId];
    // Si no hay aprobación directa, buscamos una aprobación en un SKU que
    // comparta calibración efectiva: calibration hash igual ⇒ geometría +
    // bocas + marco iguales ⇒ aprobar uno vale para todos. Se recorren
    // alfabéticamente para que el resultado sea estable entre sesiones.
    const mapping = getEffectiveMapping(productId);
    const currentHash = huellaCalibracionProducto(productId, mapping);
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
    const info = computeApprovalInfo(stored, masterRevision, currentHash);
    if (info.status !== 'outdated' || !stored) return info;
    // Decisión 3: si la geometría vigente es la aprobada (tolerancias de las
    // fuentes), la aprobación se conserva aunque cambien huella o revisión.
    const product = productoDelIndice(productId);
    const vigente = product ? definicionEfectiva(product) : null;
    if (!product || !vigente?.ok) return info;
    const aprobada = (stored.approvedDefinicion as StoredDefinition | undefined)
      ?? (stored.approvedMapping ? definicionDeMappingAnterior(product, stored.approvedMapping) : null);
    if (!aprobada) return info;
    return compararDefiniciones(aprobada, vigente.def).equivalente ? { ...info, status: 'current', outdatedReason: undefined } : info;
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
    const payload: PersistedV2 = {
      version: 'codex:catalogConfig/2',
      overrides: get().overrides,
      approvals: get().approvals,
      aporteOverrides: get().aporteOverrides,
      calibracion: get().calibracion,
      savedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  },
}));

// `findMasterForProduct` is re-exported here only to signal it is part of the
// public store surface — the UI can derive the effective aporte in one call
// without duplicating the master-resolution logic.
export { findMasterForProduct };
