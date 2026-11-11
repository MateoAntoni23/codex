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
import { CalibracionPatronTab } from './CalibracionPatronTab';
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
  getMasterPortEntries,
  type PortMappingEntry,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';
import { getCompatibleProductIds, getPortCompatibility } from '../workspace/routingRules';
import { useCatalogConfigStore } from './catalogConfigStore';
import { enumerateVariantsForMaster, findMasterAndVariantForProduct, type MasterVariant } from './masterVariants';
import { findMasterForProduct, type DimensionStatus, type ClosureDimension } from './masterModels';
import {
  aporteRuleLabel,
  defaultAporteForMaster,
  isAporteRule,
  type AporteRule,
  type AporteRuleKind,
} from './aporteTrazado';
import { diffMappings, type MappingDiff, type PortEntryDiff } from './mappingDiff';
import { calibrationHash } from './patternIdentity';
import { CalibrationPlayground } from './CalibrationPlayground';

export const TABS = [
  { id: 'producto', label: 'Producto / Familia' },
  { id: 'maestro', label: 'Maestro / Variantes' },
  { id: 'modelo', label: 'Modelo / Parámetros' },
  { id: 'bocas', label: 'Bocas / Asociaciones' },
  { id: 'orientacion', label: 'Orientación / Colocación' },
  { id: 'continuaciones', label: 'Continuaciones / Compatibilidad' },
  { id: 'prueba', label: 'Configuración actual / Patrón aprobado' },
  { id: 'calibracion', label: 'Calibración visual' },
  { id: 'procedencia', label: 'Procedencia / Historial' },
] as const;
export type TabId = typeof TABS[number]['id'];

// ─── Producto / Familia ─────────────────────────────────────────────────────

/**
 * AporteSection — configuración del aporte al trazado por producto.
 *
 * IMPORTANTE: es configuración persistente — NO está integrada al cómputo real
 * todavía. La UI lo marca con el banner "configuración · no integrada al
 * cómputo aún" para que el usuario no la confunda con totales activos. Se
 * guarda y viaja con el proyecto (`codex:catalogConfig/1`) para que cuando se
 * cablee al motor el proyecto ya tenga las reglas declaradas.
 */
