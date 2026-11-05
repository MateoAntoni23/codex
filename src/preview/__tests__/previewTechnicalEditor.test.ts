// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { usePreviewStore } from '../usePreviewStore';
import { PREVIEW_ELEMENTS } from '../previewData';
import {
  syncMotorDraft, syncSensorDraft, syncPanelDraft,
  applyMotorTechnicalDraft, applySensorTechnicalDraft, applyPanelTechnicalDraft,
  isElementInclined, createManualEvidence,
  type MotorTechnicalDraft, type CommonTechnicalDraft, type SensorTechnicalDraft,
} from '../technicalEditor';
import { PreviewInspector } from '../PreviewInspector';
import { IDENTITY_QUATERNION } from '../../types/domain-v2';

beforeEach(() => {
  usePreviewStore.getState().resetElements();
});

// ─── syncMotorDraft ───────────────────────────────────────────────────────────

describe('syncMotorDraft', () => {
  it('motor con todo desconocido → campos vacíos', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    if (motor.category !== 'motor') return;
    const draft = syncMotorDraft(motor.technical);
    expect(draft.power).toBe('');
    expect(draft.powerUnit).toBe('kW');
    expect(draft.voltage).toBe('');
    expect(draft.phases).toBe('');
    expect(draft.plateCurrent).toBe('');
    expect(draft.efficiency).toBe('');
    expect(draft.powerFactor).toBe('');
    expect(draft.start).toBe('');
  });
});

// ─── syncSensorDraft ──────────────────────────────────────────────────────────

describe('syncSensorDraft', () => {
  it('sensor-flow-1 con datos ficticios → campos poblados', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (sensor.category !== 'sensor') return;
    const draft = syncSensorDraft(sensor.technical);
    expect(draft.measuredVariable).toBe('[demo] Caudal volumétrico de agua');
    expect(draft.rangeMin).toBe('0');
    expect(draft.rangeMax).toBe('100');
    expect(draft.rangeUnit).toBe('m3/h');
    expect(draft.supplyVoltage).toBe('24');
    expect(draft.supplyCurrentType).toBe('DC');
    expect(draft.signal).toBe('4_20mA');
  });

  it('sensor sin datos → campos vacíos', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-nogeo-1')!;
    if (sensor.category !== 'sensor') return;
    const draft = syncSensorDraft(sensor.technical);
    expect(draft.measuredVariable).toBe('');
    expect(draft.rangeMin).toBe('');
    expect(draft.rangeMax).toBe('');
    expect(draft.signal).toBe('');
  });
});

// ─── syncPanelDraft ───────────────────────────────────────────────────────────

describe('syncPanelDraft', () => {
  it('tablero con todo desconocido → campos vacíos', () => {
    const panel = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    if (panel.category !== 'electrical_panel') return;
    const draft = syncPanelDraft(panel.technical);
    expect(draft.ipRating).toBe('');
    expect(draft.ratedCurrent).toBe('');
  });
});

// ─── applyMotorTechnicalDraft ─────────────────────────────────────────────────

