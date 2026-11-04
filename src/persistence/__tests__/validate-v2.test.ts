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
