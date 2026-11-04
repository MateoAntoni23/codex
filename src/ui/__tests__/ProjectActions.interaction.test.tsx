// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectActions } from '../ProjectActions';
import { useSceneStore } from '../../store/sceneStore';
import { INITIAL_OBJECTS } from '../../store/initialObjects';

// Mock projectManager so tests don't hit real IndexedDB or file system.
vi.mock('../../persistence/projectManager', () => ({
  exportProject: vi.fn(),
  importProject: vi.fn(),
  resetProject: vi.fn(),
  recoverProject: vi.fn(),
  initProject: vi.fn(),
}));

import { exportProject, importProject, resetProject, recoverProject } from '../../persistence/projectManager';

const mockExport = exportProject as ReturnType<typeof vi.fn>;
const mockImport = importProject as ReturnType<typeof vi.fn>;
const mockReset = resetProject as ReturnType<typeof vi.fn>;
const mockRecover = recoverProject as ReturnType<typeof vi.fn>;

function resetStore() {
  useSceneStore.setState({
    objects: INITIAL_OBJECTS.map((o) => ({ ...o, position: { ...o.position } })),
    selectedId: null,
    projectOrigin: { x: 0, y: 0, z: 0 },
    saveStatus: 'idle',
    saveError: null,
  });
}

beforeEach(() => {
  resetStore();
  mockExport.mockReset();
  mockImport.mockReset();
  mockReset.mockReset();
  mockRecover.mockReset();
  mockImport.mockResolvedValue({ ok: true });
  mockRecover.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectActions — indicador de estado', () => {
  it('muestra "Cargando..." cuando saveStatus=loading', () => {
    useSceneStore.setState({ saveStatus: 'loading' });
    render(<ProjectActions />);
    expect(screen.getByText('Cargando...')).toBeTruthy();
  });

  it('muestra "Guardando..." cuando saveStatus=saving', () => {
    useSceneStore.setState({ saveStatus: 'saving' });
    render(<ProjectActions />);
    expect(screen.getByText('Guardando...')).toBeTruthy();
  });

  it('muestra "Guardado localmente" cuando saveStatus=saved', () => {
    useSceneStore.setState({ saveStatus: 'saved' });
    render(<ProjectActions />);
    expect(screen.getByText('Guardado localmente')).toBeTruthy();
  });

  it('muestra el mensaje de error cuando saveStatus=error', () => {
    useSceneStore.setState({ saveStatus: 'error', saveError: 'Disco lleno' });
    render(<ProjectActions />);
    expect(screen.getByText(/Error: Disco lleno/)).toBeTruthy();
  });
});

