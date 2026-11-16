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
import { cableDeTendido, REGLA_COBRE, TEXTO_DECLARADO, TEXTO_PROCEDENCIA } from './tendidos';
import { useDeclarados } from '../conductores/store';
import { LINEA_DECLARADO, type CableDeclarado } from '../conductores/biblioteca';

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
  const declarados = useDeclarados();
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
        const k = cableDeTendido(t, cables, declarado, declarados);
        const elegido = declarado.cables[t.tendidoId];
        const valor = !elegido ? PROPUESTA : elegido.cable_id === null ? NINGUNO : elegido.cable_id;
        const d = k.cableDeclarado;
        const opcionesDeclaradas = d && !k.candidatosDeclarados.some((x) => x.cable_id === d.cable_id) ? [...k.candidatosDeclarados, d] : k.candidatosDeclarados;
        const textoDeclarado = (x: CableDeclarado) => `${x.designacion} — ${LINEA_DECLARADO.toLowerCase()}`;
        return (
          <div key={t.tendidoId} className="stage-card" data-testid="tendido-fila" data-tendido={t.tendidoId}
            data-procedencia={k.procedencia ?? ''} data-cable={k.cable?.cable_id ?? d?.cable_id ?? ''} data-origen={d ? 'operador' : k.cable ? 'catalogo' : ''}>
            <strong>{t.tendidoId}</strong>
            <Importado t={t} />
            <div style={{ whiteSpace: 'normal' }}>
              Cable: <span data-testid="tendido-cable">{d ? d.designacion : k.cable ? textoCable(k.cable) : 'sin cable de catálogo'}</span>
              {d && (
                <span className="stage-badge" data-testid="tendido-declarado" title={TEXTO_DECLARADO}> {LINEA_DECLARADO.toLowerCase()}</span>
              )}
              {k.procedencia && (
                <span className="stage-row-sub" data-testid="tendido-procedencia" title={k.procedencia === 'regla-cobre' ? REGLA_COBRE.texto : undefined}>
                  {' '}— {TEXTO_PROCEDENCIA[k.procedencia]}
                </span>
              )}
            </div>
            {d && (
              <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="tendido-declarado-nota">
                {TEXTO_DECLARADO[0].toUpperCase()}{TEXTO_DECLARADO.slice(1)}.
                {d.diametro_exterior_mm === null && (
                  <span className="tone-warn" data-testid="tendido-declarado-falta"> Le falta el diámetro exterior: sin él, sus bandejas no tienen ocupación calculable. Completalo en la biblioteca de conductores.</span>
                )}
              </div>
            )}
            {k.motivoSinCable && <div className="stage-note tone-warn" style={{ whiteSpace: 'normal' }} data-testid="tendido-sin-cable">{k.motivoSinCable}.</div>}
            {k.avisos.map((a) => <div key={a} className="stage-note tone-warn" style={{ whiteSpace: 'normal' }} data-testid="tendido-aviso">{a}.</div>)}
            {(k.candidatos.length > 0 || opcionesDeclaradas.length > 0) && (
              <select className="inspector-input" value={valor} onChange={(e) => elegir(t, e.target.value)} data-testid="tendido-elegir">
                <option value={PROPUESTA}>{elegido ? '— volver a la propuesta —' : k.cable ? `propuesta: ${textoCable(k.cable)}` : d ? `propuesta: ${textoDeclarado(d)}` : '— elegí un cable —'}</option>
                {k.candidatos.map((c) => <option key={c.cable_id} value={c.cable_id}>{textoCable(c)}</option>)}
                {opcionesDeclaradas.map((x) => <option key={x.cable_id} value={x.cable_id}>{textoDeclarado(x)}</option>)}
                <option value={NINGUNO}>— sin cable de catálogo —</option>
              </select>
            )}
          </div>
        );
      })}
    </details>
  );
}
