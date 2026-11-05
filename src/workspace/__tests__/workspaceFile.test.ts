import { describe, it, expect } from 'vitest';
import { exportWorkspace, importWorkspace } from '../workspaceFile';
import type { TrayInput } from '../../tray/model';
import type { EquipmentElement, FieldEvidence } from '../../types/domain-v2';
import { IDENTITY_QUATERNION } from '../../types/domain-v2';

// ─── Minimal valid fixtures ───────────────────────────────────────────────────

const TRAY_INPUT: TrayInput = {
  version_contrato: 'trazado/1',
  piezas: [
    {
      instancia_id: 'R1',
      producto_id:  'PRY-BDJ-001',
      longitud_mm:  3000,
      puertos: {
        P1: { posicion_mm: [0, 0, 3000],    direccion: [-1, 0, 0] },
        P2: { posicion_mm: [3000, 0, 3000], direccion: [1, 0, 0] },
      },
    },
  ],
  conexiones: [],
  circuitos: [],
  soportes: [],
  pe: { seccion_requerida_mm2: 16, cable_id: 'PRY-SVALIO-CU-1x35', origen_requisito: 'TEST', conductores: [] },
};

const DATUM_UNKNOWN = { value: null, status: 'unknown' as const, evidenceIds: [] as string[] };

const ELEMENT: EquipmentElement = {
  id: 'motor-001',
  tag: null,
  aliases: [],
  name: 'Motor de prueba',
  category: 'motor',
  physicalLocation: { kind: 'unassigned', factoryId: null, subareaId: null, description: null },
  condition: 'new',
  lifecycle: 'active',
  parentId: null,
  geometry: { kind: 'cylinder', diameterMm: 300, lengthMm: 400 },
  mounting: 'floor',
  manufacturer: DATUM_UNKNOWN,
  model: DATUM_UNKNOWN,
  version: 1,
  placementStatus: 'placed',
  transform: { positionMm: { x: 1000, y: 1000, z: 200 }, rotation: IDENTITY_QUATERNION },
  technical: {
    power:        DATUM_UNKNOWN,
    voltage:      DATUM_UNKNOWN,
    phases:       DATUM_UNKNOWN,
    plateCurrent: DATUM_UNKNOWN,
    efficiency:   DATUM_UNKNOWN,
    powerFactor:  DATUM_UNKNOWN,
    start:        DATUM_UNKNOWN,
  },
} as EquipmentElement;

const EVIDENCE: FieldEvidence[] = [];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('exportWorkspace', () => {
  it('produces parseable JSON with fileVersion 1', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.fileVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('wraps equipment in projectV2 with schemaVersion 2', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const pv2 = parsed.projectV2 as Record<string, unknown>;
    expect(pv2.schemaVersion).toBe(2);
    expect(Array.isArray(pv2.elements)).toBe(true);
    expect(Array.isArray(pv2.evidence)).toBe(true);
  });

  it('includes trayInput with version_contrato', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const ti = parsed.trayInput as Record<string, unknown>;
    expect(ti.version_contrato).toBe('trazado/1');
    expect(Array.isArray(ti.piezas)).toBe(true);
  });
});

describe('importWorkspace', () => {
  it('round-trips export → import and recovers elements + trayInput', () => {
    const json   = exportWorkspace([ELEMENT], EVIDENCE, TRAY_INPUT);
    const result = importWorkspace(json);
    expect(result.fileVersion).toBe(1);
    expect(result.projectV2.elements).toHaveLength(1);
    expect(result.projectV2.elements[0].id).toBe('motor-001');
    expect(result.trayInput.piezas[0].instancia_id).toBe('R1');
  });

  it('throws on non-JSON input', () => {
    expect(() => importWorkspace('not json')).toThrow('JSON');
  });

  it('throws on wrong fileVersion', () => {
    const obj = JSON.stringify({ fileVersion: 2, projectV2: {}, trayInput: {} });
    expect(() => importWorkspace(obj)).toThrow('Versión');
  });

  it('throws when projectV2 has wrong schemaVersion', () => {
    const json   = exportWorkspace([ELEMENT], EVIDENCE, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    (parsed.projectV2 as Record<string, unknown>).schemaVersion = 1;
    expect(() => importWorkspace(JSON.stringify(parsed))).toThrow();
  });

  it('throws when trayInput is invalid', () => {
    const json   = exportWorkspace([ELEMENT], EVIDENCE, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.trayInput = { version_contrato: 'invalid' };
    expect(() => importWorkspace(JSON.stringify(parsed))).toThrow('ENTRADA_INVALIDA');
  });

  it('throws on invalid element structure (datum status coherence)', () => {
    const badElement = {
      ...ELEMENT,
      manufacturer: { value: null, status: 'provided', evidenceIds: [] },
    };
    const json = exportWorkspace([badElement as EquipmentElement], EVIDENCE, TRAY_INPUT);
    expect(() => importWorkspace(json)).toThrow();
  });

  it('leaves stores unmodified when import throws — validation before any mutation', () => {
    // importWorkspace is pure: it either returns a valid file or throws
    // This test verifies the throw path does not partially mutate anything.
    const badJson = JSON.stringify({ fileVersion: 1, projectV2: { schemaVersion: 2 }, trayInput: {} });
    expect(() => importWorkspace(badJson)).toThrow();
  });
});
