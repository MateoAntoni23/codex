import { describe, it, expect } from 'vitest';
import { IDENTITY_QUATERNION, type EquipmentElement, type Vec3, type Quaternion } from '../../types/domain-v2';
import { resolveGlobalTransform, elementToRenderProps } from '../v2-adapter';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UNKNOWN_DATUM = { value: null, status: 'unknown' as const, evidenceIds: [] };
const DEFAULT_LOCATION = { kind: 'unassigned' as const, factoryId: null, subareaId: null, description: null };
const BASE_TECHNICAL = {
  ipRating: UNKNOWN_DATUM,
  ratedCurrent: UNKNOWN_DATUM,
};

function makePlacedPanel(
  id: string,
  positionMm: Vec3,
  options: {
    parentId?: string | null;
    rotation?: Quaternion;
  } = {},
): EquipmentElement {
  return {
    id,
    name: `Panel ${id}`,
    tag: null,
    aliases: [],
    physicalLocation: DEFAULT_LOCATION,
    condition: 'unknown',
    lifecycle: 'active',
    parentId: options.parentId ?? null,
    geometry: { kind: 'box', widthMm: 400, depthMm: 300, heightMm: 2000 },
    mounting: 'floor',
    manufacturer: UNKNOWN_DATUM,
    model: UNKNOWN_DATUM,
    version: 1,
    placementStatus: 'placed',
    transform: { positionMm, rotation: options.rotation ?? IDENTITY_QUATERNION },
    category: 'electrical_panel',
    technical: BASE_TECHNICAL,
  };
}

function makeUnplacedPanel(id: string): EquipmentElement {
  return {
    id,
    name: `Panel ${id}`,
    tag: null,
    aliases: [],
    physicalLocation: DEFAULT_LOCATION,
    condition: 'unknown',
    lifecycle: 'active',
    parentId: null,
    geometry: { kind: 'box', widthMm: 400, depthMm: 300, heightMm: 2000 },
    mounting: 'floor',
    manufacturer: UNKNOWN_DATUM,
    model: UNKNOWN_DATUM,
    version: 1,
    placementStatus: 'unplaced',
    transform: null,
    category: 'electrical_panel',
    technical: BASE_TECHNICAL,
  };
}

const SQRT2_OVER_2 = Math.SQRT2 / 2;

function expectClose(actual: number, expected: number, label = ''): void {
  expect(actual, label).toBeCloseTo(expected, 10);
}

// ─── resolveGlobalTransform ───────────────────────────────────────────────────

describe('resolveGlobalTransform — elemento sin padre (migrado)', () => {
  it('devuelve la posición y rotación locales cuando no hay padre', () => {
    const pos = { x: 1000, y: 2000, z: 500 };
    const el = makePlacedPanel('a', pos);
    const result = resolveGlobalTransform('a', [el]);
    expect(result).not.toBeNull();
    expect(result!.positionMm).toEqual(pos);
    expect(result!.rotation).toEqual(IDENTITY_QUATERNION);
  });

  it('devuelve null para un elemento sin posicionar', () => {
    const el = makeUnplacedPanel('a');
    expect(resolveGlobalTransform('a', [el])).toBeNull();
  });

  it('devuelve null si el id no existe en la lista', () => {
    expect(resolveGlobalTransform('nope', [])).toBeNull();
  });
});

