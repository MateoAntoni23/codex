/**
 * ConfiguratorInspectorTabs — contenido de las 7 pestañas del inspector.
 *
 * Alcance actual (tarea #89):
 *   - Producto/Familia: datos del producto + familia resuelta por `familia_id`.
 *   - Bocas/Asociaciones: muestra el mapping efectivo y permite OVERRIDEAR
 *     con motivo trazable. Default siempre visible (grayed) para comparar.
 *   - Resto de pestañas: placeholder explícito con lo que falta por implementar.
 *
 * Decisiones:
 *   - El editor de bocas NO puede inventar puertos que el catálogo no publique.
 *     Sólo reasigna el nombre de catálogo dentro del set declarado por el
 *     fabricante (P1/P2/P3/P4 en los multi-boca).
 *   - Un override requiere motivo textual (>10 chars). El motor luego lo
 *     expone en el inspector como auditoría.
 *   - "Resetear" elimina el override — vuelve al default declarado.
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  Product,
  CatalogFamily,
  CatalogPort,
  CatalogCompatibility,
} from '../tray/model';
import {
  getDefaultMapping,
  getEffectiveMapping,
  isIdentityModelFrame,
  isIdentityPortGeometry,
  type ModelFrameOverride,
  type PortGeometryOverride,
  type PortMappingEntry,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';
import { getCompatibleProductIds } from '../workspace/routingRules';
import { useCatalogConfigStore } from './catalogConfigStore';
import { enumerateVariantsForMaster, findMasterAndVariantForProduct, type MasterVariant } from './masterVariants';
import { findMasterForProduct, type ClosureStatus } from './masterModels';

export const TABS = [
  { id: 'producto', label: 'Producto / Familia' },
  { id: 'maestro', label: 'Maestro / Variantes' },
  { id: 'modelo', label: 'Modelo / Parámetros' },
  { id: 'bocas', label: 'Bocas / Asociaciones' },
  { id: 'orientacion', label: 'Orientación / Colocación' },
  { id: 'continuaciones', label: 'Continuaciones / Compatibilidad' },
  { id: 'prueba', label: 'Prueba preview / Confirmado' },
  { id: 'procedencia', label: 'Procedencia / Historial' },
] as const;
export type TabId = typeof TABS[number]['id'];

// ─── Producto / Familia ─────────────────────────────────────────────────────

function ProductoFamiliaTab({ product, familia }: { product: Product; familia: CatalogFamily | null }) {
  const extra = product as Record<string, unknown>;
  const ala = typeof extra.ala_nominal_mm === 'number' ? `${extra.ala_nominal_mm} mm` : 'n/d';
  const espesor = typeof extra.espesor_chapa_mm === 'number' ? `${extra.espesor_chapa_mm} mm` : 'n/d';
  const familiaId = typeof extra.familia_id === 'string' ? extra.familia_id : null;
  const longitudComercial = typeof extra.longitud_comercial_mm === 'number' ? `${extra.longitud_comercial_mm} mm` : 'n/d';
  const radio = typeof extra.radio_mm === 'number' ? `${extra.radio_mm} mm` : 'n/d';

  return (
    <div className="cfg-tab-content">
      <h3 className="cfg-section-title">Producto</h3>
      <dl className="cfg-kv">
        <dt>SKU</dt><dd>{product.sku}</dd>
        <dt>producto_id</dt><dd><code>{product.producto_id}</code></dd>
        <dt>tipo_pieza</dt><dd>{product.tipo_pieza}</dd>
        <dt>Ancho nominal</dt><dd>{product.ancho_nominal_mm ?? 'n/d'} mm</dd>
        <dt>Ala nominal</dt><dd>{ala}</dd>
        <dt>Espesor chapa</dt><dd>{espesor}</dd>
        <dt>Longitud comercial</dt><dd>{longitudComercial}</dd>
        <dt>Radio</dt><dd>{radio}</dd>
        <dt>Descripción</dt><dd>{product.descripcion_original}</dd>
      </dl>

      <h3 className="cfg-section-title">Familia</h3>
      {familia ? (
        <dl className="cfg-kv">
          <dt>familia_id</dt><dd><code>{familia.familia_id}</code></dd>
          <dt>Nombre</dt><dd>{familia.nombre_familia}</dd>
          <dt>Acabado</dt><dd>{familia.acabado_normalizado ?? 'n/d'}</dd>
          <dt>Material</dt><dd>{familia.material ?? 'n/d'}</dd>
          <dt>Fabricante</dt><dd>{familia.fabricante ?? 'n/d'}</dd>
        </dl>
      ) : (
        <div className="cfg-tab-note">
          Producto sin familia_id resuelta
          {familiaId && <> (referenciada: <code>{familiaId}</code>)</>}.
        </div>
      )}
    </div>
  );
}

// ─── Bocas / Asociaciones (con editor de override) ──────────────────────────

interface EditableEntry {
  recipePortName: string;
  catalogPortName: string;
  physicalLabel: string;
  justification: string;
}

function BocasTab({ product, catalogPortsForProduct }: {
  product: Product;
  catalogPortsForProduct: readonly CatalogPort[];
}) {
  const effective = getEffectiveMapping(product.producto_id);
  const defaultEntries = getDefaultMapping(product.producto_id);
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const upsert = useCatalogConfigStore((s) => s.upsertOverride);
  const remove = useCatalogConfigStore((s) => s.removeOverride);

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<EditableEntry[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    const src = effective?.entries ?? defaultEntries ?? [];
    setDraft(src.map((e) => ({
      recipePortName: e.recipePortName,
      catalogPortName: e.catalogPortName,
      physicalLabel: e.physicalLabel,
      justification: e.justification,
    })));
    setReason(effective?.source === 'override' ? (effective.overrideReason ?? '') : '');
    setError(null);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft([]);
    setReason('');
    setError(null);
    setEditMode(false);
  };

  const applyEdit = () => {
    if (!draft.length) {
      setError('No hay entradas para guardar.');
      return;
    }
    if (reason.trim().length < 10) {
      setError('El motivo del override debe tener al menos 10 caracteres.');
      return;
    }
    const seen = new Set<string>();
    for (const e of draft) {
      if (!e.catalogPortName.trim()) {
        setError(`Boca "${e.recipePortName}": el puerto de catálogo no puede estar vacío.`);
        return;
      }
      if (seen.has(e.catalogPortName)) {
        setError(`Puerto de catálogo "${e.catalogPortName}" asignado a más de una boca.`);
        return;
      }
      seen.add(e.catalogPortName);
    }
    const mapping: ProductPortMapping = {
      productId: product.producto_id,
      source: 'override',
      overrideReason: reason.trim(),
      overrideAt: new Date().toISOString(),
      entries: draft.map<PortMappingEntry>((e) => ({
        recipePortName: e.recipePortName,
        catalogPortName: e.catalogPortName.trim(),
        physicalLabel: e.physicalLabel,
        justification: `Override: ${reason.trim()}`,
      })),
    };
    upsert(product.producto_id, mapping);
    setEditMode(false);
    setError(null);
  };

  const resetToDefault = () => {
    remove(product.producto_id);
    setEditMode(false);
    setError(null);
  };

  const isOverride = effective?.source === 'override';
  const hasOverride = product.producto_id in overrides;

  // Puertos declarados en el catálogo (para sugerir opciones sin inventar).
  const catalogPortNames = catalogPortsForProduct.map((p) => p.nombre_puerto);

  return (
    <div className="cfg-tab-content">
      {effective ? (
        <>
          <div className={`cfg-tab-note ${isOverride ? 'cfg-tab-note-override' : ''}`}>
            Fuente del mapping: <strong>{effective.source}</strong>
            {isOverride && effective.overrideReason && (
              <> · Motivo: {effective.overrideReason}</>
            )}
            {isOverride && effective.overrideAt && (
              <> · Guardado: {effective.overrideAt}</>
            )}
          </div>

          {!editMode ? (
            <>
              <table className="cfg-table">
                <thead>
                  <tr>
                    <th>Boca-receta</th>
                    <th>Puerto-catálogo</th>
                    <th>Etiqueta física</th>
                    <th>Justificación</th>
                  </tr>
                </thead>
                <tbody>
                  {effective.entries.map((e) => (
                    <tr key={e.recipePortName}>
                      <td><code>{e.recipePortName}</code></td>
                      <td><code>{e.catalogPortName}</code></td>
                      <td>{e.physicalLabel}</td>
                      <td className="cfg-table-just">{e.justification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {isOverride && defaultEntries && (
                <>
                  <h4 className="cfg-section-subtitle">Default declarado (referencia)</h4>
                  <table className="cfg-table cfg-table-muted">
                    <thead>
                      <tr>
                        <th>Boca-receta</th>
                        <th>Puerto-catálogo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {defaultEntries.map((e) => (
                        <tr key={e.recipePortName}>
                          <td><code>{e.recipePortName}</code></td>
                          <td><code>{e.catalogPortName}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="cfg-actions">
                <button
                  type="button"
                  className="cfg-btn"
                  onClick={startEdit}
                  data-testid="cfg-edit-mapping"
                >
                  Editar mapping…
                </button>
                {hasOverride && (
                  <button
                    type="button"
                    className="cfg-btn cfg-btn-danger"
                    onClick={resetToDefault}
                    data-testid="cfg-reset-mapping"
                  >
                    Volver al default
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <table className="cfg-table">
                <thead>
                  <tr>
                    <th>Boca-receta</th>
                    <th>Puerto-catálogo</th>
                    <th>Etiqueta física</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((e, idx) => (
                    <tr key={e.recipePortName}>
                      <td><code>{e.recipePortName}</code></td>
                      <td>
                        <input
                          type="text"
                          list={`cfg-ports-${product.producto_id}`}
                          value={e.catalogPortName}
                          onChange={(ev) => {
                            const copy = draft.slice();
                            copy[idx] = { ...copy[idx], catalogPortName: ev.target.value };
                            setDraft(copy);
                          }}
                          className="cfg-filter-input"
                          data-testid={`cfg-port-${e.recipePortName}`}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={e.physicalLabel}
                          onChange={(ev) => {
                            const copy = draft.slice();
                            copy[idx] = { ...copy[idx], physicalLabel: ev.target.value };
                            setDraft(copy);
                          }}
                          className="cfg-filter-input"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id={`cfg-ports-${product.producto_id}`}>
                {catalogPortNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>

              <label className="cfg-field">
                <span className="cfg-field-label">
                  Motivo del override (≥ 10 caracteres, se persiste como auditoría)
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="cfg-filter-input"
                  placeholder="Ej.: Datos del fabricante actualizados vía PDF 2026 Rev. B"
                  data-testid="cfg-override-reason"
                />
              </label>

              {error && <div className="cfg-tab-note cfg-tab-note-error">{error}</div>}

              <div className="cfg-actions">
                <button
                  type="button"
                  className="cfg-btn cfg-btn-primary"
                  onClick={applyEdit}
                  data-testid="cfg-apply-mapping"
                >
                  Aplicar override
                </button>
                <button type="button" className="cfg-btn" onClick={cancelEdit}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="cfg-tab-note">
          Este producto no declara mapping. El motor usa identidad
          (nombre-receta == nombre-catálogo). Apropiado para productos 2-boca
          que ya usan P1/P2 en la receta.
        </div>
      )}

      {catalogPortsForProduct.length > 0 && (
        <>
          <h4 className="cfg-section-subtitle">Puertos declarados por el catálogo</h4>
          <table className="cfg-table cfg-table-muted">
            <thead>
              <tr>
                <th>puerto_id</th>
                <th>nombre_puerto</th>
                <th>ancho</th>
                <th>ala</th>
                <th>interfaz</th>
              </tr>
            </thead>
            <tbody>
              {catalogPortsForProduct.map((p) => (
                <tr key={p.puerto_id}>
                  <td><code>{p.puerto_id}</code></td>
                  <td><code>{p.nombre_puerto}</code></td>
                  <td>{p.ancho_nominal_mm ?? 'n/d'}</td>
                  <td>{p.ala_nominal_mm ?? 'n/d'}</td>
                  <td>{p.interfaz_conexion ?? 'n/d'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ─── Orientación / Colocación ───────────────────────────────────────────────
//
// Pestaña para la calibración del MODELO (no de la instancia). Permite:
//   - Ajustar el marco del artefacto al canónico: tx/ty/tz (mm) + rx/ry/rz (°).
//   - Por cada boca: giro de instalación alrededor de la normal (°), y
//     opcionalmente override explícito del centro / normal (avanzado).
//
// Reglas:
//   - Siempre hay motivo (≥10 chars) y timestamp — el override se guarda
//     dentro del ProductPortMapping del producto; si el producto no tenía
//     mapping, se crea uno con entries por cada boca declarada en la receta
//     y sin cambios de nombre (identidad), para no perder la trazabilidad.
//   - Apply/Cancel/Reset: Apply persiste al store; Cancel descarta; Reset
//     elimina el override geométrico pero preserva el mapping de nombres si
//     el usuario lo definió por su cuenta.
//
// Si el producto no tiene mapping declarado (default ni override) los puertos
// se derivan del catálogo (CatalogPort[]) para permitir el override por boca
// sin requerir un mapping previo.

interface OrientacionDraft {
  modelFrame: Required<ModelFrameOverride>;
  portOverrides: Record<string, {
    installRotationDeg: number;
    centerMmText: [string, string, string];
    normalText: [string, string, string];
  }>;
}

function toText(n: number | undefined): string {
  if (n === undefined) return '';
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(n);
}

function parseVec3(text: readonly [string, string, string]): readonly [number, number, number] | null {
  const nums = text.map((t) => {
    if (t.trim() === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  });
  if (nums.every((n) => n === null)) return null;
  if (nums.some((n) => n === null || Number.isNaN(n))) return null;
  return [nums[0] as number, nums[1] as number, nums[2] as number];
}

function buildDraftFromMapping(
  mapping: ProductPortMapping | null,
  recipePortNames: readonly string[],
): OrientacionDraft {
  const mf = mapping?.modelFrame ?? {};
  const portOverrides: OrientacionDraft['portOverrides'] = {};
  for (const name of recipePortNames) {
    const entry = mapping?.entries.find((e) => e.recipePortName === name);
    const g = entry?.geometry;
    portOverrides[name] = {
      installRotationDeg: g?.installRotationDeg ?? 0,
      centerMmText: [
        toText(g?.centerMm?.[0]),
        toText(g?.centerMm?.[1]),
        toText(g?.centerMm?.[2]),
      ],
      normalText: [
        toText(g?.normal?.[0]),
        toText(g?.normal?.[1]),
        toText(g?.normal?.[2]),
      ],
    };
  }
  return {
    modelFrame: {
      tx_mm: mf.tx_mm ?? 0,
      ty_mm: mf.ty_mm ?? 0,
      tz_mm: mf.tz_mm ?? 0,
      rx_deg: mf.rx_deg ?? 0,
      ry_deg: mf.ry_deg ?? 0,
      rz_deg: mf.rz_deg ?? 0,
    },
    portOverrides,
  };
}

interface CupsCheck {
  readonly outOfBody: readonly {
    readonly recipePortName: string;
    readonly centerZ: number;
    readonly expectedZ: number;
  }[];
  readonly ancho: number;
}

/**
 * Para maestros CUPS (curva_vertical), la malla se extruye en Z ∈ [-ancho, 0].
 * Si un override de boca ubica el centro fuera de ese rango, la boca queda
 * fuera del cuerpo de la pieza. Detectamos y proponemos corrección reversible
 * (restaurar centerZ a -ancho/2, posición canónica medida en la receta).
 */
