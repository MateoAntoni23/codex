> Propuesta histórica preservada del commit 51bf02d. No implementar como contrato vigente.
> Referencia vigente: ../equipment-domain-model.md y plan M1–M7.

# Modelo de dominio de equipos

> **Estado:** propuesta de diseño — sin implementar  
> **Última actualización:** 2026-11-04  
> **Referencia:** `docs/product-requirements.md`, `docs/implementation-plan.md`

---

## Aviso sobre datos

No se dispone de un archivo Excel en esta sesión. Todos los ejemplos de
equipos, TAGs, posiciones y datos técnicos en este documento son
**ficticios** y tienen solo propósito ilustrativo. No representan equipos,
configuraciones ni valores reales del proyecto.

---

## 1. Visión general

El modelo actual (`schemaVersion: 1`) representa los objetos de la escena
con cuatro tipos planos: `floor`, `building`, `panel`, `motor`. El modelo
propuesto (`schemaVersion: 2`) introduce:

- Una **base común** para todos los equipos con TAG, condición,
  organización, orientación y estado de confirmación.
- **Diez categorías de equipos** con datos técnicos específicos.
- **Composición padre/hijo** para representar gabinetes y sus componentes.
- **Conexiones** como entidades propias (cables, mangueras, aire).
- **Organización** en fábricas con subáreas y asociaciones compartidas.
- **Geometría extendida** con forma, puertos y punto de anclaje.

La **infraestructura** (`floor`, `building`) se mantiene separada del
catálogo de equipos; no lleva datos técnicos ni conexiones.

---

## 2. Entidades del dominio

### 2.1 Base común — `EquipmentBase`

Todos los equipos comparten estos campos, independientemente de su categoría.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `string` | Identificador estable. Nunca cambia, ni al renombrar el equipo. |
| `tag` | `string` | TAG de la instalación (p. ej. `"M-SEC-01"`). Único en el proyecto. |
| `name` | `string` | Nombre descriptivo libre. |
| `category` | `EquipmentCategory` | Categoría funcional del equipo. |
| `condition` | `'existing' \| 'new'` | Si el equipo ya existe o es nuevo. |
| `confirmationStatus` | `ConfirmationStatus` | Nivel de certeza de los datos cargados. |
| `position` | `Vec3mm` | Centro geométrico en mm, eje Z vertical. |
| `orientation` | `Orientation` | Rotación del equipo (yaw alrededor de Z). |
| `geometry` | `EquipmentGeometry` | Forma y dimensiones (caja, cilindro). |
| `ports` | `Port[]` | Puertos eléctricos y neumáticos del equipo. |
| `technicalData` | `TechnicalData` | Datos específicos por categoría. |
| `locationId` | `string \| null` | Ubicación física (puede diferir de las fábricas atendidas). |
| `fabricaIds` | `string[]` | IDs de las fábricas a las que atiende este equipo. |
| `subareaId` | `string \| null` | Subárea dentro de la fábrica de ubicación. |
| `parentId` | `string \| null` | ID del equipo padre si es componente interno. |
| `localPosition` | `Vec3mm \| null` | Posición relativa al padre. `null` si no tiene padre. |
| `source` | `DataSource` | Procedencia y fecha de los datos. |
| `notes` | `string \| null` | Observaciones libres. |

**Estado de confirmación:**

| Valor | Significado |
|---|---|
| `'pending'` | Sin confirmar; los datos son estimados o incompletos. |
| `'confirmed'` | Confirmado con documentación o relevamiento. |
| `'review'` | Requiere revisión; hay dudas o inconsistencias. |

**Regla sobre valores desconocidos:** los campos numéricos opcionales usan
`null` para representar "desconocido". **Nunca se usa `0` para representar
ausencia de dato.** La UI distingue visualmente `null` ("sin dato") de `0`
("cero confirmado").

---

### 2.2 Categorías de equipos

```
EquipmentCategory =
  | 'electrical_panel'  // Tablero eléctrico
  | 'pneumatic_panel'   // Tablero neumático
  | 'motor'
  | 'pump'              // Bomba
  | 'sensor'
  | 'process_valve'     // Válvula de proceso
  | 'solenoid_valve'    // Electroválvula
  | 'actuator'          // Actuador
  | 'luminaire'         // Luminaria
  | 'pushbutton'        // Botonera
```

La lista de categorías está diseñada para crecer: agregar una nueva categoría
solo requiere definir su `TechnicalData` y actualizar el validador de esquema.
Los campos de `EquipmentBase` no cambian.

---

### 2.3 Datos técnicos por categoría

#### Motor

| Campo | Tipo | Descripción |
|---|---|---|
| `powerValue` | `number \| null` | Valor numérico de potencia. |
| `powerUnit` | `'HP' \| 'kW' \| null` | Unidad de potencia. |
| `voltage` | `number \| null` | Tensión nominal (V). |
| `phases` | `1 \| 3 \| null` | Monofásico o trifásico. |
| `currentNominal` | `number \| null` | Corriente nominal (A). |
| `startingType` | `MotorStartingType \| null` | Tipo de arranque. |

```
MotorStartingType =
  | 'direct'       // Arranque directo
  | 'star_delta'   // Estrella-triángulo
  | 'soft_starter' // Arrancador suave
  | 'vfd'          // Variador de frecuencia (VFD/VSD)
```

#### Sensor

