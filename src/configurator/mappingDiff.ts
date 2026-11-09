/**
 * mappingDiff — comparador puro de dos `ProductPortMapping` (preview vs
 * confirmado-approved) que resume las diferencias en una estructura amigable
 * para UI.
 *
 * Por qué un módulo aparte:
 *   - La UI (`PruebaTab`) necesita saber QUÉ cambió entre dos mappings para
 *     pintar un diff legible. `calibrationHash` responde "¿cambió?" pero no
 *     "¿qué cambió?". Este helper responde lo segundo.
 *   - Es side-effect free y sin acceso al store — testable con vitest puros.
 *
 * Alcance:
 *   - Compara `modelFrame` campo a campo (tx/ty/tz/rx/ry/rz en el espacio
 *     declarado — se tratan ausentes como 0 para comparar valores efectivos).
 *   - Compara `entries` emparejando por `recipePortName` (orden independiente):
 *     se detectan altas/bajas/cambios en catalogPortName, physicalLabel,
 *     justification y geometry (centerMm/normal/uDir/vDir/installRotationDeg).
 *   - Tolerancia numérica: 1e-6 para evitar ruido por serialización.
 *
 * NO compara:
 *   - `source`, `inheritedFromProductId`, `overrideReason`, `overrideAt` —
 *     esos son metadatos administrativos, no afectan la geometría operativa.
 *   - `productId` — asumimos que ambos mappings son del mismo producto.
 */
import type {
  ModelFrameOverride,
  PortGeometryOverride,
  PortMappingEntry,
  ProductPortMapping,
} from '../workspace/catalogPortMapping';

const TOL = 1e-6;

export interface ScalarDelta {
  readonly field: string;
  readonly preview: number;
  readonly confirmado: number;
}

export interface VectorDelta {
  readonly field: string;
  readonly preview: readonly [number, number, number] | null;
  readonly confirmado: readonly [number, number, number] | null;
}

export interface StringDelta {
  readonly field: string;
  readonly preview: string;
  readonly confirmado: string;
}

export interface ModelFrameDiff {
  /** `true` si algún eje difiere más que la tolerancia. */
  readonly changed: boolean;
  readonly deltas: readonly ScalarDelta[];
}

export interface PortEntryDiff {
  readonly recipePortName: string;
  /** Alta: existe en preview pero no en confirmado. */
  readonly kind: 'added' | 'removed' | 'changed' | 'unchanged';
  readonly scalarChanges: readonly ScalarDelta[];
  readonly vectorChanges: readonly VectorDelta[];
  readonly stringChanges: readonly StringDelta[];
}

export interface MappingDiff {
  /** `true` si al menos un campo observable difiere. */
  readonly hasChanges: boolean;
  readonly modelFrame: ModelFrameDiff;
  readonly ports: readonly PortEntryDiff[];
}

function approxEqNum(a: number | undefined, b: number | undefined): boolean {
  return Math.abs((a ?? 0) - (b ?? 0)) <= TOL;
}

function approxEqVec(
  a: readonly [number, number, number] | undefined,
  b: readonly [number, number, number] | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return approxEqNum(a[0], b[0]) && approxEqNum(a[1], b[1]) && approxEqNum(a[2], b[2]);
}

function cloneVec(
  v: readonly [number, number, number] | undefined,
): readonly [number, number, number] | null {
  return v ? [v[0], v[1], v[2]] : null;
}

function diffModelFrame(
  preview: ModelFrameOverride | undefined,
  confirmado: ModelFrameOverride | undefined,
): ModelFrameDiff {
  const fields: readonly (keyof ModelFrameOverride)[] = [
    'tx_mm',
    'ty_mm',
    'tz_mm',
    'rx_deg',
    'ry_deg',
    'rz_deg',
  ];
  const deltas: ScalarDelta[] = [];
  for (const f of fields) {
    const p = preview?.[f] ?? 0;
    const c = confirmado?.[f] ?? 0;
    if (!approxEqNum(p, c)) {
      deltas.push({ field: f, preview: p, confirmado: c });
    }
  }
  return { changed: deltas.length > 0, deltas };
}

function diffGeometry(
  preview: PortGeometryOverride | undefined,
  confirmado: PortGeometryOverride | undefined,
): { scalars: ScalarDelta[]; vectors: VectorDelta[] } {
  const scalars: ScalarDelta[] = [];
  const vectors: VectorDelta[] = [];
  const vecFields: readonly (keyof PortGeometryOverride)[] = [
    'centerMm',
    'normal',
    'uDir',
    'vDir',
  ];
  for (const f of vecFields) {
    const p = preview?.[f] as readonly [number, number, number] | undefined;
    const c = confirmado?.[f] as readonly [number, number, number] | undefined;
    if (!approxEqVec(p, c)) {
      vectors.push({ field: f, preview: cloneVec(p), confirmado: cloneVec(c) });
    }
  }
  const rp = preview?.installRotationDeg ?? 0;
  const rc = confirmado?.installRotationDeg ?? 0;
  if (!approxEqNum(rp, rc)) {
    scalars.push({ field: 'installRotationDeg', preview: rp, confirmado: rc });
  }
  return { scalars, vectors };
}

