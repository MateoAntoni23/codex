// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { usePreviewStore } from '../usePreviewStore';
import { PREVIEW_ELEMENTS } from '../previewData';
import {
  generateId, createNewElement, duplicateElement, checkDeleteDependencies,
  evidenceToRemoveOnDelete, validatePreviewData,
  type AddElementSpec,
} from '../previewCrud';
import { resolveGlobalTransform } from '../../scene/v2-adapter';
import { PREVIEW_EVIDENCE } from '../previewData';
import { PreviewElementList } from '../PreviewElementList';
import { validateProjectDataV2 } from '../../persistence/validate-v2';
import type { EquipmentElement, FieldEvidence } from '../../types/domain-v2';

beforeEach(() => {
  usePreviewStore.getState().resetElements();
});

// ─── generateId ───────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('dos llamadas generan IDs distintos', () => {
    expect(generateId('motor')).not.toBe(generateId('motor'));
  });

  it('el prefijo aparece en el ID', () => {
    expect(generateId('sensor')).toContain('sensor');
  });
});

// ─── createNewElement ─────────────────────────────────────────────────────────

describe('createNewElement — motor sin ubicar', () => {
  it('crea motor con estructura válida', () => {
    const spec: AddElementSpec = {
      category: 'motor', name: 'Motor A',
      placement: { placementStatus: 'unplaced' },
      geometry: null,
    };
    const el = createNewElement(spec);
    expect(el.category).toBe('motor');
    expect(el.name).toBe('Motor A');
    expect(el.placementStatus).toBe('unplaced');
    expect(el.transform).toBeNull();
    expect(el.geometry).toBeNull();
    expect(el.tag).toBeNull();
    expect(el.parentId).toBeNull();
    expect(el.version).toBe(1);
  });

  it('datos técnicos del motor inicialmente desconocidos', () => {
    const el = createNewElement({
      category: 'motor', name: 'M',
      placement: { placementStatus: 'unplaced' },
      geometry: null,
    });
    if (el.category !== 'motor') return;
    expect(el.technical.power.status).toBe('unknown');
    expect(el.technical.voltage.status).toBe('unknown');
    expect(el.technical.phases.status).toBe('unknown');
    expect(el.technical.efficiency.status).toBe('unknown');
    expect(el.technical.start.status).toBe('unknown');
  });
});