| Campo | Tipo | Descripción |
|---|---|---|
| `measuredMagnitude` | `string \| null` | Magnitud medida (temperatura, presión, caudal…). |
| `rangeMin` | `number \| null` | Límite inferior del rango. |
| `rangeMax` | `number \| null` | Límite superior del rango. |
| `rangeUnit` | `string \| null` | Unidad del rango (°C, bar, m³/h…). |
| `supplyVoltage` | `number \| null` | Tensión de alimentación (V). |
| `signalType` | `string \| null` | Tipo de señal: `'4-20mA'`, `'0-10V'`, `'discrete_NPN'`, `'Modbus'`… |

El campo `signalType` es `string` para permitir protocolos futuros sin
cambiar el esquema.

#### Válvula de proceso

| Campo | Tipo | Descripción |
|---|---|---|
| `valveFunction` | `ProcessValveFunction \| null` | Función de la válvula. |
| `connectionType` | `'flanged' \| 'threaded' \| 'welded' \| null` | Tipo de conexión. |
| `nominalSize` | `string \| null` | Tamaño nominal (p. ej. `"DN50"`, `"2\""`). |
| `fluid` | `string \| null` | Fluido de trabajo. |
| `workingPressureBar` | `number \| null` | Presión de trabajo (bar). |
| `workingTempC` | `number \| null` | Temperatura de trabajo (°C). |

```
ProcessValveFunction = 'on_off' | 'control' | 'check' | 'safety'
```

#### Electroválvula

| Campo | Tipo | Descripción |
|---|---|---|
| `configuration` | `'2/2' \| '3/2' \| '4/2' \| '5/2' \| '5/3' \| null` | Vías/posiciones. |
| `coilVoltage` | `number \| null` | Tensión de bobina (V). |
| `coilVoltageType` | `'AC' \| 'DC' \| null` | Tipo de tensión. |
| `workingPressureBar` | `number \| null` | Presión de trabajo (bar). |
| `portSize` | `string \| null` | Tamaño de puertos neumáticos (p. ej. `"G1/4"`). |
| `manifoldId` | `string \| null` | ID del manifold al que pertenece (si aplica). |

Los puertos físicos (eléctrico de bobina, neumáticos de trabajo) se
modelan en `EquipmentBase.ports`.

#### Actuador

| Campo | Tipo | Descripción |
|---|---|---|
| `actuatorType` | `ActuatorType \| null` | Tipo de actuador. |
| `effect` | `'single' \| 'double' \| null` | Simple o doble efecto. |
| `boreOrTorque` | `number \| null` | Diámetro de émbolo en mm (lineal) o par en N·m (rotativo). |
| `strokeMM` | `number \| null` | Carrera en mm (solo actuadores lineales). |
| `supplyPressureBar` | `number \| null` | Presión de suministro (bar). |

```
ActuatorType =
  | 'pneumatic_linear'  // Cilindro neumático lineal
  | 'pneumatic_rotary'  // Actuador neumático rotativo
  | 'hydraulic'
  | 'electric'
```

Un actuador puede requerir varias mangueras (p. ej. doble efecto con
entrada y salida de aire separadas). Esto se modela mediante múltiples
`Connection` que apuntan a diferentes puertos del actuador, no repitiendo
el objeto.

#### Tablero eléctrico

| Campo | Tipo | Descripción |
|---|---|---|
| `mountingType` | `'floor' \| 'wall' \| null` | Montaje en piso o pared. |
| `ipRating` | `string \| null` | Grado de protección (p. ej. `"IP54"`). |
| `voltageRating` | `number \| null` | Tensión nominal (V). |
| `childIds` | `string[]` | IDs de componentes internos (relés, borneras, etc.). |

#### Tablero neumático

| Campo | Tipo | Descripción |
|---|---|---|
| `mountingType` | `'floor' \| 'wall' \| null` | Montaje. |
| `ipRating` | `string \| null` | Grado de protección. |
| `supplyPressureBar` | `number \| null` | Presión de suministro de aire (bar). |
| `childIds` | `string[]` | IDs de electroválvulas, manifold y otros componentes internos. |

#### Categorías sin datos técnicos propios (estado actual)

Bomba, luminaria y botonera tienen solo campos de `EquipmentBase` por ahora.
Sus `TechnicalData` se define como `{ category: 'pump' | 'luminaire' | 'pushbutton' }`.
Cuando se requieran datos específicos se agrega la interfaz correspondiente
sin cambiar la base.

---

### 2.4 Puertos

Un puerto es un punto de conexión físico del equipo. Se almacena en
`EquipmentBase.ports[]`.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `string` | ID del puerto, único dentro del equipo. |
| `portType` | `PortType` | Medio del puerto. |
| `localPosition` | `Vec3mm` | Posición relativa al centro del equipo. |
| `label` | `string \| null` | Etiqueta del puerto (p. ej. `"A"`, `"B"`, `"L1"`). |

```
PortType = 'electrical' | 'pneumatic_supply' | 'pneumatic_work' | 'signal'
```

Los puertos eléctricos y neumáticos son **incompatibles** entre sí. Una
`Connection` solo puede unir puertos del mismo medio o compatible.

Cuando se redimensiona el equipo, los puertos se reposicionan
proporcionalmente respecto del punto de anclaje, salvo que tengan
`localPosition` definida manualmente (en ese caso, se conserva hasta
que el usuario la actualice explícitamente).

---

### 2.5 Composición — relaciones padre/hijo

Un tablero neumático puede contener electroválvulas, un manifold y otros
componentes internos. Estas relaciones se modelan mediante:

- `EquipmentBase.parentId`: ID del equipo contenedor. `null` si es raíz.
- `EquipmentBase.localPosition`: posición del hijo relativa al **centro**
  del padre. `null` si no tiene padre.

