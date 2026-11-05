import { useState } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { validateSegmentInput, generateSegmentId, buildSegmentPiece, type Point3 } from './addTraySegment';

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

export function AddTraySegmentForm({ onClose }: { onClose: () => void }) {
  const context    = useTrayStore((s) => s.context);
  const entrada    = useTrayStore((s) => s.entrada);
  const trayEdit   = useTrayStore((s) => s.edit);
  const selectTray = useWorkspaceStore((s) => s.selectTray);
  const markDirty  = useWorkspaceStore((s) => s.markDirty);

  const rectaProducts = (context?.productos ?? []).filter((p) => p.tipo_pieza === 'recta');

  const [productoId, setProductoId] = useState(() => rectaProducts[0]?.producto_id ?? '');
  const [p1, setP1] = useState<Point3>([0, 0, 0]);
  const [p2, setP2] = useState<Point3>([3000, 0, 0]);
  const [error, setError] = useState<string | null>(null);

  if (!context) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#ff9955' }}>
        Motor no conectado — reconectá para cargar el catálogo de productos.
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

  const selectedProduct = rectaProducts.find((p) => p.producto_id === productoId) ?? rectaProducts[0];
  const ala = (selectedProduct as Record<string, unknown>).ala_nominal_mm;
  const extraKeys: string[] = ['familia', 'material', 'acabado'];

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
      setError('No hay trazado cargado. Calculá primero para inicializar el motor.');
      return;
    }
    const existingIds = new Set(entrada.piezas.map((p) => p.instancia_id));
    const id    = generateSegmentId(existingIds);
    const piece = buildSegmentPiece(id, selectedProduct.producto_id, p1, p2);
    try {
      const next = structuredClone(entrada);
      next.piezas.push(piece);
      trayEdit(next);         // calls assertInput internally — throws on invalid data
      selectTray(id);
      markDirty();
      onClose();
    } catch (e) {
      setError(`Error al crear el tramo: ${String(e)}`);
    }
  };

  return (
    <div style={{ padding: '8px 12px', background: '#181b2e', border: '1px solid #2a2e55', borderRadius: 4, marginBottom: 6 }}>
      {/* Product selector */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Producto (solo rectos del catálogo)
        </label>
        <select
          className="inspector-input"
          style={{ width: '100%' }}
          value={selectedProduct.producto_id}
          onChange={(e) => { setProductoId(e.target.value); setError(null); }}
        >
          {rectaProducts.map((p) => (
            <option key={p.producto_id} value={p.producto_id}>
              {p.sku} — {p.descripcion_original}
            </option>
          ))}
        </select>

        {/* Product details — only fields present in catalog, nothing invented */}
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
      </div>

      {/* Axis legend */}
      <div style={{ fontSize: 10, color: '#5566aa', marginBottom: 6, lineHeight: 1.4 }}>
        Coordenadas globales en mm · X → Este · Y → Norte · Z → Vertical (arriba)
      </div>

      {/* P1 / P2 inputs */}
      <CoordField label="P1 — extremo de referencia" coords={p1} onChange={(ax, v) => handleCoord('p1', ax, v)} />
      <CoordField label="P2 — extremo opuesto"       coords={p2} onChange={(ax, v) => handleCoord('p2', ax, v)} />

      {/* Computed length */}
      <div style={{ fontSize: 11, color: '#7799cc', marginBottom: 8 }}>
        Longitud: <strong style={{ color: dist >= 1 ? '#99ddaa' : '#ff9955' }}>
          {Number.isFinite(dist) ? `${dist.toFixed(1)} mm` : '—'}
        </strong>
        {dist < 1 && dist > 0 && <span style={{ color: '#ff9955' }}> (mínimo 1 mm)</span>}
      </div>

      {/* Error */}
      {error && (
        <div style={{ fontSize: 11, color: '#ff7755', marginBottom: 6, lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      {/* Actions */}
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
