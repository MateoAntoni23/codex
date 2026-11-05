import { useState, useEffect, useCallback } from 'react';
import { usePreviewStore } from './usePreviewStore';
import { elementToRenderProps, resolveGlobalTransform } from '../scene/v2-adapter';
import {
  parseName, parsePositionDraft, parseBoxSizeDraft, parseCylinderSizeDraft,
  applyNameEdit, applyPositionEdit, applyBoxSizeEdit, applyCylinderSizeEdit, adjustChildLocalZ,
  type PositionDraft, type PositionErrors,
  type BoxSizeDraft, type BoxSizeErrors,
  type CylinderSizeDraft, type CylinderSizeErrors,
} from './previewEditor';
import type { Category, EquipmentElement, Vec3 } from '../types/domain-v2';

const CATEGORY_LABEL: Record<Category, string> = {
  electrical_panel: 'Tablero Eléctrico',
  pneumatic_panel:  'Tablero Neumático',
  motor:            'Motor',
  pump:             'Bomba',
  sensor:           'Sensor',
  process_valve:    'Válvula de Proceso',
  solenoid_valve:   'Electroválvula',
  actuator:         'Actuador',
  luminaire:        'Luminaria',
  pushbutton:       'Botonera',
  terminal_block:   'Bornera',
  manifold:         'Manifold',
  infrastructure:   'Infraestructura',
};

const GEOMETRY_LABEL: Record<string, string> = {
  box:      'Caja (box)',
  cylinder: 'Cilindro',
  plane:    'Plano',
  asset:    'Asset 3D',
  unknown:  'Dimensiones pendientes',
};

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-field">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{value}</span>
    </div>
  );
}

function fmt(n: number) { return n.toFixed(1); }

function canEdit(el: EquipmentElement): boolean {
  if (el.placementStatus !== 'placed') return false;
  if (el.category === 'electrical_panel' && el.geometry?.kind === 'box') return true;
  if (el.category === 'motor'            && el.geometry?.kind === 'cylinder') return true;
  return false;
}

// ─── Subcomponente: input con label y error ───────────────────────────────────

interface EditFieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  hint?: string;
}

function EditField({ id, label, value, error, onChange, hint }: EditFieldProps) {
  return (
    <div className="inspector-edit-row">
      <label className="inspector-label" htmlFor={id}>{label}</label>
      <div className="inspector-input-wrap">
        <input
          id={id}
          className={`inspector-input${error ? ' inspector-input--error' : ''}`}
          value={value}
          inputMode="numeric"
          onChange={(e) => onChange(e.target.value)}
        />
        {error && <span className="inspector-error">{error}</span>}
        {hint && !error && <span className="inspector-hint">{hint}</span>}
      </div>
    </div>
  );
}

// ─── Inspector principal ──────────────────────────────────────────────────────

