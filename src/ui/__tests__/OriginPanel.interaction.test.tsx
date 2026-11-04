// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OriginPanel } from '../OriginPanel';
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

describe('OriginPanel — Aplicar', () => {
  it('Aplicar con valores válidos actualiza el store', async () => {
    render(<OriginPanel />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    const yInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^Y/i });
    const zInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^Z/i });

    await userEvent.clear(xInput);
    await userEvent.type(xInput, '1000');
    await userEvent.clear(yInput);
    await userEvent.type(yInput, '500');
    await userEvent.clear(zInput);
    await userEvent.type(zInput, '200');

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 1000, y: 500, z: 200 });
  });

  it('Aplicar con campo vacío muestra error y no modifica el store', async () => {
    render(<OriginPanel />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    await userEvent.clear(xInput);
    // deja X vacío

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/El campo no puede estar vacío/i)).toBeTruthy();
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('OriginPanel — Cancelar', () => {
  it('Cancelar restaura los inputs al origen actual sin modificar el store', async () => {
    render(<OriginPanel />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    await userEvent.clear(xInput);
    await userEvent.type(xInput, '9999');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(xInput.value).toBe('0');
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('OriginPanel — Restablecer', () => {
  it('Restablecer con origen previo lo vuelve a {0,0,0}', async () => {
    useSceneStore.setState({ projectOrigin: { x: 500, y: 300, z: 100 } });
    render(<OriginPanel />);

    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }));

    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    expect(xInput.value).toBe('0');
  });
});

describe('OriginPanel — bloqueo durante carga', () => {
  it('inputs y acciones deshabilitados cuando saveStatus=loading', () => {
    useSceneStore.setState({ saveStatus: 'loading' });
    render(<OriginPanel />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    expect(xInput.disabled).toBe(true);

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Aplicar' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancelar' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restablecer' }).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: /Usar centro del objeto seleccionado/i,
      }).disabled,
    ).toBe(true);
  });

  it('no modifica el origen durante carga aunque el store cambie', () => {
    useSceneStore.setState({ saveStatus: 'loading', projectOrigin: { x: 500, y: 300, z: 0 } });
    render(<OriginPanel />);

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    // El input refleja el origen actual pero está deshabilitado
    expect(xInput.value).toBe('500');
    expect(xInput.disabled).toBe(true);
    // El origen no cambia (nadie puede presionar Aplicar)
    expect(useSceneStore.getState().projectOrigin).toEqual({ x: 500, y: 300, z: 0 });
  });
});

describe('OriginPanel — Usar centro del objeto seleccionado', () => {
  it('sin selección el botón está deshabilitado', () => {
    render(<OriginPanel />);
    const btn = screen.getByRole<HTMLButtonElement>('button', {
      name: /Usar centro del objeto seleccionado/i,
    });
    expect(btn.disabled).toBe(true);
  });

  it('con motor-1 seleccionado fija el origen en su posición', async () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    render(<OriginPanel />);

    const btn = screen.getByRole('button', { name: /Usar centro del objeto seleccionado/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(btn);

    const motor = INITIAL_OBJECTS.find((o) => o.id === 'motor-1')!;
    expect(useSceneStore.getState().projectOrigin).toEqual(motor.position);
  });

  it('los inputs se sincronizan al nuevo origen tras usar centro', async () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    render(<OriginPanel />);

    await userEvent.click(
      screen.getByRole('button', { name: /Usar centro del objeto seleccionado/i }),
    );

    const motor = INITIAL_OBJECTS.find((o) => o.id === 'motor-1')!;
    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    expect(xInput.value).toBe(String(motor.position.x));
  });
});
