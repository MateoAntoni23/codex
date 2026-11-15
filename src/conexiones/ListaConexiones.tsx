/**
 * Etapa Conexiones — la lista de trabajo: las conexiones del Excel, agrupadas por
 * servicio, con filtro y buscador. Cada una dice su estado y el motivo; «Trazar» crea
 * el circuito ligado (el camino de circuitos que ya existe). Un extremo que el Excel no
 * resuelve se empareja a mano: queda marcado como del operador, aparte de lo importado.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { Empty, Section } from '../workspace/stages/shared';
import type { ServicioConexion } from '../import/types';
import { emparejar, type RolExtremo } from './declarado';
import { estadosDeConexiones, ORDEN_SERVICIOS, TEXTO_ESTADO, type CodigoEstado, type EstadoConexion, type Extremo } from './estadoConexion';
import { retrazarConexion, trazarConexion } from './acciones';
import { TendidosConexion } from './TendidosConexion';
import { contrasteDeCircuito } from './contraste';

const TONO: Readonly<Record<CodigoEstado, string>> = {
  'no-se-traza': 'tone-neutral',
  'sin-resolver': 'tone-warn',
  'sin-ubicar': 'tone-warn',
  'sin-enlace': 'tone-warn',
  'sin-trazar': 'tone-neutral',
  trazada: 'tone-ok',
  desactualizada: 'tone-warn',
};

export function ListaConexiones() {
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const elements = useWorkspaceStore((s) => s.elements);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const entrada = useTrayStore((s) => s.entrada);
  const trayEdit = useTrayStore((s) => s.edit);
  const [busca, setBusca] = useState('');
  const [servicio, setServicio] = useState<ServicioConexion | ''>('');
  const [estado, setEstado] = useState<CodigoEstado | ''>('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const estados = useMemo(() => estadosDeConexiones(catalog, entrada, elements), [catalog, entrada, elements]);
  const equipos = useMemo(() => elements.filter((e) => e.category !== 'infrastructure' && e.placementStatus === 'placed'), [elements]);

  const q = busca.trim().toLowerCase();
  const nombreExtremo = (x: Extremo) => (x.fuente === 'ninguna' ? '' : x.elemento?.name ?? '');
  const visibles = estados.filter((e) => {
    if (servicio && e.conexion.servicio !== servicio) return false;
    if (estado && e.codigo !== estado) return false;
    if (!q) return true;
    const c = e.conexion;
    return [c.conexionId, c.circuitoTag, c.descripcion, c.origenTextoOriginal, c.destinoTextoOriginal, c.origenEquipoId, c.destinoEquipoId, nombreExtremo(e.origen), nombreExtremo(e.destino)]
      .some((t) => t && t.toLowerCase().includes(q));
  });
  const grupos = ORDEN_SERVICIOS.map((s) => ({ servicio: s, filas: visibles.filter((e) => e.conexion.servicio === s) })).filter((g) => g.filas.length);
  const cuenta = (c: CodigoEstado) => estados.filter((e) => e.codigo === c).length;

  const aplicar = (r: { ok: true; entrada: NonNullable<typeof entrada> } | { ok: false; motivo: string }, ok: string, error: string) => {
    if (!r.ok) { setMsg({ ok: false, texto: `${error}: ${r.motivo}.` }); return; }
    trayEdit(r.entrada);
    markDirty();
    setMsg({ ok: true, texto: ok });
  };
  const trazar = (e: EstadoConexion) => {
    if (!entrada) return;
    const r = trazarConexion(entrada, elements, e);
    aplicar(r, r.ok ? `Circuito ${r.circuitoId} trazado para ${e.conexion.conexionId}. Está en Resultados › Circuitos.` : '', `No se pudo trazar ${e.conexion.conexionId}`);
  };
  const retrazar = (e: EstadoConexion) => {
    if (!entrada) return;
    aplicar(retrazarConexion(entrada, elements, e), `Circuito de ${e.conexion.conexionId} retrazado con el proyecto y el Excel de ahora.`, `No se pudo retrazar ${e.conexion.conexionId}`);
  };
  const setEmparejado = (e: EstadoConexion, rol: RolExtremo, equipo: string) => {
    if (!entrada) return;
    trayEdit(emparejar(entrada, e.conexion.conexionId, rol, equipo || null));
    markDirty();
  };

  const extremo = (e: EstadoConexion, rol: RolExtremo) => {
    const x = rol === 'origen' ? e.origen : e.destino;
    return (
      <span data-testid={`conexion-${rol}`} data-fuente={x.fuente}>
        {x.fuente === 'excel' && (
          <>
            {x.elemento?.name ?? x.texto} <span className="stage-row-sub">({x.equipoId}, Excel)</span>
          </>
        )}
        {x.fuente !== 'excel' && (
          <>
            <span title="Texto original del Excel">«{x.texto || 'sin texto'}»</span>{' '}
            {x.fuente === 'operador' && (
              <span className="stage-row-sub" data-testid={`conexion-${rol}-manual`}>
                → {x.elemento?.name ?? x.elementoId} (emparejado a mano por el operador, no es dato del Excel)
              </span>
            )}
            <select className="inspector-input" style={{ marginLeft: 4, maxWidth: 180 }} data-testid={`conexion-emparejar-${rol}`}
              value={x.fuente === 'operador' ? x.elementoId : ''} onChange={(ev) => setEmparejado(e, rol, ev.target.value)}>
              <option value="">{x.fuente === 'operador' ? '— quitar el emparejado —' : '— emparejar a mano —'}</option>
              {equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </select>
          </>
        )}
      </span>
    );
  };

  return (
    <Section title={`Conexiones del Excel (${estados.length})`} testid="catalog-connections">
      {!catalog && <Empty>Sin conexiones: importá el Excel en la etapa Equipos.</Empty>}
      {catalog && estados.length === 0 && <Empty>El Excel no trae conexiones.</Empty>}
      {estados.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            <input type="search" className="inspector-input" placeholder="Buscar (tag, equipo, texto…)" value={busca}
              onChange={(e) => setBusca(e.target.value)} data-testid="conexiones-buscar" style={{ flex: 1, minWidth: 140 }} />
            <select className="inspector-input" value={servicio} onChange={(e) => setServicio(e.target.value as ServicioConexion | '')} data-testid="conexiones-filtro-servicio">
              <option value="">Todos los servicios</option>
              {ORDEN_SERVICIOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="inspector-input" value={estado} onChange={(e) => setEstado(e.target.value as CodigoEstado | '')} data-testid="conexiones-filtro-estado">
              <option value="">Todos los estados</option>
              {(Object.keys(TEXTO_ESTADO) as CodigoEstado[]).map((c) => <option key={c} value={c}>{TEXTO_ESTADO[c]} ({cuenta(c)})</option>)}
            </select>
          </div>
          {visibles.length === 0 && <Empty>Ninguna conexión coincide con el filtro.</Empty>}
          {grupos.map((g) => (
            <details key={g.servicio} className="grupo-piezas" open data-testid={`conexiones-grupo-${g.servicio}`}>
              <summary>{g.servicio} ({g.filas.length})</summary>
              {g.filas.map((e) => (
                <div key={e.conexion.conexionId} className="stage-card" data-testid="conexion-fila" data-conexion={e.conexion.conexionId} data-estado={e.codigo} data-trazable={e.trazable ? 'true' : 'false'}>
                  <div className="stage-card-head">
                    <strong>{e.conexion.circuitoTag || e.conexion.conexionId}</strong>
                    <span className="stage-row-sub">{e.conexion.conexionId}</span>
                    <span className={`stage-badge ${TONO[e.codigo]}`} data-testid="conexion-estado">{TEXTO_ESTADO[e.codigo]}</span>
                  </div>
                  <div style={{ whiteSpace: 'normal' }}>{extremo(e, 'origen')} → {extremo(e, 'destino')}</div>
                  {e.conexion.descripcion && <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>{e.conexion.descripcion}</div>}
                  {e.motivos.map((m) => <div key={m} className={`stage-note ${e.codigo === 'no-se-traza' ? '' : 'tone-warn'}`} style={{ whiteSpace: 'normal' }} data-testid="conexion-motivo">{m}</div>)}
                  {e.circuito && entrada && contrasteDeCircuito(entrada, elements, catalog, e.circuito).filter((f) => f.estado === 'aviso').map((f) => (
                    <div key={`${f.tipo}|${f.tendidoId ?? ''}`} className="stage-note tone-warn" style={{ whiteSpace: 'normal' }} data-testid="conexion-contraste" data-tipo={f.tipo}>
                      {f.texto} <span className="stage-row-sub">({f.ingenieria.origen})</span>
                    </div>
                  ))}
                  {e.codigo !== 'no-se-traza' && <TendidosConexion conexion={e.conexion} tendidos={e.tendidos} />}
                  {e.circuito && <div className="stage-row-sub" data-testid="conexion-circuito">Circuito {e.circuito.nombre} ({e.circuito.id})</div>}
                  <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                    {e.trazable && <button type="button" className="stage-primary" data-testid="conexion-trazar" onClick={() => trazar(e)}>Trazar</button>}
                    {e.codigo === 'desactualizada' && <button type="button" data-testid="conexion-retrazar" onClick={() => retrazar(e)}>Retrazar</button>}
                  </div>
                </div>
              ))}
            </details>
          ))}
        </>
      )}
      {msg && <p className={`stage-note ${msg.ok ? '' : 'tone-warn'}`} role="status" data-testid="conexiones-msg" style={{ whiteSpace: 'normal' }}>{msg.texto}</p>}
    </Section>
  );
}
