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
import type { Product, CatalogFamily, CatalogPort } from '../tray/model';
import {
  getDefaultMapping,
  getEffectiveMapping,
  type PortMappingEntry,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';
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

// ─── Placeholders ───────────────────────────────────────────────────────────

function PlaceholderTab({ tab }: { tab: TabId }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? tab;
  const notes: Record<TabId, string> = {
    producto: '',
    modelo: 'Parámetros de la receta (ancho, radio, ángulo, etc.) y calibración de malla. Tarea #90.',
    bocas: '',
    orientacion: 'Rotación por eje, calibración vs orientación de colocación, undo/redo. Tarea #90.',
    continuaciones: 'Compatibilidades declaradas, estado por boca, generación de reglas. Tarea #90.',
    prueba: 'Dos visores sincronizados: preview y confirmado con el mismo producto. Tarea #90.',
    procedencia: 'Historial de cambios: versión, timestamp, autor, hash del archivo fuente. Tarea #90.',
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
}: {
  tab: TabId;
  product: Product | null;
  familias: readonly CatalogFamily[];
  puertos: readonly CatalogPort[];
}) {
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
  return <PlaceholderTab tab={tab} />;
}
