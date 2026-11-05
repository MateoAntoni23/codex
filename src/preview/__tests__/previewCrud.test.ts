// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { usePreviewStore } from '../usePreviewStore';
import { PREVIEW_ELEMENTS } from '../previewData';
import {
  generateId, createNewElement, duplicateElement, checkDeleteDependencies,
  type AddElementSpec,
} from '../previewCrud';
import { PreviewElementList } from '../PreviewElementList';
import type { EquipmentElement } from '../../types/domain-v2';

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
    const { duplicate } = duplicateElement(original);
    expect(duplicate.id).not.toBe(original.id);
  });

  it('nombre identificable como copia', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;
    const { duplicate } = duplicateElement(original);
    expect(duplicate.name).toContain('Copia');
    expect(duplicate.name).toContain(original.name);
  });

  it('tag es null en la copia', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    const { duplicate } = duplicateElement(original);
    expect(duplicate.tag).toBeNull();
  });

  it('parentId es null — no hereda jerarquía', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    expect(child.parentId).not.toBeNull(); // precondición
    const { duplicate } = duplicateElement(child);
    expect(duplicate.parentId).toBeNull();
  });

  it('versión es 1', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const { duplicate } = duplicateElement(original);
    expect(duplicate.version).toBe(1);
  });

  it('status "provided" no se modifica', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (original.category !== 'sensor') return;
    expect(original.technical.measuredVariable.status).toBe('provided'); // precondición
    const { duplicate } = duplicateElement(original);
    if (duplicate.category !== 'sensor') return;
    expect(duplicate.technical.measuredVariable.status).toBe('provided');
  });

  it('status "estimated" no se modifica', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (original.category !== 'sensor') return;
    expect(original.technical.range.status).toBe('estimated'); // precondición
    const { duplicate } = duplicateElement(original);
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
    const { duplicate } = duplicateElement(withVerified);
    if (duplicate.category !== 'sensor') return;
    expect(duplicate.technical.signal.status).toBe('provided');
  });

  it('evidenceIds originales se conservan', () => {
    const base = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-flow-1')!;
    if (base.category !== 'sensor') return;
    const original: EquipmentElement = {
      ...base,
      technical: {
        ...base.technical,
        measuredVariable: { value: 'Presión', status: 'provided', evidenceIds: ['ev-001', 'ev-002'] },
      },
    } as EquipmentElement;
    const { duplicate } = duplicateElement(original);
    if (duplicate.category !== 'sensor') return;
    expect(duplicate.technical.measuredVariable.evidenceIds).toEqual(['ev-001', 'ev-002']);
  });

  it('provenance registra la procedencia', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;
    const { provenance } = duplicateElement(original);
    expect(provenance.source).toBe('manual');
    expect(provenance.fieldPath).toBe('_provenance');
    const raw = provenance.rawValue as Record<string, unknown>;
    expect(raw.action).toBe('duplicated_from');
    expect(raw.sourceId).toBe('motor-1');
  });

  it('dos duplicaciones del mismo elemento generan IDs distintos', () => {
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const { duplicate: d1 } = duplicateElement(original);
    const { duplicate: d2 } = duplicateElement(original);
    expect(d1.id).not.toBe(d2.id);
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
    const { duplicate, provenance } = duplicateElement(PREVIEW_ELEMENTS[0]);
    gs().addElement(duplicate);
    gs().addEvidence(provenance);

    expect(gs().elements.length).toBeGreaterThan(PREVIEW_ELEMENTS.length);

    gs().resetElements();

    expect(gs().elements.map((e) => e.id).sort())
      .toEqual(PREVIEW_ELEMENTS.map((e) => e.id).sort());
    expect(gs().evidence).toHaveLength(0);
    expect(gs().selectedId).toBeNull();
  });
});
