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
import type { Category, EquipmentElement, TechnicalByCategory, Vec3 } from '../types/domain-v2';

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

// ─── Subcomponentes básicos de entrada ────────────────────────────────────────

interface EditFieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  hint?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  wide?: boolean;
  datumStatus?: string;
}

function EditField({ id, label, value, error, onChange, hint, inputMode = 'numeric', wide, datumStatus }: EditFieldProps) {
  const statusNote =
    datumStatus === 'estimated' ? 'estimado'
    : datumStatus === 'verified' ? 'verificado — al modificar pasará a "proporcionado"'
    : null;
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
        {!error && statusNote && (
          <span className={`inspector-hint datum-status--${datumStatus}`}>{statusNote}</span>
        )}
        {!error && hint && !statusNote && <span className="inspector-hint">{hint}</span>}
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
  datumStatus?: string;
}

function SelectField({ id, label, value, onChange, options, error, wide, datumStatus }: SelectFieldProps) {
  const statusNote =
    datumStatus === 'estimated' ? 'estimado'
    : datumStatus === 'verified' ? 'verificado — al modificar pasará a "proporcionado"'
    : null;
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
        {!error && statusNote && (
          <span className={`inspector-hint datum-status--${datumStatus}`}>{statusNote}</span>
        )}
      </div>
    </div>
  );
}

function ConflictField({ label, displayValue }: { label: string; displayValue: string }) {
  return (
    <div className="inspector-edit-row inspector-edit-row--wide">
      <span className="inspector-label">{label}</span>
      <div className="inspector-input-wrap">
        <span className="inspector-value">{displayValue}</span>
        <span className="inspector-hint datum-status--conflict">
          ⚠ Conflicto — solo lectura. Revisá las fuentes para resolver.
        </span>
      </div>
    </div>
  );
}

// ─── Secciones técnicas por categoría ─────────────────────────────────────────

interface MotorTechSectionProps {
  tech: TechnicalByCategory['motor'];
  draft: MotorTechnicalDraft;
  errors: TechDraftErrors;
  setDraft: React.Dispatch<React.SetStateAction<MotorTechnicalDraft>>;
  setErrors: React.Dispatch<React.SetStateAction<TechDraftErrors>>;
}

