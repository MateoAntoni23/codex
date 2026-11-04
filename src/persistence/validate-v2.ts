/**
 * validate-v2.ts — Runtime validator for ProjectDataV2.
 *
 * All helpers are pure functions; no side effects.
 * Errors report field paths like `"elements[2].parentId"`.
 *
 * Coherencia Datum.status / value:
 *   'unknown'  → value debe ser null
 *   'conflict' → value puede ser null (candidatos en evidencias) o no null
 *   'estimated'|'provided'|'verified' → value no puede ser null
 */

import type {
  ProjectDataV2,
  EquipmentElement,
  Port,
  Endpoint,
  Connection,
  CableCore,
  InternalLink,
  FunctionalRelation,
  Factory,
  Subarea,
  ElementService,
  FieldEvidence,
  MigrationIncident,
  Geometry,
  PhysicalLocation,
  Placement,
  TechnicalByCategory,
  Category,
  Datum,
  Quantity,
  Vec3,
  Quaternion,
  Id,
} from '../types/domain-v2';

// ---------------------------------------------------------------------------
// Low-level assertion helpers
// ---------------------------------------------------------------------------

function assertObject(val: unknown, path: string): Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new Error(`${path} debe ser un objeto, se recibió: ${JSON.stringify(val)}`);
  }
  return val as Record<string, unknown>;
}

function assertArray(val: unknown, path: string): unknown[] {
  if (!Array.isArray(val)) {
    throw new Error(`${path} debe ser un array, se recibió: ${JSON.stringify(val)}`);
  }
  return val;
}

function assertString(val: unknown, path: string): string {
  if (typeof val !== 'string') {
    throw new Error(`${path} debe ser un string, se recibió: ${JSON.stringify(val)}`);
  }
  return val;
}

function assertNonEmptyString(val: unknown, path: string): string {
  const s = assertString(val, path);
  if (s.trim() === '') {
    throw new Error(`${path} no puede ser un string vacío`);
  }
  return s;
}

function assertBoolean(val: unknown, path: string): boolean {
  if (typeof val !== 'boolean') {
    throw new Error(`${path} debe ser un booleano, se recibió: ${JSON.stringify(val)}`);
  }
  return val;
}

function assertFiniteNumber(val: unknown, path: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`${path} debe ser un número finito, se recibió: ${JSON.stringify(val)}`);
  }
  return val;
}

function assertPositive(val: unknown, path: string): number {
  const n = assertFiniteNumber(val, path);
  if (n <= 0) {
    throw new Error(`${path} debe ser positivo (> 0), se recibió: ${n}`);
  }
  return n;
}

function assertOneOf<T extends string>(val: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(val as T)) {
    throw new Error(
      `${path} debe ser uno de [${allowed.join(', ')}], se recibió: ${JSON.stringify(val)}`,
    );
  }
  return val as T;
}

// ---------------------------------------------------------------------------
// Vec3 / Quaternion
// ---------------------------------------------------------------------------

function validateVec3(raw: unknown, path: string): Vec3 {
  const obj = assertObject(raw, path);
  return {
    x: assertFiniteNumber(obj.x, `${path}.x`),
    y: assertFiniteNumber(obj.y, `${path}.y`),
    z: assertFiniteNumber(obj.z, `${path}.z`),
  };
}

function validateQuaternion(raw: unknown, path: string): Quaternion {
  const obj = assertObject(raw, path);
  const x = assertFiniteNumber(obj.x, `${path}.x`);
  const y = assertFiniteNumber(obj.y, `${path}.y`);
  const z = assertFiniteNumber(obj.z, `${path}.z`);
  const w = assertFiniteNumber(obj.w, `${path}.w`);
  const norm2 = x * x + y * y + z * z + w * w;
  if (Math.abs(norm2 - 1) > 1e-6) {
    throw new Error(
      `${path}: debe ser un quaternion unitario (|q|²=1), se obtuvo |q|²=${norm2.toFixed(8)}`,
    );
  }
  return { x, y, z, w };
}

// ---------------------------------------------------------------------------
// Datum / Quantity
// ---------------------------------------------------------------------------

const DATUM_STATUSES = [
  'unknown',
  'estimated',
  'provided',
  'verified',
  'conflict',
] as const;

function validateDatum<T>(
  raw: unknown,
  path: string,
  validateValue: (v: unknown, p: string) => T,
): Datum<T> {
  const obj = assertObject(raw, path);
  const status = assertOneOf(obj.status, DATUM_STATUSES, `${path}.status`);
  const evidenceIds = assertArray(obj.evidenceIds, `${path}.evidenceIds`).map((id, i) =>
    assertString(id, `${path}.evidenceIds[${i}]`),
  );
  const value = obj.value === null ? null : validateValue(obj.value, `${path}.value`);
  // Coherencia status ↔ value
  if (status === 'unknown' && value !== null) {
    throw new Error(`${path}: status='unknown' pero value no es null`);
  }
  if (
    (status === 'estimated' || status === 'provided' || status === 'verified') &&
    value === null
  ) {
    throw new Error(`${path}: status='${status}' pero value es null`);
  }
  return { value, status, evidenceIds };
}

function validateDatumString(raw: unknown, path: string): Datum<string> {
  return validateDatum(raw, path, (v, p) => assertString(v, p));
}

function validateDatumBoolean(raw: unknown, path: string): Datum<boolean> {
  return validateDatum(raw, path, (v, p) => assertBoolean(v, p));
}

function validateDatumNumber(raw: unknown, path: string): Datum<number> {
  return validateDatum(raw, path, (v, p) => assertFiniteNumber(v, p));
}

function validateQuantity<U extends string>(
  raw: unknown,
  path: string,
  allowedUnits: readonly U[],
): Quantity<U> {
  const obj = assertObject(raw, path);
  const unit = assertOneOf(obj.unit, allowedUnits, `${path}.unit`);
  const value = assertFiniteNumber(obj.value, `${path}.value`);
  return { value, unit };
}

function validateDatumQuantity<U extends string>(
  raw: unknown,
  path: string,
  allowedUnits: readonly U[],
): Datum<Quantity<U>> {
  return validateDatum(raw, path, (v, p) => validateQuantity(v, p, allowedUnits));
}

/** Verifica que un Datum<number> positivo tenga value > 0 cuando no es null. */
function assertDatumPositive(datum: Datum<number>, path: string): void {
  if (datum.value !== null && datum.value <= 0) {
    throw new Error(`${path}.value debe ser positivo cuando no es null, se recibió ${datum.value}`);
  }
}

