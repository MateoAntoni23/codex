/**
 * previewData.ts — Datos estáticos para la vista de prueba v2.
 *
 * Contenido:
 *   - 4 elementos migrados desde los INITIAL_OBJECTS de v1 (piso, nave, tablero, motor)
 *   - Par padre-hijo: soporte giratorio + motor en soporte (verifica orientación por jerarquía)
 *   - Sensor de campo sin geometría conocida — marcador "Dimensiones pendientes"
 *   - Elemento sin ubicar (Sensor de temperatura) — aparece solo en la lista
 *
 * Requisito pendiente — Variadores de frecuencia (VFD):
 *   Los variadores son componentes internos de tableros eléctricos, no equipos de campo
 *   independientes. Deben asociarse al tablero contenedor (parentId), consultarse en
 *   la ficha o vista interna del tablero, y omitirse en la vista general de equipos.
 *   No se agrega categoría de variadores ni vista interna hasta que se diseñe ese flujo.
 *
 * No toca IndexedDB, no llama a projectManager.
 */

import { INITIAL_OBJECTS } from '../store/initialObjects';
import { SCHEMA_VERSION } from '../persistence/schema';
import { migrateV1ToV2 } from '../persistence/migrate-v1-to-v2';
import { IDENTITY_QUATERNION } from '../types/domain-v2';
import type { EquipmentElement, Vec3 } from '../types/domain-v2';

const UNKNOWN_DATUM = { value: null, status: 'unknown' as const, evidenceIds: [] as string[] };
const DEFAULT_LOCATION = {
  kind: 'unassigned' as const,
  factoryId: null as null,
  subareaId: null as null,
  description: null as null,
};

// ─── Migración desde v1 ───────────────────────────────────────────────────────

const { data: migratedData } = migrateV1ToV2({
  schemaVersion: SCHEMA_VERSION,
  projectOrigin: { x: 0, y: 0, z: 0 },
  objects: INITIAL_OBJECTS,
});

// ─── Par padre-hijo (45° alrededor de Z en dominio) ──────────────────────────

// Rotación 45° alrededor del eje Z del dominio (vertical).
// q = {x:0, y:0, z:sin(π/8), w:cos(π/8)}
const SIN_PI8 = Math.sin(Math.PI / 8); // sin(22.5°) ≈ 0.3827
const COS_PI8 = Math.cos(Math.PI / 8); // cos(22.5°) ≈ 0.9239

const supportPanel: EquipmentElement = {
  id: 'support-panel-1',
  name: 'Soporte giratorio',
  tag: null,
  aliases: [],
  physicalLocation: DEFAULT_LOCATION,
  condition: 'unknown',
  lifecycle: 'active',
  parentId: null,
  geometry: { kind: 'box', widthMm: 600, depthMm: 600, heightMm: 800 },
  mounting: 'floor',
  manufacturer: UNKNOWN_DATUM,
  model: UNKNOWN_DATUM,
  version: 1,
  placementStatus: 'placed',
  transform: {
    positionMm: { x: 2000, y: -5000, z: 400 } as Vec3,
    rotation: { x: 0, y: 0, z: SIN_PI8, w: COS_PI8 },
  },
  category: 'electrical_panel',
  technical: { ipRating: UNKNOWN_DATUM, ratedCurrent: UNKNOWN_DATUM },
} as EquipmentElement;

// Motor hijo: offset local {x:0, y:800, z:0} en el marco del padre.
// Al resolverse, la posición se rota por la rotación del padre.
const childMotor: EquipmentElement = {
  id: 'child-motor-1',
  name: 'Motor en soporte',
  tag: null,
  aliases: [],
  physicalLocation: DEFAULT_LOCATION,
  condition: 'unknown',
  lifecycle: 'active',
  parentId: 'support-panel-1',
  geometry: { kind: 'cylinder', diameterMm: 300, lengthMm: 500 },
  mounting: 'panel_mount',
  manufacturer: UNKNOWN_DATUM,
  model: UNKNOWN_DATUM,
  version: 1,
  placementStatus: 'placed',
  transform: {
    positionMm: { x: 0, y: 800, z: 0 } as Vec3,
    rotation: { ...IDENTITY_QUATERNION },
  },
  category: 'motor',
  technical: {
    power: UNKNOWN_DATUM,
    voltage: UNKNOWN_DATUM,
    phases: UNKNOWN_DATUM,
    plateCurrent: UNKNOWN_DATUM,
    efficiency: UNKNOWN_DATUM,
    powerFactor: UNKNOWN_DATUM,
    start: UNKNOWN_DATUM,
  },
} as EquipmentElement;

