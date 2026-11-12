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
import { CircuitosTabla } from './CircuitosTabla';
import { unionsOf } from '../workspaceOperation';
import { indexProducts, pieceLabelById } from './displayNames';
import { placedOf } from '../placement/definitions';
import { avisosDeModelo } from '../placement/joins';

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

/** Decisión 2 (B-2): piezas colocadas con geometría nominal del catálogo. */
function NominalList() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const idx = indexProducts(context?.productos);
  const piezas = (entrada?.piezas ?? []).filter((p) => placedOf(entrada, p)?.def.procedencia?.tipo === 'nominal');
  if (!piezas.length) return null;
  return (
    <Section title={`Geometría nominal del catálogo (${piezas.length})`} testid="nominal-list">
      <p className="stage-note">Sin modelo medido: la geometría sale de las dimensiones que declara el catálogo.</p>
      {piezas.map((p) => (
        <div key={p.instancia_id} className="stage-card" data-testid="nominal-row">
          <div className="tone-warn">{pieceLabelById(p.instancia_id, entrada!.piezas, idx)}</div>
          <div className="stage-row-sub">{placedOf(entrada, p)!.def.procedencia!.nota}</div>
        </div>
      ))}
    </Section>
  );
}

/**
 * B-3: avisos de modelo — bocas cuya ala medida difiere de la que declara el
 * catálogo (caso CUPS). No invalidan las uniones; se informan.
 */
function AvisosModeloList() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const idx = indexProducts(context?.productos);
  const filas = (entrada?.piezas ?? []).map((p) => ({ p, avisos: avisosDeModelo(entrada, p) })).filter((f) => f.avisos.length);
  if (!filas.length) return null;
  return (
    <Section title={`Avisos de modelo (${filas.length})`} testid="aviso-modelo-list">
      <p className="stage-note">La geometría viene del modelo medido y difiere de lo que declara el catálogo. Las uniones no se invalidan por esto.</p>
      {filas.map(({ p, avisos }) => (
        <div key={p.instancia_id} className="stage-card" data-testid="aviso-modelo-row">
          <div className="tone-warn">{pieceLabelById(p.instancia_id, entrada!.piezas, idx)}</div>
          {avisos.map((a) => <div key={a} className="stage-row-sub">{a}</div>)}
        </div>
      ))}
    </Section>
  );
}

/** A-9: uniones aceptadas como excepción, con su motivo. */
function ExceptionsList() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const idx = indexProducts(context?.productos);
  const exc = ((entrada as Record<string, unknown> | null)?.excepciones_conexion ?? {}) as Record<string, { motivo?: string; producto_id?: string }>;
  const unions = unionsOf(entrada);
  const ids = new Set([...Object.keys(exc), ...Object.entries(unions).filter(([, u]) => u.estado === 'excepcion').map(([id]) => id)]);
  const rows = [...ids].filter((id) => entrada?.conexiones.some((c) => c.conexion_id === id));
  return (
    <Section title={`Uniones por excepción (${rows.length})`} testid="exceptions-list">
      {rows.length === 0 && <p className="stage-note">Ninguna: todas las uniones están documentadas en el catálogo.</p>}
      {rows.map((id) => {
        const c = entrada!.conexiones.find((x) => x.conexion_id === id)!;
        const motivo = unions[id]?.motivo ?? exc[id]?.motivo ?? 'Sin dato';
        return (
          <div key={id} className="stage-card" data-testid="exception-row">
            <div className="tone-warn">{pieceLabelById(c.a[0], entrada!.piezas, idx)} ↔ {pieceLabelById(c.b[0], entrada!.piezas, idx)}</div>
            <div className="stage-row-sub">Motivo: {motivo}</div>
          </div>
        );
      })}
    </Section>
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

      <ExceptionsList />
      <CircuitosTabla />
      <NominalList />
      <AvisosModeloList />

      <Section title="Resultado">
        <ResultSummary />
        <TrayResults />
      </Section>
    </div>
  );
}
