/** Selector de etapa con un dato de estado por etapa. */
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { STAGES, type StageId } from './stageModel';
import { useUiStore } from './uiStore';
import { summarizeResultDe } from './resultPresentation';

function useStageStatus(): Record<StageId, string> {
  const elements = useWorkspaceStore((s) => s.elements);
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const entrada = useTrayStore((s) => s.entrada);
  const result = useTrayStore((s) => s.result);
  const productos = useTrayStore((s) => s.context?.productos);
  const status = useTrayStore((s) => s.status);
  const engine = useTrayStore((s) => s.engine);

  const own = elements.filter((e) => e.category !== 'infrastructure');
  const linked = new Set(elements.map((e) => e.importedRef?.equipoId).filter(Boolean) as string[]);
  const pending = (catalog?.equipos ?? []).filter((e) => e.estadoAlcance !== 'RETIRADO' && !linked.has(e.equipoId)).length;
  const placed = own.filter((e) => e.placementStatus === 'placed').length;
  const unplaced = own.length - placed + pending;
  const infra = elements.length - own.length;
  const piezas = entrada?.piezas.length ?? 0;
  const cx = catalog?.conexiones.length ?? 0;
  const circ = entrada?.circuitos.length ?? 0;
  const view = summarizeResultDe(result, entrada, productos);
  const resultados = status === 'calculando'
    ? 'calculando…'
    : view
      ? (status === 'vigente' ? view.headline : 'no vigente')
      : `motor ${engine.state}`;

  return {
    equipos: unplaced > 0 ? `${placed} ubicados · ${unplaced} sin ubicar` : `${placed} ubicados`,
    planta: `${infra} elementos`,
    bandejas: `${piezas} piezas`,
    conexiones: `${cx} sin recorrido · ${circ} circuitos`,
    resultados,
  };
}

export function StageBar() {
  const stage = useUiStore((s) => s.stage);
  const setStage = useUiStore((s) => s.setStage);
  const status = useStageStatus();
  return (
    <nav className="stage-bar" role="tablist" aria-label="Etapas de trabajo" data-testid="stage-bar">
      {STAGES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={stage === s.id}
          className={`stage-tab${stage === s.id ? ' is-active' : ''}`}
          data-testid={`stage-tab-${s.id}`}
          onClick={() => setStage(s.id)}
        >
          <span className="stage-tab-n">{s.n}</span>
          <span className="stage-tab-label">{s.label}</span>
          <span className="stage-tab-status" data-testid={`stage-status-${s.id}`}>{status[s.id]}</span>
        </button>
      ))}
    </nav>
  );
}
