// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from '../Inspector';
import { useSceneStore } from '../../store/sceneStore';
import { INITIAL_OBJECTS } from '../../store/initialObjects';

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

const BLOCKING_STATUSES = ['loading', 'recovering'] as const;

describe('Inspector — visualización con origen', () => {
  it('motor seleccionado con origen X=2000 muestra X=2000 (global 4000 − 2000)', () => {
    useSceneStore.setState({ selectedId: 'motor-1', projectOrigin: { x: 2000, y: 0, z: 0 } });
    render(<Inspector />);
    // motor-1 tiene position.x = 4000; 4000 - 2000 = 2000
    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    expect(xInput.value).toBe('2000');
  });

  it('sin selección muestra mensaje vacío', () => {
    render(<Inspector />);
    expect(screen.getByText('Seleccioná un objeto')).toBeTruthy();
  });
});

describe('Inspector — Aplicar', () => {
  it('Aplicar con X=4500 y origen X=2000 guarda global X=6500', async () => {
    useSceneStore.setState({ selectedId: 'motor-1', projectOrigin: { x: 2000, y: 0, z: 0 } });
    render(<Inspector />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    await userEvent.clear(xInput);
    await userEvent.type(xInput, '4500');

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const motor = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!;
    expect(motor.position.x).toBe(6500); // 4500 + 2000
  });

  it('Aplicar con entrada inválida muestra error y no modifica el store', async () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    render(<Inspector />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    await userEvent.clear(xInput);
    await userEvent.type(xInput, 'abc');

    const before = { ...useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!.position };
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/Ingresá un número válido/i)).toBeTruthy();
    const after = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!.position;
    expect(after).toEqual(before);
  });
});

describe('Inspector — Cancelar', () => {
  it('Cancelar descarta cambios y restaura la posición actual del objeto', async () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    const originalX = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!.position.x;

    render(<Inspector />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    await userEvent.clear(xInput);
    await userEvent.type(xInput, '99999');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(xInput.value).toBe(String(originalX));
    const motor = useSceneStore.getState().objects.find((o) => o.id === 'motor-1')!;
    expect(motor.position.x).toBe(originalX); // store sin cambios
  });
});

describe('Inspector — cambio de origen descarta borradores', () => {
  it('al cambiar el origen los inputs se actualizan al nuevo valor relativo', async () => {
    useSceneStore.setState({ selectedId: 'panel-1', projectOrigin: { x: 0, y: 0, z: 0 } });
    render(<Inspector />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    // Escribimos un valor nuevo sin aplicar
    await userEvent.clear(xInput);
    await userEvent.type(xInput, '12345');

    // Cambiamos el origen externamente (act para que React re-renderice)
    act(() => {
      useSceneStore.setState({ projectOrigin: { x: 1000, y: 0, z: 0 } });
    });

    // panel-1 position.x = -7000; -7000 - 1000 = -8000
    expect(xInput.value).toBe('-8000');
  });
});

describe('Inspector — Apoyar en piso con origen Z', () => {
  it('snap con originZ=500 rellena Z con 500 (height/2 − originZ = 1000 − 500)', async () => {
    useSceneStore.setState({ selectedId: 'panel-1', projectOrigin: { x: 0, y: 0, z: 500 } });
    render(<Inspector />);

    await userEvent.click(screen.getByRole('button', { name: /Apoyar en piso/i }));

    const zInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Z/i });
    expect(zInput.value).toBe('500'); // 2000/2 - 500
  });
});

describe('Inspector — bloqueo durante loading y recovering', () => {
  it.each(BLOCKING_STATUSES)(
    'inputs y botones deshabilitados cuando saveStatus=%s',
    (status) => {
      useSceneStore.setState({ selectedId: 'panel-1', saveStatus: status });
      render(<Inspector />);

      const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
      expect(xInput.disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Aplicar' }).disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancelar' }).disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Apoyar en piso/i }).disabled).toBe(true);
    },
  );
});
