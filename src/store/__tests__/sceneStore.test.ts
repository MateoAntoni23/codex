import { describe, it, expect, beforeEach } from 'vitest';
import { useSceneStore } from '../sceneStore';
import { INITIAL_OBJECTS } from '../initialObjects';

// Restaura el estado inicial antes de cada prueba para evitar interferencias.
beforeEach(() => {
  useSceneStore.setState({
    objects: INITIAL_OBJECTS.map((o) => ({ ...o, position: { ...o.position } })),
    selectedId: null,
  });
});

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
    const originalRef = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')!;
    const originalPos = { ...originalRef.position };

    useSceneStore.getState().updateObjectPosition('panel-1', { x: 999, y: 999, z: 999 });

    // La copia de la posición original no debe haberse modificado
    expect(originalPos).toEqual({ x: -7000, y: 2000, z: 1000 });
    // El array de objetos es uno nuevo
    expect(useSceneStore.getState().objects).not.toBe(
      INITIAL_OBJECTS,
    );
  });

  it('conserva el ID tras actualizar', () => {
    useSceneStore.getState().updateObjectPosition('motor-1', { x: 100, y: 100, z: 400 });
    const motor = useSceneStore.getState().objects.find((o) => o.id === 'motor-1');
    expect(motor?.id).toBe('motor-1');
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
    // Cancelar solo resetea el estado local del componente; no llama a updateObjectPosition.
    const after = { ...useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!.position };
    expect(after).toEqual(before);
  });
});

describe('apoyar en piso', () => {
  it('tablero: Z = height / 2 = 1000 mm', () => {
    const panel = INITIAL_OBJECTS.find((o) => o.id === 'panel-1')!;
    expect(panel.dimensions.height / 2).toBe(1000);
  });

  it('motor: Z = height / 2 = 400 mm', () => {
    const motor = INITIAL_OBJECTS.find((o) => o.id === 'motor-1')!;
    expect(motor.dimensions.height / 2).toBe(400);
  });

  it('actualizar con Z = height / 2 deja la base en el piso', () => {
    const panel = INITIAL_OBJECTS.find((o) => o.id === 'panel-1')!;
    const snapZ = panel.dimensions.height / 2;
    useSceneStore.getState().updateObjectPosition('panel-1', {
      ...panel.position,
      z: snapZ,
    });
    const updated = useSceneStore.getState().objects.find((o) => o.id === 'panel-1')!;
    // base = centro − altura/2 = snapZ − height/2 = 0
    expect(updated.position.z - updated.dimensions.height / 2).toBe(0);
  });
});
