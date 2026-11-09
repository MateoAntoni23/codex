/**
 * Cobertura de `loadTestScenario` y del factory `buildTestScenario`:
 *   - Alta de los dos equipos + 2 ports + 1 connection en una sola operación.
 *   - Idempotencia: segunda pulsación no muta nada.
 *   - Undo restaura elementos, ports y connections al estado previo.
 *   - Redo re-aplica el escenario completo.
 *   - Round-trip por validador v2: el escenario pasa `validateProjectDataV2`
 *     (garantiza que los datos ficticios son estructuralmente válidos).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { SCENARIO_IDS, buildTestScenario } from '../testScenario';
import { validateProjectDataV2 } from '../../persistence/validate-v2';
import { PREVIEW_ELEMENTS, PREVIEW_EVIDENCE } from '../../preview/previewData';

function resetStore() {
  useWorkspaceStore.setState({
    elements: PREVIEW_ELEMENTS.map((e) => ({ ...e })),
    evidence: [...PREVIEW_EVIDENCE],
    projectMeta: {
      projectOrigin: { x: 0, y: 0, z: 0 },
      factories: [],
      subareas: [],
      elementServices: [],
      ports: [],
      connections: [],
      cableCores: [],
      internalLinks: [],
      functionalRelations: [],
      migrationIncidents: [],
    },
    equipHistory: [],
    equipFuture: [],
    selectedEquipId: null,
    dirty: false,
  });
}

describe('loadTestScenario', () => {
  beforeEach(resetStore);

  it('agrega tablero + motor + puerto A/B + conexión en una pulsación', () => {
    const before = useWorkspaceStore.getState();
    useWorkspaceStore.getState().loadTestScenario();
    const after = useWorkspaceStore.getState();

    expect(after.elements.length).toBe(before.elements.length + 2);
    expect(after.elements.find((e) => e.id === SCENARIO_IDS.tablero)).toBeDefined();
    expect(after.elements.find((e) => e.id === SCENARIO_IDS.motor)).toBeDefined();

    expect(after.projectMeta.ports.length).toBe(before.projectMeta.ports.length + 2);
    expect(after.projectMeta.connections.length).toBe(before.projectMeta.connections.length + 1);

    const conn = after.projectMeta.connections.find((c) => c.id === SCENARIO_IDS.connection);
    expect(conn).toBeDefined();
    expect(conn?.installationStatus).toBe('planned');
    expect(conn?.kind).toBe('cable');
  });

  it('es idempotente — segunda pulsación no duplica elementos ni historial', () => {
    useWorkspaceStore.getState().loadTestScenario();
    const afterFirst = useWorkspaceStore.getState();
    const histLenAfterFirst = afterFirst.equipHistory.length;
    const elementsAfterFirst = afterFirst.elements.length;

    useWorkspaceStore.getState().loadTestScenario();
    const afterSecond = useWorkspaceStore.getState();

    expect(afterSecond.elements.length).toBe(elementsAfterFirst);
    expect(afterSecond.equipHistory.length).toBe(histLenAfterFirst);
    expect(afterSecond.projectMeta.ports.length).toBe(afterFirst.projectMeta.ports.length);
    expect(afterSecond.projectMeta.connections.length).toBe(
      afterFirst.projectMeta.connections.length,
    );
  });

  it('undo revierte elementos, ports y connections en un solo paso', () => {
    const before = useWorkspaceStore.getState();
    const initialPorts = before.projectMeta.ports.length;
    const initialConns = before.projectMeta.connections.length;
    const initialElements = before.elements.length;

    useWorkspaceStore.getState().loadTestScenario();
    expect(useWorkspaceStore.getState().elements.length).toBe(initialElements + 2);

    useWorkspaceStore.getState().undoEquip();
    const afterUndo = useWorkspaceStore.getState();

    expect(afterUndo.elements.length).toBe(initialElements);
    expect(afterUndo.projectMeta.ports.length).toBe(initialPorts);
    expect(afterUndo.projectMeta.connections.length).toBe(initialConns);
    expect(afterUndo.equipFuture.length).toBe(1);
  });

  it('redo re-aplica elementos + ports + connections', () => {
    useWorkspaceStore.getState().loadTestScenario();
    const afterLoad = useWorkspaceStore.getState();
    useWorkspaceStore.getState().undoEquip();
    useWorkspaceStore.getState().redoEquip();
    const afterRedo = useWorkspaceStore.getState();

    expect(afterRedo.elements.length).toBe(afterLoad.elements.length);
    expect(afterRedo.projectMeta.ports.length).toBe(afterLoad.projectMeta.ports.length);
    expect(afterRedo.projectMeta.connections.length).toBe(
      afterLoad.projectMeta.connections.length,
    );
    expect(afterRedo.elements.find((e) => e.id === SCENARIO_IDS.motor)).toBeDefined();
  });

  it('las entidades construidas pasan validateProjectDataV2', () => {
    const payload = buildTestScenario();
    const project = {
      schemaVersion: 2 as const,
      elements: payload.elements,
      evidence: [],
      ports: payload.ports,
      connections: payload.connections,
      cableCores: [],
      internalLinks: [],
      functionalRelations: [],
      factories: [],
      subareas: [],
      elementServices: [],
      migrationIncidents: [],
      projectOrigin: { x: 0, y: 0, z: 0 },
    };
    expect(() => validateProjectDataV2(project)).not.toThrow();
  });

  it('los equipos nacen colocados con posiciones distintas', () => {
    useWorkspaceStore.getState().loadTestScenario();
    const { elements } = useWorkspaceStore.getState();
    const tab = elements.find((e) => e.id === SCENARIO_IDS.tablero)!;
    const mot = elements.find((e) => e.id === SCENARIO_IDS.motor)!;
    expect(tab.placementStatus).toBe('placed');
    expect(mot.placementStatus).toBe('placed');
    if (tab.placementStatus === 'placed' && mot.placementStatus === 'placed') {
      const dx = tab.transform.positionMm.x - mot.transform.positionMm.x;
      const dy = tab.transform.positionMm.y - mot.transform.positionMm.y;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(500);
    }
  });

  it('marca los datos como ficticios (nombre con "demo" y manufacturer estimated)', () => {
    useWorkspaceStore.getState().loadTestScenario();
    const tab = useWorkspaceStore
      .getState()
      .elements.find((e) => e.id === SCENARIO_IDS.tablero)!;
    expect(tab.name.toLowerCase()).toContain('demo');
    expect(tab.manufacturer.status).not.toBe('verified');
    expect(tab.manufacturer.status).not.toBe('provided');
  });
});
