/**
 * domain-v2.ts — Contratos TypeScript para el modelo de dominio v2.
 *
 * Especificaciones; no se usan en el flujo de producción actual (schemaVersion=1).
 * La aplicación sigue leyendo y escribiendo v1 hasta activación posterior a M1b.
 *
 * PLACEMENT (unión discriminada):
 *   'unplaced' → transform es null; el equipo no participa de metraje ni
 *   se presenta como situado en el origen real.
 *   'placed'   → transform requerido con positionMm y rotation (quaternion
 *   unitario). Si tiene padre, la transformación es local; para posición global
 *   todos los ancestros deben estar ubicados.
 *
 * MOUNTING:
 *   Ortogonal a parentId. Un motor puede ser hijo de una bomba (parentId ≠ null)
 *   y estar montado en piso (mounting:'floor') sin contradicción.
 *   'internal' fue omitido deliberadamente; usar parentId para contención.
 *
 * CONNECTOR KIND (solo puertos eléctricos):
 *   'terminal'   = borne individual. parentPortId: ID del multipolar que lo
 *                  contiene, o null para terminales autónomos.
 *   'multipolar' = conector de varios pines. pinCount: null si desconocido.
 *                  parentPortId siempre null en el conector mismo.
 *   Los puertos neumáticos e hidráulicos usan connector:string|null para el
 *   tipo de acoplamiento fluídico (G1/4, NPT, etc.); no tienen connectorKind.
 *
 * ROUTE ID:
 *   Siempre null hasta que exista el grafo de bandejas (M7+). Se tipa como
 *   routeId:null para que el sistema de tipos haga cumplir el invariante en
 *   tiempo de compilación.
 *
 * VERSION:
 *   Entero ≥ 1; inicializado en 1 al crear o migrar. Incrementa exactamente
 *   una vez por cambio confirmado. No incrementa por selección, renderizado
 *   ni borradores cancelados.
 *
 * MIGRATION INCIDENT:
 *   Entidad explícita almacenada en ProjectDataV2.migrationIncidents[].
 *   Sobrevive exportación e importación para auditorías posteriores.
 */

// ─── Primitivos ──────────────────────────────────────────────────────────────

/** ID opaco: cadena no vacía. */
export type Id = string;

/** Vector 3D en milímetros (eje Z vertical). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion unitario para rotación 3D (debe satisfacer |q|² ≈ 1). */
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Quaternion identidad (sin rotación). */
export const IDENTITY_QUATERNION: Quaternion = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1,
});

// ─── Categorías ──────────────────────────────────────────────────────────────

export type Category =
  | 'electrical_panel'
  | 'pneumatic_panel'
  | 'motor'
  | 'pump'
  | 'sensor'
  | 'process_valve'
  | 'solenoid_valve'
  | 'actuator'
  | 'luminaire'
  | 'pushbutton'
  | 'terminal_block'
  | 'manifold'
  | 'infrastructure';

// ─── Datum y Quantity ────────────────────────────────────────────────────────

/**
 * Envuelve un valor de campo con estado de conocimiento y evidencias.
 * null = desconocido; cero conserva su significado físico.
 * 'conflict': múltiples fuentes con valores distintos; candidatos en evidencias.
 * Estimado, proporcionado y verificado son estados distintos; no equiparar.
 */
export type Datum<T> = {
  value: T | null;
  status: 'unknown' | 'estimated' | 'provided' | 'verified' | 'conflict';
  evidenceIds: Id[];
};

/**
 * Medida física con valor numérico y unidad.
 * Se envuelve en Datum<Quantity<U>> cuando el valor puede ser desconocido.
 */
export type Quantity<U extends string> = { value: number; unit: U };

// ─── Ubicación física ────────────────────────────────────────────────────────

/**
 * Ubicación física de un equipo.
 *
 * 'factory'    — el equipo reside en una fábrica concreta.
 *                factoryId: requerido (no null).
 *                subareaId: opcional (null si no aplica; si se indica, debe
 *                pertenecer al factoryId declarado).
 *
 * 'shared'     — el equipo atiende o está entre varias fábricas; no hay
 *                una sola fábrica de residencia.
 *                factoryId: debe ser null (usar ElementService para registrar
 *                las fábricas a las que atiende).
 *                subareaId: debe ser null.
 *
 * 'unassigned' — ubicación aún no determinada.
 *                factoryId: debe ser null.
 *                subareaId: debe ser null.
 *
 * description: comentario libre, opcional en todos los kinds.
 */