**Posición global de un hijo:**

```
globalPosition(hijo) = parent.position + rotate(hijo.localPosition, parent.orientation)
```

El cálculo se aplica de forma recursiva para jerarquías anidadas, pero
**no se permiten ciclos**: el grafo de composición debe ser un árbol
dirigido acíclico (DAG sin ramas reentrantes).

**Al mover el padre**, los hijos se mueven con él (sus `localPosition` no
cambian). **No se escalan** los componentes interiores al redimensionar
el contenedor: las dimensiones de los hijos son independientes.

Cuando el contenedor no puede albergar al hijo (dimensiones insuficientes),
se emite una **advertencia de incompatibilidad de espacio**, pero no se
bloquea el guardado. El usuario decide si ignorar o corregir.

---

### 2.6 Conexiones

Las conexiones son **entidades propias** del proyecto. No son campos de
texto dentro del equipo.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `string` | ID estable de la conexión. |
| `connectionType` | `ConnectionType` | Tipo de medio. |
| `sourceId` | `string` | ID del equipo origen. |
| `sourcePortId` | `string` | Puerto del equipo origen. |
| `targetId` | `string` | ID del equipo destino. |
| `targetPortId` | `string` | Puerto del equipo destino. |
| `cableData` | `CableData \| null` | Solo si `connectionType = 'cable'`. |
| `hoseData` | `HoseData \| null` | Solo si `connectionType = 'hose'`. |
| `status` | `ConnectionStatus` | Estado de la conexión. |
| `notes` | `string \| null` | Observaciones libres. |

```
ConnectionType = 'cable' | 'hose' | 'air_supply'

ConnectionStatus =
  | 'assigned'        // Conexión definida; dimensionamiento pendiente
  | 'pending_sizing'  // En proceso de dimensionamiento
  | 'confirmed'       // Dimensionamiento confirmado
```

**Separación asignación / dimensionamiento:** definir que "el cable X
conecta el tablero A con la electroválvula B" es independiente de calcular
su sección, longitud o protección. El estado `'assigned'` indica que la
asociación existe aunque los datos técnicos estén incompletos.

**Restricción:** un cable puede pasar por borneras o interfaces intermedias.
La conexión modela el tramo directo entre dos puertos. Tramos intermedios
se modelan como conexiones adicionales (mismo cable, puertos de bornera).

**Datos de cable:**

| Campo | Tipo | Descripción |
|---|---|---|
| `crossSectionMm2` | `number \| null` | Sección (mm²). |
| `cableType` | `string \| null` | Tipo de cable (NYY, LIYCY…). |
| `conductors` | `number \| null` | Número de conductores. |
| `voltageRating` | `number \| null` | Tensión de aislación (V). |
| `routeId` | `string \| null` | Referencia al recorrido (bandeja/ducto). |

**Datos de manguera:**

| Campo | Tipo | Descripción |
|---|---|---|
| `outerDiameterMM` | `number \| null` | Diámetro exterior (mm). |
| `innerDiameterMM` | `number \| null` | Diámetro interior (mm). |
| `material` | `string \| null` | Material (polietileno, nylon, acero…). |
| `workingPressureBar` | `number \| null` | Presión de trabajo (bar). |
| `minimumBendRadiusMM` | `number \| null` | Radio mínimo de curvatura (mm). |
| `routeId` | `string \| null` | Referencia al recorrido. |

---

### 2.7 Geometría extendida

Todos los equipos tienen geometría. Se soportan dos formas básicas:

**Caja (`BoxGeometry`):** ancho × profundidad × altura. Tableros, motores,
botoneras.

**Cilindro (`CylinderGeometry`):** diámetro × altura. Bombas, algunos
actuadores, válvulas de proceso.

```
AnchorPoint =
  | 'center_bottom'  // Centro de la base inferior (default equipos en piso)
  | 'wall_center'    // Centro de la cara trasera (tableros en pared)
  | 'geometric_center'
```

El **punto de anclaje** define qué punto permanece fijo al redimensionar.
Para equipos en piso, `center_bottom` mantiene la base en su posición.
Para tableros en pared, `wall_center` mantiene la cara de montaje.

Cuando se modifica la geometría de un contenedor (tablero), los
componentes internos **no se reposicionan automáticamente**. Si alguno
queda fuera de los límites, se genera una advertencia.

---

### 2.8 Organización — fábricas y subáreas

```
Factory {
  id: string
  name: string        // "Secado", "Evaporador A", "Evaporador B"
  codes: string[]     // ["SEC", "S1"] / ["EVA", "EA"] / ["EVB", "EB"]
  subareaIds: string[]
}

Subarea {
  id: string
  name: string        // "Filtro de Manga"
  code: string        // "FM"
  factoryId: string   // ID de Secado
}
```

Las **asociaciones equipo/fábrica** son entidades separadas para permitir
que un equipo esté asociado a varias fábricas (p. ej. TAB-B):

```
EquipmentFactoryAssociation {
  id: string
  equipmentId: string
  factoryId: string
  subareaId: string | null
  role: 'located' | 'serves'
}
```

- `'located'`: el equipo está físicamente en esa fábrica/subárea.
- `'serves'`: el equipo atiende a esa fábrica aunque esté ubicado en otra.

TAB-B tiene **una** asociación `role: 'located'` y **dos** asociaciones
`role: 'serves'` (una para EVA, otra para EVB). No hay dos objetos TAB-B.

---

## 3. Contratos TypeScript propuestos

> **Nota:** estos tipos son propuesta de diseño. No están implementados
> en el código actual. Se implementarán en fases (ver sección 8).