function MotorTechSection({ tech, draft, errors, setDraft, setErrors }: MotorTechSectionProps) {
  return (
    <div className="inspector-tech-section">
      <div className="inspector-section">Datos técnicos del motor</div>

      {tech.power.status === 'conflict' ? (
        <ConflictField
          label="Potencia"
          displayValue={tech.power.value != null
            ? `${tech.power.value.value} ${tech.power.value.unit}` : '—'}
        />
      ) : (
        <div className="inspector-edit-row inspector-edit-row--wide">
          <label className="inspector-label" htmlFor="pi-power">Potencia</label>
          <div className="inspector-input-wrap">
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                id="pi-power"
                className={`inspector-input${errors.power ? ' inspector-input--error' : ''}`}
                value={draft.power}
                inputMode="decimal"
                style={{ flex: 1 }}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, power: e.target.value }));
                  setErrors((er) => ({ ...er, power: undefined }));
                }}
              />
              <select
                aria-label="Unidad de potencia"
                className="inspector-input"
                value={draft.powerUnit}
                style={{ width: 50, flexShrink: 0 }}
                onChange={(e) => setDraft((d) => ({ ...d, powerUnit: e.target.value as 'kW' | 'HP' }))}
              >
                <option value="kW">kW</option>
                <option value="HP">HP</option>
              </select>
            </div>
            {errors.power && <span className="inspector-error">{errors.power}</span>}
            {!errors.power && tech.power.status === 'estimated' && (
              <span className="inspector-hint datum-status--estimated">estimado</span>
            )}
            {!errors.power && tech.power.status === 'verified' && (
              <span className="inspector-hint datum-status--verified">verificado — al modificar pasará a "proporcionado"</span>
            )}
          </div>
        </div>
      )}

      {tech.voltage.status === 'conflict' ? (
        <ConflictField
          label="Tensión (V)"
          displayValue={tech.voltage.value != null ? `${tech.voltage.value.value} V` : '—'}
        />
      ) : (
        <EditField id="pi-voltage" label="Tensión (V)" value={draft.voltage}
          error={errors.voltage} wide datumStatus={tech.voltage.status}
          onChange={(v) => { setDraft((d) => ({ ...d, voltage: v })); setErrors((er) => ({ ...er, voltage: undefined })); }} />
      )}

      {tech.phases.status === 'conflict' ? (
        <ConflictField
          label="Fases"
          displayValue={tech.phases.value != null ? String(tech.phases.value) : '—'}
        />
      ) : (
        <SelectField id="pi-phases" label="Fases" value={draft.phases}
          error={errors.phases} wide datumStatus={tech.phases.status}
          onChange={(v) => { setDraft((d) => ({ ...d, phases: v as MotorTechnicalDraft['phases'] })); setErrors((er) => ({ ...er, phases: undefined })); }}
          options={[
            { value: '', label: '—' },
            { value: '1', label: 'Monofásico (1)' },
            { value: '3', label: 'Trifásico (3)' },
          ]} />
      )}

      {tech.plateCurrent.status === 'conflict' ? (
        <ConflictField
          label="Corriente (A)"
          displayValue={tech.plateCurrent.value != null ? `${tech.plateCurrent.value.value} A` : '—'}
        />
      ) : (
        <EditField id="pi-platecurrent" label="Corriente (A)" value={draft.plateCurrent}
          error={errors.plateCurrent} wide datumStatus={tech.plateCurrent.status}
          onChange={(v) => { setDraft((d) => ({ ...d, plateCurrent: v })); setErrors((er) => ({ ...er, plateCurrent: undefined })); }} />
      )}

      {tech.efficiency.status === 'conflict' ? (
        <ConflictField
          label="Eficiencia"
          displayValue={tech.efficiency.value != null ? String(tech.efficiency.value) : '—'}
        />
      ) : (
        <EditField id="pi-efficiency" label="Eficiencia" value={draft.efficiency}
          error={errors.efficiency} hint="0 < η ≤ 1" wide datumStatus={tech.efficiency.status}
          onChange={(v) => { setDraft((d) => ({ ...d, efficiency: v })); setErrors((er) => ({ ...er, efficiency: undefined })); }} />
      )}

      {tech.powerFactor.status === 'conflict' ? (
        <ConflictField
          label="Cos φ"
          displayValue={tech.powerFactor.value != null ? String(tech.powerFactor.value) : '—'}
        />
      ) : (
        <EditField id="pi-powerfactor" label="Cos φ" value={draft.powerFactor}
          error={errors.powerFactor} hint="0 < cosφ ≤ 1" wide datumStatus={tech.powerFactor.status}
          onChange={(v) => { setDraft((d) => ({ ...d, powerFactor: v })); setErrors((er) => ({ ...er, powerFactor: undefined })); }} />
      )}

      {tech.start.status === 'conflict' ? (
        <ConflictField
          label="Arranque"
          displayValue={tech.start.value ?? '—'}
        />
      ) : (
        <SelectField id="pi-start" label="Arranque" value={draft.start}
          error={errors.start} wide datumStatus={tech.start.status}
          onChange={(v) => { setDraft((d) => ({ ...d, start: v as MotorTechnicalDraft['start'] })); setErrors((er) => ({ ...er, start: undefined })); }}
          options={[
            { value: '',            label: '—' },
            { value: 'direct',      label: 'Directo' },
            { value: 'star_delta',  label: 'Estrella-triángulo' },
            { value: 'softstarter', label: 'Softstarter' },
            { value: 'vfd',         label: 'Variador de frecuencia (VFD)' },
            { value: 'other',       label: 'Otro' },
          ]} />
      )}
    </div>
  );
}

interface SensorTechSectionProps {
  tech: TechnicalByCategory['sensor'];
  draft: SensorTechnicalDraft;
  errors: TechDraftErrors;
  setDraft: React.Dispatch<React.SetStateAction<SensorTechnicalDraft>>;
  setErrors: React.Dispatch<React.SetStateAction<TechDraftErrors>>;
}