describe('applyMotorTechnicalDraft — válido', () => {
  it('draft con potencia y tensión → ok:true con valores correctos', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const common: CommonTechnicalDraft = { manufacturer: 'ABB', model: 'M2AA 132' };
    const draft: MotorTechnicalDraft = {
      power: '5.5', powerUnit: 'kW', voltage: '380',
      phases: '3', plateCurrent: '12', efficiency: '0.9',
      powerFactor: '0.85', start: 'direct',
    };
    const result = applyMotorTechnicalDraft(motor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.element.category !== 'motor') return;
    expect(result.element.technical.power.value?.value).toBeCloseTo(5.5);
    expect(result.element.technical.power.value?.unit).toBe('kW');
    expect(result.element.technical.voltage.value?.value).toBeCloseTo(380);
    expect(result.element.technical.phases.value).toBe(3);
    expect(result.element.technical.efficiency.value).toBeCloseTo(0.9);
    expect(result.element.manufacturer.value).toBe('ABB');
    expect(result.newEvidence.length).toBeGreaterThan(0);
  });

  it('HP draft → guarda con unidad HP sin conversión', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: MotorTechnicalDraft = {
      power: '7.5', powerUnit: 'HP', voltage: '', phases: '',
      plateCurrent: '', efficiency: '', powerFactor: '', start: '',
    };
    const result = applyMotorTechnicalDraft(motor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.element.category !== 'motor') return;
    expect(result.element.technical.power.value?.value).toBeCloseTo(7.5);
    expect(result.element.technical.power.value?.unit).toBe('HP');
  });

  it('sin cambios respecto al estado original → newEvidence vacío', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (sensor.category !== 'sensor') return;
    const common: CommonTechnicalDraft = {
      manufacturer: sensor.manufacturer.value ?? '',
      model: sensor.model.value ?? '',
    };
    const draft: SensorTechnicalDraft = {
      measuredVariable: sensor.technical.measuredVariable.value ?? '',
      rangeMin: '0', rangeMax: '100', rangeUnit: 'm3/h',
      supplyVoltage: '24', supplyCurrentType: 'DC', signal: '4_20mA',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newEvidence).toHaveLength(0);
  });
});

describe('applyMotorTechnicalDraft — validaciones', () => {
  it('eficiencia > 1 → error', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: MotorTechnicalDraft = {
      power: '', powerUnit: 'kW', voltage: '', phases: '',
      plateCurrent: '', efficiency: '1.5', powerFactor: '', start: '',
    };
    const result = applyMotorTechnicalDraft(motor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.efficiency).toBeTruthy();
  });

  it('eficiencia cero → error (exclusivo cero)', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: MotorTechnicalDraft = {
      power: '', powerUnit: 'kW', voltage: '', phases: '',
      plateCurrent: '', efficiency: '0', powerFactor: '', start: '',
    };
    const result = applyMotorTechnicalDraft(motor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.efficiency).toBeTruthy();
  });

  it('tensión negativa → error', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: MotorTechnicalDraft = {
      power: '', powerUnit: 'kW', voltage: '-10', phases: '',
      plateCurrent: '', efficiency: '', powerFactor: '', start: '',
    };
    const result = applyMotorTechnicalDraft(motor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.voltage).toBeTruthy();
  });
});

// ─── applySensorTechnicalDraft ────────────────────────────────────────────────

describe('applySensorTechnicalDraft — válido', () => {
  it('variable medida y señal → ok:true', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-nogeo-1')!;
    const common: CommonTechnicalDraft = { manufacturer: 'Siemens', model: '' };
    const draft: SensorTechnicalDraft = {
      measuredVariable: 'Presión de proceso',
      rangeMin: '0', rangeMax: '10', rangeUnit: 'bar',
      supplyVoltage: '24', supplyCurrentType: 'DC', signal: '4_20mA',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.element.category !== 'sensor') return;
    expect(result.element.technical.measuredVariable.value).toBe('Presión de proceso');
    expect(result.element.technical.range.value?.min).toBe(0);
    expect(result.element.technical.range.value?.max).toBe(10);
    expect(result.element.technical.range.value?.unit).toBe('bar');
    expect(result.element.technical.signal.value).toBe('4_20mA');
    expect(result.element.manufacturer.value).toBe('Siemens');
  });
});