describe('resolveGlobalTransform — jerarquía padre→hijo', () => {
  it('padre en origen con identidad → posición global del hijo igual a su posición local', () => {
    const parent = makePlacedPanel('p', { x: 0, y: 0, z: 0 });
    const child = makePlacedPanel('c', { x: 500, y: 300, z: 100 }, { parentId: 'p' });
    const result = resolveGlobalTransform('c', [parent, child]);
    expect(result).not.toBeNull();
    expectClose(result!.positionMm.x, 500);
    expectClose(result!.positionMm.y, 300);
    expectClose(result!.positionMm.z, 100);
  });

  it('padre trasladado → posición global del hijo es suma de las posiciones', () => {
    const parent = makePlacedPanel('p', { x: 1000, y: 0, z: 0 });
    const child = makePlacedPanel('c', { x: 500, y: 0, z: 0 }, { parentId: 'p' });
    const result = resolveGlobalTransform('c', [parent, child]);
    expect(result).not.toBeNull();
    expectClose(result!.positionMm.x, 1500);
  });

  it('padre rotado 90° alrededor de Z transforma posición local del hijo', () => {
    // Rotación 90° alrededor de Z: {x:0, y:0, z:√2/2, w:√2/2}
    const q90z: Quaternion = { x: 0, y: 0, z: SQRT2_OVER_2, w: SQRT2_OVER_2 };
    const parent = makePlacedPanel('p', { x: 0, y: 0, z: 0 }, { rotation: q90z });
    // Hijo en local X → tras rotación del padre queda en Y global
    const child = makePlacedPanel('c', { x: 1000, y: 0, z: 0 }, { parentId: 'p' });
    const result = resolveGlobalTransform('c', [parent, child]);
    expect(result).not.toBeNull();
    expectClose(result!.positionMm.x, 0);
    expectClose(result!.positionMm.y, 1000);
    expectClose(result!.positionMm.z, 0);
  });

  it('padre sin posicionar → hijo devuelve null', () => {
    const parent = makeUnplacedPanel('p');
    const child = makePlacedPanel('c', { x: 0, y: 0, z: 0 }, { parentId: 'p' });
    expect(resolveGlobalTransform('c', [parent, child])).toBeNull();
  });

  it('parentId inexistente → devuelve null sin lanzar excepción', () => {
    const child = makePlacedPanel('c', { x: 0, y: 0, z: 0 }, { parentId: 'missing' });
    expect(resolveGlobalTransform('c', [child])).toBeNull();
  });

  it('ciclo directo A→B→A → devuelve null sin lanzar excepción', () => {
    const a = makePlacedPanel('a', { x: 0, y: 0, z: 0 }, { parentId: 'b' });
    const b = makePlacedPanel('b', { x: 0, y: 0, z: 0 }, { parentId: 'a' });
    expect(resolveGlobalTransform('a', [a, b])).toBeNull();
  });

  it('ciclo indirecto A→B→C→A → devuelve null sin lanzar excepción', () => {
    const a = makePlacedPanel('a', { x: 0, y: 0, z: 0 }, { parentId: 'b' });
    const b = makePlacedPanel('b', { x: 0, y: 0, z: 0 }, { parentId: 'c' });
    const c = makePlacedPanel('c', { x: 0, y: 0, z: 0 }, { parentId: 'a' });
    expect(resolveGlobalTransform('a', [a, b, c])).toBeNull();
  });
});

// ─── elementToRenderProps — conversión de coordenadas ────────────────────────

describe('elementToRenderProps — conversión de posición', () => {
  it('posición en dominio [1000mm, 2000mm, 500mm] → viewer [1m, 0.5m, -2m]', () => {
    const el = makePlacedPanel('a', { x: 1000, y: 2000, z: 500 });
    const props = elementToRenderProps(el, [el]);
    expect(props.placed).toBe(true);
    expect(props.positionViewer).not.toBeNull();
    expectClose(props.positionViewer![0], 1);
    expectClose(props.positionViewer![1], 0.5);
    expectClose(props.positionViewer![2], -2);
  });

  it('elemento sin posicionar → placed:false, posición y tamaño nulos', () => {
    const el = makeUnplacedPanel('a');
    const props = elementToRenderProps(el, [el]);
    expect(props.placed).toBe(false);
    expect(props.positionViewer).toBeNull();
    expect(props.rotationViewer).toBeNull();
    expect(props.sizeViewer).toBeNull();
  });
});

