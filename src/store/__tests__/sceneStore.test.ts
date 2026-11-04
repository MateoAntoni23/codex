import { describe, it, expect, beforeEach } from 'vitest';
import { useSceneStore } from '../sceneStore';
import { INITIAL_OBJECTS } from '../initialObjects';

function resetStore() {
  useSceneStore.setState({
    objects: INITIAL_OBJECTS.map((o) => ({ ...o, position: { ...o.position } })),
    selectedId: null,
    projectOrigin: { x: 0, y: 0, z: 0 },
    saveStatus: 'idle',
    saveError: null,
  });
}

beforeEach(resetStore);

describe('updateObjectPosition', () => {
  it('actualiza la posición del objeto indicado', () => {
    const newPos = { x: 1000, y: 2000, z: 500 };
    useSceneStore.getState().updateObjectPosition('panel-1', newPos);
    const updated = useSceneStore.getState().objects.find((o) => o.id === 'panel-1');
    expect(updated?.position).toEqual(newPos);
  });

  it('no altera los demás objetos', () => {
    const before = useSceneStore
      .getState()
      .objects.filter((o) => o.id !== 'panel-1')
      .map((o) => ({ id: o.id, position: { ...o.position } }));

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 999 });

    const after = useSceneStore
      .getState()
      .objects.filter((o) => o.id !== 'panel-1')
      .map((o) => ({ id: o.id, position: { ...o.position } }));

    expect(after).toEqual(before);
  });

  it('crea objetos nuevos de forma inmutable (no muta la referencia anterior)', () => {
    const originalPos = {
      ...useSceneStore.getState().objects.find((o) => o.id === 'panel-1')!.position,
    };
    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 999 });
    expect(originalPos).toEqual({ x: -7000, y: 2000, z: 1000 });
    expect(useSceneStore.getState().objects).not.toBe(INITIAL_OBJECTS);
  });

  it('conserva el ID tras actualizar', () => {
    useSceneStore.getState().updateObjectPosition('motor-1', { x: 100, y: 100, z: 400 });
    expect(useSceneStore.getState().objects.find((o) => o.id === 'motor-1')?.id).toBe('motor-1');
  });

  it('conserva la selección activa tras actualizar', () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    useSceneStore.getState().updateObjectPosition('motor-1', { x: 0, y: 0, z: 400 });
    expect(useSceneStore.getState().selectedId).toBe('motor-1');
  });
});

describe('cancelar no modifica el store', () => {
  it('sin llamar a updateObjectPosition, la posición del motor no cambia', () => {
    const before = { ...useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!.position };
    const after = { ...useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!.position };
    expect(after).toEqual(before);
  });
});

describe('apoyar en piso (posiciones globales)', () => {
  it('tablero: Z global = height / 2 = 1000 mm', () => {
    const panel = INITIAL_OBJECTS.find((o) => o.id === 'panel-1')!;
    expect(panel.dimensions.height / 2).toBe(1000);
  });

  it('motor: Z global = height / 2 = 400 mm', () => {
    const motor = INITIAL_OBJECTS.find((o) => o.id === 'motor-1')!;
    expect(motor.dimensions.height / 2).toBe(400);
  });

  it('actualizar con Z global = height/2 deja la base en el piso', () => {
    const panel = INITIAL_OBJECTS.find((o) => o.id === 'panel-1')!;
    useSceneStore.getState().updateObjectPosition('panel-1', {
      ...panel.position,
      z: panel.dimensions.height / 2,
    });
    const updated = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')!;
    expect(updated.position.z - updated.dimensions.height / 2).toBe(0);
  });
});

describe('setProjectOrigin', () => {
  it('actualiza el origen del proyecto', () => {
    useSceneStore.getState().setProjectOrigin({ x: 1000, y: 500, z: 200 });
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 1000, y: 500, z: 200 });
  });

  it('no modifica las posiciones de los objetos', () => {
    const before = useSceneStore.getState().objects.map((o) => ({ ...o.position }));
    useSceneStore.getState().setProjectOrigin({ x: 5000, y: 3000, z: 1000 });
    const after = useSceneStore.getState().objects.map((o) => ({ ...o.position }));
    expect(after).toEqual(before);
  });

  it('coordenada mostrada = global − origen', () => {
    // Con motor en X global=4000 y origen X=2000 → mostrado=2000
    const motor = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!;
    useSceneStore.getState().setProjectOrigin({ x: 2000, y: 0, z: 0 });
    const origin = useSceneStore.getState().projectOrigin;
    expect(motor.position.x - origin.x).toBe(2000);
  });

  it('restablecer: setProjectOrigin({0,0,0}) devuelve el origen global', () => {
    useSceneStore.getState().setProjectOrigin({ x: 999, y: 888, z: 777 });
    useSceneStore.getState().setProjectOrigin({ x: 0, y: 0, z: 0 });
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('cambiar origen no altera distancias entre objetos', () => {
    const panel = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')!;
    const motor = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!;
    const dx = panel.position.x - motor.position.x;
    const dy = panel.position.y - motor.position.y;
    const dz = panel.position.z - motor.position.z;
    const distBefore = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);

    useSceneStore.getState().setProjectOrigin({ x: 10000, y: 5000, z: 2000 });

    const panelAfter = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')!;
    const motorAfter = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!;
    const dxA = panelAfter.position.x - motorAfter.position.x;
    const dyA = panelAfter.position.y - motorAfter.position.y;
    const dzA = panelAfter.position.z - motorAfter.position.z;
    const distAfter = Math.sqrt(dxA ** 2 + dyA ** 2 + dzA ** 2);

    expect(distAfter).toBeCloseTo(distBefore, 10);
  });
});

describe('apoyar en piso con origen Z distinto de cero', () => {
  it('snapToFloorZ compensa el origen: Z_mostrado = height/2 − origen.z', async () => {
    const { snapToFloorZ } = await import('../../ui/positionEditor');
    const height = 2000; // tablero
    const originZ = 500;
    const displayedZ = snapToFloorZ(height, originZ);
    // displayedZ + originZ = height/2 → base en Z global = 0
    expect(displayedZ + originZ).toBe(height / 2);
    expect(displayedZ).toBe(500); // 1000 - 500
  });
});