describe('applySensorTechnicalDraft — validaciones', () => {
  it('rango con solo mínimo → error en rangeMax', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: SensorTechnicalDraft = {
      measuredVariable: 'Presión', rangeMin: '0', rangeMax: '', rangeUnit: 'bar',
      supplyVoltage: '24', supplyCurrentType: 'DC', signal: '4_20mA',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.rangeMax).toBeTruthy();
  });

  it('rango con solo máximo → error en rangeMin', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: SensorTechnicalDraft = {
      measuredVariable: 'Presión', rangeMin: '', rangeMax: '100', rangeUnit: 'bar',
      supplyVoltage: '', supplyCurrentType: '', signal: '',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.rangeMin).toBeTruthy();
  });

  it('mínimo >= máximo → error en rangeMax', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: SensorTechnicalDraft = {
      measuredVariable: '', rangeMin: '100', rangeMax: '100', rangeUnit: 'bar',
      supplyVoltage: '', supplyCurrentType: '', signal: '',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.rangeMax).toBeTruthy();
  });

  it('tensión de alimentación sin tipo → error en supplyCurrentType', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: SensorTechnicalDraft = {
      measuredVariable: '', rangeMin: '', rangeMax: '', rangeUnit: '',
      supplyVoltage: '24', supplyCurrentType: '', signal: '',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.supplyCurrentType).toBeTruthy();
  });
});

// ─── applyPanelTechnicalDraft ─────────────────────────────────────────────────

describe('applyPanelTechnicalDraft', () => {
  it('draft válido → ok:true con IP rating y corriente nominal', () => {
    const panel = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const common: CommonTechnicalDraft = { manufacturer: 'Rittal', model: 'AE 1038' };
    const result = applyPanelTechnicalDraft(panel, { ipRating: 'IP65', ratedCurrent: '100' }, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.element.category !== 'electrical_panel') return;
    expect(result.element.technical.ipRating.value).toBe('IP65');
    expect(result.element.technical.ratedCurrent.value?.value).toBeCloseTo(100);
    expect(result.element.technical.ratedCurrent.value?.unit).toBe('A');
    expect(result.element.manufacturer.value).toBe('Rittal');
  });

  it('corriente negativa → error', () => {
    const panel = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const result = applyPanelTechnicalDraft(panel, { ipRating: '', ratedCurrent: '-50' }, common);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.ratedCurrent).toBeTruthy();
  });
});

// ─── isElementInclined ────────────────────────────────────────────────────────

describe('isElementInclined', () => {
  it('rotación identidad → no inclinado', () => {
    expect(isElementInclined(IDENTITY_QUATERNION)).toBe(false);
  });

  it('45°Z → no inclinado (eje Z local sigue siendo +Z global)', () => {
    const SIN_PI8 = Math.sin(Math.PI / 8);
    const COS_PI8 = Math.cos(Math.PI / 8);
    expect(isElementInclined({ x: 0, y: 0, z: SIN_PI8, w: COS_PI8 })).toBe(false);
  });

  it('90°X → inclinado', () => {
    expect(isElementInclined({ x: Math.SQRT2 / 2, y: 0, z: 0, w: Math.SQRT2 / 2 })).toBe(true);
  });

  it('90°Y → inclinado', () => {
    expect(isElementInclined({ x: 0, y: Math.SQRT2 / 2, z: 0, w: Math.SQRT2 / 2 })).toBe(true);
  });
});

// ─── createManualEvidence ─────────────────────────────────────────────────────

describe('createManualEvidence', () => {
  it('devuelve evidencia con source="manual" y campos de archivo nulos', () => {
    const ev = createManualEvidence('motor-1', 'technical.power', '5.5');
    expect(ev.source).toBe('manual');
    expect(ev.elementOrConnectionId).toBe('motor-1');
    expect(ev.fieldPath).toBe('technical.power');
    expect(ev.rawValue).toBe('5.5');
    expect(ev.fileChecksum).toBeNull();
    expect(ev.sheet).toBeNull();
    expect(ev.row).toBeNull();
    expect(ev.cell).toBeNull();
    expect(ev.formula).toBeNull();
    expect(ev.author).toBeNull();
    expect(ev.id).toContain('motor-1');
  });

  it('id incluye fieldPath sanitizado (puntos → guiones bajos)', () => {
    const ev = createManualEvidence('panel-1', 'technical.ipRating', 'IP65');
    expect(ev.id).toContain('technical_ipRating');
  });
});

// ─── Componente: motor ────────────────────────────────────────────────────────

