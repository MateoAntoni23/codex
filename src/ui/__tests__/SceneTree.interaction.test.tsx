// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SceneTree } from '../SceneTree';
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

// ─── Agrupación y contadores ───────────────────────────────────────────────────

describe('SceneTree — agrupación y contadores', () => {
  it('muestra las 8 categorías definidas', () => {
    render(<SceneTree />);
    for (const label of [
      'Tableros', 'Motores', 'Bombas', 'Válvulas',
      'Sensores', 'Iluminación', 'Botoneras', 'Infraestructura',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeTruthy();
    }
  });

  it('Tableros y Motores muestran (1), Bombas muestra (0)', () => {
    render(<SceneTree />);
    expect(screen.getByRole('button', { name: /Tableros/i }).textContent).toContain('(1)');
    expect(screen.getByRole('button', { name: /Motores/i }).textContent).toContain('(1)');
    expect(screen.getByRole('button', { name: /Bombas/i }).textContent).toContain('(0)');
  });

  it('Infraestructura muestra (2)', () => {
    render(<SceneTree />);
    expect(screen.getByRole('button', { name: /Infraestructura/i }).textContent).toContain('(2)');
  });

  it('Piso y Nave Industrial aparecen bajo Infraestructura', () => {
    render(<SceneTree />);
    expect(screen.getByText('Piso')).toBeTruthy();
    expect(screen.getByText('Nave Industrial')).toBeTruthy();
  });

  it('Tablero Eléctrico y Motor Eléctrico aparecen en sus categorías', () => {
    render(<SceneTree />);
    expect(screen.getByText('Tablero Eléctrico')).toBeTruthy();
    expect(screen.getByText('Motor Eléctrico')).toBeTruthy();
  });
});

// ─── Estado expandido inicial ──────────────────────────────────────────────────

describe('SceneTree — estado expandido inicial', () => {
  it('categorías con elementos están abiertas por defecto', () => {
    render(<SceneTree />);
    expect(screen.getByRole('button', { name: /Tableros/i }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Motores/i }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Infraestructura/i }).getAttribute('aria-expanded')).toBe('true');
  });

  it('categorías vacías están cerradas por defecto', () => {
    render(<SceneTree />);
    expect(screen.getByRole('button', { name: /Bombas/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Válvulas/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Sensores/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Iluminación/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Botoneras/i }).getAttribute('aria-expanded')).toBe('false');
  });
});

// ─── Expandir y contraer ──────────────────────────────────────────────────────

describe('SceneTree — expandir y contraer', () => {
  it('clic en cabecera colapsa una categoría abierta y oculta sus items', async () => {
    render(<SceneTree />);
    const header = screen.getByRole('button', { name: /Tableros/i });
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Tablero Eléctrico')).toBeNull();
  });

  it('segundo clic expande de nuevo la categoría', async () => {
    render(<SceneTree />);
    const header = screen.getByRole('button', { name: /Tableros/i });
    await userEvent.click(header);
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Tablero Eléctrico')).toBeTruthy();
  });

  it('expandir categoría vacía cambia aria-expanded a true (sin items)', async () => {
    render(<SceneTree />);
    const header = screen.getByRole('button', { name: /Bombas/i });
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    // No items to show — the ul is not rendered
    expect(screen.queryByRole('listitem', { name: /bomba/i })).toBeNull();
  });
});

// ─── Selección ────────────────────────────────────────────────────────────────

describe('SceneTree — selección', () => {
  it('clic en Motor Eléctrico establece selectedId=motor-1', async () => {
    render(<SceneTree />);
    await userEvent.click(screen.getByText('Motor Eléctrico'));
    expect(useSceneStore.getState().selectedId).toBe('motor-1');
  });

  it('clic en Tablero Eléctrico establece selectedId=panel-1', async () => {
    render(<SceneTree />);
    await userEvent.click(screen.getByText('Tablero Eléctrico'));
    expect(useSceneStore.getState().selectedId).toBe('panel-1');
  });

  it('clic en Piso no modifica selectedId', async () => {
    render(<SceneTree />);
    await userEvent.click(screen.getByText('Piso'));
    expect(useSceneStore.getState().selectedId).toBeNull();
  });

  it('segundo clic en el motor seleccionado lo deselecciona', async () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    render(<SceneTree />);
    await userEvent.click(screen.getByText('Motor Eléctrico'));
    expect(useSceneStore.getState().selectedId).toBeNull();
  });

  it('contraer Motores no deselecciona motor-1', async () => {
    useSceneStore.setState({ selectedId: 'motor-1' });
    render(<SceneTree />);
    await userEvent.click(screen.getByRole('button', { name: /Motores/i }));
    expect(useSceneStore.getState().selectedId).toBe('motor-1');
  });
});

// ─── Teclado ──────────────────────────────────────────────────────────────────

describe('SceneTree — teclado', () => {
  it('Enter en cabecera colapsa la categoría', async () => {
    render(<SceneTree />);
    const header = screen.getByRole('button', { name: /Tableros/i });
    header.focus();
    await userEvent.keyboard('{Enter}');
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('Space en cabecera colapsa la categoría', async () => {
    render(<SceneTree />);
    const header = screen.getByRole('button', { name: /Motores/i });
    header.focus();
    await userEvent.keyboard(' ');
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter en item seleccionable establece la selección', async () => {
    render(<SceneTree />);
    const motorItem = screen.getByText('Motor Eléctrico').closest('li')!;
    motorItem.focus();
    await userEvent.keyboard('{Enter}');
    expect(useSceneStore.getState().selectedId).toBe('motor-1');
  });

  it('Space en item seleccionable establece la selección', async () => {
    render(<SceneTree />);
    const motorItem = screen.getByText('Motor Eléctrico').closest('li')!;
    motorItem.focus();
    await userEvent.keyboard(' ');
    expect(useSceneStore.getState().selectedId).toBe('motor-1');
  });
});

// ─── No modifica estado del store al expandir/contraer ───────────────────────

describe('SceneTree — no modifica estado del store al abrir/cerrar', () => {
  it('expandir/contraer no modifica objetos, origen ni saveStatus', async () => {
    render(<SceneTree />);
    const before = {
      objects: useSceneStore.getState().objects,
      projectOrigin: useSceneStore.getState().projectOrigin,
      saveStatus: useSceneStore.getState().saveStatus,
    };

    await userEvent.click(screen.getByRole('button', { name: /Tableros/i }));
    await userEvent.click(screen.getByRole('button', { name: /Tableros/i }));
    await userEvent.click(screen.getByRole('button', { name: /Bombas/i }));

    expect(useSceneStore.getState().objects).toBe(before.objects);
    expect(useSceneStore.getState().projectOrigin).toBe(before.projectOrigin);
    expect(useSceneStore.getState().saveStatus).toBe(before.saveStatus);
  });
});
