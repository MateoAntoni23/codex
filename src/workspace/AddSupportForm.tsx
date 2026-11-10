import { useState } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import {
  validateSupportInput,
  generateSupportId,
  buildSupport,
  pieceLength,
} from './addSupport';

export function AddSupportForm({ onClose }: { onClose: () => void }) {
  const context    = useTrayStore((s) => s.context);
  const entrada    = useTrayStore((s) => s.entrada);
  const trayEdit   = useTrayStore((s) => s.edit);
  const selectSupport = useWorkspaceStore((s) => s.selectSupport);
  const markDirty  = useWorkspaceStore((s) => s.markDirty);

  const piezas = entrada?.piezas ?? [];

  const [instanciaId,     setInstanciaId]     = useState(() => piezas[0]?.instancia_id ?? '');
  const [productoId,      setProductoId]      = useState(() => context?.productos[0]?.producto_id ?? '');
  const [sistemaSoporteId, setSistemaSoporteId] = useState('SIS-001');
  const [distancia,       setDistancia]       = useState(750);
  const [error,           setError]           = useState<string | null>(null);

  if (!context) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#ff9955' }}>
        Cargando el catálogo de productos…
      </div>
    );
  }

  if (piezas.length === 0) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#ff9955' }}>
        No hay piezas en el trazado. Agregá tramos primero.
      </div>
    );
  }

  const selectedPiece = piezas.find((p) => p.instancia_id === instanciaId) ?? piezas[0];
  const len = pieceLength(selectedPiece);

  const handleSubmit = () => {
    const err = validateSupportInput(
      selectedPiece.instancia_id,
      productoId,
      sistemaSoporteId,
      distancia,
      len,
    );
    if (err) { setError(err); return; }
    if (!entrada) { setError('No hay trazado cargado.'); return; }

    const existingIds = new Set(entrada.soportes.map((s) => s.soporte_id));
    const id      = generateSupportId(existingIds);
    const support = buildSupport(id, selectedPiece.instancia_id, productoId, sistemaSoporteId, distancia);

    try {
      const next = structuredClone(entrada);
      next.soportes.push(support);
      trayEdit(next);
      selectSupport(id);
      markDirty();
      onClose();
    } catch (e) {
      setError(`Error al crear el soporte: ${String(e)}`);
    }
  };

  return (
    <div style={{ padding: '8px 12px', background: '#181b2e', border: '1px solid #2a2e55', borderRadius: 4, marginBottom: 6 }}>

      {/* Piece selector */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Pieza
        </label>
        <select
          className="inspector-input"
          style={{ width: '100%' }}
          value={selectedPiece.instancia_id}
          onChange={(e) => { setInstanciaId(e.target.value); setError(null); }}
        >
          {piezas.map((p) => (
            <option key={p.instancia_id} value={p.instancia_id}>
              {p.instancia_id} — {p.producto_id}
            </option>
          ))}
        </select>
        {len > 0 && (
          <div style={{ fontSize: 10, color: '#6677aa', marginTop: 3 }}>
            Longitud de la pieza: {len.toFixed(0)} mm
          </div>
        )}
      </div>

      {/* Support product */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Producto de soporte
        </label>
        <select
          className="inspector-input"
          style={{ width: '100%' }}
          value={productoId}
          onChange={(e) => { setProductoId(e.target.value); setError(null); }}
        >
          {context.productos.map((p) => (
            <option key={p.producto_id} value={p.producto_id}>
              {p.sku} — {p.descripcion_original}
            </option>
          ))}
        </select>
      </div>

      {/* Sistema soporte */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Sistema de soporte (ID)
          <div style={{ fontSize: 10, color: '#445566', fontWeight: 'normal' }}>
            Verificado por Python. El valor del catálogo de ejemplo es SIS-001.
          </div>
        </label>
        <input
          type="text"
          className="inspector-input"
          style={{ width: '100%' }}
          value={sistemaSoporteId}
          onChange={(e) => { setSistemaSoporteId(e.target.value); setError(null); }}
        />
      </div>

      {/* Distance from P1 */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Distancia desde P1 (mm)
          {len > 0 && <span style={{ color: '#445566' }}> · máx {len.toFixed(0)} mm</span>}
        </label>
        <div style={{ fontSize: 10, color: '#445566', marginBottom: 3 }}>
          P1 es el extremo de referencia de la pieza (el primer puerto).
        </div>
        <input
          type="number"
          className="inspector-input"
          style={{ width: '100%' }}
          min={0}
          max={len > 0 ? len : undefined}
          value={distancia}
          onChange={(e) => { setDistancia(Number(e.target.value)); setError(null); }}
        />
        {len > 0 && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#5566aa' }}>
            Posición relativa: {((distancia / len) * 100).toFixed(0)}% desde P1
          </div>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#ff7755', marginBottom: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{ flex: 1, padding: '5px 0', fontSize: 12, background: '#3d3322', color: 'white', border: '1px solid #aa8833', borderRadius: 3, cursor: 'pointer' }}
          onClick={handleSubmit}
        >
          Crear soporte
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
