/**
 * Etapa 5 — Resultados.
 *
 * Estado del servicio de cálculo, Reconectar, Calcular y los resultados del motor.
 *
 * Reserva solicitada: el motor exige `tipo_circuito` y `reserva_solicitada_pct`
 * en la entrada del trazado. Un proyecto nuevo no los trae (el proyecto vacío
 * del hito 1 no los define) y no se inventa un porcentaje: el operador lo carga
 * aquí. `tipo_circuito` se fija en 'potencia', el único valor que admite el motor
 * (D-11). Mientras falte la reserva, Calcular queda deshabilitado con el motivo.
 */
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { TrayResults } from '../TrayResults';
import { summarizeResult } from './resultPresentation';
import { Section } from './shared';

const ENGINE_LABEL: Record<string, string> = {
  desconocido: 'consultando…',
  conectado: 'conectado',
  apagado: 'apagado',
  incompatible: 'incompatible',
};

export function reservaOf(entrada: Record<string, unknown> | null): number | null {
  const v = entrada?.reserva_solicitada_pct;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function ResultSummary() {
  const result = useTrayStore((s) => s.result);
  const status = useTrayStore((s) => s.status);
  const view = summarizeResult(result);
  if (!view) return null;
  return (
    <div className={`stage-result tone-${view.tone}`} data-testid="result-summary">
      <div className="stage-result-headline" data-testid="result-headline" data-tone={view.tone}>
        {view.headline}
      </div>
      {status !== 'vigente' && <p className="stage-note tone-warn">Resultado no vigente: recalcular tras los últimos cambios.</p>}
      {view.peUndefined && (
        <p className="stage-note" data-testid="result-pe-note">
          PE sin definir: el requisito de PE todavía no se cargó en el proyecto. No es un defecto del diseño.
        </p>
      )}
      {view.designIssues.length > 0 && (
        <ul className="stage-issues" data-testid="result-issues">
          {view.designIssues.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ResultadosPanel() {
  const engine = useTrayStore((s) => s.engine);
  const status = useTrayStore((s) => s.status);
  const revision = useTrayStore((s) => s.revision);
  const error = useTrayStore((s) => s.error);
  const entrada = useTrayStore((s) => s.entrada);
  const edit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);

  const reserva = reservaOf(entrada);
  const noPieces = (entrada?.piezas.length ?? 0) === 0;
  const calculating = status === 'calculando';
  const blocked = noPieces || reserva === null;
  const reason = noPieces
    ? 'Calcular requiere al menos una pieza en el trazado.'
    : reserva === null
      ? 'Calcular requiere la reserva solicitada (%).'
      : null;

  const setReserva = (raw: string) => {
    if (!entrada) return;
    const next = structuredClone(entrada) as Record<string, unknown>;
    if (raw.trim() === '') {
      delete next.reserva_solicitada_pct;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return;
      next.reserva_solicitada_pct = n;
      next.tipo_circuito = 'potencia';
    }
    edit(next);
    markDirty();
  };

  return (
    <div className="stage-panel" data-testid="panel-resultados">
      <Section title="Servicio de cálculo">
        <p data-testid="engine-state" data-engine={engine.state} title={engine.detail ?? undefined}>
          Estado: <strong>{ENGINE_LABEL[engine.state] ?? engine.state}</strong>
        </p>
        {engine.detail && engine.state !== 'conectado' && <p className="stage-note">{engine.detail}</p>}
        <button type="button" onClick={() => void useTrayStore.getState().initialize()} data-testid="engine-reconnect">
          Reconectar motor
        </button>
      </Section>

      <Section title="Cálculo">
        <label className="stage-field">
          Reserva solicitada (%)
          <input
            type="number"
            min={0}
            className="inspector-input"
            data-testid="reserva-input"
            placeholder="Sin dato"
            value={reserva ?? ''}
            onChange={(e) => setReserva(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="stage-primary"
          onClick={() => void useTrayStore.getState().calculate()}
          disabled={blocked || calculating}
          data-testid="calculate-tray"
          title={reason ?? undefined}
        >
          {calculating ? 'Calculando…' : 'Calcular trazado'}
        </button>
        {reason && <p className="stage-note" data-testid="calculate-hint">{reason}</p>}
        <p className="stage-note">Estado: {status.split('_').join(' ')} · revisión {revision}</p>
        {error && <p className="workspace-error" role="alert">⚠ {error}</p>}
      </Section>

      <Section title="Resultado">
        <ResultSummary />
        <TrayResults />
      </Section>
    </div>
  );
}