```typescript
// ─── Primitivas compartidas ────────────────────────────────────────────────

type EquipmentCategory =
  | 'electrical_panel'
  | 'pneumatic_panel'
  | 'motor'
  | 'pump'
  | 'sensor'
  | 'process_valve'
  | 'solenoid_valve'
  | 'actuator'
  | 'luminaire'
  | 'pushbutton';

type ConfirmationStatus = 'pending' | 'confirmed' | 'review';

type PortType =
  | 'electrical'
  | 'pneumatic_supply'
  | 'pneumatic_work'
  | 'signal';

type AnchorPoint = 'center_bottom' | 'wall_center' | 'geometric_center';

type ConnectionType = 'cable' | 'hose' | 'air_supply';
type ConnectionStatus = 'assigned' | 'pending_sizing' | 'confirmed';

// ─── Geometría ─────────────────────────────────────────────────────────────

interface BoxGeometry {
  shape: 'box';
  width: number;
  depth: number;
  height: number;
  anchorPoint: AnchorPoint;
}

interface CylinderGeometry {
  shape: 'cylinder';
  diameter: number;
  height: number;
  anchorPoint: AnchorPoint;
}

type EquipmentGeometry = BoxGeometry | CylinderGeometry;

// ─── Puertos ───────────────────────────────────────────────────────────────

interface Port {
  id: string;
  portType: PortType;
  localPosition: Vec3mm;
  label: string | null;
}

// ─── Orientación ───────────────────────────────────────────────────────────

interface Orientation {
  yawDeg: number;  // Rotación alrededor de Z en grados [0, 360)
}

// ─── Procedencia ───────────────────────────────────────────────────────────

interface DataSource {
  origin: 'manual' | 'excel_import' | 'dwg_import' | 'estimated';
  reference: string | null;  // nombre de archivo, hoja, fila, etc.
  dateISO: string | null;    // fecha de ingreso en formato ISO 8601
}

// ─── Datos técnicos (discriminated union) ─────────────────────────────────

interface MotorData {
  category: 'motor';
  powerValue: number | null;
  powerUnit: 'HP' | 'kW' | null;
  voltage: number | null;
  phases: 1 | 3 | null;
  currentNominal: number | null;
  startingType: 'direct' | 'star_delta' | 'soft_starter' | 'vfd' | null;
}

interface SensorData {
  category: 'sensor';
  measuredMagnitude: string | null;
  rangeMin: number | null;
  rangeMax: number | null;
  rangeUnit: string | null;
  supplyVoltage: number | null;
  signalType: string | null;
}

interface ProcessValveData {
  category: 'process_valve';
  valveFunction: 'on_off' | 'control' | 'check' | 'safety' | null;
  connectionType: 'flanged' | 'threaded' | 'welded' | null;
  nominalSize: string | null;
  fluid: string | null;
  workingPressureBar: number | null;
  workingTempC: number | null;
}

interface SolenoidValveData {
  category: 'solenoid_valve';
  configuration: '2/2' | '3/2' | '4/2' | '5/2' | '5/3' | null;
  coilVoltage: number | null;
  coilVoltageType: 'AC' | 'DC' | null;
  workingPressureBar: number | null;
  portSize: string | null;
  manifoldId: string | null;
}

interface ActuatorData {
  category: 'actuator';
  actuatorType:
    | 'pneumatic_linear'
    | 'pneumatic_rotary'
    | 'hydraulic'
    | 'electric'
    | null;
  effect: 'single' | 'double' | null;
  boreOrTorque: number | null;
  strokeMM: number | null;
  supplyPressureBar: number | null;
}

interface ElectricalPanelData {
  category: 'electrical_panel';
  mountingType: 'floor' | 'wall' | null;
  ipRating: string | null;
  voltageRating: number | null;
  childIds: string[];
}

interface PneumaticPanelData {
  category: 'pneumatic_panel';
  mountingType: 'floor' | 'wall' | null;
  ipRating: string | null;
  supplyPressureBar: number | null;
  childIds: string[];
}

interface PumpData      { category: 'pump' }
interface LuminaireData { category: 'luminaire' }
interface PushbuttonData { category: 'pushbutton' }

type TechnicalData =
  | MotorData
  | SensorData
  | ProcessValveData
  | SolenoidValveData
  | ActuatorData
  | ElectricalPanelData
  | PneumaticPanelData
  | PumpData
  | LuminaireData
  | PushbuttonData;

// ─── Base común de equipos ─────────────────────────────────────────────────

interface EquipmentBase {
  id: string;
  tag: string;
  name: string;
  category: EquipmentCategory;
  condition: 'existing' | 'new';
  confirmationStatus: ConfirmationStatus;
  position: Vec3mm;
  orientation: Orientation;
  geometry: EquipmentGeometry;
  ports: Port[];
  technicalData: TechnicalData;
  locationId: string | null;
  fabricaIds: string[];
  subareaId: string | null;
  parentId: string | null;
  localPosition: Vec3mm | null;
  source: DataSource;
  notes: string | null;
}

// ─── Conexiones ────────────────────────────────────────────────────────────

interface CableData {
  crossSectionMm2: number | null;
  cableType: string | null;
  conductors: number | null;
  voltageRating: number | null;
  routeId: string | null;
}

interface HoseData {
  outerDiameterMM: number | null;
  innerDiameterMM: number | null;
  material: string | null;
  workingPressureBar: number | null;
  minimumBendRadiusMM: number | null;
  routeId: string | null;
}

interface Connection {
  id: string;
  connectionType: ConnectionType;
  sourceId: string;
  sourcePortId: string;
  targetId: string;
  targetPortId: string;
  cableData: CableData | null;
  hoseData: HoseData | null;
  status: ConnectionStatus;
  notes: string | null;
}

// ─── Organización ──────────────────────────────────────────────────────────

interface Factory {
  id: string;
  name: string;
  codes: string[];
  subareaIds: string[];
}

interface Subarea {
  id: string;
  name: string;
  code: string;
  factoryId: string;
}

interface EquipmentFactoryAssociation {
  id: string;
  equipmentId: string;
  factoryId: string;
  subareaId: string | null;
  role: 'located' | 'serves';
}

// ─── Infraestructura (sin cambios respecto de v1) ─────────────────────────

interface InfrastructureObject {
  id: string;
  name: string;
  type: 'floor' | 'building';
  position: Vec3mm;
  dimensions: { width: number; depth: number; height: number };
}

// ─── Proyecto completo (schemaVersion: 2) ─────────────────────────────────

interface ProjectDataV2 {
  schemaVersion: 2;
  equipment: EquipmentBase[];
  infrastructure: InfrastructureObject[];
  connections: Connection[];
  factories: Factory[];
  subareas: Subarea[];
  associations: EquipmentFactoryAssociation[];
  projectOrigin: Vec3mm;
}
```

