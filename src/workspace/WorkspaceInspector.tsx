/**
 * WorkspaceInspector — shows equipment inspector or tray piece editor
 * depending on which type of element is selected.
 *
 * Equipment editing delegates to PreviewInspector logic via usePreviewStore,
 * but we need to bridge it to useWorkspaceStore. We do this by temporarily
 * syncing selected element to usePreviewStore when needed.
 *
 * Simpler approach: render an inline piece editor for tray pieces,
 * and a minimal equipment editor for equipment (wrapping PreviewInspector).
 */
import { useWorkspaceStore } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import type { EquipmentElement } from '../types/domain-v2';
import type { Piece } from '../tray/model';

// ─── Equipment card ───────────────────────────────────────────────────────────

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-field">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{value}</span>
    </div>
  );
}

function EquipmentCard({ el }: { el: EquipmentElement }) {
  const updateElement  = useWorkspaceStore((s) => s.updateElement);
  const removeElement  = useWorkspaceStore((s) => s.removeElement);
  const duplicateEquip = useWorkspaceStore((s) => s.duplicateEquip);

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-category">{el.category}</span>
        <span className="inspector-title">{el.name}</span>
      </div>

      <ReadField label="ID"         value={el.id} />
      <ReadField label="Tag"        value={el.tag ?? '—'} />
      <ReadField label="Condición"  value={el.condition} />
      <ReadField label="Ubicación"  value={el.placementStatus} />
      {el.placementStatus === 'placed' && (
        <>
          <ReadField label="X mm" value={String(el.transform.positionMm.x)} />
          <ReadField label="Y mm" value={String(el.transform.positionMm.y)} />
          <ReadField label="Z mm" value={String(el.transform.positionMm.z)} />
        </>
      )}

      <div className="inspector-actions" style={{ padding: '8px 12px', display: 'flex', gap: 6 }}>
        <button onClick={() => duplicateEquip(el.id)}>Duplicar</button>
        <button onClick={() => { if (confirm(`Eliminar "${el.name}"?`)) removeElement(el.id); }}>
          Eliminar
        </button>
      </div>

      {/* Inline position editor */}
      {el.placementStatus === 'placed' && (
        <section style={{ padding: '0 12px 8px' }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#8888aa' }}>
            Posición (mm)
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} style={{ flex: 1, fontSize: 11 }}>
                {axis.toUpperCase()}
                <input
                  type="number"
                  className="inspector-input"
                  value={el.transform.positionMm[axis]}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!Number.isFinite(val)) return;
                    updateElement({
                      ...el,
                      transform: {
                        ...el.transform,
                        positionMm: { ...el.transform.positionMm, [axis]: val },
                      },
                    } as EquipmentElement);
                  }}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <section style={{ padding: '0 12px 8px' }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#8888aa' }}>
          Nombre
        </label>
        <input
          type="text"
          className="inspector-input"
          value={el.name}
          onChange={(e) => updateElement({ ...el, name: e.target.value } as EquipmentElement)}
          style={{ width: '100%' }}
        />
      </section>
    </div>
  );
}

// ─── Tray piece card ──────────────────────────────────────────────────────────

function PieceCard({ piece }: { piece: Piece }) {
  const context = useTrayStore((s) => s.context);
  const edit    = useTrayStore((s) => s.edit);
  const entrada = useTrayStore((s) => s.entrada);

  if (!entrada) return null;

  const updatePiece = (fn: (p: Piece) => void) => {
    const next = structuredClone(entrada);
    const idx  = next.piezas.findIndex((p) => p.instancia_id === piece.instancia_id);
    if (idx < 0) return;
    fn(next.piezas[idx]);
    edit(next);
  };

  const ports = Object.entries(piece.puertos);

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-category">Pieza de bandeja</span>
        <span className="inspector-title">{piece.instancia_id}</span>
      </div>

      <div className="inspector-field">
        <span className="inspector-label">Producto</span>
        <select
          className="inspector-input"
          value={piece.producto_id}
          onChange={(e) => updatePiece((p) => { p.producto_id = e.target.value; })}
          style={{ maxWidth: 180 }}
        >
          {context?.productos.map((p) => (
            <option key={p.producto_id} value={p.producto_id}>
              {p.sku} · {p.tipo_pieza}
            </option>
          ))}
        </select>
      </div>

      <div className="inspector-field">
        <span className="inspector-label">Longitud pieza (mm)</span>
        <input
          type="number"
          className="inspector-input"
          style={{ width: 80 }}
          value={piece.longitud_mm ?? piece.longitud_eje_mm ?? 0}
          onChange={(e) => updatePiece((p) => {
            const v = Number(e.target.value);
            if (p.longitud_mm !== undefined) p.longitud_mm = v;
            else p.longitud_eje_mm = v;
          })}
        />
      </div>

      {ports.map(([portId, port]) => (
        <fieldset key={portId} style={{ margin: '4px 12px', border: '1px solid #333', padding: '4px 8px' }}>
          <legend style={{ fontSize: 11, color: '#8888aa' }}>{portId} · mm global</legend>
          <div style={{ display: 'flex', gap: 4 }}>
            {port.posicion_mm.map((v, i) => (
              <label key={i} style={{ flex: 1, fontSize: 11 }}>
                {['X', 'Y', 'Z'][i]}
                <input
                  type="number"
                  className="inspector-input"
                  value={v}
                  onChange={(e) => updatePiece((p) => {
                    p.puertos[portId].posicion_mm[i] = Number(e.target.value);
                  })}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div style={{ padding: '4px 12px' }}>
        <button
          onClick={() => {
            const next = structuredClone(entrada);
            next.piezas = next.piezas.filter((p) => p.instancia_id !== piece.instancia_id);
            edit(next);
          }}
        >
          Eliminar pieza
        </button>
      </div>
    </div>
  );
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export function WorkspaceInspector() {
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedTrayId  = useWorkspaceStore((s) => s.selectedTrayId);
  const elements        = useWorkspaceStore((s) => s.elements);
  const entrada         = useTrayStore((s) => s.entrada);

  const equip = selectedEquipId ? elements.find((e) => e.id === selectedEquipId) : null;
  const piece = selectedTrayId  ? entrada?.piezas.find((p) => p.instancia_id === selectedTrayId) : null;

  if (equip) return <EquipmentCard el={equip} />;
  if (piece) return <PieceCard piece={piece} />;

  return (
    <div className="inspector-panel">
      <p style={{ padding: 12, color: '#666688', fontSize: 12 }}>
        Seleccioná un equipo o una pieza de bandeja para inspeccionar.
      </p>
    </div>
  );
}
