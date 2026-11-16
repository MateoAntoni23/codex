/**
 * Resultados › «Contraste con ingeniería» (etapa 3): lo trazado contra los números del
 * Excel, con los dos valores y su origen. Primero los avisos (longitud antes que nada);
 * después lo que no se puede comparar (y qué falta) y lo que cierra. Copiable.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { Empty, Section } from '../workspace/stages/shared';
import { contraste, TEXTO_TIPO, tsvContraste, type EstadoContraste, type FilaContraste, type TipoContraste, type Valor } from './contraste';

const ORDEN_ESTADO: Readonly<Record<EstadoContraste, number>> = { aviso: 0, falta: 1, ok: 2, 'no-aplica': 3 };
const ORDEN_TIPO: Readonly<Record<TipoContraste, number>> = { longitud: 0, corriente: 1, metraje: 2 };
const TEXTO_ESTADO: Readonly<Record<EstadoContraste, string>> = { aviso: 'aviso', falta: 'falta un dato', ok: 'cierra', 'no-aplica': 'no aplica' };
const TONO: Readonly<Record<EstadoContraste, string>> = { aviso: 'tone-warn', falta: 'tone-warn', ok: 'tone-ok', 'no-aplica': 'tone-neutral' };

const v = (x: Valor) => (x.valor === null ? 'sin dato' : `${x.valor.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${x.unidad}`);

export function useContraste(): FilaContraste[] {
  const entrada = useTrayStore((s) => s.entrada);
  const elements = useWorkspaceStore((s) => s.elements);
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  return useMemo(() => contraste(entrada, elements, catalog), [entrada, elements, catalog]);
}

export function ContrasteTabla() {
  const filas = useContraste();
  const [msg, setMsg] = useState<string | null>(null);
  const [verTodo, setVerTodo] = useState(false);
  const orden = [...filas].sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || a.circuito.localeCompare(b.circuito));
  const visibles = verTodo ? orden : orden.filter((f) => f.estado === 'aviso' || f.estado === 'falta');
  const n = (e: EstadoContraste, t?: TipoContraste) => filas.filter((f) => f.estado === e && (!t || f.tipo === t)).length;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(tsvContraste(orden));
      setMsg(`Tabla copiada (${orden.length} fila(s)). Pegala en la planilla.`);
    } catch {
      setMsg('No se pudo copiar al portapapeles: el navegador no lo permitió.');
    }
  };

  return (
    <Section title="Contraste con ingeniería" testid="contraste">
      <p className="stage-note" style={{ whiteSpace: 'normal' }}>
        Compara lo trazado con números que ya trae el Excel; la app no hace cálculo eléctrico. Avisa, nunca impide.
      </p>
      {filas.length === 0 && <Empty>Sin circuitos ligados a conexiones del Excel: trazalos desde Conexiones.</Empty>}
      {filas.length > 0 && (
        <>
          <div className="stage-row-sub" data-testid="contraste-resumen">
            {n('aviso')} aviso(s) — {n('aviso', 'longitud')} de longitud, {n('aviso', 'corriente')} de corriente, {n('aviso', 'metraje')} de metraje · {n('falta')} sin dato para comparar · {n('ok')} cierran
          </div>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', margin: '4px 0' }}>
            <input type="checkbox" checked={verTodo} onChange={(e) => setVerTodo(e.target.checked)} data-testid="contraste-ver-todo" />
            Ver también lo que cierra y lo que no aplica
          </label>
          <div style={{ overflowX: 'auto' }}>
            <table className="stage-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Circuito</th>
                  <th style={{ textAlign: 'left' }}>Contraste</th>
                  <th style={{ textAlign: 'left' }}>Estado</th>
                  <th style={{ textAlign: 'right' }}>Ingeniería</th>
                  <th style={{ textAlign: 'right' }}>Comparado</th>
                  <th style={{ textAlign: 'left' }}>Detalle y origen</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr key={`${f.circuitoId}|${f.tipo}|${f.tendidoId ?? ''}`} data-testid="contraste-fila" data-tipo={f.tipo} data-estado={f.estado} data-conexion={f.conexionId} data-tendido={f.tendidoId ?? ''}>
                    <td><strong>{f.circuito}</strong><div className="stage-row-sub">{f.conexionId}{f.tendidoId ? ` · ${f.tendidoId}` : ''}</div></td>
                    <td>{TEXTO_TIPO[f.tipo]}</td>
                    <td className={TONO[f.estado]} data-testid="contraste-estado">{TEXTO_ESTADO[f.estado]}</td>
                    <td style={{ textAlign: 'right' }} data-testid="contraste-ingenieria">{v(f.ingenieria)}</td>
                    <td style={{ textAlign: 'right' }} data-testid="contraste-comparado">{v(f.comparado)}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      <div data-testid="contraste-texto" className={f.estado === 'aviso' ? 'tone-warn' : undefined}>{f.texto}</div>
                      <div className="stage-row-sub" data-testid="contraste-origen">Ingeniería: {f.ingenieria.origen}. Comparado: {f.comparado.origen}.</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibles.length === 0 && <Empty>Sin avisos ni datos faltantes: todo lo trazado cierra con el Excel.</Empty>}
          <button type="button" data-testid="contraste-copiar" onClick={() => void copiar()} style={{ marginTop: 6 }}>Copiar tabla</button>
        </>
      )}
      {msg && <p className="stage-note" role="status" data-testid="contraste-msg">{msg}</p>}
    </Section>
  );
}