describe('PreviewInspector — motor Apply potencia', () => {
  it('Apply con potencia válida actualiza technical en el store', async () => {
    usePreviewStore.getState().select('child-motor-1');
    render(React.createElement(PreviewInspector));

    const powerInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Potencia/i });
    await userEvent.clear(powerInput);
    await userEvent.type(powerInput, '11');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!;
    expect(updated.category).toBe('motor');
    if (updated.category !== 'motor') return;
    expect(updated.technical.power.value?.value).toBeCloseTo(11);
    expect(updated.technical.power.status).toBe('provided');
  });

  it('Apply incrementa version al cambiar potencia', async () => {
    const origVersion = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!.version;
    usePreviewStore.getState().select('child-motor-1');
    render(React.createElement(PreviewInspector));

    const powerInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Potencia/i });
    await userEvent.clear(powerInput);
    await userEvent.type(powerInput, '11');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!;
    expect(updated.version).toBeGreaterThan(origVersion);
  });
});

describe('PreviewInspector — motor HP/kW sin conversión silenciosa', () => {
  it('cambiar unidad a HP no modifica el valor numérico del borrador', async () => {
    usePreviewStore.getState().select('child-motor-1');
    render(React.createElement(PreviewInspector));

    const powerInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Potencia/i });
    await userEvent.clear(powerInput);
    await userEvent.type(powerInput, '15');

    const unitSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /unidad de potencia/i });
    await userEvent.selectOptions(unitSelect, 'HP');

    // Valor numérico no cambia — no hay conversión silenciosa
    expect(powerInput.value).toBe('15');
  });

  it('Apply con HP guarda unidad HP en el store', async () => {
    usePreviewStore.getState().select('child-motor-1');
    render(React.createElement(PreviewInspector));

    const powerInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Potencia/i });
    await userEvent.clear(powerInput);
    await userEvent.type(powerInput, '15');

    const unitSelect = screen.getByRole<HTMLSelectElement>('combobox', { name: /unidad de potencia/i });
    await userEvent.selectOptions(unitSelect, 'HP');

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!;
    expect(updated.category).toBe('motor');
    if (updated.category !== 'motor') return;
    expect(updated.technical.power.value?.value).toBeCloseTo(15);
    expect(updated.technical.power.value?.unit).toBe('HP');
  });
});

describe('PreviewInspector — motor Apply eficiencia inválida', () => {
  it('eficiencia > 1 muestra error y no guarda', async () => {
    usePreviewStore.getState().select('child-motor-1');
    const origTech = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!.technical;
    render(React.createElement(PreviewInspector));

    const effInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Eficiencia/i });
    await userEvent.clear(effInput);
    await userEvent.type(effInput, '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/Debe ser entre 0 y 1/i)).toBeTruthy();
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!;
    expect(JSON.stringify(el.technical)).toBe(JSON.stringify(origTech));
  });
});

// ─── Componente: sensor ───────────────────────────────────────────────────────

describe('PreviewInspector — sensor Apply variable medida', () => {
  it('Apply con measuredVariable actualiza technical', async () => {
    usePreviewStore.getState().select('sensor-flow-1');
    render(React.createElement(PreviewInspector));

    const varInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Variable/i });
    await userEvent.clear(varInput);
    await userEvent.type(varInput, 'Presión diferencial');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'sensor-flow-1')!;
    if (updated.category !== 'sensor') return;
    expect(updated.technical.measuredVariable.value).toBe('Presión diferencial');
    expect(updated.technical.measuredVariable.status).toBe('provided');
  });
});

describe('PreviewInspector — sensor rango parcial muestra error', () => {
  it('limpiar rangeMax y aplicar → error de rango parcial', async () => {
    usePreviewStore.getState().select('sensor-flow-1');
    render(React.createElement(PreviewInspector));

    const maxInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Rango máx/i });
    await userEvent.clear(maxInput);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/Ingresá mínimo y máximo juntos/i)).toBeTruthy();
    // Store no debe haber cambiado
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'sensor-flow-1')!;
    if (el.category !== 'sensor') return;
    expect(el.technical.range.value?.max).toBe(100);
  });
});

