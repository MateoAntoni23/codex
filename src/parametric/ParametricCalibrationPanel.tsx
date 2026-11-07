/**
 * ParametricCalibrationPanel — ajustes manuales del mesh (modo A).
 *
 * Expone traslación XYZ (mm) y rotación Euler (°), con botones ±90° por eje.
 * El edit ocurre sobre `preview` del store, para que el Canvas muestre la
 * calibración en vivo sin tocar lo persistido. Apply guarda; Cancel descarta;
 * Reset borra la calibración de la clave activa.
 *
 * Importante: esta calibración sólo mueve la malla visible; las bocas, ejes
 * y recorrido no se ven afectados (ver ParametricScene.AlignedGlb).
 */

import { useEffect, useRef, useState } from 'react';
import { useParametricStore, findEntry } from './useParametricStore';
import {
  useCalibrationStore,
  calibrationKey,
  isStale,
  type Calibration,
} from './useCalibrationStore';

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function ParametricCalibrationPanel() {
  const recipe = useParametricStore((s) => s.recipe);
  const view = useParametricStore((s) => s.view);
  const entry = findEntry(recipe);
  const activeKey = calibrationKey(recipe, view);

  const stored = useCalibrationStore((s) => s.calibrations[activeKey]);
  const preview = useCalibrationStore((s) => s.preview);
  const beginPreview = useCalibrationStore((s) => s.beginPreview);
  const updatePreview = useCalibrationStore((s) => s.updatePreview);
  const applyPreview = useCalibrationStore((s) => s.applyPreview);
  const cancelPreview = useCalibrationStore((s) => s.cancelPreview);
  const resetCalibration = useCalibrationStore((s) => s.resetCalibration);

  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editing = open && preview?.key === activeKey;
  const current: Calibration | undefined = editing ? preview!.value : stored;

  // Si el usuario cambia de pieza/vista mientras el panel está abierto,
  // cancelamos el preview pendiente para no arrastrarlo a otra clave.
  useEffect(() => {
    if (open && preview && preview.key !== activeKey) {
      cancelPreview();
      setOpen(false);
    }
  }, [open, preview, activeKey, cancelPreview]);

  const stale = isStale(stored, entry.source_version);

  function handleOpen() {
    beginPreview(activeKey, entry.source_version);
    setOpen(true);
  }

  function handleCancel() {
    cancelPreview();
    setOpen(false);
  }

  function handleApply() {
    applyPreview();
    setOpen(false);
  }

  function handleReset() {
    resetCalibration(activeKey);
    setOpen(false);
  }

  function setField(field: keyof Calibration, value: number) {
    if (!editing) return;
    updatePreview({ [field]: value } as Partial<Calibration>);
  }

  function nudgeRotation(axis: Axis, delta: number) {
    if (!editing) return;
    const key = (`r${axis}_deg`) as 'rx_deg' | 'ry_deg' | 'rz_deg';
    const curr = preview!.value[key];
    const next = roundTo(curr + delta, 2);
    updatePreview({ [key]: next } as Partial<Calibration>);
  }

  function handleExport() {
    const dump = useCalibrationStore.getState().exportAll();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parametric-calibrations-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const n = useCalibrationStore.getState().importAll(parsed);
      window.alert(`Importadas ${n} calibraciones.`);
    } catch (err) {
      window.alert(`Error al importar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section style={{ padding: 12, borderBottom: '1px solid #2a2a44' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h4 style={{ fontSize: 10, letterSpacing: '0.08em', color: '#8899bb', margin: 0 }}>
          CALIBRAR MODELO (modo A — sólo malla)
        </h4>
        {stale && (
          <span
            title="La calibración se afinó con un GLB de otra versión; revísala."
            style={{
              fontSize: 10,
              color: '#111',
              background: '#eebb66',
              padding: '1px 6px',
              borderRadius: 3,
              fontWeight: 700,
            }}
          >
            revisar
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#99aacc', marginBottom: 8, lineHeight: 1.4 }}>
        Clave: <code style={{ fontFamily: 'monospace' }}>{activeKey}</code>
        {stored && (
          <>
            {' · '}
            <span style={{ color: '#aadd88' }}>guardada</span>
            {stored.updated_at && ` (${stored.updated_at.slice(0, 16).replace('T', ' ')})`}
          </>
        )}
        {!stored && !editing && <span style={{ color: '#7788aa' }}> · sin calibración</span>}
      </div>

      {!editing ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={handleOpen}>
            {stored ? 'Editar calibración' : 'Calibrar modelo'}
          </button>
          {stored && (
            <button type="button" className="btn-secondary" onClick={handleReset}>
              Quitar
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={handleExport} title="Descargar todas las calibraciones">
            Exportar
          </button>
          <button type="button" className="btn-secondary" onClick={handleImportClick} title="Importar JSON (fusión)">
            Importar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 56px', gap: 4, alignItems: 'center' }}>
            <div style={{ fontSize: 10, color: '#8899bb', gridColumn: '1 / -1', marginTop: 4 }}>Traslación (mm)</div>
            {AXES.map((ax) => {
              const key = (`t${ax}_mm`) as 'tx_mm' | 'ty_mm' | 'tz_mm';
              const value = current?.[key] ?? 0;
              return (
                <RowNumber
                  key={key}
                  label={ax.toUpperCase()}
                  value={value}
                  step={1}
                  onChange={(v) => setField(key, v)}
                />
              );
            })}

            <div style={{ fontSize: 10, color: '#8899bb', gridColumn: '1 / -1', marginTop: 8 }}>Rotación Euler (°)</div>
            {AXES.map((ax) => {
              const key = (`r${ax}_deg`) as 'rx_deg' | 'ry_deg' | 'rz_deg';
              const value = current?.[key] ?? 0;
              return (
                <RowRotation
                  key={key}
                  label={ax.toUpperCase()}
                  value={value}
                  onChange={(v) => setField(key, v)}
                  onNudge={(d) => nudgeRotation(ax, d)}
                />
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={handleApply}>
              Aplicar
            </button>
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              Cancelar
            </button>
            <button type="button" className="btn-secondary" onClick={handleReset}>
              Reset
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#7788aa', marginTop: 6, lineHeight: 1.4 }}>
            La vista 3D muestra el ajuste en vivo. No se modifican bocas ni recorrido.
          </div>
        </>
      )}
    </section>
  );
}

function RowNumber({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange(v: number): void;
}) {
  return (
    <>
      <div style={{ fontSize: 11, color: '#99aacc', fontFamily: 'monospace' }}>{label}</div>
      <input
        type="number"
        value={roundTo(value, 3)}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={inputStyle}
      />
      <div style={{ fontSize: 10, color: '#7788aa', textAlign: 'right' }}>mm</div>
    </>
  );
}

function RowRotation({
  label,
  value,
  onChange,
  onNudge,
}: {
  label: string;
  value: number;
  onChange(v: number): void;
  onNudge(delta: number): void;
}) {
  return (
    <>
      <div style={{ fontSize: 11, color: '#99aacc', fontFamily: 'monospace' }}>{label}</div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <button type="button" className="btn-secondary" style={smallBtn} onClick={() => onNudge(-90)} title="−90°">
          −90
        </button>
        <input
          type="number"
          value={roundTo(value, 3)}
          step={1}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" className="btn-secondary" style={smallBtn} onClick={() => onNudge(90)} title="+90°">
          +90
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#7788aa', textAlign: 'right' }}>deg</div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '3px 6px',
  background: '#0f1024',
  color: '#e0e0f0',
  border: '1px solid #2a2a44',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 12,
};

const smallBtn: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 10,
  minWidth: 32,
};