---

## 4. Ejemplo completo (ficticio)

> Los TAGs, posiciones y datos técnicos son **ficticios** con fines
> ilustrativos únicamente.

Cadena: **tablero eléctrico → tablero neumático → electroválvula → actuador**
con un cable de mando y dos mangueras (doble efecto).

```json
{
  "schemaVersion": 2,
  "projectOrigin": { "x": 0, "y": 0, "z": 0 },

  "factories": [
    {
      "id": "fab-eva",
      "name": "Evaporador A",
      "codes": ["EVA", "EA"],
      "subareaIds": []
    }
  ],
  "subareas": [],

  "equipment": [

    {
      "id": "equip-tab-e1",
      "tag": "TAB-E1",
      "name": "Tablero Eléctrico Ev. A (FICTICIO)",
      "category": "electrical_panel",
      "condition": "existing",
      "confirmationStatus": "pending",
      "position": { "x": -6000, "y": 2000, "z": 1200 },
      "orientation": { "yawDeg": 0 },
      "geometry": {
        "shape": "box",
        "width": 800,
        "depth": 400,
        "height": 2400,
        "anchorPoint": "center_bottom"
      },
      "ports": [
        {
          "id": "port-tab-e1-out1",
          "portType": "electrical",
          "localPosition": { "x": 0, "y": -200, "z": -800 },
          "label": "Salida 1"
        }
      ],
      "technicalData": {
        "category": "electrical_panel",
        "mountingType": "floor",
        "ipRating": "IP54",
        "voltageRating": 380,
        "childIds": []
      },
      "locationId": "fab-eva",
      "fabricaIds": ["fab-eva"],
      "subareaId": null,
      "parentId": null,
      "localPosition": null,
      "source": { "origin": "estimated", "reference": null, "dateISO": null },
      "notes": "Ejemplo ficticio para ilustrar el modelo"
    },

    {
      "id": "equip-tab-n1",
      "tag": "TAB-N1",
      "name": "Tablero Neumático Ev. A (FICTICIO)",
      "category": "pneumatic_panel",
      "condition": "existing",
      "confirmationStatus": "pending",
      "position": { "x": -4000, "y": 2000, "z": 900 },
      "orientation": { "yawDeg": 0 },
      "geometry": {
        "shape": "box",
        "width": 600,
        "depth": 300,
        "height": 1800,
        "anchorPoint": "center_bottom"
      },
      "ports": [
        {
          "id": "port-tab-n1-elec-in",
          "portType": "electrical",
          "localPosition": { "x": 0, "y": -150, "z": -600 },
          "label": "Entrada eléctrica"
        },
        {
          "id": "port-tab-n1-air-in",
          "portType": "pneumatic_supply",
          "localPosition": { "x": -100, "y": -150, "z": -700 },
          "label": "Entrada aire"
        }
      ],
      "technicalData": {
        "category": "pneumatic_panel",
        "mountingType": "floor",
        "ipRating": "IP54",
        "supplyPressureBar": 6,
        "childIds": ["equip-ev1"]
      },
      "locationId": "fab-eva",
      "fabricaIds": ["fab-eva"],
      "subareaId": null,
      "parentId": null,
      "localPosition": null,
      "source": { "origin": "estimated", "reference": null, "dateISO": null },
      "notes": null
    },

    {
      "id": "equip-ev1",
      "tag": "EV-N1-01",
      "name": "Electroválvula 5/2 (FICTICIO)",
      "category": "solenoid_valve",
      "condition": "existing",
      "confirmationStatus": "pending",
      "position": { "x": -4000, "y": 2000, "z": 1500 },
      "orientation": { "yawDeg": 0 },
      "geometry": {
        "shape": "box",
        "width": 150,
        "depth": 60,
        "height": 100,
        "anchorPoint": "center_bottom"
      },
      "ports": [
        {
          "id": "port-ev1-coil",
          "portType": "electrical",
          "localPosition": { "x": 0, "y": 30, "z": 50 },
          "label": "Bobina"
        },
        {
          "id": "port-ev1-p",
          "portType": "pneumatic_supply",
          "localPosition": { "x": 0, "y": -30, "z": -20 },
          "label": "P (suministro)"
        },
        {
          "id": "port-ev1-a",
          "portType": "pneumatic_work",
          "localPosition": { "x": -40, "y": -30, "z": -20 },
          "label": "A (trabajo)"
        },
        {
          "id": "port-ev1-b",
          "portType": "pneumatic_work",
          "localPosition": { "x": 40, "y": -30, "z": -20 },
          "label": "B (trabajo)"
        }
      ],
      "technicalData": {
        "category": "solenoid_valve",
        "configuration": "5/2",
        "coilVoltage": 24,
        "coilVoltageType": "DC",
        "workingPressureBar": 6,
        "portSize": "G1/4",
        "manifoldId": null
      },
      "locationId": "fab-eva",
      "fabricaIds": ["fab-eva"],
      "subareaId": null,
      "parentId": "equip-tab-n1",
      "localPosition": { "x": 0, "y": 0, "z": 300 },
      "source": { "origin": "estimated", "reference": null, "dateISO": null },
      "notes": null
    },

    {
      "id": "equip-act1",
      "tag": "ACT-01",
      "name": "Actuador neumático doble efecto (FICTICIO)",
      "category": "actuator",
      "condition": "existing",
      "confirmationStatus": "pending",
      "position": { "x": -1000, "y": 3000, "z": 400 },
      "orientation": { "yawDeg": 90 },
      "geometry": {
        "shape": "cylinder",
        "diameter": 200,
        "height": 500,
        "anchorPoint": "center_bottom"
      },
      "ports": [
        {
          "id": "port-act1-a",
          "portType": "pneumatic_work",
          "localPosition": { "x": 0, "y": 100, "z": 300 },
          "label": "Puerto A"
        },
        {
          "id": "port-act1-b",
          "portType": "pneumatic_work",
          "localPosition": { "x": 0, "y": 100, "z": 100 },
          "label": "Puerto B"
        }
      ],
      "technicalData": {
        "category": "actuator",
        "actuatorType": "pneumatic_linear",
        "effect": "double",
        "boreOrTorque": 80,
        "strokeMM": 200,
        "supplyPressureBar": 6
      },
      "locationId": "fab-eva",
      "fabricaIds": ["fab-eva"],
      "subareaId": null,
      "parentId": null,
      "localPosition": null,
      "source": { "origin": "estimated", "reference": null, "dateISO": null },
      "notes": null
    }

  ],

  "infrastructure": [
    {
      "id": "floor-1",
      "name": "Piso",
      "type": "floor",
      "position": { "x": 0, "y": 0, "z": 0 },
      "dimensions": { "width": 30000, "depth": 30000, "height": 0 }
    }
  ],

  "connections": [
    {
      "id": "conn-cable-1",
      "connectionType": "cable",
      "sourceId": "equip-tab-e1",
      "sourcePortId": "port-tab-e1-out1",
      "targetId": "equip-ev1",
      "targetPortId": "port-ev1-coil",
      "cableData": {
        "crossSectionMm2": null,
        "cableType": null,
        "conductors": null,
        "voltageRating": 24,
        "routeId": null
      },
      "hoseData": null,
      "status": "assigned",
      "notes": "Cable de mando 24VDC bobina EV (FICTICIO)"
    },
    {
      "id": "conn-hose-a",
      "connectionType": "hose",
      "sourceId": "equip-ev1",
      "sourcePortId": "port-ev1-a",
      "targetId": "equip-act1",
      "targetPortId": "port-act1-a",
      "cableData": null,
      "hoseData": {
        "outerDiameterMM": 8,
        "innerDiameterMM": 6,
        "material": null,
        "workingPressureBar": 6,
        "minimumBendRadiusMM": null,
        "routeId": null
      },
      "status": "assigned",
      "notes": "Manguera trabajo A (FICTICIO)"
    },
    {
      "id": "conn-hose-b",
      "connectionType": "hose",
      "sourceId": "equip-ev1",
      "sourcePortId": "port-ev1-b",
      "targetId": "equip-act1",
      "targetPortId": "port-act1-b",
      "cableData": null,
      "hoseData": {
        "outerDiameterMM": 8,
        "innerDiameterMM": 6,
        "material": null,
        "workingPressureBar": 6,
        "minimumBendRadiusMM": null,
        "routeId": null
      },
      "status": "assigned",
      "notes": "Manguera trabajo B (FICTICIO)"
    }
  ],

  "associations": [
    {
      "id": "assoc-1",
      "equipmentId": "equip-tab-e1",
      "factoryId": "fab-eva",
      "subareaId": null,
      "role": "located"
    },
    {
      "id": "assoc-2",
      "equipmentId": "equip-tab-e1",
      "factoryId": "fab-eva",
      "subareaId": null,
      "role": "serves"
    }
  ]
}
```

