/**
 * Conexiones — etapa 1: los equipos como extremos del circuito (2026-11-13).
 *
 *   - `BajadasSection`: el enlace de cada equipo con la bandeja. El operador elige
 *     el equipo y el punto de salida sobre un tramo (tramo, distancia desde una
 *     boca, lado: los mismos campos que la derivación en un tramo). Lista los
 *     enlaces con su largo y su estado; uno desactualizado lo dice con el motivo.
 *   - `CircuitoEquiposSection`: origen y destino se eligen entre los equipos. Se
 *     muestra el recorrido (bajada → bandeja → bajada) con la longitud total
 *     desglosada, y se guarda como circuito con nombre (la tabla está en
 *     Resultados).
 *
 * La lógica está en `equipos/bajada.ts` y `recorridos/circuitosGuardados.ts`.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import type { Product } from '../../tray/model';
import { bajadasOf, borrarBajada, crearBajada, estadoBajada, PROCEDENCIA_BAJADA, PROCEDENCIA_PUNTO_EQUIPO } from '../equipos/bajada';
import { caminoEntreEquipos, guardarCircuito } from '../recorridos/circuitosGuardados';
import type { FuenteLongitud } from '../recorridos/caminoEntreBocas';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';
import { Empty, Section } from './shared';
import { PuntoEnTramoCampos, type ValorPuntoEnTramo } from './PuntoEnTramoCampos';
import { CABLE_VACIO, CableCircuitoCampos, cableDesdeValor, useCatalogoCables, type ValorCable } from './CableCircuitoCampos';

export const mmTexto = (x: number) => `${x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} mm`;

export const FUENTE_LONGITUD: Record<FuenteLongitud, string> = {
  longitud_mm: 'largo del tramo',
  longitud_eje_mm: 'longitud de eje guardada',
  longitudes_eje: 'regla guardada al colocar',
  bocas_en_linea: 'entre bocas en línea',
  enganche: 'hasta el enganche, guardada',
  bajada: 'hasta el punto de salida, guardada',
};

/** Equipos que pueden ser extremo de un circuito (no la infraestructura: piso, paredes). */
function useEquipos() {
  const elements = useWorkspaceStore((s) => s.elements);
  return useMemo(() => elements.filter((e) => e.category !== 'infrastructure'), [elements]);
}

const VACIO: ValorPuntoEnTramo = { tronco: '', desde: 'P1', distancia: '', lado: 'izquierda' };

