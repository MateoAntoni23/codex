/**
 * patternIdentity — tres identidades ortogonales para patrones del Configurador.
 *
 * Problema: se mezclaban en la misma clave el PATRÓN BASE (geometría conceptual),
 * la VARIANTE DIMENSIONAL (misma base con otros parámetros) y la CALIBRACIÓN
 * (overrides concretos del usuario sobre el mapping y la geometría de bocas).
 * Mezclarlas impide razonar sobre qué está aprobado y cuándo invalidar una
 * aprobación.
 *
 * Este módulo expone tres helpers puros (sin side-effects, sin acceso a stores)
 * que permiten computar las tres identidades por separado:
 *
 *   - `basePatternKey(master)` — identidad del patrón BASE.
 *       Incluye: sistema (perforada/escalera), pieceKind, parámetros base del
 *       maestro. NO incluye: material, acabado, espesor, SKU.
 *       Excepción explícita: `sharedVertical: true` fusiona CUPS/CUPB bajo la
 *       misma identidad (misma geometría, distinta colocación). Hoy ningún
 *       maestro declara `sharedVertical` — queda como gancho para hito 2.
 *
 *   - `variantIdentityKey(master, dimensions)` — identidad de la VARIANTE.
 *       Incluye la identidad base + las dimensiones concretas (ancho, ala,
 *       longitud, ángulo). Dos SKUs del mismo maestro con las mismas
 *       dimensiones comparten `variantIdentityKey` aunque difieran en acabado.
 *
 *   - `calibrationHash(mapping)` — hash estable de la calibración relevante.
 *       Hash determinístico sobre los campos que, si cambian, deberían
 *       invalidar una aprobación: mapping de bocas (recipePortName,
 *       catalogPortName, geometría por boca) y `modelFrame`. NO incluye
 *       `overrideReason` ni timestamps.
 *
 * Diseño del hash:
 *   - FNV-1a 32 bits sobre una serialización canónica (keys ordenadas).
 *   - Devuelve string hex de 8 caracteres. Suficiente para identificar
 *     calibraciones distintas dentro del dominio (centenas de productos);
 *     colisión inviable en la práctica y el peor caso es "aprobación válida
 *     mostrada como vigente cuando debería estar desactualizada" — no hay
 *     riesgo de ejecutar algo incorrecto, sólo de tener que revalidar manual.
 *   - Determinístico entre navegadores: usamos sólo aritmética int32 estándar.
 *
 * NO persiste nada. NO consulta stores. Los consumidores (catalogConfigStore,
 * UI de aprobación) llaman a estas funciones con los datos ya cargados.
 */
import type { ProductPortMapping } from '../workspace/catalogPortMapping';
import type { MasterModel, MasterBaseParams, MasterSistema, MasterPieceKind } from './masterModels';

export interface BasePatternIdentity {
  /** Sistema geométrico del patrón base. */
  readonly sistema: MasterSistema;
  /** Tipo de pieza canónico del patrón base. */
  readonly pieceKind: MasterPieceKind;
  /** Parámetros base del maestro (ancho, ala, longitud opcional, ángulo opcional). */
  readonly baseParams: MasterBaseParams;
  /**
   * Si `true`, se omite `sistema` del fingerprint — permite fusionar
   * CUPS/CUPB bajo el mismo patrón vertical compartido. Default: false.
   */
  readonly sharedVertical: boolean;
}

export interface VariantDimensions {
  readonly ancho_mm: number;
  readonly ala_mm: number;
  readonly longitud_mm?: number;
  readonly angulo_deg?: number;
}

/**
 * Serializa una base de patrón a una clave estable (string). El orden de
 * campos y el tratamiento de opcionales es fijo para que la misma entidad
 * conceptual produzca siempre la misma cadena.
 */