// ─── Sensor de campo sin geometría conocida ───────────────────────────────────
// Demuestra el marcador "Dimensiones pendientes" para elementos ubicados cuya
// geometría aún no fue relevada.

const fieldSensorNoDims: EquipmentElement = {
  id: 'sensor-nogeo-1',
  name: 'Sensor de presión (sin dimensiones)',
  tag: null,
  aliases: [],
  physicalLocation: DEFAULT_LOCATION,
  condition: 'unknown',
  lifecycle: 'active',
  parentId: null,
  geometry: null,
  mounting: 'unknown',
  manufacturer: UNKNOWN_DATUM,
  model: UNKNOWN_DATUM,
  version: 1,
  placementStatus: 'placed',
  transform: {
    positionMm: { x: -4000, y: -3000, z: 1000 } as Vec3,
    rotation: { ...IDENTITY_QUATERNION },
  },
  category: 'sensor',
  technical: {
    measuredVariable: UNKNOWN_DATUM,
    range: UNKNOWN_DATUM,
    supply: UNKNOWN_DATUM,
    signal: UNKNOWN_DATUM,
  },
} as EquipmentElement;

// ─── Elemento sin ubicar ──────────────────────────────────────────────────────

const unplacedSensor: EquipmentElement = {
  id: 'sensor-unplaced-1',
  name: 'Sensor de temperatura',
  tag: null,
  aliases: [],
  physicalLocation: DEFAULT_LOCATION,
  condition: 'unknown',
  lifecycle: 'active',
  parentId: null,
  geometry: { kind: 'box', widthMm: 50, depthMm: 50, heightMm: 100 },
  mounting: 'unknown',
  manufacturer: UNKNOWN_DATUM,
  model: UNKNOWN_DATUM,
  version: 1,
  placementStatus: 'unplaced',
  transform: null,
  category: 'sensor',
  technical: {
    measuredVariable: UNKNOWN_DATUM,
    range: UNKNOWN_DATUM,
    supply: UNKNOWN_DATUM,
    signal: UNKNOWN_DATUM,
  },
} as EquipmentElement;

// ─── Sensor de caudal con datos técnicos ficticios ────────────────────────────
// Para probar la edición y visualización de datos técnicos en el inspector.

const testSensorFlow: EquipmentElement = {
  id: 'sensor-flow-1',
  name: '[DEMO] Sensor de caudal',
  tag: 'FT-101',
  aliases: [],
  physicalLocation: DEFAULT_LOCATION,
  condition: 'new',
  lifecycle: 'active',
  parentId: null,
  geometry: { kind: 'box', widthMm: 80, depthMm: 60, heightMm: 120 },
  mounting: 'wall',
  manufacturer: { value: '[demo] Endress+Hauser', status: 'provided', evidenceIds: [] },
  model: { value: '[demo] Promag 300', status: 'provided', evidenceIds: [] },
  version: 1,
  placementStatus: 'placed',
  transform: {
    positionMm: { x: -2000, y: 3000, z: 1200 } as Vec3,
    rotation: { ...IDENTITY_QUATERNION },
  },
  category: 'sensor',
  technical: {
    measuredVariable: { value: '[demo] Caudal volumétrico de agua', status: 'provided', evidenceIds: [] },
    range: { value: { min: 0, max: 100, unit: 'm3/h' }, status: 'estimated', evidenceIds: [] },
    supply: { value: { voltageV: 24, currentType: 'DC' as const }, status: 'provided', evidenceIds: [] },
    signal: { value: '4_20mA' as const, status: 'provided', evidenceIds: [] },
  },
} as EquipmentElement;

// ─── Exportaciones ────────────────────────────────────────────────────────────

export const PREVIEW_ELEMENTS: EquipmentElement[] = [
  ...migratedData.elements,
  supportPanel,
  childMotor,
  fieldSensorNoDims,
  unplacedSensor,
  testSensorFlow,
];

export const PREVIEW_PROJECT_ORIGIN = migratedData.projectOrigin;
