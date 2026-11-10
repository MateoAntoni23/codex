/**
 * Etapa 3 — Bandejas.
 *
 * Izquierda: pieza nueva (producto y extremos), piezas, extremos libres,
 * uniones, soportes y PE. Herramientas: Seleccionar, Continuar, Tramo nuevo,
 * Unir extremos, Soporte. Reutiliza los formularios existentes
 * (AddTraySegmentForm, AddSupportForm) y el panel de continuación (RoutingPanel,
 * en el inspector).
 */
import { useMemo, useState } from 'react';
import { useWorkspaceStore, type LayerKey } from '../useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { useRoutingStore } from '../useRoutingStore';
import { getFreePorts } from '../routingRules';
import { AddTraySegmentForm } from '../AddTraySegmentForm';
import { AddSupportForm } from '../AddSupportForm';
import { RoutingStatusBadge } from '../RoutingPanel';
import { useUiStore, type BandejasTool } from './uiStore';
import { indexProducts, pieceLabel, pieceLabelById, portLabel, productLabel } from './displayNames';
import { Empty, Section, ToolBar, useRevealSelected } from './shared';

const LAYERS: Array<[LayerKey, string]> = [
  ['trays', 'Bandejas'],
  ['supports', 'Soportes'],
  ['pe', 'PE'],
];

