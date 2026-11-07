/**
 * ParametricInspector — ficha de la variante seleccionada.
 *
 * Muestra parámetros efectivos, bocas y fidelidad vs STEP original.
 */

import { useParametricStore, findEntry } from './useParametricStore';
import type { ParametricPort, ParametricVariantView } from './catalog';
import { viewLabel } from './catalog';

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
                <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: '#7788aa' }}>
                  {p.ancho_mm.toFixed(1)} × {p.ala_mm.toFixed(1)} mm
                </div>
              </button>
            </li>
          ))}
        </ul>
        {selectedPort && (
          <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace', color: '#99aacc' }}>
            <div>center {fmtVec(selectedPort.center, 1)}</div>
            <div>normal {fmtVec(selectedPort.normal, 3)}</div>
            <div>u_dir  {fmtVec(selectedPort.u_dir, 3)}</div>
            <div>v_dir  {fmtVec(selectedPort.v_dir, 3)}</div>
          </div>
        )}
      </section>

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
