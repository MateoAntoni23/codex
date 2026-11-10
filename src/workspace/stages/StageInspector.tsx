/**
 * Inspector por etapa. Muestra la ficha de lo seleccionado sólo si pertenece a
 * la etapa activa; sin selección muestra el resumen de la etapa y el siguiente
 * paso sugerido (reemplaza a la guía de trabajo y a la leyenda fijas).
 */
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { useRoutingStore } from '../useRoutingStore';
import { RoutingPanel } from '../RoutingPanel';
import { ImportedEquipmentInspector } from '../../import/ImportedEquipmentInspector';
import { EquipmentCard, PieceCard, SupportCard } from '../WorkspaceInspector';
import { getFreePorts } from '../routingRules';
import { object } from '../../tray/model';
import { useUiStore } from './uiStore';
import { indexProducts, pieceLabelById } from './displayNames';
import { reservaOf, ResultSummary } from './ResultadosPanel';
import { StageSummary } from './shared';

function EquiposSummary() {
  const elements = useWorkspaceStore((s) => s.elements);
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const own = elements.filter((e) => e.category !== 'infrastructure');
  const linked = new Set(elements.map((e) => e.importedRef?.equipoId).filter(Boolean) as string[]);
  const importedPending = (catalog?.equipos ?? []).filter((e) => e.estadoAlcance !== 'RETIRADO' && !linked.has(e.equipoId)).length;
  const placed = own.filter((e) => e.placementStatus === 'placed').length;
  const unplacedOwn = own.length - placed;
  const total = own.length + importedPending;
  const next = total === 0
    ? 'Importá el Excel de equipos o creá un equipo nuevo.'
    : importedPending + unplacedOwn > 0
      ? `Ubicá los equipos sin ubicar (${importedPending + unplacedOwn}): elegí uno en la lista y usá Ubicar.`
      : 'Pasá a Bandejas para trazar el recorrido.';
  return (
    <StageSummary
      title="Equipos"
      rows={[['Ubicados', placed], ['Sin ubicar', importedPending + unplacedOwn], ['Del Excel', catalog ? catalog.equipos.length : 'Sin Excel']]}
      next={next}
    />
  );
}

function PlantaSummary() {
  const n = useWorkspaceStore((s) => s.elements.filter((e) => e.category === 'infrastructure').length);
  return (
    <StageSummary
      title="Planta"
      rows={[['Elementos de planta', n]]}
      next={n === 0 ? 'Este proyecto no tiene elementos de planta; seguí con Equipos o Bandejas.' : 'Elegí un elemento para ver su ficha.'}
    >
      <p className="stage-note">Editar dimensiones y posición de la infraestructura y cargar planos todavía no está disponible.</p>
    </StageSummary>
  );
}

function BandejasSummary() {
  const entrada = useTrayStore((s) => s.entrada);
  const piezas = entrada?.piezas ?? [];
  const free = getFreePorts(piezas, entrada?.conexiones ?? []).length;
  const next = piezas.length === 0
    ? 'Usá Tramo nuevo para crear la primera pieza.'
    : `Continuá el trazado desde un extremo libre (${free}) o pasá a Resultados para calcular.`;
  return (
    <StageSummary
      title="Bandejas"
      rows={[['Piezas', piezas.length], ['Uniones', entrada?.conexiones.length ?? 0], ['Extremos libres', free], ['Soportes', entrada?.soportes.length ?? 0], ['Cable PE', entrada?.pe.cable_id || 'PE sin definir']]}
      next={next}
    />
  );
}

function ConexionesSummary() {
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const circuitos = useTrayStore((s) => s.entrada?.circuitos.length ?? 0);
  return (
    <StageSummary
      title="Conexiones"
      rows={[['Del Excel (sin recorrido)', catalog ? catalog.conexiones.length : 'Sin Excel'], ['Circuitos del trazado', circuitos]]}
      next={catalog ? 'Revisá los circuitos. Asignar recorridos a las conexiones llega en un hito posterior.' : 'Importá el Excel en la etapa Equipos para ver sus conexiones.'}
    />
  );
}