---

## 5. Ficha técnica por categoría

La ficha técnica es el formulario de entrada de datos para cada equipo.
Tiene una sección común y una sección específica por categoría.

### Sección común (todas las categorías)

```
TAG:              [____________]  (obligatorio, único)
Nombre:           [____________]  (obligatorio)
Condición:        ( ) Existente  ( ) Nuevo
Confirmación:     ( ) Pendiente  ( ) Confirmado  ( ) Revisión
Fábrica:          [____________]  (selección múltiple)
Subárea:          [____________]  (opcional)
Ubicación física: [____________]  (selección única)
Notas:            [____________]  (libre)
Procedencia:      Manual / Excel / DWG / Estimado
```

### Sección Motor

```
Potencia:   [____] [HP / kW]
Tensión:    [____] V
Fases:      ( ) 1  ( ) 3
Corriente:  [____] A
Arranque:   ( ) Directo  ( ) Estrella-triángulo
            ( ) Arrancador suave  ( ) VFD
```

### Sección Sensor

```
Magnitud:    [____________]
Rango:       [____] a [____] [____] (unidad)
Alimentación:[____] V
Señal:       ( ) 4-20mA  ( ) 0-10V  ( ) Discreta NPN
             ( ) Discreta PNP  ( ) HART  ( ) Modbus  [otro: ____]
```