export function BajadasSection() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const elements = useWorkspaceStore((s) => s.elements);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const equipos = useEquipos();
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const piezas = entrada?.piezas ?? [];
  const bajadas = bajadasOf(entrada);

  // Por defecto, el equipo seleccionado en la escena.
  const [equipoElegido, setEquipo] = useState<string | null>(null);
  const equipo = equipoElegido ?? (selectedEquipId && equipos.some((e) => e.id === selectedEquipId) ? selectedEquipId : '');
  const [punto, setPunto] = useState<ValorPuntoEnTramo>(VACIO);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const nombreEquipo = (id: string) => elements.find((e) => e.id === id)?.name ?? id;
  const etiquetaPieza = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  const etiquetaBoca = (pieza: string, boca: string) => {
    const p = piezas.find((x) => x.instancia_id === pieza);
    return p ? portLabel(p.producto_id, boca, idx) : boca;
  };

  const crear = () => {
    if (!entrada) return;
    const r = crearBajada(entrada, productos, elements, {
      equipo, tronco: punto.tronco, desde_boca: punto.desde, distancia_mm: Number(punto.distancia), lado: punto.lado,
    });
    if (!r.ok) { setMsg({ ok: false, texto: r.motivo }); return; }
    trayEdit(r.entrada);
    markDirty();
    setMsg({ ok: true, texto: `Enlace ${r.bajada.id} creado: ${nombreEquipo(r.bajada.equipo)} baja ${mmTexto(r.bajada.longitud_mm)} desde ${etiquetaPieza(r.bajada.tronco)}.` });
    setEquipo(null);
    setPunto(VACIO);
  };
  const borrar = (id: string) => {
    if (!entrada) return;
    trayEdit(borrarBajada(entrada, id));
    markDirty();
  };

  return (
    <Section title={`Equipos enlazados con la bandeja (${bajadas.length})`} testid="bajadas">
      {equipos.length === 0 && <Empty>Sin equipos: crealos o importalos en la etapa Equipos.</Empty>}
      {equipos.length > 0 && (
        <div className="stage-card" data-testid="baj-form">
          <label className="stage-field">
            Equipo
            <select className="inspector-input" data-testid="baj-equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
              <option value="">Elegí un equipo…</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.name}{e.tag ? ` (${e.tag})` : ''}</option>)}
            </select>
          </label>
          <PuntoEnTramoCampos prefijo="baj" etiquetaTramo="Tramo desde donde baja el cable" valor={punto} onChange={setPunto} />
          <p className="stage-note" style={{ whiteSpace: 'normal' }}>
            La bajada es un tramo recto desde el punto de salida hasta el centro del equipo. Es cable al aire o por caño, no bandeja: cuenta en la longitud del circuito y no computa ninguna pieza.
          </p>
          <button type="button" className="stage-primary" data-testid="baj-crear" onClick={crear} disabled={!equipo || !punto.tronco || punto.distancia === ''}>
            Crear enlace
          </button>
          {msg && <p className={`stage-note${msg.ok ? '' : ' tone-warn'}`} role="status" data-testid="baj-msg">{msg.texto}</p>}
        </div>
      )}
      {bajadas.map((b) => {
        const est = entrada ? estadoBajada(entrada, elements, b) : { vigente: true as const };
        return (
          <div key={b.id} className="stage-card" data-testid="bajada-row" data-bajada={b.id} data-equipo={b.equipo} data-vigente={est.vigente ? 'true' : 'false'} data-longitud={b.longitud_mm}>
            <div>
              <strong>{b.id}</strong> · {nombreEquipo(b.equipo)} · bajada {mmTexto(b.longitud_mm)}
            </div>
            <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>
              Sale de {etiquetaPieza(b.tronco)} a {b.distancia_mm} mm de {etiquetaBoca(b.tronco, b.desde_boca)}, lado {b.lado}.
            </div>
            {!est.vigente && (
              <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="bajada-estado">Desactualizado: {est.motivos.join('; ')}.</div>
            )}
            <button type="button" data-testid="bajada-borrar" onClick={() => borrar(b.id)}>Borrar enlace</button>
          </div>
        );
      })}
      {bajadas.length > 0 && (
        <p className="stage-note" style={{ whiteSpace: 'normal' }} data-testid="bajada-procedencia">
          {PROCEDENCIA_BAJADA}. {PROCEDENCIA_PUNTO_EQUIPO}.
        </p>
      )}
    </Section>
  );
}