// ─── Componente: tablero ──────────────────────────────────────────────────────

describe('PreviewInspector — panel Apply IP Rating', () => {
  it('Apply con ipRating actualiza el tablero', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const ipInput = screen.getByRole<HTMLInputElement>('textbox', { name: /IP Rating/i });
    await userEvent.clear(ipInput);
    await userEvent.type(ipInput, 'IP54');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    if (updated.category !== 'electrical_panel') return;
    expect(updated.technical.ipRating.value).toBe('IP54');
    expect(updated.technical.ipRating.status).toBe('provided');
  });
});

// ─── Componente: fabricante/modelo ────────────────────────────────────────────

describe('PreviewInspector — fabricante Apply', () => {
  it('Apply con fabricante actualiza manufacturer en el store', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const mfrInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Fabricante/i });
    await userEvent.clear(mfrInput);
    await userEvent.type(mfrInput, 'Schneider Electric');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    expect(updated.manufacturer.value).toBe('Schneider Electric');
    expect(updated.manufacturer.status).toBe('provided');
  });

  it('Apply con modelo actualiza model en el store', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const modelInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Modelo/i });
    await userEvent.clear(modelInput);
    await userEvent.type(modelInput, 'PrismaSeT P');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    expect(updated.model.value).toBe('PrismaSeT P');
    expect(updated.model.status).toBe('provided');
  });
});

// ─── Componente: evidencia en store ──────────────────────────────────────────

describe('PreviewInspector — evidencia se agrega al store', () => {
  it('Apply con cambio de dato técnico agrega evidencia', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const ipInput = screen.getByRole<HTMLInputElement>('textbox', { name: /IP Rating/i });
    await userEvent.clear(ipInput);
    await userEvent.type(ipInput, 'IP66');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const evidence = usePreviewStore.getState().evidence;
    expect(evidence.length).toBeGreaterThan(0);
    const techEv = evidence.find((e) => e.fieldPath === 'technical.ipRating');
    expect(techEv).toBeDefined();
    expect(techEv?.source).toBe('manual');
    expect(techEv?.elementOrConnectionId).toBe('panel-1');
  });

  it('Apply sin cambios no agrega evidencia', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    // No modify anything
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(usePreviewStore.getState().evidence).toHaveLength(0);
  });
});

// ─── Componente: resetElements limpia evidencia ───────────────────────────────

describe('usePreviewStore — resetElements limpia evidence', () => {
  it('después de Apply y resetElements, evidence vuelve a []', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const ipInput = screen.getByRole<HTMLInputElement>('textbox', { name: /IP Rating/i });
    await userEvent.clear(ipInput);
    await userEvent.type(ipInput, 'IP66');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(usePreviewStore.getState().evidence.length).toBeGreaterThan(0);

    usePreviewStore.getState().resetElements();
    expect(usePreviewStore.getState().evidence).toHaveLength(0);
  });
});

// ─── Componente: Cancel revierte borradores técnicos ─────────────────────────

describe('PreviewInspector — Cancel revierte datos técnicos', () => {
  it('Cancel después de editar IP Rating revierte el input', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const ipInput = screen.getByRole<HTMLInputElement>('textbox', { name: /IP Rating/i });
    const originalValue = ipInput.value;

    await userEvent.clear(ipInput);
    await userEvent.type(ipInput, 'IP99-provisional');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(ipInput.value).toBe(originalValue);
    // Store no debe haber cambiado
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    if (el.category !== 'electrical_panel') return;
    expect(el.technical.ipRating.value).toBeNull();
  });
});

// ─── Auditoría: preservación de Datum por referencia ─────────────────────────