describe('createNewElement — sensor ubicado con posición', () => {
  it('posición se guarda correctamente', () => {
    const el = createNewElement({
      category: 'sensor', name: 'PT-201',
      placement: { placementStatus: 'placed', positionMm: { x: 1000, y: -500, z: 300 } },
      geometry: null,
    });
    expect(el.placementStatus).toBe('placed');
    if (el.placementStatus !== 'placed') return;
    expect(el.transform.positionMm.x).toBe(1000);
    expect(el.transform.positionMm.y).toBe(-500);
    expect(el.transform.positionMm.z).toBe(300);
    expect(el.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('createNewElement — tablero con geometría caja', () => {
  it('geometría box se guarda correctamente', () => {
    const el = createNewElement({
      category: 'electrical_panel', name: 'QD-01',
      placement: { placementStatus: 'unplaced' },
      geometry: { kind: 'box', widthMm: 600, depthMm: 300, heightMm: 2000 },
    });
    expect(el.geometry?.kind).toBe('box');
    if (el.geometry?.kind !== 'box') return;
    expect(el.geometry.widthMm).toBe(600);
    expect(el.geometry.heightMm).toBe(2000);
    expect(el.category).toBe('electrical_panel');
    if (el.category !== 'electrical_panel') return;
    expect(el.technical.ipRating.status).toBe('unknown');
    expect(el.technical.ratedCurrent.status).toBe('unknown');
  });
});

describe('createNewElement — sensor con cilindro', () => {
  it('geometría cylinder se guarda correctamente', () => {
    const el = createNewElement({
      category: 'sensor', name: 'FT-301',
      placement: { placementStatus: 'unplaced' },
      geometry: { kind: 'cylinder', diameterMm: 80, lengthMm: 200 },
    });
    expect(el.geometry?.kind).toBe('cylinder');
    if (el.geometry?.kind !== 'cylinder') return;
    expect(el.geometry.diameterMm).toBe(80);
  });
});

describe('createNewElement — IDs únicos para creaciones consecutivas', () => {
  it('dos elementos creados tienen IDs distintos', () => {
    const a = createNewElement({ category: 'motor', name: 'A', placement: { placementStatus: 'unplaced' }, geometry: null });
    const b = createNewElement({ category: 'motor', name: 'B', placement: { placementStatus: 'unplaced' }, geometry: null });
    expect(a.id).not.toBe(b.id);
  });
});

// ─── duplicateElement ─────────────────────────────────────────────────────────

describe('duplicateElement', () => {
  it('nuevo ID distinto al original', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const { duplicate } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(duplicate.id).not.toBe(original.id);
  });

  it('nombre identificable como copia', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;
    const { duplicate } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(duplicate.name).toContain('Copia');
    expect(duplicate.name).toContain(original.name);
  });

  it('tag es null en la copia', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    const { duplicate } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(duplicate.tag).toBeNull();
  });

  it('parentId es null — no hereda jerarquía', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    expect(child.parentId).not.toBeNull(); // precondición
    const { duplicate } = duplicateElement(child, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(duplicate.parentId).toBeNull();
  });

  it('versión es 1', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const { duplicate } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(duplicate.version).toBe(1);
  });

  it('status "provided" no se modifica', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (original.category !== 'sensor') return;
    expect(original.technical.measuredVariable.status).toBe('provided'); // precondición
    const { duplicate } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    if (duplicate.category !== 'sensor') return;
    expect(duplicate.technical.measuredVariable.status).toBe('provided');
  });

  it('status "estimated" no se modifica', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (original.category !== 'sensor') return;
    expect(original.technical.range.status).toBe('estimated'); // precondición
    const { duplicate } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    if (duplicate.category !== 'sensor') return;
    expect(duplicate.technical.range.status).toBe('estimated');
  });

  it('status "verified" se degrada a "provided"', () => {
    const base = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (base.category !== 'sensor') return;
    const withVerified: EquipmentElement = {
      ...base,
      technical: {
        ...base.technical,
        signal: { value: '4_20mA' as const, status: 'verified', evidenceIds: [] },
      },
    } as EquipmentElement;
    const { duplicate } = duplicateElement(withVerified, [], []);
    if (duplicate.category !== 'sensor') return;
    expect(duplicate.technical.signal.status).toBe('provided');
  });

  it('evidenceIds se remapean: la copia recibe nuevos registros propios', () => {
    const base = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (base.category !== 'sensor') return;
    const original: EquipmentElement = {
      ...base,
      id: 'sensor-orig',
      technical: {
        ...base.technical,
        measuredVariable: { value: 'Presión', status: 'provided', evidenceIds: ['ev-001'] },
      },
    } as EquipmentElement;
    const srcEvidence: FieldEvidence = {
      id: 'ev-001', elementOrConnectionId: 'sensor-orig', fieldPath: 'technical.measuredVariable',
      source: 'manual', rawValue: 'Presión',
      fileChecksum: null, sheet: null, row: null, cell: null, formula: null,
      author: null, recordedAt: '2026-01-01T00:00:00Z',
    };
    const { duplicate, remappedEvidence } = duplicateElement(original, [], [srcEvidence]);
    if (duplicate.category !== 'sensor') return;

    // La copia NO tiene el ID original
    expect(duplicate.technical.measuredVariable.evidenceIds).not.toContain('ev-001');
    // Tiene exactamente un evidenceId remapeado
    expect(duplicate.technical.measuredVariable.evidenceIds).toHaveLength(1);
    // remappedEvidence tiene el registro copiado con propiedad de la copia
    expect(remappedEvidence).toHaveLength(1);
    const [mapped] = remappedEvidence;
    expect(mapped.id).toBe(duplicate.technical.measuredVariable.evidenceIds[0]);
    expect(mapped.elementOrConnectionId).toBe(duplicate.id);
    expect(mapped.rawValue).toBe('Presión');
  });

  it('provenance registra la procedencia', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;
    const { provenance } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(provenance.source).toBe('manual');
    expect(provenance.fieldPath).toBe('_provenance');
    const raw = provenance.rawValue as Record<string, unknown>;
    expect(raw.action).toBe('duplicated_from');
    expect(raw.sourceId).toBe('motor-1');
  });

  it('dos duplicaciones del mismo elemento generan IDs distintos', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const { duplicate: d1 } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    const { duplicate: d2 } = duplicateElement(original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(d1.id).not.toBe(d2.id);
  });

  it('hijo de padre rotado: posición global difiere de la local', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const { duplicate } = duplicateElement(child, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    const globalTransform = resolveGlobalTransform('child-motor-1', PREVIEW_ELEMENTS)!;

    expect(duplicate.placementStatus).toBe('placed');
    if (duplicate.placementStatus !== 'placed') return;
    expect(duplicate.transform.positionMm.x).toBeCloseTo(globalTransform.positionMm.x, 5);
    expect(duplicate.transform.positionMm.y).toBeCloseTo(globalTransform.positionMm.y, 5);
    expect(duplicate.transform.positionMm.z).toBeCloseTo(globalTransform.positionMm.z, 5);

    // La posición global difiere del offset local (0, 800, 0) del hijo
    const child_ = child as Extract<typeof child, { placementStatus: 'placed' }>;
    expect(duplicate.transform.positionMm.x).not.toBeCloseTo(child_.transform.positionMm.x, 1);
  });

  it('hijo con ancestro sin ubicar → copia queda sin ubicar', () => {
    const unplaced = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-unplaced-1')!;
    const fakeChild: EquipmentElement = {
      ...PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!,
      id: 'fake-child',
      parentId: unplaced.id,
      placementStatus: 'placed',
      transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    } as EquipmentElement;
    const allWithChild = [...PREVIEW_ELEMENTS, fakeChild];
    const { duplicate } = duplicateElement(fakeChild, allWithChild, []);
    expect(duplicate.placementStatus).toBe('unplaced');
    expect(duplicate.transform).toBeNull();
  });
});

