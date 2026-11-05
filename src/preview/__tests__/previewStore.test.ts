import { describe, it, expect, beforeEach } from 'vitest';
import { usePreviewStore } from '../usePreviewStore';
import { PREVIEW_ELEMENTS } from '../previewData';
import { elementToRenderProps } from '../../scene/v2-adapter';

// Reinicia la selección antes de cada test para garantizar aislamiento
beforeEach(() => {
  usePreviewStore.setState({ selectedId: null });
});

// ─── Selección ────────────────────────────────────────────────────────────────

describe('usePreviewStore — selección', () => {
  it('estado inicial: sin selección', () => {
    expect(usePreviewStore.getState().selectedId).toBeNull();
  });

  it('select actualiza selectedId al id indicado', () => {
    usePreviewStore.getState().select('floor-1');
    expect(usePreviewStore.getState().selectedId).toBe('floor-1');
  });

  it('clearSelection resetea selectedId a null', () => {
    usePreviewStore.getState().select('motor-1');
    usePreviewStore.getState().clearSelection();
    expect(usePreviewStore.getState().selectedId).toBeNull();
  });

  it('segunda llamada a select sobreescribe la primera', () => {
    usePreviewStore.getState().select('floor-1');
    usePreviewStore.getState().select('panel-1');
    expect(usePreviewStore.getState().selectedId).toBe('panel-1');
  });

  it('select con el mismo id mantiene ese id', () => {
    usePreviewStore.getState().select('building-1');
    usePreviewStore.getState().select('building-1');
    expect(usePreviewStore.getState().selectedId).toBe('building-1');
  });
});

// ─── Aislamiento de persistencia ─────────────────────────────────────────────

describe('usePreviewStore — aislamiento de persistencia', () => {
  it('el store no tiene campos de guardado ni de carga de IndexedDB', () => {
    const state = usePreviewStore.getState();
    expect(state).not.toHaveProperty('saveStatus');
    expect(state).not.toHaveProperty('editingBlocked');
    expect(state).not.toHaveProperty('objects');
    expect(state).not.toHaveProperty('hydrateProject');
    expect(state).not.toHaveProperty('setSaveStatus');
    expect(state).not.toHaveProperty('initProject');
  });

  it('las mutaciones son síncronas — select y clearSelection devuelven undefined', () => {
    expect(usePreviewStore.getState().select('x')).toBeUndefined();
    expect(usePreviewStore.getState().clearSelection()).toBeUndefined();
  });

  it('el store solo expone select y clearSelection como acciones', () => {
    const state = usePreviewStore.getState();
    const actions = Object.keys(state).filter(
      (k) => typeof (state as unknown as Record<string, unknown>)[k] === 'function',
    );
    expect(actions.sort()).toEqual(['clearSelection', 'select']);
  });
});

// ─── Datos de preview ─────────────────────────────────────────────────────────

describe('PREVIEW_ELEMENTS — elementos de ejemplo', () => {
  it('contiene los 4 elementos migrados desde v1', () => {
    const ids = PREVIEW_ELEMENTS.map((e) => e.id);
    expect(ids).toContain('floor-1');
    expect(ids).toContain('building-1');
    expect(ids).toContain('panel-1');
    expect(ids).toContain('motor-1');
  });

  it('contiene el soporte giratorio (padre) y el motor en soporte (hijo)', () => {
    const parent = PREVIEW_ELEMENTS.find((e) => e.id === 'support-panel-1');
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1');
    expect(parent).toBeDefined();
    expect(child?.parentId).toBe('support-panel-1');
  });

  it('el padre tiene rotación no-identidad (45° alrededor de Z)', () => {
    const parent = PREVIEW_ELEMENTS.find((e) => e.id === 'support-panel-1')!;
    expect(parent.placementStatus).toBe('placed');
    if (parent.placementStatus === 'placed') {
      expect(parent.transform.rotation.w).toBeCloseTo(Math.cos(Math.PI / 8), 5);
      expect(parent.transform.rotation.z).toBeCloseTo(Math.sin(Math.PI / 8), 5);
    }
  });

  it('contiene el variador de frecuencia sin geometría', () => {
    const vfd = PREVIEW_ELEMENTS.find((e) => e.id === 'vfd-1');
    expect(vfd).toBeDefined();
    expect(vfd?.geometry).toBeNull();
    expect(vfd?.placementStatus).toBe('placed');
  });

  it('contiene al menos un elemento sin ubicar', () => {
    const unplaced = PREVIEW_ELEMENTS.filter((e) => e.placementStatus === 'unplaced');
    expect(unplaced.length).toBeGreaterThanOrEqual(1);
  });

  it('el sensor de temperatura está sin ubicar', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-unplaced-1');
    expect(sensor?.placementStatus).toBe('unplaced');
  });
});