export function BandejasPanel() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const selectedTrayId = useWorkspaceStore((s) => s.selectedTrayId);
  const selectedSupportId = useWorkspaceStore((s) => s.selectedSupportId);
  const selectTray = useWorkspaceStore((s) => s.selectTray);
  const selectSupport = useWorkspaceStore((s) => s.selectSupport);
  const layers = useWorkspaceStore((s) => s.layers);
  const toggleLayer = useWorkspaceStore((s) => s.toggleLayer);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const connectionToolActive = useWorkspaceStore((s) => s.connectionToolActive);
  const connectionPortA = useWorkspaceStore((s) => s.connectionPortA);
  const routingActive = useRoutingStore((s) => s.active);
  const startPort = useRoutingStore((s) => s.startPort);
  const formTool = useUiStore((s) => s.bandejasTool);
  const setFormTool = useUiStore((s) => s.setBandejasTool);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);

  const piezas = entrada?.piezas ?? [];
  const conexiones = entrada?.conexiones ?? [];
  const pIdx = useMemo(() => indexProducts(context?.productos), [context]);
  const freeEnds = useMemo(() => getFreePorts(piezas, conexiones), [piezas, conexiones]);
  useRevealSelected(listEl, selectedTrayId ? `piece:${selectedTrayId}` : null);

  const activeTool: BandejasTool = routingActive
    ? 'continuar'
    : connectionToolActive
      ? 'unir'
      : formTool;

  const resetTools = () => {
    useRoutingStore.getState().deactivate();
    useWorkspaceStore.getState().deactivateConnectionTool();
    setFormTool('seleccionar');
  };

  const pickTool = (t: BandejasTool) => {
    resetTools();
    if (t === 'continuar') useRoutingStore.getState().activate();
    else if (t === 'unir') useWorkspaceStore.getState().activateConnectionTool();
    else setFormTool(t);
  };

  const continueFrom = (fp: (typeof freeEnds)[number]) => {
    useWorkspaceStore.getState().deactivateConnectionTool();
    setFormTool('seleccionar');
    const rs = useRoutingStore.getState();
    rs.activate();
    rs.selectStartPort(fp);
  };

  const editTray = (fn: (inp: NonNullable<typeof entrada>) => void) => {
    if (!entrada) return;
    const next = structuredClone(entrada);
    fn(next);
    trayEdit(next);
    markDirty();
  };

  const removeConexion = (id: string) => {
    if (!confirm('¿Eliminar esta unión?')) return;
    editTray((inp) => { inp.conexiones = inp.conexiones.filter((c) => c.conexion_id !== id); });
  };

  const endLabel = (pieceId: string, portName: string) => {
    const piece = piezas.find((p) => p.instancia_id === pieceId);
    return `${pieceLabelById(pieceId, piezas, pIdx)} · ${piece ? portLabel(piece.producto_id, portName, pIdx) : portName}`;
  };

  const noPieces = piezas.length === 0;

  return (
    <div className="stage-panel" data-testid="panel-bandejas">
      <ToolBar
        stage="bandejas"
        active={activeTool}
        onPick={pickTool}
        tools={[
          { id: 'seleccionar', label: 'Seleccionar' },
          { id: 'continuar', label: 'Continuar', disabled: !context || noPieces, title: noPieces ? 'Agregá una pieza primero' : 'Elegí un extremo libre para continuar el trazado' },
          { id: 'tramo', label: 'Tramo nuevo', disabled: !context, title: !context ? 'Catálogo cargando…' : 'Crear un tramo recto por coordenadas' },
          { id: 'unir', label: 'Unir extremos', disabled: piezas.length < 2, title: piezas.length < 2 ? 'Hacen falta dos piezas' : 'Unir dos extremos libres' },
          { id: 'soporte', label: 'Soporte', disabled: !context || noPieces, title: noPieces ? 'Agregá una pieza primero' : 'Agregar un soporte' },
        ]}
      />

      {routingActive && (
        <p className="stage-note" role="status" data-testid="routing-hint">
          <RoutingStatusBadge />
          {!startPort && ' — o elegí un extremo libre en la lista.'}
        </p>
      )}
      {connectionToolActive && (
        <p className="stage-note" role="status" data-testid="join-hint">
          {!connectionPortA
            ? 'Hacé clic en un extremo (esfera) de la escena para elegir el primero.'
            : `Primer extremo: ${endLabel(connectionPortA[0], connectionPortA[1])}. Hacé clic en el otro.`}
        </p>
      )}

      {activeTool === 'tramo' && (
        <Section title="Pieza nueva" testid="new-piece">
          <AddTraySegmentForm onClose={() => setFormTool('seleccionar')} />
        </Section>
      )}
      {activeTool === 'soporte' && (
        <Section title="Soporte nuevo" testid="new-support">
          <AddSupportForm onClose={() => setFormTool('seleccionar')} />
        </Section>
      )}

      <section className="stage-section" ref={setListEl} data-testid="piece-list">
        <h4 className="stage-section-title">Piezas ({piezas.length})</h4>
        {noPieces && <Empty testid="tray-empty">Sin piezas todavía</Empty>}
        {piezas.map((p, i) => {
          const isSel = selectedTrayId === p.instancia_id;
          return (
            <button
              key={p.instancia_id}
              type="button"
              data-row-key={`piece:${p.instancia_id}`}
              className={`workspace-tree-item stage-row${isSel ? ' active' : ''}`}
              aria-current={isSel ? 'true' : undefined}
              title={typeof pIdx.get(p.producto_id)?.descripcion_original === 'string' ? String(pIdx.get(p.producto_id)?.descripcion_original) : undefined}
              onClick={() => selectTray(p.instancia_id)}
            >
              {pieceLabel(p, i + 1, pIdx)}
            </button>
          );
        })}
      </section>

      <Section title={`Extremos libres (${freeEnds.length})`} testid="free-ends">
        {freeEnds.length === 0 && <Empty>Sin extremos libres.</Empty>}
        {freeEnds.map((fp) => {
          const isStart = startPort?.pieceId === fp.pieceId && startPort?.portName === fp.portName;
          return (
            <button
              key={`${fp.pieceId}:${fp.portName}`}
              type="button"
              className={`workspace-tree-item stage-row${isStart ? ' active' : ''}`}
              data-testid="free-end"
              title="Continuar el trazado desde este extremo"
              onClick={() => continueFrom(fp)}
            >
              ↗ {endLabel(fp.pieceId, fp.portName)}
            </button>
          );
        })}
      </Section>

      <Section title={`Uniones (${conexiones.length})`} testid="joins">
        {conexiones.length === 0 && <Empty>Sin uniones.</Empty>}
        {conexiones.map((c) => (
          <div key={c.conexion_id} className="stage-row-inline">
            <span>{endLabel(c.a[0], c.a[1])} ↔ {endLabel(c.b[0], c.b[1])}</span>
            <button type="button" className="stage-icon-btn tone-danger" aria-label="Eliminar unión" onClick={() => removeConexion(c.conexion_id)}>×</button>
          </div>
        ))}
      </Section>

      <Section title={`Soportes (${entrada?.soportes.length ?? 0})`} testid="supports">
        {(entrada?.soportes.length ?? 0) === 0 && <Empty>Sin soportes.</Empty>}
        {entrada?.soportes.map((s) => {
          const isSel = selectedSupportId === s.soporte_id;
          return (
            <button
              key={s.soporte_id}
              type="button"
              className={`workspace-tree-item stage-row${isSel ? ' active' : ''}`}
              onClick={() => selectSupport(s.soporte_id)}
            >
              {productLabel(s.producto_id, pIdx)} · {pieceLabelById(s.instancia_id, piezas, pIdx)} · {s.distancia_desde_P1_mm} mm
            </button>
          );
        })}
      </Section>

      {entrada && (
        <Section title="PE requerido" testid="pe">
          <p className="stage-note">Modelo candidato; admisibilidad pendiente. Contacto con ala ≠ conexión eléctrica.</p>
          <select
            className="inspector-input"
            aria-label="Cable PE"
            value={entrada.pe.cable_id}
            onChange={(e) => editTray((inp) => { inp.pe.cable_id = e.target.value; })}
            data-testid="pe-cable"
          >
            <option value="">PE sin definir</option>
            {context?.cables.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </Section>
      )}

      <Section title="Visibilidad">
        {LAYERS.map(([key, label]) => (
          <label key={key} className="stage-check">
            <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
            {label} visibles
          </label>
        ))}
      </Section>
    </div>
  );
}
