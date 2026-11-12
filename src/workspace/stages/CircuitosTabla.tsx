/**
 * Resultados — tabla de circuitos guardados: una fila por circuito con nombre,
 * origen, destino, longitud (mm) y cantidad de piezas, más su estado. Un
 * circuito desactualizado (pieza movida, rotada o borrada, longitud cambiada,
 * unión rota) lo dice con el motivo y conserva lo guardado: recalcular es un
 * botón, no algo que pase solo.
 *
 * "Copiar tabla" copia texto separado por tabulaciones (se pega directo en una
 * planilla), con coma decimal y sin separador de miles.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { borrarCircuito, circuitosOf, estadoCircuito, recalcularCircuito, type CircuitoGuardado } from '../recorridos/circuitosGuardados';
import type { Boca } from '../recorridos/caminoEntreBocas';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';
import { Empty, Section } from './shared';

const num = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1, useGrouping: false });
const mmPantalla = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function CircuitosTabla() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const [msg, setMsg] = useState<string | null>(null);
  const piezas = entrada?.piezas ?? [];
  const circuitos = circuitosOf(entrada);

  const etiquetaPieza = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  const etiquetaBoca = (b: Boca) => {
    const p = piezas.find((x) => x.instancia_id === b.pieza);
    return p ? `${etiquetaPieza(b.pieza)} · ${portLabel(p.producto_id, b.boca, idx)}` : `${b.pieza} · ${b.boca}`;
  };

  const filas = circuitos.map((c) => ({ c, estado: entrada ? estadoCircuito(entrada, c, etiquetaPieza) : { vigente: true as const } }));

  const longitudTexto = (c: CircuitoGuardado, pantalla: boolean) =>
    c.completa ? (pantalla ? mmPantalla(c.sumaMm) : num(c.sumaMm)) : `incompleta (≥ ${pantalla ? mmPantalla(c.sumaMm) : num(c.sumaMm)})`;

  const tsv = () => [
    ['Nombre', 'Origen', 'Destino', 'Longitud (mm)', 'Piezas', 'Estado'].join('\t'),
    ...filas.map(({ c, estado }) => [
      c.nombre, etiquetaBoca(c.origen), etiquetaBoca(c.destino), longitudTexto(c, false), String(c.cruces.length),
      estado.vigente ? 'vigente' : `desactualizado: ${estado.motivos.join('; ')}`,
    ].join('\t')),
  ].join('\r\n'); // CRLF: lo que espera una planilla en Windows (el portapapeles de Windows lo convierte igual)

  const copiar = async () => {
    const texto = tsv();
    try {
      await navigator.clipboard.writeText(texto);
      setMsg(`Tabla copiada (${filas.length} circuito(s)). Pegala en la planilla.`);
    } catch {
      setMsg('No se pudo copiar al portapapeles: el navegador no lo permitió.');
    }
  };

  const recalcular = (id: string) => {
    if (!entrada) return;
    const r = recalcularCircuito(entrada, id);
    if (!r.ok) { setMsg(`No se pudo recalcular: ${r.motivo}.`); return; }
    trayEdit(r.entrada);
    markDirty();
    setMsg('Circuito recalculado con el trazado actual.');
  };
  const borrar = (id: string) => {
    if (!entrada) return;
    trayEdit(borrarCircuito(entrada, id));
    markDirty();
  };

  return (
    <Section title={`Circuitos (${circuitos.length})`} testid="circuitos-tabla">
      {circuitos.length === 0 && <Empty>Sin circuitos guardados: guardalos desde el recorrido en Conexiones.</Empty>}
      {circuitos.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="stage-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Nombre</th>
                  <th style={{ textAlign: 'left' }}>Origen</th>
                  <th style={{ textAlign: 'left' }}>Destino</th>
                  <th style={{ textAlign: 'right' }}>Longitud (mm)</th>
                  <th style={{ textAlign: 'right' }}>Piezas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ c, estado }) => (
                  <tr key={c.id} data-testid="circuito-fila" data-vigente={estado.vigente ? 'true' : 'false'}>
                    <td>
                      <strong data-testid="circuito-nombre">{c.nombre}</strong>
                      {!estado.vigente && (
                        <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="circuito-desactualizado">
                          Desactualizado: {estado.motivos.join('; ')}.
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        {!estado.vigente && <button type="button" data-testid="circuito-recalcular" onClick={() => recalcular(c.id)}>Recalcular</button>}
                        <button type="button" data-testid="circuito-borrar" onClick={() => borrar(c.id)}>Borrar</button>
                      </div>
                    </td>
                    <td>{etiquetaBoca(c.origen)}</td>
                    <td>{etiquetaBoca(c.destino)}</td>
                    <td style={{ textAlign: 'right' }} className={c.completa ? undefined : 'tone-warn'} data-testid="circuito-longitud">{longitudTexto(c, true)}</td>
                    <td style={{ textAlign: 'right' }} data-testid="circuito-piezas">{c.cruces.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" data-testid="circuitos-copiar" onClick={() => void copiar()} style={{ marginTop: 6 }}>Copiar tabla</button>
        </>
      )}
      {msg && <p className="stage-note" role="status" data-testid="circuitos-msg">{msg}</p>}
    </Section>
  );
}
