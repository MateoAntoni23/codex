/**
 * AddTraySegmentForm — formulario de creación de tramo recto.
 *
 * Decisión de diseño compartida con el Configurador:
 *   El selector de producto usa la MISMA cascada de filtros
 *   (sistema → tipo → ancho → ala → acabado → espesor) definida en
 *   `configurator/productFilters.ts`. No se duplica la lógica — un cambio de
 *   regla en el Configurador se refleja acá sin tocar este archivo.
 *
 * El indicador paramétrico (◆/○) se preserva como etiqueta visual porque
 * depende de `parametricBridge` (orden real de recetas), no del catálogo.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { validateSegmentInput, generateSegmentId, buildSegmentPiece, type Point3 } from './addTraySegment';
import { hasParametricRecipe } from './parametricBridge';
import type { Piece } from '../tray/model';
import { resolveDefinition, withDefinition } from './placement/definitions';
import { placeDefinition, puertosFromWorld, type StoredDefinition } from './placement/placementCore';
import {
  applyCascade,
  buildFamiliasById,
  computeFilterOptions,
  EMPTY_FILTERS,
  formatAcabadoOption,
  formatAlaOption,
  formatAnchoOption,
  formatEspesorOption,
  matchesFilter,
  type Filters,
} from '../configurator/productFilters';
import { SISTEMAS, type Sistema } from '../configurator/sistemaClassifier';

const AXES = ['X', 'Y', 'Z'] as const;

function CoordField({
  label, coords, onChange,
}: {
  label: string;
  coords: Point3;
  onChange: (axis: 0 | 1 | 2, value: string) => void;
}) {
  return (
    <fieldset style={{ border: '1px solid #2a2e44', padding: '5px 8px', marginBottom: 6, borderRadius: 3 }}>
      <legend style={{ fontSize: 11, color: '#8888aa' }}>{label}</legend>
      <div style={{ display: 'flex', gap: 4 }}>
        {AXES.map((axis, i) => (
          <label key={axis} style={{ flex: 1, fontSize: 11 }}>
            {axis}
            <input
              type="number"
              className="inspector-input"
              style={{ width: '100%' }}
              value={coords[i]}
              onChange={(e) => onChange(i as 0 | 1 | 2, e.target.value)}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const SELECT_STYLE: React.CSSProperties = { width: '100%', fontSize: 11, marginBottom: 3 };

export function AddTraySegmentForm({ onClose }: { onClose: () => void }) {
  const context    = useTrayStore((s) => s.context);
  const entrada    = useTrayStore((s) => s.entrada);
  const trayEdit   = useTrayStore((s) => s.edit);
  const selectTray = useWorkspaceStore((s) => s.selectTray);
  const markDirty  = useWorkspaceStore((s) => s.markDirty);

  // El formulario de tramo opera siempre sobre `tipo_pieza === 'recta'`. Es el
  // único piso duro — los demás niveles de la cascada son libres.
  const rectaProducts = useMemo(
    () => (context?.productos ?? []).filter((p) => p.tipo_pieza === 'recta'),
    [context],
  );
  const familiasById = useMemo(
    () => buildFamiliasById(context?.familias ?? []),
    [context],
  );

  // Toggle "sólo paramétrico" independiente de la cascada: filtra sobre el
  // conjunto ya reducido por los selectores para mantener coherencia con el
  // indicador ◆/○ que aparece en las opciones.
  const [onlyParametric, setOnlyParametric] = useState<boolean>(() =>
    rectaProducts.some((p) => hasParametricRecipe(p)),
  );

  // Estado de filtros compartido con el Configurador (sin `estado`). Fijamos
  // `tipoPieza = 'recta'` desde el arranque: es el único valor válido acá.
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, tipoPieza: 'recta' });

  const filterOptions = useMemo(
    () => computeFilterOptions(rectaProducts, filters, familiasById),
    [rectaProducts, filters, familiasById],
  );

  const visibleProducts = useMemo(() => {
    const base = rectaProducts.filter((p) => matchesFilter(p, filters, familiasById));
    return onlyParametric ? base.filter((p) => hasParametricRecipe(p)) : base;
  }, [rectaProducts, filters, familiasById, onlyParametric]);

  const defaultProductId = useMemo(
    () =>
      visibleProducts.find((p) => hasParametricRecipe(p))?.producto_id
      ?? visibleProducts[0]?.producto_id
      ?? rectaProducts.find((p) => hasParametricRecipe(p))?.producto_id
      ?? rectaProducts[0]?.producto_id
      ?? '',
    [visibleProducts, rectaProducts],
  );

  const [productoId, setProductoId] = useState(defaultProductId);
  const [p1, setP1] = useState<Point3>([0, 0, 0]);
  const [p2, setP2] = useState<Point3>([3000, 0, 0]);
  const [error, setError] = useState<string | null>(null);

  // Si la cascada deja fuera al producto actual, saltar al primer visible.
  // Sin este efecto, el selector mostraría un valor que no está en la lista.
  useEffect(() => {
    if (!productoId) {
      setProductoId(defaultProductId);
      return;
    }
    if (!visibleProducts.some((p) => p.producto_id === productoId)) {
      setProductoId(defaultProductId);
    }
  }, [visibleProducts, productoId, defaultProductId]);

  if (!context) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#ff9955' }}>
        Cargando el catálogo de productos…
      </div>
    );
  }

  if (rectaProducts.length === 0) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#ff9955' }}>
        No hay productos rectos (tipo_pieza: recta) disponibles en el catálogo.
      </div>
    );
  }

  const selectedProduct =
    visibleProducts.find((p) => p.producto_id === productoId)
    ?? rectaProducts.find((p) => p.producto_id === productoId)
    ?? visibleProducts[0]
    ?? rectaProducts[0];
  const ala = (selectedProduct as Record<string, unknown>).ala_nominal_mm;
  const extraKeys: string[] = ['familia', 'material', 'acabado'];
  const hasRecipe = hasParametricRecipe(selectedProduct);
  const parametricCount = visibleProducts.filter((p) => hasParametricRecipe(p)).length;

  const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);

  const handleCoord = (point: 'p1' | 'p2', axis: 0 | 1 | 2, raw: string) => {
    const v = parseFloat(raw);
    const val = Number.isFinite(v) ? v : 0;
    if (point === 'p1') setP1((prev) => { const n = [...prev] as Point3; n[axis] = val; return n; });
    else                setP2((prev) => { const n = [...prev] as Point3; n[axis] = val; return n; });
    setError(null);
  };

  const handleSubmit = () => {
    const validErr = validateSegmentInput(p1, p2);
    if (validErr) { setError(validErr); return; }
    if (!entrada) {
      setError('No hay trazado cargado.');
      return;
    }
    const existingIds = new Set(entrada.piezas.map((p) => p.instancia_id));
    const id    = generateSegmentId(existingIds);
    // Hito 2: con modelo, el tramo se coloca con su definición y su pose (P1 en el
    // primer punto, avanzando hacia el segundo, largo = distancia entre ambos).
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const d = resolveDefinition(selectedProduct, { longitud_mm: len });
    let piece: Piece;
    let definition: { huella: string; def: StoredDefinition } | null = null;
    if (d.ok) {
      const placed = placeDefinition({
        def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1',
        startPos: p1, entryDir: [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len, (p2[2] - p1[2]) / len],
      });
      piece = { instancia_id: id, producto_id: selectedProduct.producto_id, longitud_mm: len, puertos: puertosFromWorld(placed.ports), colocacion: placed.colocacion };
      definition = { huella: d.huella, def: d.def };
    } else {
      piece = buildSegmentPiece(id, selectedProduct.producto_id, p1, p2);
    }
    try {
      let next = structuredClone(entrada);
      if (definition) next = withDefinition(next, definition.huella, definition.def);
      next.piezas.push(piece);
      trayEdit(next);         // calls assertInput internally — throws on invalid data
      selectTray(id);
      markDirty();
      onClose();
    } catch (e) {
      setError(`Error al crear el tramo: ${String(e)}`);
    }
  };

  // Para el select final (con ◆/○), agrupamos por familia como antes para que
  // el usuario distinga variantes de material/acabado con la vista jerárquica.
  const familyGroups = useMemo(() => {
    const groups = new Map<string, {
      name: string;
      acabado: string | null;
      products: typeof visibleProducts;
    }>();
    for (const p of visibleProducts) {
      const famId = (p as Record<string, unknown>).familia_id as string | undefined ?? '__other__';
      if (!groups.has(famId)) {
        const fam = context?.familias?.find((f) => f.familia_id === famId);
        groups.set(famId, {
          name: fam?.nombre_familia ?? famId,
          acabado: fam?.acabado_normalizado ?? null,
          products: [],
        });
      }
      groups.get(famId)!.products.push(p);
    }
    for (const g of groups.values()) {
      g.products.sort((a, b) => {
        const ap = hasParametricRecipe(a) ? 0 : 1;
        const bp = hasParametricRecipe(b) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.sku.localeCompare(b.sku);
      });
    }
    return groups;
  }, [visibleProducts, context?.familias]);

  return (
    <div style={{ padding: '8px 12px', background: '#181b2e', border: '1px solid #2a2e55', borderRadius: 4, marginBottom: 6 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Producto (sólo rectos del catálogo)
        </label>

        {/* Cascada de filtros compartida con el Configurador */}
        <select
          className="inspector-input"
          style={SELECT_STYLE}
          value={filters.sistema}
          onChange={(e) => {
            setFilters(applyCascade(filters, 'sistema', e.target.value as Sistema | ''));
            setError(null);
          }}
          aria-label="Filtrar por sistema"
          data-testid="add-filter-sistema"
        >
          <option value="">Todos los sistemas</option>
          {SISTEMAS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <select
          className="inspector-input"
          style={SELECT_STYLE}
          value={filters.ancho}
          onChange={(e) => {
            setFilters(applyCascade(filters, 'ancho', e.target.value));
            setError(null);
          }}
          aria-label="Filtrar por ancho"
          data-testid="add-filter-ancho"
        >
          <option value="">Todos los anchos</option>
          {filterOptions.anchos.map((w) => (
            <option key={w} value={w}>{formatAnchoOption(w)}</option>
          ))}
        </select>
        <select
          className="inspector-input"
          style={SELECT_STYLE}
          value={filters.ala}
          onChange={(e) => {
            setFilters(applyCascade(filters, 'ala', e.target.value));
            setError(null);
          }}
          aria-label="Filtrar por ala"
          data-testid="add-filter-ala"
        >
          <option value="">Todas las alas</option>
          {filterOptions.alas.map((a) => (
            <option key={a} value={a}>{formatAlaOption(a)}</option>
          ))}
        </select>
        <select
          className="inspector-input"
          style={SELECT_STYLE}
          value={filters.acabado}
          onChange={(e) => {
            setFilters(applyCascade(filters, 'acabado', e.target.value));
            setError(null);
          }}
          aria-label="Filtrar por acabado"
          data-testid="add-filter-acabado"
        >
          <option value="">Todos los acabados</option>
          {filterOptions.acabados.map((a) => (
            <option key={a} value={a}>{formatAcabadoOption(a)}</option>
          ))}
        </select>
        <select
          className="inspector-input"
          style={SELECT_STYLE}
          value={filters.espesor}
          onChange={(e) => {
            setFilters(applyCascade(filters, 'espesor', e.target.value));
            setError(null);
          }}
          aria-label="Filtrar por espesor"
          data-testid="add-filter-espesor"
        >
          <option value="">Todos los espesores</option>
          {filterOptions.espesores.map((s) => (
            <option key={s} value={s}>{formatEspesorOption(s)}</option>
          ))}
        </select>

        {parametricCount > 0 && (
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginTop: 4, marginBottom: 4,
              color: onlyParametric ? '#99ccff' : '#8899bb', cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={onlyParametric}
              onChange={(e) => { setOnlyParametric(e.target.checked); setError(null); }}
            />
            <span>
              Sólo con modelo paramétrico diseñado ({parametricCount}
              {onlyParametric ? '' : ` / ${visibleProducts.length}`})
            </span>
          </label>
        )}

        <select
          className="inspector-input"
          style={{ width: '100%' }}
          value={selectedProduct.producto_id}
          onChange={(e) => { setProductoId(e.target.value); setError(null); }}
          data-testid="add-product-select"
        >
          {Array.from(familyGroups.entries()).map(([famId, { name, acabado, products }]) => (
            <optgroup key={famId} label={acabado ? `${name} (${acabado})` : name}>
              {products.map((p) => {
                const rec = hasParametricRecipe(p);
                return (
                  <option key={p.producto_id} value={p.producto_id}>
                    {rec ? '◆ ' : '○ '}{p.sku} — {p.descripcion_original}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
        <div style={{ fontSize: 9, color: '#667788', marginTop: 2 }}>
          ◆ modelo paramétrico diseñado · ○ sin modelo (render schemático)
        </div>

        <div style={{ fontSize: 10, color: '#6677aa', marginTop: 4, lineHeight: 1.6 }}>
          {selectedProduct.ancho_nominal_mm != null && (
            <span>Ancho: <strong>{selectedProduct.ancho_nominal_mm} mm</strong> · </span>
          )}
          {typeof ala === 'number' && ala > 0 && (
            <span>Ala: <strong>{ala} mm</strong> · </span>
          )}
          {extraKeys.map((key) => {
            const v = (selectedProduct as Record<string, unknown>)[key];
            return v != null && v !== '' ? (
              <span key={key}>{key}: <strong>{String(v)}</strong> · </span>
            ) : null;
          })}
        </div>

        <div
          style={{
            marginTop: 6, padding: '4px 6px', borderRadius: 3, fontSize: 10,
            background: hasRecipe ? '#132033' : '#2a1f10',
            color: hasRecipe ? '#99ccff' : '#ddaa44',
            borderLeft: `2px solid ${hasRecipe ? '#3355aa' : '#886633'}`,
          }}
        >
          {hasRecipe ? (
            <>Modelo paramétrico disponible — la geometría 3D proviene del STEP medido.</>
          ) : (
            <>Sin modelo paramétrico para este SKU — se renderizará con el esquema por extrusión.</>
          )}
        </div>
      </div>

      <div style={{ fontSize: 10, color: '#5566aa', marginBottom: 6, lineHeight: 1.4 }}>
        Coordenadas globales en mm · X → Este · Y → Norte · Z → Vertical (arriba)
      </div>

      <CoordField label="P1 — extremo de referencia" coords={p1} onChange={(ax, v) => handleCoord('p1', ax, v)} />
      <CoordField label="P2 — extremo opuesto"       coords={p2} onChange={(ax, v) => handleCoord('p2', ax, v)} />

      <div style={{ fontSize: 11, color: '#7799cc', marginBottom: 8 }}>
        Longitud: <strong style={{ color: dist >= 1 ? '#99ddaa' : '#ff9955' }}>
          {Number.isFinite(dist) ? `${dist.toFixed(1)} mm` : '—'}
        </strong>
        {dist < 1 && dist > 0 && <span style={{ color: '#ff9955' }}> (mínimo 1 mm)</span>}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#ff7755', marginBottom: 6, lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{ flex: 1, padding: '5px 0', fontSize: 12, background: '#2a5533', color: 'white', border: '1px solid #44aa66', borderRadius: 3, cursor: 'pointer' }}
          onClick={handleSubmit}
        >
          Crear tramo
        </button>
        <button
          style={{ padding: '5px 10px', fontSize: 12, background: '#333355', color: '#8888aa', border: '1px solid #445566', borderRadius: 3, cursor: 'pointer' }}
          onClick={onClose}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
