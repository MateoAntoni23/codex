/**
 * WorkspaceInspector — contextual inspector for the unified workspace.
 *
 * Equipment selected → EquipmentEditorPanel (full editing with previewEditor/technicalEditor)
 * Tray piece selected → PieceCard (product, dimensions, ports) + TrayResults
 * Support selected → SupportCard (ID, piece, product, system, distance from P1)
 * Nothing selected → CalcPanel (pre-calc summary + structured results)
 */
import { useEffect, useState } from 'react';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import { placedOf } from './placement/definitions';
import { avisosDeModelo } from './placement/joins';
import { esCurvaEslabonada } from './placement/anguloEslabonada';
import { AnguloEslabonadaField } from './stages/AnguloEslabonadaField';
import { mezclasDePieza } from './mezclaAcabados';
import { MarcaMezcla } from './stages/MarcaMezcla';
import { useRoutingStore } from './useRoutingStore';
import { useTrayMoveState } from './useTrayMoveState';
import { useTrayRotateState } from './useTrayRotateState';
import { aplicarRotacion } from './TrayRotateControls';
import { PASO_ROTACION_DEG, type EjeMundo } from './trayRotation';
import { findBrokenConnections, pieceCentroid, removeConnections } from './trayMovement';
import { RoutingPanel } from './RoutingPanel';
import { EquipmentEditorPanel } from '../preview/EquipmentEditorPanel';
import { TrayResults } from './TrayResults';
import { ImportedEquipmentInspector } from '../import/ImportedEquipmentInspector';
import { checkDeleteDependencies, duplicateElement } from '../preview/previewCrud';
import type { Piece, Support, TrayInput } from '../tray/model';
import { object } from '../tray/model';
import { rotatePiece, rotatePieceAroundAxis, normalizeDeg, type AxisKey, type PivotRef } from './pieceTransforms';
import { indexProducts, pieceLabelById, portLabel, productLabel } from './stages/displayNames';
import { BandaDivisoriaControl } from './stages/BandaDivisoria';

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

type RotationMode = 'worldAxis' | 'portAxis';

