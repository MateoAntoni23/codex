/**
 * ParametricSidebar — selector de pieza, variante y capas de visualización.
 */

import { PARAMETRIC_CATALOG, type ViewId } from './catalog';
import { useParametricStore } from './useParametricStore';

const PIECE_LABEL: Record<string, string> = {
  tramo_recto: 'Tramo recto',
  curva_horizontal: 'Curva horizontal',
  curva_vertical: 'Curva vertical',
  derivacion_lateral: 'Derivación lateral',
  cruz: 'Cruz',
};

const VIEW_LABEL: Record<ViewId, string> = {
  original: 'STEP SAMET (original)',
  reconstruction: 'Reconstrucción 300',
  variant: 'Variante 450',
};

export function ParametricSidebar() {
  const recipe = useParametricStore((s) => s.recipe);
  const view = useParametricStore((s) => s.view);
  const setRecipe = useParametricStore((s) => s.setRecipe);
  const setView = useParametricStore((s) => s.setView);
  const showAxes = useParametricStore((s) => s.showAxes);
  const showPorts = useParametricStore((s) => s.showPorts);
  const showNormals = useParametricStore((s) => s.showNormals);
  const showTrajectory = useParametricStore((s) => s.showTrajectory);
  const compare = useParametricStore((s) => s.compareOriginal);
  const showConnectionDemo = useParametricStore((s) => s.showConnectionDemo);
  const toggleAxes = useParametricStore((s) => s.toggleAxes);
  const togglePorts = useParametricStore((s) => s.togglePorts);
  const toggleNormals = useParametricStore((s) => s.toggleNormals);
  const toggleTrajectory = useParametricStore((s) => s.toggleTrajectory);
  const toggleCompare = useParametricStore((s) => s.toggleCompareOriginal);
  const toggleConnectionDemo = useParametricStore((s) => s.toggleConnectionDemo);

  return (
    <div className="pilot-list">
      <div className="pilot-list-title">Modelos paramétricos (STP-Z 300)</div>
      <ul className="pilot-list-ul">
        {PARAMETRIC_CATALOG.map((entry) => (
          <li key={entry.recipe}>
            <button
              type="button"
              className={`pilot-list-item${recipe === entry.recipe ? ' pilot-list-item--selected' : ''}`}
              onClick={() => setRecipe(entry.recipe)}
            >
              <div className="pilot-list-name">{PIECE_LABEL[entry.piece_kind] ?? entry.piece_kind}</div>
              <div className="pilot-list-sku">{entry.reconstruction.sku}</div>
              <div className="pilot-list-meta">
                <span className="pilot-badge pilot-badge--nom">{entry.piece_kind}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="pilot-list-title" style={{ marginTop: 6 }}>Variante a mostrar</div>
      <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(['original', 'reconstruction', 'variant'] as ViewId[]).map((v) => (
          <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 12 }}>
            <input
              type="radio"
              name="pview"
              checked={view === v}
              onChange={() => setView(v)}
            />
            <span>{VIEW_LABEL[v]}</span>
          </label>
        ))}
      </div>

      <div className="pilot-list-title">Capas</div>
      <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Toggle label="Comparar con STEP original (overlay)" value={compare} onChange={toggleCompare} />
        <Toggle label="Ejes locales (X·Y·Z)" value={showAxes} onChange={toggleAxes} />
        <Toggle label="Bocas (puertos)" value={showPorts} onChange={togglePorts} />
        <Toggle label="Normales de boca" value={showNormals} onChange={toggleNormals} />
        <Toggle label="Recorrido central" value={showTrajectory} onChange={toggleTrajectory} />
        <Toggle
          label="Prueba funcional: rectos en bocas (curva vertical)"
          value={showConnectionDemo}
          onChange={toggleConnectionDemo}
        />
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 12 }}>
      <input type="checkbox" checked={value} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