export type PhysicalLocation = {
  kind: 'factory' | 'shared' | 'unassigned';
  factoryId: Id | null;
  subareaId: Id | null;
  description: string | null;
};

// ─── Geometría ───────────────────────────────────────────────────────────────

export type Geometry =
  | { kind: 'box'; widthMm: number; depthMm: number; heightMm: number }
  | { kind: 'cylinder'; diameterMm: number; lengthMm: number }
  | { kind: 'plane'; widthMm: number; depthMm: number }
  | { kind: 'asset'; assetId: Id; boundsMm: Vec3 };

// ─── Placement ───────────────────────────────────────────────────────────────

/** Ver JSDoc del módulo para la semántica completa. */
export type Placement =
  | { placementStatus: 'unplaced'; transform: null }
  | {
      placementStatus: 'placed';
      transform: { positionMm: Vec3; rotation: Quaternion };
    };

// ─── Fichas técnicas por categoría ───────────────────────────────────────────

export type TechnicalByCategory = {
  motor: {
    power: Datum<Quantity<'kW' | 'HP'>>;
    voltage: Datum<Quantity<'V'>>;
    phases: Datum<1 | 3>;
    plateCurrent: Datum<Quantity<'A'>>;
    efficiency: Datum<number>; // 0 < η ≤ 1
    powerFactor: Datum<number>; // 0 < cosφ ≤ 1
    start: Datum<'direct' | 'star_delta' | 'softstarter' | 'vfd' | 'other'>;
  };
  sensor: {
    measuredVariable: Datum<string>;
    range: Datum<{ min: number; max: number; unit: string }>;
    supply: Datum<{ voltageV: number; currentType: 'AC' | 'DC' }>;
    signal: Datum<'DI' | '4_20mA' | '0_10V' | 'RTD' | 'bus' | 'other'>;
  };
  process_valve: {
    function: Datum<string>;
    nominalSize: Datum<string>;
    connection: Datum<string>;
    fluid: Datum<string>;
    pressure: Datum<Quantity<'bar'>>;
    temperature: Datum<Quantity<'degC'>>;
  };
  solenoid_valve: {
    configuration: Datum<'2/2' | '3/2' | '5/2' | '5/3' | 'other'>;
    coilSupply: Datum<{ voltageV: number; currentType: 'AC' | 'DC' }>;
    operatingPressure: Datum<{ minBar: number; maxBar: number }>;
    normalState: Datum<string>;
  };
  actuator: {
    technology: Datum<'pneumatic' | 'electric' | 'hydraulic'>;
    action: Datum<'single' | 'double'>;
    motion: Datum<'linear' | 'rotary'>;
    stroke: Datum<Quantity<'mm'>>;
    bore: Datum<Quantity<'mm'>>;
    torque: Datum<Quantity<'Nm'>>;
    workingPressure: Datum<Quantity<'bar'>>;
  };
  electrical_panel: {
    ipRating: Datum<string>;
    ratedCurrent: Datum<Quantity<'A'>>;
  };
  pneumatic_panel: {
    ipRating: Datum<string>;
    inletPressure: Datum<Quantity<'bar'>>;
  };
  pump: {
    flow: Datum<Quantity<'m3/h'>>;
    head: Datum<Quantity<'m'>>;
    fluid: Datum<string>;
  };
  luminaire: {
    power: Datum<Quantity<'W'>>;
    voltage: Datum<Quantity<'V'>>;
    ipRating: Datum<string>;
  };
  pushbutton: {
    function: Datum<string>;
    contacts: Datum<string>;
    illumination: Datum<boolean>;
  };
  terminal_block: {
    terminalCount: Datum<number>;
  };
  manifold: {
    stationCount: Datum<number>;
    workingPressure: Datum<Quantity<'bar'>>;
  };
  infrastructure: {
    role: Datum<'floor' | 'building' | 'wall' | 'column' | 'other'>;
  };
};

// ─── Equipo ──────────────────────────────────────────────────────────────────