export function basePatternKey(identity: BasePatternIdentity): string {
  const sistemaPart = identity.sharedVertical ? 'shared' : identity.sistema;
  const bp = identity.baseParams;
  const dims: string[] = [
    `ancho=${bp.ancho_mm}`,
    `ala=${bp.ala_mm}`,
  ];
  if (bp.longitud_mm !== undefined) dims.push(`longitud=${bp.longitud_mm}`);
  if (bp.angulo_deg !== undefined) dims.push(`angulo=${bp.angulo_deg}`);
  return `base|${sistemaPart}|${identity.pieceKind}|${dims.join(',')}`;
}

/**
 * Deriva `BasePatternIdentity` desde un `MasterModel` del catálogo. El flag
 * `sharedVertical` se extrae del maestro si está declarado; hoy ningún maestro
 * lo declara, pero la firma soporta la extensión sin romper nada.
 */
export function basePatternIdentityFromMaster(master: MasterModel): BasePatternIdentity {
  const shared = (master as unknown as { sharedVertical?: boolean }).sharedVertical === true;
  return {
    sistema: master.sistema,
    pieceKind: master.pieceKind,
    baseParams: master.baseParams,
    sharedVertical: shared,
  };
}

/**
 * Serializa la identidad de una variante dimensional a clave estable. Incluye
 * la base + dimensiones concretas. Dos SKUs con misma base+dimensiones pero
 * distinto acabado colapsan en la misma clave — eso es correcto por diseño.
 */
export function variantIdentityKey(
  identity: BasePatternIdentity,
  dimensions: VariantDimensions,
): string {
  const parts: string[] = [
    `ancho=${dimensions.ancho_mm}`,
    `ala=${dimensions.ala_mm}`,
  ];
  if (dimensions.longitud_mm !== undefined) parts.push(`longitud=${dimensions.longitud_mm}`);
  if (dimensions.angulo_deg !== undefined) parts.push(`angulo=${dimensions.angulo_deg}`);
  return `variant|${basePatternKey(identity)}|${parts.join(',')}`;
}

// ─── Hash determinístico (FNV-1a 32 bits) ────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // multiplicación en int32 sin overflow: Math.imul
    h = Math.imul(h, FNV_PRIME);
  }
  // Interpretamos h como uint32 para la salida.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canoniza un objeto JSON: ordena keys recursivamente para que la serialización
 * sea estable sin depender del orden de inserción. Arreglos se preservan en su
 * orden original (semántica propia del dominio — p.ej. orden de bocas).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = canonicalize(obj[k]);
  return out;
}

/**
 * Hash de la calibración relevante de un ProductPortMapping. Incluye sólo
 * campos que, si cambian, deben invalidar una aprobación:
 *   - `modelFrame`: rotación/traslación del modelo.
 *   - `entries[].recipePortName / catalogPortName / geometry`: mapping y
 *     geometría por boca. `physicalLabel` y `justification` se incluyen para
 *     que una re-etiquetación manual también invalide — el usuario aprobó
 *     una boca con un label y motivo concretos.
 *
 * Excluye: `source`, `overrideReason`, `overrideAt`, campos de aprobación
 * (approved*, approvedAt*) — incluirlos crearía un ciclo (aprobar cambia el
 * hash que valida la aprobación).
 */
export function calibrationHash(mapping: ProductPortMapping | null | undefined): string {
  if (!mapping) return fnv1a('null');
  const relevant = {
    modelFrame: mapping.modelFrame ?? null,
    entries: (mapping.entries ?? []).map((e) => ({
      recipePortName: e.recipePortName,
      catalogPortName: e.catalogPortName,
      physicalLabel: e.physicalLabel,
      justification: e.justification,
      geometry: e.geometry ?? null,
    })),
  };
  const canonical = canonicalize(relevant);
  return fnv1a(JSON.stringify(canonical));
}

/**
 * Compara dos hashes de calibración. Trivial wrapper, pero expuesto para
 * documentar la semántica y evitar comparaciones con `===` sueltas en la UI.
 */
export function calibrationHashesEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a === b;
}
