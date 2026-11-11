/**
 * Recorrido entre dos bocas del trazado colocado: el operador elige origen y
 * destino; se muestra el camino por las piezas unidas y su longitud en mm.
 *
 * Sin camino → el motivo (nunca un cero). Uniones inválidas → no se atraviesan
 * y se dice cuál y por qué. Longitud incompleta → se dice qué pieza falta.
 * El cálculo está en `recorridos/caminoEntreBocas.ts`.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { caminoEntreBocas, type Boca, type FuenteLongitud } from '../recorridos/caminoEntreBocas';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';
import { Empty, Section } from './shared';

const FUENTE: Record<FuenteLongitud, string> = {
  longitud_mm: 'largo del tramo',
  longitud_eje_mm: 'longitud de eje guardada',
  bocas_en_linea: 'entre bocas en línea',
};

const mm = (x: number) => `${x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} mm`;

const clave = (b: Boca) => `${b.pieza}\u0000${b.boca}`;
const deClave = (k: string): Boca | null => {
  const [pieza, boca] = k.split('\u0000');
  return pieza && boca ? { pieza, boca } : null;
};

export function RecorridoSection() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const piezas = entrada?.piezas ?? [];

  const opciones = useMemo(
    () => piezas.flatMap((p) => Object.keys(p.puertos).map((b) => ({
      k: clave({ pieza: p.instancia_id, boca: b }),
      label: `${pieceLabelById(p.instancia_id, piezas, idx)} · ${portLabel(p.producto_id, b, idx)}`,
    }))),
    [piezas, idx],
  );
  const etiquetaPieza = (id: string) => pieceLabelById(id, piezas, idx);
  const etiquetaBoca = (pieza: string, boca: string) => {
    const p = piezas.find((x) => x.instancia_id === pieza);
    return p ? portLabel(p.producto_id, boca, idx) : boca;
  };

  const o = deClave(origen);
  const d = deClave(destino);
  const r = useMemo(() => (entrada && o && d ? caminoEntreBocas(entrada, o, d) : null), [entrada, origen, destino]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section title="Recorrido entre dos bocas" testid="recorrido">
      {piezas.length === 0 && <Empty>Sin piezas colocadas.</Empty>}
      {piezas.length > 0 && (
        <>
          <label className="stage-field">
            Origen
            <select className="inspector-input" data-testid="recorrido-origen" value={origen} onChange={(e) => setOrigen(e.target.value)}>
              <option value="">Elegí una boca…</option>
              {opciones.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </select>
          </label>
          <label className="stage-field">
            Destino
            <select className="inspector-input" data-testid="recorrido-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Elegí una boca…</option>
              {opciones.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </select>
          </label>
        </>
      )}
      {r && !r.ok && (
        <div className="stage-card tone-warn" role="status" data-testid="recorrido-sin-camino">
          <div><strong>Sin camino:</strong> {r.motivo}.</div>
          {r.unionesCortadas.map((u) => {
            const c = entrada!.conexiones.find((x) => x.conexion_id === u.conexion_id);
            return (
              <div key={u.conexion_id} className="stage-row-sub" style={{ whiteSpace: "normal" }} data-testid="recorrido-union-cortada">
                {c ? `${etiquetaPieza(c.a[0])} · ${etiquetaBoca(c.a[0], c.a[1])} ↔ ${etiquetaPieza(c.b[0])} · ${etiquetaBoca(c.b[0], c.b[1])}` : u.conexion_id}: {u.motivos.join('; ')}
              </div>
            );
          })}
        </div>
      )}
      {r && r.ok && (
        <div className="stage-card" data-testid="recorrido-resultado">
          {r.completa
            ? <div data-testid="recorrido-total"><strong>Longitud total: {mm(r.sumaMm)}</strong> · {r.cruces.length} pieza(s)</div>
            : (
              <div className="tone-warn" data-testid="recorrido-incompleto">
                <strong>Longitud incompleta:</strong> {mm(r.sumaMm)} conocidos; falta la longitud de {r.cruces.filter((c) => c.longitudMm === null).length} pieza(s).
              </div>
            )}
          <ol style={{ margin: "4px 0 0", paddingLeft: 18 }} data-testid="recorrido-piezas">
            {r.cruces.map((c) => (
              <li key={c.pieza} data-testid="recorrido-pieza" className={c.longitudMm === null ? 'tone-warn' : undefined}>
                {etiquetaPieza(c.pieza)} · {etiquetaBoca(c.pieza, c.entrada)} → {etiquetaBoca(c.pieza, c.salida)}
                {' · '}
                {c.longitudMm !== null ? `${mm(c.longitudMm)} (${FUENTE[c.fuente!]})` : `sin longitud: ${c.motivo}`}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}