/**
 * Campos comunes a todos los equipos (sin categoría ni Placement).
 *
 * geometry: null indica dimensiones aún no conocidas; se muestra como
 *   marcador «sin dimensiones», nunca como una dimensión inventada.
 *
 * mounting: cómo está montado el equipo, ortogonal a parentId.
 *   'floor'       — apoya en piso
 *   'wall'        — fijado a pared
 *   'din_rail'    — sobre riel DIN (dentro de un gabinete)
 *   'panel_mount' — atornillado a placa de montaje
 *   'structure'   — colgado de estructura o viga
 *
 * version: entero ≥ 1; inicializado en 1 al crear o migrar.
 *   Ver JSDoc del módulo para reglas de incremento.
 */
export type EquipmentElementCommon = {
  id: Id;
  tag: string | null;
  aliases: string[];
  name: string;
  physicalLocation: PhysicalLocation;
  condition: 'existing' | 'new' | 'replacement' | 'unknown';
  lifecycle: 'active' | 'retired';
  parentId: Id | null;
  geometry: Geometry | null;
  mounting: 'floor' | 'wall' | 'din_rail' | 'panel_mount' | 'structure' | 'unknown';
  manufacturer: Datum<string>;
  model: Datum<string>;
  version: number;
  /**
   * Vínculo opcional con un registro de un catálogo importado (ELS-IMP-EQCX).
   *   equipoId: ID estable (EQ-NNNN) del equipo en ese libro — identidad externa.
   *   libroId:  fileHash del libro que originó el vínculo — traza qué archivo lo creó.
   * Si está presente, la ficha técnica se lee del catálogo vinculado. Si el libro cambia
   * pero conserva el equipoId, la vinculación se mantiene (es un rename/modificación).
   * Si el equipoId desaparece del libro reimportado, el elemento queda como huérfano
   * y el usuario decide; nunca se elimina automáticamente.
   */
  importedRef: { equipoId: Id; libroId: string } | null;
};

/** EquipmentElementBase = campos comunes + Placement. */
export type EquipmentElementBase = EquipmentElementCommon & Placement;

/** Equipo con categoría y ficha técnica específica. */
export type EquipmentElement = {
  [K in Category]: EquipmentElementBase & {
    category: K;
    technical: TechnicalByCategory[K];
  };
}[Category];

// ─── Puerto ──────────────────────────────────────────────────────────────────

/**
 * Puerto de un equipo. Ver JSDoc del módulo para connectorKind.
 *
 * Para puertos eléctricos:
 *   connectorKind:'terminal'   → borne individual. parentPortId: ID del
 *     multipolar padre, o null para terminal autónomo.
 *   connectorKind:'multipolar' → conector de varios pines; parentPortId null.
 *   CableCore.ends debe referenciar Port{medium:'electrical',connectorKind:'terminal'}.
 *
 * Para puertos neumáticos e hidráulicos:
 *   connector describe el tipo de acoplamiento (G1/4, BSP, etc.) — sin connectorKind.
 *   Hidráulico está previsto en contratos; sin cálculos hidráulicos en M1–M7.
 */
export type Port = {
  id: Id;
  elementId: Id;
  name: string;
  localPositionMm: Vec3;
  localDirection: Vec3;
  anchor: 'fixed_local' | 'face';
} & (
  | ({
      medium: 'electrical';
      role: 'power' | 'control' | 'signal' | 'PE';
      ratedVoltageV: number | null;
      terminalName: string;
    } & (
      | { connectorKind: 'terminal'; parentPortId: Id | null }
      | { connectorKind: 'multipolar'; pinCount: number | null; parentPortId: null }
    ))
  | {
      medium: 'pneumatic';
      role: 'supply' | 'working' | 'exhaust';
      connector: string | null;
      maxPressureBar: number | null;
    }
  | {
      medium: 'hydraulic'; // previsto; sin cálculos hidráulicos en M1–M7
      role: 'supply' | 'working' | 'return';
      connector: string | null;
      maxPressureBar: number | null;
    }
);

// ─── Conexiones ──────────────────────────────────────────────────────────────

export type Endpoint =
  | { kind: 'port'; portId: Id }
  | { kind: 'unresolved'; sourceLabel: string };

/**
 * Conexión entre equipos.
 * routeId es siempre null hasta que exista el grafo de bandejas (M7+).
 * Para mangueras, medium distingue pneumatic de hydraulic.
 */
