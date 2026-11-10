/**
 * ConfiguratorLayout — Configurador central de modelos, productos y conexiones.
 *
 * Objetivo: página autocontenida accesible desde el workspace ("Configuración
 * de biblioteca") con layout de 3 paneles:
 *   ├─ Izquierda: lista filtrable del catálogo (producto + familia + estado).
 *   ├─ Centro:    visor 3D del modelo seleccionado (original / configurado /
 *   │            comparación). Reutiliza los mismos componentes que el
 *   │            workspace para que preview y confirmado compartan pipeline.
 *   └─ Derecha:   inspector con 7 pestañas (Producto/Familia, Modelo,
 *                Bocas/Asociaciones, Orientación, Continuaciones, Prueba,
 *                Procedencia). Cada pestaña se desarrolla en tareas siguientes.
 *
 * En este scaffold inicial se dejan contenidos "placeholder" en el visor y en
 * la mayoría de pestañas. Lo que SÍ queda funcional:
 *   - La lista con búsqueda (nombre/SKU/producto_id) y filtros por
 *     tipo_pieza y familia geométrica.
 *   - La selección de un producto se refleja en el panel derecho (la
 *     pestaña activa recibe el `productoId` seleccionado).
 *   - Navegación: botón "← Volver al editor" que preserva la URL original.
 *
 * El objetivo inmediato NO es editar bocas todavía (tarea #89) sino tener la
 * ruta montada, el estado de selección, los filtros, y que `tray.initialize()`
 * poblé el catálogo sin que el configurador necesite scene ni motor.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrayStore } from '../tray/store';
import type { Product, CatalogFamily } from '../tray/model';
import {
  getModelFrameOverride,
  getPortGeometryOverride,
  listOverriddenProductIds,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';
import { resolveParametricEntry } from '../workspace/parametricBridge';
import { useCatalogConfigStore } from './catalogConfigStore';
import { InspectorTabContent, TABS, type TabId } from './ConfiguratorInspectorTabs';
import { ConfiguratorViewer } from './ConfiguratorViewer';
import { findMasterForProduct, type MasterModel } from './masterModels';
import {
  classifyAll,
  listCommercialAssociates,
  type PatternClassification,
  type PatternKind,
} from './patternClassification';
import { classifySistema, SISTEMAS, type Sistema } from './sistemaClassifier';
import {
  classifyProductMapping,
  type MappingStatus,
} from './productMappingStatus';
import {
  applyCascade,
  buildFamiliasById,
  computeFilterOptions,
  EMPTY_FILTERS as EMPTY_BASE_FILTERS,
  familiaIdOf,
  formatAcabadoOption,
  formatAlaOption,
  formatAnchoOption,
  formatEspesorOption,
  matchesFilter as matchesBaseFilter,
  type Filters as BaseFilters,
  type FilterOptions,
} from './productFilters';
import './configurator.css';

// Filtros del Configurador = cascada compartida + filtro extra `estado` que es
// específico de esta vista (semántica de mapping por producto). El base vive en
// `productFilters.ts` para que el workspace (AddTraySegmentForm) use el mismo
// motor de cascada sin duplicar reglas.
interface Filters extends BaseFilters {
  estado: MappingStatus | '';
}

const EMPTY_FILTERS: Filters = { ...EMPTY_BASE_FILTERS, estado: '' };

/**
 * Modo de vista del Configurador (hito 4):
 *   - 'all'      : lista plana — todos los productos (compatibilidad con hitos
 *                  previos).
 *   - 'patterns' : sólo patrones base — UNO por maestro. Lo que el usuario
 *                  debe calibrar y aprobar.
 *   - 'variants' : sólo variantes dimensionales generadas — se comprueban, no
 *                  se calibran.
 */
type ViewMode = 'all' | 'patterns' | 'variants';

function keepForViewMode(kind: PatternKind, mode: ViewMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'patterns') return kind === 'pattern';
  return kind === 'variant';
}

function patternKindLabel(kind: PatternKind): string {
  switch (kind) {
    case 'pattern':
      return 'Patrón';
    case 'variant':
      return 'Variante';
    case 'commercial-associate':
      return 'Asociado';
    case 'orphan':
      return '—';
  }
}