function computeCupsCheck(product: Product, effective: ProductPortMapping | null): CupsCheck | null {
  const master = findMasterForProduct(product as unknown as Record<string, unknown>);
  if (!master || master.pieceKind !== 'curva_vertical') return null;
  const ancho = typeof product.ancho_nominal_mm === 'number'
    ? product.ancho_nominal_mm
    : master.baseParams.ancho_mm;
  const expectedZ = -ancho / 2;
  const minZ = -ancho;
  const maxZ = 0;
  const outOfBody: Array<{ recipePortName: string; centerZ: number; expectedZ: number }> = [];
  for (const entry of effective?.entries ?? []) {
    const c = entry.geometry?.centerMm;
    if (!c) continue;
    const z = c[2];
    if (z < minZ - 0.5 || z > maxZ + 0.5) {
      outOfBody.push({ recipePortName: entry.recipePortName, centerZ: z, expectedZ });
    }
  }
  return outOfBody.length ? { outOfBody, ancho } : null;
}

function OrientacionTab({
  product,
  catalogPortsForProduct,
}: {
  product: Product;
  catalogPortsForProduct: readonly CatalogPort[];
}) {
  const effective = getEffectiveMapping(product.producto_id);
  const defaultEntries = getDefaultMapping(product.producto_id);
  const upsert = useCatalogConfigStore((s) => s.upsertOverride);
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const cupsCheck = useMemo(() => computeCupsCheck(product, effective), [product, effective]);

  const correctCupsBoca = (recipePortName: string) => {
    const base = overrides[product.producto_id] ?? effective;
    if (!base) return;
    const entries = base.entries.map<PortMappingEntry>((e) => {
      if (e.recipePortName !== recipePortName) return e;
      const g = e.geometry;
      if (!g?.centerMm) return e;
      const ancho = typeof product.ancho_nominal_mm === 'number'
        ? product.ancho_nominal_mm
        : cupsCheck?.ancho ?? 300;
      const newCenter: readonly [number, number, number] = [g.centerMm[0], g.centerMm[1], -ancho / 2];
      const prevJustificacion = e.justification ?? '';
      return {
        ...e,
        geometry: { ...g, centerMm: newCenter },
        justification: `${prevJustificacion} | Corrección CUPS: centerZ ${g.centerMm[2]}→${newCenter[2]} (boca al cuerpo, reversible)`.trim(),
      };
    });
    const next: ProductPortMapping = {
      ...base,
      productId: product.producto_id,
      source: 'override',
      overrideReason: `${base.overrideReason ?? ''} | Corrección reversible boca-fuera CUPS`.trim(),
      overrideAt: new Date().toISOString(),
      entries,
    };
    upsert(product.producto_id, next);
  };

  // Set de bocas sobre las que se puede ofrecer override: unión de las
  // declaradas en el mapping (default+override) y las del catálogo SAMET,
  // priorizando nombres-receta del mapping.
  const recipePortNames = useMemo<readonly string[]>(() => {
    const fromMapping = effective?.entries.map((e) => e.recipePortName) ??
      defaultEntries?.map((e) => e.recipePortName) ?? [];
    const fromCatalog = catalogPortsForProduct.map((p) => p.nombre_puerto);
    const set = new Set<string>([...fromMapping, ...fromCatalog]);
    return Array.from(set);
  }, [effective, defaultEntries, catalogPortsForProduct]);

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<OrientacionDraft>(() =>
    buildDraftFromMapping(effective, recipePortNames));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Al cambiar el producto seleccionado en el catálogo, descartar borrador y
  // cargar el mapping efectivo del nuevo producto. Why: sin este reset, el
  // usuario arrastraría ediciones a medio escribir entre productos distintos
  // y los campos quedarían inconsistentes con el estado persistido.
  useEffect(() => {
    setEditMode(false);
    setReason('');
    setError(null);
    setDraft(buildDraftFromMapping(effective, recipePortNames));
    // Intencionalmente deps = [product.producto_id] para evitar que la
    // recomposición de recipePortNames reinicie el borrador mientras el
    // usuario edita el mismo producto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.producto_id]);

  const startEdit = () => {
    setDraft(buildDraftFromMapping(effective, recipePortNames));
    setReason(effective?.source === 'override' ? (effective.overrideReason ?? '') : '');
    setError(null);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setError(null);
    setDraft(buildDraftFromMapping(effective, recipePortNames));
  };

  const applyEdit = () => {
    if (reason.trim().length < 10) {
      setError('El motivo del override debe tener al menos 10 caracteres.');
      return;
    }
    // Validar y construir PortGeometryOverride por boca.
    const geomByName = new Map<string, PortGeometryOverride | undefined>();
    for (const [name, p] of Object.entries(draft.portOverrides)) {
      const center = parseVec3(p.centerMmText);
      const normal = parseVec3(p.normalText);
      // Si el usuario rellenó parcialmente alguno de los vectores, pedir los 3.
      const centerPartial = p.centerMmText.some((t) => t.trim() !== '') && center === null;
      const normalPartial = p.normalText.some((t) => t.trim() !== '') && normal === null;
      if (centerPartial) {
        setError(`Boca "${name}": centro debe tener los 3 componentes (x,y,z) o ninguno.`);
        return;
      }
      if (normalPartial) {
        setError(`Boca "${name}": normal debe tener los 3 componentes (x,y,z) o ninguno.`);
        return;
      }
      const geometry: PortGeometryOverride = {
        ...(center ? { centerMm: center } : {}),
        ...(normal ? { normal } : {}),
        ...(p.installRotationDeg !== 0 ? { installRotationDeg: p.installRotationDeg } : {}),
      };
      geomByName.set(name, isIdentityPortGeometry(geometry) ? undefined : geometry);
    }

    // Base de entries: defaults declarados (si existen) o identidad por cada
    // boca-receta conocida (sin cambio de nombre).
    const baseEntries: readonly PortMappingEntry[] =
      effective?.entries ?? defaultEntries ?? recipePortNames.map((n) => ({
        recipePortName: n,
        catalogPortName: n,
        physicalLabel: n,
        justification: 'Mapping identidad generado por override geométrico (no se renombran bocas).',
      }));

    const entries = baseEntries.map<PortMappingEntry>((e) => {
      const g = geomByName.get(e.recipePortName);
      return g ? { ...e, geometry: g } : (e.geometry ? { ...e, geometry: undefined } : e);
    });

    const modelFrame: ModelFrameOverride = {
      tx_mm: draft.modelFrame.tx_mm,
      ty_mm: draft.modelFrame.ty_mm,
      tz_mm: draft.modelFrame.tz_mm,
      rx_deg: draft.modelFrame.rx_deg,
      ry_deg: draft.modelFrame.ry_deg,
      rz_deg: draft.modelFrame.rz_deg,
    };

    const mapping: ProductPortMapping = {
      productId: product.producto_id,
      source: 'override',
      overrideReason: reason.trim(),
      overrideAt: new Date().toISOString(),
      entries,
      ...(isIdentityModelFrame(modelFrame) ? {} : { modelFrame }),
    };
    upsert(product.producto_id, mapping);
    setEditMode(false);
    setError(null);
  };

  const resetGeometry = () => {
    // Si existe un override, reescribimos sin modelFrame y sin geometry en entries.
    const existing = overrides[product.producto_id];
    if (!existing) return;
    const cleanedEntries = existing.entries.map<PortMappingEntry>((e) =>
      e.geometry ? { ...e, geometry: undefined } : e);
    const next: ProductPortMapping = {
      ...existing,
      entries: cleanedEntries,
      modelFrame: undefined,
      overrideReason: existing.overrideReason,
      overrideAt: new Date().toISOString(),
    };
    upsert(product.producto_id, next);
    setEditMode(false);
    setDraft(buildDraftFromMapping(next, recipePortNames));
  };

  const hasGeometryOverride =
    !!(effective?.modelFrame && !isIdentityModelFrame(effective.modelFrame)) ||
    (effective?.entries ?? []).some((e) => !isIdentityPortGeometry(e.geometry));

  return (
    <div className="cfg-tab-content">
      <div className="cfg-tab-note">
        Edita la calibración del modelo (marco → canónico) y por boca
        (centro / normal / giro de instalación). Esto NO cambia la posición
        de las instancias existentes; es ajuste del artefacto, no de la pieza.
      </div>

      {cupsCheck && (
        <div
          className="cfg-tab-note cfg-tab-note-error"
          data-testid="cfg-cups-out-of-body"
        >
          <strong>Boca CUPS fuera del cuerpo</strong>
          <div className="cfg-tab-hint" style={{ margin: '4px 0' }}>
            La malla se extruye en Z ∈ [-{cupsCheck.ancho}, 0]. Un override colocó una o más
            bocas fuera de ese rango — la conexión no cae sobre una cara real. El override se
            conserva; podés confirmarlo o aplicar la corrección reversible (lleva centerZ a
            −ancho/2 = {-cupsCheck.ancho / 2}, posición medida en la receta).
          </div>
          {cupsCheck.outOfBody.map((o) => (
            <div key={o.recipePortName} style={{ marginTop: 4 }}>
              <code>{o.recipePortName}</code>: centerZ = {o.centerZ} → sugerido {o.expectedZ}
              <button
                type="button"
                className="cfg-btn"
                style={{ marginLeft: 8 }}
                onClick={() => correctCupsBoca(o.recipePortName)}
                data-testid={`cfg-cups-fix-${o.recipePortName}`}
              >
                Corregir (reversible)
              </button>
            </div>
          ))}
        </div>
      )}

      {!editMode ? (
        <>
          <h3 className="cfg-section-title">Marco del modelo</h3>
          {effective?.modelFrame && !isIdentityModelFrame(effective.modelFrame) ? (
            <dl className="cfg-kv">
              <dt>Traslación (mm)</dt>
              <dd>
                {effective.modelFrame.tx_mm ?? 0}, {effective.modelFrame.ty_mm ?? 0},
                {' '}{effective.modelFrame.tz_mm ?? 0}
              </dd>
              <dt>Rotación Euler (°)</dt>
              <dd>
                {effective.modelFrame.rx_deg ?? 0}, {effective.modelFrame.ry_deg ?? 0},
                {' '}{effective.modelFrame.rz_deg ?? 0}
              </dd>
            </dl>
          ) : (
            <div className="cfg-tab-hint">Sin calibración del modelo (identidad).</div>
          )}

          <h3 className="cfg-section-title">Bocas</h3>
          {recipePortNames.length ? (
            <table className="cfg-table">
              <thead>
                <tr>
                  <th>Boca</th>
                  <th>Giro instal. (°)</th>
                  <th>Centro override (mm)</th>
                  <th>Normal override</th>
                </tr>
              </thead>
              <tbody>
                {recipePortNames.map((name) => {
                  const entry = effective?.entries.find((e) => e.recipePortName === name);
                  const g = entry?.geometry;
                  const empty = isIdentityPortGeometry(g);
                  return (
                    <tr key={name} className={empty ? 'cfg-table-muted' : ''}>
                      <td><code>{name}</code></td>
                      <td>{g?.installRotationDeg ?? 0}</td>
                      <td>{g?.centerMm ? g.centerMm.join(', ') : '—'}</td>
                      <td>{g?.normal ? g.normal.join(', ') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="cfg-tab-hint">Sin bocas declaradas para este producto.</div>
          )}

          <div className="cfg-actions">
            <button
              type="button"
              className="cfg-btn"
              onClick={startEdit}
              data-testid="cfg-edit-orientacion"
            >
              Editar orientación…
            </button>
            {hasGeometryOverride && (
              <button
                type="button"
                className="cfg-btn cfg-btn-danger"
                onClick={resetGeometry}
                data-testid="cfg-reset-orientacion"
              >
                Quitar overrides geométricos
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <h3 className="cfg-section-title">Marco del modelo</h3>
          <table className="cfg-table">
            <thead>
              <tr>
                <th>Eje</th><th>Traslación (mm)</th><th>Rotación (°)</th>
              </tr>
            </thead>
            <tbody>
              {(['x', 'y', 'z'] as const).map((ax) => {
                const tKey = (`t${ax}_mm`) as 'tx_mm' | 'ty_mm' | 'tz_mm';
                const rKey = (`r${ax}_deg`) as 'rx_deg' | 'ry_deg' | 'rz_deg';
                return (
                  <tr key={ax}>
                    <td><code>{ax.toUpperCase()}</code></td>
                    <td>
                      <input
                        type="number"
                        step={1}
                        value={draft.modelFrame[tKey]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setDraft({
                            ...draft,
                            modelFrame: { ...draft.modelFrame, [tKey]: n },
                          });
                        }}
                        className="cfg-filter-input"
                        data-testid={`cfg-mf-${tKey}`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={1}
                        value={draft.modelFrame[rKey]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setDraft({
                            ...draft,
                            modelFrame: { ...draft.modelFrame, [rKey]: n },
                          });
                        }}
                        className="cfg-filter-input"
                        data-testid={`cfg-mf-${rKey}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="cfg-section-title">Bocas</h3>
          <table className="cfg-table">
            <thead>
              <tr>
                <th>Boca</th>
                <th>Giro instal. (°)</th>
                <th>Centro override (mm)</th>
                <th>Normal override</th>
              </tr>
            </thead>
            <tbody>
              {recipePortNames.map((name) => {
                const p = draft.portOverrides[name];
                if (!p) return null;
                return (
                  <tr key={name}>
                    <td><code>{name}</code></td>
                    <td>
                      <input
                        type="number"
                        step={1}
                        value={p.installRotationDeg}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setDraft({
                            ...draft,
                            portOverrides: {
                              ...draft.portOverrides,
                              [name]: { ...p, installRotationDeg: n },
                            },
                          });
                        }}
                        className="cfg-filter-input"
                        data-testid={`cfg-port-rot-${name}`}
                      />
                    </td>
                    <td>
                      <Vec3Input
                        value={p.centerMmText}
                        onChange={(next) => setDraft({
                          ...draft,
                          portOverrides: {
                            ...draft.portOverrides,
                            [name]: { ...p, centerMmText: next },
                          },
                        })}
                        testId={`cfg-port-center-${name}`}
                      />
                    </td>
                    <td>
                      <Vec3Input
                        value={p.normalText}
                        onChange={(next) => setDraft({
                          ...draft,
                          portOverrides: {
                            ...draft.portOverrides,
                            [name]: { ...p, normalText: next },
                          },
                        })}
                        testId={`cfg-port-normal-${name}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <label className="cfg-field">
            <span className="cfg-field-label">
              Motivo (≥ 10 caracteres, se persiste como auditoría)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="cfg-filter-input"
              placeholder="Ej.: medición en campo 2026-11, el centro P3 estaba desplazado +4 mm en X."
              data-testid="cfg-orientacion-reason"
            />
          </label>

          {error && <div className="cfg-tab-note cfg-tab-note-error">{error}</div>}

          <div className="cfg-actions">
            <button
              type="button"
              className="cfg-btn cfg-btn-primary"
              onClick={applyEdit}
              data-testid="cfg-apply-orientacion"
            >
              Aplicar
            </button>
            <button type="button" className="cfg-btn" onClick={cancelEdit}>
              Cancelar
            </button>
            {hasGeometryOverride && (
              <button
                type="button"
                className="cfg-btn cfg-btn-danger"
                onClick={resetGeometry}
              >
                Reset geométrico
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Vec3Input({
  value,
  onChange,
  testId,
}: {
  value: readonly [string, string, string];
  onChange: (next: [string, string, string]) => void;
  testId: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <input
          key={axis}
          type="text"
          inputMode="decimal"
          value={value[i]}
          placeholder={axis}
          onChange={(e) => {
            const next: [string, string, string] = [value[0], value[1], value[2]];
            next[i] = e.target.value;
            onChange(next);
          }}
          className="cfg-filter-input"
          data-testid={`${testId}-${axis}`}
        />
      ))}
    </div>
  );
}

// ─── Continuaciones ──────────────────────────────────────────────────────────
//
// Para cada boca-receta del producto, calcula los productos continuadores y
// los separa en:
//   - "Recomendados": publicados por el catálogo SAMET (compatibilidad directa).
//   - "Limitaciones conocidas": sin compatibilidad publicada pero con misma
//     familia de ancho, con razón explícita por boca.
//
// Esto verifica P3 "mostrar desde cada boca: productos recomendados,
// excepciones y limitaciones" + comprobar que TPS/XPS/CUPS se resuelven con
// nombres geométricos traducidos. La traducción se aplica automáticamente en
// `getCompatibleProductIds` vía `recipePortToCatalogPort` — si una boca
// retorna lista vacía lo marcamos con razón.

function ContinuacionesTab({
  product,
  productos,
  compatibilidades,
}: {
  product: Product;
  productos: readonly Product[];
  compatibilidades: readonly CatalogCompatibility[];
}) {
  const effective = getEffectiveMapping(product.producto_id);
  const defaultEntries = getDefaultMapping(product.producto_id);
  const entries = effective?.entries ?? defaultEntries ?? [];

  const ancho = product.ancho_nominal_mm;
  const perPort = useMemo(() => {
    return entries.map((e) => {
      const compat = getCompatibleProductIds(
        compatibilidades as CatalogCompatibility[],
        product.producto_id,
        e.recipePortName,
      );
      const compatProducts = productos.filter((p) => compat.has(p.producto_id));
      const sameAnchoNoCompat = productos.filter((p) =>
        !compat.has(p.producto_id) &&
        p.producto_id !== product.producto_id &&
        ancho != null && p.ancho_nominal_mm === ancho,
      );
      return { entry: e, compatProducts, sameAnchoNoCompat };
    });
  }, [entries, compatibilidades, productos, product.producto_id, ancho]);

  if (entries.length === 0) {
    return (
      <div className="cfg-tab-content">
        <div className="cfg-tab-note">
          Este producto no tiene mapping declarado (default ni override). Para
          continuaciones por boca con nombres específicos, agregá un mapping
          desde la pestaña "Bocas / Asociaciones".
        </div>
      </div>
    );
  }

  return (
    <div className="cfg-tab-content">
      <div className="cfg-tab-note">
        Compatibilidades consultadas con nombres geométricos traducidos vía
        <code> catalogPortMapping</code>. Si una boca aparece vacía, el catálogo
        SAMET no publica compatibilidad directa para el puerto resuelto.
      </div>

      {perPort.map(({ entry: e, compatProducts, sameAnchoNoCompat }) => (
        <section
          key={e.recipePortName}
          style={{ marginTop: 16 }}
          data-testid={`cfg-cont-${e.recipePortName}`}
        >
          <h3 className="cfg-section-title">
            Boca <code>{e.recipePortName}</code> → catálogo <code>{e.catalogPortName}</code>
          </h3>
          <div className="cfg-tab-hint" style={{ marginBottom: 4 }}>
            {e.physicalLabel}
          </div>

          <h4 className="cfg-section-subtitle">
            Recomendados ({compatProducts.length})
          </h4>
          {compatProducts.length > 0 ? (
            <table className="cfg-table">
              <thead>
                <tr><th>producto_id</th><th>SKU</th><th>tipo_pieza</th><th>ancho</th></tr>
              </thead>
              <tbody>
                {compatProducts.map((p) => (
                  <tr key={p.producto_id}>
                    <td><code>{p.producto_id}</code></td>
                    <td>{p.sku}</td>
                    <td>{p.tipo_pieza}</td>
                    <td>{p.ancho_nominal_mm ?? 'n/d'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="cfg-tab-note cfg-tab-note-error">
              Sin compatibilidad publicada por el catálogo SAMET para
              <code> {product.producto_id}-{e.catalogPortName}</code>.
              Verificá que el mapping boca-puerto esté correcto.
            </div>
          )}

          {sameAnchoNoCompat.length > 0 && (
            <>
              <h4 className="cfg-section-subtitle">
                Mismo ancho sin compat publicada ({sameAnchoNoCompat.length})
              </h4>
              <div className="cfg-tab-hint" style={{ marginBottom: 4 }}>
                Compartir ancho no convierte la conexión en compatible — sólo se
                listan para auditoría. El workspace los ofrece como "Otros" con
                excepción obligatoria y motivo.
              </div>
              <table className="cfg-table cfg-table-muted">
                <thead>
                  <tr><th>producto_id</th><th>SKU</th><th>tipo_pieza</th></tr>
                </thead>
                <tbody>
                  {sameAnchoNoCompat.slice(0, 20).map((p) => (
                    <tr key={p.producto_id}>
                      <td><code>{p.producto_id}</code></td>
                      <td>{p.sku}</td>
                      <td>{p.tipo_pieza}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sameAnchoNoCompat.length > 20 && (
                <div className="cfg-tab-hint">
                  Mostrando primeros 20 de {sameAnchoNoCompat.length}.
                </div>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}

// ─── Maestro / Variantes ────────────────────────────────────────────────────
//
// Muestra el MasterModel asociado al producto seleccionado y sus variantes
// aplicables lado a lado. Cada variante trae su origen (base, declared,
// measured, derived, estimated, requires-master) con las dimensiones
// proyectadas por la regla del maestro. Usa
// `findMasterAndVariantForProduct` para resolver el producto actual y
// resaltar su fila.

function vec3Str(v: readonly [number, number, number] | null): string {
  if (!v) return '—';
  const r = (n: number) => (Math.abs(n) < 0.01 ? '0' : n.toFixed(2));
  return `[${r(v[0])}, ${r(v[1])}, ${r(v[2])}]`;
}

function originBadgeClass(origin: MasterVariant['origin']): string {
  switch (origin) {
    case 'base':
      return 'cfg-status-recipe-default-identity';
    case 'declared':
      return 'cfg-status-recipe-default-mapping';
    case 'measured':
      return 'cfg-status-recipe-default-identity';
    case 'derived':
      return 'cfg-status-recipe-default-mapping';
    case 'estimated':
      return 'cfg-status-recipe-override';
    case 'requires-master':
      return 'cfg-status-recipe-needs-mapping';
  }
}

function provenanceLabel(provenance: 'measured' | 'derived' | 'estimated'): string {
  switch (provenance) {
    case 'measured':
      return 'medida (validada contra ≥2 STEP)';
    case 'derived':
      return 'derivada (construida desde el STEP base; dimensión nominal del catálogo)';
    case 'estimated':
      return 'estimada (hipótesis visual sin segundo STEP)';
  }
}

function closureLabel(status: ClosureStatus): string {
  switch (status) {
    case 'validated':
      return 'Validado';
    case 'validated-scoped':
      return 'Validado (acotado)';
    case 'estimated':
      return 'Estimado';
    case 'pending':
      return 'Pendiente';
  }
}

function closureBadgeClass(status: ClosureStatus): string {
  switch (status) {
    case 'validated':
      return 'cfg-status-recipe-default-identity';
    case 'validated-scoped':
      return 'cfg-status-recipe-default-mapping';
    case 'estimated':
      return 'cfg-status-recipe-override';
    case 'pending':
      return 'cfg-status-recipe-needs-mapping';
  }
}

function MaestroTab({
  product,
  productos,
}: {
  product: Product;
  productos: readonly Product[];
}) {
  const bind = useMemo(() => findMasterAndVariantForProduct(product, productos), [product, productos]);
  const variants = useMemo<readonly MasterVariant[]>(() => {
    if (!bind) return [];
    return enumerateVariantsForMaster(bind.master, productos);
  }, [bind, productos]);

  if (!bind) {
    const probe = findMasterForProduct(product as unknown as Record<string, unknown>);
    return (
      <div className="cfg-tab-content">
        <h3 className="cfg-section-title">Maestro</h3>
        <div className="cfg-tab-note cfg-tab-note-error" data-testid="cfg-maestro-sin-asociacion">
          Este producto no tiene maestro asociado.
          {probe ? (
            <>
              {' '}
              Candidato detectado por familia+tipo+ala: <code>{probe.id}</code>, pero el producto
              no cumple todos los criterios del catalogMatch (p.ej. ángulo distinto).
            </>
          ) : (
            <>
              {' '}
              No hay un STEP medido que cubra familia_id=
              <code>{String((product as Record<string, unknown>).familia_id ?? '—')}</code>,
              tipo_pieza=<code>{product.tipo_pieza}</code>,
              ala=<code>{String((product as Record<string, unknown>).ala_nominal_mm ?? '—')}</code>.
            </>
          )}
        </div>
      </div>
    );
  }

  const { master, variant } = bind;
  return (
    <div className="cfg-tab-content">
      <h3 className="cfg-section-title">Maestro</h3>
      <dl className="cfg-kv">
        <dt>ID</dt><dd><code>{master.id}</code></dd>
        <dt>Etiqueta</dt><dd>{master.label}</dd>
        <dt>Sistema</dt><dd>{master.sistema}</dd>
        <dt>piece_kind</dt><dd><code>{master.pieceKind}</code></dd>
        <dt>STEP</dt>
        <dd>
          <code>{master.source.stepFile}</code> · hash <code>{master.source.stepHashShort}</code>
        </dd>
        <dt>Rotación canónica Z</dt><dd>{master.canonicalRotationZDeg}°</dd>
        <dt>Base</dt>
        <dd>
          ancho <code>{master.baseParams.ancho_mm}</code>, ala <code>{master.baseParams.ala_mm}</code>
          {master.baseParams.longitud_mm !== undefined && (
            <>, longitud <code>{master.baseParams.longitud_mm}</code></>
          )}
          {master.baseParams.angulo_deg !== undefined && (
            <>, ángulo <code>{master.baseParams.angulo_deg}°</code></>
          )}
        </dd>
        <dt>Regla</dt>
        <dd>
          <code>{master.variationRule.kind}</code>{' '}
          <span data-testid="cfg-maestro-provenance">
            ({provenanceLabel(master.variationRule.provenance)})
          </span>
          <div className="cfg-tab-hint" style={{ marginTop: 4 }}>
            {master.variationRule.rationale}
          </div>
        </dd>
        <dt>Revisión</dt><dd>r{master.revision}</dd>
      </dl>

      <h3 className="cfg-section-title">Estado del patrón</h3>
      <div data-testid="cfg-maestro-closure" style={{ marginBottom: 8 }}>
        <span
          className={`cfg-list-status ${closureBadgeClass(master.closure.status)}`}
          data-testid="cfg-maestro-closure-badge"
          data-closure-status={master.closure.status}
          title={`Estado efectivo del patrón según la regresión compartida.`}
        >
          {closureLabel(master.closure.status)}
        </span>
      </div>
      {master.closure.regressionSpecs.length > 0 && (
        <div className="cfg-tab-hint" style={{ marginBottom: 6 }}>
          Respaldo:{' '}
          {master.closure.regressionSpecs.map((spec, i) => (
            <span key={spec}>
              {i > 0 && ', '}
              <code>{spec}</code>
            </span>
          ))}
        </div>
      )}
      {master.closure.limitations.length > 0 ? (
        <ul
          className="cfg-tab-hint"
          data-testid="cfg-maestro-closure-limitations"
          style={{ margin: '4px 0 12px 18px', padding: 0, lineHeight: 1.45 }}
        >
          {master.closure.limitations.map((lim, i) => (
            <li key={i}>{lim}</li>
          ))}
        </ul>
      ) : (
        <div
          className="cfg-tab-hint"
          data-testid="cfg-maestro-closure-limitations-empty"
          style={{ marginBottom: 12 }}
        >
          Sin limitaciones conocidas para este patrón.
        </div>
      )}

      <h3 className="cfg-section-title">Puertos del maestro (base)</h3>
      <table className="cfg-table">
        <thead>
          <tr>
            <th>recipePort</th>
            <th>Etiqueta</th>
            <th>catalogPort</th>
            <th>Centro (mm)</th>
            <th>Normal</th>
          </tr>
        </thead>
        <tbody>
          {master.ports.map((mp, i) => {
            // Para la vista base los puertos ya vienen del variant.ports
            // cuando origin='base'. Si no, mostramos los del binding actual.
            const vp = variant.ports.find((p) => p.recipePortName === mp.recipePortName);
            const baseVariant = variants.find((v) => v.origin === 'base');
            const bp = baseVariant?.ports.find((p) => p.recipePortName === mp.recipePortName);
            const src = bp ?? vp;
            return (
              <tr key={`${mp.recipePortName}-${i}`}>
                <td><code>{mp.recipePortName}</code></td>
                <td>{mp.physicalLabel}</td>
                <td><code>{mp.catalogPortName}</code></td>
                <td>{vec3Str(src?.centerMm ?? null)}</td>
                <td>{vec3Str(src?.normal ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="cfg-section-title">Variantes del maestro ({variants.length})</h3>
      <div className="cfg-tab-hint" style={{ marginBottom: 6 }}>
        La fila del producto seleccionado está resaltada. Las variantes se
        proyectan por la regla del maestro — ninguna coordenada se copia del
        ancho base.
      </div>
      <table className="cfg-table" data-testid="cfg-maestro-variantes">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Origen</th>
            <th>ancho</th>
            <th>ala</th>
            <th>Δ ancho</th>
            <th>Scale X/Y/Z</th>
            <th>Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const isCurrent = v.productId === product.producto_id;
            return (
              <tr
                key={v.productId}
                className={isCurrent ? 'is-active' : ''}
                data-testid={`cfg-maestro-row-${v.sku}`}
              >
                <td>
                  <code>{v.sku}</code>
                  {isCurrent && <span className="cfg-tab-hint"> (seleccionado)</span>}
                </td>
                <td>
                  <span className={`cfg-list-status ${originBadgeClass(v.origin)}`} title={v.rationale}>
                    {v.origin}
                  </span>
                </td>
                <td>{v.ancho_mm ?? 'n/d'}</td>
                <td>{v.ala_mm ?? 'n/d'}</td>
                <td>{v.deltaFromMaster.ancho_mm}</td>
                <td>
                  {v.scale.x.toFixed(2)} / {v.scale.y.toFixed(2)} / {v.scale.z.toFixed(2)}
                </td>
                <td className="cfg-table-just">
                  {v.warnings.length
                    ? v.warnings.join(' · ')
                    : 'OK'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="cfg-section-title">Variante actual — proyección detallada</h3>
      <dl className="cfg-kv">
        <dt>SKU</dt><dd><code>{variant.sku}</code></dd>
        <dt>Origen</dt><dd><code>{variant.origin}</code></dd>
        <dt>Dims</dt>
        <dd>
          ancho <code>{variant.ancho_mm ?? 'n/d'}</code>, ala <code>{variant.ala_mm ?? 'n/d'}</code>
          {variant.longitud_mm !== null && <>, longitud <code>{variant.longitud_mm}</code></>}
          {variant.angulo_deg !== null && <>, ángulo <code>{variant.angulo_deg}°</code></>}
        </dd>
        <dt>Rationale</dt><dd className="cfg-tab-hint">{variant.rationale}</dd>
      </dl>

      {variant.ports.length > 0 && (
        <table className="cfg-table">
          <thead>
            <tr>
              <th>Boca</th>
              <th>Centro proyectado (mm)</th>
              <th>Normal</th>
            </tr>
          </thead>
          <tbody>
            {variant.ports.map((p) => (
              <tr key={p.recipePortName}>
                <td>
                  <code>{p.recipePortName}</code>
                  <div className="cfg-tab-hint">{p.physicalLabel}</div>
                </td>
                <td>{vec3Str(p.centerMm)}</td>
                <td>{vec3Str(p.normal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {variant.warnings.length > 0 && (
        <div className="cfg-tab-note cfg-tab-note-error" style={{ marginTop: 10 }}>
          {variant.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Placeholders ───────────────────────────────────────────────────────────

function PlaceholderTab({ tab }: { tab: TabId }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? tab;
  const notes: Record<TabId, string> = {
    producto: '',
    maestro: '',
    modelo: 'Parámetros de la receta (ancho, radio, ángulo, etc.) y calibración de malla por recipe:view. Pendiente.',
    bocas: '',
    orientacion: '',
    continuaciones: '',
    prueba: 'Dos visores sincronizados: preview y confirmado con las operaciones reales del workspace. Pendiente.',
    procedencia: 'Historial de cambios: versión, timestamp, autor, hash del archivo fuente. Pendiente.',
  };
  return (
    <div className="cfg-tab-content">
      <h3 className="cfg-section-title">{label}</h3>
      <div className="cfg-tab-note">{notes[tab]}</div>
    </div>
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function InspectorTabContent({
  tab,
  product,
  familias,
  puertos,
  productos,
  compatibilidades,
}: {
  tab: TabId;
  product: Product | null;
  familias: readonly CatalogFamily[];
  puertos: readonly CatalogPort[];
  productos: readonly Product[];
  compatibilidades: readonly CatalogCompatibility[];
}) {
  // Subscribe to overrides so tabs reflect edits made elsewhere in the session.
  useCatalogConfigStore((s) => s.overrides);

  const familia = useMemo(() => {
    if (!product) return null;
    const fid = (product as Record<string, unknown>).familia_id;
    if (typeof fid !== 'string') return null;
    return familias.find((f) => f.familia_id === fid) ?? null;
  }, [product, familias]);

  const portsForProduct = useMemo(() => {
    if (!product) return [] as readonly CatalogPort[];
    return puertos.filter((p) => p.producto_id === product.producto_id);
  }, [product, puertos]);

  if (!product) {
    return <div className="cfg-tab-empty">Seleccioná un producto a la izquierda.</div>;
  }
  if (tab === 'producto') return <ProductoFamiliaTab product={product} familia={familia} />;
  if (tab === 'maestro') return <MaestroTab product={product} productos={productos} />;
  if (tab === 'bocas') return <BocasTab product={product} catalogPortsForProduct={portsForProduct} />;
  if (tab === 'orientacion') return <OrientacionTab product={product} catalogPortsForProduct={portsForProduct} />;
  if (tab === 'continuaciones') {
    return (
      <ContinuacionesTab
        product={product}
        productos={productos}
        compatibilidades={compatibilidades}
      />
    );
  }
  return <PlaceholderTab tab={tab} />;
}