### Sección Válvula de proceso

```
Función:     ( ) On/Off  ( ) Control  ( ) Retención  ( ) Seguridad
Conexión:    ( ) Bridada  ( ) Roscada  ( ) Soldada
Tamaño:      [____]  (DN50, 2", etc.)
Fluido:      [____________]
Presión:     [____] bar
Temperatura: [____] °C
```

### Sección Electroválvula

```
Configuración: ( ) 2/2  ( ) 3/2  ( ) 4/2  ( ) 5/2  ( ) 5/3
Bobina:        [____] V  ( ) AC  ( ) DC
Presión:       [____] bar
Puertos:       [____]  (G1/4, G1/8, etc.)
Manifold:      [____________]  (ID del manifold, si aplica)
```

### Sección Actuador

```
Tipo:        ( ) Neumático lineal  ( ) Neumático rotativo
             ( ) Hidráulico  ( ) Eléctrico
Efecto:      ( ) Simple  ( ) Doble
Émbolo/Par:  [____]  (mm o N·m según tipo)
Carrera:     [____] mm  (solo lineal)
Presión:     [____] bar
```

### Sección Tablero eléctrico

```
Montaje:   ( ) Piso  ( ) Pared
IP:        [____]
Tensión:   [____] V
```

### Sección Tablero neumático

```
Montaje:        ( ) Piso  ( ) Pared
IP:             [____]
Presión aire:   [____] bar
```

---

## 6. Reglas de operaciones sobre equipos

### Agregar equipo

1. Generar un ID estable único (UUID v4).
2. El TAG debe ser único dentro del proyecto. Si ya existe, mostrar error
   y no crear el equipo.
3. `confirmationStatus` inicia en `'pending'`.
4. `condition` debe ser seleccionada explícitamente (sin valor por defecto).
5. `fabricaIds` y `associations` inician vacíos; el usuario los completa.
6. No se inician conexiones automáticamente.

### Duplicar equipo

1. Generar nuevo ID.
2. Sugerir un TAG con sufijo incrementado (p. ej. `M-SEC-01` → `M-SEC-02`).
   El usuario debe confirmar o modificar el TAG antes de guardar.
3. Copiar todos los campos de `EquipmentBase` y `technicalData`.
4. **No copiar conexiones**: el duplicado no hereda cables ni mangueras.
5. **No copiar `childIds`**: el duplicado no tiene componentes internos.
6. `localPosition` y `parentId` se ponen a `null`; el usuario los asigna.
7. `confirmationStatus` se reinicia a `'pending'`.

### Eliminar equipo

1. Verificar si el equipo tiene **conexiones asociadas** (como origen o
   destino). Si las tiene, advertir y pedir confirmación.
2. Verificar si el equipo es **padre de otros componentes** (`childIds`
   no vacío). Si es así, advertir: los hijos quedarán sin padre.
3. Si el usuario confirma: eliminar el equipo y sus conexiones asociadas.
   Los equipos hijos pasan a `parentId: null`.
4. Nunca eliminar en silencio conexiones o componentes sin advertencia.

### Mover equipo (padre)

- Los componentes hijos se mueven con el padre (sus `localPosition` no
  cambian; el `globalPosition` resultante se recalcula).
- Los **cables y mangueras** conectados no se recalculan automáticamente;
  sus trayectorias se marcan como "pendiente de revisión de recorrido".

### Redimensionar equipo

- Verificar si algún componente hijo supera los límites del nuevo tamaño.
  Si sí, generar advertencia (no bloquear).
- Los puertos se reposicionan proporcionalmente salvo que tengan posición
  manual fijada.
- No escalar automáticamente los componentes interiores.

---

## 7. Plan de migración schemaVersion 1 → 2

### Mapeado de tipos

| v1 `type` | v2 `category` | Destino en v2 |
|---|---|---|
| `panel` | `electrical_panel` | `equipment[]` |
| `motor` | `motor` | `equipment[]` |
| `floor` | — | `infrastructure[]` |
| `building` | — | `infrastructure[]` |

### Función de migración `migrateV1toV2(data: ProjectDataV1): ProjectDataV2`

```typescript
// Pseudocódigo — no implementado aún
function migrateV1toV2(v1: ProjectDataV1): ProjectDataV2 {
  const equipment = v1.objects
    .filter(o => o.type === 'panel' || o.type === 'motor')
    .map(o => ({
      id: o.id,
      tag: generateDefaultTag(o),    // "PANEL-1", "MOTOR-1", etc.
      name: o.name,
      category: o.type === 'panel' ? 'electrical_panel' : 'motor',
      condition: 'existing',         // conservador: asumir existente
      confirmationStatus: 'pending',
      position: o.position,
      orientation: { yawDeg: 0 },
      geometry: {
        shape: 'box',
        width: o.dimensions.width,
        depth: o.dimensions.depth,
        height: o.dimensions.height,
        anchorPoint: 'center_bottom',
      },
      ports: [],
      technicalData: defaultTechnicalData(category),
      locationId: null,
      fabricaIds: [],
      subareaId: null,
      parentId: null,
      localPosition: null,
      source: {
        origin: 'manual',
        reference: 'migrated from schemaVersion 1',
        dateISO: new Date().toISOString(),
      },
      notes: null,
    }));

  const infrastructure = v1.objects
    .filter(o => o.type === 'floor' || o.type === 'building')
    .map(o => ({
      id: o.id,
      name: o.name,
      type: o.type,
      position: o.position,
      dimensions: o.dimensions,
    }));

  return {
    schemaVersion: 2,
    equipment,
    infrastructure,
    connections: [],
    factories: [],
    subareas: [],
    associations: [],
    projectOrigin: v1.projectOrigin,
  };
}
```