describe('elementToRenderProps — conversión de rotación', () => {
  it('identidad en dominio → rotationViewer = Q_base = {x:-√2/2, y:0, z:0, w:√2/2}', () => {
    const el = makePlacedPanel('a', { x: 0, y: 0, z: 0 });
    const props = elementToRenderProps(el, [el]);
    expect(props.rotationViewer).not.toBeNull();
    expectClose(props.rotationViewer![0], -SQRT2_OVER_2, 'x');
    expectClose(props.rotationViewer![1], 0, 'y');
    expectClose(props.rotationViewer![2], 0, 'z');
    expectClose(props.rotationViewer![3], SQRT2_OVER_2, 'w');
  });

  it('rotación de padre 90° Z transforma posición del hijo y compone la rotación', () => {
    const q90z: Quaternion = { x: 0, y: 0, z: SQRT2_OVER_2, w: SQRT2_OVER_2 };
    const parent = makePlacedPanel('p', { x: 0, y: 0, z: 0 }, { rotation: q90z });
    const child = makePlacedPanel('c', { x: 1000, y: 0, z: 0 }, { parentId: 'p' });
    const props = elementToRenderProps(child, [parent, child]);
    expect(props.placed).toBe(true);
    // Posición global en dominio: {x:0, y:1000, z:0} → viewer [0, 0, -1]
    expectClose(props.positionViewer![0], 0, 'viewer x');
    expectClose(props.positionViewer![1], 0, 'viewer y');
    expectClose(props.positionViewer![2], -1, 'viewer z');
    // Rotación global del hijo = q90z × identity = q90z
    // Rotación viewer = Q_base × q90z = {x:-0.5, y:0.5, z:0.5, w:0.5}
    expectClose(props.rotationViewer![0], -0.5, 'rot x');
    expectClose(props.rotationViewer![1], 0.5, 'rot y');
    expectClose(props.rotationViewer![2], 0.5, 'rot z');
    expectClose(props.rotationViewer![3], 0.5, 'rot w');
  });
});

// ─── elementToRenderProps — conversión de tamaños por tipo de geometría ──────

describe('elementToRenderProps — geometría box', () => {
  it('width, height, depth en mm → viewer [w/1000, h/1000, d/1000]', () => {
    const el = makePlacedPanel('a', { x: 0, y: 0, z: 0 });
    // makePlacedPanel usa box{widthMm:400, depthMm:300, heightMm:2000}
    const props = elementToRenderProps(el, [el]);
    expect(props.geometryKind).toBe('box');
    expect(props.sizeViewer).not.toBeNull();
    expectClose(props.sizeViewer![0], 0.4, 'width');
    expectClose(props.sizeViewer![1], 2.0, 'height');
    expectClose(props.sizeViewer![2], 0.3, 'depth');
  });
});

describe('elementToRenderProps — geometría cylinder', () => {
  it('diameterMm y lengthMm → viewer [d/1000, l/1000, d/1000]', () => {
    const el: EquipmentElement = {
      ...makePlacedPanel('a', { x: 0, y: 0, z: 0 }),
      geometry: { kind: 'cylinder', diameterMm: 200, lengthMm: 1500 },
    } as EquipmentElement;
    const props = elementToRenderProps(el, [el]);
    expect(props.geometryKind).toBe('cylinder');
    expect(props.sizeViewer).not.toBeNull();
    expectClose(props.sizeViewer![0], 0.2, 'diameter x');
    expectClose(props.sizeViewer![1], 1.5, 'length y');
    expectClose(props.sizeViewer![2], 0.2, 'diameter z');
  });
});

