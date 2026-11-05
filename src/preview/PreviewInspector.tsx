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
import {
  syncCommonDraft, syncMotorDraft, syncSensorDraft, syncPanelDraft,
  applyMotorTechnicalDraft, applySensorTechnicalDraft, applyPanelTechnicalDraft,
  isElementInclined,
  type CommonTechnicalDraft, type MotorTechnicalDraft, type SensorTechnicalDraft,
  type PanelTechnicalDraft, type TechDraftErrors,
} from './technicalEditor';
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
  if (el.category === 'motor' && el.geometry?.kind === 'cylinder') return true;
  if (el.category === 'sensor') return true;
  return false;
}

// ─── Subcomponentes de entrada ────────────────────────────────────────────────

interface EditFieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  hint?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  wide?: boolean;
}

function EditField({ id, label, value, error, onChange, hint, inputMode = 'numeric', wide }: EditFieldProps) {
  return (
    <div className={`inspector-edit-row${wide ? ' inspector-edit-row--wide' : ''}`}>
      <label className="inspector-label" htmlFor={id}>{label}</label>
      <div className="inspector-input-wrap">
        <input
          id={id}
          className={`inspector-input${error ? ' inspector-input--error' : ''}`}
          value={value}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
        />
        {error && <span className="inspector-error">{error}</span>}
        {hint && !error && <span className="inspector-hint">{hint}</span>}
      </div>
    </div>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  wide?: boolean;
}

function SelectField({ id, label, value, onChange, options, error, wide }: SelectFieldProps) {
  return (
    <div className={`inspector-edit-row${wide ? ' inspector-edit-row--wide' : ''}`}>
      <label className="inspector-label" htmlFor={id}>{label}</label>
      <div className="inspector-input-wrap">
        <select
          id={id}
          className={`inspector-input${error ? ' inspector-input--error' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {error && <span className="inspector-error">{error}</span>}
      </div>
    </div>
  );
}

// ─── Inspector principal ──────────────────────────────────────────────────────

export function PreviewInspector() {
  const selectedId     = usePreviewStore((s) => s.selectedId);
  const elements       = usePreviewStore((s) => s.elements);
  const updateElement  = usePreviewStore((s) => s.updateElement);
  const addEvidence    = usePreviewStore((s) => s.addEvidence);

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

  const [commonDraft, setCommonDraft] = useState<CommonTechnicalDraft>({ manufacturer: '', model: '' });
  const [motorDraft, setMotorDraft] = useState<MotorTechnicalDraft>({
    power: '', powerUnit: 'kW', voltage: '', phases: '',
    plateCurrent: '', efficiency: '', powerFactor: '', start: '',
  });
  const [sensorDraft, setSensorDraft] = useState<SensorTechnicalDraft>({
    measuredVariable: '', rangeMin: '', rangeMax: '', rangeUnit: '',
    supplyVoltage: '', supplyCurrentType: '', signal: '',
  });
  const [panelDraft, setPanelDraft] = useState<PanelTechnicalDraft>({
    ipRating: '', ratedCurrent: '',
  });
  const [techErrors, setTechErrors] = useState<TechDraftErrors>({});

  // ── Sync draft desde un elemento y lista de elementos ────────────────────

  const syncDraft = useCallback((el: EquipmentElement, allElements: EquipmentElement[]) => {
    setNameDraft(el.name);
    setNameError(undefined);
    setPosErrors({});
    setBoxErrors({});
    setCylErrors({});
    setTechErrors({});

    setCommonDraft(syncCommonDraft(el));

    if (el.category === 'motor') setMotorDraft(syncMotorDraft(el.technical));
    else if (el.category === 'sensor') setSensorDraft(syncSensorDraft(el.technical));
    else if (el.category === 'electrical_panel') setPanelDraft(syncPanelDraft(el.technical));

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

    // 1. Validar posición, geometría y nombre
    const nameResult = parseName(nameDraft);
    const posResult  = parsePositionDraft(posDraft);
    const boxResult  =
      element.geometry?.kind === 'box' && element.category === 'electrical_panel'
        ? parseBoxSizeDraft(boxDraft)
        : null;
    const cylResult  =
      element.geometry?.kind === 'cylinder'
        ? parseCylinderSizeDraft(cylDraft)
        : null;

    // 2. Validar datos técnicos
    let techResult:
      | ReturnType<typeof applyMotorTechnicalDraft>
      | ReturnType<typeof applySensorTechnicalDraft>
      | ReturnType<typeof applyPanelTechnicalDraft>
      | null = null;

    if (element.category === 'motor') {
      techResult = applyMotorTechnicalDraft(element, motorDraft, commonDraft);
    } else if (element.category === 'sensor') {
      techResult = applySensorTechnicalDraft(element, sensorDraft, commonDraft);
    } else if (element.category === 'electrical_panel') {
      techResult = applyPanelTechnicalDraft(element, panelDraft, commonDraft);
    }

    // 3. Propagar todos los errores (mostrar todos a la vez)
    setNameError(nameResult.ok ? undefined : nameResult.error);
    setPosErrors(posResult.ok  ? {}        : posResult.errors);
    if (boxResult) setBoxErrors(boxResult.ok ? {} : boxResult.errors);
    if (cylResult) setCylErrors(cylResult.ok ? {} : cylResult.errors);
    setTechErrors(techResult && !techResult.ok ? techResult.errors : {});

    const sizeOk = (boxResult == null || boxResult.ok) && (cylResult == null || cylResult.ok);
    const techOk = techResult == null || techResult.ok;
    if (!nameResult.ok || !posResult.ok || !sizeOk || !techOk) return;

    // 4. Convertir posición global → local si tiene padre
    const parentTransform = element.parentId != null
      ? resolveGlobalTransform(element.parentId, elements)
      : null;

    // 5. Aplicar posición
    let updated = applyPositionEdit(element, posResult.value as Vec3, parentTransform);

    // 6. Aplicar dimensiones
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

    // 7. Aplicar nombre
    updated = applyNameEdit(updated, nameResult.value);

    // 8. Mergear datos técnicos y evidencia
    if (techResult?.ok) {
      updated = {
        ...updated,
        technical: techResult.element.technical,
        manufacturer: techResult.element.manufacturer,
        model: techResult.element.model,
      } as EquipmentElement;
      for (const ev of techResult.newEvidence) addEvidence(ev);
    }

    // 9. Incrementar versión solo si algo cambió
    const posChanged = (
      updated.transform?.positionMm.x !== element.transform?.positionMm.x ||
      updated.transform?.positionMm.y !== element.transform?.positionMm.y ||
      updated.transform?.positionMm.z !== element.transform?.positionMm.z
    );
    const geoChanged    = JSON.stringify(updated.geometry)     !== JSON.stringify(element.geometry);
    const nameChanged   = updated.name                         !== element.name;
    const techChanged   = JSON.stringify(updated.technical)    !== JSON.stringify(element.technical);
    const mfgChanged    = JSON.stringify(updated.manufacturer) !== JSON.stringify(element.manufacturer);
    const modelChanged  = JSON.stringify(updated.model)        !== JSON.stringify(element.model);

    if (posChanged || geoChanged || nameChanged || techChanged || mfgChanged || modelChanged) {
      updated = { ...updated, version: element.version + 1 } as EquipmentElement;
    }

    // 10. Guardar en store
    updateElement(updated);

    // 11. Ajustar hijos para conservar sus posiciones globales
    if (childDeltaZ !== 0) {
      for (const child of elements.filter((e) => e.parentId === element.id)) {
        updateElement(adjustChildLocalZ(child, childDeltaZ));
      }
    }

    // 12. Re-sincronizar el formulario a los valores realmente guardados
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

          {element.parentId === null && element.placementStatus === 'placed' && (() => {
            const inclined = isElementInclined(element.transform.rotation);
            return (
              <div className="inspector-snap-row">
                <button
                  type="button"
                  className="btn-snap"
                  onClick={inclined ? undefined : handleSnapToFloor}
                  disabled={inclined}
                  style={inclined ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                >
                  Apoyar en piso (Z = alto/2)
                </button>
                {inclined && (
                  <span className="inspector-hint">No disponible para elementos inclinados.</span>
                )}
              </div>
            );
          })()}

          {element.parentId !== null && (
            <p className="inspector-hint" style={{ padding: '2px 12px 4px' }}>
              Coordenadas globales — se guardará como posición local.
            </p>
          )}

          {/* Dimensiones (solo box de tableros o cilindro de motores) */}
          {(element.geometry?.kind === 'box' && element.category === 'electrical_panel') ||
           element.geometry?.kind === 'cylinder'
            ? (
              <div className="inspector-section">Dimensiones (mm)</div>
            ) : null}

          {element.geometry?.kind === 'box' && element.category === 'electrical_panel' && (
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

          {/* Fabricante y modelo */}
          <div className="inspector-section">Fabricante y modelo</div>
          <EditField id="pi-manufacturer" label="Fabricante" value={commonDraft.manufacturer}
            inputMode="text" wide
            onChange={(v) => setCommonDraft((d) => ({ ...d, manufacturer: v }))} />
          <EditField id="pi-model" label="Modelo" value={commonDraft.model}
            inputMode="text" wide
            onChange={(v) => setCommonDraft((d) => ({ ...d, model: v }))} />

          {/* Datos técnicos del motor */}
          {element.category === 'motor' && (
            <div className="inspector-tech-section">
              <div className="inspector-section">Datos técnicos del motor</div>

              {/* Potencia con unidad */}
              <div className="inspector-edit-row inspector-edit-row--wide">
                <label className="inspector-label" htmlFor="pi-power">Potencia</label>
                <div className="inspector-input-wrap">
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      id="pi-power"
                      className={`inspector-input${techErrors.power ? ' inspector-input--error' : ''}`}
                      value={motorDraft.power}
                      inputMode="decimal"
                      style={{ flex: 1 }}
                      onChange={(e) => {
                        setMotorDraft((d) => ({ ...d, power: e.target.value }));
                        setTechErrors((er) => ({ ...er, power: undefined }));
                      }}
                    />
                    <select
                      aria-label="Unidad de potencia"
                      className="inspector-input"
                      value={motorDraft.powerUnit}
                      style={{ width: 50, flexShrink: 0 }}
                      onChange={(e) => setMotorDraft((d) => ({ ...d, powerUnit: e.target.value as 'kW' | 'HP' }))}
                    >
                      <option value="kW">kW</option>
                      <option value="HP">HP</option>
                    </select>
                  </div>
                  {techErrors.power && <span className="inspector-error">{techErrors.power}</span>}
                </div>
              </div>

              <EditField id="pi-voltage" label="Tensión (V)" value={motorDraft.voltage}
                error={techErrors.voltage} wide
                onChange={(v) => { setMotorDraft((d) => ({ ...d, voltage: v })); setTechErrors((er) => ({ ...er, voltage: undefined })); }} />

              <SelectField id="pi-phases" label="Fases" value={motorDraft.phases}
                error={techErrors.phases} wide
                onChange={(v) => { setMotorDraft((d) => ({ ...d, phases: v as MotorTechnicalDraft['phases'] })); setTechErrors((er) => ({ ...er, phases: undefined })); }}
                options={[
                  { value: '', label: '—' },
                  { value: '1', label: 'Monofásico (1)' },
                  { value: '3', label: 'Trifásico (3)' },
                ]} />

              <EditField id="pi-platecurrent" label="Corriente (A)" value={motorDraft.plateCurrent}
                error={techErrors.plateCurrent} wide
                onChange={(v) => { setMotorDraft((d) => ({ ...d, plateCurrent: v })); setTechErrors((er) => ({ ...er, plateCurrent: undefined })); }} />

              <EditField id="pi-efficiency" label="Eficiencia" value={motorDraft.efficiency}
                error={techErrors.efficiency} hint="0 < η ≤ 1" wide
                onChange={(v) => { setMotorDraft((d) => ({ ...d, efficiency: v })); setTechErrors((er) => ({ ...er, efficiency: undefined })); }} />

              <EditField id="pi-powerfactor" label="Cos φ" value={motorDraft.powerFactor}
                error={techErrors.powerFactor} hint="0 < cosφ ≤ 1" wide
                onChange={(v) => { setMotorDraft((d) => ({ ...d, powerFactor: v })); setTechErrors((er) => ({ ...er, powerFactor: undefined })); }} />

              <SelectField id="pi-start" label="Arranque" value={motorDraft.start}
                error={techErrors.start} wide
                onChange={(v) => { setMotorDraft((d) => ({ ...d, start: v as MotorTechnicalDraft['start'] })); setTechErrors((er) => ({ ...er, start: undefined })); }}
                options={[
                  { value: '',            label: '—' },
                  { value: 'direct',      label: 'Directo' },
                  { value: 'star_delta',  label: 'Estrella-triángulo' },
                  { value: 'softstarter', label: 'Softstarter' },
                  { value: 'vfd',         label: 'Variador de frecuencia (VFD)' },
                  { value: 'other',       label: 'Otro' },
                ]} />
            </div>
          )}

          {/* Datos técnicos del sensor */}
          {element.category === 'sensor' && (
            <div className="inspector-tech-section">
              <div className="inspector-section">Datos técnicos del sensor</div>

              <EditField id="pi-measvar" label="Variable" value={sensorDraft.measuredVariable}
                inputMode="text" error={techErrors.measuredVariable} wide
                onChange={(v) => { setSensorDraft((d) => ({ ...d, measuredVariable: v })); setTechErrors((er) => ({ ...er, measuredVariable: undefined })); }} />

              <EditField id="pi-rangemin" label="Rango mín" value={sensorDraft.rangeMin}
                error={techErrors.rangeMin} wide
                onChange={(v) => { setSensorDraft((d) => ({ ...d, rangeMin: v })); setTechErrors((er) => ({ ...er, rangeMin: undefined })); }} />

              <EditField id="pi-rangemax" label="Rango máx" value={sensorDraft.rangeMax}
                error={techErrors.rangeMax} wide
                onChange={(v) => { setSensorDraft((d) => ({ ...d, rangeMax: v })); setTechErrors((er) => ({ ...er, rangeMax: undefined })); }} />

              <EditField id="pi-rangeunit" label="Unidad" value={sensorDraft.rangeUnit}
                inputMode="text" wide
                onChange={(v) => setSensorDraft((d) => ({ ...d, rangeUnit: v }))} />

              <EditField id="pi-supplyvoltage" label="Alim. (V)" value={sensorDraft.supplyVoltage}
                error={techErrors.supplyVoltage} wide
                onChange={(v) => { setSensorDraft((d) => ({ ...d, supplyVoltage: v })); setTechErrors((er) => ({ ...er, supplyVoltage: undefined })); }} />

              <SelectField id="pi-supplycurrenttype" label="Tipo AC/DC" value={sensorDraft.supplyCurrentType}
                error={techErrors.supplyCurrentType} wide
                onChange={(v) => { setSensorDraft((d) => ({ ...d, supplyCurrentType: v as SensorTechnicalDraft['supplyCurrentType'] })); setTechErrors((er) => ({ ...er, supplyCurrentType: undefined })); }}
                options={[
                  { value: '',   label: '—' },
                  { value: 'AC', label: 'AC' },
                  { value: 'DC', label: 'DC' },
                ]} />

              <SelectField id="pi-signal" label="Señal" value={sensorDraft.signal}
                error={techErrors.signal} wide
                onChange={(v) => { setSensorDraft((d) => ({ ...d, signal: v as SensorTechnicalDraft['signal'] })); setTechErrors((er) => ({ ...er, signal: undefined })); }}
                options={[
                  { value: '',       label: '—' },
                  { value: 'DI',     label: 'Digital (DI)' },
                  { value: '4_20mA', label: '4–20 mA' },
                  { value: '0_10V',  label: '0–10 V' },
                  { value: 'RTD',    label: 'RTD' },
                  { value: 'bus',    label: 'Bus de campo' },
                  { value: 'other',  label: 'Otro' },
                ]} />
            </div>
          )}

          {/* Datos técnicos del tablero eléctrico */}
          {element.category === 'electrical_panel' && (
            <div className="inspector-tech-section">
              <div className="inspector-section">Datos técnicos del tablero</div>

              <EditField id="pi-iprating" label="IP Rating" value={panelDraft.ipRating}
                inputMode="text" error={techErrors.ipRating} wide
                onChange={(v) => { setPanelDraft((d) => ({ ...d, ipRating: v })); setTechErrors((er) => ({ ...er, ipRating: undefined })); }} />

              <EditField id="pi-ratedcurrent" label="I nominal (A)" value={panelDraft.ratedCurrent}
                error={techErrors.ratedCurrent} wide
                onChange={(v) => { setPanelDraft((d) => ({ ...d, ratedCurrent: v })); setTechErrors((er) => ({ ...er, ratedCurrent: undefined })); }} />
            </div>
          )}

          {/* Conexiones */}
          <div className="inspector-section">Conexiones</div>
          <p className="inspector-hint" style={{ padding: '2px 12px 8px' }}>
            Sin conexiones registradas.
          </p>

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
