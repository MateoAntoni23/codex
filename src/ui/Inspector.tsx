import { useSceneStore } from '../store/sceneStore';
import type { ObjectType } from '../types/domain';

const TYPE_LABEL: Record<ObjectType, string> = {
  floor: 'Piso',
  building: 'Nave Industrial',
  panel: 'Tablero Eléctrico',
  motor: 'Motor Eléctrico',
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-field">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{value}</span>
    </div>
  );
}

export function Inspector() {
  const objects = useSceneStore((s) => s.objects);
  const selectedId = useSceneStore((s) => s.selectedId);

  const obj = selectedId ? objects.find((o) => o.id === selectedId) : null;

  return (
    <div className="panel panel-right">
      <div className="panel-title">Inspector</div>
      {obj == null ? (
        <p className="inspector-empty">Seleccioná un objeto</p>
      ) : (
        <div className="inspector-content">
          <Field label="Nombre" value={obj.name} />
          <Field label="Tipo" value={TYPE_LABEL[obj.type]} />
          <div className="inspector-section">Posición (mm)</div>
          <Field label="X" value={`${obj.position.x} mm`} />
          <Field label="Y" value={`${obj.position.y} mm`} />
          <Field label="Z" value={`${obj.position.z} mm`} />
          <div className="inspector-section">Dimensiones (mm)</div>
          <Field label="Ancho" value={`${obj.dimensions.width} mm`} />
          <Field label="Prof." value={`${obj.dimensions.depth} mm`} />
          <Field label="Alto" value={`${obj.dimensions.height} mm`} />
        </div>
      )}
    </div>
  );
}
