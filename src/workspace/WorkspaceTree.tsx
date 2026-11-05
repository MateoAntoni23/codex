import { useWorkspaceStore, type LayerKey } from './useWorkspaceStore';
import { useTrayStore } from '../tray/store';
import { WorkspaceLegend } from './WorkspaceLegend';
import { computeGuideSteps } from './workspaceGuide';
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

// ─── Guide / checklist ────────────────────────────────────────────────────────

function GuideStep({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0', fontSize: 11 }}>
      <span style={{ color: done ? '#55cc66' : '#886644', fontSize: 14, lineHeight: '14px', flexShrink: 0 }}>
        {done ? '✓' : '○'}
      </span>
      <div>
        <span style={{ color: done ? '#99ddaa' : '#ccaa88' }}>{label}</span>
        {hint && <div style={{ fontSize: 10, color: '#666688', marginTop: 1 }}>{hint}</div>}
      </div>
    </div>
  );
}

function WorkspaceGuide() {
  const entrada = useTrayStore((s) => s.entrada);
  const status  = useTrayStore((s) => s.status);
  const result  = useTrayStore((s) => s.result);

  const piezas     = entrada?.piezas ?? [];
  const conexiones = entrada?.conexiones ?? [];
  const circuitos  = entrada?.circuitos ?? [];
  const soportes   = entrada?.soportes ?? [];
  const cableId    = entrada?.pe.cable_id ?? '';

  const resumen       = result && typeof result === 'object' && !Array.isArray(result) ? result.resumen : undefined;
  const estadoTrazado = resumen && typeof resumen === 'object' && !Array.isArray(resumen)
    ? String((resumen as Record<string, unknown>).estado_trazado ?? '')
    : undefined;

  const steps = computeGuideSteps({
    nPiezas:    piezas.length,
    nConexiones: conexiones.length,
    circuitos,
    nSoportes:  soportes.length,
    cableId,
    status,
    estadoTrazado: estadoTrazado || undefined,
  });

  return (
    <details style={{ margin: '0 0 4px' }} open>
      <summary style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, background: '#1f2235', userSelect: 'none' }}>
        Guía de trabajo
      </summary>
      <div style={{ padding: '6px 12px 8px', borderBottom: '1px solid #2a2e44' }}>
        {steps.map((step) => (
          <GuideStep key={step.id} done={step.done} label={step.label} hint={step.hint || undefined} />
        ))}
      </div>
    </details>
  );
}

// ─── Connections section ──────────────────────────────────────────────────────

function ConnectionsSection() {
  const connectionToolActive = useWorkspaceStore((s) => s.connectionToolActive);
  const connectionPortA      = useWorkspaceStore((s) => s.connectionPortA);
  const activateConnectionTool   = useWorkspaceStore((s) => s.activateConnectionTool);
  const deactivateConnectionTool = useWorkspaceStore((s) => s.deactivateConnectionTool);
  const markDirty = useWorkspaceStore((s) => s.markDirty);

  const entrada  = useTrayStore((s) => s.entrada);
  const trayEdit = useTrayStore((s) => s.edit);

  const conexiones = entrada?.conexiones ?? [];

  const removeConexion = (id: string) => {
    if (!entrada) return;
    if (!confirm(`Eliminar conexión "${id}"?`)) return;
    const next = structuredClone(entrada);
    next.conexiones = next.conexiones.filter((c) => c.conexion_id !== id);
    trayEdit(next);
    markDirty();
  };

  return (
    <section className="workspace-tree-section">
      <h4>Conexiones</h4>

      {connectionToolActive ? (
        <div style={{ padding: '4px 0', fontSize: 11 }}>
          <div style={{ color: '#99ddff', marginBottom: 4 }}>
            {!connectionPortA
              ? 'Hacé clic en un puerto (esferas) para seleccionar el primer extremo.'
              : `Puerto A: ${connectionPortA[0]}.${connectionPortA[1]} — Hacé clic en otro puerto.`}
          </div>
          <button
            style={{ fontSize: 11, padding: '3px 8px', background: '#6b4422', color: 'white', border: '1px solid #aa6633', borderRadius: 3, cursor: 'pointer' }}
            onClick={() => deactivateConnectionTool()}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          className="workspace-tree-item"
          style={{ marginBottom: 4, background: '#2a3a55', border: '1px solid #4455aa', width: '100%', textAlign: 'left' }}
          onClick={() => activateConnectionTool()}
        >
          + Conectar piezas
        </button>
      )}

      {conexiones.length === 0 && !connectionToolActive && (
        <p className="workspace-empty">Sin conexiones definidas</p>
      )}

      {conexiones.map((c) => (
        <div key={c.conexion_id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', fontSize: 11 }}>
          <span style={{ flex: 1, color: '#c0c0d8' }}>
            {c.a[0]}.{c.a[1]} ↔ {c.b[0]}.{c.b[1]}
          </span>
          <span style={{ color: '#666688', fontSize: 10 }}>{c.conexion_id}</span>
          <button
            style={{ fontSize: 10, padding: '1px 5px', background: '#6b2222', color: 'white', border: '1px solid #aa3333', borderRadius: 2, cursor: 'pointer' }}
            onClick={() => removeConexion(c.conexion_id)}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

// ─── Main tree ────────────────────────────────────────────────────────────────

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
      {/* Legend */}
      <WorkspaceLegend />

      {/* Guide checklist */}
      <WorkspaceGuide />

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

      {/* Connections tool */}
      <ConnectionsSection />

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
