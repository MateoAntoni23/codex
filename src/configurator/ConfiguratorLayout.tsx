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
import { useEffect, useMemo, useState } from 'react';
import { useTrayStore } from '../tray/store';
import type { Product } from '../tray/model';
import { getEffectiveMapping } from '../workspace/catalogPortMapping';
import { useCatalogConfigStore } from './catalogConfigStore';
import { InspectorTabContent, TABS, type TabId } from './ConfiguratorInspectorTabs';
import './configurator.css';

type MappingStatus = 'default' | 'override' | 'sin-mapping';

function mappingStatusFor(productoId: string): MappingStatus {
  const m = getEffectiveMapping(productoId);
  if (!m) return 'sin-mapping';
  return m.source;
}

interface Filters {
  text: string;
  tipoPieza: string; // '' = todos
  estado: MappingStatus | '';
}

function matchesFilter(p: Product, f: Filters): boolean {
  if (f.tipoPieza && p.tipo_pieza !== f.tipoPieza) return false;
  if (f.estado && mappingStatusFor(p.producto_id) !== f.estado) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    const hay = [p.producto_id, p.sku, p.descripcion_original]
      .map((s) => (s ?? '').toLowerCase())
      .some((s) => s.includes(q));
    if (!hay) return false;
  }
  return true;
}

function ProductList({
  products,
  selected,
  onSelect,
  filters,
  setFilters,
  tipoPiezaOptions,
}: {
  products: readonly Product[];
  selected: string | null;
  onSelect: (id: string) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  tipoPiezaOptions: readonly string[];
}) {
  // Subscribe to overrides so mapping badges + filter re-run on upsert/remove.
  const overrides = useCatalogConfigStore((s) => s.overrides);
  const visible = useMemo(
    () => products.filter((p) => matchesFilter(p, filters)),
    [products, filters, overrides],
  );
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
        />
        <select
          value={filters.tipoPieza}
          onChange={(e) => setFilters({ ...filters, tipoPieza: e.target.value })}
          className="cfg-filter-select"
          aria-label="Filtrar por tipo de pieza"
        >
          <option value="">Todos los tipos</option>
          {tipoPiezaOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filters.estado}
          onChange={(e) => setFilters({ ...filters, estado: e.target.value as MappingStatus | '' })}
          className="cfg-filter-select"
          aria-label="Filtrar por estado de mapping"
        >
          <option value="">Cualquier estado</option>
          <option value="default">Mapping por defecto</option>
          <option value="override">Override de proyecto</option>
          <option value="sin-mapping">Sin mapping (identidad)</option>
        </select>
      </div>
      <div className="cfg-list-meta">{visible.length} de {products.length} productos</div>
      <ul className="cfg-list">
        {visible.map((p) => {
          const st = mappingStatusFor(p.producto_id);
          return (
            <li key={p.producto_id}>
              <button
                type="button"
                className={`cfg-list-item ${selected === p.producto_id ? 'is-active' : ''}`}
                onClick={() => onSelect(p.producto_id)}
                data-testid={`cfg-product-${p.producto_id}`}
              >
                <span className="cfg-list-sku">{p.sku}</span>
                <span className="cfg-list-tipo">{p.tipo_pieza}</span>
                <span className={`cfg-list-status cfg-status-${st}`}>{st}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ViewerPlaceholder({ product }: { product: Product | null }) {
  return (
    <section className="cfg-viewer">
      {product ? (
        <div className="cfg-viewer-head">
          <h2>{product.sku}</h2>
          <div className="cfg-viewer-sub">
            {product.producto_id} · {product.tipo_pieza} ·
            {' '}ancho: {product.ancho_nominal_mm ?? 'n/d'} mm
          </div>
        </div>
      ) : (
        <div className="cfg-viewer-head"><h2>Seleccioná un producto</h2></div>
      )}
      <div className="cfg-viewer-stage">
        <div className="cfg-viewer-stage-hint">
          Visor 3D pendiente (tarea #89). Aquí se montará WorkspaceScene en
          modo configurador: vistas original / configurado / comparación.
        </div>
      </div>
    </section>
  );
}

function Inspector({ product }: { product: Product | null }) {
  const [activeTab, setActiveTab] = useState<TabId>('producto');
  const context = useTrayStore((s) => s.context);
  const familias = context?.familias ?? [];
  const puertos = context?.puertos ?? [];
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
        />
      </div>
    </aside>
  );
}

export function ConfiguratorLayout() {
  const context = useTrayStore((s) => s.context);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ text: '', tipoPieza: '', estado: '' });

  useEffect(() => {
    void useTrayStore.getState().initialize();
    // Hidratar overrides del Configurador para que la lista refleje
    // correctamente el estado por producto (default vs override) y el
    // workspace/motor reciban los overrides persistidos sin extra wiring.
    useCatalogConfigStore.getState().hydrate();
  }, []);

  const products = context?.productos ?? [];
  const tipoPiezaOptions = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.tipo_pieza))).sort();
  }, [products]);
  const selectedProduct = useMemo(
    () => products.find((p) => p.producto_id === selected) ?? null,
    [products, selected],
  );

  return (
    <div className="cfg-root" data-testid="configurator-root">
      <header className="cfg-toolbar">
        <a href="?workspace=bandejas" className="cfg-back-link">← Volver al editor</a>
        <span className="cfg-toolbar-title">Configuración de biblioteca</span>
        <span className="cfg-toolbar-hint">
          Edición de productos, bocas y continuaciones · scaffold
        </span>
      </header>
      <div className="cfg-grid">
        <ProductList
          products={products}
          selected={selected}
          onSelect={setSelected}
          filters={filters}
          setFilters={setFilters}
          tipoPiezaOptions={tipoPiezaOptions}
        />
        <ViewerPlaceholder product={selectedProduct} />
        <Inspector product={selectedProduct} />
      </div>
    </div>
  );
}