export function CircuitoEquiposSection() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const elements = useWorkspaceStore((s) => s.elements);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const equipos = useEquipos();
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const piezas = entrada?.piezas ?? [];
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [nombre, setNombre] = useState('');
  const [cable, setCable] = useState<ValorCable>(CABLE_VACIO);
  const { cables } = useCatalogoCables();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  // Una elección que ya no está (se abrió otro proyecto, se borró el equipo) cuenta como "sin elegir".
  const validos = new Set(equipos.map((e) => e.id));
  const o = validos.has(origen) ? origen : '';
  const d = validos.has(destino) ? destino : '';
  const r = useMemo(
    () => (entrada && o && d ? caminoEntreEquipos(entrada, elements, { equipo: o }, { equipo: d }) : null),
    [entrada, elements, o, d],
  );
  const etiquetaPieza = (id: string) => pieceLabelById(id, piezas, idx);
  const etiquetaBoca = (pieza: string, boca: string) => {
    if (boca.startsWith('bajada:')) return `punto de salida ${boca.slice('bajada:'.length)}`;
    const p = piezas.find((x) => x.instancia_id === pieza);
    return p ? portLabel(p.producto_id, boca, idx) : boca;
  };

  const guardar = () => {
    if (!entrada || !o || !d) return;
    const k = cableDesdeValor(cable);
    if (!k.ok) { setMsg({ ok: false, texto: k.motivo }); return; }
    const g = guardarCircuito(entrada, elements, nombre, { equipo: o }, { equipo: d }, k.cable ?? undefined, cables.map((x) => x.cable_id));
    if (!g.ok) { setMsg({ ok: false, texto: g.motivo }); return; }
    trayEdit(g.entrada);
    markDirty();
    setNombre('');
    setCable(CABLE_VACIO);
    setMsg({
      ok: true,
      texto: `Circuito "${g.circuito.nombre}" guardado. Está en Resultados.${g.circuito.cable ? '' : ' Sin cable: queda incompleto hasta elegirlo.'}`,
    });
  };

  return (
    <Section title="Circuito entre dos equipos" testid="circuito-equipos">
      {equipos.length < 2 && <Empty>Hacen falta al menos dos equipos.</Empty>}
      {equipos.length >= 2 && (
        <>
          <label className="stage-field">
            Origen
            <select className="inspector-input" data-testid="circuito-origen" value={o} onChange={(e) => setOrigen(e.target.value)}>
              <option value="">Elegí un equipo…</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="stage-field">
            Destino
            <select className="inspector-input" data-testid="circuito-destino" value={d} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Elegí un equipo…</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        </>
      )}
      {r && !r.ok && (
        <div className="stage-card tone-warn" role="status" data-testid="circuito-sin-camino">
          <div><strong>Sin camino:</strong> {r.motivo}.</div>
          {r.unionesCortadas.map((u) => {
            const c = entrada!.conexiones.find((x) => x.conexion_id === u.conexion_id);
            return (
              <div key={u.conexion_id} className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="circuito-union-cortada">
                {c ? `${etiquetaPieza(c.a[0])} · ${etiquetaBoca(c.a[0], c.a[1])} ↔ ${etiquetaPieza(c.b[0])} · ${etiquetaBoca(c.b[0], c.b[1])}` : u.conexion_id}: {u.motivos.join('; ')}
              </div>
            );
          })}
        </div>
      )}
      {r && r.ok && (
        <div className="stage-card" data-testid="circuito-resultado" data-total={r.sumaMm} data-bandeja={r.bandejaMm} data-bajadas={r.bajadasMm}>
          {r.completa
            ? <div data-testid="circuito-total"><strong>Longitud total: {mmTexto(r.sumaMm)}</strong></div>
            : (
              <div className="tone-warn" data-testid="circuito-incompleto">
                <strong>Longitud incompleta:</strong> {mmTexto(r.sumaMm)} conocidos; falta la longitud de {r.cruces.filter((c) => c.longitudMm === null).length} pieza(s).
              </div>
            )}
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="circuito-desglose">
            <li data-testid="circuito-desglose-bandeja">Por bandeja: {mmTexto(r.bandejaMm)} ({r.cruces.length} pieza(s))</li>
            <li data-testid="circuito-desglose-bajadas">
              Bajadas: {mmTexto(r.bajadasMm)} — origen {mmTexto(r.bajadaOrigen.longitud_mm)} ({r.bajadaOrigen.id}), destino {mmTexto(r.bajadaDestino.longitud_mm)} ({r.bajadaDestino.id})
            </li>
          </ul>
          <ol style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="circuito-piezas">
            {r.cruces.map((c) => (
              <li key={c.pieza} data-testid="circuito-pieza" className={c.longitudMm === null ? 'tone-warn' : undefined}>
                {etiquetaPieza(c.pieza)} · {etiquetaBoca(c.pieza, c.entrada)} → {etiquetaBoca(c.pieza, c.salida)}
                {' · '}
                {c.longitudMm !== null ? `${mmTexto(c.longitudMm)} (${FUENTE_LONGITUD[c.fuente!]})` : `sin longitud: ${c.motivo}`}
              </li>
            ))}
          </ol>
          <details className="stage-card" style={{ marginTop: 6 }} open data-testid="circuito-cable">
            <summary>Cable del circuito (se puede elegir después; sin cable queda incompleto)</summary>
            <CableCircuitoCampos prefijo="circuito" valor={cable} onChange={setCable} />
          </details>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              type="text"
              className="inspector-input"
              placeholder="Nombre del circuito"
              aria-label="Nombre del circuito"
              data-testid="circuito-nombre-input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" data-testid="circuito-guardar" onClick={guardar}>Guardar como circuito</button>
          </div>
        </div>
      )}
      {msg && <p className={`stage-note${msg.ok ? '' : ' tone-warn'}`} role="status" data-testid="circuito-guardado-msg">{msg.texto}</p>}
    </Section>
  );
}
