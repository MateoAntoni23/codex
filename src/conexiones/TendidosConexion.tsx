/**
 * Tendidos de una conexión del Excel (etapa 2): lo importado a la vista y el cable de
 * catálogo de cada uno, con su procedencia (único candidato, regla del operador, elegido
 * por el operador) o el motivo por el que no lleva. Elegir es dato del operador, aparte.
 */
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useCatalogoCables } from '../workspace/stages/CableCircuitoCampos';
import { textoCable } from '../workspace/cables/catalogoCables';
import type { ConexionImportada, TendidoImportado } from '../import/types';
import { declaradoOf, elegirCable } from './declarado';
import { cableDeTendido, REGLA_COBRE, TEXTO_PROCEDENCIA } from './tendidos';

const PROPUESTA = '__propuesta__';
const NINGUNO = '__ninguno__';

const sn = (x: number | undefined, u = '') => (x === undefined ? 'sin dato' : `${String(x).replace('.', ',')}${u}`);

function Importado({ t }: { t: TendidoImportado }) {
  return (
    <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="tendido-importado">
      Excel: {t.naturaleza} · {t.funcion} · {t.cantidadUnidades} × {t.designacion ?? 'sin designación'} · sección {sn(t.seccionMm2, ' mm²')}
      {' '}· PE {t.incluyePe}{t.seccionPeMm2 !== undefined ? ` (${sn(t.seccionPeMm2, ' mm²')})` : ''} · apantallado {t.apantallado}
      {t.diametroExteriorMm !== undefined ? ` · Ø ${sn(t.diametroExteriorMm, ' mm')}` : ''}
    </div>
  );
}

export function TendidosConexion({ conexion, tendidos }: { conexion: ConexionImportada; tendidos: readonly TendidoImportado[] }) {
  const entrada = useTrayStore((s) => s.entrada);
  const trayEdit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const { cables, motivo } = useCatalogoCables();
  const declarado = declaradoOf(entrada);
  if (!tendidos.length) return <div className="stage-row-sub" data-testid="conexion-sin-tendidos">El Excel no trae tendidos para {conexion.conexionId}.</div>;

  const elegir = (t: TendidoImportado, valor: string) => {
    if (!entrada) return;
    trayEdit(elegirCable(entrada, t.tendidoId, valor === PROPUESTA ? undefined : valor === NINGUNO ? null : valor));
    markDirty();
  };

  return (
    <details className="grupo-piezas" data-testid="conexion-tendidos">
      <summary>Tendidos ({tendidos.length})</summary>
      {motivo && <div className="stage-note tone-warn">Sin catálogo de cables: {motivo}</div>}
      {tendidos.map((t) => {
        const k = cableDeTendido(t, cables, declarado);
        const elegido = declarado.cables[t.tendidoId];
        const valor = !elegido ? PROPUESTA : elegido.cable_id === null ? NINGUNO : elegido.cable_id;
        return (
          <div key={t.tendidoId} className="stage-card" data-testid="tendido-fila" data-tendido={t.tendidoId}
            data-procedencia={k.procedencia ?? ''} data-cable={k.cable?.cable_id ?? ''}>
            <strong>{t.tendidoId}</strong>
            <Importado t={t} />
            <div style={{ whiteSpace: 'normal' }}>
              Cable: <span data-testid="tendido-cable">{k.cable ? textoCable(k.cable) : 'sin cable de catálogo'}</span>
              {k.procedencia && (
                <span className="stage-row-sub" data-testid="tendido-procedencia" title={k.procedencia === 'regla-cobre' ? REGLA_COBRE.texto : undefined}>
                  {' '}— {TEXTO_PROCEDENCIA[k.procedencia]}
                </span>
              )}
            </div>
            {k.motivoSinCable && <div className="stage-note tone-warn" style={{ whiteSpace: 'normal' }} data-testid="tendido-sin-cable">{k.motivoSinCable}.</div>}
            {k.avisos.map((a) => <div key={a} className="stage-note tone-warn" style={{ whiteSpace: 'normal' }} data-testid="tendido-aviso">{a}.</div>)}
            {k.candidatos.length > 0 && (
              <select className="inspector-input" value={valor} onChange={(e) => elegir(t, e.target.value)} data-testid="tendido-elegir">
                <option value={PROPUESTA}>{elegido ? '— volver a la propuesta —' : k.cable ? `propuesta: ${textoCable(k.cable)}` : '— elegí un cable —'}</option>
                {k.candidatos.map((c) => <option key={c.cable_id} value={c.cable_id}>{textoCable(c)}</option>)}
                <option value={NINGUNO}>— sin cable de catálogo —</option>
              </select>
            )}
          </div>
        );
      })}
    </details>
  );
}
