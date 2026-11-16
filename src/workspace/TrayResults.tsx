/**
 * Lo que devuelve el motor, en dos piezas para el panel inferior (interfaz,
 * 2026-11-14): `ComputoMotor` (líneas del cómputo, con las que agregó la app
 * distinguidas) y `TrayResults` (la respuesta cruda, plegada). La ocupación por
 * pieza se lee en «Cálculo del motor» (`CalculoMotor.tsx`); la de una bandeja
 * segregada la calcula la app y la del motor no se muestra (parte B de la etapa 3).
 *
 * "Localizar" buttons select pieces through useWorkspaceStore.selectTray
 * so the unified scene responds instead of the legacy tray selection.
 */
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { object } from '../tray/model';
import { summarizeResultDe } from './stages/resultPresentation';
import { curvasEslabonadas } from './computoEslabonado';
import { completarComponentesMezclas } from './componentesUnionMezcla';
import { bandasOf } from './segregacion/bandaDivisoria';
import { useOcupacionDeLaApp } from './stages/BandaDivisoria';

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="tray-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function TrayResults() {
  const result   = useTrayStore((s) => s.result);
  const productos = useTrayStore((s) => s.context?.productos);
  const status   = useTrayStore((s) => s.status);
  const entrada  = useTrayStore((s) => s.entrada);
  const selectTray = useWorkspaceStore((s) => s.selectTray);

  const app = useOcupacionDeLaApp();
  const segregadas = new Set(bandasOf(entrada).map((b) => b.pieza));
  // Biblioteca de conductores, parte B: las piezas con cables declarados tampoco muestran la ocupación del motor.
  const conDeclarados = new Set((entrada?.piezas ?? []).map((p) => p.instancia_id).filter((id) => !segregadas.has(id) && app(id)?.tipo === 'declarados'));
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

      {/* Hito 1b: el estado se lee con summarizeResult (PE sin definir ≠ incumplimiento). */}
      {object(result.resumen) && (
        <p style={{ padding: '2px 12px', fontSize: 12 }}>
          <b>{summarizeResultDe(result, entrada, productos)?.headline}</b>
        </p>
      )}

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

      <p style={{ padding: '2px 12px', fontSize: 11 }} data-testid="respuesta-cruda-nota">Respuesta completa del motor, tal cual{segregadas.size ? `; la ocupación de ${segregadas.size} bandeja(s) segregada(s) no se muestra: la calcula la app (el motor no conoce la banda)` : ''}{conDeclarados.size ? `; la ocupación de ${conDeclarados.size} bandeja(s) con cables declarados por el operador no se muestra: la calcula la app (los declarados no viajan al motor)` : ''}.</p>
      {Object.entries(result).filter(([k]) => k !== 'entrada').map(([key, val0]) => {
        const val = key === 'ocupacion' && object(val0) ? Object.fromEntries(Object.entries(val0).filter(([id]) => !segregadas.has(id) && !conDeclarados.has(id))) : val0;
        return (
        <details key={key} style={{ margin: '4px 0' }}>
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
        );
      })}
    </div>
  );
}

/** Cómputo de materiales que devuelve el motor, con las líneas que agregó la app distinguidas. */
export function ComputoMotor() {
  const result = useTrayStore((s) => s.result);
  const ctx = useTrayStore((s) => s.context);
  const entrada = useTrayStore((s) => s.entrada);
  const eslabonadas = new Set(curvasEslabonadas(entrada, new Map((ctx?.productos ?? []).map((p) => [p.producto_id, p]))).map((c) => c.pieza));
  const agregadas = completarComponentesMezclas(result, entrada, new Map((ctx?.productos ?? []).map((p) => [p.producto_id, p])), ctx?.compatibilidades ?? [], ctx?.componentesUnion ?? []);
  if (!result) return <p style={{ padding: '8px 12px', fontSize: 12 }}>Sin resultados del motor: calculá el trazado.</p>;
  return (
    <div>
      <details open style={{ margin: '4px 0' }} data-testid="computo-motor">
        <summary style={{ padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          Cómputo de materiales
        </summary>
        {object(result.computo) && Array.isArray(result.computo.lineas) &&
          result.computo.lineas.map((v, i) =>
            object(v) ? (
              <p key={i} style={{ padding: '2px 12px', fontSize: 11 }} data-testid="computo-linea-motor">
                {String(v.sku ?? v.producto_id ?? 'Pendiente')}: {String(v.cantidad ?? '?')} {String(v.unidad ?? '')}
                {object(v.origen) && typeof v.origen.conexion === 'string' && agregadas.completadas.includes(v.origen.conexion)
                  ? ' — completada por la app (ver "agregadas por la app")' : ''}
                {object(v.origen) && typeof v.origen.pieza === 'string' && eslabonadas.has(v.origen.pieza)
                  ? ' — curva eslabonada: reemplazada por la cuenta de eslabones (ver "Curvas eslabonadas")' : ''}<br />
                {String(v.descripcion ?? '')}
              </p>
            ) : null
          )
        }
        {/* Líneas que agregó la app (no el motor): se distinguen al leer el presupuesto. */}
        {agregadas.agregadas.map((l, i) => (
          <p key={`app-${i}`} style={{ padding: '2px 12px', fontSize: 11 }} data-testid="computo-linea-app-detalle">
            [AGREGADA POR LA APP] {l.sku ?? l.producto_id}: {String(l.cantidad ?? '?')} {l.unidad ?? ''} — unión {l.origen.conexion}<br />
            {l.procedencia}
          </p>
        ))}
      </details>

    </div>
  );
}
