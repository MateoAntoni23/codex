/**
 * Etapa 3 — Bandejas.
 *
 * Izquierda (interfaz, 2026-11-14): lo que EXISTE — herramientas, piezas
 * agrupadas por tipo con filtro (`ListaPiezas`), extremos libres, derivaciones,
 * uniones y visibilidad. Los formularios (tramo nuevo, soporte, derivación) se
 * abren en el inspector (`FormularioInspector`), igual que el panel de
 * continuación (RoutingPanel). El PE no se elige acá: lo arma la app desde el
 * trazado (D-20, D-21; etapa 3).
 */
import { extremosLibres } from '../derivacion/extremosLibres';
import { useMemo, useState } from 'react';
import { useWorkspaceStore, type LayerKey } from '../useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { useRoutingStore } from '../useRoutingStore';
import { RoutingStatusBadge } from '../RoutingPanel';
import { useUiStore, type BandejasTool } from './uiStore';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';
import { EnganchesSection } from './DerivacionSection';
import { Empty, Section, ToolBar } from './shared';
import { ListaPiezas } from './ListaPiezas';
import { PE_CABLE_ID, PE_SECCION_MM2 } from '../motor/paraMotor';
import { isNeutralPe } from '../../project/emptyProject';
import { useCatalogConfigStore } from '../../configurator/catalogConfigStore';
import { outdatedPieces, updateOutdatedPieces } from '../placement/definitions';
import { AVISO_MEZCLA_PREFIJO, checkConnection, formatJoin, invalidConnections } from '../placement/joins';
import { MarcaMezcla } from './MarcaMezcla';
import { mezclaDeAcabados } from '../mezclaAcabados';
import { unionsOf } from '../workspaceOperation';
import type { Product } from '../../tray/model';

const LAYERS: Array<[LayerKey, string]> = [
  ['trays', 'Bandejas'],
  ['supports', 'Soportes'],
  ['pe', 'PE'],
];

export function BandejasPanel() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const layers = useWorkspaceStore((s) => s.layers);
  const toggleLayer = useWorkspaceStore((s) => s.toggleLayer);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const connectionToolActive = useWorkspaceStore((s) => s.connectionToolActive);
  const connectionPortA = useWorkspaceStore((s) => s.connectionPortA);
  const routingActive = useRoutingStore((s) => s.active);
  const startPort = useRoutingStore((s) => s.startPort);
  const formTool = useUiStore((s) => s.bandejasTool);
  const setFormTool = useUiStore((s) => s.setBandejasTool);

  const piezas = entrada?.piezas ?? [];
  const conexiones = entrada?.conexiones ?? [];
  const pIdx = useMemo(() => indexProducts(context?.productos), [context]);
  const freeEnds = useMemo(() => extremosLibres(entrada), [entrada]);

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

  // A-6: piezas cuya definición guardada difiere de la vigente (la biblioteca
  // cambió). No cambian solas: se ofrece actualizarlas como acción explícita.
  const libraryOverrides = useCatalogConfigStore((s) => s.overrides);
  const productMap = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const outdated = useMemo(
    () => (entrada ? outdatedPieces(entrada, productMap) : []),
    [entrada, productMap, libraryOverrides], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const updateAll = () => {
    if (!entrada) return;
    const { entrada: next, updated } = updateOutdatedPieces(entrada, productMap);
    const broken = invalidConnections(next, new Set(updated));
    trayEdit(next);
    markDirty();
    setUpdateMsg(
      `${updated.length} pieza(s) actualizada(s) a la definición vigente.` +
      (broken.length ? ` ${broken.length} unión(es) dejaron de cumplir: revisalas en Uniones.` : ''),
    );
  };

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
          { id: 'derivacion', label: 'Derivación en tramo', disabled: !context || noPieces, title: noPieces ? 'Agregá un tramo primero' : 'Enganchar un ramal al flanco de un tramo recto, sin cortarlo' },
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


      {outdated.length > 0 && (
        <div className="stage-card tone-warn" role="status" data-testid="outdated-notice">
          <div>
            {outdated.length} pieza(s) colocada(s) con una definición distinta de la vigente (la biblioteca cambió).
            Se siguen dibujando como fueron colocadas.
          </div>
          <button type="button" onClick={updateAll} data-testid="update-outdated">
            Actualizar {outdated.length} pieza(s)
          </button>
        </div>
      )}
      {updateMsg && <p className="stage-note" role="status" data-testid="update-outdated-result">{updateMsg}</p>}


      {(activeTool === 'tramo' || activeTool === 'soporte' || activeTool === 'derivacion') && (
        <p className="stage-note" role="status" data-testid="form-hint">El formulario está abierto en el inspector (a la derecha).</p>
      )}

      <ListaPiezas />

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

      <EnganchesSection />

      <Section title={`Uniones (${conexiones.length})`} testid="joins">
        {conexiones.length === 0 && <Empty>Sin uniones.</Empty>}
        {conexiones.map((c) => {
          const chk = entrada ? checkConnection(entrada, c, productMap) : null;
          const prodDe = (id: string) => productMap.get(piezas.find((p) => p.instancia_id === id)?.producto_id ?? '');
          const mezcla = chk?.avisos.some((a) => a.startsWith(AVISO_MEZCLA_PREFIJO)) ? mezclaDeAcabados(prodDe(c.a[0]), prodDe(c.b[0])) : null;
          const rec = unionsOf(entrada)[c.conexion_id];
          const exc = rec?.estado === 'excepcion' || !!(entrada as Record<string, unknown> | null)?.excepciones_conexion?.[c.conexion_id as never];
          return (
          <div key={c.conexion_id} className="stage-row-inline" data-testid="join-row" data-join-ok={chk?.ok ? 'true' : 'false'} data-join-estado={exc ? 'excepcion' : (rec?.estado ?? 'sin_registro')} data-join-mezcla={mezcla ? `${mezcla.acabadoA.codigo}|${mezcla.acabadoB.codigo}` : undefined}>
            <span>
              {endLabel(c.a[0], c.a[1])} ↔ {endLabel(c.b[0], c.b[1])}
              {chk && !chk.ok && <span className="tone-danger"> · no cumple ({formatJoin(chk)})</span>}
              {chk?.avisos.filter((a) => a.startsWith('ala (boca')).map((a) => <span key={a} className="tone-warn" data-testid="join-aviso-ala"> · {a}</span>)}
              {exc && <span className="tone-warn"> · excepción</span>}
              {mezcla && <MarcaMezcla mezcla={mezcla} testid="join-aviso-mezcla" />}
            </span>
            <button type="button" className="stage-icon-btn tone-danger" aria-label="Eliminar unión" onClick={() => removeConexion(c.conexion_id)}>×</button>
          </div>
          );
        })}
      </Section>

      {entrada && (
        <Section title="PE" testid="pe">
          <p className="stage-note" style={{ whiteSpace: 'normal' }} data-testid="pe-info">
            {isNeutralPe(entrada.pe)
              ? `Lo arma la app desde el trazado al calcular: ${PE_SECCION_MM2} mm² (D-20), ${PE_CABLE_ID} verde/amarillo (D-21), por todas las piezas.`
              : `PE propio del proyecto: ${entrada.pe.cable_id}.`}
          </p>
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
