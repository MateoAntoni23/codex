import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { DEFAULT_PROJECT_META } from '../workspaceFile';

beforeEach(() => useWorkspaceStore.getState().reset());

describe('useWorkspaceStore.loadFile', () => {
  it('resets connectionToolActive and connectionPortA', () => {
    useWorkspaceStore.setState({ connectionToolActive: true, connectionPortA: ['R1', 'P2'] });
    useWorkspaceStore.getState().loadFile([], [], DEFAULT_PROJECT_META, 'test.json');
    const s = useWorkspaceStore.getState();
    expect(s.connectionToolActive).toBe(false);
    expect(s.connectionPortA).toBeNull();
  });

  it('resets connectionPortA even when tool was idle with a stale portA', () => {
    useWorkspaceStore.setState({ connectionToolActive: false, connectionPortA: ['OLD', 'P1'] });
    useWorkspaceStore.getState().loadFile([], [], DEFAULT_PROJECT_META, 'other.json');
    expect(useWorkspaceStore.getState().connectionPortA).toBeNull();
  });

  it('resets all three selection fields', () => {
    useWorkspaceStore.setState({ selectedEquipId: 'eq1', selectedTrayId: 'T1', selectedSupportId: 'S1' });
    useWorkspaceStore.getState().loadFile([], [], DEFAULT_PROJECT_META, 'test.json');
    const s = useWorkspaceStore.getState();
    expect(s.selectedEquipId).toBeNull();
    expect(s.selectedTrayId).toBeNull();
    expect(s.selectedSupportId).toBeNull();
  });

  it('marks file as not dirty and stores fileName', () => {
    useWorkspaceStore.setState({ dirty: true });
    useWorkspaceStore.getState().loadFile([], [], DEFAULT_PROJECT_META, 'my-project.json');
    const s = useWorkspaceStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.fileName).toBe('my-project.json');
  });
});

describe('useWorkspaceStore.activateConnectionTool', () => {
  it('clears all selections when activated', () => {
    useWorkspaceStore.setState({ selectedEquipId: 'eq1', selectedTrayId: 'T1', selectedSupportId: 'S1' });
    useWorkspaceStore.getState().activateConnectionTool();
    const s = useWorkspaceStore.getState();
    expect(s.connectionToolActive).toBe(true);
    expect(s.selectedEquipId).toBeNull();
    expect(s.selectedTrayId).toBeNull();
    expect(s.selectedSupportId).toBeNull();
  });

  it('deactivateConnectionTool clears portA', () => {
    useWorkspaceStore.setState({ connectionToolActive: true, connectionPortA: ['R1', 'P2'] });
    useWorkspaceStore.getState().deactivateConnectionTool();
    const s = useWorkspaceStore.getState();
    expect(s.connectionToolActive).toBe(false);
    expect(s.connectionPortA).toBeNull();
  });
});