function diffEntry(
  preview: PortMappingEntry | undefined,
  confirmado: PortMappingEntry | undefined,
): PortEntryDiff {
  const name = (preview?.recipePortName ?? confirmado?.recipePortName)!;
  if (preview && !confirmado) {
    return {
      recipePortName: name,
      kind: 'added',
      scalarChanges: [],
      vectorChanges: [],
      stringChanges: [],
    };
  }
  if (!preview && confirmado) {
    return {
      recipePortName: name,
      kind: 'removed',
      scalarChanges: [],
      vectorChanges: [],
      stringChanges: [],
    };
  }
  if (!preview || !confirmado) {
    return {
      recipePortName: name,
      kind: 'unchanged',
      scalarChanges: [],
      vectorChanges: [],
      stringChanges: [],
    };
  }
  const stringChanges: StringDelta[] = [];
  const stringFields: readonly (keyof PortMappingEntry)[] = [
    'catalogPortName',
    'physicalLabel',
    'justification',
  ];
  for (const f of stringFields) {
    const p = preview[f] as string;
    const c = confirmado[f] as string;
    if (p !== c) stringChanges.push({ field: f, preview: p, confirmado: c });
  }
  const geom = diffGeometry(preview.geometry, confirmado.geometry);
  const changed =
    stringChanges.length > 0 ||
    geom.scalars.length > 0 ||
    geom.vectors.length > 0;
  return {
    recipePortName: name,
    kind: changed ? 'changed' : 'unchanged',
    scalarChanges: geom.scalars,
    vectorChanges: geom.vectors,
    stringChanges,
  };
}

/**
 * Compara dos mappings produciendo un resumen estructurado. El orden de
 * `entries` no importa: emparejamos por `recipePortName`. Entradas que sólo
 * existen en un lado quedan como added/removed.
 */
export function diffMappings(
  preview: ProductPortMapping | null | undefined,
  confirmado: ProductPortMapping | null | undefined,
): MappingDiff {
  const mf = diffModelFrame(preview?.modelFrame, confirmado?.modelFrame);
  const names = new Set<string>();
  for (const e of preview?.entries ?? []) names.add(e.recipePortName);
  for (const e of confirmado?.entries ?? []) names.add(e.recipePortName);
  // Orden alfabético para que la UI pinte determinista.
  const ordered = Array.from(names).sort();
  const previewByName = new Map<string, PortMappingEntry>();
  for (const e of preview?.entries ?? []) previewByName.set(e.recipePortName, e);
  const confirmadoByName = new Map<string, PortMappingEntry>();
  for (const e of confirmado?.entries ?? []) confirmadoByName.set(e.recipePortName, e);
  const ports = ordered.map((n) =>
    diffEntry(previewByName.get(n), confirmadoByName.get(n)),
  );
  const hasChanges =
    mf.changed || ports.some((p) => p.kind !== 'unchanged');
  return { hasChanges, modelFrame: mf, ports };
}

/**
 * Clona un mapping en profundidad para congelar un snapshot inmutable
 * (ninguna referencia compartida con el store). Usado por `approveProduct`
 * para capturar el baseline aprobado.
 */
export function cloneMapping(mapping: ProductPortMapping): ProductPortMapping {
  return {
    productId: mapping.productId,
    source: mapping.source,
    inheritedFromProductId: mapping.inheritedFromProductId,
    overrideReason: mapping.overrideReason,
    overrideAt: mapping.overrideAt,
    modelFrame: mapping.modelFrame ? { ...mapping.modelFrame } : undefined,
    entries: mapping.entries.map((e) => ({
      recipePortName: e.recipePortName,
      catalogPortName: e.catalogPortName,
      physicalLabel: e.physicalLabel,
      justification: e.justification,
      geometry: e.geometry
        ? {
            centerMm: e.geometry.centerMm
              ? [e.geometry.centerMm[0], e.geometry.centerMm[1], e.geometry.centerMm[2]]
              : undefined,
            normal: e.geometry.normal
              ? [e.geometry.normal[0], e.geometry.normal[1], e.geometry.normal[2]]
              : undefined,
            uDir: e.geometry.uDir
              ? [e.geometry.uDir[0], e.geometry.uDir[1], e.geometry.uDir[2]]
              : undefined,
            vDir: e.geometry.vDir
              ? [e.geometry.vDir[0], e.geometry.vDir[1], e.geometry.vDir[2]]
              : undefined,
            installRotationDeg: e.geometry.installRotationDeg,
          }
        : undefined,
    })),
  };
}