describe('buildDatum — preservación de referencia', () => {
  it('sin cambios → Datum original preservado por referencia', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (sensor.category !== 'sensor') return;
    const common: CommonTechnicalDraft = {
      manufacturer: sensor.manufacturer.value ?? '',
      model: sensor.model.value ?? '',
    };
    const draft: SensorTechnicalDraft = {
      measuredVariable: sensor.technical.measuredVariable.value ?? '',
      rangeMin: '0', rangeMax: '100', rangeUnit: 'm3/h',
      supplyVoltage: '24', supplyCurrentType: 'DC', signal: '4_20mA',
    };
    const result = applySensorTechnicalDraft(sensor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.element.category !== 'sensor') return;
    // Mismo valor → debe devolver el objeto Datum original
    expect(result.element.technical.measuredVariable).toBe(sensor.technical.measuredVariable);
    expect(result.element.technical.range).toBe(sensor.technical.range);
    expect(result.element.technical.supply).toBe(sensor.technical.supply);
    expect(result.element.technical.signal).toBe(sensor.technical.signal);
  });

  it('campo verificado con nuevo valor → status pasa a "provided"', () => {
    const baseMotor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    if (baseMotor.category !== 'motor') return;
    const verifiedMotor = {
      ...baseMotor,
      technical: {
        ...baseMotor.technical,
        power: { value: { value: 5.5, unit: 'kW' as const }, status: 'verified' as const, evidenceIds: [] as string[] },
      },
    } as typeof baseMotor;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: MotorTechnicalDraft = {
      power: '7.5', powerUnit: 'kW', voltage: '', phases: '',
      plateCurrent: '', efficiency: '', powerFactor: '', start: '',
    };
    const result = applyMotorTechnicalDraft(verifiedMotor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.element.category !== 'motor') return;
    expect(result.element.technical.power.value?.value).toBeCloseTo(7.5);
    expect(result.element.technical.power.status).toBe('provided');
  });
});

// ─── Auditoría: IDs únicos con reloj fijo ─────────────────────────────────────

describe('createManualEvidence — unicidad de IDs', () => {
  afterEach(() => vi.useRealTimers());

  it('dos llamadas con reloj fijo generan IDs distintos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ev1 = createManualEvidence('motor-1', 'technical.power', '5.5 kW');
    const ev2 = createManualEvidence('motor-1', 'technical.power', '7.5 kW');
    expect(ev1.id).not.toBe(ev2.id);
  });
});

// ─── Auditoría: rawValue incluye unidad ───────────────────────────────────────

describe('applyMotorTechnicalDraft — rawValue', () => {
  it('rawValue de potencia incluye número y unidad', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const common: CommonTechnicalDraft = { manufacturer: '', model: '' };
    const draft: MotorTechnicalDraft = {
      power: '5.5', powerUnit: 'kW', voltage: '', phases: '',
      plateCurrent: '', efficiency: '', powerFactor: '', start: '',
    };
    const result = applyMotorTechnicalDraft(motor, draft, common);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const powerEv = result.newEvidence.find((e) => e.fieldPath === 'technical.power');
    expect(powerEv).toBeDefined();
    expect(powerEv?.rawValue).toBe('5.5 kW');
  });
});

// ─── Auditoría: campo en conflicto no muestra input ──────────────────────────

describe('PreviewInspector — campo conflict solo lectura', () => {
  it('IP Rating en conflicto: sin textbox, muestra nota de conflicto', async () => {
    const basePanel = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    if (basePanel.category !== 'electrical_panel') return;
    const conflictPanel = {
      ...basePanel,
      technical: {
        ...basePanel.technical,
        ipRating: { value: 'IP65', status: 'conflict' as const, evidenceIds: [] as string[] },
      },
    } as typeof basePanel;
    usePreviewStore.getState().updateElement(conflictPanel);
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    expect(screen.queryByRole('textbox', { name: /IP Rating/i })).toBeNull();
    expect(screen.getByText(/Conflicto/i)).toBeTruthy();
  });
});

// ─── Auditoría: Apply sin cambios no incrementa versión ──────────────────────

describe('PreviewInspector — Apply sin cambios', () => {
  it('Apply sin editar no cambia la versión del elemento', async () => {
    const origVersion = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!.version;
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    expect(updated.version).toBe(origVersion);
  });
});
