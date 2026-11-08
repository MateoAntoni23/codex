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
import { useMemo, useState } from 'react';
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

export const TABS = [
  { id: 'producto', label: 'Producto / Familia' },
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

// ─── Placeholders ───────────────────────────────────────────────────────────

function PlaceholderTab({ tab }: { tab: TabId }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? tab;
  const notes: Record<TabId, string> = {
    producto: '',
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
