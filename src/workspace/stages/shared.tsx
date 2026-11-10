/**
 * Piezas comunes de la interfaz por etapas: sección, barra de herramientas,
 * resumen del inspector y sincronización lista ↔ selección (3a).
 */
import { useEffect, type ReactNode } from 'react';

export function Section({ title, children, testid }: { title: string; children: ReactNode; testid?: string }) {
  return (
    <section className="stage-section" data-testid={testid}>
      <h4 className="stage-section-title">{title}</h4>
      {children}
    </section>
  );
}

export interface ToolDef<T extends string> {
  id: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

export function ToolBar<T extends string>({
  tools, active, onPick, stage,
}: {
  tools: ToolDef<T>[];
  active: T | null;
  onPick: (t: T) => void;
  stage: string;
}) {
  return (
    <div className="stage-tools" role="toolbar" aria-label="Herramientas" data-testid={`tools-${stage}`}>
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`stage-tool${active === t.id ? ' is-active' : ''}`}
          aria-pressed={active === t.id}
          data-testid={`tool-${stage}-${t.id}`}
          title={t.title}
          disabled={t.disabled}
          onClick={() => onPick(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Inspector sin selección: resumen de la etapa y siguiente paso sugerido. */
export function StageSummary({
  title, rows, next, children,
}: {
  title: string;
  rows: Array<[string, ReactNode]>;
  next: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="stage-summary" data-testid="stage-summary">
      <h3 className="stage-summary-title">{title}</h3>
      <dl className="stage-summary-rows">
        {rows.map(([k, v]) => (
          <div key={k} className="stage-summary-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {next && (
        <p className="stage-next" data-testid="stage-next">
          <strong>Siguiente paso:</strong> {next}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * Lleva a la vista la fila seleccionada de una lista: tras abrir su grupo, la
 * desplaza dentro del panel. Se ejecuta cuando cambia la clave seleccionada.
 */
export function useRevealSelected(container: HTMLElement | null, selectedKey: string | null) {
  useEffect(() => {
    if (!container || !selectedKey) return;
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(selectedKey)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [container, selectedKey]);
}

export function Empty({ children, testid }: { children: ReactNode; testid?: string }) {
  return <p className="workspace-empty" data-testid={testid}>{children}</p>;
}