// ─── elementToRenderProps con datos de preview ───────────────────────────────

describe('elementToRenderProps — elementos migrados', () => {
  it('piso migrado: isFloor=true, geometryKind=plane, placed=true', () => {
    const floor = PREVIEW_ELEMENTS.find((e) => e.id === 'floor-1')!;
    const props = elementToRenderProps(floor, PREVIEW_ELEMENTS);
    expect(props.placed).toBe(true);
    expect(props.isFloor).toBe(true);
    expect(props.geometryKind).toBe('plane');
  });

  it('nave migrada: geometryKind=box, category=infrastructure, placed=true', () => {
    const building = PREVIEW_ELEMENTS.find((e) => e.id === 'building-1')!;
    const props = elementToRenderProps(building, PREVIEW_ELEMENTS);
    expect(props.placed).toBe(true);
    expect(props.geometryKind).toBe('box');
    expect(props.category).toBe('infrastructure');
  });

  it('tablero migrado: geometryKind=box, placed=true, posición en visor correcta', () => {
    const panel = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;
    const props = elementToRenderProps(panel, PREVIEW_ELEMENTS);
    expect(props.placed).toBe(true);
    expect(props.geometryKind).toBe('box');
    // panel-1 en dominio: {x:-7000, y:2000, z:1000} → viewer [-7, 1, -2]
    expect(props.positionViewer![0]).toBeCloseTo(-7, 5);
    expect(props.positionViewer![1]).toBeCloseTo(1, 5);
    expect(props.positionViewer![2]).toBeCloseTo(-2, 5);
  });

  it('motor migrado: geometryKind=cylinder, dimensiones correctas', () => {
    const motor = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;
    const props = elementToRenderProps(motor, PREVIEW_ELEMENTS);
    expect(props.placed).toBe(true);
    expect(props.geometryKind).toBe('cylinder');
    // motor-1: width=depth=600mm → diameterMm=600 → sizeViewer[0]=sizeViewer[2]=0.6
    expect(props.sizeViewer![0]).toBeCloseTo(0.6, 5);
    expect(props.sizeViewer![2]).toBeCloseTo(0.6, 5);
  });
});

describe('elementToRenderProps — elementos adicionales', () => {
  it('variador de frecuencia: placed=true, geometryKind=unknown, sizeViewer=null', () => {
    const vfd = PREVIEW_ELEMENTS.find((e) => e.id === 'vfd-1')!;
    const props = elementToRenderProps(vfd, PREVIEW_ELEMENTS);
    expect(props.placed).toBe(true);
    expect(props.geometryKind).toBe('unknown');
    expect(props.sizeViewer).toBeNull();
    expect(props.positionViewer).not.toBeNull();
  });

  it('sensor sin ubicar: placed=false, posición y tamaño nulos', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-unplaced-1')!;
    const props = elementToRenderProps(sensor, PREVIEW_ELEMENTS);
    expect(props.placed).toBe(false);
    expect(props.positionViewer).toBeNull();
    expect(props.rotationViewer).toBeNull();
    expect(props.sizeViewer).toBeNull();
  });

  it('hijo hereda rotación del padre — posición global difiere de la local', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const parent = PREVIEW_ELEMENTS.find((e) => e.id === 'support-panel-1')!;

    const childProps = elementToRenderProps(child, PREVIEW_ELEMENTS);
    const parentProps = elementToRenderProps(parent, PREVIEW_ELEMENTS);

    expect(childProps.placed).toBe(true);

    // La posición del hijo, transformada por la rotación del padre,
    // debe diferir de la posición del padre + offset local sin rotar.
    // Con identidad el hijo estaría en parent_z + 800mm; con rotación 45°Z
    // el offset (0,800,0) se rota y el hijo queda en posición distinta.
    const childViewerX = childProps.positionViewer![0];
    const parentViewerX = parentProps.positionViewer![0];

    // X del hijo difiere de X del padre (el offset rotado tiene componente X)
    expect(Math.abs(childViewerX - parentViewerX)).toBeGreaterThan(0.1);
  });

  it('hijo con padre rotado tiene rotación de visor no-identidad', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    const props = elementToRenderProps(child, PREVIEW_ELEMENTS);
    expect(props.rotationViewer).not.toBeNull();
    // Si la rotación fuera identidad en visor, W sería 1 y XYZ serían 0.
    // El padre tiene rotación 45°Z → el hijo hereda → W < 1.
    expect(props.rotationViewer![3]).toBeLessThan(1);
  });
});