function RotatePieceControls({ piece, entrada }: { piece: Piece; entrada: TrayInput }) {
  const edit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const [mode, setMode] = useState<RotationMode>('worldAxis');
  const [axis, setAxis] = useState<AxisKey>('Z');
  const [pivotKind, setPivotKind] = useState<'centroid' | 'port'>('centroid');
  const [pivotPort, setPivotPort] = useState<string>(Object.keys(piece.puertos)[0] ?? 'P1');
  const [portAxisPort, setPortAxisPort] = useState<string>(Object.keys(piece.puertos)[0] ?? 'P1');
  const [angleDeg, setAngleDeg] = useState<string>('0');

  const portNames = Object.keys(piece.puertos);
  const myConnections = entrada.conexiones.filter(
    (c) => c.a[0] === piece.instancia_id || c.b[0] === piece.instancia_id,
  );
  // Qué puertos de ESTA pieza están conectados (y a quién).
  const connectedPorts = new Map<string, { otherId: string; otherPort: string; conexionId: string }>();
  for (const c of myConnections) {
    const [thisSide, otherSide] = c.a[0] === piece.instancia_id ? [c.a, c.b] : [c.b, c.a];
    connectedPorts.set(thisSide[1], { otherId: otherSide[0], otherPort: otherSide[1], conexionId: c.conexion_id });
  }
  const hasConnections = connectedPorts.size > 0;
  const isPortAxisPortConnected = connectedPorts.has(portAxisPort);
  // En modo portAxis, los puertos conectados ≠ portAxisPort quedarán rotos tras la rotación.
  const conflictsWhenPortAxis = Array.from(connectedPorts.entries())
    .filter(([pName]) => pName !== portAxisPort);

  const applyRotation = (deg: number) => {
    const d = normalizeDeg(deg);
    if (Math.abs(d) < 1e-6) return;
    const next = structuredClone(entrada);
    const idx = next.piezas.findIndex((p) => p.instancia_id === piece.instancia_id);
    if (idx < 0) return;
    if (mode === 'worldAxis') {
      const pivot: PivotRef = pivotKind === 'centroid'
        ? { kind: 'centroid' }
        : { kind: 'port', name: pivotPort };
      next.piezas[idx] = rotatePiece(next.piezas[idx], axis, d, pivot);
    } else {
      const port = next.piezas[idx].puertos[portAxisPort];
      if (!port) return;
      next.piezas[idx] = rotatePieceAroundAxis(
        next.piezas[idx],
        port.direccion,
        d,
        port.posicion_mm,
      );
    }
    // A-8: si la rotación deja uniones que ya no cumplen (hueco, ángulo o giro),
    // se pide confirmación explícita con el mismo aviso que al mover.
    const broken = findBrokenConnections(next, piece.instancia_id);
    if (broken.length === 0) {
      edit(next);
    } else {
      useTrayStore.getState().setEntradaRaw(next);
      useTrayMoveState.getState().requestConfirm({ pieceId: piece.instancia_id, snapshot: structuredClone(entrada), brokenConexionIds: broken });
    }
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
      <legend style={{ fontSize: 11, color: '#99aacc', padding: '0 4px' }}>Orientar pieza</legend>
      <div style={{ fontSize: 10, color: '#8899cc', marginBottom: 4, lineHeight: 1.4 }}>
        Orientación de instancia: cambia la pose de los puertos de esta pieza en el trazado.
        No es una calibración del modelo CAD — para eso usá el calibrador del visor.
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 11 }}>
        <button
          onClick={() => setMode('worldAxis')}
          data-codex-rotate-mode="worldAxis"
          style={{
            flex: 1,
            padding: '3px 6px',
            background: mode === 'worldAxis' ? '#3c4967' : '#262a40',
            color: mode === 'worldAxis' ? 'white' : '#aabbdd',
            border: `1px solid ${mode === 'worldAxis' ? '#5566aa' : '#333a55'}`,
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          Eje mundo
        </button>
        <button
          onClick={() => setMode('portAxis')}
          data-codex-rotate-mode="portAxis"
          disabled={portNames.length === 0}
          style={{
            flex: 1,
            padding: '3px 6px',
            background: mode === 'portAxis' ? '#3c4967' : '#262a40',
            color: mode === 'portAxis' ? 'white' : '#aabbdd',
            border: `1px solid ${mode === 'portAxis' ? '#5566aa' : '#333a55'}`,
            borderRadius: 3,
            cursor: portNames.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Eje de boca
        </button>
      </div>
      {mode === 'worldAxis' && hasConnections && (
        <div style={{ fontSize: 10, color: '#ff9955', marginBottom: 4 }}>
          ⚠ Esta pieza tiene {connectedPorts.size} conexión(es) — rotarla desalineará vecinas.
        </div>
      )}
      {mode === 'worldAxis' && (
        <>
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
        </>
      )}
      {mode === 'portAxis' && (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 11 }}>
            <label style={{ color: '#8899bb' }}>Boca</label>
            <select
              value={portAxisPort}
              onChange={(e) => setPortAxisPort(e.target.value)}
              data-codex-rotate-port-axis
              className="inspector-input"
              style={{ fontSize: 11 }}
            >
              {portNames.map((n) => {
                const conn = connectedPorts.get(n);
                return (
                  <option key={n} value={n}>
                    {n}{conn ? ` · conectada a ${conn.otherId}:${conn.otherPort}` : ' · libre'}
                  </option>
                );
              })}
            </select>
          </div>
          <div style={{ fontSize: 10, color: isPortAxisPortConnected ? '#99cc99' : '#99aacc', marginBottom: 4, lineHeight: 1.4 }}>
            {isPortAxisPortConnected
              ? `✓ La boca ${portAxisPort} queda fija (posición + dirección). La unión con su vecina se preserva.`
              : `La boca ${portAxisPort} está libre. La rotación la mantiene fija como pivote.`}
          </div>
          {conflictsWhenPortAxis.length > 0 && (
            <div
              data-codex-rotate-conflicts
              style={{ fontSize: 10, color: '#ff9955', marginBottom: 4, lineHeight: 1.4, border: '1px dashed #553322', padding: 4, borderRadius: 2 }}
            >
              ⚠ Se desalinearán {conflictsWhenPortAxis.length} unión(es):
              {conflictsWhenPortAxis.map(([pName, info]) => (
                <div key={pName}>
                  • {pName} ↔ {info.otherId}:{info.otherPort}
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
        {mode === 'worldAxis'
          ? `Rota alrededor del eje mundial ${axis} respecto al ${pivotKind === 'centroid' ? 'centroide' : `puerto ${pivotPort}`}.`
          : `Rota alrededor de la dirección de ${portAxisPort}, dejando esa boca fija.`}
        {' '}Usá Deshacer (Ctrl+Z) para revertir.
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

/**
 * Edición numérica (mm) del centroide del tramo. Cada confirmación aplica un
 * delta a TODAS las bocas simultáneamente, reutilizando el mismo camino que el
 * gizmo (incluida la detección de uniones rotas via `onTranslate`).
 */
function TrayCentroidEditor({
  piece,
  centroidMm,
  onTranslate,
}: {
  piece: Piece;
  centroidMm: readonly [number, number, number];
  onTranslate: (delta: [number, number, number]) => void;
}) {
  const [draft, setDraft] = useState<[string, string, string]>([
    String(Math.round(centroidMm[0])),
    String(Math.round(centroidMm[1])),
    String(Math.round(centroidMm[2])),
  ]);
  // Sincroniza el borrador cuando cambia la pieza seleccionada o el centroide
  // tras un drag — así los inputs siempre reflejan la posición actual al
  // volver a esta pieza.
  const [pieceId, setPieceId] = useState(piece.instancia_id);
  const [snapCx, setSnapCx] = useState(centroidMm[0]);
  const [snapCy, setSnapCy] = useState(centroidMm[1]);
  const [snapCz, setSnapCz] = useState(centroidMm[2]);
  // Tolerancia 1e-6 mm: re-derivar las bocas desde la pose (migración, hito 2) puede
  // cambiar el centroide en ruido numérico; no debe borrar lo que el operador tipeó.
  const moved = (a: number, b: number) => Math.abs(a - b) > 1e-6;
  if (pieceId !== piece.instancia_id || moved(snapCx, centroidMm[0]) || moved(snapCy, centroidMm[1]) || moved(snapCz, centroidMm[2])) {
    setPieceId(piece.instancia_id);
    setSnapCx(centroidMm[0]);
    setSnapCy(centroidMm[1]);
    setSnapCz(centroidMm[2]);
    setDraft([
      String(Math.round(centroidMm[0])),
      String(Math.round(centroidMm[1])),
      String(Math.round(centroidMm[2])),
    ]);
  }

  const handleApply = () => {
    const target: [number, number, number] = [
      Number(draft[0]), Number(draft[1]), Number(draft[2]),
    ];
    if (!target.every(Number.isFinite)) return;
    const delta: [number, number, number] = [
      target[0] - centroidMm[0],
      target[1] - centroidMm[1],
      target[2] - centroidMm[2],
    ];
    onTranslate(delta);
  };

  return (
    <fieldset
      data-testid="tray-centroid-editor"
      style={{ margin: '4px 12px', border: '1px solid #4a5570', padding: '4px 8px', borderRadius: 3, background: '#1e2338' }}
    >
      <legend style={{ fontSize: 11, color: '#99aacc', padding: '0 4px' }}>Posición del tramo (mm)</legend>
      <div style={{ fontSize: 10, color: '#8899cc', marginBottom: 4, lineHeight: 1.4 }}>
        Centroide global en mm (Z-up). Al aplicar se trasladan TODAS las bocas por el delta;
        las uniones que pierdan coincidencia dispararán el aviso para confirmar o cancelar.
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'end' }}>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <label key={axis} style={{ flex: 1, fontSize: 11, color: '#8899bb' }}>
            {axis}
            <input
              type="number"
              step="10"
              data-testid={`tray-centroid-input-${axis}`}
              className="inspector-input"
              value={draft[i]}
              onChange={(e) => {
                const next = [...draft] as [string, string, string];
                next[i] = e.target.value;
                setDraft(next);
              }}
            />
          </label>
        ))}
        <button
          data-testid="tray-centroid-apply"
          onClick={handleApply}
          style={{
            fontSize: 11,
            padding: '3px 10px',
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
    </fieldset>
  );
}

/**
 * B-4 — panel de la herramienta "Rotar tramo": pivote (centro o boca), eje,
 * ángulo editable (muestra el del arrastre en curso o el último) y Aplicar,
 * que rota por el mismo camino que el gizmo (confirmación de uniones y una
 * entrada en el historial).
 */
function TrayRotatePanel({ piece }: { piece: Piece }) {
  const pivote = useTrayRotateState((s) => s.pivote);
  const eje = useTrayRotateState((s) => s.eje);
  const angulo = useTrayRotateState((s) => s.anguloDeg);
  const libre = useTrayRotateState((s) => s.libre);
  const { setPivote, setEje, setAngulo } = useTrayRotateState.getState();
  const [texto, setTexto] = useState<string | null>(null);
  const bocas = Object.keys(piece.puertos);
  // Al cambiar de pieza, un pivote en una boca que ésta no tiene vuelve al centro.
  const pivoteInvalido = pivote !== 'centro' && !bocas.includes(pivote.boca);
  useEffect(() => { if (pivoteInvalido) setPivote('centro'); }, [pivoteInvalido, setPivote]);
  const pivoteValor = pivote === 'centro' || pivoteInvalido ? 'centro' : `boca:${pivote.boca}`;
  return (
    <fieldset data-testid="tray-rotate-panel" style={{ margin: '4px 12px', border: '1px solid #4a6a90', padding: '4px 8px', borderRadius: 3, background: '#1b2a3c' }}>
      <legend style={{ fontSize: 11, color: '#a8c8ee', padding: '0 4px' }}>Rotar tramo</legend>
      <div style={{ fontSize: 10, color: '#9ab', marginBottom: 4 }} data-testid="tray-rotate-paso">
        Paso {PASO_ROTACION_DEG}° · {libre ? 'giro libre (Shift)' : 'Shift: libre'}
      </div>
      <label style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'center', marginBottom: 4 }}>
        Pivote
        <select
          className="inspector-input"
          data-testid="tray-rotate-pivot"
          value={pivoteValor}
          onChange={(e) => setPivote(e.target.value === 'centro' ? 'centro' : { boca: e.target.value.slice('boca:'.length) })}
        >
          <option value="centro">Centro de la pieza</option>
          {bocas.map((b) => <option key={b} value={`boca:${b}`}>Boca {b}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'center' }}>
        <select className="inspector-input" data-testid="tray-rotate-eje" value={eje} onChange={(e) => setEje(e.target.value as EjeMundo)}>
          {(['X', 'Y', 'Z'] as const).map((k) => <option key={k} value={k}>Eje {k}</option>)}
        </select>
        <input
          type="number"
          className="inspector-input"
          style={{ width: 80 }}
          data-testid="tray-rotate-angulo"
          value={texto ?? String(angulo)}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => { if (texto !== null && Number.isFinite(Number(texto))) setAngulo(Number(texto)); }}
        />
        °
        <button
          type="button"
          data-testid="tray-rotate-aplicar"
          onClick={() => {
            const deg = Number(texto ?? angulo);
            if (!Number.isFinite(deg)) return;
            setAngulo(deg);
            aplicarRotacion(piece.instancia_id, eje, deg, pivote);
            setTexto(null);
          }}
        >
          Aplicar
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Modal flotante en el inspector que aparece cuando un movimiento dejó
 * uniones sin coincidencia. El usuario puede:
 *  - Aceptar: confirma el movimiento Y descarta las conexiones afectadas
 *    (una sola entrada en history).
 *  - Cancelar: restaura la entrada previa al drag (sin history).
 */
function BrokenConnectionsModal() {
  const pending  = useTrayMoveState((s) => s.pending);
  const clear    = useTrayMoveState((s) => s.clear);
  const entrada  = useTrayStore((s) => s.entrada);
  const setRaw   = useTrayStore((s) => s.setEntradaRaw);
  const edit     = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);

  if (!pending || !entrada) return null;

  const onAccept = () => {
    const postDrag = useTrayStore.getState().entrada;
    if (!postDrag) { clear(); return; }
    const cleaned = removeConnections(postDrag, pending.brokenConexionIds);
    // Push snapshot to history then set entrada to cleaned post-drag state.
    setRaw(pending.snapshot);
    edit(cleaned);
    markDirty();
    clear();
  };
  const onCancel = () => {
    setRaw(pending.snapshot);
    markDirty();
    clear();
  };

  return (
    <div
      data-testid="tray-broken-modal"
      style={{
        margin: '6px 12px',
        padding: 10,
        background: '#3a1f1f',
        border: '1px solid #cc6644',
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 12, color: '#ffccaa', marginBottom: 6, fontWeight: 600 }}>
        ⚠ Mover o rotar el tramo desconectará {pending.brokenConexionIds.length} unión(es)
      </div>
      <div style={{ fontSize: 11, color: '#ffe0cc', marginBottom: 8, lineHeight: 1.5 }}>
        Las siguientes conexiones perdieron la coincidencia entre sus bocas.
        Si aceptás, el movimiento queda confirmado Y esas uniones se descartan
        para evitar que el modelo las trate como válidas:
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {pending.brokenConexionIds.map((id) => (
            <li key={id} data-testid={`broken-conn-${id}`} style={{ fontFamily: 'monospace', color: '#ffbb99' }}>
              {id}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          data-testid="tray-broken-accept"
          onClick={onAccept}
          style={{ fontSize: 12, padding: '4px 12px', background: '#8b4422', color: 'white', border: '1px solid #cc6644', borderRadius: 3, cursor: 'pointer' }}
        >
          Aceptar y desconectar
        </button>
        <button
          data-testid="tray-broken-cancel"
          onClick={onCancel}
          style={{ fontSize: 12, padding: '4px 12px', background: '#2a3344', color: '#ccd6e6', border: '1px solid #556688', borderRadius: 3, cursor: 'pointer' }}
        >
          Cancelar movimiento
        </button>
      </div>
    </div>
  );
}

export function PieceCard({ piece }: { piece: Piece }) {
  const context = useTrayStore((s) => s.context);
  const edit    = useTrayStore((s) => s.edit);
  const entrada = useTrayStore((s) => s.entrada);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const trayMoveMode     = useWorkspaceStore((s) => s.trayMoveMode);
  const setTrayMoveMode  = useWorkspaceStore((s) => s.setTrayMoveMode);
  const trayRotateMode   = useWorkspaceStore((s) => s.trayRotateMode);
  const setTrayRotateMode = useWorkspaceStore((s) => s.setTrayRotateMode);

  if (!entrada) return null;

  const updatePiece = (fn: (p: Piece) => void) => {
    const next = structuredClone(entrada);
    const idx  = next.piezas.findIndex((p) => p.instancia_id === piece.instancia_id);
    if (idx < 0) return;
    fn(next.piezas[idx]);
    edit(next);
    markDirty();
  };

  // Traslada la pieza entera por un delta (mm) usando el camino atómico
  // (snapshot → edit): una sola entrada en history que abarca TODOS los
  // puertos. Si la operación desconecta uniones, reporta cuáles mediante el
  // modal, igual que el gizmo.
  const translateWhole = (delta: [number, number, number]) => {
    if (!delta[0] && !delta[1] && !delta[2]) return;
    const snapshot = structuredClone(entrada);
    const next = structuredClone(entrada);
    const target = next.piezas.find((p) => p.instancia_id === piece.instancia_id);
    if (!target) return;
    for (const port of Object.values(target.puertos)) {
      port.posicion_mm[0] += delta[0];
      port.posicion_mm[1] += delta[1];
      port.posicion_mm[2] += delta[2];
    }
    // Reutilizamos la misma lógica del gizmo: detectar rotas y pedir
    // confirmación o aplicar directo.
    const broken = findBrokenConnections(next, piece.instancia_id);
    if (broken.length === 0) {
      edit(next);
      markDirty();
    } else {
      useTrayStore.getState().setEntradaRaw(next);
      markDirty();
      useTrayMoveState.getState().requestConfirm({
        pieceId: piece.instancia_id,
        snapshot,
        brokenConexionIds: broken,
      });
    }
  };

  const ports = Object.entries(piece.puertos);
  const product = context?.productos.find((p) => p.producto_id === piece.producto_id);
  const centroid = pieceCentroid(piece);
  // 3d: nombres visibles (SKU de producto y nombre físico de boca), no ids internos.
  const pIdx = indexProducts(context?.productos);
  const title = pieceLabelById(piece.instancia_id, entrada.piezas, pIdx);

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-category">Pieza de bandeja</span>
        <span className="inspector-title" data-testid="piece-title">{title}</span>
      </div>
      {(() => {
        const def = placedOf(entrada, piece)?.def;
        return def?.procedencia?.tipo === 'nominal'
          ? <p className="stage-note tone-warn" data-testid="piece-procedencia">Procedencia: {def.procedencia.nota}.</p>
          : null;
      })()}
      {avisosDeModelo(entrada, piece).map((a) => (
        <p key={a} className="stage-note tone-warn" data-testid="piece-aviso-modelo">Aviso de modelo — {a}.</p>
      ))}
      {mezclasDePieza(entrada, new Map((context?.productos ?? []).map((p) => [p.producto_id, p])), piece.instancia_id).map((m) => (
        <div key={`${m.tipo}:${m.id}`} className="stage-note" style={{ padding: '2px 12px' }} data-testid="piece-mezcla">
          {m.tipo === 'enganche' ? `Derivación ${m.id}` : `Unión ${m.id}`}
          <MarcaMezcla mezcla={m.mezcla} testid="piece-aviso-mezcla" />
        </div>
      ))}

      <BrokenConnectionsModal />

      <div style={{ padding: '4px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          className={trayMoveMode ? 'tone-ok' : undefined}
          data-testid="tray-move-toggle"
          onClick={() => setTrayMoveMode(!trayMoveMode)}
          title="Mostrar/ocultar gizmo XYZ para mover la pieza completa en planta y altura"
          style={{
            fontSize: 11,
            padding: '3px 10px',
            background: trayMoveMode ? '#a97014' : '#3c4967',
            color: 'white',
            border: `1px solid ${trayMoveMode ? '#f0b65e' : '#5566aa'}`,
            borderRadius: 3,
            cursor: 'pointer',
            fontWeight: trayMoveMode ? 600 : 400,
          }}
        >
          {trayMoveMode ? '✥ Mover tramo (activo — Esc)' : '✥ Mover tramo'}
        </button>
        <button
          className={trayRotateMode ? 'tone-ok' : undefined}
          data-testid="tray-rotate-toggle"
          onClick={() => setTrayRotateMode(!trayRotateMode)}
          title="Mostrar/ocultar el gizmo de rotación (anillos por eje) sobre la pieza"
          style={{
            fontSize: 11,
            padding: '3px 10px',
            background: trayRotateMode ? '#1f5a8a' : '#3c4967',
            color: 'white',
            border: `1px solid ${trayRotateMode ? '#7fc0f0' : '#5566aa'}`,
            borderRadius: 3,
            cursor: 'pointer',
            fontWeight: trayRotateMode ? 600 : 400,
          }}
        >
          {trayRotateMode ? '⟳ Rotar tramo (activo — Esc)' : '⟳ Rotar tramo'}
        </button>
      </div>
      {trayRotateMode && <TrayRotatePanel piece={piece} />}

      <TrayCentroidEditor
        piece={piece}
        centroidMm={centroid}
        onTranslate={translateWhole}
      />

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

      {esCurvaEslabonada(entrada, piece) && typeof product?.ancho_nominal_mm === 'number' && (
        <AnguloEslabonadaField key={piece.instancia_id} piece={piece} ancho={product.ancho_nominal_mm} />
      )}

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
          <legend style={{ fontSize: 11, color: '#8888aa' }}>{portLabel(piece.producto_id, portId, pIdx)} · mm global</legend>
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

      <BandaDivisoriaControl piece={piece} />

      <RotatePieceControls piece={piece} entrada={entrada} />

      <div style={{ padding: '4px 12px 8px' }}>
        <button className="tone-danger"
          style={{ fontSize: 12, padding: '4px 8px', background: '#8b2222', color: 'white', border: '1px solid #cc3333', borderRadius: 3, cursor: 'pointer' }}
          onClick={() => {
            if (!confirm(`Eliminar pieza "${title}"?`)) return;
            const next = structuredClone(entrada);
            next.piezas = next.piezas.filter((p) => p.instancia_id !== piece.instancia_id);
            edit(next);
            markDirty();
          }}
        >
          Eliminar pieza
        </button>
      </div>

      {/* Hito 1b: los resultados del motor viven en la etapa Resultados. */}
    </div>
  );
}

// ─── Support card ─────────────────────────────────────────────────────────────

export function SupportCard({ support }: { support: Support }) {
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
    if (!confirm('¿Eliminar este soporte?')) return;
    const next = structuredClone(entrada);
    next.soportes = next.soportes.filter((s) => s.soporte_id !== support.soporte_id);
    edit(next);
    markDirty();
  };

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-category">Soporte</span>
        <span className="inspector-title">{product ? productLabel(product.producto_id, indexProducts(context?.productos)) : support.soporte_id}</span>
      </div>

      <div style={{ padding: '4px 12px', fontSize: 11, color: '#8888aa', lineHeight: 1.5 }}>
        <p style={{ margin: '0 0 6px', color: '#bb99cc' }}>
          La caja púrpura en el visor marca la <strong>ubicación calculada</strong> del soporte — no es la geometría real del herraje.
        </p>
        <div>Pieza: <strong style={{ color: '#c0c0e0' }}>{pieceLabelById(support.instancia_id, entrada.piezas, indexProducts(context?.productos))}</strong></div>
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
        <button className="tone-danger"
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

function LinkedImportedPanel({ equipoId, onUnlink, onOpenInImportedTree }: {
  equipoId: string;
  onUnlink: () => void;
  onOpenInImportedTree: () => void;
}) {
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const equipo = catalog?.equipos.find((e) => e.equipoId === equipoId);
  if (!catalog) {
    return (
      <details className="imported-linked" open style={{ margin: '0 12px 8px', padding: '6px 10px', border: '1px solid #4a5570', borderRadius: 3, background: '#1e2338' }}>
        <summary style={{ fontSize: 12, color: '#ebb0ff', cursor: 'pointer' }}>
          Vinculado al catálogo importado · {equipoId}
        </summary>
        <div style={{ fontSize: 11, color: '#ffcc55', marginTop: 6 }}>
          El libro origen no está cargado — reimportá el Excel para ver la ficha completa.
        </div>
        <div style={{ marginTop: 6 }}>
          <button className="tone-warn" onClick={onUnlink} style={{ fontSize: 11, padding: '2px 8px', background: '#3a2a2a', color: '#ffd6d6', border: '1px solid #884444', borderRadius: 3, cursor: 'pointer' }}>
            Desvincular
          </button>
        </div>
      </details>
    );
  }
  if (!equipo) {
    return (
      <details className="imported-linked imported-linked--orphan" open style={{ margin: '0 12px 8px', padding: '6px 10px', border: '1px solid #884444', borderRadius: 3, background: '#2a1e1e' }}>
        <summary style={{ fontSize: 12, color: '#ffb0b0', cursor: 'pointer' }} data-testid="imported-linked-orphan">
          Huérfano · {equipoId} no existe en el libro actual
        </summary>
        <div style={{ fontSize: 11, color: '#ffcc55', marginTop: 6, lineHeight: 1.4 }}>
          El libro importado ya no contiene este equipoId. El elemento del proyecto se conserva
          intacto; revisá si cambió de ID o fue retirado y decidí desvincular manualmente.
        </div>
        <div style={{ marginTop: 6 }}>
          <button className="tone-warn" onClick={onUnlink} style={{ fontSize: 11, padding: '2px 8px', background: '#3a2a2a', color: '#ffd6d6', border: '1px solid #884444', borderRadius: 3, cursor: 'pointer' }}>
            Desvincular
          </button>
        </div>
      </details>
    );
  }
  const atributos = catalog.atributos.filter((a) => a.equipoId === equipoId && !a.componenteId && a.vigente === 'SI');
  return (
    <details className="imported-linked" open style={{ margin: '0 12px 8px', padding: '6px 10px', border: '1px solid #4a5570', borderRadius: 3, background: '#1e2338' }}>
      <summary style={{ fontSize: 12, color: '#ebb0ff', cursor: 'pointer' }} data-testid="imported-linked-summary">
        Vinculado al catálogo importado · {equipo.tag ?? equipoId}
      </summary>
      <div style={{ fontSize: 11, color: '#8f9ba3', marginTop: 4 }}>
        {equipo.descripcion} · {equipo.categoria} · {equipo.estadoAlcance}
      </div>
      {atributos.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#c0c0e0' }}>
          {atributos.slice(0, 8).map((a) => (
            <div key={a.atributoId}>
              <span style={{ color: '#8f9ba3' }}>{a.atributo}: </span>
              <span>{a.valorTexto ?? (a.valorNumero != null ? String(a.valorNumero) : '—')}</span>
              {a.unidad ? <span style={{ color: '#8f9ba3' }}> {a.unidad}</span> : null}
            </div>
          ))}
          {atributos.length > 8 && (
            <div style={{ color: '#8f9ba3', marginTop: 2 }}>+{atributos.length - 8} más…</div>
          )}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
        <button onClick={onOpenInImportedTree} style={{ fontSize: 11, padding: '2px 8px', background: '#3c4967', color: 'white', border: '1px solid #5566aa', borderRadius: 3, cursor: 'pointer' }} data-testid="imported-linked-open">
          Ver ficha completa
        </button>
        <button className="tone-warn" onClick={onUnlink} style={{ fontSize: 11, padding: '2px 8px', background: '#3a2a2a', color: '#ffd6d6', border: '1px solid #884444', borderRadius: 3, cursor: 'pointer' }} data-testid="imported-linked-unlink">
          Desvincular
        </button>
      </div>
    </details>
  );
}

export function EquipmentCard() {
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const elements        = useWorkspaceStore((s) => s.elements);
  const updateElement   = useWorkspaceStore((s) => s.updateElement);
  const addEvidence     = useWorkspaceStore((s) => s.addEvidence);
  const removeElement   = useWorkspaceStore((s) => s.removeElement);
  const unlinkElement   = useWorkspaceStore((s) => s.unlinkElement);
  const selectImportedEquipo = useWorkspaceStore((s) => s.selectImportedEquipo);
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

  const moveMode    = useWorkspaceStore((s) => s.moveMode);
  const setMoveMode = useWorkspaceStore((s) => s.setMoveMode);
  const canMove = Boolean(element && element.placementStatus === 'placed' && element.parentId === null);

  return (
    <div className="inspector-panel">
      {element && (
        <div style={{ padding: '4px 12px 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className={moveMode ? 'tone-ok' : undefined}
            data-testid="equip-move-toggle"
            onClick={() => setMoveMode(!moveMode)}
            disabled={!canMove}
            title={canMove ? 'Mostrar/ocultar gizmo XYZ para mover el equipo en escena' : 'El equipo debe estar colocado y sin padre para moverse'}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              background: moveMode ? '#2d7a4e' : '#3c4967',
              color: 'white',
              border: `1px solid ${moveMode ? '#6fd398' : '#5566aa'}`,
              borderRadius: 3,
              cursor: canMove ? 'pointer' : 'not-allowed',
              fontWeight: moveMode ? 600 : 400,
              opacity: canMove ? 1 : 0.5,
            }}
          >
            {moveMode ? '✥ Mover (activo — Esc)' : '✥ Mover libremente'}
          </button>
          <button onClick={handleDuplicate} style={{ fontSize: 11, padding: '3px 8px', background: '#3c4967', color: 'white', border: '1px solid #5566aa', borderRadius: 3, cursor: 'pointer' }}>
            Duplicar
          </button>
          <button className="tone-danger" onClick={handleDelete} style={{ fontSize: 11, padding: '3px 8px', background: '#6b2222', color: 'white', border: '1px solid #aa3333', borderRadius: 3, cursor: 'pointer' }}>
            Eliminar
          </button>
        </div>
      )}
      {element?.importedRef && (
        <LinkedImportedPanel
          equipoId={element.importedRef.equipoId}
          onUnlink={() => unlinkElement(element.id)}
          onOpenInImportedTree={() => selectImportedEquipo(element.importedRef!.equipoId)}
        />
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

export function TrayHistoryControls() {
  const trayUndo  = useTrayStore((s) => s.undo);
  const trayRedo  = useTrayStore((s) => s.redo);
  const history   = useTrayStore((s) => s.history);
  const future    = useTrayStore((s) => s.future);
  const equipUndo        = useWorkspaceStore((s) => s.undoEquip);
  const equipRedo        = useWorkspaceStore((s) => s.redoEquip);
  const equipHistory     = useWorkspaceStore((s) => s.equipHistory);
  const equipFuture      = useWorkspaceStore((s) => s.equipFuture);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const canUndo   = history.length > 0;
  const canRedo   = future.length > 0;
  const canUndoEquip = equipHistory.length > 0;
  const canRedoEquip = equipFuture.length > 0;

  // Hito 1b: siempre visible en la barra de proyecto. Conserva el comportamiento
  // actual (dos historiales: bandejas y equipos); el historial unificado es otro hito.
  return (
    <div className="history-controls" role="group" aria-label="Deshacer y rehacer">
      <span className="history-label">Bandejas</span>
      <button
        type="button"
        title={canUndo ? `Deshacer bandeja (${history.length})` : 'Sin cambios de bandejas para deshacer'}
        aria-label="Deshacer cambio de bandejas"
        onClick={() => { if (canUndo) { trayUndo(); markDirty(); } }}
        disabled={!canUndo}
      >
        ↩ Deshacer
      </button>
      <button
        type="button"
        title={canRedo ? `Rehacer bandeja (${future.length})` : 'Sin cambios de bandejas para rehacer'}
        aria-label="Rehacer cambio de bandejas"
        onClick={() => { if (canRedo) { trayRedo(); markDirty(); } }}
        disabled={!canRedo}
      >
        ↪ Rehacer
      </button>
      <span className="history-label">Equipos</span>
      <button
        type="button"
        data-testid="equip-undo"
        title={canUndoEquip ? `Deshacer equipo (${equipHistory.length})` : 'Sin cambios de equipos para deshacer'}
        aria-label="Deshacer cambio de equipos"
        onClick={() => { if (canUndoEquip) equipUndo(); }}
        disabled={!canUndoEquip}
      >
        ↩ Deshacer
      </button>
      <button
        type="button"
        data-testid="equip-redo"
        title={canRedoEquip ? `Rehacer equipo (${equipFuture.length})` : 'Sin cambios de equipos para rehacer'}
        aria-label="Rehacer cambio de equipos"
        onClick={() => { if (canRedoEquip) equipRedo(); }}
        disabled={!canRedoEquip}
      >
        ↪ Rehacer
      </button>
    </div>
  );
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export function WorkspaceInspector() {
  const selectedEquipId        = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedTrayId         = useWorkspaceStore((s) => s.selectedTrayId);
  const selectedSupportId      = useWorkspaceStore((s) => s.selectedSupportId);
  const selectedImportedEquipId = useWorkspaceStore((s) => s.selectedImportedEquipoId);
  const entrada                = useTrayStore((s) => s.entrada);
  const routingActive          = useRoutingStore((s) => s.active);

  const piece   = selectedTrayId    ? entrada?.piezas.find((p) => p.instancia_id === selectedTrayId)        : null;
  const support = selectedSupportId ? entrada?.soportes.find((s) => s.soporte_id === selectedSupportId)    : null;

  return (
    <div className="panel panel-right" style={{ overflow: 'auto' }}>
      <div className="panel-title">Inspector</div>

      {routingActive ? (
        <RoutingPanel />
      ) : selectedImportedEquipId ? (
        <ImportedEquipmentInspector />
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
