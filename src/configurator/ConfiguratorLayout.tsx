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
import type { Product } from '../tray/model';
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
import { classifySistema, SISTEMAS, type Sistema } from './sistemaClassifier';
import {
  classifyProductMapping,
  type MappingStatus,
} from './productMappingStatus';
import './configurator.css';

const ALA_NO_DECLARADA = '__sin_ala__';
const ANCHO_NO_DECLARADO = '__sin_ancho__';

function alaOf(p: Product): string {
  const raw = (p as Record<string, unknown>).ala_nominal_mm;
  return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ALA_NO_DECLARADA;
}

function anchoOf(p: Product): string {
  return typeof p.ancho_nominal_mm === 'number' && Number.isFinite(p.ancho_nominal_mm)
    ? String(p.ancho_nominal_mm)
    : ANCHO_NO_DECLARADO;
}

function familiaIdOf(p: Product): string | undefined {
  const v = (p as Record<string, unknown>).familia_id;
  return typeof v === 'string' ? v : undefined;
}

interface Filters {
  text: string;
  sistema: Sistema | '';
  ala: string; // '', número en texto, o ALA_NO_DECLARADA
  ancho: string; // '', número en texto, o ANCHO_NO_DECLARADO
  tipoPieza: string;
  estado: MappingStatus | '';
}

function matchesFilter(p: Product, f: Filters): boolean {
  if (f.sistema && classifySistema(familiaIdOf(p)) !== f.sistema) return false;
  if (f.ala && alaOf(p) !== f.ala) return false;
  if (f.ancho && anchoOf(p) !== f.ancho) return false;
  if (f.tipoPieza && p.tipo_pieza !== f.tipoPieza) return false;
  if (f.estado && classifyProductMapping(p).status !== f.estado) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    const hay = [p.producto_id, p.sku, p.descripcion_original]
      .map((s) => (s ?? '').toLowerCase())
      .some((s) => s.includes(q));
    if (!hay) return false;
  }
  return true;
}

function formatAlaOption(k: string): string {
  return k === ALA_NO_DECLARADA ? 'Ala no declarada' : `${k} mm`;
}

function formatAnchoOption(k: string): string {
  return k === ANCHO_NO_DECLARADO ? 'Ancho no declarado' : `${k} mm`;
}

const EMPTY_FILTERS: Filters = {
  text: '',
  sistema: '',
  ala: '',
  ancho: '',
  tipoPieza: '',
  estado: '',
};

interface FilterOptions {
  readonly sistemas: readonly Sistema[];
  readonly alas: readonly string[];
  readonly anchos: readonly string[];
  readonly tiposPieza: readonly string[];
}

function ProductList({
  products,
  selected,
  onSelect,
  filters,
  setFilters,
  options,
}: {
  products: readonly Product[];
  selected: string | null;
  onSelect: (id: string) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  options: FilterOptions;
}) {
  // Subscribe to overrides so mapping badges + filter re-run on upsert/remove.
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const visible = useMemo(
    () => products.filter((p) => matchesFilter(p, filters)),
    [products, filters, overrides],
  );

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
    filters.text || filters.sistema || filters.ala || filters.ancho ||
    filters.tipoPieza || filters.estado;

  return (
    <aside className="cfg-panel cfg-panel-left">
      <div className="cfg-panel-title">Catálogo</div>
      <div className="cfg-filters">
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
          value={filters.sistema}
          onChange={(e) => setFilters({ ...filters, sistema: e.target.value as Sistema | '', ala: '' })}
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
          value={filters.ala}
          onChange={(e) => setFilters({ ...filters, ala: e.target.value })}
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
          value={filters.ancho}
          onChange={(e) => setFilters({ ...filters, ancho: e.target.value })}
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
          value={filters.tipoPieza}
          onChange={(e) => setFilters({ ...filters, tipoPieza: e.target.value })}
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
          return (
            <li key={p.producto_id}>
              <button
                type="button"
                className={`cfg-list-item ${selected === p.producto_id ? 'is-active' : ''}`}
                onClick={() => onSelect(p.producto_id)}
                data-testid={`cfg-product-${p.producto_id}`}
                data-status={info.status}
                title={info.cause}
              >
                <span className="cfg-list-sku">{p.sku}</span>
                <span className="cfg-list-tipo">{p.tipo_pieza}</span>
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

function Inspector({ product }: { product: Product | null }) {
  const [activeTab, setActiveTab] = useState<TabId>('producto');
  const context = useTrayStore((s) => s.context);
  const familias = context?.familias ?? [];
  const puertos = context?.puertos ?? [];
  const productos = context?.productos ?? [];
  const compatibilidades = context?.compatibilidades ?? [];
  return (
    <aside className="cfg-panel cfg-panel-right">
      <div className="cfg-panel-title">Inspector</div>
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
  const overrides = useCatalogConfigStore((s) => s.overrides);
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
        const n = Object.keys(obj.overrides).length;
        if (!confirm(`Importar ${n} override(s) desde "${file.name}"? Se reemplazarán los actuales.`)) {
          e.target.value = '';
          return;
        }
        replaceAll(obj.overrides as Record<string, ProductPortMapping>);
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

  const count = Object.keys(overrides).length;

  return (
    <div className="cfg-toolbar-io">
      <span className="cfg-toolbar-hint">
        {count === 0 ? 'Sin overrides' : `${count} override(s) activos`}
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
  const filterOptions = useMemo<FilterOptions>(() => {
    // Opciones de ala/ancho dependen del sistema seleccionado para evitar
    // ofrecer alas inexistentes dentro del sistema (p.ej. ala=150 sólo en G).
    const scoped = filters.sistema
      ? products.filter((p) => classifySistema(familiaIdOf(p)) === filters.sistema)
      : products;
    const alas = Array.from(new Set(scoped.map(alaOf))).sort((a, b) => {
      if (a === ALA_NO_DECLARADA) return 1;
      if (b === ALA_NO_DECLARADA) return -1;
      return Number(a) - Number(b);
    });
    const anchos = Array.from(new Set(scoped.map(anchoOf))).sort((a, b) => {
      if (a === ANCHO_NO_DECLARADO) return 1;
      if (b === ANCHO_NO_DECLARADO) return -1;
      return Number(a) - Number(b);
    });
    const tipos = Array.from(new Set(scoped.map((p) => p.tipo_pieza))).sort();
    return { sistemas: SISTEMAS.map((s) => s.id), alas, anchos, tiposPieza: tipos };
  }, [products, filters.sistema]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.producto_id === selected) ?? null,
    [products, selected],
  );

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
        />
        <ConfiguratorViewer product={selectedProduct} />
        <Inspector product={selectedProduct} />
      </div>
    </div>
  );
}
