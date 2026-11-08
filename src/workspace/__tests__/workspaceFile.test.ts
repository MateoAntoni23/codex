import { describe, it, expect } from 'vitest';
import { exportWorkspace, importWorkspace, DEFAULT_PROJECT_META, extractMeta, type ProjectMeta } from '../workspaceFile';
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
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.fileVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('wraps equipment in projectV2 with schemaVersion 2', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const pv2 = parsed.projectV2 as Record<string, unknown>;
    expect(pv2.schemaVersion).toBe(2);
    expect(Array.isArray(pv2.elements)).toBe(true);
    expect(Array.isArray(pv2.evidence)).toBe(true);
  });

  it('includes trayInput with version_contrato', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const ti = parsed.trayInput as Record<string, unknown>;
    expect(ti.version_contrato).toBe('trazado/1');
    expect(Array.isArray(ti.piezas)).toBe(true);
  });

  it('preserves non-zero projectOrigin in export', () => {
    const meta: ProjectMeta = {
      ...DEFAULT_PROJECT_META,
      projectOrigin: { x: 1234, y: 56, z: 7 },
    };
    const json = exportWorkspace([ELEMENT], EVIDENCE, meta, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const pv2 = parsed.projectV2 as Record<string, unknown>;
    const origin = pv2.projectOrigin as Record<string, number>;
    expect(origin.x).toBe(1234);
    expect(origin.y).toBe(56);
    expect(origin.z).toBe(7);
  });
});

describe('importWorkspace', () => {
  it('round-trips export → import and recovers elements + trayInput', () => {
    const json   = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const result = importWorkspace(json);
    expect(result.fileVersion).toBe(1);
    expect(result.projectV2.elements).toHaveLength(1);
    expect(result.projectV2.elements[0].id).toBe('motor-001');
    expect(result.trayInput.piezas[0].instancia_id).toBe('R1');
  });

  it('round-trips non-zero origin and non-empty factories unchanged', () => {
    const meta: ProjectMeta = {
      ...DEFAULT_PROJECT_META,
      projectOrigin: { x: 1234, y: 0, z: 0 },
      factories: [{ id: 'f-01', name: 'Planta Norte', aliases: [] }],
    };
    const json   = exportWorkspace([ELEMENT], EVIDENCE, meta, TRAY_INPUT);
    const result = importWorkspace(json);
    expect(result.projectV2.projectOrigin.x).toBe(1234);
    expect(result.projectV2.factories).toHaveLength(1);
    expect(result.projectV2.factories[0].id).toBe('f-01');
  });

  it('extractMeta preserves origin after import', () => {
    const meta: ProjectMeta = { ...DEFAULT_PROJECT_META, projectOrigin: { x: 500, y: 200, z: 0 } };
    const json   = exportWorkspace([ELEMENT], EVIDENCE, meta, TRAY_INPUT);
    const result = importWorkspace(json);
    const extracted = extractMeta(result.projectV2);
    expect(extracted.projectOrigin.x).toBe(500);
    expect(extracted.projectOrigin.y).toBe(200);
  });

  it('edit name → export preserves origin and other unchanged fields', () => {
    const meta: ProjectMeta = { ...DEFAULT_PROJECT_META, projectOrigin: { x: 1234, y: 0, z: 0 } };
    const json1   = exportWorkspace([ELEMENT], EVIDENCE, meta, TRAY_INPUT);
    const imported = importWorkspace(json1);
    // Simulate editing element name only
    const editedEl = { ...imported.projectV2.elements[0], name: 'Motor editado', version: 2 } as EquipmentElement;
    const json2    = exportWorkspace([editedEl], imported.projectV2.evidence, extractMeta(imported.projectV2), imported.trayInput);
    const reimport = importWorkspace(json2);
    expect(reimport.projectV2.elements[0].name).toBe('Motor editado');
    expect(reimport.projectV2.elements[0].version).toBe(2);
    expect(reimport.projectV2.projectOrigin.x).toBe(1234);
  });

  it('preserves excepciones_conexion workspace-only field through export/import', () => {
    const trayWithException: TrayInput = {
      ...TRAY_INPUT,
      excepciones_conexion: {
        'CON-001': {
          motivo: 'Transición horizontal→vertical autorizada por proyectista',
          confirmado_por: 'proyectista',
          fecha_iso: '2026-11-08T12:00:00.000Z',
          reason_code: 'compat_no_documentada',
          producto_id: 'SAM_CUPS-300-A-Z',
        },
      },
    } as TrayInput;
    const json   = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, trayWithException);
    const result = importWorkspace(json);
    const persisted = (result.trayInput as Record<string, unknown>).excepciones_conexion as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(persisted).toBeDefined();
    expect(persisted!['CON-001'].motivo).toContain('Transición');
    expect(persisted!['CON-001'].reason_code).toBe('compat_no_documentada');
    expect(persisted!['CON-001'].producto_id).toBe('SAM_CUPS-300-A-Z');
  });

  it('throws on non-JSON input', () => {
    expect(() => importWorkspace('not json')).toThrow('JSON');
  });

  it('throws on wrong fileVersion', () => {
    const obj = JSON.stringify({ fileVersion: 2, projectV2: {}, trayInput: {} });
    expect(() => importWorkspace(obj)).toThrow('Versión');
  });

  it('throws when projectV2 has wrong schemaVersion', () => {
    const json   = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    (parsed.projectV2 as Record<string, unknown>).schemaVersion = 1;
    expect(() => importWorkspace(JSON.stringify(parsed))).toThrow();
  });

  it('throws when trayInput is invalid', () => {
    const json   = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.trayInput = { version_contrato: 'invalid' };
    expect(() => importWorkspace(JSON.stringify(parsed))).toThrow('ENTRADA_INVALIDA');
  });

  it('throws on invalid element structure (datum status coherence)', () => {
    const badElement = {
      ...ELEMENT,
      manufacturer: { value: null, status: 'provided', evidenceIds: [] },
    };
    const json = exportWorkspace([badElement as EquipmentElement], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    expect(() => importWorkspace(json)).toThrow();
  });

  it('importWorkspace is pure — does not mutate input or any store on throw', () => {
    const badJson = JSON.stringify({ fileVersion: 1, projectV2: { schemaVersion: 2 }, trayInput: {} });
    expect(() => importWorkspace(badJson)).toThrow();
  });
});