// ─── checkDeleteDependencies ──────────────────────────────────────────────────

describe('checkDeleteDependencies', () => {
  it('sin hijos → canDelete true', () => {
    const el = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const result = checkDeleteDependencies(el, PREVIEW_ELEMENTS);
    expect(result.canDelete).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('con hijo → canDelete false con mensaje', () => {
    const parent = PREVIEW_ELEMENTS.find((e) => e.id === 'support-panel-1')!;
    const result = checkDeleteDependencies(parent, PREVIEW_ELEMENTS);
    expect(result.canDelete).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers[0]).toMatch(/hijo/i);
  });

  it('el hijo mismo no tiene hijos → canDelete true', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const result = checkDeleteDependencies(child, PREVIEW_ELEMENTS);
    expect(result.canDelete).toBe(true);
  });

  it('múltiples hijos → mensaje los menciona', () => {
    const fakeParent = { id: 'fake-parent', name: 'Padre' } as EquipmentElement;
    const childA = { ...PREVIEW_ELEMENTS[0], id: 'c-a', name: 'Hijo A', parentId: 'fake-parent' } as EquipmentElement;
    const childB = { ...PREVIEW_ELEMENTS[0], id: 'c-b', name: 'Hijo B', parentId: 'fake-parent' } as EquipmentElement;
    const result = checkDeleteDependencies(fakeParent, [fakeParent, childA, childB]);
    expect(result.canDelete).toBe(false);
    expect(result.blockers[0]).toContain('2');
  });
});

// ─── Componente: PreviewElementList — Agregar ─────────────────────────────────

