/**
 * Recorrido entre dos bocas del trazado colocado: el operador elige origen y
 * destino; se muestra el camino por las piezas unidas y su longitud en mm.
 *
 * Sin camino → el motivo (nunca un cero). Uniones inválidas → no se atraviesan
 * y se dice cuál y por qué. Longitud incompleta → se dice qué pieza falta.
 * El cálculo está en `recorridos/caminoEntreBocas.ts`.
 *
 * El recorrido mostrado se puede guardar como circuito con nombre
 * (`recorridos/circuitosGuardados.ts`; la tabla está en Resultados). Para
 * proyectos guardados antes de que las piezas guardaran su longitud de eje hay
 * una acción explícita (`recorridos/longitudesAnteriores.ts`).
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { caminoEntreBocas, type Boca, type FuenteLongitud } from '../recorridos/caminoEntreBocas';
import { guardarCircuito } from '../recorridos/circuitosGuardados';
import { guardarLongitudesAnteriores, necesitaLongitudes } from '../recorridos/longitudesAnteriores';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';
import { Empty, Section } from './shared';

const FUENTE: Record<FuenteLongitud, string> = {
  longitud_mm: 'largo del tramo',
  longitud_eje_mm: 'longitud de eje guardada',
  longitudes_eje: 'regla guardada al colocar',
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
  const [nombre, setNombre] = useState('');
  const [msgGuardar, setMsgGuardar] = useState<{ ok: boolean; texto: string } | null>(null);
  const [msgLongitudes, setMsgLongitudes] = useState<{ actualizadas: string[]; noPudo: Array<{ pieza: string; motivo: string }> } | null>(null);
  const trayEdit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const piezas = entrada?.piezas ?? [];
  const sinLongitud = piezas.filter(necesitaLongitudes).length;

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

  // Una elección que ya no está en el trazado (se abrió otro proyecto, se borró
  // la pieza) cuenta como "sin elegir": no es un recorrido sin camino.
  const validas = new Set(opciones.map((x) => x.k));
  const origenSel = validas.has(origen) ? origen : '';
  const destinoSel = validas.has(destino) ? destino : '';
  const o = deClave(origenSel);
  const d = deClave(destinoSel);
  const r = useMemo(() => (entrada && o && d ? caminoEntreBocas(entrada, o, d) : null), [entrada, origenSel, destinoSel]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = () => {
    if (!entrada || !o || !d) return;
    const g = guardarCircuito(entrada, nombre, o, d);
    if (!g.ok) { setMsgGuardar({ ok: false, texto: g.motivo }); return; }
    trayEdit(g.entrada);
    markDirty();
    setNombre('');
    setMsgGuardar({ ok: true, texto: `Circuito "${g.circuito.nombre}" guardado. Está en Resultados.` });
  };

  const guardarLongitudes = () => {
    if (!entrada) return;
    const res = guardarLongitudesAnteriores(entrada);
    if (res.actualizadas.length) { trayEdit(res.entrada); markDirty(); }
    setMsgLongitudes({ actualizadas: res.actualizadas, noPudo: res.noPudo });
  };

  return (
    <Section title="Recorrido entre dos bocas" testid="recorrido">
      {piezas.length === 0 && <Empty>Sin piezas colocadas.</Empty>}
      {(sinLongitud > 0 || msgLongitudes) && (
        <div className="stage-card" data-testid="longitudes-anteriores">
          {sinLongitud > 0 && (
            <>
              <div className="tone-warn">{sinLongitud} pieza(s) sin longitud de eje guardada (proyecto anterior a la regla).</div>
              <button type="button" data-testid="longitudes-anteriores-aplicar" onClick={guardarLongitudes}>
                Guardar longitudes con las reglas vigentes
              </button>
            </>
          )}
          {msgLongitudes && (
            <div role="status" data-testid="longitudes-anteriores-resultado">
              <div>{msgLongitudes.actualizadas.length} pieza(s) actualizada(s){msgLongitudes.actualizadas.length ? `: ${msgLongitudes.actualizadas.map(etiquetaPieza).join(', ')}` : ''}.</div>
              {msgLongitudes.noPudo.length > 0 && <div className="tone-warn">No se pudo en {msgLongitudes.noPudo.length}:</div>}
              {msgLongitudes.noPudo.map((x) => (
                <div key={x.pieza} className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="longitudes-anteriores-no-pudo">
                  {etiquetaPieza(x.pieza)}: {x.motivo}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {piezas.length > 0 && (
        <>
          <label className="stage-field">
            Origen
            <select className="inspector-input" data-testid="recorrido-origen" value={origenSel} onChange={(e) => setOrigen(e.target.value)}>
              <option value="">Elegí una boca…</option>
              {opciones.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </select>
          </label>
          <label className="stage-field">
            Destino
            <select className="inspector-input" data-testid="recorrido-destino" value={destinoSel} onChange={(e) => setDestino(e.target.value)}>
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
                {c.procedencia && <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="recorrido-procedencia">{c.procedencia}</div>}
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              type="text"
              className="inspector-input"
              placeholder="Nombre del circuito"
              aria-label="Nombre del circuito"
              data-testid="recorrido-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" data-testid="recorrido-guardar" onClick={guardar}>Guardar como circuito</button>
          </div>
        </div>
      )}
      {msgGuardar && (
        <p className={`stage-note${msgGuardar.ok ? '' : ' tone-warn'}`} role="status" data-testid="recorrido-guardado-msg">{msgGuardar.texto}</p>
      )}
    </Section>
  );
}
