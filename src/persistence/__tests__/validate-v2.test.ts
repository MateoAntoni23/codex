import { describe, it, expect } from 'vitest';
import { validateProjectDataV2 } from '../validate-v2';
import type { ProjectDataV2, EquipmentElement } from '../../types/domain-v2';

// ---------------------------------------------------------------------------
// Minimal valid ProjectDataV2 factory
// ---------------------------------------------------------------------------

function makeValidV2(): ProjectDataV2 {
  const floorElement: EquipmentElement = {
    id: 'el-floor-1',
    name: 'Piso',
    tag: null,
    aliases: [],
    condition: 'unknown',
    lifecycle: 'active',
    parentId: null,
    mounting: 'unknown',
    manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
    model: { value: null, status: 'unknown', evidenceIds: [] },
    geometry: { kind: 'plane', widthMm: 10000, depthMm: 10000 },
    physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
    version: 1,
    placementStatus: 'placed',
    transform: {
      positionMm: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    category: 'infrastructure',
    technical: {
      role: { value: 'floor', status: 'provided', evidenceIds: [] },
    },
  } as EquipmentElement;

  return {
    schemaVersion: 2,
    projectOrigin: { x: 0, y: 0, z: 0 },
    elements: [floorElement],
    ports: [],
    connections: [],
    cableCores: [],
    internalLinks: [],
    functionalRelations: [],
    factories: [],
    subareas: [],
    elementServices: [],
    evidence: [],
    migrationIncidents: [],
  };
}

function clone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateProjectDataV2', () => {
  it('1. valid minimal ProjectDataV2 passes', () => {
    expect(() => validateProjectDataV2(makeValidV2())).not.toThrow();
  });

  it('2. invalid schemaVersion throws', () => {
    const data = clone(makeValidV2());
    (data as unknown as Record<string, unknown>).schemaVersion = 1;
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('3. elements not array throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = 'not-an-array';
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('4. element missing id throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    delete els[0].id;
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('5. broken parentId reference throws /parentId/', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].parentId = 'non-existent-id';
    expect(() => validateProjectDataV2(data)).toThrow(/parentId/);
  });

  it('6. cycle in parentId throws /ciclo/i', () => {
    const data = clone(makeValidV2());
    const second: EquipmentElement = {
      id: 'el-b',
      name: 'B',
      tag: null,
      aliases: [],
      condition: 'unknown',
      lifecycle: 'active',
      parentId: 'el-floor-1',
      mounting: 'unknown',
      manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
      model: { value: null, status: 'unknown', evidenceIds: [] },
      geometry: { kind: 'plane', widthMm: 1000, depthMm: 1000 },
      physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
      version: 1,
      placementStatus: 'placed',
      transform: {
        positionMm: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      category: 'infrastructure',
      technical: {
        role: { value: 'floor', status: 'provided', evidenceIds: [] },
      },
    } as EquipmentElement;

    data.elements.push(second);
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].parentId = 'el-b'; // cycle: el-floor-1 ↔ el-b

    expect(() => validateProjectDataV2(data)).toThrow(/ciclo/i);
  });

  it('7. duplicate element IDs throws /duplicado/i or /duplic/i', () => {
    const data = clone(makeValidV2());
    const dupe = clone(data.elements[0]);
    data.elements.push(dupe);
    expect(() => validateProjectDataV2(data)).toThrow(/duplic/i);
  });

  it('8. duplicate TAG between two elements throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].tag = 'TAG-001';

    const second = clone(data.elements[0]) as unknown as Record<string, unknown>;
    second.id = 'el-floor-2';
    second.tag = 'TAG-001';
    (rawData.elements as Record<string, unknown>[]).push(second);

    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it("9. element alias collides with another element's tag throws", () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].tag = 'SHARED-001';

    const second = clone(data.elements[0]) as unknown as Record<string, unknown>;
    second.id = 'el-floor-2';
    second.tag = null;
    second.aliases = ['SHARED-001'];
    (rawData.elements as Record<string, unknown>[]).push(second);

    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('10. incoherent Placement: placementStatus=placed but transform=null throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].placementStatus = 'placed';
    els[0].transform = null;
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('11. incoherent Placement: placementStatus=unplaced but transform set throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].placementStatus = 'unplaced';
    // transform is still non-null
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('12. quaternion not unit throws /quaternion/i', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    const el = els[0] as Record<string, unknown>;
    const transform = el.transform as Record<string, unknown>;
    transform.rotation = { x: 1, y: 1, z: 1, w: 1 }; // |q|² = 4 ≠ 1
    expect(() => validateProjectDataV2(data)).toThrow(/quaternion/i);
  });

  it('13. geometry negative dimension throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    const el = els[0] as Record<string, unknown>;
    const geo = el.geometry as Record<string, unknown>;
    geo.widthMm = -1;
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('14. subarea.factoryId not found throws', () => {
    const data = clone(makeValidV2());
    data.subareas = [
      {
        id: 'sub-1',
        factoryId: 'factory-nonexistent',
        name: 'Área 1',
        aliases: [],
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('15. elementService.elementId not found throws', () => {
    const data = clone(makeValidV2());
    data.factories = [{ id: 'fac-1', name: 'Fábrica', aliases: [] }];
    data.elementServices = [
      {
        id: 'svc-1',
        elementId: 'nonexistent-element',
        factoryId: 'fac-1',
        note: null,
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('16. connection routeId not null throws /routeId/i', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    rawData.connections = [
      {
        id: 'conn-1',
        tag: null,
        kind: 'cable',
        ends: [
          { kind: 'unresolved', sourceLabel: 'A' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
        installationStatus: 'planned',
        sizingStatus: 'unchecked',
        routeId: 'some-route', // should be null
        service: 'power',
        coreCount: { value: null, status: 'unknown', evidenceIds: [] },
        sectionMm2: { value: null, status: 'unknown', evidenceIds: [] },
        outerDiameterMm: { value: null, status: 'unknown', evidenceIds: [] },
        minBendRadiusMm: { value: null, status: 'unknown', evidenceIds: [] },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/routeId/i);
  });

  it('17. cableCore referencing multipolar port throws', () => {
    const data = clone(makeValidV2());

    data.connections = [
      {
        id: 'conn-1',
        tag: null,
        kind: 'cable',
        ends: [
          { kind: 'unresolved', sourceLabel: 'A' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
        installationStatus: 'planned',
        sizingStatus: 'unchecked',
        routeId: null,
        service: 'power',
        coreCount: { value: null, status: 'unknown', evidenceIds: [] },
        sectionMm2: { value: null, status: 'unknown', evidenceIds: [] },
        outerDiameterMm: { value: null, status: 'unknown', evidenceIds: [] },
        minBendRadiusMm: { value: null, status: 'unknown', evidenceIds: [] },
      },
    ] as unknown as typeof data.connections;

    data.ports = [
      {
        id: 'port-multi',
        elementId: 'el-floor-1',
        name: 'Connector',
        localPositionMm: { x: 0, y: 0, z: 0 },
        localDirection: { x: 0, y: 0, z: 1 },
        anchor: 'fixed_local',
        medium: 'electrical',
        role: 'power',
        ratedVoltageV: null,
        terminalName: 'X1',
        connectorKind: 'multipolar',
        pinCount: 4,
        parentPortId: null,
      },
    ] as unknown as typeof data.ports;

    data.cableCores = [
      {
        id: 'core-1',
        cableId: 'conn-1',
        label: null,
        conductor: 'phase',
        ends: [
          { kind: 'port', portId: 'port-multi' }, // multipolar — not allowed
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
      },
    ] as unknown as typeof data.cableCores;

    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('18. cableCore.cableId not found throws', () => {
    const data = clone(makeValidV2());
    data.cableCores = [
      {
        id: 'core-1',
        cableId: 'nonexistent-cable',
        label: null,
        conductor: 'phase',
        ends: [
          { kind: 'unresolved', sourceLabel: 'A' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
      },
    ] as unknown as typeof data.cableCores;
    expect(() => validateProjectDataV2(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// New audit tests (sections A–C)
// ---------------------------------------------------------------------------

function makeElectricalPort(id: string, elementId: string, connectorKind: 'terminal' | 'multipolar' = 'terminal') {
  return {
    id,
    elementId,
    name: 'P',
    localPositionMm: { x: 0, y: 0, z: 0 },
    localDirection: { x: 0, y: 0, z: 1 },
    anchor: 'fixed_local',
    medium: 'electrical',
    role: 'power',
    ratedVoltageV: null,
    terminalName: 'X1',
    connectorKind,
    pinCount: connectorKind === 'multipolar' ? null : undefined,
    parentPortId: null,
  };
}

function makeCableConnection(id: string) {
  return {
    id,
    tag: null,
    kind: 'cable',
    ends: [
      { kind: 'unresolved', sourceLabel: 'A' },
      { kind: 'unresolved', sourceLabel: 'B' },
    ],
    installationStatus: 'planned',
    sizingStatus: 'unchecked',
    routeId: null,
    service: 'power',
    coreCount: { value: null, status: 'unknown', evidenceIds: [] },
    sectionMm2: { value: null, status: 'unknown', evidenceIds: [] },
    outerDiameterMm: { value: null, status: 'unknown', evidenceIds: [] },
    minBendRadiusMm: { value: null, status: 'unknown', evidenceIds: [] },
  };
}

describe('validateProjectDataV2 — audit A: connection endpoint medium', () => {
  it('19. cable endpoint portId not found throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.connections = [
      {
        ...makeCableConnection('conn-1'),
        ends: [
          { kind: 'port', portId: 'nonexistent-port' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/portId/);
  });

  it('20. cable connected to pneumatic port throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.ports = [
      {
        id: 'port-pneu',
        elementId: 'el-floor-1',
        name: 'P',
        localPositionMm: { x: 0, y: 0, z: 0 },
        localDirection: { x: 0, y: 0, z: 1 },
        anchor: 'fixed_local',
        medium: 'pneumatic',
        role: 'supply',
        connector: null,
        maxPressureBar: null,
      },
    ];
    data.connections = [
      {
        ...makeCableConnection('conn-1'),
        ends: [
          { kind: 'port', portId: 'port-pneu' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('21. valid: cable with both unresolved endpoints passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.connections = [makeCableConnection('conn-1')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('22. valid: cable with electrical port endpoint passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.ports = [makeElectricalPort('port-1', 'el-floor-1', 'terminal')];
    data.connections = [
      {
        ...makeCableConnection('conn-1'),
        ends: [
          { kind: 'port', portId: 'port-1' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
      },
    ];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });
});

describe('validateProjectDataV2 — audit B: integrity checks', () => {
  it('23. port direction zero vector throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.ports = [
      {
        ...makeElectricalPort('port-1', 'el-floor-1'),
        localDirection: { x: 0, y: 0, z: 0 },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/localDirection/);
  });

  it('24. multipolar pinCount=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.ports = [
      {
        ...makeElectricalPort('port-1', 'el-floor-1', 'multipolar'),
        pinCount: 0,
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/pinCount/);
  });

  it('25. duplicate ElementService (elementId, factoryId) pair throws', () => {
    const data = clone(makeValidV2());
    data.factories = [{ id: 'fac-1', name: 'Fábrica', aliases: [] }];
    data.elementServices = [
      { id: 'svc-1', elementId: 'el-floor-1', factoryId: 'fac-1', note: null },
      { id: 'svc-2', elementId: 'el-floor-1', factoryId: 'fac-1', note: null },
    ];
    expect(() => validateProjectDataV2(data)).toThrow();
  });

  it('26. evidence with invalid elementOrConnectionId throws', () => {
    const data = clone(makeValidV2());
    data.evidence = [
      {
        id: 'ev-1',
        elementOrConnectionId: 'nonexistent',
        fieldPath: '',
        source: 'manual',
        fileChecksum: null, sheet: null, row: null, cell: null,
        formula: null, rawValue: null, author: null,
        recordedAt: '2026-01-01T00:00:00.000Z',
      },
    ] as unknown as typeof data.evidence;
    expect(() => validateProjectDataV2(data)).toThrow(/elementOrConnectionId/);
  });

  it('27. migrationIncident with invalid elementId throws', () => {
    const data = clone(makeValidV2());
    data.migrationIncidents = [
      {
        id: 'inc-1',
        elementId: 'nonexistent',
        field: 'geometry',
        code: 'TEST',
        originalValues: {},
        message: 'test',
      },
    ] as unknown as typeof data.migrationIncidents;
    expect(() => validateProjectDataV2(data)).toThrow(/elementId/);
  });

  it('28. physicalLocation.factoryId not found throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].physicalLocation = {
      kind: 'factory',
      factoryId: 'nonexistent-factory',
      subareaId: null,
      description: null,
    };
    expect(() => validateProjectDataV2(data)).toThrow(/factoryId/);
  });

  it('29. physicalLocation.subareaId not found throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].physicalLocation = {
      kind: 'unassigned',
      factoryId: null,
      subareaId: 'nonexistent-subarea',
      description: null,
    };
    expect(() => validateProjectDataV2(data)).toThrow(/subareaId/);
  });

  it('30. internalLink conductive with non-electrical port throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.ports = [
      {
        id: 'port-pneu-a',
        elementId: 'el-floor-1',
        name: 'PA',
        localPositionMm: { x: 0, y: 0, z: 0 },
        localDirection: { x: 0, y: 0, z: 1 },
        anchor: 'fixed_local',
        medium: 'pneumatic',
        role: 'supply',
        connector: null,
        maxPressureBar: null,
      },
      {
        id: 'port-pneu-b',
        elementId: 'el-floor-1',
        name: 'PB',
        localPositionMm: { x: 1, y: 0, z: 0 },
        localDirection: { x: 0, y: 0, z: 1 },
        anchor: 'fixed_local',
        medium: 'pneumatic',
        role: 'working',
        connector: null,
        maxPressureBar: null,
      },
    ];
    data.internalLinks = [
      { id: 'il-1', fromPortId: 'port-pneu-a', toPortId: 'port-pneu-b', kind: 'conductive' },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/conductive/);
  });

  it('31. internalLink passage with mixed medium throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.ports = [
      {
        id: 'port-pneu-c',
        elementId: 'el-floor-1',
        name: 'PC',
        localPositionMm: { x: 0, y: 0, z: 0 },
        localDirection: { x: 0, y: 0, z: 1 },
        anchor: 'fixed_local',
        medium: 'pneumatic',
        role: 'supply',
        connector: null,
        maxPressureBar: null,
      },
      {
        id: 'port-hyd-c',
        elementId: 'el-floor-1',
        name: 'HC',
        localPositionMm: { x: 2, y: 0, z: 0 },
        localDirection: { x: 0, y: 0, z: 1 },
        anchor: 'fixed_local',
        medium: 'hydraulic',
        role: 'supply',
        connector: null,
        maxPressureBar: null,
      },
    ];
    data.internalLinks = [
      { id: 'il-2', fromPortId: 'port-pneu-c', toPortId: 'port-hyd-c', kind: 'passage' },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/passage/);
  });

  it('32. datum evidenceId not found throws', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    const tech = (els[0] as Record<string, unknown>).technical as Record<string, unknown>;
    const role = tech.role as Record<string, unknown>;
    role.evidenceIds = ['ev-nonexistent'];
    expect(() => validateProjectDataV2(data)).toThrow(/evidenceId/);
  });
});

describe('validateProjectDataV2 — audit C: technical value ranges', () => {
  function makeMotorElement(id: string, efficiencyValue: number | null, efficiencyStatus: string) {
    return {
      id,
      name: 'Motor Test',
      tag: null,
      aliases: [],
      condition: 'unknown',
      lifecycle: 'active',
      parentId: null,
      mounting: 'unknown',
      manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
      model: { value: null, status: 'unknown', evidenceIds: [] },
      geometry: { kind: 'cylinder', diameterMm: 400, lengthMm: 600 },
      physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
      version: 1,
      placementStatus: 'placed',
      transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      category: 'motor',
      technical: {
        power: { value: null, status: 'unknown', evidenceIds: [] },
        voltage: { value: null, status: 'unknown', evidenceIds: [] },
        phases: { value: null, status: 'unknown', evidenceIds: [] },
        plateCurrent: { value: null, status: 'unknown', evidenceIds: [] },
        efficiency: { value: efficiencyValue, status: efficiencyStatus, evidenceIds: [] },
        powerFactor: { value: null, status: 'unknown', evidenceIds: [] },
        start: { value: null, status: 'unknown', evidenceIds: [] },
      },
    };
  }

  it('33. motor efficiency.value=2 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeMotorElement('m-1', 2, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/efficiency/);
  });

  it('34. motor efficiency.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeMotorElement('m-1', 0, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/efficiency/);
  });

  it('35. motor efficiency.value=1 passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeMotorElement('m-1', 1, 'provided')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('36. motor powerFactor.value=1.1 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        ...makeMotorElement('m-1', null, 'unknown'),
        technical: {
          ...makeMotorElement('m-1', null, 'unknown').technical,
          powerFactor: { value: 1.1, status: 'provided', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/powerFactor/);
  });

  it('37. motor all datums unknown passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeMotorElement('m-1', null, 'unknown')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('38. datum status=unknown with non-null value throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeMotorElement('m-1', 0.9, 'unknown')];
    expect(() => validateProjectDataV2(data)).toThrow(/unknown/);
  });

  it('39. datum status=provided with null value throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeMotorElement('m-1', null, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/provided/);
  });

  it('40. sensor range min > max throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        id: 'sensor-1',
        name: 'Sensor Test',
        tag: null,
        aliases: [],
        condition: 'unknown',
        lifecycle: 'active',
        parentId: null,
        mounting: 'unknown',
        manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
        model: { value: null, status: 'unknown', evidenceIds: [] },
        geometry: null,
        physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
        version: 1,
        placementStatus: 'placed',
        transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        category: 'sensor',
        technical: {
          measuredVariable: { value: null, status: 'unknown', evidenceIds: [] },
          range: { value: { min: 100, max: 10, unit: 'bar' }, status: 'provided', evidenceIds: [] },
          supply: { value: null, status: 'unknown', evidenceIds: [] },
          signal: { value: null, status: 'unknown', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/min/);
  });

  it('41. cable coreCount.value=-1 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.connections = [
      {
        ...makeCableConnection('conn-1'),
        coreCount: { value: -1, status: 'provided', evidenceIds: [] },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/coreCount/);
  });

  it('42. cable sectionMm2.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.connections = [
      {
        ...makeCableConnection('conn-1'),
        sectionMm2: { value: 0, status: 'provided', evidenceIds: [] },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/sectionMm2/);
  });

  it('43. hose innerDiameterMm >= outerDiameterMm throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.connections = [
      {
        id: 'hose-1',
        tag: null,
        kind: 'hose',
        medium: 'pneumatic',
        ends: [
          { kind: 'unresolved', sourceLabel: 'A' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
        installationStatus: 'planned',
        sizingStatus: 'unchecked',
        routeId: null,
        innerDiameterMm: { value: 20, status: 'provided', evidenceIds: [] },
        outerDiameterMm: { value: 15, status: 'provided', evidenceIds: [] },
        material: { value: null, status: 'unknown', evidenceIds: [] },
        workingPressureBar: { value: null, status: 'unknown', evidenceIds: [] },
        minBendRadiusMm: { value: null, status: 'unknown', evidenceIds: [] },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/innerDiameterMm/);
  });

  it('44. valid: hose with all datums unknown passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.connections = [
      {
        id: 'hose-1',
        tag: null,
        kind: 'hose',
        medium: 'pneumatic',
        ends: [
          { kind: 'unresolved', sourceLabel: 'A' },
          { kind: 'unresolved', sourceLabel: 'B' },
        ],
        installationStatus: 'planned',
        sizingStatus: 'unchecked',
        routeId: null,
        innerDiameterMm: { value: null, status: 'unknown', evidenceIds: [] },
        outerDiameterMm: { value: null, status: 'unknown', evidenceIds: [] },
        material: { value: null, status: 'unknown', evidenceIds: [] },
        workingPressureBar: { value: null, status: 'unknown', evidenceIds: [] },
        minBendRadiusMm: { value: null, status: 'unknown', evidenceIds: [] },
      },
    ];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Audit: pending invariants — solenoid valve, actuator, counts, quantity ranges
// ---------------------------------------------------------------------------

function makeSolenoidElement(id: string, opPressure: { minBar: number; maxBar: number } | null, opStatus: string) {
  return {
    id,
    name: 'EV Test',
    tag: null,
    aliases: [],
    condition: 'unknown',
    lifecycle: 'active',
    parentId: null,
    mounting: 'unknown',
    manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
    model: { value: null, status: 'unknown', evidenceIds: [] },
    geometry: null,
    physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
    version: 1,
    placementStatus: 'placed',
    transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    category: 'solenoid_valve',
    technical: {
      configuration: { value: null, status: 'unknown', evidenceIds: [] },
      coilSupply: { value: null, status: 'unknown', evidenceIds: [] },
      operatingPressure: { value: opPressure, status: opStatus, evidenceIds: [] },
      normalState: { value: null, status: 'unknown', evidenceIds: [] },
    },
  };
}

function makeActuatorElement(id: string, strokeVal: number | null, strokeStatus: string, boreVal: number | null, boreStatus: string) {
  return {
    id,
    name: 'Act Test',
    tag: null,
    aliases: [],
    condition: 'unknown',
    lifecycle: 'active',
    parentId: null,
    mounting: 'unknown',
    manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
    model: { value: null, status: 'unknown', evidenceIds: [] },
    geometry: null,
    physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
    version: 1,
    placementStatus: 'placed',
    transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    category: 'actuator',
    technical: {
      technology: { value: null, status: 'unknown', evidenceIds: [] },
      action: { value: null, status: 'unknown', evidenceIds: [] },
      motion: { value: null, status: 'unknown', evidenceIds: [] },
      stroke: { value: strokeVal !== null ? { value: strokeVal, unit: 'mm' } : null, status: strokeStatus, evidenceIds: [] },
      bore: { value: boreVal !== null ? { value: boreVal, unit: 'mm' } : null, status: boreStatus, evidenceIds: [] },
      torque: { value: null, status: 'unknown', evidenceIds: [] },
      workingPressure: { value: null, status: 'unknown', evidenceIds: [] },
    },
  };
}

describe('validateProjectDataV2 — audit: solenoid valve operatingPressure', () => {
  it('45. operatingPressure minBar > maxBar throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeSolenoidElement('ev-1', { minBar: 8, maxBar: 4 }, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/minBar/);
  });

  it('46. operatingPressure minBar < 0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeSolenoidElement('ev-1', { minBar: -1, maxBar: 8 }, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/minBar/);
  });

  it('47. operatingPressure minBar=0, maxBar=10 passes (0 es válido)', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeSolenoidElement('ev-1', { minBar: 0, maxBar: 10 }, 'provided')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('48. operatingPressure unknown (null) passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeSolenoidElement('ev-1', null, 'unknown')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('49. coilSupply.voltageV=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        ...makeSolenoidElement('ev-1', null, 'unknown'),
        technical: {
          ...makeSolenoidElement('ev-1', null, 'unknown').technical,
          coilSupply: { value: { voltageV: 0, currentType: 'DC' }, status: 'provided', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/voltageV/);
  });

  it('50. coilSupply.voltageV=24 passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        ...makeSolenoidElement('ev-1', null, 'unknown'),
        technical: {
          ...makeSolenoidElement('ev-1', null, 'unknown').technical,
          coilSupply: { value: { voltageV: 24, currentType: 'DC' }, status: 'provided', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });
});

describe('validateProjectDataV2 — audit: actuator bore, stroke, torque', () => {
  it('51. stroke.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeActuatorElement('act-1', 0, 'provided', null, 'unknown')];
    expect(() => validateProjectDataV2(data)).toThrow(/stroke/);
  });

  it('52. stroke.value=-50 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeActuatorElement('act-1', -50, 'provided', null, 'unknown')];
    expect(() => validateProjectDataV2(data)).toThrow(/stroke/);
  });

  it('53. bore.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeActuatorElement('act-1', null, 'unknown', 0, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/bore/);
  });

  it('54. stroke and bore unknown passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeActuatorElement('act-1', null, 'unknown', null, 'unknown')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('55. stroke=100mm, bore=50mm passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeActuatorElement('act-1', 100, 'provided', 50, 'provided')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('56. torque.value=0 throws', () => {
    const base = makeActuatorElement('act-1', null, 'unknown', null, 'unknown');
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        ...base,
        technical: {
          ...base.technical,
          torque: { value: { value: 0, unit: 'Nm' }, status: 'provided', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/torque/);
  });
});

describe('validateProjectDataV2 — audit: terminalCount and stationCount', () => {
  function makeTerminalBlockElement(id: string, count: number | null, countStatus: string) {
    return {
      id,
      name: 'TB Test',
      tag: null,
      aliases: [],
      condition: 'unknown',
      lifecycle: 'active',
      parentId: null,
      mounting: 'din_rail',
      manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
      model: { value: null, status: 'unknown', evidenceIds: [] },
      geometry: null,
      physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
      version: 1,
      placementStatus: 'placed',
      transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      category: 'terminal_block',
      technical: { terminalCount: { value: count, status: countStatus, evidenceIds: [] } },
    };
  }

  function makeManifoldElement(id: string, count: number | null, countStatus: string) {
    return {
      id,
      name: 'Manifold Test',
      tag: null,
      aliases: [],
      condition: 'unknown',
      lifecycle: 'active',
      parentId: null,
      mounting: 'unknown',
      manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
      model: { value: null, status: 'unknown', evidenceIds: [] },
      geometry: null,
      physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
      version: 1,
      placementStatus: 'placed',
      transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      category: 'manifold',
      technical: {
        stationCount: { value: count, status: countStatus, evidenceIds: [] },
        workingPressure: { value: null, status: 'unknown', evidenceIds: [] },
      },
    };
  }

  it('57. terminalCount.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeTerminalBlockElement('tb-1', 0, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/terminalCount/);
  });

  it('58. terminalCount.value=2.5 throws (no entero)', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeTerminalBlockElement('tb-1', 2.5, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/terminalCount/);
  });

  it('59. terminalCount.value=-1 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeTerminalBlockElement('tb-1', -1, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/terminalCount/);
  });

  it('60. terminalCount.value=10 passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeTerminalBlockElement('tb-1', 10, 'provided')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('61. terminalCount unknown (null) passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeTerminalBlockElement('tb-1', null, 'unknown')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('62. stationCount.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeManifoldElement('mf-1', 0, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/stationCount/);
  });

  it('63. stationCount.value=1.5 throws (no entero)', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeManifoldElement('mf-1', 1.5, 'provided')];
    expect(() => validateProjectDataV2(data)).toThrow(/stationCount/);
  });

  it('64. stationCount.value=4 passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [makeManifoldElement('mf-1', 4, 'provided')];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });
});

describe('validateProjectDataV2 — audit: quantity positivity per category', () => {
  it('65. motor power.value.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        id: 'm-1', name: 'Motor', tag: null, aliases: [], condition: 'unknown',
        lifecycle: 'active', parentId: null, mounting: 'floor',
        manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
        model: { value: null, status: 'unknown', evidenceIds: [] },
        geometry: { kind: 'cylinder', diameterMm: 400, lengthMm: 600 },
        physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
        version: 1, placementStatus: 'placed',
        transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        category: 'motor',
        technical: {
          power: { value: { value: 0, unit: 'kW' }, status: 'provided', evidenceIds: [] },
          voltage: { value: null, status: 'unknown', evidenceIds: [] },
          phases: { value: null, status: 'unknown', evidenceIds: [] },
          plateCurrent: { value: null, status: 'unknown', evidenceIds: [] },
          efficiency: { value: null, status: 'unknown', evidenceIds: [] },
          powerFactor: { value: null, status: 'unknown', evidenceIds: [] },
          start: { value: null, status: 'unknown', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/power/);
  });

  it('66. process_valve pressure.value.value=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        id: 'pv-1', name: 'PV', tag: null, aliases: [], condition: 'unknown',
        lifecycle: 'active', parentId: null, mounting: 'unknown',
        manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
        model: { value: null, status: 'unknown', evidenceIds: [] },
        geometry: null,
        physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
        version: 1, placementStatus: 'placed',
        transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        category: 'process_valve',
        technical: {
          function: { value: null, status: 'unknown', evidenceIds: [] },
          nominalSize: { value: null, status: 'unknown', evidenceIds: [] },
          connection: { value: null, status: 'unknown', evidenceIds: [] },
          fluid: { value: null, status: 'unknown', evidenceIds: [] },
          pressure: { value: { value: 0, unit: 'bar' }, status: 'provided', evidenceIds: [] },
          temperature: { value: null, status: 'unknown', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/pressure/);
  });

  it('67. process_valve temperature.value.value=-20°C passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        id: 'pv-2', name: 'PV Cryo', tag: null, aliases: [], condition: 'unknown',
        lifecycle: 'active', parentId: null, mounting: 'unknown',
        manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
        model: { value: null, status: 'unknown', evidenceIds: [] },
        geometry: null,
        physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
        version: 1, placementStatus: 'placed',
        transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        category: 'process_valve',
        technical: {
          function: { value: null, status: 'unknown', evidenceIds: [] },
          nominalSize: { value: null, status: 'unknown', evidenceIds: [] },
          connection: { value: null, status: 'unknown', evidenceIds: [] },
          fluid: { value: null, status: 'unknown', evidenceIds: [] },
          pressure: { value: null, status: 'unknown', evidenceIds: [] },
          temperature: { value: { value: -20, unit: 'degC' }, status: 'provided', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });
});

describe('validateProjectDataV2 — audit: physicalLocation shared semantics', () => {
  it('68. shared with factoryId not null throws', () => {
    const data = clone(makeValidV2());
    data.factories = [{ id: 'fac-1', name: 'F', aliases: [] }];
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].physicalLocation = { kind: 'shared', factoryId: 'fac-1', subareaId: null, description: null };
    expect(() => validateProjectDataV2(data)).toThrow(/shared/);
  });

  it('69. shared with subareaId not null throws', () => {
    const data = clone(makeValidV2());
    data.factories = [{ id: 'fac-1', name: 'F', aliases: [] }];
    data.subareas = [{ id: 'sub-1', factoryId: 'fac-1', name: 'S', aliases: [] }];
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].physicalLocation = { kind: 'shared', factoryId: null, subareaId: 'sub-1', description: null };
    expect(() => validateProjectDataV2(data)).toThrow(/shared/);
  });

  it('70. shared with both null passes', () => {
    const data = clone(makeValidV2());
    const rawData = data as unknown as Record<string, unknown>;
    const els = rawData.elements as Record<string, unknown>[];
    els[0].physicalLocation = { kind: 'shared', factoryId: null, subareaId: null, description: 'Entre EVA y EVB' };
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });

  it('71. sensor supply.voltageV=0 throws', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        id: 'sen-1', name: 'Sensor', tag: null, aliases: [], condition: 'unknown',
        lifecycle: 'active', parentId: null, mounting: 'unknown',
        manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
        model: { value: null, status: 'unknown', evidenceIds: [] },
        geometry: null,
        physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
        version: 1, placementStatus: 'placed',
        transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        category: 'sensor',
        technical: {
          measuredVariable: { value: null, status: 'unknown', evidenceIds: [] },
          range: { value: null, status: 'unknown', evidenceIds: [] },
          supply: { value: { voltageV: 0, currentType: 'DC' }, status: 'provided', evidenceIds: [] },
          signal: { value: null, status: 'unknown', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).toThrow(/voltageV/);
  });

  it('72. sensor supply unknown (null) passes', () => {
    const data = clone(makeValidV2()) as unknown as Record<string, unknown>;
    data.elements = [
      {
        id: 'sen-2', name: 'Sensor', tag: null, aliases: [], condition: 'unknown',
        lifecycle: 'active', parentId: null, mounting: 'unknown',
        manufacturer: { value: null, status: 'unknown', evidenceIds: [] },
        model: { value: null, status: 'unknown', evidenceIds: [] },
        geometry: null,
        physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
        version: 1, placementStatus: 'placed',
        transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        category: 'sensor',
        technical: {
          measuredVariable: { value: null, status: 'unknown', evidenceIds: [] },
          range: { value: null, status: 'unknown', evidenceIds: [] },
          supply: { value: null, status: 'unknown', evidenceIds: [] },
          signal: { value: null, status: 'unknown', evidenceIds: [] },
        },
      },
    ];
    expect(() => validateProjectDataV2(data)).not.toThrow();
  });
});