export type Connection = {
  id: Id;
  tag: string | null;
  ends: [Endpoint, Endpoint];
  installationStatus: 'planned' | 'cut' | 'mounted' | 'verified';
  sizingStatus: 'unchecked' | 'pending_data' | 'valid' | 'invalid';
  routeId: null;
} & (
  | {
      kind: 'cable';
      service: 'power' | 'control' | 'instrumentation' | 'maneuver';
      coreCount: Datum<number>;
      sectionMm2: Datum<number>;
      outerDiameterMm: Datum<number>;
      minBendRadiusMm: Datum<number>;
    }
  | {
      kind: 'hose';
      medium: 'pneumatic' | 'hydraulic';
      innerDiameterMm: Datum<number>;
      outerDiameterMm: Datum<number>;
      material: Datum<string>;
      workingPressureBar: Datum<number>;
      minBendRadiusMm: Datum<number>;
    }
  | { kind: 'manifold_passage'; medium: 'pneumatic' }
);

/**
 * Conductor individual dentro de un cable físico.
 * El cable mantiene un único ID y BOM; los hilos no se cuentan como cables adicionales.
 * ends deben referenciar Port{medium:'electrical', connectorKind:'terminal'}.
 * PE y apantallamiento requieren terminales explícitos.
 */
export interface CableCore {
  id: Id;
  cableId: Id;
  label: string | null;
  conductor: 'phase' | 'neutral' | 'PE' | 'screen' | 'other';
  ends: [Endpoint, Endpoint];
}

/**
 * Continuidad entre dos puertos del mismo elemento o relacionados por
 * contención (borne pasante, paso fluídico en manifold).
 */
export interface InternalLink {
  id: Id;
  fromPortId: Id;
  toPortId: Id;
  kind: 'conductive' | 'passage';
}

/**
 * Relación funcional entre dos equipos.
 * Distinta de contención (parentId): una electroválvula puede controlar
 * un actuador (FunctionalRelation) sin contenerlo (parentId).
 */
export interface FunctionalRelation {
  id: Id;
  fromElementId: Id;
  toElementId: Id;
  kind: 'controls' | 'actuates';
}

// ─── Organización ────────────────────────────────────────────────────────────

export interface Factory {
  id: Id;
  name: string;
  aliases: string[]; // SEC, S1, EVA, EA, EVB, EB — para conciliación de importación
}

export interface Subarea {
  id: Id;
  factoryId: Id;
  name: string;
  aliases: string[];
}

/**
 * Relación muchos-a-muchos: equipo ↔ fábricas a las que atiende.
 * Separado de PhysicalLocation y de parentId.
 * Permite que TAB-B atienda EVA y EVB con un único objeto.
 */
export interface ElementService {
  id: Id;
  elementId: Id;
  factoryId: Id;
  note: string | null;
}

// ─── Procedencia ─────────────────────────────────────────────────────────────

/**
 * Procedencia y confirmación por campo.
 * fileChecksum es una referencia de trazabilidad, no una copia del archivo.
 * recordedAt: ISO 8601.
 */
export interface FieldEvidence {
  id: Id;
  elementOrConnectionId: Id;
  fieldPath: string;
  source: 'manual' | 'xlsx' | 'datasheet' | 'migration';
  fileChecksum: string | null;
  sheet: string | null;
  row: number | null;
  cell: string | null;
  formula: string | null;
  rawValue: unknown;
  author: string | null;
  recordedAt: string;
}

/**
 * Incidencia explícita de migración. Se almacena en migrationIncidents[]
 * para sobrevivir exportación e importación.
 * id: determinista (ev-inc-{elementId}-{code}).
 */
export interface MigrationIncident {
  id: Id;
  elementId: Id;
  field: string;
  code: string;
  originalValues: Record<string, unknown>;
  message: string;
}

/**
 * Contrato futuro para cuando exista el grafo de bandejas (M7+).
 * No inicializar durante la migración v1→v2.
 */
export interface RouteAssignment {
  id: Id;
  connectionId: Id;
  segments: Id[];
}

// ─── Proyecto v2 ─────────────────────────────────────────────────────────────

export interface ProjectDataV2 {
  schemaVersion: 2;
  projectOrigin: Vec3;
  elements: EquipmentElement[];
  factories: Factory[];
  subareas: Subarea[];
  elementServices: ElementService[];
  ports: Port[];
  connections: Connection[];
  cableCores: CableCore[];
  internalLinks: InternalLink[];
  functionalRelations: FunctionalRelation[];
  evidence: FieldEvidence[];
  migrationIncidents: MigrationIncident[];
  // routeAssignments se agrega cuando exista el grafo de bandejas (M7+)
}
