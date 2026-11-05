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
  const elements        = useWorkspaceStore((s) => s.elements);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectEquip     = useWorkspaceStore((s) => s.selectEquip);
  const layers          = useWorkspaceStore((s) => s.layers);
  const toggleLayer     = useWorkspaceStore((s) => s.toggleLayer);
  const markDirty       = useWorkspaceStore((s) => s.markDirty);

  const entrada        = useTrayStore((s) => s.entrada);
  const context        = useTrayStore((s) => s.context);
  const selectedTrayId = useWorkspaceStore((s) => s.selectedTrayId);
  const selectTray     = useWorkspaceStore((s) => s.selectTray);
  const trayEdit       = useTrayStore((s) => s.edit);

  const categories = [...new Set(elements.map((e) => e.category as Category))].sort();

  const editTray = (fn: (inp: typeof entrada) => void) => {
    if (!entrada) return;
    const next = structuredClone(entrada);
    fn(next);
    trayEdit(next);
    markDirty();
  };

  return (
    <nav className="workspace-tree">
      {/* Layer toggles */}
      <section className="workspace-tree-section">
        <h4>Capas</h4>
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => (
          <label key={key} className="workspace-layer-toggle">
            <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
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
        <h4>Trazado — piezas</h4>
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

      {/* Circuits */}
      {entrada && (
        <section className="workspace-tree-section">
          <h4>Circuitos</h4>
          {entrada.circuitos.map((c, i) => (
            <details key={c.circuito_id} style={{ marginBottom: 4 }}>
              <summary className="workspace-tree-item" style={{ display: 'block', cursor: 'pointer' }}>
                {c.circuito_id}
              </summary>
              <div style={{ padding: '4px 6px', fontSize: 11 }}>
                <label style={{ display: 'block', marginBottom: 3 }}>
                  Cable
                  <select className="inspector-input" style={{ width: '100%', marginTop: 2 }}
                    value={c.cable_id}
                    onChange={(e) => editTray((inp) => { inp!.circuitos[i].cable_id = e.target.value; })}
                  >
                    {context?.cables.map((id) => <option key={id}>{id}</option>)}
                  </select>
                </label>
                <label style={{ display: 'block', marginBottom: 3 }}>
                  Cantidad
                  <input type="number" className="inspector-input" style={{ width: '100%', marginTop: 2 }}
                    value={c.cantidad}
                    onChange={(e) => editTray((inp) => { inp!.circuitos[i].cantidad = Number(e.target.value); })}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  Recorrido (IDs separados por coma)
                  <input type="text" className="inspector-input" style={{ width: '100%', marginTop: 2 }}
                    value={c.recorrido.join(',')}
                    onChange={(e) => editTray((inp) => { inp!.circuitos[i].recorrido = e.target.value.split(',').map((s) => s.trim()); })}
                  />
                </label>
              </div>
            </details>
          ))}
        </section>
      )}

      {/* Supports */}
      {entrada && entrada.soportes.length > 0 && (
        <section className="workspace-tree-section">
          <h4>Soportes</h4>
          {entrada.soportes.map((s, i) => (
            <label key={s.soporte_id} style={{ display: 'block', fontSize: 11, padding: '2px 0' }}>
              {s.soporte_id} sobre {s.instancia_id} · dist. P1 (mm)
              <input type="number" className="inspector-input" style={{ width: '100%', marginTop: 2 }}
                value={s.distancia_desde_P1_mm}
                onChange={(e) => editTray((inp) => { inp!.soportes[i].distancia_desde_P1_mm = Number(e.target.value); })}
              />
            </label>
          ))}
        </section>
      )}

      {/* PE */}
      {entrada && (
        <section className="workspace-tree-section">
          <h4>PE requerido</h4>
          <p style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
            Modelo candidato; admisibilidad pendiente. Contacto con ala ≠ conexión eléctrica.
          </p>
          <select className="inspector-input" style={{ width: '100%' }}
            value={entrada.pe.cable_id}
            onChange={(e) => editTray((inp) => { inp!.pe.cable_id = e.target.value; })}
          >
            {context?.cables.map((id) => <option key={id}>{id}</option>)}
          </select>
        </section>
      )}
    </nav>
  );
}
