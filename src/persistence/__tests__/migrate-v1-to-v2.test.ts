import { describe, it, expect } from 'vitest';
import { INITIAL_OBJECTS } from '../../store/initialObjects';
import { validateProjectData } from '../validate';
import { migrateV1ToV2 } from '../migrate-v1-to-v2';
import type { MigrationResult } from '../migrate-v1-to-v2';
import { validateProjectDataV2 } from '../validate-v2';
import type { ProjectData } from '../schema';
import type { MigrationIncident } from '../../types/domain-v2';
import { SCHEMA_VERSION } from '../schema';

const VALID_V1: ProjectData = {
  schemaVersion: SCHEMA_VERSION,
  objects: INITIAL_OBJECTS,
  projectOrigin: { x: 0, y: 0, z: 0 },
};

describe('migrateV1ToV2', () => {
  it('1. does not throw on VALID_V1', () => {
    expect(() => migrateV1ToV2(VALID_V1)).not.toThrow();
  });

  it('2. result.data.schemaVersion === 2', () => {
    const result: MigrationResult = migrateV1ToV2(VALID_V1);
    expect(result.data.schemaVersion).toBe(2);
  });

  it('3. result.data.elements has 4 elements', () => {
    const result = migrateV1ToV2(VALID_V1);
    expect(result.data.elements).toHaveLength(4);
  });

  it('4. floor-1 → infrastructure with geometry.kind=plane, widthMm=30000, depthMm=30000', () => {
    const result = migrateV1ToV2(VALID_V1);
    const el = result.data.elements.find((e) => e.id === 'floor-1');
    expect(el).toBeDefined();
    expect(el!.category).toBe('infrastructure');
    expect(el!.geometry!.kind).toBe('plane');
    if (el!.geometry!.kind === 'plane') {
      expect(el!.geometry!.widthMm).toBe(30000);
      expect(el!.geometry!.depthMm).toBe(30000);
    }
  });

  it('5. building-1 → infrastructure with geometry.kind=box, heightMm=8000', () => {
    const result = migrateV1ToV2(VALID_V1);
    const el = result.data.elements.find((e) => e.id === 'building-1');
    expect(el).toBeDefined();
    expect(el!.category).toBe('infrastructure');
    expect(el!.geometry!.kind).toBe('box');
    if (el!.geometry!.kind === 'box') {
      expect(el!.geometry!.heightMm).toBe(8000);
    }
  });

  it('6. panel-1 → electrical_panel with geometry.kind=box', () => {
    const result = migrateV1ToV2(VALID_V1);
    const el = result.data.elements.find((e) => e.id === 'panel-1');
    expect(el).toBeDefined();
    expect(el!.category).toBe('electrical_panel');
    expect(el!.geometry!.kind).toBe('box');
  });

  it('7. motor-1 → motor with geometry.kind=cylinder, diameterMm=600, lengthMm=800', () => {
    const result = migrateV1ToV2(VALID_V1);
    const el = result.data.elements.find((e) => e.id === 'motor-1');
    expect(el).toBeDefined();
    expect(el!.category).toBe('motor');
    expect(el!.geometry!.kind).toBe('cylinder');
    if (el!.geometry!.kind === 'cylinder') {
      expect(el!.geometry!.diameterMm).toBe(600);
      expect(el!.geometry!.lengthMm).toBe(800);
    }
  });

  it('8. all elements have version=1', () => {
    const result = migrateV1ToV2(VALID_V1);
    for (const el of result.data.elements) {
      expect(el.version).toBe(1);
    }
  });

  it('9. all elements have tag=null, aliases=[], condition=unknown, lifecycle=active', () => {
    const result = migrateV1ToV2(VALID_V1);
    for (const el of result.data.elements) {
      expect(el.tag).toBeNull();
      expect(el.aliases).toEqual([]);
      expect(el.condition).toBe('unknown');
      expect(el.lifecycle).toBe('active');
    }
  });

  it('10. all elements have placementStatus=placed and transform with correct positionMm', () => {
    const result = migrateV1ToV2(VALID_V1);

    const floor = result.data.elements.find((e) => e.id === 'floor-1')!;
    expect(floor.placementStatus).toBe('placed');
    expect(floor.transform).not.toBeNull();
    expect(floor.transform!.positionMm).toEqual({ x: 0, y: 0, z: 0 });

    const panel = result.data.elements.find((e) => e.id === 'panel-1')!;
    expect(panel.placementStatus).toBe('placed');
    expect(panel.transform!.positionMm).toEqual({ x: -7000, y: 2000, z: 1000 });

    const motor = result.data.elements.find((e) => e.id === 'motor-1')!;
    expect(motor.placementStatus).toBe('placed');
    expect(motor.transform!.positionMm).toEqual({ x: 4000, y: 4000, z: 400 });
  });

  it('11. projectOrigin preserved: {x:0,y:0,z:0}', () => {
    const result = migrateV1ToV2(VALID_V1);
    expect(result.data.projectOrigin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('12. IDs preserved: elements map to original v1 IDs', () => {
    const result = migrateV1ToV2(VALID_V1);
    const ids = result.data.elements.map((e) => e.id);
    expect(ids).toContain('floor-1');
    expect(ids).toContain('building-1');
    expect(ids).toContain('panel-1');
    expect(ids).toContain('motor-1');
  });

  it('13. no incidents for symmetric motor (width=600=depth=600)', () => {
    const result = migrateV1ToV2(VALID_V1);
    const motorIncidents = result.incidents.filter((inc) => inc.elementId === 'motor-1');
    expect(motorIncidents).toHaveLength(0);
  });

  it('14. asymmetric motor emits MOTOR_DEPTH_WIDTH_MISMATCH incident', () => {
    const customV1: ProjectData = {
      schemaVersion: SCHEMA_VERSION,
      objects: [
        {
          id: 'motor-asym',
          name: 'Motor Asimétrico',
          type: 'motor',
          position: { x: 0, y: 0, z: 450 },
          dimensions: { width: 500, depth: 600, height: 900 },
        },
      ],
      projectOrigin: { x: 0, y: 0, z: 0 },
    };

    const result = migrateV1ToV2(customV1);
    expect(result.incidents).toHaveLength(1);

    const inc: MigrationIncident = result.incidents[0];
    expect(inc.code).toBe('MOTOR_DEPTH_WIDTH_MISMATCH');
    expect(inc.field).toBe('geometry');
    expect(inc.originalValues.width).toBe(500);
    expect(inc.originalValues.depth).toBe(600);

    const el = result.data.elements.find((e) => e.id === 'motor-asym')!;
    expect(el.geometry!.kind).toBe('cylinder');
    if (el.geometry!.kind === 'cylinder') {
      expect(el.geometry!.diameterMm).toBe(500);
    }
  });

  it('15. determinism: calling twice with same input gives same result', () => {
    const r1 = migrateV1ToV2(VALID_V1);
    const r2 = migrateV1ToV2(VALID_V1);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('16. immutability: migrateV1ToV2 does not mutate input', () => {
    const inputClone: ProjectData = JSON.parse(JSON.stringify(VALID_V1)) as ProjectData;
    const inputBefore = JSON.stringify(inputClone);
    migrateV1ToV2(inputClone);
    const inputAfter = JSON.stringify(inputClone);
    expect(inputAfter).toBe(inputBefore);
  });

  it('17. round-trip: migrate → JSON → validateProjectDataV2 does not throw', () => {
    const result = migrateV1ToV2(VALID_V1);
    const serialized = JSON.stringify(result.data);
    const deserialized = JSON.parse(serialized) as unknown;
    expect(() => validateProjectDataV2(deserialized)).not.toThrow();
  });

  it('18. validateProjectDataV2 passes on migrated VALID_V1 data', () => {
    const result = migrateV1ToV2(VALID_V1);
    expect(() => validateProjectDataV2(result.data)).not.toThrow();
  });

  it('19. evidence array contains entries with source=migration for each element', () => {
    const result = migrateV1ToV2(VALID_V1);
    const elementIds = result.data.elements.map((e) => e.id);
    for (const id of elementIds) {
      const ev = result.data.evidence.find(
        (e) => e.elementOrConnectionId === id && e.source === 'migration' && e.fieldPath === '',
      );
      expect(ev).toBeDefined();
    }
  });

  it('20. MigrationIncidents survive JSON round-trip', () => {
    const customV1: ProjectData = {
      schemaVersion: SCHEMA_VERSION,
      objects: [
        {
          id: 'motor-asym2',
          name: 'Motor Asimétrico 2',
          type: 'motor',
          position: { x: 0, y: 0, z: 450 },
          dimensions: { width: 300, depth: 500, height: 700 },
        },
      ],
      projectOrigin: { x: 0, y: 0, z: 0 },
    };

    const result = migrateV1ToV2(customV1);
    expect(result.incidents).toHaveLength(1);

    const serialized = JSON.stringify(result.data);
    const deserialized = JSON.parse(serialized) as { migrationIncidents: MigrationIncident[] };
    expect(deserialized.migrationIncidents).toHaveLength(1);
    expect(deserialized.migrationIncidents[0].code).toBe('MOTOR_DEPTH_WIDTH_MISMATCH');
  });
});

describe('validateProjectData re-export sanity', () => {
  it('validateProjectData still works on v1 data', () => {
    expect(() => validateProjectData(VALID_V1)).not.toThrow();
  });
});
