/**
 * Etapa 2 — Planta.
 *
 * Lista los elementos de infraestructura (piso, nave) del proyecto y su
 * visibilidad. Alcance verificado en el código:
 *   - El modelo (`EquipmentElement`) admite transform y geometría para estos
 *     elementos, pero el editor existente (`EquipmentEditorPanel.canEdit`) sólo
 *     habilita edición para tableros, motores y sensores: editar dimensiones y
 *     posición de infraestructura requiere un editor nuevo → no se construye.
 *   - La visibilidad existe como capa ("Infraestructura"); no hay visibilidad
 *     por elemento en la escena, y la escena no se modifica en este hito.
 *   - No se construye carga de planos.
 */
import { useState } from 'react';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { Empty, Section, useRevealSelected } from './shared';

export function PlantaPanel() {
  const elements = useWorkspaceStore((s) => s.elements);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectEquip = useWorkspaceStore((s) => s.selectEquip);
  const layers = useWorkspaceStore((s) => s.layers);
  const toggleLayer = useWorkspaceStore((s) => s.toggleLayer);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);

  const infra = elements.filter((e) => e.category === 'infrastructure');
  const selectedKey = infra.some((e) => e.id === selectedEquipId) ? `infra:${selectedEquipId}` : null;
  useRevealSelected(listEl, selectedKey);

  return (
    <div className="stage-panel" data-testid="panel-planta">
      <Section title="Visibilidad">
        <label className="stage-check">
          <input type="checkbox" checked={layers.infrastructure} onChange={() => toggleLayer('infrastructure')} data-testid="layer-infrastructure" />
          Infraestructura visible en la escena
        </label>
      </Section>
      <section className="stage-section" ref={setListEl} data-testid="planta-list">
        <h4 className="stage-section-title">Elementos de planta ({infra.length})</h4>
        {infra.length === 0 && (
          <Empty testid="planta-empty">
            Sin elementos de planta en este proyecto. Llegan con un archivo de proyecto que los contenga.
          </Empty>
        )}
        {infra.map((el) => {
          const key = `infra:${el.id}`;
          const isSel = selectedKey === key;
          return (
            <button
              key={el.id}
              type="button"
              data-row-key={key}
              className={`workspace-tree-item stage-row${isSel ? ' active' : ''}`}
              aria-current={isSel ? 'true' : undefined}
              onClick={() => selectEquip(el.id)}
            >
              {el.tag ? `${el.tag} · ` : ''}{el.name}
            </button>
          );
        })}
      </section>
    </div>
  );
}