describe('elementToRenderProps — geometría plane', () => {
  it('widthMm y depthMm → viewer [w/1000, 0, d/1000]', () => {
    const el: EquipmentElement = {
      ...makePlacedPanel('a', { x: 0, y: 0, z: 0 }),
      geometry: { kind: 'plane', widthMm: 3000, depthMm: 1500 },
      mounting: 'floor',
    } as EquipmentElement;
    const props = elementToRenderProps(el, [el]);
    expect(props.geometryKind).toBe('plane');
    expectClose(props.sizeViewer![0], 3.0, 'width');
    expectClose(props.sizeViewer![1], 0, 'height (plano)');
    expectClose(props.sizeViewer![2], 1.5, 'depth');
    expect(props.isFloor).toBe(true);
  });

  it('plane no montado en piso → isFloor:false', () => {
    const el: EquipmentElement = {
      ...makePlacedPanel('a', { x: 0, y: 0, z: 0 }),
      geometry: { kind: 'plane', widthMm: 1000, depthMm: 500 },
      mounting: 'wall',
    } as EquipmentElement;
    const props = elementToRenderProps(el, [el]);
    expect(props.isFloor).toBe(false);
  });
});

describe('elementToRenderProps — geometría asset', () => {
  it('boundsMm {x,y,z} → viewer [x/1000, z/1000, y/1000]', () => {
    const el: EquipmentElement = {
      ...makePlacedPanel('a', { x: 0, y: 0, z: 0 }),
      geometry: { kind: 'asset', assetId: 'pump-3d', boundsMm: { x: 600, y: 400, z: 800 } },
    } as EquipmentElement;
    const props = elementToRenderProps(el, [el]);
    expect(props.geometryKind).toBe('asset');
    expect(props.sizeViewer).not.toBeNull();
    expectClose(props.sizeViewer![0], 0.6, 'x→width');
    expectClose(props.sizeViewer![1], 0.8, 'z→height');
    expectClose(props.sizeViewer![2], 0.4, 'y→depth');
  });
});

describe('elementToRenderProps — geometría desconocida (null)', () => {
  it('geometry:null → geometryKind:unknown, sizeViewer:null, placed:true', () => {
    const el: EquipmentElement = {
      ...makePlacedPanel('a', { x: 500, y: 0, z: 0 }),
      geometry: null,
    } as EquipmentElement;
    const props = elementToRenderProps(el, [el]);
    expect(props.placed).toBe(true);
    expect(props.geometryKind).toBe('unknown');
    expect(props.sizeViewer).toBeNull();
    // posición y rotación sí son válidas (el elemento está posicionado)
    expect(props.positionViewer).not.toBeNull();
  });
});

// ─── elementToRenderProps — ancestro sin posicionar ──────────────────────────

describe('elementToRenderProps — ancestro sin posicionar', () => {
  it('padre sin posicionar → hijo devuelve placed:false aunque él mismo esté placed', () => {
    const parent = makeUnplacedPanel('p');
    const child = makePlacedPanel('c', { x: 100, y: 200, z: 50 }, { parentId: 'p' });
    const props = elementToRenderProps(child, [parent, child]);
    expect(props.placed).toBe(false);
    expect(props.positionViewer).toBeNull();
  });

  it('padre faltante → hijo devuelve placed:false', () => {
    const child = makePlacedPanel('c', { x: 0, y: 0, z: 0 }, { parentId: 'ghost' });
    const props = elementToRenderProps(child, [child]);
    expect(props.placed).toBe(false);
  });

  it('ciclo → devuelve placed:false sin lanzar excepción', () => {
    const a = makePlacedPanel('a', { x: 0, y: 0, z: 0 }, { parentId: 'b' });
    const b = makePlacedPanel('b', { x: 0, y: 0, z: 0 }, { parentId: 'a' });
    expect(() => elementToRenderProps(a, [a, b])).not.toThrow();
    expect(elementToRenderProps(a, [a, b]).placed).toBe(false);
  });
});

// ─── elementToRenderProps — campos básicos ───────────────────────────────────

describe('elementToRenderProps — campos id, name, category', () => {
  it('propaga correctamente id, name y category', () => {
    const el = makePlacedPanel('panel-1', { x: 0, y: 0, z: 0 });
    const props = elementToRenderProps(el, [el]);
    expect(props.id).toBe('panel-1');
    expect(props.name).toBe('Panel panel-1');
    expect(props.category).toBe('electrical_panel');
  });
});
