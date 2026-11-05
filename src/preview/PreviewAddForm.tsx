import { useState } from 'react';
import { createNewElement, type AddElementSpec, type CreatableCategory } from './previewCrud';
import type { EquipmentElement } from '../types/domain-v2';

interface Props {
  onCreated: (el: EquipmentElement) => void;
  onCancel: () => void;
}

type PlacementMode = 'unplaced' | 'placed';
type GeometryMode  = 'none' | 'box' | 'cylinder';

function parseNum(s: string): number | null {
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

function parsePositive(s: string): number | null {
  const n = parseNum(s);
  return n != null && n > 0 ? n : null;
}

function FormRow({
  id, label, value, onChange, error, inputMode = 'decimal',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <div className="inspector-edit-row inspector-edit-row--wide">
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
      </div>
    </div>
  );
}

export function PreviewAddForm({ onCreated, onCancel }: Props) {
  const [category,  setCategory]  = useState<CreatableCategory>('motor');
  const [name,      setName]      = useState('');
  const [placement, setPlacement] = useState<PlacementMode>('unplaced');
  const [posX, setPosX] = useState('0');
  const [posY, setPosY] = useState('0');
  const [posZ, setPosZ] = useState('0');
  const [geoMode, setGeoMode] = useState<GeometryMode>('none');
  const [boxW, setBoxW] = useState('400');
  const [boxD, setBoxD] = useState('400');
  const [boxH, setBoxH] = useState('400');
  const [cylDiam, setCylDiam] = useState('400');
  const [cylLen,  setCylLen]  = useState('600');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});

  function validate(): AddElementSpec | null {
    const errs: Record<string, string> = {};

    if (!name.trim()) errs.name = 'El nombre es obligatorio';

    let positionMm = { x: 0, y: 0, z: 0 };
    if (placement === 'placed') {
      const x = parseNum(posX), y = parseNum(posY), z = parseNum(posZ);
      if (x === null) errs.posX = 'Número inválido';
      if (y === null) errs.posY = 'Número inválido';
      if (z === null) errs.posZ = 'Número inválido';
      if (x !== null && y !== null && z !== null) positionMm = { x, y, z };
    }

    type GeoSpec = AddElementSpec['geometry'];
    let geometry: GeoSpec = null;
    if (geoMode === 'box') {
      const w = parsePositive(boxW), d = parsePositive(boxD), h = parsePositive(boxH);
      if (!w) errs.boxW = 'Debe ser un número positivo';
      if (!d) errs.boxD = 'Debe ser un número positivo';
      if (!h) errs.boxH = 'Debe ser un número positivo';
      if (w && d && h) geometry = { kind: 'box', widthMm: w, depthMm: d, heightMm: h };
    } else if (geoMode === 'cylinder') {
      const diam = parsePositive(cylDiam), len = parsePositive(cylLen);
      if (!diam) errs.cylDiam = 'Debe ser un número positivo';
      if (!len)  errs.cylLen  = 'Debe ser un número positivo';
      if (diam && len) geometry = { kind: 'cylinder', diameterMm: diam, lengthMm: len };
    }

    if (Object.keys(errs).length > 0) { setErrors(errs); return null; }
    setErrors({});

    return {
      category,
      name: name.trim(),
      placement:
        placement === 'unplaced'
          ? { placementStatus: 'unplaced' }
          : { placementStatus: 'placed', positionMm },
      geometry,
    };
  }

  function handleCreate() {
    const spec = validate();
    if (!spec) return;
    onCreated(createNewElement(spec));
  }

  return (
    <div className="preview-add-form">
      <div className="panel-title">Agregar equipo</div>
      <div className="inspector-content">

        <div className="inspector-section">Categoría</div>
        <div className="inspector-edit-row inspector-edit-row--wide">
          <label className="inspector-label" htmlFor="paf-cat">Tipo</label>
          <div className="inspector-input-wrap">
            <select
              id="paf-cat"
              className="inspector-input"
              value={category}
              onChange={(e) => setCategory(e.target.value as CreatableCategory)}
            >
              <option value="motor">Motor</option>
              <option value="sensor">Sensor</option>
              <option value="electrical_panel">Tablero Eléctrico</option>
            </select>
          </div>
        </div>

        <div className="inspector-section">Identificación</div>
        <div className="inspector-edit-row inspector-edit-row--wide">
          <label className="inspector-label" htmlFor="paf-name">Nombre *</label>
          <div className="inspector-input-wrap">
            <input
              id="paf-name"
              className={`inspector-input${errors.name ? ' inspector-input--error' : ''}`}
              inputMode="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((er) => ({ ...er, name: undefined })); }}
            />
            {errors.name && <span className="inspector-error">{errors.name}</span>}
          </div>
        </div>

        <div className="inspector-section">Ubicación</div>
        <div className="preview-add-radios">
          <label className="preview-add-radio">
            <input
              type="radio"
              name="paf-placement"
              value="unplaced"
              checked={placement === 'unplaced'}
              onChange={() => setPlacement('unplaced')}
            />
            Sin ubicar
          </label>
          <label className="preview-add-radio">
            <input
              type="radio"
              name="paf-placement"
              value="placed"
              checked={placement === 'placed'}
              onChange={() => setPlacement('placed')}
            />
            Posición conocida (mm)
          </label>
        </div>
        {placement === 'placed' && (
          <>
            <FormRow id="paf-x" label="X (mm)" value={posX} onChange={setPosX} error={errors.posX} />
            <FormRow id="paf-y" label="Y (mm)" value={posY} onChange={setPosY} error={errors.posY} />
            <FormRow id="paf-z" label="Z (mm)" value={posZ} onChange={setPosZ} error={errors.posZ} />
          </>
        )}

        <div className="inspector-section">Geometría</div>
        <div className="inspector-edit-row inspector-edit-row--wide">
          <label className="inspector-label" htmlFor="paf-geo">Forma</label>
          <div className="inspector-input-wrap">
            <select
              id="paf-geo"
              className="inspector-input"
              value={geoMode}
              onChange={(e) => setGeoMode(e.target.value as GeometryMode)}
            >
              <option value="none">Desconocida</option>
              <option value="box">Caja (box)</option>
              <option value="cylinder">Cilindro</option>
            </select>
          </div>
        </div>
        {geoMode === 'box' && (
          <>
            <FormRow id="paf-bw" label="Ancho (mm)" value={boxW} onChange={setBoxW} error={errors.boxW} />
            <FormRow id="paf-bd" label="Prof (mm)"  value={boxD} onChange={setBoxD} error={errors.boxD} />
            <FormRow id="paf-bh" label="Alto (mm)"  value={boxH} onChange={setBoxH} error={errors.boxH} />
          </>
        )}
        {geoMode === 'cylinder' && (
          <>
            <FormRow id="paf-cd" label="Diám (mm)"  value={cylDiam} onChange={setCylDiam} error={errors.cylDiam} />
            <FormRow id="paf-cl" label="Long (mm)"  value={cylLen}  onChange={setCylLen}  error={errors.cylLen} />
          </>
        )}

        <div className="inspector-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn-primary"   onClick={handleCreate}>Crear</button>
        </div>
      </div>
    </div>
  );
}