function matchesFilter(
  p: Product,
  f: Filters,
  familiasById: Map<string, CatalogFamily>,
): boolean {
  if (!matchesBaseFilter(p, f, familiasById)) return false;
  if (f.estado && classifyProductMapping(p).status !== f.estado) return false;
  return true;
}

function ProductList({
  products,
  selected,
  onSelect,
  filters,
  setFilters,
  options,
  familiasById,
  viewMode,
  setViewMode,
  classifications,
}: {
  products: readonly Product[];
  selected: string | null;
  onSelect: (id: string) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  options: FilterOptions;
  familiasById: Map<string, CatalogFamily>;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  classifications: Map<string, PatternClassification>;
}) {
  // Subscribe to overrides so mapping badges + filter re-run on upsert/remove.
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const visible = useMemo(
    () =>
      products.filter((p) => {
        if (!matchesFilter(p, filters, familiasById)) return false;
        const kind = classifications.get(p.producto_id)?.kind ?? 'orphan';
        return keepForViewMode(kind, viewMode);
      }),
    [products, filters, overrides, familiasById, viewMode, classifications],
  );

  // Conteos por modo de vista (sobre la lista base, para mostrar distribución
  // real aunque el usuario tenga filtros aplicados).
  const viewModeCounts = useMemo(() => {
    let patterns = 0;
    let variants = 0;
    for (const p of products) {
      const kind = classifications.get(p.producto_id)?.kind ?? 'orphan';
      if (kind === 'pattern') patterns++;
      else if (kind === 'variant') variants++;
    }
    return { patterns, variants, all: products.length };
  }, [products, classifications]);

  // Conteos por sistema para el UI jerárquico. Se recalculan sobre el conjunto
  // base (todos los productos) para que el usuario siempre vea la distribución
  // completa aunque aplique otros filtros.
  const sistemaCounts = useMemo(() => {
    const m = new Map<Sistema, number>();
    for (const p of products) {
      const s = classifySistema(familiaIdOf(p));
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [products]);

  const hasAnyFilter =
    filters.text || filters.sistema || filters.tipoPieza || filters.ancho ||
    filters.ala || filters.acabado || filters.espesor || filters.estado;

  return (
    <aside className="cfg-panel cfg-panel-left">
      <div className="cfg-panel-title">Catálogo</div>
      <div className="cfg-viewmode" role="tablist" aria-label="Modo de vista">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'all'}
          className={`cfg-viewmode-btn ${viewMode === 'all' ? 'is-active' : ''}`}
          onClick={() => setViewMode('all')}
          data-testid="cfg-viewmode-all"
        >
          Todos ({viewModeCounts.all})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'patterns'}
          className={`cfg-viewmode-btn ${viewMode === 'patterns' ? 'is-active' : ''}`}
          onClick={() => setViewMode('patterns')}
          data-testid="cfg-viewmode-patterns"
          title="Modelos fuente que requieren calibración del usuario"
        >
          Patrones base ({viewModeCounts.patterns})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'variants'}
          className={`cfg-viewmode-btn ${viewMode === 'variants' ? 'is-active' : ''}`}
          onClick={() => setViewMode('variants')}
          data-testid="cfg-viewmode-variants"
          title="Productos derivados que se comprueban, no se calibran"
        >
          Variantes ({viewModeCounts.variants})
        </button>
      </div>
      <div className="cfg-filters">
        <select
          value={filters.sistema}
          onChange={(e) => setFilters({
            ...applyCascade(filters, 'sistema', e.target.value),
            estado: filters.estado,
          })}
          className="cfg-filter-select"
          aria-label="Filtrar por sistema"
          data-testid="cfg-filter-sistema"
        >
          <option value="">Todos los sistemas</option>
          {SISTEMAS.map((s) => {
            const n = sistemaCounts.get(s.id) ?? 0;
            return (
              <option key={s.id} value={s.id} disabled={n === 0}>
                {s.label} ({n})
              </option>
            );
          })}
        </select>
        <select
          value={filters.tipoPieza}
          onChange={(e) => setFilters({
            ...applyCascade(filters, 'tipoPieza', e.target.value),
            estado: filters.estado,
          })}
          className="cfg-filter-select"
          aria-label="Filtrar por tipo de pieza"
          data-testid="cfg-filter-tipo"
        >
          <option value="">Todos los tipos</option>
          {options.tiposPieza.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filters.ancho}
          onChange={(e) => setFilters({
            ...applyCascade(filters, 'ancho', e.target.value),
            estado: filters.estado,
          })}
          className="cfg-filter-select"
          aria-label="Filtrar por ancho nominal"
          data-testid="cfg-filter-ancho"
        >
          <option value="">Todos los anchos</option>
          {options.anchos.map((w) => (
            <option key={w} value={w}>{formatAnchoOption(w)}</option>
          ))}
        </select>
        <select
          value={filters.ala}
          onChange={(e) => setFilters({
            ...applyCascade(filters, 'ala', e.target.value),
            estado: filters.estado,
          })}
          className="cfg-filter-select"
          aria-label="Filtrar por ala nominal"
          data-testid="cfg-filter-ala"
        >
          <option value="">Todas las alas</option>
          {options.alas.map((a) => (
            <option key={a} value={a}>{formatAlaOption(a)}</option>
          ))}
        </select>
        <select
          value={filters.acabado}
          onChange={(e) => setFilters({
            ...applyCascade(filters, 'acabado', e.target.value),
            estado: filters.estado,
          })}
          className="cfg-filter-select"
          aria-label="Filtrar por acabado"
          data-testid="cfg-filter-acabado"
        >
          <option value="">Todos los acabados</option>
          {options.acabados.map((a) => (
            <option key={a} value={a}>{formatAcabadoOption(a)}</option>
          ))}
        </select>
        <select
          value={filters.espesor}
          onChange={(e) => setFilters({ ...filters, espesor: e.target.value })}
          className="cfg-filter-select"
          aria-label="Filtrar por espesor"
          data-testid="cfg-filter-espesor"
        >
          <option value="">Todos los espesores</option>
          {options.espesores.map((s) => (
            <option key={s} value={s}>{formatEspesorOption(s)}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar nombre, SKU o producto_id…"
          value={filters.text}
          onChange={(e) => setFilters({ ...filters, text: e.target.value })}
          className="cfg-filter-input"
          aria-label="Buscar productos"
          data-testid="cfg-filter-text"
        />
        <select
          value={filters.estado}
          onChange={(e) => setFilters({ ...filters, estado: e.target.value as MappingStatus | '' })}
          className="cfg-filter-select"
          aria-label="Filtrar por estado de mapping"
          data-testid="cfg-filter-estado"
        >
          <option value="">Cualquier estado</option>
          <option value="no-recipe">Sin receta</option>
          <option value="recipe-not-ready">Receta no habilitada</option>
          <option value="recipe-default-identity">Mapping identidad</option>
          <option value="recipe-default-mapping">Mapping por defecto</option>
          <option value="recipe-override">Override de proyecto</option>
          <option value="recipe-needs-mapping">Falta mapping</option>
        </select>
        {hasAnyFilter && (
          <button
            type="button"
            className="cfg-btn"
            onClick={() => setFilters(EMPTY_FILTERS)}
            data-testid="cfg-filter-clear"
          >
            Limpiar filtros
          </button>
        )}
      </div>
      <div className="cfg-list-meta">{visible.length} de {products.length} productos</div>
      <ul className="cfg-list">
        {visible.map((p) => {
          const info = classifyProductMapping(p);
          const kind = classifications.get(p.producto_id)?.kind ?? 'orphan';
          return (
            <li key={p.producto_id}>
              <button
                type="button"
                className={`cfg-list-item ${selected === p.producto_id ? 'is-active' : ''}`}
                onClick={() => onSelect(p.producto_id)}
                data-testid={`cfg-product-${p.producto_id}`}
                data-status={info.status}
                data-kind={kind}
                title={info.cause}
              >
                <span className="cfg-list-sku">{p.sku}</span>
                <span className="cfg-list-tipo">{p.tipo_pieza}</span>
                <span className={`cfg-list-kind cfg-kind-${kind}`} data-testid={`cfg-kind-${p.producto_id}`}>
                  {patternKindLabel(kind)}
                </span>
                <span className={`cfg-list-status cfg-status-${info.status}`}>
                  {info.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ApprovalBanner({ product }: { product: Product | null }) {
  // Subscribe to overrides so the hash refreshes when the user calibrates.
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const approvals = useCatalogConfigStore((s) => s.approvals);
  const approve = useCatalogConfigStore((s) => s.approveProduct);
  const revoke = useCatalogConfigStore((s) => s.revokeApproval);
  const getInfo = useCatalogConfigStore((s) => s.getApprovalInfo);

  if (!product) return null;

  const master = findMasterForProduct(product);
  // Reference `overrides` + `approvals` so the memo re-runs when they change.
  void overrides;
  void approvals;
  const info = getInfo(product.producto_id, master?.revision);

  const onApprove = () => {
    if (!master) return;
    approve(product.producto_id, master.revision);
  };
  const onRevoke = () => revoke(product.producto_id);

  const label =
    info.status === 'current'
      ? `Aprobado · revisión ${info.stored!.approvedAtRevision}`
      : info.status === 'outdated'
        ? `Aprobación desactualizada (revisión ${info.stored!.approvedAtRevision} → ${info.currentRevision ?? '?'})`
        : 'Sin aprobar';

  const detail =
    info.status === 'current'
      ? `Hash de calibración ${info.stored!.approvedAtCalibrationHash} · ${info.stored!.approvedAt.slice(0, 10)}`
      : info.status === 'outdated'
        ? info.outdatedReason === 'revision-changed'
          ? 'Cambió la revisión del maestro desde la aprobación. Revalidar.'
          : info.outdatedReason === 'calibration-changed'
            ? 'Cambió la calibración (bocas, geometría o marco) desde la aprobación. Revalidar.'
            : 'Cambiaron revisión y calibración desde la aprobación. Revalidar.'
        : master
          ? 'Calibrar el patrón y luego aprobar para habilitarlo aguas abajo.'
          : 'Este producto no mapea a un maestro — no se puede aprobar.';

  return (
    <div
      className="cfg-approval-banner"
      data-status={info.status}
      data-testid="cfg-approval-banner"
    >
      <span className="cfg-approval-label" data-testid="cfg-approval-label">
        {label}
      </span>
      <div className="cfg-approval-actions">
        {info.status !== 'current' && (
          <button
            type="button"
            className="cfg-btn cfg-btn-primary"
            onClick={onApprove}
            disabled={!master}
            data-testid="cfg-approve-btn"
          >
            {info.status === 'outdated' ? 'Revalidar aprobación' : 'Aprobar patrón'}
          </button>
        )}
        {info.status !== 'none' && (
          <button
            type="button"
            className="cfg-btn cfg-btn-danger"
            onClick={onRevoke}
            data-testid="cfg-revoke-btn"
          >
            Revocar
          </button>
        )}
      </div>
      <span className="cfg-approval-detail">{detail}</span>
    </div>
  );
}

function Inspector({
  product,
  classification,
  onNavigateTo,
}: {
  product: Product | null;
  classification: PatternClassification | null;
  onNavigateTo: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('producto');
  const context = useTrayStore((s) => s.context);
  const familias = context?.familias ?? [];
  const puertos = context?.puertos ?? [];
  const productos = context?.productos ?? [];
  const compatibilidades = context?.compatibilidades ?? [];
  return (
    <aside className="cfg-panel cfg-panel-right">
      <div className="cfg-panel-title">Inspector</div>
      <ClassificationBanner
        product={product}
        classification={classification}
        onNavigateTo={onNavigateTo}
      />
      <ApprovalBanner product={product} />
      <nav className="cfg-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`cfg-tab-button ${activeTab === t.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            data-testid={`cfg-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="cfg-tab-panel" role="tabpanel">
        <InspectorTabContent
          tab={activeTab}
          product={product}
          familias={familias}
          puertos={puertos}
          productos={productos}
          compatibilidades={compatibilidades}
        />
      </div>
    </aside>
  );
}

/**
 * Banner que informa, para el producto seleccionado, si es patrón base, un
 * asociado comercial o una variante generada. Para las variantes muestra:
 * origen (patrón), delta de dimensiones, regla+procedencia+revisión, y un
 * botón "Ir al patrón" que mueve la selección al patrón canónico. Si el
 * patrón de origen no está aprobado, aparece una advertencia.
 */
function ClassificationBanner({
  product,
  classification,
  onNavigateTo,
}: {
  product: Product | null;
  classification: PatternClassification | null;
  onNavigateTo: (id: string) => void;
}) {
  // Suscribir a aprobaciones para que la advertencia de patrón se actualice.
  const approvals = useCatalogConfigStore((s) => s.approvals);
  const getInfo = useCatalogConfigStore((s) => s.getApprovalInfo);
  void approvals;

  if (!product || !classification) return null;
  const { kind, master, variant, canonicalPatternProductId } = classification;

  if (kind === 'orphan') {
    return (
      <div className="cfg-class-banner" data-kind="orphan" data-testid="cfg-class-banner">
        <span className="cfg-class-label">Sin cobertura paramétrica</span>
        <span className="cfg-class-detail">
          {master
            ? 'La combinación de dimensiones no está cubierta por la regla del maestro — requiere STEP propio.'
            : 'No hay maestro asociado para la familia / tipo de pieza de este producto.'}
        </span>
      </div>
    );
  }

  if (kind === 'pattern') {
    return (
      <PatternBanner product={product} master={master!} onNavigateTo={onNavigateTo} />
    );
  }

  if (kind === 'commercial-associate') {
    return (
      <div
        className="cfg-class-banner"
        data-kind="commercial-associate"
        data-testid="cfg-class-banner"
      >
        <span className="cfg-class-label">Asociado comercial del patrón {master!.label}</span>
        <span className="cfg-class-detail">
          Misma geometría que el patrón, distinto material/acabado/espesor. La calibración se
          hereda del patrón canónico — no se calibra por separado.
        </span>
        {canonicalPatternProductId && canonicalPatternProductId !== product.producto_id && (
          <div className="cfg-class-actions">
            <button
              type="button"
              className="cfg-btn"
              onClick={() => onNavigateTo(canonicalPatternProductId)}
              data-testid="cfg-class-goto-pattern"
            >
              Ir al patrón ({canonicalPatternProductId})
            </button>
          </div>
        )}
      </div>
    );
  }

  // kind === 'variant'
  const rule = master!.variationRule;
  const patternApproval = canonicalPatternProductId
    ? getInfo(canonicalPatternProductId, master!.revision)
    : null;
  const patternPending = patternApproval?.status !== 'current';

  return (
    <div className="cfg-class-banner" data-kind="variant" data-testid="cfg-class-banner">
      <span className="cfg-class-label">
        Variante generada desde {master!.label}
      </span>
      <span className="cfg-class-detail">
        Origen {master!.baseParams.ancho_mm} × {master!.baseParams.ala_mm} mm →
        {' '}
        resultado {variant!.ancho_mm ?? '?'} × {variant!.ala_mm ?? '?'} mm
        {' · '}
        regla <code>{rule.kind}</code> ({rule.provenance}) · revisión {master!.revision}
      </span>
      {patternPending && (
        <span
          className="cfg-class-warning"
          data-testid="cfg-class-pattern-pending"
        >
          ⚠ El patrón de origen {patternApproval?.status === 'none'
            ? 'aún no está aprobado'
            : 'tiene aprobación desactualizada'} —
          la geometría generada puede no ser definitiva.
        </span>
      )}
      {canonicalPatternProductId && (
        <div className="cfg-class-actions">
          <button
            type="button"
            className="cfg-btn"
            onClick={() => onNavigateTo(canonicalPatternProductId)}
            data-testid="cfg-class-goto-pattern"
          >
            Ir al patrón ({canonicalPatternProductId})
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Banner específico para un patrón canónico. Muestra archivo fuente, revisión
 * y dimensiones base, además de la lista de productos asociados comerciales
 * (misma geometría, distinto material/acabado). Cada asociado es clicable
 * para navegar a su ficha, pero el usuario entiende que la calibración vive
 * en el patrón.
 */
function PatternBanner({
  product,
  master,
  onNavigateTo,
}: {
  product: Product;
  master: MasterModel;
  onNavigateTo: (id: string) => void;
}) {
  const productos = useTrayStore((s) => s.context?.productos ?? []);
  const associates = useMemo(
    () => listCommercialAssociates(product, productos),
    [product, productos],
  );
  return (
    <div className="cfg-class-banner" data-kind="pattern" data-testid="cfg-class-banner">
      <span className="cfg-class-label">Patrón base — {master.label}</span>
      <span className="cfg-class-detail">
        Archivo fuente <code>{master.source.stepFile}</code> · revisión {master.revision} ·
        ancho {master.baseParams.ancho_mm} mm · ala {master.baseParams.ala_mm} mm
      </span>
      {associates.length > 0 && (
        <div className="cfg-class-associates" data-testid="cfg-class-associates">
          <span className="cfg-class-detail">
            {associates.length} asociado{associates.length === 1 ? '' : 's'} comercial
            {associates.length === 1 ? '' : 'es'} — misma geometría, distinto material/acabado:
          </span>
          <ul className="cfg-class-associates-list">
            {associates.map((a) => (
              <li key={a.producto_id}>
                <button
                  type="button"
                  className="cfg-class-associate-btn"
                  onClick={() => onNavigateTo(a.producto_id)}
                  data-testid={`cfg-class-associate-${a.producto_id}`}
                >
                  {a.sku}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Export/import del paquete del Configurador (sólo overrides, sin trazado).
 *
 * Usa el formato codex:catalogConfig/1 — compatible con el bloque
 * `catalogConfig` del archivo workspace. Un archivo exportado desde aquí
 * puede importarse en OTRO equipo abriendo el Configurador en ese equipo y
 * seleccionando el archivo; los overrides pasan a formar parte del
 * localStorage local y del próximo export de proyecto.
 *
 * Diseño: el import REEMPLAZA todos los overrides (con confirmación). No se
 * fusiona porque no hay semántica clara para resolver conflictos por
 * producto sin consultar al usuario. Si el archivo trae un override para un
 * producto que ya tenía otro, el del archivo gana.
 */
function ConfigIO() {
  const serialize = useCatalogConfigStore((s) => s.serialize);
  const replaceAll = useCatalogConfigStore((s) => s.replaceAll);
  const replaceApprovals = useCatalogConfigStore((s) => s.replaceApprovals);
  const replaceAporteOverrides = useCatalogConfigStore((s) => s.replaceAporteOverrides);
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const approvals = useCatalogConfigStore((s) => s.approvals);
  const aporteOverrides = useCatalogConfigStore((s) => s.aporteOverrides);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const json = serialize();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalog-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        if (!parsed || typeof parsed !== 'object') throw new Error('No es un objeto JSON');
        const obj = parsed as Record<string, unknown>;
        if (obj.version !== 'codex:catalogConfig/1') {
          throw new Error(`Versión no soportada: ${String(obj.version)}`);
        }
        if (!obj.overrides || typeof obj.overrides !== 'object' || Array.isArray(obj.overrides)) {
          throw new Error('overrides debe ser un objeto');
        }
        const importedOverrides = obj.overrides as Record<string, ProductPortMapping>;
        const importedApprovals =
          obj.approvals && typeof obj.approvals === 'object' && !Array.isArray(obj.approvals)
            ? (obj.approvals as Record<string, Parameters<typeof replaceApprovals>[0][string]>)
            : {};
        const importedAporte =
          obj.aporteOverrides && typeof obj.aporteOverrides === 'object' && !Array.isArray(obj.aporteOverrides)
            ? (obj.aporteOverrides as Record<string, Parameters<typeof replaceAporteOverrides>[0][string]>)
            : {};
        const nOverrides = Object.keys(importedOverrides).length;
        const nApprovals = Object.keys(importedApprovals).length;
        const nAporte = Object.keys(importedAporte).length;
        const msg = `Importar ${nOverrides} override(s), ${nApprovals} aprobación(es) y ${nAporte} regla(s) de aporte desde "${file.name}"? Se reemplazarán los actuales.`;
        if (!confirm(msg)) {
          e.target.value = '';
          return;
        }
        replaceAll(importedOverrides);
        replaceApprovals(importedApprovals);
        replaceAporteOverrides(importedAporte);
      } catch (err) {
        alert(`Error al importar: ${String(err)}`);
      }
      e.target.value = '';
    };
    reader.onerror = () => {
      alert('Error al leer el archivo.');
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const count =
    Object.keys(overrides).length +
    Object.keys(approvals).length +
    Object.keys(aporteOverrides).length;

  const overrideCount = Object.keys(overrides).length;
  const approvalCount = Object.keys(approvals).length;
  const aporteCount = Object.keys(aporteOverrides).length;

  return (
    <div className="cfg-toolbar-io">
      <span className="cfg-toolbar-hint">
        {count === 0
          ? 'Sin configuración'
          : `${overrideCount} override(s) · ${approvalCount} aprob. · ${aporteCount} aporte`}
      </span>
      <button
        type="button"
        className="cfg-btn"
        onClick={handleExport}
        disabled={count === 0}
        data-testid="cfg-io-export"
      >
        Exportar configuración
      </button>
      <button
        type="button"
        className="cfg-btn"
        onClick={() => fileInputRef.current?.click()}
        data-testid="cfg-io-import"
      >
        Importar configuración
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </div>
  );
}

export function ConfiguratorLayout() {
  const context = useTrayStore((s) => s.context);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  useEffect(() => {
    void useTrayStore.getState().initialize();
    // Hidratar overrides del Configurador para que la lista refleje
    // correctamente el estado por producto (default vs override) y el
    // workspace/motor reciban los overrides persistidos sin extra wiring.
    useCatalogConfigStore.getState().hydrate();
    // Dev-only diagnostic hook: expose the same store/trayStore instances
    // the UI uses, so Playwright can read overrides without relying on a
    // dynamic `import()` that Vite may resolve to a second module copy.
    const w = window as typeof window & { __codex?: Record<string, unknown> };
    if (!w.__codex) w.__codex = {};
    w.__codex.catalogConfigStore = useCatalogConfigStore;
    w.__codex.trayStore = useTrayStore;
    // Expose resolver functions from the SAME module instance the UI uses.
    // Why: in Vite dev, a dynamic `import('/src/.../catalogPortMapping.ts')`
    // can resolve to a second module copy (parallel singleton) — tests would
    // then read an empty state. Exposing the functions here guarantees the
    // test sees the exact bindings the configurator Apply button mutated.
    w.__codex.getModelFrameOverride = getModelFrameOverride;
    w.__codex.getPortGeometryOverride = getPortGeometryOverride;
    w.__codex.listOverriddenProductIds = listOverriddenProductIds;
    // Fail-fast helper para E2E: devuelve si existe receta paramétrica para el
    // producto. Permite a Playwright detectar "producto sin receta" antes de
    // esperar 180 s por un Canvas que no va a aparecer — y falla con mensaje
    // útil en vez de time-out.
    w.__codex.hasParametricRecipe = (productId: string): boolean => {
      const ctx = useTrayStore.getState().context;
      const p = ctx?.productos.find((x) => x.producto_id === productId);
      return !!p && !!resolveParametricEntry(p);
    };
    return () => {
      if (w.__codex) {
        delete w.__codex.catalogConfigStore;
        delete w.__codex.trayStore;
        delete w.__codex.getModelFrameOverride;
        delete w.__codex.getPortGeometryOverride;
        delete w.__codex.listOverriddenProductIds;
        delete w.__codex.hasParametricRecipe;
      }
    };
  }, []);

  const products = context?.productos ?? [];
  const familiasById = useMemo(
    () => buildFamiliasById(context?.familias ?? []),
    [context],
  );

  const filterOptions = useMemo<FilterOptions>(
    () => computeFilterOptions(products, filters, familiasById),
    [products, familiasById, filters.sistema, filters.tipoPieza, filters.ancho, filters.ala, filters.acabado],
  );

  const selectedProduct = useMemo(
    () => products.find((p) => p.producto_id === selected) ?? null,
    [products, selected],
  );

  // Clasificación patrón/variante/asociado/huérfano por producto. Se recomputa
  // sólo cuando cambia el snapshot — enumerateVariantsForMaster recorre los
  // 12 maestros y es cacheable por referencia estable de `products`.
  const classifications = useMemo(() => classifyAll(products), [products]);

  return (
    <div className="cfg-root" data-testid="configurator-root">
      <header className="cfg-toolbar">
        <a href="?workspace=bandejas" className="cfg-back-link">← Volver al editor</a>
        <span className="cfg-toolbar-title">Configuración de biblioteca</span>
        <ConfigIO />
      </header>
      <div className="cfg-grid">
        <ProductList
          products={products}
          selected={selected}
          onSelect={setSelected}
          filters={filters}
          setFilters={setFilters}
          options={filterOptions}
          familiasById={familiasById}
          viewMode={viewMode}
          setViewMode={setViewMode}
          classifications={classifications}
        />
        <ConfiguratorViewer product={selectedProduct} />
        <Inspector
          product={selectedProduct}
          classification={selectedProduct ? classifications.get(selectedProduct.producto_id) ?? null : null}
          onNavigateTo={setSelected}
        />
      </div>
    </div>
  );
}