// ---------------------------------------------------------------------------
// Physical location
// ---------------------------------------------------------------------------

function validatePhysicalLocation(raw: unknown, path: string): PhysicalLocation {
  const obj = assertObject(raw, path);
  const kind = assertOneOf(
    obj.kind,
    ['factory', 'shared', 'unassigned'] as const,
    `${path}.kind`,
  );
  const factoryId =
    obj.factoryId === null ? null : assertNonEmptyString(obj.factoryId, `${path}.factoryId`);
  const subareaId =
    obj.subareaId === null ? null : assertNonEmptyString(obj.subareaId, `${path}.subareaId`);
  const description =
    obj.description === null ? null : assertString(obj.description, `${path}.description`);
  if (kind === 'unassigned') {
    if (factoryId !== null)
      throw new Error(`${path}.factoryId debe ser null cuando kind='unassigned'`);
    if (subareaId !== null)
      throw new Error(`${path}.subareaId debe ser null cuando kind='unassigned'`);
  }
  if (kind === 'factory' && factoryId === null) {
    throw new Error(`${path}.factoryId es requerido cuando kind='factory'`);
  }
  return { kind, factoryId, subareaId, description };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function validateGeometry(raw: unknown, path: string): Geometry {
  const obj = assertObject(raw, path);
  const kind = assertOneOf(
    obj.kind,
    ['box', 'cylinder', 'plane', 'asset'] as const,
    `${path}.kind`,
  );
  if (kind === 'box') {
    return {
      kind: 'box',
      widthMm: assertPositive(obj.widthMm, `${path}.widthMm`),
      depthMm: assertPositive(obj.depthMm, `${path}.depthMm`),
      heightMm: assertPositive(obj.heightMm, `${path}.heightMm`),
    };
  }
  if (kind === 'cylinder') {
    return {
      kind: 'cylinder',
      diameterMm: assertPositive(obj.diameterMm, `${path}.diameterMm`),
      lengthMm: assertPositive(obj.lengthMm, `${path}.lengthMm`),
    };
  }
  if (kind === 'plane') {
    return {
      kind: 'plane',
      widthMm: assertPositive(obj.widthMm, `${path}.widthMm`),
      depthMm: assertPositive(obj.depthMm, `${path}.depthMm`),
    };
  }
  // kind === 'asset'
  return {
    kind: 'asset',
    assetId: assertNonEmptyString(obj.assetId, `${path}.assetId`),
    boundsMm: validateVec3(obj.boundsMm, `${path}.boundsMm`),
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function validatePlacement(raw: Record<string, unknown>, path: string): Placement {
  const status = assertOneOf(
    raw.placementStatus,
    ['unplaced', 'placed'] as const,
    `${path}.placementStatus`,
  );
  if (status === 'unplaced') {
    if (raw.transform !== null) {
      throw new Error(`${path}.transform debe ser null cuando placementStatus='unplaced'`);
    }
    return { placementStatus: 'unplaced', transform: null };
  }
  if (raw.transform === null || raw.transform === undefined) {
    throw new Error(`${path}.transform es requerido cuando placementStatus='placed'`);
  }
  const t = assertObject(raw.transform, `${path}.transform`);
  const positionMm = validateVec3(t.positionMm, `${path}.transform.positionMm`);
  const rotation = validateQuaternion(t.rotation, `${path}.transform.rotation`);
  return { placementStatus: 'placed', transform: { positionMm, rotation } };
}

// ---------------------------------------------------------------------------
// Technical data per category (13 categories)
// ---------------------------------------------------------------------------

function validateTechnicalMotor(raw: unknown, path: string): TechnicalByCategory['motor'] {
  const obj = assertObject(raw, path);
  const power = validateDatumQuantity(obj.power, `${path}.power`, ['kW', 'HP'] as const);
  const voltage = validateDatumQuantity(obj.voltage, `${path}.voltage`, ['V'] as const);
  const phases = validateDatum(obj.phases, `${path}.phases`, (v, p) => {
    if (v !== 1 && v !== 3) throw new Error(`${p} debe ser 1 o 3`);
    return v as 1 | 3;
  });
  const plateCurrent = validateDatumQuantity(
    obj.plateCurrent,
    `${path}.plateCurrent`,
    ['A'] as const,
  );
  const efficiency = validateDatumNumber(obj.efficiency, `${path}.efficiency`);
  if (efficiency.value !== null && (efficiency.value <= 0 || efficiency.value > 1)) {
    throw new Error(
      `${path}.efficiency.value: debe estar en (0, 1], se recibió ${efficiency.value}`,
    );
  }
  const powerFactor = validateDatumNumber(obj.powerFactor, `${path}.powerFactor`);
  if (powerFactor.value !== null && (powerFactor.value <= 0 || powerFactor.value > 1)) {
    throw new Error(
      `${path}.powerFactor.value: debe estar en (0, 1], se recibió ${powerFactor.value}`,
    );
  }
  const start = validateDatum(obj.start, `${path}.start`, (v, p) =>
    assertOneOf(v, ['direct', 'star_delta', 'softstarter', 'vfd', 'other'] as const, p),
  );
  return { power, voltage, phases, plateCurrent, efficiency, powerFactor, start };
}

function validateTechnicalSensor(raw: unknown, path: string): TechnicalByCategory['sensor'] {
  const obj = assertObject(raw, path);
  const measuredVariable = validateDatumString(
    obj.measuredVariable,
    `${path}.measuredVariable`,
  );
  const range = validateDatum(obj.range, `${path}.range`, (v, p) => {
    const o = assertObject(v, p);
    const min = assertFiniteNumber(o.min, `${p}.min`);
    const max = assertFiniteNumber(o.max, `${p}.max`);
    if (min > max) {
      throw new Error(`${p}: min (${min}) debe ser ≤ max (${max})`);
    }
    return { min, max, unit: assertString(o.unit, `${p}.unit`) };
  });
  const supply = validateDatum(obj.supply, `${path}.supply`, (v, p) => {
    const o = assertObject(v, p);
    return {
      voltageV: assertFiniteNumber(o.voltageV, `${p}.voltageV`),
      currentType: assertOneOf(o.currentType, ['AC', 'DC'] as const, `${p}.currentType`),
    };
  });
  const signal = validateDatum(obj.signal, `${path}.signal`, (v, p) =>
    assertOneOf(v, ['DI', '4_20mA', '0_10V', 'RTD', 'bus', 'other'] as const, p),
  );
  return { measuredVariable, range, supply, signal };
}

function validateTechnicalProcessValve(
  raw: unknown,
  path: string,
): TechnicalByCategory['process_valve'] {
  const obj = assertObject(raw, path);
  return {
    function: validateDatumString(obj.function, `${path}.function`),
    nominalSize: validateDatumString(obj.nominalSize, `${path}.nominalSize`),
    connection: validateDatumString(obj.connection, `${path}.connection`),
    fluid: validateDatumString(obj.fluid, `${path}.fluid`),
    pressure: validateDatumQuantity(obj.pressure, `${path}.pressure`, ['bar'] as const),
    temperature: validateDatumQuantity(obj.temperature, `${path}.temperature`, ['degC'] as const),
  };
}

function validateTechnicalSolenoidValve(
  raw: unknown,
  path: string,
): TechnicalByCategory['solenoid_valve'] {
  const obj = assertObject(raw, path);
  const configuration = validateDatum(obj.configuration, `${path}.configuration`, (v, p) =>
    assertOneOf(v, ['2/2', '3/2', '5/2', '5/3', 'other'] as const, p),
  );
  const coilSupply = validateDatum(obj.coilSupply, `${path}.coilSupply`, (v, p) => {
    const o = assertObject(v, p);
    return {
      voltageV: assertFiniteNumber(o.voltageV, `${p}.voltageV`),
      currentType: assertOneOf(o.currentType, ['AC', 'DC'] as const, `${p}.currentType`),
    };
  });
  const operatingPressure = validateDatum(
    obj.operatingPressure,
    `${path}.operatingPressure`,
    (v, p) => {
      const o = assertObject(v, p);
      return {
        minBar: assertFiniteNumber(o.minBar, `${p}.minBar`),
        maxBar: assertFiniteNumber(o.maxBar, `${p}.maxBar`),
      };
    },
  );
  const normalState = validateDatumString(obj.normalState, `${path}.normalState`);
  return { configuration, coilSupply, operatingPressure, normalState };
}

function validateTechnicalActuator(
  raw: unknown,
  path: string,
): TechnicalByCategory['actuator'] {
  const obj = assertObject(raw, path);
  const technology = validateDatum(obj.technology, `${path}.technology`, (v, p) =>
    assertOneOf(v, ['pneumatic', 'electric', 'hydraulic'] as const, p),
  );
  const action = validateDatum(obj.action, `${path}.action`, (v, p) =>
    assertOneOf(v, ['single', 'double'] as const, p),
  );
  const motion = validateDatum(obj.motion, `${path}.motion`, (v, p) =>
    assertOneOf(v, ['linear', 'rotary'] as const, p),
  );
  const stroke = validateDatumQuantity(obj.stroke, `${path}.stroke`, ['mm'] as const);
  const bore = validateDatumQuantity(obj.bore, `${path}.bore`, ['mm'] as const);
  const torque = validateDatumQuantity(obj.torque, `${path}.torque`, ['Nm'] as const);
  const workingPressure = validateDatumQuantity(
    obj.workingPressure,
    `${path}.workingPressure`,
    ['bar'] as const,
  );
  return { technology, action, motion, stroke, bore, torque, workingPressure };
}

function validateTechnicalElectricalPanel(
  raw: unknown,
  path: string,
): TechnicalByCategory['electrical_panel'] {
  const obj = assertObject(raw, path);
  return {
    ipRating: validateDatumString(obj.ipRating, `${path}.ipRating`),
    ratedCurrent: validateDatumQuantity(obj.ratedCurrent, `${path}.ratedCurrent`, ['A'] as const),
  };
}

function validateTechnicalPneumaticPanel(
  raw: unknown,
  path: string,
): TechnicalByCategory['pneumatic_panel'] {
  const obj = assertObject(raw, path);
  return {
    ipRating: validateDatumString(obj.ipRating, `${path}.ipRating`),
    inletPressure: validateDatumQuantity(
      obj.inletPressure,
      `${path}.inletPressure`,
      ['bar'] as const,
    ),
  };
}

function validateTechnicalPump(raw: unknown, path: string): TechnicalByCategory['pump'] {
  const obj = assertObject(raw, path);
  return {
    flow: validateDatumQuantity(obj.flow, `${path}.flow`, ['m3/h'] as const),
    head: validateDatumQuantity(obj.head, `${path}.head`, ['m'] as const),
    fluid: validateDatumString(obj.fluid, `${path}.fluid`),
  };
}

function validateTechnicalLuminaire(
  raw: unknown,
  path: string,
): TechnicalByCategory['luminaire'] {
  const obj = assertObject(raw, path);
  return {
    power: validateDatumQuantity(obj.power, `${path}.power`, ['W'] as const),
    voltage: validateDatumQuantity(obj.voltage, `${path}.voltage`, ['V'] as const),
    ipRating: validateDatumString(obj.ipRating, `${path}.ipRating`),
  };
}

function validateTechnicalPushbutton(
  raw: unknown,
  path: string,
): TechnicalByCategory['pushbutton'] {
  const obj = assertObject(raw, path);
  return {
    function: validateDatumString(obj.function, `${path}.function`),
    contacts: validateDatumString(obj.contacts, `${path}.contacts`),
    illumination: validateDatumBoolean(obj.illumination, `${path}.illumination`),
  };
}

function validateTechnicalTerminalBlock(
  raw: unknown,
  path: string,
): TechnicalByCategory['terminal_block'] {
  const obj = assertObject(raw, path);
  return {
    terminalCount: validateDatumNumber(obj.terminalCount, `${path}.terminalCount`),
  };
}

function validateTechnicalManifold(
  raw: unknown,
  path: string,
): TechnicalByCategory['manifold'] {
  const obj = assertObject(raw, path);
  return {
    stationCount: validateDatumNumber(obj.stationCount, `${path}.stationCount`),
    workingPressure: validateDatumQuantity(
      obj.workingPressure,
      `${path}.workingPressure`,
      ['bar'] as const,
    ),
  };
}

function validateTechnicalInfrastructure(
  raw: unknown,
  path: string,
): TechnicalByCategory['infrastructure'] {
  const obj = assertObject(raw, path);
  const role = validateDatum(obj.role, `${path}.role`, (v, p) =>
    assertOneOf(v, ['floor', 'building', 'wall', 'column', 'other'] as const, p),
  );
  return { role };
}

type TechnicalData = TechnicalByCategory[Category];

function validateTechnicalData(category: Category, raw: unknown, path: string): TechnicalData {
  switch (category) {
    case 'motor':
      return validateTechnicalMotor(raw, path);
    case 'sensor':
      return validateTechnicalSensor(raw, path);
    case 'process_valve':
      return validateTechnicalProcessValve(raw, path);
    case 'solenoid_valve':
      return validateTechnicalSolenoidValve(raw, path);
    case 'actuator':
      return validateTechnicalActuator(raw, path);
    case 'electrical_panel':
      return validateTechnicalElectricalPanel(raw, path);
    case 'pneumatic_panel':
      return validateTechnicalPneumaticPanel(raw, path);
    case 'pump':
      return validateTechnicalPump(raw, path);
    case 'luminaire':
      return validateTechnicalLuminaire(raw, path);
    case 'pushbutton':
      return validateTechnicalPushbutton(raw, path);
    case 'terminal_block':
      return validateTechnicalTerminalBlock(raw, path);
    case 'manifold':
      return validateTechnicalManifold(raw, path);
    case 'infrastructure':
      return validateTechnicalInfrastructure(raw, path);
    default: {
      const _x: never = category;
      throw new Error(`${path}: categoría desconocida "${String(_x)}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Equipment element
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'electrical_panel',
  'pneumatic_panel',
  'motor',
  'pump',
  'sensor',
  'process_valve',
  'solenoid_valve',
  'actuator',
  'luminaire',
  'pushbutton',
  'terminal_block',
  'manifold',
  'infrastructure',
] as const;

const MOUNTINGS = [
  'floor',
  'wall',
  'din_rail',
  'panel_mount',
  'structure',
  'unknown',
] as const;

function validateEquipmentElement(raw: unknown, index: number): EquipmentElement {
  const path = `elements[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const name = assertNonEmptyString(obj.name, `${path}.name`);
  const tag = obj.tag === null ? null : assertString(obj.tag, `${path}.tag`);
  const aliases = assertArray(obj.aliases, `${path}.aliases`).map((a, i) =>
    assertString(a, `${path}.aliases[${i}]`),
  );
  const condition = assertOneOf(
    obj.condition,
    ['existing', 'new', 'replacement', 'unknown'] as const,
    `${path}.condition`,
  );
  const lifecycle = assertOneOf(
    obj.lifecycle,
    ['active', 'retired'] as const,
    `${path}.lifecycle`,
  );
  const parentId =
    obj.parentId === null ? null : assertString(obj.parentId, `${path}.parentId`);
  const mounting = assertOneOf(obj.mounting, MOUNTINGS, `${path}.mounting`);
  const manufacturer = validateDatumString(obj.manufacturer, `${path}.manufacturer`);
  const model = validateDatumString(obj.model, `${path}.model`);
  const geometry =
    obj.geometry === null ? null : validateGeometry(obj.geometry, `${path}.geometry`);
  const physicalLocation = validatePhysicalLocation(
    obj.physicalLocation,
    `${path}.physicalLocation`,
  );
  const version = assertFiniteNumber(obj.version, `${path}.version`);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${path}.version debe ser un entero >= 1`);
  }
  const placement = validatePlacement(obj, path);
  const category = assertOneOf(obj.category, CATEGORIES, `${path}.category`);
  const technical = validateTechnicalData(category, obj.technical, `${path}.technical`);

  const common = {
    id, name, tag, aliases, condition, lifecycle, parentId, mounting,
    manufacturer, model, geometry, physicalLocation, version,
  };

  return { ...common, ...placement, category, technical } as EquipmentElement;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

function validatePort(raw: unknown, index: number): Port {
  const path = `ports[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const elementId = assertNonEmptyString(obj.elementId, `${path}.elementId`);
  const name = assertNonEmptyString(obj.name, `${path}.name`);
  const localPositionMm = validateVec3(obj.localPositionMm, `${path}.localPositionMm`);
  const localDirection = validateVec3(obj.localDirection, `${path}.localDirection`);

  // Direction must not be the zero vector
  const { x: dx, y: dy, z: dz } = localDirection;
  if (dx === 0 && dy === 0 && dz === 0) {
    throw new Error(`${path}.localDirection no puede ser el vector cero`);
  }

  const anchor = assertOneOf(
    obj.anchor,
    ['fixed_local', 'face'] as const,
    `${path}.anchor`,
  );
  const medium = assertOneOf(
    obj.medium,
    ['electrical', 'pneumatic', 'hydraulic'] as const,
    `${path}.medium`,
  );

  const base = { id, elementId, name, localPositionMm, localDirection, anchor };

  if (medium === 'electrical') {
    const role = assertOneOf(
      obj.role,
      ['power', 'control', 'signal', 'PE'] as const,
      `${path}.role`,
    );
    const ratedVoltageV =
      obj.ratedVoltageV === null
        ? null
        : assertFiniteNumber(obj.ratedVoltageV, `${path}.ratedVoltageV`);
    const terminalName = assertString(obj.terminalName, `${path}.terminalName`);
    const connectorKind = assertOneOf(
      obj.connectorKind,
      ['terminal', 'multipolar'] as const,
      `${path}.connectorKind`,
    );
    if (connectorKind === 'terminal') {
      const parentPortId =
        obj.parentPortId === null
          ? null
          : assertString(obj.parentPortId, `${path}.parentPortId`);
      return {
        ...base, medium, role, ratedVoltageV, terminalName,
        connectorKind: 'terminal', parentPortId,
      } as Port;
    }
    // multipolar
    if (obj.parentPortId !== null) {
      throw new Error(`${path}.parentPortId debe ser null cuando connectorKind='multipolar'`);
    }
    const pinCount =
      obj.pinCount === null ? null : assertFiniteNumber(obj.pinCount, `${path}.pinCount`);
    if (pinCount !== null && (!Number.isInteger(pinCount) || pinCount <= 0)) {
      throw new Error(`${path}.pinCount debe ser un entero positivo cuando no es null`);
    }
    return {
      ...base, medium, role, ratedVoltageV, terminalName,
      connectorKind: 'multipolar', pinCount, parentPortId: null,
    } as Port;
  }

  if (medium === 'pneumatic') {
    const role = assertOneOf(
      obj.role,
      ['supply', 'working', 'exhaust'] as const,
      `${path}.role`,
    );
    const connector =
      obj.connector === null ? null : assertString(obj.connector, `${path}.connector`);
    const maxPressureBar =
      obj.maxPressureBar === null
        ? null
        : assertFiniteNumber(obj.maxPressureBar, `${path}.maxPressureBar`);
    return { ...base, medium, role, connector, maxPressureBar } as Port;
  }

  // hydraulic
  const role = assertOneOf(
    obj.role,
    ['supply', 'working', 'return'] as const,
    `${path}.role`,
  );
  const connector =
    obj.connector === null ? null : assertString(obj.connector, `${path}.connector`);
  const maxPressureBar =
    obj.maxPressureBar === null
      ? null
      : assertFiniteNumber(obj.maxPressureBar, `${path}.maxPressureBar`);
  return { ...base, medium, role, connector, maxPressureBar } as Port;
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

function validateEndpoint(raw: unknown, path: string): Endpoint {
  const obj = assertObject(raw, path);
  const kind = assertOneOf(obj.kind, ['port', 'unresolved'] as const, `${path}.kind`);
  if (kind === 'port') {
    const portId = assertNonEmptyString(obj.portId, `${path}.portId`);
    return { kind: 'port', portId };
  }
  // unresolved
  const sourceLabel = assertString(obj.sourceLabel, `${path}.sourceLabel`);
  return { kind: 'unresolved', sourceLabel };
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function validateConnection(raw: unknown, index: number): Connection {
  const path = `connections[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const tag = obj.tag === null ? null : assertString(obj.tag, `${path}.tag`);

  if (obj.routeId !== null) {
    throw new Error(`${path}.routeId debe ser null (no disponible hasta M7+)`);
  }

  const endsRaw = assertArray(obj.ends, `${path}.ends`);
  if (endsRaw.length !== 2) {
    throw new Error(`${path}.ends debe tener exactamente 2 elementos`);
  }
  const ends: [Endpoint, Endpoint] = [
    validateEndpoint(endsRaw[0], `${path}.ends[0]`),
    validateEndpoint(endsRaw[1], `${path}.ends[1]`),
  ];

  const installationStatus = assertOneOf(
    obj.installationStatus,
    ['planned', 'cut', 'mounted', 'verified'] as const,
    `${path}.installationStatus`,
  );
  const sizingStatus = assertOneOf(
    obj.sizingStatus,
    ['unchecked', 'pending_data', 'valid', 'invalid'] as const,
    `${path}.sizingStatus`,
  );
  const kind = assertOneOf(
    obj.kind,
    ['cable', 'hose', 'manifold_passage'] as const,
    `${path}.kind`,
  );

  const base = { id, tag, ends, installationStatus, sizingStatus, routeId: null as null };

  if (kind === 'cable') {
    const service = assertOneOf(
      obj.service,
      ['power', 'control', 'instrumentation', 'maneuver'] as const,
      `${path}.service`,
    );
    const coreCount = validateDatumNumber(obj.coreCount, `${path}.coreCount`);
    if (coreCount.value !== null && (!Number.isInteger(coreCount.value) || coreCount.value <= 0)) {
      throw new Error(
        `${path}.coreCount.value debe ser un entero positivo cuando no es null`,
      );
    }
    const sectionMm2 = validateDatumNumber(obj.sectionMm2, `${path}.sectionMm2`);
    assertDatumPositive(sectionMm2, `${path}.sectionMm2`);
    const outerDiameterMm = validateDatumNumber(obj.outerDiameterMm, `${path}.outerDiameterMm`);
    assertDatumPositive(outerDiameterMm, `${path}.outerDiameterMm`);
    const minBendRadiusMm = validateDatumNumber(obj.minBendRadiusMm, `${path}.minBendRadiusMm`);
    assertDatumPositive(minBendRadiusMm, `${path}.minBendRadiusMm`);
    return {
      ...base, kind: 'cable', service, coreCount, sectionMm2, outerDiameterMm, minBendRadiusMm,
    } as Connection;
  }

  if (kind === 'hose') {
    const medium = assertOneOf(
      obj.medium,
      ['pneumatic', 'hydraulic'] as const,
      `${path}.medium`,
    );
    const innerDiameterMm = validateDatumNumber(obj.innerDiameterMm, `${path}.innerDiameterMm`);
    assertDatumPositive(innerDiameterMm, `${path}.innerDiameterMm`);
    const outerDiameterMm = validateDatumNumber(obj.outerDiameterMm, `${path}.outerDiameterMm`);
    assertDatumPositive(outerDiameterMm, `${path}.outerDiameterMm`);
    if (
      innerDiameterMm.value !== null &&
      outerDiameterMm.value !== null &&
      innerDiameterMm.value >= outerDiameterMm.value
    ) {
      throw new Error(
        `${path}: innerDiameterMm (${innerDiameterMm.value}) debe ser < outerDiameterMm (${outerDiameterMm.value})`,
      );
    }
    const material = validateDatumString(obj.material, `${path}.material`);
    const workingPressureBar = validateDatumNumber(
      obj.workingPressureBar,
      `${path}.workingPressureBar`,
    );
    assertDatumPositive(workingPressureBar, `${path}.workingPressureBar`);
    const minBendRadiusMm = validateDatumNumber(obj.minBendRadiusMm, `${path}.minBendRadiusMm`);
    assertDatumPositive(minBendRadiusMm, `${path}.minBendRadiusMm`);
    return {
      ...base, kind: 'hose', medium, innerDiameterMm, outerDiameterMm,
      material, workingPressureBar, minBendRadiusMm,
    } as Connection;
  }

  // manifold_passage
  const medium = assertOneOf(obj.medium, ['pneumatic'] as const, `${path}.medium`);
  return { ...base, kind: 'manifold_passage', medium } as Connection;
}

// ---------------------------------------------------------------------------
// CableCore
// ---------------------------------------------------------------------------

function validateCableCore(raw: unknown, index: number): CableCore {
  const path = `cableCores[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const cableId = assertNonEmptyString(obj.cableId, `${path}.cableId`);
  const label = obj.label === null ? null : assertString(obj.label, `${path}.label`);
  const conductor = assertOneOf(
    obj.conductor,
    ['phase', 'neutral', 'PE', 'screen', 'other'] as const,
    `${path}.conductor`,
  );
  const endsRaw = assertArray(obj.ends, `${path}.ends`);
  if (endsRaw.length !== 2) {
    throw new Error(`${path}.ends debe tener exactamente 2 elementos`);
  }
  const ends: [Endpoint, Endpoint] = [
    validateEndpoint(endsRaw[0], `${path}.ends[0]`),
    validateEndpoint(endsRaw[1], `${path}.ends[1]`),
  ];
  return { id, cableId, label, conductor, ends };
}

// ---------------------------------------------------------------------------
// InternalLink
// ---------------------------------------------------------------------------

function validateInternalLink(raw: unknown, index: number): InternalLink {
  const path = `internalLinks[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const fromPortId = assertNonEmptyString(obj.fromPortId, `${path}.fromPortId`);
  const toPortId = assertNonEmptyString(obj.toPortId, `${path}.toPortId`);
  const kind = assertOneOf(obj.kind, ['conductive', 'passage'] as const, `${path}.kind`);
  return { id, fromPortId, toPortId, kind };
}

// ---------------------------------------------------------------------------
// FunctionalRelation
// ---------------------------------------------------------------------------

function validateFunctionalRelation(raw: unknown, index: number): FunctionalRelation {
  const path = `functionalRelations[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const fromElementId = assertNonEmptyString(obj.fromElementId, `${path}.fromElementId`);
  const toElementId = assertNonEmptyString(obj.toElementId, `${path}.toElementId`);
  const kind = assertOneOf(obj.kind, ['controls', 'actuates'] as const, `${path}.kind`);
  return { id, fromElementId, toElementId, kind };
}

// ---------------------------------------------------------------------------
// Factory / Subarea
// ---------------------------------------------------------------------------

function validateFactory(raw: unknown, index: number): Factory {
  const path = `factories[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const name = assertNonEmptyString(obj.name, `${path}.name`);
  const aliases = assertArray(obj.aliases, `${path}.aliases`).map((a, i) =>
    assertString(a, `${path}.aliases[${i}]`),
  );
  return { id, name, aliases };
}

function validateSubarea(raw: unknown, index: number): Subarea {
  const path = `subareas[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const factoryId = assertNonEmptyString(obj.factoryId, `${path}.factoryId`);
  const name = assertNonEmptyString(obj.name, `${path}.name`);
  const aliases = assertArray(obj.aliases, `${path}.aliases`).map((a, i) =>
    assertString(a, `${path}.aliases[${i}]`),
  );
  return { id, factoryId, name, aliases };
}

// ---------------------------------------------------------------------------
// ElementService
// ---------------------------------------------------------------------------

function validateElementService(raw: unknown, index: number): ElementService {
  const path = `elementServices[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const elementId = assertNonEmptyString(obj.elementId, `${path}.elementId`);
  const factoryId = assertNonEmptyString(obj.factoryId, `${path}.factoryId`);
  const note = obj.note === null ? null : assertString(obj.note, `${path}.note`);
  return { id, elementId, factoryId, note };
}

// ---------------------------------------------------------------------------
// FieldEvidence
// ---------------------------------------------------------------------------

function validateFieldEvidence(raw: unknown, index: number): FieldEvidence {
  const path = `evidence[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const elementOrConnectionId = assertNonEmptyString(
    obj.elementOrConnectionId,
    `${path}.elementOrConnectionId`,
  );
  const fieldPath = assertString(obj.fieldPath, `${path}.fieldPath`);
  const source = assertOneOf(
    obj.source,
    ['manual', 'xlsx', 'datasheet', 'migration'] as const,
    `${path}.source`,
  );
  const fileChecksum =
    obj.fileChecksum === null ? null : assertString(obj.fileChecksum, `${path}.fileChecksum`);
  const sheet = obj.sheet === null ? null : assertString(obj.sheet, `${path}.sheet`);
  const row = obj.row === null ? null : assertFiniteNumber(obj.row, `${path}.row`);
  const cell = obj.cell === null ? null : assertString(obj.cell, `${path}.cell`);
  const formula = obj.formula === null ? null : assertString(obj.formula, `${path}.formula`);
  const rawValue = obj.rawValue;
  const author = obj.author === null ? null : assertString(obj.author, `${path}.author`);
  const recordedAt = assertString(obj.recordedAt, `${path}.recordedAt`);
  return {
    id, elementOrConnectionId, fieldPath, source,
    fileChecksum, sheet, row, cell, formula, rawValue, author, recordedAt,
  };
}

// ---------------------------------------------------------------------------
// MigrationIncident
// ---------------------------------------------------------------------------

function validateMigrationIncident(raw: unknown, index: number): MigrationIncident {
  const path = `migrationIncidents[${index}]`;
  const obj = assertObject(raw, path);

  const id = assertNonEmptyString(obj.id, `${path}.id`);
  const elementId = assertNonEmptyString(obj.elementId, `${path}.elementId`);
  const field = assertString(obj.field, `${path}.field`);
  const code = assertNonEmptyString(obj.code, `${path}.code`);
  const originalValues = assertObject(
    obj.originalValues,
    `${path}.originalValues`,
  ) as Record<string, unknown>;
  const message = assertString(obj.message, `${path}.message`);
  return { id, elementId, field, code, originalValues, message };
}

// ---------------------------------------------------------------------------
// Cross-reference helpers
// ---------------------------------------------------------------------------

function checkUniqueIds(items: { id: Id }[], collectionName: string): Set<Id> {
  const seen = new Set<Id>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`ID duplicado en ${collectionName}: "${item.id}"`);
    }
    seen.add(item.id);
  }
  return seen;
}

function checkParentIdChains(elements: EquipmentElement[], elementIds: Set<Id>): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.parentId !== null && !elementIds.has(el.parentId)) {
      throw new Error(`elements[${i}].parentId: referencia inexistente "${el.parentId}"`);
    }
  }
  const visiting = new Set<Id>();
  const visited = new Set<Id>();

  function dfs(id: Id): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Se detectó un ciclo en las relaciones parentId (elemento: "${id}")`);
    }
    visiting.add(id);
    const el = elements.find((e) => e.id === id);
    if (el?.parentId) {
      dfs(el.parentId);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const el of elements) {
    dfs(el.id);
  }
}

function checkTagUniqueness(elements: EquipmentElement[]): void {
  const seen = new Map<string, Id>();
  for (const el of elements) {
    if (el.tag !== null) {
      const existing = seen.get(el.tag);
      if (existing !== undefined) {
        throw new Error(`TAG duplicado "${el.tag}" en elementos "${existing}" y "${el.id}"`);
      }
      seen.set(el.tag, el.id);
    }
    for (const alias of el.aliases) {
      const existingAlias = seen.get(alias);
      if (existingAlias !== undefined) {
        throw new Error(
          `Alias/TAG duplicado "${alias}" en elemento "${existingAlias}" y aliases de "${el.id}"`,
        );
      }
      seen.set(alias, el.id);
    }
  }
}

/**
 * Recorre un objeto JSON-like y recopila todos los valores de arrays bajo
 * la clave "evidenceIds". Usado para verificar que los IDs de evidencia
 * referenciados en los Datum existan en el array evidence[].
 */
function collectEvidenceIds(obj: unknown): string[] {
  if (typeof obj !== 'object' || obj === null) return [];
  if (Array.isArray(obj)) return obj.flatMap(collectEvidenceIds);
  const record = obj as Record<string, unknown>;
  const ids: string[] = [];
  for (const [key, val] of Object.entries(record)) {
    if (key === 'evidenceIds' && Array.isArray(val)) {
      for (const id of val) {
        if (typeof id === 'string') ids.push(id);
      }
    } else {
      ids.push(...collectEvidenceIds(val));
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/** Validates a raw unknown value as ProjectDataV2. Throws Error if invalid. */
export function validateProjectDataV2(raw: unknown): ProjectDataV2 {
  const data = assertObject(raw, 'ProjectDataV2');

  if (data.schemaVersion !== 2) {
    throw new Error(
      `schemaVersion incompatible: se esperaba 2, se recibió ${JSON.stringify(data.schemaVersion)}`,
    );
  }

  const projectOrigin = validateVec3(data.projectOrigin, 'projectOrigin');

  // Structural validation
  const elements: EquipmentElement[] = assertArray(data.elements, 'elements').map((e, i) =>
    validateEquipmentElement(e, i),
  );
  const ports: Port[] = assertArray(data.ports, 'ports').map((p, i) => validatePort(p, i));
  const connections: Connection[] = assertArray(data.connections, 'connections').map((c, i) =>
    validateConnection(c, i),
  );
  const cableCores: CableCore[] = assertArray(data.cableCores, 'cableCores').map((cc, i) =>
    validateCableCore(cc, i),
  );
  const internalLinks: InternalLink[] = assertArray(data.internalLinks, 'internalLinks').map(
    (il, i) => validateInternalLink(il, i),
  );
  const functionalRelations: FunctionalRelation[] = assertArray(
    data.functionalRelations,
    'functionalRelations',
  ).map((fr, i) => validateFunctionalRelation(fr, i));
  const factories: Factory[] = assertArray(data.factories, 'factories').map((f, i) =>
    validateFactory(f, i),
  );
  const subareas: Subarea[] = assertArray(data.subareas, 'subareas').map((s, i) =>
    validateSubarea(s, i),
  );
  const elementServices: ElementService[] = assertArray(
    data.elementServices,
    'elementServices',
  ).map((es, i) => validateElementService(es, i));
  const evidence: FieldEvidence[] = assertArray(data.evidence, 'evidence').map((ev, i) =>
    validateFieldEvidence(ev, i),
  );
  const migrationIncidents: MigrationIncident[] = assertArray(
    data.migrationIncidents,
    'migrationIncidents',
  ).map((mi, i) => validateMigrationIncident(mi, i));

  // -------------------------------------------------------------------------
  // Cross-reference checks
  // -------------------------------------------------------------------------

  const elementIds = checkUniqueIds(elements, 'elements');
  const portIds = checkUniqueIds(ports, 'ports');
  const connectionIds = checkUniqueIds(connections, 'connections');
  checkUniqueIds(cableCores, 'cableCores');
  checkUniqueIds(internalLinks, 'internalLinks');
  checkUniqueIds(functionalRelations, 'functionalRelations');
  const factoryIds = checkUniqueIds(factories, 'factories');
  const subareaIds = checkUniqueIds(subareas, 'subareas');
  checkUniqueIds(elementServices, 'elementServices');
  checkUniqueIds(evidence, 'evidence');
  checkUniqueIds(migrationIncidents, 'migrationIncidents');

  checkParentIdChains(elements, elementIds);
  checkTagUniqueness(elements);

  // subarea.factoryId must reference an existing factory
  for (let i = 0; i < subareas.length; i++) {
    if (!factoryIds.has(subareas[i].factoryId)) {
      throw new Error(
        `subareas[${i}].factoryId: referencia inexistente "${subareas[i].factoryId}"`,
      );
    }
  }

  // element physicalLocation references
  const subareaFactoryMap = new Map<Id, Id>(subareas.map((s) => [s.id, s.factoryId]));
  for (let i = 0; i < elements.length; i++) {
    const loc = elements[i].physicalLocation;
    if (loc.kind === 'factory' && loc.factoryId !== null && !factoryIds.has(loc.factoryId)) {
      throw new Error(
        `elements[${i}].physicalLocation.factoryId: referencia inexistente "${loc.factoryId}"`,
      );
    }
    if (loc.subareaId !== null) {
      if (!subareaIds.has(loc.subareaId)) {
        throw new Error(
          `elements[${i}].physicalLocation.subareaId: referencia inexistente "${loc.subareaId}"`,
        );
      }
      const subareaFactory = subareaFactoryMap.get(loc.subareaId);
      if (loc.factoryId !== null && subareaFactory !== loc.factoryId) {
        throw new Error(
          `elements[${i}].physicalLocation: subareaId "${loc.subareaId}" no pertenece a factoryId "${loc.factoryId}"`,
        );
      }
    }
  }

  // elementService existence + no duplicate (elementId, factoryId) pairs
  const elementServicePairs = new Set<string>();
  for (let i = 0; i < elementServices.length; i++) {
    const es = elementServices[i];
    if (!elementIds.has(es.elementId)) {
      throw new Error(
        `elementServices[${i}].elementId: referencia inexistente "${es.elementId}"`,
      );
    }
    if (!factoryIds.has(es.factoryId)) {
      throw new Error(
        `elementServices[${i}].factoryId: referencia inexistente "${es.factoryId}"`,
      );
    }
    const pair = `${es.elementId}::${es.factoryId}`;
    if (elementServicePairs.has(pair)) {
      throw new Error(
        `elementServices[${i}]: relación duplicada entre elemento "${es.elementId}" y fábrica "${es.factoryId}"`,
      );
    }
    elementServicePairs.add(pair);
  }

  // port.elementId must reference an existing element
  for (let i = 0; i < ports.length; i++) {
    if (!elementIds.has(ports[i].elementId)) {
      throw new Error(`ports[${i}].elementId: referencia inexistente "${ports[i].elementId}"`);
    }
  }

  // Build portMap for further cross-references
  const portMap = new Map<Id, Port>();
  for (const port of ports) {
    portMap.set(port.id, port);
  }

  // Electrical terminal parentPortId must reference a multipolar port in the same element
  for (let i = 0; i < ports.length; i++) {
    const port = ports[i];
    if (
      port.medium === 'electrical' &&
      port.connectorKind === 'terminal' &&
      port.parentPortId !== null
    ) {
      const parent = portMap.get(port.parentPortId);
      if (!parent) {
        throw new Error(
          `ports[${i}].parentPortId: referencia inexistente "${port.parentPortId}"`,
        );
      }
      if (
        parent.medium !== 'electrical' ||
        parent.connectorKind !== 'multipolar' ||
        parent.elementId !== port.elementId
      ) {
        throw new Error(
          `ports[${i}].parentPortId: debe referenciar un puerto multipolar del mismo elemento`,
        );
      }
    }
  }

  // internalLink port existence + medium coherence
  for (let i = 0; i < internalLinks.length; i++) {
    const il = internalLinks[i];
    if (!portIds.has(il.fromPortId)) {
      throw new Error(
        `internalLinks[${i}].fromPortId: referencia inexistente "${il.fromPortId}"`,
      );
    }
    if (!portIds.has(il.toPortId)) {
      throw new Error(
        `internalLinks[${i}].toPortId: referencia inexistente "${il.toPortId}"`,
      );
    }
    const fromPort = portMap.get(il.fromPortId)!;
    const toPort = portMap.get(il.toPortId)!;
    if (il.kind === 'conductive') {
      if (fromPort.medium !== 'electrical' || toPort.medium !== 'electrical') {
        throw new Error(
          `internalLinks[${i}]: kind='conductive' requiere puertos eléctricos en ambos extremos`,
        );
      }
    } else {
      // passage
      if (fromPort.medium === 'electrical' || toPort.medium === 'electrical') {
        throw new Error(
          `internalLinks[${i}]: kind='passage' no es compatible con puertos eléctricos`,
        );
      }
      if (fromPort.medium !== toPort.medium) {
        throw new Error(
          `internalLinks[${i}]: kind='passage' requiere el mismo medium en ambos extremos (${fromPort.medium} ≠ ${toPort.medium})`,
        );
      }
    }
  }

  // functionalRelation element references
  for (let i = 0; i < functionalRelations.length; i++) {
    const fr = functionalRelations[i];
    if (!elementIds.has(fr.fromElementId)) {
      throw new Error(
        `functionalRelations[${i}].fromElementId: referencia inexistente "${fr.fromElementId}"`,
      );
    }
    if (!elementIds.has(fr.toElementId)) {
      throw new Error(
        `functionalRelations[${i}].toElementId: referencia inexistente "${fr.toElementId}"`,
      );
    }
  }

  // Connection endpoint port existence + medium compatibility
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    for (let e = 0; e < 2; e++) {
      const endpoint = conn.ends[e];
      if (endpoint.kind !== 'port') continue;
      const refPort = portMap.get(endpoint.portId);
      if (!refPort) {
        throw new Error(
          `connections[${i}].ends[${e}].portId: referencia inexistente "${endpoint.portId}"`,
        );
      }
      if (conn.kind === 'cable' && refPort.medium !== 'electrical') {
        throw new Error(
          `connections[${i}].ends[${e}]: cable solo puede conectar puertos eléctricos, se encontró medium='${refPort.medium}'`,
        );
      }
      if (conn.kind === 'hose' && refPort.medium !== conn.medium) {
        throw new Error(
          `connections[${i}].ends[${e}]: manguera '${conn.medium}' solo puede conectar puertos '${conn.medium}', se encontró medium='${refPort.medium}'`,
        );
      }
      if (conn.kind === 'manifold_passage' && refPort.medium !== 'pneumatic') {
        throw new Error(
          `connections[${i}].ends[${e}]: manifold_passage solo puede conectar puertos neumáticos`,
        );
      }
    }
  }

  // cableCore.cableId must reference an existing cable connection;
  // cableCore endpoints of kind:'port' must reference electrical terminal ports
  const connectionKindMap = new Map<Id, string>(connections.map((c) => [c.id, c.kind]));
  for (let i = 0; i < cableCores.length; i++) {
    const cableId = cableCores[i].cableId;
    if (!connectionIds.has(cableId)) {
      throw new Error(`cableCores[${i}].cableId: referencia inexistente "${cableId}"`);
    }
    if (connectionKindMap.get(cableId) !== 'cable') {
      throw new Error(
        `cableCores[${i}].cableId: la conexión "${cableId}" no es de kind='cable'`,
      );
    }
    for (let e = 0; e < 2; e++) {
      const endpoint = cableCores[i].ends[e];
      if (endpoint.kind === 'port') {
        const refPort = portMap.get(endpoint.portId);
        if (!refPort) {
          throw new Error(
            `cableCores[${i}].ends[${e}].portId: referencia inexistente "${endpoint.portId}"`,
          );
        }
        if (refPort.medium !== 'electrical' || refPort.connectorKind !== 'terminal') {
          throw new Error(
            `cableCores[${i}].ends[${e}].portId: debe referenciar un puerto eléctrico con connectorKind='terminal'`,
          );
        }
      }
    }
  }

  // FieldEvidence owner: elementOrConnectionId must reference an element or connection
  const elementOrConnectionIds = new Set<Id>([...elementIds, ...connectionIds]);
  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i];
    if (!elementOrConnectionIds.has(ev.elementOrConnectionId)) {
      throw new Error(
        `evidence[${i}].elementOrConnectionId: referencia inexistente "${ev.elementOrConnectionId}"`,
      );
    }
  }

  // MigrationIncident element reference
  for (let i = 0; i < migrationIncidents.length; i++) {
    if (!elementIds.has(migrationIncidents[i].elementId)) {
      throw new Error(
        `migrationIncidents[${i}].elementId: referencia inexistente "${migrationIncidents[i].elementId}"`,
      );
    }
  }

  // Datum evidenceIds must reference existing FieldEvidence records
  const evidenceIdSet = new Set<Id>(evidence.map((ev) => ev.id));
  const allReferencedEvidenceIds = [
    ...elements.flatMap(collectEvidenceIds),
    ...connections.flatMap(collectEvidenceIds),
  ];
  for (const refId of allReferencedEvidenceIds) {
    if (!evidenceIdSet.has(refId)) {
      throw new Error(`evidenceId referenciado pero no encontrado en evidence[]: "${refId}"`);
    }
  }

  return {
    schemaVersion: 2,
    projectOrigin,
    elements,
    ports,
    connections,
    cableCores,
    internalLinks,
    functionalRelations,
    factories,
    subareas,
    elementServices,
    evidence,
    migrationIncidents,
  };
}
