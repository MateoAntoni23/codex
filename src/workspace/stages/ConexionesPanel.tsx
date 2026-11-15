/**
 * Etapa 4 — Conexiones.
 *
 * Conexiones importadas (2026-11-15): la lista principal son las conexiones del Excel
 * (`conexiones/ListaConexiones.tsx`), con estado, motivo y «Trazar».
 *
 * Reubica lo que ya existe: las conexiones del catálogo importado (Excel), todas
 * con estado "sin recorrido" (asignar recorridos es otro hito), y los circuitos
 * del trazado con su edición actual (cable, cantidad, recorrido por piezas).
 * Interfaz (2026-11-14): a la izquierda sólo lo que existe — enlaces equipo ↔
 * bandeja, circuitos guardados (compactos; la tabla completa está en el panel
 * inferior), conexiones del Excel y circuitos del trazado. Crear un enlace, armar
 * un circuito y medir entre bocas se abren en el inspector.
 */
import { useWorkspaceStore } from '../useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { Empty, Section } from './shared';
import { BajadasSection, mmTexto } from './CircuitoEquipos';
import { circuitosOf, estadoCircuito, faltaParaCalcular } from '../recorridos/circuitosGuardados';
import { useUiStore } from './uiStore';
import { ListaConexiones } from '../../conexiones/ListaConexiones';
import { relacionConExcel } from '../../conexiones/estadoConexion';

export function ConexionesPanel() {
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);

  const editTray = (fn: (inp: NonNullable<typeof entrada>) => void) => {
    if (!entrada) return;
    const next = structuredClone(entrada);
    fn(next);
    trayEdit(next);
    markDirty();
  };

  return (
    <div className="stage-panel" data-testid="panel-conexiones">
      <ListaConexiones />
      <BajadasSection />
      <CircuitosGuardadosLista />

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

/** Circuitos guardados, compactos: nombre, equipos, longitud y estado. La tabla completa, en el panel inferior. */
function CircuitosGuardadosLista() {
  const entrada = useTrayStore((s) => s.entrada);
  const elements = useWorkspaceStore((s) => s.elements);
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const ver = useUiStore((s) => s.verPestana);
  const circuitos = circuitosOf(entrada);
  const nombre = (id: string) => elements.find((e) => e.id === id)?.name ?? id;
  return (
    <Section title={`Circuitos guardados (${circuitos.length})`} testid="circuitos-lista">
      {circuitos.length === 0 && <Empty>Sin circuitos. Armá uno entre dos equipos desde el inspector.</Empty>}
      {circuitos.map((c) => {
        const est = entrada ? estadoCircuito(entrada, elements, c) : { vigente: true as const };
        const falta = faltaParaCalcular(c);
        const rel = relacionConExcel(entrada, catalog, c);
        return (
          <div key={c.id} className="stage-row-inline" data-testid="circuito-lista-fila" data-vigente={est.vigente ? 'true' : 'false'} data-excel={rel.tipo === 'ligado' ? rel.conexionId : 'fuera'}>
            <span>
              <strong>{c.nombre}</strong> · {nombre(c.origen.equipo)} → {nombre(c.destino.equipo)} · {mmTexto(c.sumaMm)}
              {!est.vigente && <span className="tone-warn"> · desactualizado</span>}
              {falta.length > 0 && <span className="tone-warn"> · incompleto</span>}
              {rel.tipo === 'fuera-del-excel' && <span className="stage-row-sub" data-testid="circuito-fuera-excel"> · fuera del Excel</span>}
              {rel.tipo === 'ligado' && <span className="stage-row-sub"> · {rel.conexionId}</span>}
              {rel.tipo === 'ligado' && rel.motivos.map((m) => <span key={m} className="tone-warn" data-testid="circuito-excel-cambio"> · {m}</span>)}
            </span>
          </div>
        );
      })}
      {circuitos.length > 0 && (
        <button type="button" data-testid="ver-circuitos" onClick={() => ver('circuitos')}>Ver la tabla completa ▾</button>
      )}
    </Section>
  );
}

