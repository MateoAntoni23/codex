/**
 * ParametricInspector — ficha de la variante seleccionada.
 *
 * Muestra parámetros efectivos, bocas y fidelidad vs STEP original.
 */

import { useParametricStore, findEntry } from './useParametricStore';
import type { ParametricEntry, ParametricPort, ParametricVariantView, Vec3 } from './catalog';
import { viewLabel } from './catalog';
import { ParametricCalibrationPanel } from './ParametricCalibrationPanel';

function formatNum(x: number, digits = 2): string {
  if (Math.abs(x) < 1e-3) return x.toExponential(2);
  return x.toFixed(digits);
}

function fmtVec(v: readonly number[], digits = 2): string {
  return `[${v.map((x) => formatNum(x, digits)).join(', ')}]`;
}

export function ParametricInspector() {
  const recipe = useParametricStore((s) => s.recipe);
  const view = useParametricStore((s) => s.view);
  const selectedPortName = useParametricStore((s) => s.selectedPort);
  const entry = findEntry(recipe);
  const active: ParametricVariantView = view === 'variant' ? entry.variant : entry.reconstruction;
  const isOriginalView = view === 'original';
  const selectedPort: ParametricPort | undefined = active.ports.find((p) => p.name === selectedPortName);

  return (
    <aside className="panel panel-right pilot-inspector">
      <div className="pilot-ins-header" style={{ padding: 12, borderBottom: '1px solid #2a2a44' }}>
        <div style={{ fontSize: 11, color: '#6677aa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {viewLabel(view)}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{active.sku}</div>
        <div style={{ fontSize: 11, color: '#7788aa', fontFamily: 'monospace', marginTop: 2 }}>
          {entry.piece_kind} · {entry.recipe}
        </div>
      </div>

      <section style={{ padding: 12, borderBottom: '1px solid #2a2a44' }}>
        <h4 style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8899bb', marginBottom: 6 }}>
          PARÁMETROS {isOriginalView && <span style={{ color: '#eebb66' }}>(no editables — modelo original)</span>}
        </h4>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <tbody>
            {Object.entries(active.params).map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: '#99aacc', padding: '2px 8px 2px 0' }}>{k}</td>
                <td style={{ fontFamily: 'monospace', textAlign: 'right' }}>{v === null ? '—' : String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ padding: 12, borderBottom: '1px solid #2a2a44' }}>
        <h4 style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8899bb', marginBottom: 6 }}>
          FIDELIDAD vs STEP ORIGINAL
        </h4>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#6677aa' }}>
              <th style={{ textAlign: 'left' }}>Dim</th>
              <th style={{ textAlign: 'right' }}>Orig</th>
              <th style={{ textAlign: 'right' }}>Recon</th>
              <th style={{ textAlign: 'right' }}>Δ%</th>
            </tr>
          </thead>
          <tbody>
            {(['dx', 'dy', 'dz'] as const).map((k, i) => (
              <tr key={k}>
                <td style={{ color: '#99aacc' }}>{k}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatNum(entry.fidelity.span_original_mm[i], 1)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatNum(entry.fidelity.span_reconstruction_mm[i], 1)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: colorForDelta(entry.fidelity.span_delta_pct[i]) }}>
                  {formatNum(entry.fidelity.span_delta_pct[i], 2)}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ color: '#99aacc' }}>Vol</td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                {formatNum(entry.fidelity.volume_original_mm3 / 1e6, 2)} L
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                {formatNum(entry.fidelity.volume_reconstruction_mm3 / 1e6, 2)} L
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace', color: colorForDelta(entry.fidelity.volume_delta_pct) }}>
                {formatNum(entry.fidelity.volume_delta_pct, 2)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ padding: 12, borderBottom: '1px solid #2a2a44' }}>
        <h4 style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8899bb', marginBottom: 6 }}>
          BOCAS ({active.ports.length})
        </h4>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {active.ports.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                className={`pilot-list-item${p.name === selectedPortName ? ' pilot-list-item--selected' : ''}`}
                style={{ padding: '6px 8px' }}
                onClick={() =>
                  useParametricStore.getState().selectPort(p.name === selectedPortName ? null : p.name)
                }
              >
                <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{p.name}</span>
                  {p.kind === 'reference' && (
                    <span
                      title="Plano de referencia (no es una cara real del STEP). No usar como conexión verificada."
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.05em',
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: '#4a3310',
                        color: '#ffcc66',
                        fontWeight: 700,
                      }}
                    >
                      REFERENCIA
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#7788aa' }}>
                  {p.ancho_mm.toFixed(1)} × {p.ala_mm.toFixed(1)} mm
                </div>
              </button>
            </li>
          ))}
        </ul>
        {selectedPort && (
          <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace', color: '#99aacc' }}>
            <div>kind   {selectedPort.kind}</div>
            <div>center {fmtVec(selectedPort.center, 1)}</div>
            <div>normal {fmtVec(selectedPort.normal, 3)}</div>
            <div>u_dir  {fmtVec(selectedPort.u_dir, 3)}</div>
            <div>v_dir  {fmtVec(selectedPort.v_dir, 3)}</div>
            {selectedPort.kind === 'reference' && (
              <div style={{ marginTop: 6, color: '#ffcc66', fontFamily: 'inherit', fontSize: 10, lineHeight: 1.4 }}>
                Plano conceptual, NO una cara real del STEP. No apto como conexión operativa sin verificación del fabricante.
              </div>
            )}
          </div>
        )}
      </section>

      <BboxDiagnosticSection entry={entry} />

      <ParametricCalibrationPanel />

      <section style={{ padding: 12 }}>
        <h4 style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8899bb', marginBottom: 6 }}>PROCEDENCIA</h4>
        <ul style={{ padding: 0, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {active.notes.map((n, i) => (
            <li key={i} style={{ fontSize: 11, lineHeight: 1.4, color: '#c0c0e0' }}>
              <span className="pilot-badge pilot-badge--prov" style={{ marginRight: 6 }}>
                nota
              </span>
              {n}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function colorForDelta(pct: number): string {
  const a = Math.abs(pct);
  if (a < 1) return '#aadd88';
  if (a < 10) return '#eebb66';
  return '#ff8866';
}

/**
 * Diagnóstico de marco: bbox canónico esperado por el catálogo, usado para
 * alinear el STEP original y colocar bocas. Si el GLB cargado no coincide con
 * este rectángulo, la calibración de malla permite corregirlo sin tocar bocas.
 */
function BboxDiagnosticSection({ entry }: { entry: ParametricEntry }) {
  const { min, max } = entry.canonical_bbox_mm;
  const span: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return (
    <section style={{ padding: 12, borderBottom: '1px solid #2a2a44' }}>
      <h4 style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8899bb', marginBottom: 6 }}>
        MARCO CANÓNICO (diagnóstico)
      </h4>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td style={{ color: '#99aacc' }}>min</td>
            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtVec(min, 1)}</td>
          </tr>
          <tr>
            <td style={{ color: '#99aacc' }}>max</td>
            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtVec(max, 1)}</td>
          </tr>
          <tr>
            <td style={{ color: '#99aacc' }}>span</td>
            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtVec(span, 1)}</td>
          </tr>
          <tr>
            <td style={{ color: '#99aacc' }}>center</td>
            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtVec(center, 1)}</td>
          </tr>
          <tr>
            <td style={{ color: '#99aacc' }}>build</td>
            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{entry.source_version}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#7788aa', marginTop: 6, lineHeight: 1.4 }}>
        El STEP original se alinea al centro de este bbox tras neutralizar la rotación −90°X
        que OpenCASCADE 7.8 escribe en el nodo raíz del GLB.
      </div>
    </section>
  );
}
