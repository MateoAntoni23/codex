import { useState, useEffect } from 'react';
import { useSceneStore } from '../store/sceneStore';
import type { ObjectType } from '../types/domain';
import {
  parsePositionDraft,
  snapToFloorZ,
  type PositionDraft,
  type PositionErrors,
} from './positionEditor';

const TYPE_LABEL: Record<ObjectType, string> = {
  floor: 'Piso',
  building: 'Nave Industrial',
  panel: 'Tablero Eléctrico',
  motor: 'Motor Eléctrico',
};

// Solo panel y motor permiten editar posición.
const EDITABLE_TYPES: ReadonlySet<ObjectType> = new Set(['panel', 'motor']);

function ReadField({ label, value }: { label: string; value: string }) {
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
  const updateObjectPosition = useSceneStore((s) => s.updateObjectPosition);

  const obj =
    selectedId != null ? (objects.find((o) => o.id === selectedId) ?? null) : null;
  const editable = obj != null && EDITABLE_TYPES.has(obj.type);

  const [draft, setDraft] = useState<PositionDraft>({ x: '', y: '', z: '' });
  const [errors, setErrors] = useState<PositionErrors>({});

  // Inicializa el borrador cada vez que cambia la selección.
  // No depende de obj para evitar resetear el input en cada aplicación.
  useEffect(() => {
    const { objects: objs, selectedId: sid } = useSceneStore.getState();
    const current = sid != null ? (objs.find((o) => o.id === sid) ?? null) : null;
    if (current != null && EDITABLE_TYPES.has(current.type)) {
      setDraft({
        x: String(current.position.x),
        y: String(current.position.y),
        z: String(current.position.z),
      });
    }
    setErrors({});
  }, [selectedId]);

  function handleChange(axis: keyof PositionDraft, value: string) {
    setDraft((d) => ({ ...d, [axis]: value }));
    setErrors((e) => ({ ...e, [axis]: undefined }));
  }

  function handleApply() {
    if (selectedId == null) return;
    const result = parsePositionDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    updateObjectPosition(selectedId, result.value);
    setErrors({});
  }

  function handleCancel() {
    if (obj != null) {
      setDraft({
        x: String(obj.position.x),
        y: String(obj.position.y),
        z: String(obj.position.z),
      });
    }
    setErrors({});
  }

  function handleSnapToFloor() {
    if (obj != null) {
      const z = snapToFloorZ(obj.dimensions.height);
      setDraft((d) => ({ ...d, z: String(z) }));
      setErrors((e) => ({ ...e, z: undefined }));
    }
  }

  return (
    <div className="panel panel-right">
      <div className="panel-title">Inspector</div>

      {obj == null ? (
        <p className="inspector-empty">Seleccioná un objeto</p>
      ) : (
        <div className="inspector-content">
          <ReadField label="Nombre" value={obj.name} />
          <ReadField label="Tipo" value={TYPE_LABEL[obj.type]} />

          <div className="inspector-section">Dimensiones (mm)</div>
          <ReadField label="Ancho" value={`${obj.dimensions.width} mm`} />
          <ReadField label="Prof." value={`${obj.dimensions.depth} mm`} />
          <ReadField label="Alto" value={`${obj.dimensions.height} mm`} />

          <div className="inspector-section">Posición (mm)</div>

          {editable ? (
            <>
              {(['x', 'y', 'z'] as const).map((axis) => {
                const errorMsg = errors[axis];
                return (
                  <div key={axis} className="inspector-edit-row">
                    <label
                      className="inspector-label"
                      htmlFor={`pos-${axis}-${selectedId}`}
                    >
                      {axis.toUpperCase()}
                      {axis === 'z' && (
                        <span className="inspector-hint"> (centro)</span>
                      )}
                    </label>
                    <div className="inspector-input-wrap">
                      <input
                        id={`pos-${axis}-${selectedId}`}
                        className={`inspector-input${errorMsg != null ? ' inspector-input--error' : ''}`}
                        type="text"
                        inputMode="numeric"
                        value={draft[axis]}
                        onChange={(e) => handleChange(axis, e.target.value)}
                      />
                      {errorMsg != null && (
                        <span className="inspector-error">{errorMsg}</span>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="inspector-snap-row">
                <button
                  className="btn-snap"
                  type="button"
                  onClick={handleSnapToFloor}
                >
                  Apoyar en piso
                </button>
                <span className="inspector-hint">Z = alto / 2</span>
              </div>

              <div className="inspector-actions">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={handleCancel}
                >
                  Cancelar
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={handleApply}
                >
                  Aplicar
                </button>
              </div>
            </>
          ) : (
            <>
              <ReadField label="X" value={`${obj.position.x} mm`} />
              <ReadField label="Y" value={`${obj.position.y} mm`} />
              <ReadField label="Z (centro)" value={`${obj.position.z} mm`} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