function SensorTechSection({ tech, draft, errors, setDraft, setErrors }: SensorTechSectionProps) {
  return (
    <div className="inspector-tech-section">
      <div className="inspector-section">Datos técnicos del sensor</div>

      {tech.measuredVariable.status === 'conflict' ? (
        <ConflictField label="Variable" displayValue={tech.measuredVariable.value ?? '—'} />
      ) : (
        <EditField id="pi-measvar" label="Variable" value={draft.measuredVariable}
          inputMode="text" error={errors.measuredVariable} wide datumStatus={tech.measuredVariable.status}
          onChange={(v) => { setDraft((d) => ({ ...d, measuredVariable: v })); setErrors((er) => ({ ...er, measuredVariable: undefined })); }} />
      )}

      {tech.range.status === 'conflict' ? (
        <ConflictField
          label="Rango"
          displayValue={tech.range.value != null
            ? `${tech.range.value.min}..${tech.range.value.max} ${tech.range.value.unit}` : '—'}
        />
      ) : (
        <>
          <EditField id="pi-rangemin" label="Rango mín" value={draft.rangeMin}
            error={errors.rangeMin} wide datumStatus={tech.range.status === 'estimated' || tech.range.status === 'verified' ? tech.range.status : undefined}
            onChange={(v) => { setDraft((d) => ({ ...d, rangeMin: v })); setErrors((er) => ({ ...er, rangeMin: undefined })); }} />
          <EditField id="pi-rangemax" label="Rango máx" value={draft.rangeMax}
            error={errors.rangeMax} wide
            onChange={(v) => { setDraft((d) => ({ ...d, rangeMax: v })); setErrors((er) => ({ ...er, rangeMax: undefined })); }} />
          <EditField id="pi-rangeunit" label="Unidad" value={draft.rangeUnit}
            inputMode="text" wide
            onChange={(v) => setDraft((d) => ({ ...d, rangeUnit: v }))} />
        </>
      )}

      {tech.supply.status === 'conflict' ? (
        <ConflictField
          label="Alimentación"
          displayValue={tech.supply.value != null
            ? `${tech.supply.value.voltageV} V ${tech.supply.value.currentType}` : '—'}
        />
      ) : (
        <>
          <EditField id="pi-supplyvoltage" label="Alim. (V)" value={draft.supplyVoltage}
            error={errors.supplyVoltage} wide datumStatus={tech.supply.status === 'estimated' || tech.supply.status === 'verified' ? tech.supply.status : undefined}
            onChange={(v) => { setDraft((d) => ({ ...d, supplyVoltage: v })); setErrors((er) => ({ ...er, supplyVoltage: undefined })); }} />
          <SelectField id="pi-supplycurrenttype" label="Tipo AC/DC" value={draft.supplyCurrentType}
            error={errors.supplyCurrentType} wide
            onChange={(v) => { setDraft((d) => ({ ...d, supplyCurrentType: v as SensorTechnicalDraft['supplyCurrentType'] })); setErrors((er) => ({ ...er, supplyCurrentType: undefined })); }}
            options={[
              { value: '',   label: '—' },
              { value: 'AC', label: 'AC' },
              { value: 'DC', label: 'DC' },
            ]} />
        </>
      )}

      {tech.signal.status === 'conflict' ? (
        <ConflictField label="Señal" displayValue={tech.signal.value ?? '—'} />
      ) : (
        <SelectField id="pi-signal" label="Señal" value={draft.signal}
          error={errors.signal} wide datumStatus={tech.signal.status}
          onChange={(v) => { setDraft((d) => ({ ...d, signal: v as SensorTechnicalDraft['signal'] })); setErrors((er) => ({ ...er, signal: undefined })); }}
          options={[
            { value: '',       label: '—' },
            { value: 'DI',     label: 'Digital (DI)' },
            { value: '4_20mA', label: '4–20 mA' },
            { value: '0_10V',  label: '0–10 V' },
            { value: 'RTD',    label: 'RTD' },
            { value: 'bus',    label: 'Bus de campo' },
            { value: 'other',  label: 'Otro' },
          ]} />
      )}
    </div>
  );
}

interface PanelTechSectionProps {
  tech: TechnicalByCategory['electrical_panel'];
  draft: PanelTechnicalDraft;
  errors: TechDraftErrors;
  setDraft: React.Dispatch<React.SetStateAction<PanelTechnicalDraft>>;
  setErrors: React.Dispatch<React.SetStateAction<TechDraftErrors>>;
}

