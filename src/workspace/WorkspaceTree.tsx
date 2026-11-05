import { useWorkspaceStore, type LayerKey } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import type { Category } from '../types/domain-v2';

const LAYER_LABELS: Record<LayerKey, string> = {
  infrastructure: 'Infraestructura',
  equipment: 'Equipos',
  trays: 'Bandejas',
  supports: 'Soportes',
  pe: 'PE',
};

const CATEGORY_LABEL: Record<Category, string> = {
  electrical_panel: 'Tableros Eléctricos',
  pneumatic_panel:  'Tableros Neumáticos',
  motor:            'Motores',
  pump:             'Bombas',
  sensor:           'Sensores',
  process_valve:    'Válvulas de Proceso',
  solenoid_valve:   'Electroválvulas',
  actuator:         'Actuadores',
  luminaire:        'Luminarias',
  pushbutton:       'Botoneras',
  terminal_block:   'Borneras',
  manifold:         'Manifolds',
  infrastructure:   'Infraestructura',
};

export function WorkspaceTree() {
  const elements       = useWorkspaceStore((s) => s.elements);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectEquip    = useWorkspaceStore((s) => s.selectEquip);
  const layers         = useWorkspaceStore((s) => s.layers);
  const toggleLayer    = useWorkspaceStore((s) => s.toggleLayer);

  const entrada        = useTrayStore((s) => s.entrada);
  const selectedTrayId = useWorkspaceStore((s) => s.selectedTrayId);
  const selectTray     = useWorkspaceStore((s) => s.selectTray);

  const categories = [...new Set(elements.map((e) => e.category as Category))].sort();

  return (
    <nav className="workspace-tree">
      {/* Layer toggles */}
      <section className="workspace-tree-section">
        <h4>Capas</h4>
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => (
          <label key={key} className="workspace-layer-toggle">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggleLayer(key)}
            />
            {LAYER_LABELS[key]}
          </label>
        ))}
      </section>

      {/* Equipment list by category */}
      <section className="workspace-tree-section">
        <h4>Equipos</h4>
        {categories.map((cat) => {
          const group = elements.filter((e) => e.category === cat);
          return (
            <details key={cat} open>
              <summary>{CATEGORY_LABEL[cat]} ({group.length})</summary>
              {group.map((el) => (
                <button
                  key={el.id}
                  className={`workspace-tree-item${selectedEquipId === el.id ? ' active' : ''}`}
                  onClick={() => selectEquip(el.id)}
                >
                  {el.tag ? `${el.tag} · ` : ''}{el.name}
                </button>
              ))}
            </details>
          );
        })}
        {elements.length === 0 && <p className="workspace-empty">Sin equipos</p>}
      </section>

      {/* Tray pieces list */}
      <section className="workspace-tree-section">
        <h4>Trazado</h4>
        {entrada?.piezas.map((p) => (
          <button
            key={p.instancia_id}
            className={`workspace-tree-item${selectedTrayId === p.instancia_id ? ' active' : ''}`}
            onClick={() => selectTray(p.instancia_id)}
          >
            {p.instancia_id} · {p.producto_id}
          </button>
        ))}
        {!entrada && <p className="workspace-empty">Motor no conectado</p>}
      </section>
    </nav>
  );
}
