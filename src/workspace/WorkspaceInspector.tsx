/**
 * WorkspaceInspector — contextual inspector for the unified workspace.
 *
 * Equipment selected → EquipmentEditorPanel (full editing with previewEditor/technicalEditor)
 * Tray piece selected → PieceCard (product, dimensions, ports) + TrayResults
 * Support selected → SupportCard (ID, piece, product, system, distance from P1)
 * Nothing selected → CalcPanel (pre-calc summary + structured results)
 */
import { useState } from 'react';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import { useRoutingStore } from './useRoutingStore';
import { RoutingPanel } from './RoutingPanel';
import { EquipmentEditorPanel } from '../preview/EquipmentEditorPanel';
import { TrayResults } from './TrayResults';
import { checkDeleteDependencies, duplicateElement } from '../preview/previewCrud';
import type { Piece, Support, TrayInput } from '../tray/model';
import { object } from '../tray/model';
import { rotatePiece, normalizeDeg, type AxisKey, type PivotRef } from './pieceTransforms';

/** Renders a Python result value as readable text, handling nested objects and arrays. */
function formatResultValue(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.replace(/_/g, ' ');
  if (Array.isArray(v)) {
    if (v.length === 0) return '(vacío)';
    return v.map((x) => formatResultValue(x, depth + 1)).join(', ');
  }
  if (typeof v === 'object' && depth < 2) {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k.replace(/_/g, ' ')}: ${formatResultValue(val, depth + 1)}`)
      .join(' · ');
  }
  return JSON.stringify(v);
}

// ─── Rotación manual de pieza ─────────────────────────────────────────────────

function RotatePieceControls({ piece, entrada }: { piece: Piece; entrada: TrayInput }) {
  const edit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const [axis, setAxis] = useState<AxisKey>('Z');
  const [pivotKind, setPivotKind] = useState<'centroid' | 'port'>('centroid');
  const [pivotPort, setPivotPort] = useState<string>(Object.keys(piece.puertos)[0] ?? 'P1');
  const [angleDeg, setAngleDeg] = useState<string>('0');

  const portNames = Object.keys(piece.puertos);
  const hasConnections = entrada.conexiones.some(
    (c) => c.a[0] === piece.instancia_id || c.b[0] === piece.instancia_id,
  );

  const applyRotation = (deg: number) => {
    const d = normalizeDeg(deg);
    if (Math.abs(d) < 1e-6) return;
    const pivot: PivotRef = pivotKind === 'centroid'
      ? { kind: 'centroid' }
      : { kind: 'port', name: pivotPort };
    const next = structuredClone(entrada);
    const idx = next.piezas.findIndex((p) => p.instancia_id === piece.instancia_id);
    if (idx < 0) return;
    next.piezas[idx] = rotatePiece(next.piezas[idx], axis, d, pivot);
    edit(next);
    markDirty();
    setAngleDeg('0');
  };

  const handleApply = () => {
    const d = Number(angleDeg);
    if (!Number.isFinite(d)) return;
    applyRotation(d);
  };

  return (
    <fieldset
      data-codex-rotate-controls
      style={{ margin: '4px 12px', border: '1px solid #4a5570', padding: '4px 8px', borderRadius: 3, background: '#1e2338' }}
    >
      <legend style={{ fontSize: 11, color: '#99aacc', padding: '0 4px' }}>Rotar pieza</legend>
      {hasConnections && (
        <div style={{ fontSize: 10, color: '#ff9955', marginBottom: 4 }}>
          ⚠ Esta pieza tiene conexiones — rotarla puede desalinear vecinas.
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 11 }}>
        <label style={{ color: '#8899bb' }}>Eje</label>
        {(['X', 'Y', 'Z'] as AxisKey[]).map((a) => (
          <button
            key={a}
            onClick={() => setAxis(a)}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              background: axis === a ? '#3c4967' : '#262a40',
              color: axis === a ? 'white' : '#9999aa',
              border: `1px solid ${axis === a ? '#5566aa' : '#333a55'}`,
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {a}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 11 }}>
        <label style={{ color: '#8899bb' }}>Pivote</label>
        <select
          value={pivotKind}
          onChange={(e) => setPivotKind(e.target.value as 'centroid' | 'port')}
          className="inspector-input"
          style={{ fontSize: 11 }}
        >
          <option value="centroid">Centroide</option>
          <option value="port">Puerto</option>
        </select>
        {pivotKind === 'port' && (
          <select
            value={pivotPort}
            onChange={(e) => setPivotPort(e.target.value)}
            className="inspector-input"
            style={{ fontSize: 11 }}
          >
            {portNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 11 }}>
        <button onClick={() => applyRotation(-90)} title="−90°" style={rotButtonStyle}>−90°</button>
        <button onClick={() => applyRotation(-45)} title="−45°" style={rotButtonStyle}>−45°</button>
        <button onClick={() => applyRotation(45)} title="+45°" style={rotButtonStyle}>+45°</button>
        <button onClick={() => applyRotation(90)} title="+90°" style={rotButtonStyle}>+90°</button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
        <label style={{ color: '#8899bb' }}>Ángulo (°)</label>
        <input
          type="number"
          step="1"
          value={angleDeg}
          onChange={(e) => setAngleDeg(e.target.value)}
          className="inspector-input"
          style={{ width: 70, fontSize: 11 }}
        />
        <button
          onClick={handleApply}
          data-codex-rotate-apply
          style={{
            fontSize: 11,
            padding: '2px 10px',
            background: '#3c4967',
            color: 'white',
            border: '1px solid #5566aa',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          Aplicar
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#777799', marginTop: 4 }}>
        Rota alrededor del eje mundial {axis} respecto al {pivotKind === 'centroid' ? 'centroide' : `puerto ${pivotPort}`}.
        Usá Deshacer (Ctrl+Z) para revertir.
      </div>
    </fieldset>
  );
}

const rotButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: '#262a40',
  color: '#c0c0e0',
  border: '1px solid #333a55',
  borderRadius: 3,
  cursor: 'pointer',
  minWidth: 46,
};

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

      <RotatePieceControls piece={piece} entrada={entrada} />

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

// ─── Support card ─────────────────────────────────────────────────────────────

function SupportCard({ support }: { support: Support }) {
  const context   = useTrayStore((s) => s.context);
  const edit      = useTrayStore((s) => s.edit);
  const entrada   = useTrayStore((s) => s.entrada);
  const result    = useTrayStore((s) => s.result);
  const markDirty = useWorkspaceStore((s) => s.markDirty);

  if (!entrada) return null;

  const piece   = entrada.piezas.find((p) => p.instancia_id === support.instancia_id);
  const product = context?.productos.find((p) => p.producto_id === support.producto_id);

  const trayStatus = useTrayStore((s) => s.status);

  // Try to find calculated span data in result
  const soporteResult = result && object(result.soportes)
    ? (result.soportes as Record<string, unknown>)[support.soporte_id]
    : Array.isArray(result?.soportes)
      ? (result.soportes as Record<string, unknown>[]).find((s) => s.soporte_id === support.soporte_id)
      : null;

  const updateDistancia = (val: number) => {
    const next = structuredClone(entrada);
    const idx = next.soportes.findIndex((s) => s.soporte_id === support.soporte_id);
    if (idx < 0) return;
    next.soportes[idx].distancia_desde_P1_mm = val;
    edit(next);
    markDirty();
  };

  const handleDelete = () => {
    if (!confirm(`Eliminar soporte "${support.soporte_id}"?`)) return;
    const next = structuredClone(entrada);
    next.soportes = next.soportes.filter((s) => s.soporte_id !== support.soporte_id);
    edit(next);
    markDirty();
  };

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-category">Soporte</span>
        <span className="inspector-title">{support.soporte_id}</span>
      </div>

      <div style={{ padding: '4px 12px', fontSize: 11, color: '#8888aa', lineHeight: 1.5 }}>
        <p style={{ margin: '0 0 6px', color: '#bb99cc' }}>
          La caja púrpura en el visor marca la <strong>ubicación calculada</strong> del soporte — no es la geometría real del herraje.
        </p>
        <div>Pieza: <strong style={{ color: '#c0c0e0' }}>{support.instancia_id}</strong></div>
        {piece && (
          <div>Producto pieza: <span style={{ color: '#99aacc' }}>{piece.producto_id}</span></div>
        )}
        <div>Producto soporte: <strong style={{ color: '#c0c0e0' }}>{support.producto_id}</strong></div>
        {product && (
          <div style={{ color: '#7788aa' }}>{product.descripcion_original}</div>
        )}
        <div>Sistema: <span style={{ color: '#99aacc' }}>{support.sistema_soporte_id}</span></div>
      </div>

      <div className="inspector-field" style={{ padding: '4px 12px' }}>
        <span className="inspector-label">Distancia desde P1 (mm)</span>
        <div style={{ fontSize: 10, color: '#666688', marginBottom: 4 }}>
          P1 es el extremo de referencia de la pieza (marcado en rojo en el visor cuando este soporte está seleccionado).
        </div>
        <input
          type="number"
          className="inspector-input"
          style={{ width: 120 }}
          value={support.distancia_desde_P1_mm}
          onChange={(e) => updateDistancia(Number(e.target.value))}
        />
      </div>

      {object(soporteResult) && (
        <div style={{ padding: '4px 12px 8px', fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: '#99ccff' }}>Resultado del cálculo</span>
            {trayStatus !== 'vigente' && (
              <span style={{ color: '#ff9955', fontSize: 10 }}>NO VIGENTE — recalcular</span>
            )}
          </div>
          {Object.entries(soporteResult).map(([k, v]) => (
            <div key={k} style={{ color: '#c0c0e0', marginBottom: 2 }}>
              <span style={{ color: '#8888aa' }}>{k.replace(/_/g, ' ')}: </span>
              <span style={{ color: '#aaccff' }}>{formatResultValue(v)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '4px 12px 8px' }}>
        <button
          style={{ fontSize: 12, padding: '4px 8px', background: '#8b2222', color: 'white', border: '1px solid #cc3333', borderRadius: 3, cursor: 'pointer' }}
          onClick={handleDelete}
        >
          Eliminar soporte
        </button>
      </div>
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

// ─── Calc panel (shown when nothing is selected) ──────────────────────────────

function CalcPanel() {
  const entrada  = useTrayStore((s) => s.entrada);
  const result   = useTrayStore((s) => s.result);
  const status   = useTrayStore((s) => s.status);
  const calculate = useTrayStore((s) => s.calculate);

  const nPiezas     = entrada?.piezas.length ?? 0;
  const nConexiones = entrada?.conexiones.length ?? 0;
  const nCircuitos  = entrada?.circuitos.length ?? 0;
  const nSoportes   = entrada?.soportes.length ?? 0;
  const cableId     = entrada?.pe.cable_id ?? '—';

  return (
    <div style={{ padding: '0 0 8px' }}>
      <div style={{ padding: '8px 12px 4px', borderBottom: '1px solid #2a2e44' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#99aadd', marginBottom: 6 }}>Resumen del trazado</div>
        <table style={{ fontSize: 11, color: '#c0c0d8', width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ color: '#8888aa', paddingBottom: 2 }}>Piezas</td><td style={{ textAlign: 'right' }}>{nPiezas}</td></tr>
            <tr><td style={{ color: '#8888aa', paddingBottom: 2 }}>Conexiones</td><td style={{ textAlign: 'right' }}>{nConexiones}</td></tr>
            <tr><td style={{ color: '#8888aa', paddingBottom: 2 }}>Circuitos</td><td style={{ textAlign: 'right' }}>{nCircuitos}</td></tr>
            <tr><td style={{ color: '#8888aa', paddingBottom: 2 }}>Soportes</td><td style={{ textAlign: 'right' }}>{nSoportes}</td></tr>
            <tr><td style={{ color: '#8888aa', paddingBottom: 2 }}>Cable PE</td><td style={{ textAlign: 'right', fontSize: 10 }}>{cableId}</td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 10, color: '#555577', marginTop: 6, lineHeight: 1.4 }}>
          El motor verifica: ocupación por boca, selección de PE equipotencial, cómputo de materiales y vanos entre soportes.<br />
          No verifica: eléctricamente circuitos, resistencia mecánica, ni normativa de instalación.
        </p>
        <button
          style={{ marginTop: 6, padding: '5px 12px', fontSize: 12, background: '#3c6633', color: 'white', border: '1px solid #55aa44', borderRadius: 3, cursor: 'pointer', width: '100%' }}
          onClick={() => void calculate()}
          disabled={status === 'calculando'}
        >
          {status === 'calculando' ? 'Calculando…' : 'Calcular trazado'}
        </button>
        {result && status !== 'vigente' && (
          <p style={{ fontSize: 10, color: '#ff9955', marginTop: 4 }}>Resultado no vigente — recalcular tras los últimos cambios.</p>
        )}
      </div>

      <TrayResults />
    </div>
  );
}

// ─── Undo / redo controls (always visible when history is non-empty) ──────────

function TrayHistoryControls() {
  const trayUndo  = useTrayStore((s) => s.undo);
  const trayRedo  = useTrayStore((s) => s.redo);
  const history   = useTrayStore((s) => s.history);
  const future    = useTrayStore((s) => s.future);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const canUndo   = history.length > 0;
  const canRedo   = future.length > 0;

  if (!canUndo && !canRedo) return null;

  return (
    <div style={{ display: 'flex', gap: 4, padding: '4px 12px 5px', borderBottom: '1px solid #2a2e44' }}>
      <button
        title={canUndo ? `Deshacer (${history.length} disponibles)` : 'Sin operaciones para deshacer'}
        style={{ fontSize: 11, padding: '2px 8px', background: canUndo ? '#2a3344' : '#1e2233', color: canUndo ? '#99aadd' : '#445566', border: '1px solid #334455', borderRadius: 2, cursor: canUndo ? 'pointer' : 'default' }}
        onClick={() => { if (canUndo) { trayUndo(); markDirty(); } }}
        disabled={!canUndo}
      >
        ↩ {canUndo ? history.length : '—'}
      </button>
      <button
        title={canRedo ? `Rehacer (${future.length} disponibles)` : 'Sin operaciones para rehacer'}
        style={{ fontSize: 11, padding: '2px 8px', background: canRedo ? '#2a3344' : '#1e2233', color: canRedo ? '#99aadd' : '#445566', border: '1px solid #334455', borderRadius: 2, cursor: canRedo ? 'pointer' : 'default' }}
        onClick={() => { if (canRedo) { trayRedo(); markDirty(); } }}
        disabled={!canRedo}
      >
        ↪ {canRedo ? future.length : '—'}
      </button>
    </div>
  );
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export function WorkspaceInspector() {
  const selectedEquipId   = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedTrayId    = useWorkspaceStore((s) => s.selectedTrayId);
  const selectedSupportId = useWorkspaceStore((s) => s.selectedSupportId);
  const entrada           = useTrayStore((s) => s.entrada);
  const routingActive     = useRoutingStore((s) => s.active);

  const piece   = selectedTrayId    ? entrada?.piezas.find((p) => p.instancia_id === selectedTrayId)        : null;
  const support = selectedSupportId ? entrada?.soportes.find((s) => s.soporte_id === selectedSupportId)    : null;

  return (
    <div className="panel panel-right" style={{ overflow: 'auto' }}>
      <div className="panel-title">Inspector</div>

      {!routingActive && <TrayHistoryControls />}

      {routingActive ? (
        <RoutingPanel />
      ) : selectedEquipId ? (
        <EquipmentCard />
      ) : piece ? (
        <PieceCard piece={piece} />
      ) : support ? (
        <SupportCard support={support} />
      ) : (
        <CalcPanel />
      )}
    </div>
  );
}