describe('PreviewElementList — Agregar', () => {
  it('botón "Agregar equipo" abre el formulario', async () => {
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));
    expect(screen.getByRole('button', { name: 'Crear' })).toBeTruthy();
  });

  it('Cancelar cierra el formulario sin agregar elemento', async () => {
    const countBefore = usePreviewStore.getState().elements.length;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('button', { name: 'Crear' })).toBeNull();
    expect(usePreviewStore.getState().elements.length).toBe(countBefore);
  });

  it('nombre vacío → error visible, no agrega elemento', async () => {
    const countBefore = usePreviewStore.getState().elements.length;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(screen.getByText(/El nombre es obligatorio/i)).toBeTruthy();
    expect(usePreviewStore.getState().elements.length).toBe(countBefore);
  });

  it('crear motor sin ubicar → aparece en store y queda seleccionado', async () => {
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));

    const nameInput = screen.getByRole('textbox', { name: /Nombre/i });
    await userEvent.type(nameInput, 'Motor de prueba');

    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    const state = usePreviewStore.getState();
    const nuevo = state.elements.find((e) => e.name === 'Motor de prueba');
    expect(nuevo).toBeDefined();
    expect(nuevo?.category).toBe('motor');
    expect(nuevo?.placementStatus).toBe('unplaced');
    expect(state.selectedId).toBe(nuevo?.id);
  });

  it('crear sensor con posición → elemento ubicado con coords correctas', async () => {
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));

    const catSelect = screen.getByRole('combobox', { name: /Tipo/i });
    await userEvent.selectOptions(catSelect, 'sensor');

    const nameInput = screen.getByRole('textbox', { name: /Nombre/i });
    await userEvent.type(nameInput, 'FT-999');

    await userEvent.click(screen.getByRole('radio', { name: /Posición conocida/i }));

    const xInput = screen.getByRole('textbox', { name: /X/i });
    await userEvent.clear(xInput);
    await userEvent.type(xInput, '1500');

    const yInput = screen.getByRole('textbox', { name: /Y/i });
    await userEvent.clear(yInput);
    await userEvent.type(yInput, '-200');

    const zInput = screen.getByRole('textbox', { name: /Z/i });
    await userEvent.clear(zInput);
    await userEvent.type(zInput, '800');

    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    const nuevo = usePreviewStore.getState().elements.find((e) => e.name === 'FT-999')!;
    expect(nuevo.placementStatus).toBe('placed');
    if (nuevo.placementStatus !== 'placed') return;
    expect(nuevo.transform.positionMm.x).toBe(1500);
    expect(nuevo.transform.positionMm.y).toBe(-200);
    expect(nuevo.transform.positionMm.z).toBe(800);
  });

  it('crear tablero con geometría caja → geometry box en store', async () => {
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));

    const catSelect = screen.getByRole('combobox', { name: /Tipo/i });
    await userEvent.selectOptions(catSelect, 'electrical_panel');

    const nameInput = screen.getByRole('textbox', { name: /Nombre/i });
    await userEvent.type(nameInput, 'Tablero nuevo');

    const geoSelect = screen.getByRole('combobox', { name: /Forma/i });
    await userEvent.selectOptions(geoSelect, 'box');

    // Limpiar y escribir dimensiones
    const wInput = screen.getByRole('textbox', { name: /Ancho/i });
    await userEvent.clear(wInput);
    await userEvent.type(wInput, '800');

    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    const nuevo = usePreviewStore.getState().elements.find((e) => e.name === 'Tablero nuevo')!;
    expect(nuevo.geometry?.kind).toBe('box');
    if (nuevo.geometry?.kind !== 'box') return;
    expect(nuevo.geometry.widthMm).toBe(800);
  });

  it('dimensiones de caja con valor cero → error visible', async () => {
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: /Agregar equipo/i }));

    const nameInput = screen.getByRole('textbox', { name: /Nombre/i });
    await userEvent.type(nameInput, 'Test');

    const geoSelect = screen.getByRole('combobox', { name: /Forma/i });
    await userEvent.selectOptions(geoSelect, 'box');

    const wInput = screen.getByRole('textbox', { name: /Ancho/i });
    await userEvent.clear(wInput);
    await userEvent.type(wInput, '0'); // cero no es positivo

    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(screen.getByText(/Debe ser un número positivo/i)).toBeTruthy();
  });
});

// ─── Componente: PreviewElementList — Duplicar ───────────────────────────────