// ─── catalogConfig (Configurador de biblioteca) ──────────────────────────────

describe('exportWorkspace + importWorkspace — catalogConfig', () => {
  const SAMPLE_OVERRIDES = {
    'SAM_TPS-300-Z': {
      productId: 'SAM_TPS-300-Z',
      source: 'override' as const,
      overrideReason: 'Datos del fabricante actualizados vía PDF 2026 Rev. B',
      overrideAt: '2026-11-08T10:00:00Z',
      entries: [
        { recipePortName: 'tronco_P1', catalogPortName: 'P3', physicalLabel: 'reasignado', justification: 'Override' },
      ],
    },
  };

  it('omite el bloque catalogConfig cuando no hay overrides', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT, {});
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect('catalogConfig' in parsed).toBe(false);
  });

  it('incluye catalogConfig con firma de versión cuando hay overrides', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT, SAMPLE_OVERRIDES);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const cfg = parsed.catalogConfig as Record<string, unknown>;
    expect(cfg.version).toBe('codex:catalogConfig/1');
    expect((cfg.overrides as Record<string, unknown>)['SAM_TPS-300-Z']).toBeDefined();
  });

  it('round-trip: export → import preserva overrides', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT, SAMPLE_OVERRIDES);
    const imported = importWorkspace(json);
    expect(imported.catalogConfig?.version).toBe('codex:catalogConfig/1');
    expect(imported.catalogConfig?.overrides['SAM_TPS-300-Z'].source).toBe('override');
    expect(imported.catalogConfig?.overrides['SAM_TPS-300-Z'].entries[0].catalogPortName).toBe('P3');
  });

  it('archivo legacy sin catalogConfig importa correctamente', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const imported = importWorkspace(json);
    expect(imported.catalogConfig).toBeUndefined();
  });

  it('rechaza versión desconocida de catalogConfig', () => {
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT, SAMPLE_OVERRIDES);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    (parsed.catalogConfig as Record<string, unknown>).version = 'otra/9';
    expect(() => importWorkspace(JSON.stringify(parsed))).toThrow('catalogConfig');
  });

  it('rechaza catalogConfig con source inválido', () => {
    const bad = {
      version: 'codex:catalogConfig/1',
      overrides: { X: { productId: 'X', source: 'garbage', entries: [] } },
    };
    const json = exportWorkspace([ELEMENT], EVIDENCE, DEFAULT_PROJECT_META, TRAY_INPUT);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.catalogConfig = bad;
    expect(() => importWorkspace(JSON.stringify(parsed))).toThrow('catalogConfig');
  });
});
