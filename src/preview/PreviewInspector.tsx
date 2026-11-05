import { usePreviewStore } from './usePreviewStore';
import { EquipmentEditorPanel } from './EquipmentEditorPanel';

export function PreviewInspector() {
  const selectedId    = usePreviewStore((s) => s.selectedId);
  const elements      = usePreviewStore((s) => s.elements);
  const updateElement = usePreviewStore((s) => s.updateElement);
  const addEvidence   = usePreviewStore((s) => s.addEvidence);
  const element = selectedId != null ? (elements.find((e) => e.id === selectedId) ?? null) : null;

  return (
    <div className="panel panel-right">
      <div className="panel-title">Inspector</div>
      <EquipmentEditorPanel
        element={element}
        elements={elements}
        updateElement={updateElement}
        addEvidence={addEvidence}
      />
    </div>
  );
}