describe('PreviewElementList — Duplicar', () => {
  it('duplicar elemento agrega uno nuevo con ID distinto', async () => {
    const original = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    const countBefore = usePreviewStore.getState().elements.length;

    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Duplicar ${original.name}` }));

    const state = usePreviewStore.getState();
    expect(state.elements.length).toBe(countBefore + 1);
    const copias = state.elements.filter((e) => e.name.startsWith('Copia de'));
    expect(copias.length).toBeGreaterThan(0);
    expect(copias[0].id).not.toBe('panel-1');
  });

  it('duplicar agrega evidencia de procedencia al store', async () => {
    const original = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Duplicar ${original.name}` }));

    const evidence = usePreviewStore.getState().evidence;
    const prov = evidence.find((e) => e.fieldPath === '_provenance');
    expect(prov).toBeDefined();
    expect((prov?.rawValue as Record<string, unknown>)?.sourceId).toBe('motor-1');
  });

  it('duplicar elemento sin ubicar agrega copia también sin ubicar', async () => {
    render(React.createElement(PreviewElementList));
    const unplacedEl = usePreviewStore.getState().elements.find((e) => e.placementStatus === 'unplaced')!;
    await userEvent.click(screen.getByRole('button', { name: `Duplicar ${unplacedEl.name}` }));

    const copias = usePreviewStore.getState().elements.filter(
      (e) => e.name.startsWith('Copia de') && e.placementStatus === 'unplaced',
    );
    expect(copias.length).toBeGreaterThan(0);
  });
});

// ─── Componente: PreviewElementList — Eliminar ───────────────────────────────

describe('PreviewElementList — Eliminar (sin dependencias)', () => {
  it('click Eliminar muestra confirmación', async () => {
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${el.name}` }));
    expect(screen.getByRole('button', { name: /Sí, eliminar/i })).toBeTruthy();
  });

  it('confirmar eliminación remueve el elemento del store', async () => {
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${el.name}` }));
    await userEvent.click(screen.getByRole('button', { name: /Sí, eliminar/i }));

    expect(usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')).toBeUndefined();
  });

  it('confirmar eliminación del elemento seleccionado limpia la selección', async () => {
    usePreviewStore.getState().select('panel-1');
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${el.name}` }));
    await userEvent.click(screen.getByRole('button', { name: /Sí, eliminar/i }));

    expect(usePreviewStore.getState().selectedId).toBeNull();
  });

  it('Cancelar eliminación conserva el elemento en el store', async () => {
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${el.name}` }));
    // Cancelar en el diálogo de confirmación
    const cancelBtns = screen.getAllByRole('button', { name: 'Cancelar' });
    await userEvent.click(cancelBtns[cancelBtns.length - 1]);

    expect(usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Sí, eliminar/i })).toBeNull();
  });
});

