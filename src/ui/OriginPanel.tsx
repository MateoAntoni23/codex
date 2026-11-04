import { useState, useEffect } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { parsePositionDraft, type PositionDraft, type PositionErrors } from './positionEditor';

export function OriginPanel() {
  const projectOrigin = useSceneStore((s) => s.projectOrigin);
  const setProjectOrigin = useSceneStore((s) => s.setProjectOrigin);
  const selectedId = useSceneStore((s) => s.selectedId);
  const objects = useSceneStore((s) => s.objects);
  const saveStatus = useSceneStore((s) => s.saveStatus);
  const isLoading = saveStatus === 'loading';

  const selectedObj =
    selectedId != null ? (objects.find((o) => o.id === selectedId) ?? null) : null;

  const [draft, setDraft] = useState<PositionDraft>({
    x: String(projectOrigin.x),
    y: String(projectOrigin.y),
    z: String(projectOrigin.z),
  });
  const [errors, setErrors] = useState<PositionErrors>({});

  // Sincroniza el borrador cuando el origen cambia externamente
  // (p.ej. tras Restablecer o Usar centro).
  useEffect(() => {
    setDraft({
      x: String(projectOrigin.x),
      y: String(projectOrigin.y),
      z: String(projectOrigin.z),
    });
    setErrors({});
  }, [projectOrigin]);

  function handleChange(axis: keyof PositionDraft, value: string) {
    setDraft((d) => ({ ...d, [axis]: value }));
    setErrors((e) => ({ ...e, [axis]: undefined }));
  }

  function handleApply() {
    const result = parsePositionDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setProjectOrigin(result.value);
    setErrors({});
  }

  function handleCancel() {
    setDraft({
      x: String(projectOrigin.x),
      y: String(projectOrigin.y),
      z: String(projectOrigin.z),
    });
    setErrors({});
  }

  function handleReset() {
    setProjectOrigin({ x: 0, y: 0, z: 0 });
    // El useEffect sincronizará el borrador cuando projectOrigin se actualice.
  }

  function handleUseCenterAsOrigin() {
    if (selectedObj == null) return;
    setProjectOrigin({ ...selectedObj.position });
    // El useEffect sincronizará el borrador.
  }

  return (
    <div className="origin-panel">
      <div className="panel-title">Origen del proyecto</div>

      <p className="origin-disclaimer">
        Cambiar el origen ajusta las coordenadas mostradas; no mueve la instalación.
      </p>

      {(['x', 'y', 'z'] as const).map((axis) => {
        const errorMsg = errors[axis];
        return (
          <div key={axis} className="inspector-edit-row">
            <label
              className="inspector-label"
              htmlFor={`origin-${axis}`}
            >
              {axis.toUpperCase()}
            </label>
            <div className="inspector-input-wrap">
              <input
                id={`origin-${axis}`}
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

      <div className="origin-actions">
        <button className="btn-secondary" type="button" disabled={isLoading} onClick={handleCancel}>
          Cancelar
        </button>
        <button className="btn-secondary origin-btn-reset" type="button" disabled={isLoading} onClick={handleReset}>
          Restablecer
        </button>
        <button className="btn-primary" type="button" disabled={isLoading} onClick={handleApply}>
          Aplicar
        </button>
      </div>

      <div className="origin-use-center">
        <button
          className="btn-snap"
          type="button"
          onClick={handleUseCenterAsOrigin}
          disabled={isLoading || selectedObj == null}
          title={
            selectedObj == null
              ? 'Seleccioná un objeto en la escena'
              : `Usar centro de "${selectedObj.name}" como origen`
          }
        >
          Usar centro del objeto seleccionado
        </button>
      </div>
    </div>
  );
}
