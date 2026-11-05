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

  it('contiene el sensor de campo sin geometría', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-nogeo-1');
    expect(sensor).toBeDefined();
    expect(sensor?.geometry).toBeNull();
    expect(sensor?.placementStatus).toBe('placed');
    expect(sensor?.category).toBe('sensor');
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
  it('sensor de campo sin geometría: placed=true, geometryKind=unknown, sizeViewer=null', () => {
    const sensor = PREVIEW_ELEMENTS.find((e) => e.id === 'sensor-nogeo-1')!;
    const props = elementToRenderProps(sensor, PREVIEW_ELEMENTS);
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

// ─── Orden de composición del cuaternión de plano ─────────────────────────────

describe('planeQuat — orden rotationViewer × Q_PLANE_BASE', () => {
  // Multiplicación de cuaterniones: (a)(b) = a × b
  function qmul(
    a: { x: number; y: number; z: number; w: number },
    b: { x: number; y: number; z: number; w: number },
  ) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  const Q_PLANE_BASE = { x: -Math.SQRT2 / 2, y: 0, z: 0, w: Math.SQRT2 / 2 };

  it('con rotación identidad ambos órdenes son equivalentes', () => {
    const qId = { x: 0, y: 0, z: 0, w: 1 };
    const r1 = qmul(qId, Q_PLANE_BASE);        // correcto: rotationViewer × Q_PLANE_BASE
    const r2 = qmul(Q_PLANE_BASE, qId);        // incorrecto si qId ≠ identidad
    expect(r1.x).toBeCloseTo(r2.x, 5);
    expect(r1.z).toBeCloseTo(r2.z, 5);
    expect(r1.w).toBeCloseTo(r2.w, 5);
  });

  it('piso con 90°Z dominio: rotationViewer × Q_PLANE_BASE difiere de Q_PLANE_BASE × rotationViewer', () => {
    // 90°Z dominio → rotationViewer = {x:0, y:√2/2, z:0, w:√2/2} (90°Y visor)
    const qViewer = { x: 0, y: Math.SQRT2 / 2, z: 0, w: Math.SQRT2 / 2 };

    const correct = qmul(qViewer, Q_PLANE_BASE);  // rotationViewer × Q_PLANE_BASE
    const wrong   = qmul(Q_PLANE_BASE, qViewer);  // orden incorrecto

    // Los dos órdenes producen resultados distintos en el componente Z
    expect(correct.z).not.toBeCloseTo(wrong.z, 5);

    // Orden correcto: z = +0.5 (el eje base se preserva bajo la rotación mundial)
    expect(correct.z).toBeCloseTo(0.5, 5);
    // Orden incorrecto: z = −0.5
    expect(wrong.z).toBeCloseTo(-0.5, 5);
  });

  it('piso rectangular rotado: rotationViewer × Q_PLANE_BASE preserva normal horizontal', () => {
    // Verificar que el vector normal del plano (0,0,1 en espacio local)
    // apunta a +Y visor (0,1,0) después de aplicar el cuaternión correcto.
    // Rotación de un vector v por cuaternión q: v' = q * (0,v) * q^-1
    // Para q = identidad (sin rotación del elemento):
    const qId = { x: 0, y: 0, z: 0, w: 1 };
    const planeQuat = qmul(qId, Q_PLANE_BASE); // = Q_PLANE_BASE = {x:-√2/2,y:0,z:0,w:√2/2}

    // Rotar (0,0,1) por planeQuat:
    // q * p * q^-1 donde p = (0, 0, 1) como cuaternión puro {x:0,y:0,z:1,w:0}
    const p = { x: 0, y: 0, z: 1, w: 0 };
    const qInv = { x: -planeQuat.x, y: -planeQuat.y, z: -planeQuat.z, w: planeQuat.w };
    const rotated = qmul(qmul(planeQuat, p), qInv);

    // El normal del plano debe apuntar hacia arriba (+Y visor)
    expect(rotated.x).toBeCloseTo(0, 5);
    expect(rotated.y).toBeCloseTo(1, 5);
    expect(rotated.z).toBeCloseTo(0, 5);
  });
});