describe('PreviewElementList — Eliminar (con dependencias)', () => {
  it('padre con hijos muestra bloqueo y no muestra confirmación', async () => {
    const parent = usePreviewStore.getState().elements.find((e) => e.id === 'support-panel-1')!;
    render(React.createElement(PreviewElementList));
    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${parent.name}` }));

    expect(screen.queryByRole('button', { name: /Sí, eliminar/i })).toBeNull();
    expect(screen.getByText(/hijo/i)).toBeTruthy();
    // El elemento no fue eliminado
    expect(usePreviewStore.getState().elements.find((e) => e.id === 'support-panel-1')).toBeDefined();
  });
});

// ─── Restablecimiento ─────────────────────────────────────────────────────────

describe('usePreviewStore — reset tras operaciones CRUD', () => {
  it('tras agregar y duplicar, resetElements recupera exactamente PREVIEW_ELEMENTS', () => {
    const gs = () => usePreviewStore.getState();
    // Agregar un elemento
    gs().addElement(createNewElement({
      category: 'motor', name: 'Extra', placement: { placementStatus: 'unplaced' }, geometry: null,
    }));
    // Duplicar uno existente
    const { duplicate, provenance } = duplicateElement(PREVIEW_ELEMENTS[0], PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    gs().addElement(duplicate);
    gs().addEvidence(provenance);

    expect(gs().elements.length).toBeGreaterThan(PREVIEW_ELEMENTS.length);

    gs().resetElements();

    expect(gs().elements.map((e) => e.id).sort())
      .toEqual(PREVIEW_ELEMENTS.map((e) => e.id).sort());
    expect(gs().evidence.every((e) => e.source === 'migration')).toBe(true);
    expect(gs().selectedId).toBeNull();
  });
});

// ─── validatePreviewData ──────────────────────────────────────────────────────

describe('validatePreviewData', () => {
  it('estado inicial de preview es válido', () => {
    const result = validatePreviewData(PREVIEW_ELEMENTS, PREVIEW_EVIDENCE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detecta IDs de elementos duplicados', () => {
    const dup = { ...PREVIEW_ELEMENTS[0] };
    const result = validatePreviewData([...PREVIEW_ELEMENTS, dup], PREVIEW_EVIDENCE);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicados/i.test(e))).toBe(true);
  });

  it('detecta parentId colgante', () => {
    const orphan: EquipmentElement = {
      ...PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!,
      id: 'orphan-1',
      parentId: 'non-existent-parent',
    } as EquipmentElement;
    const result = validatePreviewData([...PREVIEW_ELEMENTS, orphan], PREVIEW_EVIDENCE);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('orphan-1') && e.includes('non-existent-parent'))).toBe(true);
  });

  it('detecta evidencia con elementOrConnectionId inexistente', () => {
    const orphanEvidence: FieldEvidence = {
      id: 'ev-orphan',
      elementOrConnectionId: 'ghost-element',
      fieldPath: 'technical.power',
      source: 'manual',
      rawValue: '5 kW',
      fileChecksum: null, sheet: null, row: null, cell: null, formula: null,
      author: null, recordedAt: new Date().toISOString(),
    };
    const result = validatePreviewData(PREVIEW_ELEMENTS, [...PREVIEW_EVIDENCE, orphanEvidence]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ev-orphan'))).toBe(true);
  });

  it('detecta evidenceId en datum que no existe en el array', () => {
    const panelOriginal = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const panelWithDanglingRef: EquipmentElement = {
      ...panelOriginal,
      manufacturer: { value: 'ABB', status: 'provided', evidenceIds: ['ev-missing-999'] },
    } as EquipmentElement;
    const elements = PREVIEW_ELEMENTS.map((e) => e.id === 'panel-1' ? panelWithDanglingRef : e);
    const result = validatePreviewData(elements, PREVIEW_EVIDENCE);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ev-missing-999'))).toBe(true);
  });

  it('eliminar elemento limpia su evidencia → estado válido', () => {
    // Crear elemento con evidencia propia
    const el: EquipmentElement = {
      ...PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!,
      id: 'temp-motor',
      parentId: null,
      manufacturer: { value: 'Siemens', status: 'provided', evidenceIds: ['ev-temp-1'] },
    } as EquipmentElement;
    const ev: FieldEvidence = {
      id: 'ev-temp-1',
      elementOrConnectionId: 'temp-motor',
      fieldPath: 'manufacturer',
      source: 'manual',
      rawValue: 'Siemens',
      fileChecksum: null, sheet: null, row: null, cell: null, formula: null,
      author: null, recordedAt: new Date().toISOString(),
    };
    const elements = [...PREVIEW_ELEMENTS, el];
    const evidence = [...PREVIEW_EVIDENCE, ev];

    const toRemove = new Set(evidenceToRemoveOnDelete('temp-motor', elements, evidence));
    const elementsAfter = elements.filter((e) => e.id !== 'temp-motor');
    const evidenceAfter = evidence.filter((e) => !toRemove.has(e.id));

    expect(toRemove.has('ev-temp-1')).toBe(true);
    const result = validatePreviewData(elementsAfter, evidenceAfter);
    expect(result.valid).toBe(true);
  });

  it('duplicar → eliminar original → copia y su evidencia persisten, estado válido', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const { duplicate, provenance, remappedEvidence } = duplicateElement(
      original, PREVIEW_ELEMENTS, PREVIEW_EVIDENCE,
    );

    const elements = [...PREVIEW_ELEMENTS, duplicate];
    const evidence = [...PREVIEW_EVIDENCE, ...remappedEvidence, provenance];

    const toRemove = new Set(evidenceToRemoveOnDelete('panel-1', elements, evidence));
    const elementsAfter = elements.filter((e) => e.id !== 'panel-1');
    const evidenceAfter = evidence.filter((e) => !toRemove.has(e.id));

    const result = validatePreviewData(elementsAfter, evidenceAfter);
    expect(result.valid).toBe(true);
    expect(elementsAfter.find((e) => e.id === duplicate.id)).toBeDefined();
    expect(evidenceAfter.find((e) => e.id === provenance.id)).toBeDefined();
  });
});

// ─── Flujo completo con validateProjectDataV2 ─────────────────────────────────

describe('validateProjectDataV2 — editar → duplicar → eliminar original', () => {
  it('snapshot final pasa el validador real tras editar evidencia, duplicar y eliminar', () => {
    // Elemento sintético con evidencia manual propia (simula edición aplicada)
    const motorEl: EquipmentElement = {
      id: 'mtr-test',
      name: 'Motor Test',
      tag: null,
      aliases: [],
      physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
      condition: 'new',
      lifecycle: 'active',
      parentId: null,
      geometry: null,
      mounting: 'floor',
      manufacturer: { value: 'Siemens', status: 'provided', evidenceIds: ['ev-mfr-orig'] },
      model: { value: null, status: 'unknown', evidenceIds: [] },
      version: 1,
      placementStatus: 'unplaced',
      transform: null,
      category: 'motor',
      technical: {
        power: { value: null, status: 'unknown', evidenceIds: [] },
        voltage: { value: null, status: 'unknown', evidenceIds: [] },
        phases: { value: null, status: 'unknown', evidenceIds: [] },
        plateCurrent: { value: null, status: 'unknown', evidenceIds: [] },
        efficiency: { value: null, status: 'unknown', evidenceIds: [] },
        powerFactor: { value: null, status: 'unknown', evidenceIds: [] },
        start: { value: null, status: 'unknown', evidenceIds: [] },
      },
    } as EquipmentElement;

    const mfrEvidence: FieldEvidence = {
      id: 'ev-mfr-orig',
      elementOrConnectionId: 'mtr-test',
      fieldPath: 'manufacturer',
      source: 'manual',
      rawValue: 'Siemens',
      fileChecksum: null, sheet: null, row: null, cell: null, formula: null,
      author: null, recordedAt: '2026-01-01T00:00:00Z',
    };

    // Duplicar — la copia recibe evidencias propias remapeadas
    const { duplicate, provenance, remappedEvidence } = duplicateElement(
      motorEl, [motorEl], [mfrEvidence],
    );

    expect(remappedEvidence).toHaveLength(1);
    expect(remappedEvidence[0].elementOrConnectionId).toBe(duplicate.id);

    // Eliminar original — solo se remueve la evidencia exclusiva del original
    const elementsWithBoth = [motorEl, duplicate];
    const evidenceWithBoth = [mfrEvidence, ...remappedEvidence, provenance];
    const toRemove = new Set(evidenceToRemoveOnDelete('mtr-test', elementsWithBoth, evidenceWithBoth));

    expect(toRemove.has('ev-mfr-orig')).toBe(true); // la original se elimina
    expect(toRemove.has(remappedEvidence[0].id)).toBe(false); // la copia se preserva

    const finalElements = elementsWithBoth.filter((e) => e.id !== 'mtr-test');
    const finalEvidence = evidenceWithBoth.filter((e) => !toRemove.has(e.id));

    // Snapshot completo pasa el validador real
    expect(() =>
      validateProjectDataV2({
        schemaVersion: 2,
        projectOrigin: { x: 0, y: 0, z: 0 },
        elements: finalElements,
        ports: [],
        connections: [],
        cableCores: [],
        internalLinks: [],
        functionalRelations: [],
        factories: [],
        subareas: [],
        elementServices: [],
        evidence: finalEvidence,
        migrationIncidents: [],
      }),
    ).not.toThrow();
  });
});
