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
  const projectOrigin = useSceneStore((s) => s.projectOrigin);
  const updateObjectPosition = useSceneStore((s) => s.updateObjectPosition);
  const saveStatus = useSceneStore((s) => s.saveStatus);
  const isLoading = saveStatus === 'loading' || saveStatus === 'recovering';

  const obj =
    selectedId != null ? (objects.find((o) => o.id === selectedId) ?? null) : null;
  const editable = obj != null && EDITABLE_TYPES.has(obj.type);

  const [draft, setDraft] = useState<PositionDraft>({ x: '', y: '', z: '' });
  const [errors, setErrors] = useState<PositionErrors>({});

  // Reinicia el borrador cada vez que cambia la selección o el origen.
  // Al cambiar el origen, los valores anteriores quedan bajo otro sistema
  // de referencia y deben descartarse.
  useEffect(() => {
    const { objects: objs, selectedId: sid, projectOrigin: origin } =
      useSceneStore.getState();
    const current =
      sid != null ? (objs.find((o) => o.id === sid) ?? null) : null;
    if (current != null && EDITABLE_TYPES.has(current.type)) {
      setDraft({
        x: String(current.position.x - origin.x),
        y: String(current.position.y - origin.y),
        z: String(current.position.z - origin.z),
      });
    }
    setErrors({});
  }, [selectedId, projectOrigin]); // ambas dependencias son intencionales

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
    // Posición global = posición ingresada (relativa al origen) + origen
    updateObjectPosition(selectedId, {
      x: result.value.x + projectOrigin.x,
      y: result.value.y + projectOrigin.y,
      z: result.value.z + projectOrigin.z,
    });
    setErrors({});
  }

  function handleCancel() {
    if (obj != null) {
      setDraft({
        x: String(obj.position.x - projectOrigin.x),
        y: String(obj.position.y - projectOrigin.y),
        z: String(obj.position.z - projectOrigin.z),
      });
    }
    setErrors({});
  }

  function handleSnapToFloor() {
    if (obj != null) {
      // Z mostrado = height/2 − origen.z → al aplicar: global Z = height/2 (base en piso)
      const z = snapToFloorZ(obj.dimensions.height, projectOrigin.z);
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

          <div className="inspector-section">Posición respecto del origen (mm)</div>

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
                        disabled={isLoading}
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
                  disabled={isLoading}
                  onClick={handleSnapToFloor}
                >
                  Apoyar en piso
                </button>
                <span className="inspector-hint">
                  Z global = alto / 2
                </span>
              </div>

              <div className="inspector-actions">
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={isLoading}
                  onClick={handleCancel}
                >
                  Cancelar
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={isLoading}
                  onClick={handleApply}
                >
                  Aplicar
                </button>
              </div>
            </>
          ) : (
            <>
              <ReadField label="X" value={`${obj.position.x - projectOrigin.x} mm`} />
              <ReadField label="Y" value={`${obj.position.y - projectOrigin.y} mm`} />
              <ReadField
                label="Z (centro)"
                value={`${obj.position.z - projectOrigin.z} mm`}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
