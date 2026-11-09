// Fixture reusable: "Cargar escenario de prueba".
//
// Construye dos equipos operativos (Tablero Prueba A + Motor Prueba A) y una
// conexión de potencia planificada que los une. NO usa el importador Excel —
// nace como entidades operativas puras (sin importedRef) para que la escena
// pueda construirse sin Excel disponible.
//
// Reglas:
//   - IDs estables (idempotencia): dos pulsaciones consecutivas del botón NO
//     duplican. Si cualquiera de los IDs ya está en escena, la carga es no-op.
//   - Datos y dimensiones ficticios: `name` lleva sufijo "(demo)", y los campos
//     técnicos no se presentan como verificados (quedan 'unknown' donde no se
//     indica valor; cuando se da un valor orientativo, status='estimated').
//   - Posiciones distintas y visibles: ambos equipos se apoyan en el piso
//     (z_domain=0 en la base) y se separan ~3 m en X y ~1.5 m en Y para que
//     el usuario los descubra sin maniobras.
//   - La conexión sólo expresa "tablero alimenta motor" — installationStatus
//     'planned', sin cálculo ni ruteo (routeId: null por contrato hasta M7+).

import type { Connection, EquipmentElement, Port, Vec3 } from '../types/domain-v2';
import { IDENTITY_QUATERNION } from '../types/domain-v2';
import { DEFAULT_GEOMETRY, floorRestingHalfHeightMm } from '../import/placement';

export const SCENARIO_IDS = {
  tablero: 'scenario:tablero-prueba-a',
  motor: 'scenario:motor-prueba-a',
  portTablero: 'scenario:port-tablero-a-potencia',
  portMotor: 'scenario:port-motor-a-potencia',
  connection: 'scenario:conn-potencia-a',
} as const;

const DEMO_SUFFIX = '(demo — ficticio)';

function unknownDatum<T>(): { value: T | null; status: 'unknown'; evidenceIds: string[] } {
  return { value: null, status: 'unknown', evidenceIds: [] };
}

function unknownDatumNumber() {
  return unknownDatum<number>();
}

function floorPosition(category: 'electrical_panel' | 'motor', x: number, y: number): Vec3 {
  const geom = DEFAULT_GEOMETRY[category];
  return { x, y, z: floorRestingHalfHeightMm(geom) };
}

function buildTablero(): EquipmentElement {
  const geom = DEFAULT_GEOMETRY.electrical_panel;
  return {
    id: SCENARIO_IDS.tablero,
    tag: 'TAB-DEMO-A',
    aliases: [],
    name: `Tablero Prueba A ${DEMO_SUFFIX}`,
    physicalLocation: {
      kind: 'unassigned',
      factoryId: null,
      subareaId: null,
      description: null,
    },
    condition: 'new',
    lifecycle: 'active',
    parentId: null,
    geometry: geom,
    mounting: 'floor',
    manufacturer: { value: 'DEMO (ficticio)', status: 'estimated', evidenceIds: [] },
    model: { value: 'DEMO-PNL-A', status: 'estimated', evidenceIds: [] },
    version: 1,
    importedRef: null,
    placementStatus: 'placed',
    transform: {
      positionMm: floorPosition('electrical_panel', 1000, 500),
      rotation: { ...IDENTITY_QUATERNION },
    },
    category: 'electrical_panel',
    technical: {
      ipRating: unknownDatum<string>(),
      ratedCurrent: unknownDatumNumber(),
    },
  } as EquipmentElement;
}

function buildMotor(): EquipmentElement {
  const geom = DEFAULT_GEOMETRY.motor;
  return {
    id: SCENARIO_IDS.motor,
    tag: 'MOT-DEMO-A',
    aliases: [],
    name: `Motor Prueba A ${DEMO_SUFFIX}`,
    physicalLocation: {
      kind: 'unassigned',
      factoryId: null,
      subareaId: null,
      description: null,
    },
    condition: 'new',
    lifecycle: 'active',
    parentId: null,
    geometry: geom,
    mounting: 'floor',
    manufacturer: { value: 'DEMO (ficticio)', status: 'estimated', evidenceIds: [] },
    model: { value: 'DEMO-MOT-A', status: 'estimated', evidenceIds: [] },
    version: 1,
    importedRef: null,
    placementStatus: 'placed',
    transform: {
      positionMm: floorPosition('motor', 4000, 2000),
      rotation: { ...IDENTITY_QUATERNION },
    },
    category: 'motor',
    technical: {
      power: unknownDatum(),
      voltage: unknownDatum(),
      phases: unknownDatum(),
      plateCurrent: unknownDatum(),
      efficiency: unknownDatum(),
      powerFactor: unknownDatum(),
      start: unknownDatum(),
    },
  } as EquipmentElement;
}

function buildPortTablero(): Port {
  // Puerto de potencia en la cara frontal del tablero (dirección +X en local).
  // Al apoyar en piso, el centro del tablero está a 1000 mm; el puerto a 300 mm
  // sobre el centro (altura ~1300 mm — práctico para una salida de potencia).
  return {
    id: SCENARIO_IDS.portTablero,
    elementId: SCENARIO_IDS.tablero,
    name: 'POT-A (demo)',
    localPositionMm: { x: 300, y: 0, z: 300 },
    localDirection: { x: 1, y: 0, z: 0 },
    anchor: 'fixed_local',
    medium: 'electrical',
    role: 'power',
    ratedVoltageV: null,
    terminalName: 'POT-A',
    connectorKind: 'terminal',
    parentPortId: null,
  };
}

function buildPortMotor(): Port {
  // Puerto de potencia en la caja de bornes del motor. Local +X para que el
  // enrutado natural salga hacia el tablero.
  return {
    id: SCENARIO_IDS.portMotor,
    elementId: SCENARIO_IDS.motor,
    name: 'U-V-W (demo)',
    localPositionMm: { x: 150, y: 0, z: 0 },
    localDirection: { x: 1, y: 0, z: 0 },
    anchor: 'fixed_local',
    medium: 'electrical',
    role: 'power',
    ratedVoltageV: null,
    terminalName: 'UVW',
    connectorKind: 'terminal',
    parentPortId: null,
  };
}

function buildConnection(): Connection {
  return {
    id: SCENARIO_IDS.connection,
    tag: 'C-DEMO-A',
    ends: [
      { kind: 'port', portId: SCENARIO_IDS.portTablero },
      { kind: 'port', portId: SCENARIO_IDS.portMotor },
    ],
    installationStatus: 'planned',
    sizingStatus: 'unchecked',
    routeId: null,
    kind: 'cable',
    service: 'power',
    coreCount: unknownDatumNumber(),
    sectionMm2: unknownDatumNumber(),
    outerDiameterMm: unknownDatumNumber(),
    minBendRadiusMm: unknownDatumNumber(),
  };
}

export interface TestScenarioPayload {
  elements: EquipmentElement[];
  ports: Port[];
  connections: Connection[];
}

export function buildTestScenario(): TestScenarioPayload {
  return {
    elements: [buildTablero(), buildMotor()],
    ports: [buildPortTablero(), buildPortMotor()],
    connections: [buildConnection()],
  };
}

/** True si alguno de los IDs del escenario ya existe en los elementos dados. */
export function hasScenarioElements(elements: Pick<EquipmentElement, 'id'>[]): boolean {
  return elements.some(
    (e) => e.id === SCENARIO_IDS.tablero || e.id === SCENARIO_IDS.motor,
  );
}
