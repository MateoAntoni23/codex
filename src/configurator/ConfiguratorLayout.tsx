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
import { getEffectiveMapping, type ProductPortMapping } from '../workspace/catalogPortMapping';
import { useCatalogConfigStore } from './catalogConfigStore';
import { InspectorTabContent, TABS, type TabId } from './ConfiguratorInspectorTabs';
import { ConfiguratorViewer } from './ConfiguratorViewer';
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
        <ConfigIO />
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
        <ConfiguratorViewer product={selectedProduct} />
        <Inspector product={selectedProduct} />
      </div>
    </div>
  );
}
