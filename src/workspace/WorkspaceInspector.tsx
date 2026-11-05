/**
 * WorkspaceInspector — contextual inspector for the unified workspace.
 *
 * Equipment selected → EquipmentEditorPanel (full editing with previewEditor/technicalEditor)
 * Tray piece selected → PieceCard (product, dimensions, ports) + TrayResults
 * Nothing selected → placeholder
 */
import { useWorkspaceStore } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import { EquipmentEditorPanel } from '../preview/EquipmentEditorPanel';
import { TrayResults } from './TrayResults';
import { checkDeleteDependencies, duplicateElement } from '../preview/previewCrud';
import type { Piece } from '../tray/model';

// ─── Tray piece card ──────────────────────────────────────────────────────────

function PieceCard({ piece }: { piece: Piece }) {
  const context = useTrayStore((s) => s.context);
  const edit    = useTrayStore((s) => s.edit);
  const entrada = useTrayStore((s) => s.entrada);
  const markDirty = useWorkspaceStore((s) => s.markDirty);

  if (!entrada) return null;

  const updatePiece = (fn: (p: Piece) => void) => {
    const next = structuredClone(entrada);
    const idx  = next.piezas.findIndex((p) => p.instancia_id === piece.instancia_id);
    if (idx < 0) return;
    fn(next.piezas[idx]);
    edit(next);
    markDirty();
  };

  const ports = Object.entries(piece.puertos);
  const product = context?.productos.find((p) => p.producto_id === piece.producto_id);

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-category">Pieza de bandeja</span>
        <span className="inspector-title">{piece.instancia_id}</span>
      </div>

      <div className="inspector-field">
        <span className="inspector-label">Producto</span>
      </div>
      <div style={{ padding: '0 12px 6px' }}>
        <select
          className="inspector-input"
          style={{ width: '100%' }}
          value={piece.producto_id}
          onChange={(e) => updatePiece((p) => { p.producto_id = e.target.value; })}
        >
          {context?.productos.map((p) => (
            <option key={p.producto_id} value={p.producto_id}>
              {p.sku} · {p.tipo_pieza}
            </option>
          ))}
        </select>
        {product && (
          <span style={{ fontSize: 10, color: '#8888aa' }}>
            {product.descripcion_original}
            {product.ancho_nominal_mm != null && ` · ancho ${product.ancho_nominal_mm} mm`}
            {(product as Record<string,unknown>).ala_nominal_mm != null && ` · ala ${(product as Record<string,unknown>).ala_nominal_mm} mm`}
          </span>
        )}
      </div>

      <div className="inspector-field">
        <span className="inspector-label">Longitud pieza (mm)</span>
        <input
          type="number"
          className="inspector-input"
          style={{ width: 90 }}
          value={piece.longitud_mm ?? piece.longitud_eje_mm ?? 0}
          onChange={(e) => updatePiece((p) => {
            const v = Number(e.target.value);
            if (p.longitud_mm !== undefined) p.longitud_mm = v;
            else p.longitud_eje_mm = v;
          })}
        />
      </div>

      {ports.map(([portId, port]) => (
        <fieldset key={portId} style={{ margin: '4px 12px', border: '1px solid #333', padding: '4px 8px', borderRadius: 3 }}>
          <legend style={{ fontSize: 11, color: '#8888aa' }}>{portId} · mm global</legend>
          <div style={{ display: 'flex', gap: 4 }}>
            {port.posicion_mm.map((v, i) => (
              <label key={i} style={{ flex: 1, fontSize: 11, display: 'block' }}>
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

      <div style={{ padding: '4px 12px 8px' }}>
        <button
          style={{ fontSize: 12, padding: '4px 8px', background: '#8b2222', color: 'white', border: '1px solid #cc3333', borderRadius: 3, cursor: 'pointer' }}
          onClick={() => {
            if (!confirm(`Eliminar pieza "${piece.instancia_id}"?`)) return;
            const next = structuredClone(entrada);
            next.piezas = next.piezas.filter((p) => p.instancia_id !== piece.instancia_id);
            edit(next);
            markDirty();
          }}
        >
          Eliminar pieza
        </button>
      </div>

      <details style={{ margin: '4px 0' }}>
        <summary style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, background: '#1f2235' }}>
          Resultados del motor
        </summary>
        <TrayResults />
      </details>
    </div>
  );
}

// ─── Equipment card wrapper (actions + editor) ────────────────────────────────

function EquipmentCard() {
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const elements        = useWorkspaceStore((s) => s.elements);
  const updateElement   = useWorkspaceStore((s) => s.updateElement);
  const addEvidence     = useWorkspaceStore((s) => s.addEvidence);
  const removeElement   = useWorkspaceStore((s) => s.removeElement);
  const projectOrigin   = useWorkspaceStore((s) => s.projectMeta.projectOrigin);

  const element = selectedEquipId ? elements.find((e) => e.id === selectedEquipId) ?? null : null;

  const handleDelete = () => {
    if (!element) return;
    const { canDelete, blockers } = checkDeleteDependencies(element, elements);
    if (!canDelete) {
      alert(`No se puede eliminar:\n${blockers.join('\n')}`);
      return;
    }
    if (!confirm(`Eliminar "${element.name}"?`)) return;
    removeElement(element.id);
  };

  const handleDuplicate = () => {
    if (!element) return;
    const { duplicate, provenance } = duplicateElement(element, elements);
    // Add with evidence (provenance)
    useWorkspaceStore.setState((s) => ({
      elements: [...s.elements, duplicate],
      evidence: [...s.evidence, provenance],
      selectedEquipId: duplicate.id,
      dirty: true,
    }));
  };

  return (
    <div className="inspector-panel">
      {element && (
        <div style={{ padding: '4px 12px 4px', display: 'flex', gap: 6 }}>
          <button onClick={handleDuplicate} style={{ fontSize: 11, padding: '3px 8px', background: '#3c4967', color: 'white', border: '1px solid #5566aa', borderRadius: 3, cursor: 'pointer' }}>
            Duplicar
          </button>
          <button onClick={handleDelete} style={{ fontSize: 11, padding: '3px 8px', background: '#6b2222', color: 'white', border: '1px solid #aa3333', borderRadius: 3, cursor: 'pointer' }}>
            Eliminar
          </button>
        </div>
      )}
      <EquipmentEditorPanel
        element={element}
        elements={elements}
        updateElement={updateElement}
        addEvidence={addEvidence}
        projectOrigin={projectOrigin}
      />
    </div>
  );
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export function WorkspaceInspector() {
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedTrayId  = useWorkspaceStore((s) => s.selectedTrayId);
  const entrada         = useTrayStore((s) => s.entrada);

  const piece = selectedTrayId ? entrada?.piezas.find((p) => p.instancia_id === selectedTrayId) : null;

  return (
    <div className="panel panel-right" style={{ overflow: 'auto' }}>
      <div className="panel-title">Inspector</div>

      {selectedEquipId ? (
        <EquipmentCard />
      ) : piece ? (
        <PieceCard piece={piece} />
      ) : (
        <>
          <p style={{ padding: 12, color: '#666688', fontSize: 12 }}>
            Seleccioná un equipo o una pieza de bandeja.
          </p>
          <details style={{ margin: '4px 0' }}>
            <summary style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, background: '#1f2235' }}>
              Resultados del trazado
            </summary>
            <TrayResults />
          </details>
        </>
      )}
    </div>
  );
}