function AporteSection({ product }: { product: Product }) {
  // Suscribimos aporteOverrides para refrescar al editar; usamos el selector de
  // store para derivar la regla efectiva (override o default-por-maestro).
  const aporteOverrides = useCatalogConfigStore((s) => s.aporteOverrides);
  const upsertAporte = useCatalogConfigStore((s) => s.upsertAporte);
  const removeAporte = useCatalogConfigStore((s) => s.removeAporte);
  const getEffectiveAporte = useCatalogConfigStore((s) => s.getEffectiveAporte);

  const master = useMemo(
    () => findMasterForProduct(product as unknown as Record<string, unknown>),
    [product],
  );
  // Reference aporteOverrides so this re-renders on upsert/remove.
  void aporteOverrides;
  const effective = getEffectiveAporte(product.producto_id, master);
  const hasOverride = product.producto_id in aporteOverrides;

  // Draft local mientras el usuario edita. Inicializamos desde el efectivo
  // (override o default); si no hay maestro, usamos 'longitud' como hipótesis
  // conservadora. No se persiste hasta tocar "Guardar".
  const initial = effective?.rule ?? { kind: 'longitud' as AporteRuleKind };
  const [kind, setKind] = useState<AporteRuleKind>(initial.kind);
  const [multiplier, setMultiplier] = useState<string>(
    String(initial.kind === 'multiplo-ancho' ? initial.multiplier ?? 2 : 2),
  );
  const [valueMm, setValueMm] = useState<string>(
    String(initial.kind === 'fijo-mm' ? initial.valueMm ?? 0 : 0),
  );
  const [error, setError] = useState<string | null>(null);

  // Al cambiar de producto, resetear el draft al efectivo del nuevo producto.
  useEffect(() => {
    const r = effective?.rule ?? { kind: 'longitud' as AporteRuleKind };
    setKind(r.kind);
    setMultiplier(String(r.kind === 'multiplo-ancho' ? r.multiplier ?? 2 : 2));
    setValueMm(String(r.kind === 'fijo-mm' ? r.valueMm ?? 0 : 0));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.producto_id]);

  const handleSave = () => {
    const rule: AporteRule = (() => {
      if (kind === 'multiplo-ancho') {
        const m = Number(multiplier);
        return { kind, multiplier: m };
      }
      if (kind === 'fijo-mm') {
        const v = Number(valueMm);
        return { kind, valueMm: v };
      }
      return { kind };
    })();
    if (!isAporteRule(rule)) {
      setError('Regla inválida: revisá el multiplicador o el valor fijo.');
      return;
    }
    upsertAporte(product.producto_id, rule);
    setError(null);
  };

  const handleReset = () => {
    removeAporte(product.producto_id);
    setError(null);
  };

  const effectiveLabel = effective ? aporteRuleLabel(effective.rule) : '—';
  const sourceLabel = effective?.source === 'override' ? 'override' : 'default';

  return (
    <section data-testid="cfg-aporte-section">
      <h3 className="cfg-section-title">Aporte al trazado</h3>
      <div
        className="cfg-tab-note cfg-tab-note-override"
        data-testid="cfg-aporte-not-wired-banner"
      >
        <strong>Configuración · no integrada al cómputo aún.</strong>
        {' '}
        Se guarda con el proyecto y espera a ser cableada al motor. Editarlo
        hoy deja la regla declarada para cuando se habilite el cómputo activo.
      </div>

      {!master && (
        <div className="cfg-tab-hint" style={{ margin: '4px 0' }}>
          Producto sin maestro asociado — el default no se puede derivar.
          Podés configurar un override explícito igual.
        </div>
      )}

      {master && (
        <div className="cfg-tab-hint" style={{ margin: '4px 0' }}>
          Default por maestro (<code>{master.pieceKind}</code>):
          {' '}
          <strong>{aporteRuleLabel(defaultAporteForMaster(master))}</strong>.
        </div>
      )}

      <dl className="cfg-kv">
        <dt>Regla efectiva</dt>
        <dd data-testid="cfg-aporte-effective">
          {effectiveLabel}
          {' '}
          <span className="cfg-tab-hint">(fuente: {sourceLabel})</span>
        </dd>
      </dl>

      <label className="cfg-field">
        <span className="cfg-field-label">Tipo de aporte</span>
        <select
          className="cfg-filter-select"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as AporteRuleKind);
            setError(null);
          }}
          data-testid="cfg-aporte-kind"
        >
          <option value="longitud">Por longitud del segmento</option>
          <option value="multiplo-ancho">Múltiplo del ancho del patrón</option>
          <option value="fijo-mm">Valor fijo en mm</option>
        </select>
      </label>

      {kind === 'multiplo-ancho' && (
        <label className="cfg-field">
          <span className="cfg-field-label">Multiplicador (× ancho)</span>
          <input
            type="number"
            step={0.1}
            min={0.1}
            value={multiplier}
            onChange={(e) => { setMultiplier(e.target.value); setError(null); }}
            className="cfg-filter-input"
            data-testid="cfg-aporte-multiplier"
          />
        </label>
      )}

      {kind === 'fijo-mm' && (
        <label className="cfg-field">
          <span className="cfg-field-label">Valor fijo (mm)</span>
          <input
            type="number"
            step={1}
            min={1}
            value={valueMm}
            onChange={(e) => { setValueMm(e.target.value); setError(null); }}
            className="cfg-filter-input"
            data-testid="cfg-aporte-value-mm"
          />
        </label>
      )}

      {error && <div className="cfg-tab-note cfg-tab-note-error">{error}</div>}

      <div className="cfg-actions">
        <button
          type="button"
          className="cfg-btn cfg-btn-primary"
          onClick={handleSave}
          data-testid="cfg-aporte-save"
        >
          Guardar override
        </button>
        {hasOverride && (
          <button
            type="button"
            className="cfg-btn cfg-btn-danger"
            onClick={handleReset}
            data-testid="cfg-aporte-reset"
          >
            Volver al default
          </button>
        )}
      </div>
    </section>
  );
}

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

      <AporteSection product={product} />
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
  // m1c: sin mapping explícito, las bocas salen del patrón (maestro) del producto.
  const masterEntries = useMemo(() => getMasterPortEntries(product.producto_id), [product.producto_id]);
  const entries = effective?.entries ?? defaultEntries ?? masterEntries;

  const ancho = product.ancho_nominal_mm;
  const perPort = useMemo(() => {
    return entries.map((e) => {
      const compat = getCompatibleProductIds(
        compatibilidades as CatalogCompatibility[],
        product.producto_id,
        e.recipePortName,
      );
      const calib = getPortCompatibility(compatibilidades as CatalogCompatibility[], product.producto_id, e.recipePortName);
      const uncalibrated = calib.status === 'uncalibrated' ? calib.reason : null;
      const compatProducts = productos.filter((p) => compat.has(p.producto_id));
      const sameAnchoNoCompat = productos.filter((p) =>
        !compat.has(p.producto_id) &&
        p.producto_id !== product.producto_id &&
        ancho != null && p.ancho_nominal_mm === ancho,
      );
      return { entry: e, compatProducts, sameAnchoNoCompat, uncalibrated };
    });
  }, [entries, compatibilidades, productos, product.producto_id, ancho]);

  if (entries.length === 0) {
    return (
      <div className="cfg-tab-content">
        <div className="cfg-tab-note">
          Sin calibración de bocas: este producto no tiene mapping declarado
          (default ni override) ni un patrón (maestro) que lo resuelva. Modelo no
          resuelto. Agregá un mapping desde la pestaña "Bocas / Asociaciones".
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

      {perPort.map(({ entry: e, compatProducts, sameAnchoNoCompat, uncalibrated }) => (
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
          {uncalibrated ? (
            <div className="cfg-tab-note cfg-tab-note-error" data-testid={`cfg-cont-uncalibrated-${e.recipePortName}`}>
              Sin calibración de bocas — modelo no resuelto: {uncalibrated}.
            </div>
          ) : compatProducts.length > 0 ? (
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

function dimensionLabel(status: DimensionStatus): string {
  switch (status) {
    case 'validated':
      return 'Validado';
    case 'partial':
      return 'Parcial';
    case 'pending':
      return 'Pendiente';
    case 'n/a':
      return 'No aplica';
  }
}

function dimensionBadgeClass(status: DimensionStatus): string {
  switch (status) {
    case 'validated':
      return 'cfg-status-recipe-default-identity';
    case 'partial':
      return 'cfg-status-recipe-default-mapping';
    case 'pending':
      return 'cfg-status-recipe-needs-mapping';
    case 'n/a':
      return 'cfg-status-recipe-override';
  }
}

interface DimensionRowProps {
  readonly dimensionKey: 'continuity' | 'fidelity' | 'variants';
  readonly label: string;
  readonly description: string;
  readonly dimension: ClosureDimension;
}

function ClosureDimensionRow({ dimensionKey, label, description, dimension }: DimensionRowProps) {
  return (
    <section
      data-testid={`cfg-maestro-closure-${dimensionKey}`}
      data-dimension-status={dimension.status}
      style={{ marginBottom: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>{label}</strong>
        <span
          className={`cfg-list-status ${dimensionBadgeClass(dimension.status)}`}
          data-testid={`cfg-maestro-closure-${dimensionKey}-badge`}
          title={description}
        >
          {dimensionLabel(dimension.status)}
        </span>
      </div>
      <div className="cfg-tab-hint" style={{ margin: '2px 0 4px' }}>
        {description}
      </div>
      {dimension.regressionSpecs.length > 0 && (
        <div className="cfg-tab-hint" style={{ margin: '0 0 4px' }}>
          Respaldo:{' '}
          {dimension.regressionSpecs.map((spec, i) => (
            <span key={spec}>
              {i > 0 && ', '}
              <code>{spec}</code>
            </span>
          ))}
        </div>
      )}
      {dimension.limitations.length > 0 && (
        <ul
          className="cfg-tab-hint"
          data-testid={`cfg-maestro-closure-${dimensionKey}-limitations`}
          style={{ margin: '2px 0 0 18px', padding: 0, lineHeight: 1.45 }}
        >
          {dimension.limitations.map((lim, i) => (
            <li key={i}>{lim}</li>
          ))}
        </ul>
      )}
    </section>
  );
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
      <div className="cfg-tab-hint" style={{ marginBottom: 8 }}>
        El cierre se desglosa en tres dimensiones ortogonales. Un patrón sólo
        queda totalmente cerrado cuando las tres están validadas (o no aplican).
      </div>
      <div data-testid="cfg-maestro-closure">
        <ClosureDimensionRow
          dimensionKey="continuity"
          label="Continuidad"
          description="Flush de bocas con rectos de referencia para todas las bocas documentadas del patrón."
          dimension={master.closure.continuity}
        />
        <ClosureDimensionRow
          dimensionKey="fidelity"
          label="Fidelidad geométrica"
          description="Cada boca está sobre la cara física correcta del polígono medido, no solo marcos ortonormales."
          dimension={master.closure.fidelity}
        />
        <ClosureDimensionRow
          dimensionKey="variants"
          label="Variantes"
          description="La regla de ancho/ala se comprueba end-to-end: configurador → preview → confirmado → recuperación."
          dimension={master.closure.variants}
        />
      </div>

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

// ─── Configuración actual / Patrón aprobado ─────────────────────────────────

/**
 * PruebaTab — diff operativo entre la "configuración actual" (lo que el store
 * usa ahora mismo para cada placement/preview) y el "patrón aprobado" (snapshot
 * capturado al aprobar). Se usa para que el usuario entienda EXACTAMENTE qué
 * cambió desde la última validación cuando el banner marca "desactualizada",
 * o para verificar antes de revalidar que las ediciones son las esperadas.
 *
 * NO es la comparación visual preview-de-inserción vs pieza-confirmada en el
 * workspace — esa invariante se verifica con el harness Playwright
 * `e2e/previewConfirmedPipeline.visual.spec.ts` recorriendo los pipelines
 * reales. Este tab trabaja sólo sobre configuración persistente.
 *
 * Estados:
 *   - Aprobado + snapshot presente: tabla de diffs (modelFrame + por boca).
 *   - Aprobado sin snapshot (archivo legacy pre-hito-3): hint para revalidar.
 *   - Sin aprobación: muestra que no hay baseline y sugiere aprobar primero.
 *
 * NOTA: NO modifica el mapping ni la aprobación — es sólo visualización. La
 * aplicación efectiva de cambios ocurre al "Revalidar aprobación" desde el
 * banner, que es la única puerta para congelar un nuevo snapshot.
 */
function PortDiffRow({ port }: { port: PortEntryDiff }) {
  if (port.kind === 'unchanged') {
    return (
      <tr data-testid={`cfg-prueba-port-${port.recipePortName}`} data-kind="unchanged">
        <td>
          <code>{port.recipePortName}</code>
        </td>
        <td colSpan={3} className="cfg-tab-hint">
          sin cambios
        </td>
      </tr>
    );
  }
  if (port.kind === 'added' || port.kind === 'removed') {
    const label = port.kind === 'added' ? 'Boca nueva en preview' : 'Boca removida en preview';
    return (
      <tr data-testid={`cfg-prueba-port-${port.recipePortName}`} data-kind={port.kind}>
        <td>
          <code>{port.recipePortName}</code>
        </td>
        <td colSpan={3} className="cfg-tab-note cfg-tab-note-warning">
          {label}
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr data-testid={`cfg-prueba-port-${port.recipePortName}`} data-kind="changed">
        <td rowSpan={1 + port.stringChanges.length + port.scalarChanges.length + port.vectorChanges.length}>
          <code>{port.recipePortName}</code>
        </td>
        <td className="cfg-tab-hint" colSpan={3}>
          {port.stringChanges.length + port.scalarChanges.length + port.vectorChanges.length} campo(s) con cambio
        </td>
      </tr>
      {port.stringChanges.map((s) => (
        <tr key={`s-${s.field}`}>
          <td>{s.field}</td>
          <td>{s.preview}</td>
          <td>{s.confirmado}</td>
        </tr>
      ))}
      {port.scalarChanges.map((sc) => (
        <tr key={`sc-${sc.field}`}>
          <td>{sc.field}</td>
          <td>{sc.preview.toFixed(3)}</td>
          <td>{sc.confirmado.toFixed(3)}</td>
        </tr>
      ))}
      {port.vectorChanges.map((v) => (
        <tr key={`v-${v.field}`}>
          <td>{v.field}</td>
          <td>{vec3Str(v.preview)}</td>
          <td>{vec3Str(v.confirmado)}</td>
        </tr>
      ))}
    </>
  );
}

function PruebaTab({ product }: { product: Product }) {
  // Refresh when overrides or approvals change (either side of the diff).
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const approvals = useCatalogConfigStore((s) => s.approvals);
  void overrides;
  void approvals;

  const previewMapping = useMemo(
    () => getEffectiveMapping(product.producto_id),
    // overrides is referenced to trigger refresh on edits
    [product.producto_id, overrides],
  );
  const approval = approvals[product.producto_id];
  const confirmadoMapping = approval?.approvedMapping ?? null;

  const diff: MappingDiff | null = useMemo(() => {
    if (!confirmadoMapping) return null;
    return diffMappings(previewMapping, confirmadoMapping);
  }, [previewMapping, confirmadoMapping]);

  const currentHash = calibrationHash(previewMapping);
  const confirmadoHash = approval?.approvedAtCalibrationHash;

  if (!approval) {
    return (
      <div className="cfg-tab-content" data-testid="cfg-prueba-tab">
        <h3 className="cfg-section-title">Configuración actual / Patrón aprobado</h3>
        <div className="cfg-tab-note">
          Aún no aprobaste este patrón — no hay baseline "confirmado" para comparar. Ajustá el mapping
          en las pestañas Orientación / Bocas y usá el banner superior para aprobar; a partir de ahí
          este diff te muestra qué cambia cada edición.
        </div>
        <h4 className="cfg-section-title">Estado actual (preview)</h4>
        <dl className="cfg-kv">
          <dt>Hash de calibración</dt>
          <dd>
            <code data-testid="cfg-prueba-current-hash">{currentHash}</code>
          </dd>
          <dt>Origen del mapping</dt>
          <dd>
            <code>{previewMapping?.source ?? '—'}</code>
          </dd>
        </dl>
      </div>
    );
  }

  if (!confirmadoMapping) {
    return (
      <div className="cfg-tab-content" data-testid="cfg-prueba-tab">
        <h3 className="cfg-section-title">Configuración actual / Patrón aprobado</h3>
        <div className="cfg-tab-note cfg-tab-note-warning" data-testid="cfg-prueba-legacy">
          Esta aprobación es anterior a hito 3 y no tiene snapshot del mapping confirmado. Revalidá
          la aprobación desde el banner para habilitar el diff detallado (los cambios futuros sí
          quedarán comparables).
        </div>
        <dl className="cfg-kv">
          <dt>Hash aprobado</dt>
          <dd>
            <code>{confirmadoHash}</code>
          </dd>
          <dt>Hash actual</dt>
          <dd>
            <code data-testid="cfg-prueba-current-hash">{currentHash}</code>
          </dd>
        </dl>
      </div>
    );
  }

  const hashesMatch = currentHash === confirmadoHash;
  const changesLabel = diff?.hasChanges ? 'con diferencias' : 'coincide';

  return (
    <div className="cfg-tab-content" data-testid="cfg-prueba-tab">
      <h3 className="cfg-section-title">Configuración actual / Patrón aprobado</h3>
      <div
        className={`cfg-tab-note ${hashesMatch ? '' : 'cfg-tab-note-warning'}`}
        data-testid="cfg-prueba-status"
        data-hashes-match={hashesMatch ? 'true' : 'false'}
      >
        {hashesMatch
          ? `El mapping preview coincide con el confirmado (hash ${currentHash}). Este producto se
             comportará en preview, confirmado y recuperación exactamente como fue aprobado.`
          : `El mapping preview difiere del confirmado (preview ${currentHash} vs confirmado ${confirmadoHash}).
             Los cambios listados abajo sólo afectarán a los nuevos placements — las piezas ya colocadas
             se re-resuelven con el mapping actual al recargar. Revalidá la aprobación para congelar el
             nuevo baseline.`}
      </div>

      <h4 className="cfg-section-title">Marco del modelo (modelFrame) · {diff?.modelFrame.changed ? 'con cambios' : 'sin cambios'}</h4>
      {diff && diff.modelFrame.changed ? (
        <table className="cfg-table" data-testid="cfg-prueba-model-frame">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Preview</th>
              <th>Confirmado</th>
            </tr>
          </thead>
          <tbody>
            {diff.modelFrame.deltas.map((d) => (
              <tr key={d.field}>
                <td>{d.field}</td>
                <td>{d.preview.toFixed(3)}</td>
                <td>{d.confirmado.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="cfg-tab-hint">
          Marco del modelo sin diferencias (tx/ty/tz/rx/ry/rz idénticos dentro de tolerancia 1e-6).
        </div>
      )}

      <h4 className="cfg-section-title">Bocas · {changesLabel}</h4>
      <table className="cfg-table" data-testid="cfg-prueba-ports">
        <thead>
          <tr>
            <th>Boca</th>
            <th>Campo</th>
            <th>Preview</th>
            <th>Confirmado</th>
          </tr>
        </thead>
        <tbody>
          {diff?.ports.map((p) => <PortDiffRow key={p.recipePortName} port={p} />)}
        </tbody>
      </table>

      <dl className="cfg-kv" style={{ marginTop: 12 }}>
        <dt>Aprobado en revisión</dt>
        <dd>
          <code>{approval.approvedAtRevision}</code> · {approval.approvedAt.slice(0, 10)}
        </dd>
        <dt>Origen preview</dt>
        <dd>
          <code>{previewMapping?.source ?? '—'}</code>
          {previewMapping?.inheritedFromProductId && (
            <> (de <code>{previewMapping.inheritedFromProductId}</code>)</>
          )}
        </dd>
      </dl>
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
    prueba: '',
    calibracion: '',
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
  if (tab === 'orientacion') return <CalibracionPatronTab product={product} />;
  if (tab === 'continuaciones') {
    return (
      <ContinuacionesTab
        product={product}
        productos={productos}
        compatibilidades={compatibilidades}
      />
    );
  }
  if (tab === 'prueba') return <PruebaTab product={product} />;
  if (tab === 'calibracion') return <CalibrationPlayground product={product} />;
  return <PlaceholderTab tab={tab} />;
}