export function PreviewInspector() {
  const selectedId     = usePreviewStore((s) => s.selectedId);
  const elements       = usePreviewStore((s) => s.elements);
  const updateElement  = usePreviewStore((s) => s.updateElement);

  const element = selectedId != null
    ? (elements.find((e) => e.id === selectedId) ?? null)
    : null;

  const renderProps = element != null
    ? elementToRenderProps(element, elements)
    : null;

  const editable = element != null && canEdit(element);

  // ── Draft state ──────────────────────────────────────────────────────────

  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [posDraft,  setPosDraft]  = useState<PositionDraft>({ x: '0', y: '0', z: '0' });
  const [posErrors, setPosErrors] = useState<PositionErrors>({});
  const [boxDraft,  setBoxDraft]  = useState<BoxSizeDraft>({ width: '0', depth: '0', height: '0' });
  const [boxErrors, setBoxErrors] = useState<BoxSizeErrors>({});
  const [cylDraft,  setCylDraft]  = useState<CylinderSizeDraft>({ diameter: '0', length: '0' });
  const [cylErrors, setCylErrors] = useState<CylinderSizeErrors>({});

  // ── Sync draft desde un elemento y lista de elementos ────────────────────

  const syncDraft = useCallback((el: EquipmentElement, allElements: EquipmentElement[]) => {
    setNameDraft(el.name);
    setNameError(undefined);
    setPosErrors({});
    setBoxErrors({});
    setCylErrors({});

    const gt = resolveGlobalTransform(el.id, allElements);
    if (gt) {
      setPosDraft({
        x: String(gt.positionMm.x),
        y: String(gt.positionMm.y),
        z: String(gt.positionMm.z),
      });
    }
    if (el.geometry?.kind === 'box') {
      setBoxDraft({
        width:  String(el.geometry.widthMm),
        depth:  String(el.geometry.depthMm),
        height: String(el.geometry.heightMm),
      });
    } else if (el.geometry?.kind === 'cylinder') {
      setCylDraft({
        diameter: String(el.geometry.diameterMm),
        length:   String(el.geometry.lengthMm),
      });
    }
  }, []);

  useEffect(() => {
    if (element != null && canEdit(element)) syncDraft(element, elements);
    // Sync solo cuando cambia la selección, no en cada actualización de elements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Cancelar ─────────────────────────────────────────────────────────────

  const handleCancel = () => {
    if (element == null || !canEdit(element)) return;
    syncDraft(element, elements);
  };

  // ── Snap to floor ─────────────────────────────────────────────────────────

  const handleSnapToFloor = () => {
    if (element == null || !canEdit(element) || element.parentId != null) return;
    // Use the STORED height (not draft) so that Apply's base-preservation delta
    // lands at the correct final Z = newDraftHeight/2 without double-counting.
    let storedHeightMm = 0;
    if (element.geometry?.kind === 'box') {
      storedHeightMm = element.geometry.heightMm;
    } else if (element.geometry?.kind === 'cylinder') {
      storedHeightMm = element.geometry.lengthMm;
    }
    setPosDraft((d) => ({ ...d, z: String(storedHeightMm / 2) }));
    setPosErrors((e) => ({ ...e, z: undefined }));
  };

  // ── Aplicar ───────────────────────────────────────────────────────────────

  const handleApply = () => {
    if (element == null || !canEdit(element)) return;

    // 1. Validar
    const nameResult = parseName(nameDraft);
    const posResult  = parsePositionDraft(posDraft);
    const boxResult  = element.geometry?.kind === 'box'      ? parseBoxSizeDraft(boxDraft)      : null;
    const cylResult  = element.geometry?.kind === 'cylinder' ? parseCylinderSizeDraft(cylDraft) : null;

    setNameError(nameResult.ok ? undefined : nameResult.error);
    setPosErrors(posResult.ok  ? {}        : posResult.errors);
    if (boxResult) setBoxErrors(boxResult.ok ? {} : boxResult.errors);
    if (cylResult) setCylErrors(cylResult.ok ? {} : cylResult.errors);

    const sizeOk = (boxResult == null || boxResult.ok) && (cylResult == null || cylResult.ok);
    if (!nameResult.ok || !posResult.ok || !sizeOk) return;

    // 2. Convertir posición global → local si tiene padre
    const parentTransform = element.parentId != null
      ? resolveGlobalTransform(element.parentId, elements)
      : null;

    // 3. Aplicar posición (convierte a local si es hijo)
    let updated = applyPositionEdit(element, posResult.value as Vec3, parentTransform);

    // 4. Aplicar dimensiones (ajusta positionMm.z para conservar base)
    let childDeltaZ = 0;
    if (boxResult?.ok) {
      const r = applyBoxSizeEdit(updated, boxResult.value.width, boxResult.value.depth, boxResult.value.height);
      updated = r.element;
      childDeltaZ = r.childDeltaZ;
    } else if (cylResult?.ok) {
      const r = applyCylinderSizeEdit(updated, cylResult.value.diameter, cylResult.value.length);
      updated = r.element;
      childDeltaZ = r.childDeltaZ;
    }

    // 5. Aplicar nombre
    updated = applyNameEdit(updated, nameResult.value);

    // 6. Incrementar version solo si algo cambió efectivamente
    const posChanged = (
      updated.transform?.positionMm.x !== element.transform?.positionMm.x ||
      updated.transform?.positionMm.y !== element.transform?.positionMm.y ||
      updated.transform?.positionMm.z !== element.transform?.positionMm.z
    );
    const geoChanged  = JSON.stringify(updated.geometry) !== JSON.stringify(element.geometry);
    const nameChanged = updated.name !== element.name;

    if (posChanged || geoChanged || nameChanged) {
      updated = { ...updated, version: element.version + 1 } as EquipmentElement;
    }

    // 7. Guardar en store
    updateElement(updated);

    // 8. Ajustar hijos para conservar sus posiciones globales
    if (childDeltaZ !== 0) {
      for (const child of elements.filter((e) => e.parentId === element.id)) {
        updateElement(adjustChildLocalZ(child, childDeltaZ));
      }
    }

    // 9. Re-sincronizar el formulario a los valores realmente guardados
    const updatedElements = elements.map((e) => (e.id === updated.id ? updated : e));
    syncDraft(updated, updatedElements);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="panel panel-right">
      <div className="panel-title">Inspector</div>

      {element == null ? (
        <p className="inspector-empty">Seleccioná un elemento</p>
      ) : editable ? (
        // ── Formulario de edición ──────────────────────────────────────────
        <div className="inspector-content">

          {/* Nombre */}
          <div className="inspector-section">Identificación</div>
          <div className="inspector-edit-row">
            <label className="inspector-label" htmlFor="pi-name">Nombre</label>
            <div className="inspector-input-wrap">
              <input
                id="pi-name"
                className={`inspector-input${nameError ? ' inspector-input--error' : ''}`}
                value={nameDraft}
                onChange={(e) => { setNameDraft(e.target.value); setNameError(undefined); }}
              />
              {nameError && <span className="inspector-error">{nameError}</span>}
            </div>
          </div>
          <ReadField label="ID"        value={element.id} />
          <ReadField label="Categoría" value={CATEGORY_LABEL[element.category as Category] ?? element.category} />
          <ReadField label="Geometría" value={GEOMETRY_LABEL[renderProps?.geometryKind ?? 'unknown']} />
          <ReadField label="Versión"   value={String(element.version)} />

          {/* Posición global (en mm) */}
          <div className="inspector-section">Posición en mm (global, respecto al origen)</div>
          <EditField id="pi-pos-x" label="X" value={posDraft.x} error={posErrors.x}
            onChange={(v) => { setPosDraft((d) => ({ ...d, x: v })); setPosErrors((e) => ({ ...e, x: undefined })); }} />
          <EditField id="pi-pos-y" label="Y" value={posDraft.y} error={posErrors.y}
            onChange={(v) => { setPosDraft((d) => ({ ...d, y: v })); setPosErrors((e) => ({ ...e, y: undefined })); }} />
          <EditField id="pi-pos-z" label="Z" value={posDraft.z} error={posErrors.z}
            onChange={(v) => { setPosDraft((d) => ({ ...d, z: v })); setPosErrors((e) => ({ ...e, z: undefined })); }} />

          {element.parentId === null && (
            <div className="inspector-snap-row">
              <button type="button" className="btn-snap" onClick={handleSnapToFloor}>
                Apoyar en piso (Z = alto/2)
              </button>
            </div>
          )}
          {element.parentId !== null && (
            <p className="inspector-hint" style={{ padding: '2px 12px 4px' }}>
              Coordenadas globales — se guardará como posición local.
            </p>
          )}

          {/* Dimensiones */}
          <div className="inspector-section">Dimensiones (mm)</div>

          {element.geometry?.kind === 'box' && (
            <>
              <EditField id="pi-box-width"  label="Ancho"  value={boxDraft.width}  error={boxErrors.width}
                onChange={(v) => { setBoxDraft((d) => ({ ...d, width:  v })); setBoxErrors((e) => ({ ...e, width:  undefined })); }} />
              <EditField id="pi-box-depth"  label="Prof."  value={boxDraft.depth}  error={boxErrors.depth}
                onChange={(v) => { setBoxDraft((d) => ({ ...d, depth:  v })); setBoxErrors((e) => ({ ...e, depth:  undefined })); }} />
              <EditField id="pi-box-height" label="Alto"   value={boxDraft.height} error={boxErrors.height}
                hint="Redimensionar ajusta Z para conservar la base."
                onChange={(v) => { setBoxDraft((d) => ({ ...d, height: v })); setBoxErrors((e) => ({ ...e, height: undefined })); }} />
            </>
          )}

          {element.geometry?.kind === 'cylinder' && (
            <>
              <EditField id="pi-cyl-diameter" label="Diámetro"  value={cylDraft.diameter} error={cylErrors.diameter}
                onChange={(v) => { setCylDraft((d) => ({ ...d, diameter: v })); setCylErrors((e) => ({ ...e, diameter: undefined })); }} />
              <EditField id="pi-cyl-length"   label="Longitud"  value={cylDraft.length}   error={cylErrors.length}
                hint="Redimensionar ajusta Z para conservar la base."
                onChange={(v) => { setCylDraft((d) => ({ ...d, length:   v })); setCylErrors((e) => ({ ...e, length:   undefined })); }} />
            </>
          )}

          {/* Jerarquía */}
          {element.parentId != null && (
            <>
              <div className="inspector-section">Jerarquía</div>
              <ReadField
                label="Padre"
                value={elements.find((e) => e.id === element.parentId)?.name ?? element.parentId}
              />
            </>
          )}

          {/* Acciones */}
          <div className="inspector-actions">
            <button type="button" className="btn-secondary" onClick={handleCancel}>Cancelar</button>
            <button type="button" className="btn-primary"   onClick={handleApply}>Aplicar</button>
          </div>

        </div>
      ) : (
        // ── Vista de solo lectura (no editables) ──────────────────────────
        <div className="inspector-content">
          <ReadField label="Nombre"    value={element.name} />
          <ReadField label="ID"        value={element.id} />
          <ReadField label="Categoría" value={CATEGORY_LABEL[element.category as Category] ?? element.category} />
          <ReadField label="Geometría" value={GEOMETRY_LABEL[renderProps?.geometryKind ?? 'unknown']} />

          {renderProps?.placed && renderProps.sizeViewer != null && (
            <>
              <div className="inspector-section">Tamaño en visor (m)</div>
              <ReadField label="Ancho"  value={fmt(renderProps.sizeViewer[0])} />
              <ReadField label="Alto"   value={fmt(renderProps.sizeViewer[1])} />
              <ReadField label="Prof."  value={fmt(renderProps.sizeViewer[2])} />
            </>
          )}

          {renderProps?.placed && renderProps.positionViewer != null && (
            <>
              <div className="inspector-section">Posición en visor (m)</div>
              <ReadField label="X" value={fmt(renderProps.positionViewer[0])} />
              <ReadField label="Y" value={fmt(renderProps.positionViewer[1])} />
              <ReadField label="Z" value={fmt(renderProps.positionViewer[2])} />
            </>
          )}

          {!renderProps?.placed && (
            <>
              <div className="inspector-section">Estado</div>
              <p className="inspector-empty" style={{ padding: '8px 12px' }}>
                Elemento sin ubicar — no tiene posición en escena.
              </p>
            </>
          )}

          {renderProps?.geometryKind === 'unknown' && (
            <div className="preview-inspector-pending">
              Dimensiones pendientes: este elemento no tiene geometría definida.
              Se muestra como marcador en la escena.
            </div>
          )}

          {element.parentId != null && (
            <>
              <div className="inspector-section">Jerarquía</div>
              <ReadField
                label="Padre"
                value={elements.find((e) => e.id === element.parentId)?.name ?? element.parentId}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
