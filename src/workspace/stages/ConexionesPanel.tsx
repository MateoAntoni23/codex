/**
 * Etapa 4 — Conexiones.
 *
 * Reubica lo que ya existe: las conexiones del catálogo importado (Excel), todas
 * con estado "sin recorrido" (asignar recorridos es otro hito), y los circuitos
 * del trazado con su edición actual (cable, cantidad, recorrido por piezas).
 * Arriba, el recorrido entre dos bocas del trazado colocado con su longitud.
 */
import { useMemo } from 'react';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { Empty, Section } from './shared';
import { RecorridoSection } from './RecorridoSection';

export function ConexionesPanel() {
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);

  const tagById = useMemo(
    () => new Map((catalog?.equipos ?? []).map((e) => [e.equipoId, e.tag || e.descripcion] as const)),
    [catalog],
  );
  const conexiones = catalog?.conexiones ?? [];

  const editTray = (fn: (inp: NonNullable<typeof entrada>) => void) => {
    if (!entrada) return;
    const next = structuredClone(entrada);
    fn(next);
    trayEdit(next);
    markDirty();
  };

  const end = (equipoId: string | null | undefined, texto: string | null | undefined) =>
    (equipoId && tagById.get(equipoId)) || texto || 'Sin dato';

  return (
    <div className="stage-panel" data-testid="panel-conexiones">
      <RecorridoSection />

      <Section title={`Conexiones del Excel (${conexiones.length})`} testid="catalog-connections">
        {!catalog && <Empty>Sin conexiones: importá el Excel en la etapa Equipos.</Empty>}
        {catalog && conexiones.length === 0 && <Empty>El Excel no trae conexiones.</Empty>}
        {conexiones.map((c) => (
          <div key={c.conexionId} className="stage-card" data-testid="catalog-connection">
            <div className="stage-card-head">
              <strong>{end(c.origenEquipoId, c.origenTextoOriginal)} → {end(c.destinoEquipoId, c.destinoTextoOriginal)}</strong>
              <span className="stage-badge tone-neutral" data-testid="connection-status">sin recorrido</span>
            </div>
            <div className="stage-row-sub">{c.servicio}{c.descripcion ? ` · ${c.descripcion}` : ''}</div>
          </div>
        ))}
      </Section>

      <Section title={`Circuitos del trazado (${entrada?.circuitos.length ?? 0})`} testid="circuits">
        {(entrada?.circuitos.length ?? 0) === 0 && <Empty>Sin circuitos.</Empty>}
        {entrada?.circuitos.map((c, i) => (
          <details key={c.circuito_id} className="stage-card">
            <summary>{c.funcion ? `${c.funcion} · ` : ''}{c.cable_id || 'Cable sin dato'} × {c.cantidad}</summary>
            <label className="stage-field">
              Cable
              <select className="inspector-input" value={c.cable_id}
                onChange={(e) => editTray((inp) => { inp.circuitos[i].cable_id = e.target.value; })}>
                {context?.cables.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label className="stage-field">
              Cantidad
              <input type="number" className="inspector-input" value={c.cantidad}
                onChange={(e) => editTray((inp) => { inp.circuitos[i].cantidad = Number(e.target.value); })} />
            </label>
            <label className="stage-field">
              Recorrido (piezas, separadas por coma)
              <input type="text" className="inspector-input" value={c.recorrido.join(',')}
                onChange={(e) => editTray((inp) => { inp.circuitos[i].recorrido = e.target.value.split(',').map((s) => s.trim()); })} />
            </label>
          </details>
        ))}
      </Section>
    </div>
  );
}
