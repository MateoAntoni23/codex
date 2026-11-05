/**
 * TrayResults — displays motor calculation results in the workspace.
 * "Localizar" buttons select pieces through useWorkspaceStore.selectTray
 * so the unified scene responds instead of the legacy tray selection.
 */
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { object } from '../tray/model';

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="tray-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function TrayResults() {
  const result   = useTrayStore((s) => s.result);
  const status   = useTrayStore((s) => s.status);
  const entrada  = useTrayStore((s) => s.entrada);
  const selectTray = useWorkspaceStore((s) => s.selectTray);

  if (!result) {
    return <p style={{ padding: '8px 12px', fontSize: 12, color: '#666688' }}>Sin resultados. Calcular para consultar al motor.</p>;
  }

  const selectFor = (id: string, value: unknown) => {
    if (entrada?.piezas.some((p) => p.instancia_id === id)) { selectTray(id); return; }
    const connection = entrada?.conexiones.find((c) => c.conexion_id === id);
    if (connection) { selectTray(connection.a[0]); return; }
    if (object(value) && typeof value.instancia_id === 'string') { selectTray(value.instancia_id); return; }
    const support = entrada?.soportes.find((s) => s.soporte_id === id);
    if (support) selectTray(support.instancia_id);
  };

  return (
    <div style={{ padding: '0 0 8px' }}>
      <strong style={{ display: 'block', padding: '4px 12px', fontSize: 12 }}>
        {status === 'vigente' ? 'Resultado de preselección' : 'RESULTADO NO VIGENTE — recalcular'}
      </strong>
      <p style={{ padding: '2px 12px', fontSize: 11, color: '#888' }}>
        No verifica eléctricamente ni aprueba instalaciones.
      </p>

      {object(result.resumen) && (
        <p style={{ padding: '2px 12px', fontSize: 12 }}>
          <b>{String(result.resumen.estado_trazado).split('_').join(' ')}</b>
        </p>
      )}

      <details style={{ margin: '4px 0' }}>
        <summary style={{ padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          Ocupación por pieza / boca
        </summary>
        {object(result.ocupacion) && Object.entries(result.ocupacion).map(([id, p]) =>
          object(p) && object(p.secciones) ? (
            <section key={id} style={{ padding: '0 12px 4px', borderBottom: '1px solid #2a2e44' }}>
              <button
                style={{ fontSize: 11, margin: '3px 0', padding: '2px 6px', background: '#3c4967', color: 'white', border: '1px solid #5566aa', borderRadius: 3, cursor: 'pointer' }}
                disabled={status !== 'vigente'}
                onClick={() => selectFor(id, p)}
              >
                Localizar {id}
              </button>
              {Object.entries(p.secciones).map(([mouth, v]) =>
                object(v) ? (
                  <p key={mouth} style={{ fontSize: 11, margin: '2px 0', color: '#c0c0e0' }}>
                    {mouth}: {String(v.ancho_ocupado_mm)} / {String(v.ancho_referencia_mm)} mm · {String(v.estado).split('_').join(' ')}
                  </p>
                ) : null
              )}
            </section>
          ) : null
        )}
      </details>

      <details style={{ margin: '4px 0' }}>
        <summary style={{ padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          PE y equipotencial
        </summary>
        {object(result.resumen) && object(result.resumen.equipotencial) &&
          Object.entries(result.resumen.equipotencial).map(([k, v]) => (
            <p key={k} style={{ padding: '2px 12px', fontSize: 11 }}>
              <b>{k.split('_').join(' ')}</b>: {Array.isArray(v) ? v.join(', ') : String(v).split('_').join(' ')}
            </p>
          ))
        }
      </details>

      <details style={{ margin: '4px 0' }}>
        <summary style={{ padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          Cómputo de materiales
        </summary>
        {object(result.computo) && Array.isArray(result.computo.lineas) &&
          result.computo.lineas.map((v, i) =>
            object(v) ? (
              <p key={i} style={{ padding: '2px 12px', fontSize: 11 }}>
                {String(v.sku ?? v.producto_id ?? 'Pendiente')}: {String(v.cantidad ?? '?')} {String(v.unidad ?? '')}<br />
                {String(v.descripcion ?? '')}
              </p>
            ) : null
          )
        }
      </details>

      {Object.entries(result).filter(([k]) => k !== 'entrada').map(([key, val]) => (
        <details key={key} style={{ margin: '4px 0' }} open={key === 'resumen' || key === 'verificacion_electrica'}>
          <summary style={{ padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>{key}</summary>
          {Array.isArray(val) ? val.map((v, i) => (
            <div key={i}>
              <button
                style={{ fontSize: 11, margin: '3px 12px', padding: '2px 6px', background: '#3c4967', color: 'white', border: '1px solid #5566aa', borderRadius: 3, cursor: 'pointer' }}
                disabled={status !== 'vigente'}
                onClick={() => selectFor(object(v) ? String(v.soporte_id ?? v.instancia_id ?? v.corrida_id ?? i) : String(i), v)}
              >
                Localizar referencia {i + 1}
              </button>
              <JsonBlock value={v} />
            </div>
          )) : object(val) ? Object.entries(val).map(([id, v]) => (
            <div key={id}>
              <button
                style={{ fontSize: 11, margin: '3px 12px', padding: '2px 6px', background: '#3c4967', color: 'white', border: '1px solid #5566aa', borderRadius: 3, cursor: 'pointer' }}
                disabled={status !== 'vigente'}
                onClick={() => selectFor(id, v)}
              >
                {id} · localizar
              </button>
              <JsonBlock value={v} />
            </div>
          )) : <JsonBlock value={val} />}
        </details>
      ))}
    </div>
  );
}