### Reglas de migración

1. **Sin pérdida de datos:** todos los campos de v1 se conservan en v2.
2. **Valores nuevos son conservadores:** `condition: 'existing'`,
   `confirmationStatus: 'pending'`, arrays vacíos.
3. **TAGs generados automáticamente** son marcados como `source.origin:
   'manual'` y `confirmationStatus: 'pending'` para que el usuario los
   revise. No se genera un TAG "real" sin intervención del usuario.
4. **Migración explícita:** se ejecuta solo cuando el usuario abre un
   proyecto v1 con la versión nueva del software. Se muestra un aviso:
   _"Este proyecto fue creado con una versión anterior. Se actualizó al
   formato v2. Revisá los TAGs y datos técnicos."_
5. **Reversibilidad:** no se elimina el archivo v1. El usuario puede
   exportar antes de migrar para conservar una copia.
6. El validador debe aceptar `schemaVersion: 1` y `schemaVersion: 2`
   durante el período de transición.

---

## 8. Plan de implementación en fases

### Fase B.1 — Tipos TypeScript extendidos (sin UI ni migración)
**Objetivo:** definir los nuevos tipos en `src/types/domain.ts` sin romper
el código existente.

- Agregar `EquipmentCategory`, `EquipmentBase`, `TechnicalData` y tipos
  auxiliares como nuevas exportaciones.
- Mantener `ObjectType` y `DomainObject` como alias de compatibilidad
  (`DomainObject = EquipmentBase | InfrastructureObject`).
- Actualizar `src/store/sceneStore.ts` para usar los nuevos tipos.
- Actualizar `src/persistence/validate.ts` con validación de v2.
- **Sin cambios en UI ni en el formato persistido.**
- Pruebas: nuevos tests unitarios del validador v2.

### Fase B.2 — TAG y campos base en Inspector
**Objetivo:** mostrar y editar TAG, condición y confirmación en el
Inspector para equipos existentes.

- Nuevos campos en el Inspector: TAG, condición, estado de confirmación.
- Validación: TAG único en el proyecto.
- Sin cambios en el formato persistido todavía (almacenamiento en memoria).
- Pruebas de interacción jsdom.

### Fase B.3 — Datos técnicos por categoría (Motor y Sensor)
**Objetivo:** formulario de ficha técnica para Motor y Sensor.

- Nueva sección "Ficha técnica" en el Inspector.
- Validación de campos `null` vs. `0`.
- Persistencia en `technicalData` del equipo.
- Pruebas unitarias del validador y de interacción UI.

### Fase B.4 — Composición padre/hijo
**Objetivo:** representar tableros con componentes internos.

- Selector de padre en el Inspector.
- Visualización de jerarquía en el árbol (sangría o subárbol).
- Cálculo de `globalPosition` desde `localPosition` + padre.
- Validación: sin ciclos.
- Mover padre arrastra hijos.
- Advertencia si hijo sale de los límites del padre al redimensionar.

### Fase B.5 — Puertos y conexiones básicas (cables)
**Objetivo:** modelar cables entre tableros eléctricos y electroválvulas.

- Vista de puertos en el Inspector (solo lectura inicialmente).
- Crear y editar conexiones de tipo `cable`.
- Separación asignación / dimensionamiento.
- Visualización simplificada en el visor (línea entre puertos).

### Fase B.6 — Mangueras y actuadores
**Objetivo:** extender conexiones a mangueras neumáticas.

- Crear y editar conexiones de tipo `hose` y `air_supply`.
- Soporte de múltiples mangueras por actuador.
- Validación de compatibilidad de puertos (eléctrico vs neumático).

### Fase B.7 — Migración schemaVersion 1 → 2
**Objetivo:** migrar proyectos existentes al nuevo formato.

- Función `migrateV1toV2` en `src/persistence/migrate.ts`.
- `initProject` detecta v1 y ejecuta migración con aviso al usuario.
- Validador acepta ambas versiones.
- Pruebas de migración con proyectos reales e inventados.

### Fase B.8 — Fábricas y organización
**Objetivo:** gestionar fábricas, subáreas y asociaciones.

- UI para definir fábricas y subáreas.
- Asignación de equipos a fábricas en el Inspector.
- Filtro del árbol por fábrica.
- Soporte de TAB-B y otros equipos con múltiples asociaciones.

---

## 9. Decisiones de diseño pendientes

| Tema | Pregunta abierta | Impacto |
|---|---|---|
| Generación de TAGs | ¿Regla automática o siempre manual? | Fase B.1 |
| Manifold | ¿Es una entidad propia o un atributo de electroválvula? | Fase B.4 |
| Borneras | ¿Se modelan como equipos o como segmentos de cable? | Fase B.5 |
| Recorridos | ¿Cuándo se introduce la entidad `Route`? | Fase B.5–B.6 |
| Esquema en archivo | ¿v1 y v2 conviven o se migra automáticamente? | Fase B.7 |
| Validación de espacio | ¿Advertencia o bloqueo? (propuesta: advertencia) | Fase B.4 |