function PanelTechSection({ tech, draft, errors, setDraft, setErrors }: PanelTechSectionProps) {
  return (
    <div className="inspector-tech-section">
      <div className="inspector-section">Datos técnicos del tablero</div>

      {tech.ipRating.status === 'conflict' ? (
        <ConflictField label="IP Rating" displayValue={tech.ipRating.value ?? '—'} />
      ) : (
        <EditField id="pi-iprating" label="IP Rating" value={draft.ipRating}
          inputMode="text" error={errors.ipRating} wide datumStatus={tech.ipRating.status}
          onChange={(v) => { setDraft((d) => ({ ...d, ipRating: v })); setErrors((er) => ({ ...er, ipRating: undefined })); }} />
      )}

      {tech.ratedCurrent.status === 'conflict' ? (
        <ConflictField
          label="I nominal (A)"
          displayValue={tech.ratedCurrent.value != null ? `${tech.ratedCurrent.value.value} A` : '—'}
        />
      ) : (
        <EditField id="pi-ratedcurrent" label="I nominal (A)" value={draft.ratedCurrent}
          error={errors.ratedCurrent} wide datumStatus={tech.ratedCurrent.status}
          onChange={(v) => { setDraft((d) => ({ ...d, ratedCurrent: v })); setErrors((er) => ({ ...er, ratedCurrent: undefined })); }} />
      )}
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

  // ── Sync draft desde un elemento ─────────────────────────────────────────

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

    // Propagar todos los errores (mostrar todos a la vez)
    setNameError(nameResult.ok ? undefined : nameResult.error);
    setPosErrors(posResult.ok  ? {}        : posResult.errors);
    if (boxResult) setBoxErrors(boxResult.ok ? {} : boxResult.errors);
    if (cylResult) setCylErrors(cylResult.ok ? {} : cylResult.errors);
    setTechErrors(techResult && !techResult.ok ? techResult.errors : {});

    const sizeOk = (boxResult == null || boxResult.ok) && (cylResult == null || cylResult.ok);
    const techOk = techResult == null || techResult.ok;
    if (!nameResult.ok || !posResult.ok || !sizeOk || !techOk) return;

    const parentTransform = element.parentId != null
      ? resolveGlobalTransform(element.parentId, elements)
      : null;

    let updated = applyPositionEdit(element, posResult.value as Vec3, parentTransform);

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

    updated = applyNameEdit(updated, nameResult.value);

    if (techResult?.ok) {
      updated = {
        ...updated,
        technical: techResult.element.technical,
        manufacturer: techResult.element.manufacturer,
        model: techResult.element.model,
      } as EquipmentElement;
      for (const ev of techResult.newEvidence) addEvidence(ev);
    }

    const posChanged  = (
      updated.transform?.positionMm.x !== element.transform?.positionMm.x ||
      updated.transform?.positionMm.y !== element.transform?.positionMm.y ||
      updated.transform?.positionMm.z !== element.transform?.positionMm.z
    );
    const geoChanged   = JSON.stringify(updated.geometry)     !== JSON.stringify(element.geometry);
    const nameChanged  = updated.name                         !== element.name;
    const techChanged  = JSON.stringify(updated.technical)    !== JSON.stringify(element.technical);
    const mfgChanged   = JSON.stringify(updated.manufacturer) !== JSON.stringify(element.manufacturer);
    const modelChanged = JSON.stringify(updated.model)        !== JSON.stringify(element.model);

    if (posChanged || geoChanged || nameChanged || techChanged || mfgChanged || modelChanged) {
      updated = { ...updated, version: element.version + 1 } as EquipmentElement;
    }

    updateElement(updated);

    if (childDeltaZ !== 0) {
      for (const child of elements.filter((e) => e.parentId === element.id)) {
        updateElement(adjustChildLocalZ(child, childDeltaZ));
      }
    }

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

          {/* Posición global */}
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
          {((element.geometry?.kind === 'box' && element.category === 'electrical_panel') ||
            element.geometry?.kind === 'cylinder') && (
            <div className="inspector-section">Dimensiones (mm)</div>
          )}

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

          {element.manufacturer.status === 'conflict' ? (
            <ConflictField label="Fabricante" displayValue={element.manufacturer.value ?? '—'} />
          ) : (
            <EditField id="pi-manufacturer" label="Fabricante" value={commonDraft.manufacturer}
              inputMode="text" wide datumStatus={element.manufacturer.status}
              onChange={(v) => setCommonDraft((d) => ({ ...d, manufacturer: v }))} />
          )}

          {element.model.status === 'conflict' ? (
            <ConflictField label="Modelo" displayValue={element.model.value ?? '—'} />
          ) : (
            <EditField id="pi-model" label="Modelo" value={commonDraft.model}
              inputMode="text" wide datumStatus={element.model.status}
              onChange={(v) => setCommonDraft((d) => ({ ...d, model: v }))} />
          )}

          {/* Secciones técnicas por categoría */}
          {element.category === 'motor' && (
            <MotorTechSection
              tech={element.technical}
              draft={motorDraft} errors={techErrors}
              setDraft={setMotorDraft} setErrors={setTechErrors}
            />
          )}
          {element.category === 'sensor' && (
            <SensorTechSection
              tech={element.technical}
              draft={sensorDraft} errors={techErrors}
              setDraft={setSensorDraft} setErrors={setTechErrors}
            />
          )}
          {element.category === 'electrical_panel' && (
            <PanelTechSection
              tech={element.technical}
              draft={panelDraft} errors={techErrors}
              setDraft={setPanelDraft} setErrors={setTechErrors}
            />
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
        // ── Vista de solo lectura ──────────────────────────────────────────
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