describe('ProjectActions — Exportar', () => {
  it('llama a exportProject al hacer clic en Exportar', async () => {
    render(<ProjectActions />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(mockExport).toHaveBeenCalledOnce();
  });
});

describe('ProjectActions — Importar', () => {
  it('llama a importProject al seleccionar un archivo JSON válido', async () => {
    render(<ProjectActions />);
    const fileInput = document.querySelector<HTMLInputElement>('[data-testid="file-input"]')!;
    const file = new File(
      [JSON.stringify({ schemaVersion: 1, objects: [], projectOrigin: { x: 0, y: 0, z: 0 } })],
      'proyecto.json',
      { type: 'application/json' },
    );
    await userEvent.upload(fileInput, file);
    expect(mockImport).toHaveBeenCalledOnce();
  });

  it('muestra error si importProject devuelve error (que no sea cancelación)', async () => {
    mockImport.mockResolvedValue({ ok: false, error: 'Versión de esquema incompatible' });
    render(<ProjectActions />);
    const fileInput = document.querySelector<HTMLInputElement>('[data-testid="file-input"]')!;
    const file = new File(['{}'], 'malo.json', { type: 'application/json' });
    await userEvent.upload(fileInput, file);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Versión de esquema incompatible/)).toBeTruthy();
  });

  it('no muestra error si el usuario cancela la importación', async () => {
    mockImport.mockResolvedValue({ ok: false, error: 'Importación cancelada' });
    render(<ProjectActions />);
    const fileInput = document.querySelector<HTMLInputElement>('[data-testid="file-input"]')!;
    const file = new File(['{}'], 'proyecto.json', { type: 'application/json' });
    await userEvent.upload(fileInput, file);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ProjectActions — Restablecer ejemplo', () => {
  it('llama a resetProject al hacer clic en Restablecer ejemplo', async () => {
    render(<ProjectActions />);
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer ejemplo' }));
    expect(mockReset).toHaveBeenCalledOnce();
  });
});

describe('ProjectActions — recuperación tras fallo de carga', () => {
  it('Importar llama a recoverProject (no importProject) cuando saveStatus=error', async () => {
    useSceneStore.setState({ saveStatus: 'error', saveError: 'fallo de lectura' });
    render(<ProjectActions />);

    const fileInput = document.querySelector<HTMLInputElement>('[data-testid="file-input"]')!;
    const file = new File(['{}'], 'recovery.json', { type: 'application/json' });
    await userEvent.upload(fileInput, file);

    expect(mockRecover).toHaveBeenCalledOnce();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('Restablecer llama a recoverProject (no resetProject) cuando saveStatus=error', async () => {
    useSceneStore.setState({ saveStatus: 'error', saveError: 'fallo de lectura' });
    render(<ProjectActions />);

    await userEvent.click(screen.getByRole('button', { name: 'Restablecer ejemplo' }));

    expect(mockRecover).toHaveBeenCalledOnce();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('muestra error si recoverProject falla durante recuperación', async () => {
    useSceneStore.setState({ saveStatus: 'error', saveError: 'fallo de lectura' });
    mockRecover.mockResolvedValue({ ok: false, error: 'Error al guardar: sin espacio' });
    render(<ProjectActions />);

    const fileInput = document.querySelector<HTMLInputElement>('[data-testid="file-input"]')!;
    const file = new File(['{}'], 'recovery.json', { type: 'application/json' });
    await userEvent.upload(fileInput, file);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Error al guardar: sin espacio/)).toBeTruthy();
  });

  it('no muestra error si el usuario cancela durante recuperación', async () => {
    useSceneStore.setState({ saveStatus: 'error', saveError: 'fallo de lectura' });
    mockRecover.mockResolvedValue({ ok: false, error: 'Importación cancelada' });
    render(<ProjectActions />);

    const fileInput = document.querySelector<HTMLInputElement>('[data-testid="file-input"]')!;
    const file = new File(['{}'], 'recovery.json', { type: 'application/json' });
    await userEvent.upload(fileInput, file);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ProjectActions — bloqueo durante carga', () => {
  it('Importar y Restablecer están deshabilitados cuando saveStatus=loading', () => {
    useSceneStore.setState({ saveStatus: 'loading' });
    render(<ProjectActions />);
    const importBtn = screen.getByRole<HTMLButtonElement>('button', { name: 'Importar' });
    const resetBtn = screen.getByRole<HTMLButtonElement>('button', { name: 'Restablecer ejemplo' });
    expect(importBtn.disabled).toBe(true);
    expect(resetBtn.disabled).toBe(true);
  });

  it('Exportar permanece habilitado cuando saveStatus=loading', () => {
    useSceneStore.setState({ saveStatus: 'loading' });
    render(<ProjectActions />);
    const exportBtn = screen.getByRole<HTMLButtonElement>('button', { name: 'Exportar' });
    expect(exportBtn.disabled).toBe(false);
  });

  it('muestra hint de recuperación cuando saveStatus=error', () => {
    useSceneStore.setState({ saveStatus: 'error', saveError: 'fallo de lectura' });
    render(<ProjectActions />);
    expect(screen.getByText(/importá una copia guardada/i)).toBeTruthy();
  });
});