function ResultadosSummary() {
  const entrada = useTrayStore((s) => s.entrada);
  const engine = useTrayStore((s) => s.engine);
  const result = useTrayStore((s) => s.result);
  const n = entrada?.piezas.length ?? 0;
  const next = n === 0
    ? 'Agregá piezas en Bandejas.'
    : reservaOf(entrada) === null
      ? 'Cargá la reserva solicitada (%) y calculá.'
      : engine.state !== 'conectado'
        ? 'Encendé el servicio de cálculo y usá Reconectar motor.'
        : !result
          ? 'Calculá el trazado.'
          : 'Elegí una pieza en la escena para ver su resultado.';
  return (
    <StageSummary title="Resultados" rows={[['Piezas', n], ['Servicio de cálculo', engine.state]]} next={next}>
      <ResultSummary />
    </StageSummary>
  );
}

/** Resultado del motor para la pieza seleccionada. */
function PieceResult({ id }: { id: string }) {
  const result = useTrayStore((s) => s.result);
  const status = useTrayStore((s) => s.status);
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const label = pieceLabelById(id, entrada?.piezas ?? [], indexProducts(context?.productos));
  const blocks: Array<[string, unknown]> = [];
  if (result) {
    for (const [k, v] of Object.entries(result)) {
      if (object(v) && id in v) blocks.push([k, v[id]]);
    }
    const pe = result.pe;
    if (object(pe) && object(pe.cobertura) && object(pe.cobertura.por_pieza) && id in pe.cobertura.por_pieza) {
      blocks.push(['PE · cobertura', pe.cobertura.por_pieza[id]]);
    }
  }
  return (
    <div className="inspector-panel" data-testid="piece-result">
      <div className="inspector-header">
        <span className="inspector-category">Resultado de la pieza</span>
        <span className="inspector-title">{label}</span>
      </div>
      {!result && <p className="stage-note">Sin resultados. Calculá el trazado.</p>}
      {result && status !== 'vigente' && <p className="stage-note tone-warn">Resultado no vigente: recalcular.</p>}
      {result && blocks.length === 0 && <p className="stage-note">El motor no informa datos propios de esta pieza.</p>}
      {blocks.map(([k, v]) => (
        <details key={k} open className="stage-card">
          <summary>{k.split('_').join(' ')}</summary>
          <pre className="tray-json">{JSON.stringify(v, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}

export function StageInspector() {
  const stage = useUiStore((s) => s.stage);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedTrayId = useWorkspaceStore((s) => s.selectedTrayId);
  const selectedSupportId = useWorkspaceStore((s) => s.selectedSupportId);
  const selectedImportedId = useWorkspaceStore((s) => s.selectedImportedEquipoId);
  const elements = useWorkspaceStore((s) => s.elements);
  const entrada = useTrayStore((s) => s.entrada);
  const routingActive = useRoutingStore((s) => s.active);

  const element = selectedEquipId ? elements.find((e) => e.id === selectedEquipId) ?? null : null;
  const piece = selectedTrayId ? entrada?.piezas.find((p) => p.instancia_id === selectedTrayId) ?? null : null;
  const support = selectedSupportId ? entrada?.soportes.find((s) => s.soporte_id === selectedSupportId) ?? null : null;

  let body: React.ReactNode;
  switch (stage) {
    case 'equipos':
      body = selectedImportedId ? <ImportedEquipmentInspector />
        : element && element.category !== 'infrastructure' ? <EquipmentCard />
        : <EquiposSummary />;
      break;
    case 'planta':
      body = element && element.category === 'infrastructure' ? <EquipmentCard /> : <PlantaSummary />;
      break;
    case 'bandejas':
      body = routingActive ? <RoutingPanel />
        : piece ? <PieceCard piece={piece} />
        : support ? <SupportCard support={support} />
        : <BandejasSummary />;
      break;
    case 'conexiones':
      body = <ConexionesSummary />;
      break;
    case 'resultados':
      body = piece ? <PieceResult id={piece.instancia_id} /> : <ResultadosSummary />;
      break;
  }

  return (
    <div className="panel panel-right stage-inspector" data-testid={`inspector-${stage}`}>
      <div className="panel-title">Inspector</div>
      {body}
    </div>
  );
}
