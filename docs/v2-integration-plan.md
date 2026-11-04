# Plan de integración v2 — Diseñador de Bandejas Portacables 3D

> **Estado:** borrador activo — solo documentación, sin código de producción modificado  
> **Revisión:** 2026-11-04 (correcciones post-auditoría de 0c2bfa9)  
> **Rama:** `docs/v2-integration-plan` desde `4e43abc` (M1b auditado)  
> **Prerequisito:** M1a ✅ `80e8e9c` · M1b ✅ `4e43abc`

---

## 1. Contexto y objetivos

El dominio v2 (`ProjectDataV2`) está completamente definido y validado (M1a).
La API de respaldo transaccional está implementada y auditada (M1b).
Ninguna de estas piezas está activa en producción: la aplicación continúa
leyendo y escribiendo `schemaVersion=1`.

Este documento planifica **la activación coordinada de v2** y las adaptaciones
necesarias en capas de UI, store y persistencia.

**Objetivos de la integración:**
- v2 pasa a ser la única fuente de verdad en store, IndexedDB y exportación.
- Los componentes existentes (visor, inspector, árbol) siguen funcionando sin
  pérdida de campos v2 durante la edición.
- La activación es reversible mediante el flujo de recuperación (§9.3).
- Una pestaña antigua con v1 cargado no puede sobrescribir un proyecto migrado.

**Entregas de integración:** se denominan I1–I_act para distinguirlas de las
fases de producto M2–M7 (ver §13). No reutilizan esos números.

**Fuera del alcance de este plan:** M2–M7 según `implementation-plan.md`:
fábricas, fichas técnicas, geometría editable, puertos y conexiones, XLSX,
ruteo, BOM, DXF y PWA. Estos requisitos no se eliminan.

---

## 2. Estado actual (referencia rápida)

### Store (`src/store/sceneStore.ts` + `src/persistence/projectManager.ts`)

```typescript
interface SceneState {
  objects: DomainObject[];        // v1: posición, dimensiones, tipo
  selectedId: string | null;
  projectOrigin: Vec3mm;
  saveStatus: SaveStatus;         // 'idle'|'loading'|'saving'|'saved'|'recovering'|'error'
  saveError: string | null;
}
hydrateProject(objects, projectOrigin)   // reemplaza todo, limpia selección
updateObjectPosition(id, position)       // parche de posición
_cancelAutoSave()                        // cancela debounce (no persiste en vuelo)
```

Auto-save: debounce 1 s, `saveGeneration` evita writes obsoletos.
`projectManager` NO expone actualmente la promesa de escritura en curso.

### Persistencia (`src/persistence/db.ts`)

| Store IDB | Uso actual |
|---|---|
| `project` (key `current`) | Proyecto v1 activo |
| `migration-backups` | Respaldos M1b + entradas displaced |
| `project-v2` (key `current`) | v2 preparado — inactivo |

`DB_VERSION = 2`. No existe store `config`.

### Schema v2 — campos relevantes para rendering

```typescript
interface EquipmentElement {
  id: Id; name: string; version: number;
  placementStatus: 'placed' | 'unplaced';
  transform: { positionMm: Vec3; rotation: Quaternion } | null;
  // Invariante: si placementStatus='placed', transform != null
  // Invariante: si placementStatus='unplaced', transform debe ser null
  geometry: Geometry | null;
  // Geometry = { kind: 'box', widthMm, depthMm, heightMm }
  //           | { kind: 'cylinder', diameterMm, lengthMm }
  //           | { kind: 'plane', widthMm, depthMm }
  //           | { kind: 'asset', assetId, boundsMm: Vec3 }
  category: Category; // 13 categorías
  parentId: Id | null;
  // ... todos los campos técnicos (Datum<T>)
}
```

---

## 3. Arquitectura del sistema con v2 activo

```
┌────────────────────────────────────────────────────┐
│  projectManager v2                                  │
│  subscribe(elements, origin, …)                     │
│  debounce 1s → saveProjectV2ToDb() con generation   │
│  check en la misma transacción IDB                  │
└───────────────────────┬────────────────────────────┘
                        │
             ┌──────────▼──────────┐
             │  Zustand Store       │
             │  elements: Element[] │  ← fuente de verdad
             │  projectOrigin: Vec3 │
             │  selectedId: string? │
             │  migrationIncidents  │
             └────┬────────────────┘
         ┌────────┴───────────┐
         │                    │
  ┌──────▼──────┐    ┌────────▼────────┐
  │  Visor 3D   │    │  Inspector / UI  │
  │  v2→render  │    │  acciones        │
  │  props      │    │  granulares      │
  └──────┬──────┘    └────────┬────────┘
         │                    │
         └──────────┬─────────┘
                    │
         ┌──────────▼──────────┐
         │  IndexedDB v3        │
         │  project-v2/current  │  ← ProjectDataV2 serializado
         │  config/active-format│  ← metadatos de activación
         │  migration-backups   │  ← respaldos M1b
         └─────────────────────┘
```

---

## 4. Cambios por capa

### 4.1 Persistencia

#### DB_VERSION = 3 — versión estructural, no activación

Subir a versión 3 es un cambio de **esquema de IndexedDB** que crea el store
`config`. Esta operación no activa v2 ni escribe `schemaVersion=2`. Abrir la
BD con versión 3 en una sesión pre-migración es transparente para el usuario.

```
onupgradeneeded:
  oldVersion < 1 → createObjectStore('project')
  oldVersion < 2 → createObjectStore('migration-backups')
                    createObjectStore('project-v2')
  oldVersion < 3 → createObjectStore('config')
```

#### Funciones nuevas en `db.ts` (I1)

```typescript
// Proyecto v2 activo
export async function loadProjectV2FromDb(): Promise<ProjectDataV2 | null>
export async function saveProjectV2ToDb(
  data: ProjectDataV2,
  expectedGeneration: number,  // para comprobación transaccional
): Promise<void>

// Metadatos de formato activo (escritos solo por activateMigrationWithBackup)
export interface ActiveFormatMetadata {
  format: 'v2';
  backupId: string;
  activatedAt: string;
  generation: number;  // incrementa con cada escritura post-activación
}
export async function readActiveFormatMetadata(): Promise<ActiveFormatMetadata | null>
```

La bandera de activación NO se escribe por una función separada.
Se escribe exclusivamente dentro de la transacción de activación (ver §8).

#### `pauseAndFlush` — operación requerida en `projectManager.ts` (I1)

`_cancelAutoSave()` cancela el debounce pero no persiste la última edición
en memoria. Para la activación necesitamos una operación que:

1. Bloquea nuevas ediciones en la UI (`setEditBlocked(true)`).
2. Cancela el timer del debounce sin descartar el estado en memoria.
3. Persiste explícitamente el estado actual del store a IndexedDB.
4. Espera `oncomplete` (confirmación real, no solo el callback de la promesa).
5. Retorna el snapshot confirmado (el mismo que quedó en `project`).

```typescript
// En projectManager.ts
export async function pauseAndFlush(): Promise<ProjectData> {
  // 1. Bloquear nuevas ediciones
  store.setEditBlocked(true)
  
  // 2. Cancelar solo el timer del debounce (no descarta memoria)
  cancelDebounceTimer()
  
  // 3. Capturar estado actual desde el store
  const snapshot = buildProjectDataFromStore(store.getState())
  
  // 4. Persistir y esperar oncomplete
  await saveProjectToDb(snapshot)   // resuelve solo en oncomplete
  
  // 5. Retornar el snapshot confirmado
  return snapshot
  // NOTA: si falla, relanzar el error; el llamador decide si desbloquear
}
```

**Si `pauseAndFlush` falla:** el llamador no debe migrar datos potencialmente
obsoletos. Debe desbloquear la edición, reportar el error y mantener el
auto-save v1 activo. El usuario puede exportar el proyecto desde memoria
(la exportación siempre lee el store, no IDB).

#### `saveProjectV2ToDb` con comprobación de generación (I1 + I_act)

Cada escritura del auto-save v2 verifica que el formato activo siga siendo v2
y que la generación sea la esperada, dentro de la misma transacción IDB:

```typescript
// Dentro de la transacción readwrite([V2_STORE, 'config']):
// 1. Leer config/active-format
// 2. Si format !== 'v2' o generation !== expected → abortar (tx.abort())
// 3. Escribir nuevo ProjectDataV2 con generation + 1
// Resuelve solo en oncomplete
```

Esto asegura que si una pestaña antigua revirtiera el formato (escenario
hipotético), la escritura del auto-save v2 fallará de forma detectada,
no silenciosa.

### 4.2 Store (Zustand)

#### Estado v2

```typescript
interface SceneStateV2 {
  // --- núcleo v2 ---
  elements: EquipmentElement[];
  projectOrigin: Vec3;
  factories: Factory[];
  subareas: Subarea[];
  ports: Port[];
  connections: Connection[];
  cableCores: CableCore[];
  internalLinks: InternalLink[];
  functionalRelations: FunctionalRelation[];
  evidence: FieldEvidence[];
  migrationIncidents: MigrationIncident[];  // preservados entre sesiones

  // --- UI ---
  selectedId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  editBlocked: boolean;
}
```

#### Acciones granulares (ninguna reconstruye el elemento completo)

```typescript
// Hidratación completa (activación, apertura, importación)
// → reemplaza todos los arreglos, limpia selectedId, limpia editBlocked
hydrateProjectV2(data: ProjectDataV2): void

// Posición — solo toca transform y bumps version
// Invariante: siempre establece placementStatus='placed'
updateElementPosition(id: string, positionMm: Vec3): void

// Geometría — solo toca geometry y bumps version
updateElementGeometry(id: string, geometry: Geometry): void

// Origen — no mueve elementos
setProjectOriginV2(origin: Vec3): void

// Bloqueo de edición (activación, carga)
setEditBlocked(blocked: boolean): void
```

#### Invariantes de las acciones

`updateElementPosition` siempre establece `placementStatus = 'placed'` y
`transform != null`:

```typescript
updateElementPosition(id, positionMm) {
  set(state => ({
    elements: state.elements.map(el =>
      el.id !== id ? el : {
        ...el,
        version: el.version + 1,
        placementStatus: 'placed',           // siempre placed al asignar posición
        transform: {
          positionMm,
          rotation: el.transform?.rotation ?? IDENTITY_QUATERNION,
        },
      }
    ),
  }))
}
```

No puede existir un elemento con `placementStatus='placed'` y `transform=null`,
ni con `placementStatus='unplaced'` y `transform!=null`.

#### Selección

`hydrateProjectV2()` limpia `selectedId` (comportamiento consistente con
`hydrateProject` v1 existente). Las acciones granulares no tocan `selectedId`.
Al abrir una sesión posterior, la selección comienza en `null` (no se persiste
en IDB).

#### Acciones v1 durante la transición

Las acciones v1 (`hydrateProject`, `updateObjectPosition`, `setProjectOrigin`)
se mantienen hasta I_act, cuando se eliminan como breaking change.

### 4.3 Visor 3D

#### Transformación global — resolución de jerarquía

El elemento puede tener `parentId != null`. Su `transform` es **local** relativo
al padre. La posición en el visor requiere la transformación **global**:

```typescript
interface GlobalTransform {
  positionMm: Vec3;
  rotation: Quaternion;
}

function resolveGlobalTransform(
  id: Id,
  elements: EquipmentElement[],
  cache: Map<Id, GlobalTransform | null> = new Map(),
): GlobalTransform | null {
  if (cache.has(id)) return cache.get(id)!

  const el = elements.find(e => e.id === id)
  if (!el || el.placementStatus === 'unplaced' || !el.transform) {
    cache.set(id, null)
    return null
  }

  if (el.parentId === null) {
    const gt = { positionMm: el.transform.positionMm, rotation: el.transform.rotation }
    cache.set(id, gt)
    return gt
  }

  const parentGt = resolveGlobalTransform(el.parentId, elements, cache)
  if (parentGt === null) {
    cache.set(id, null)
    return null  // padre sin ubicar → hijo sin ubicar
  }

  const globalPos = addVec3(
    parentGt.positionMm,
    rotateVec3(el.transform.positionMm, parentGt.rotation),
  )
  const globalRot = multiplyQuaternions(parentGt.rotation, el.transform.rotation)
  const gt = { positionMm: globalPos, rotation: globalRot }
  cache.set(id, gt)
  return gt
}
```

Para los proyectos migrados de v1, todos los elementos tienen `parentId=null`
y `rotation=IDENTITY_QUATERNION`, por lo que `resolveGlobalTransform` retorna
el `transform.positionMm` directamente. La función soporta casos futuros
(M4 — composición padre/hijo) sin cambios de interfaz.

#### Adaptador `elementToRenderProps` (`src/scene/v2-adapter.ts`)

```typescript
interface ElementRenderProps {
  id: string;
  name: string;
  category: Category;
  placed: boolean;
  positionViewer: [number, number, number] | null;  // null si unplaced
  rotationViewer: [number, number, number, number] | null;  // quaternion XYZW, null si unplaced
  sizeViewer: [number, number, number] | null;
  geometryKind: Geometry['kind'] | 'unknown';  // 'unknown' si geometry=null
  isFloor: boolean;
}

function elementToRenderProps(
  el: EquipmentElement,
  elements: EquipmentElement[],
): ElementRenderProps
```

El campo `geometryKind: 'unknown'` identifica explícitamente los elementos
sin geometría conocida; el renderizador usa este valor para mostrar un
marcador etiquetado como "geometría no disponible" (no una esfera genérica
sin identificar).

#### Coordenadas: base de dominio → visor

La función `domainToViewerPosition` existente no cambia:
```
domainToViewerPosition({ x, y, z }) → [x/1000, z/1000, -(y/1000)]
  domain X (derecha)   → viewer X (derecha)
  domain Z (arriba)    → viewer Y (arriba)
  domain Y (profundidad) → viewer −Z (hacia el fondo)
```

La rotación del visor toma el quaternion global del elemento y aplica la
misma conversión de base:
```
// El quaternion del dominio (Z-arriba) debe convertirse a base Y-arriba.
// rotación around Z-domain → alrededor de Y-viewer
// Esta conversión se implementa en la entrega I2.
```

#### Geometrías v2 → viewer (correcciones)

| geometry.kind | Renderizado Three.js | sizeViewer `[W, H, D]` |
|---|---|---|
| `box` | `<boxGeometry>` | `[widthMm/1000, heightMm/1000, depthMm/1000]` |
| `cylinder` | `<cylinderGeometry>` | `[diameterMm/1000, lengthMm/1000, diameterMm/1000]` |
| `plane` | `<planeGeometry>` / grid | `[widthMm/1000, 0, depthMm/1000]` |
| `asset` | `<boxGeometry>` con boundsMm | `[x/1000, z/1000, y/1000]` ¹ |
| `null` (kind='unknown') | marcador etiquetado | `[0.5, 0.5, 0.5]` |

¹ `asset.boundsMm = { x: ancho, y: profundidad, z: altura }` en dominio.
En visor: `W = x/1000`, `H = z/1000` (domain Z → viewer Y), `D = y/1000`.
La conversión es `[x/1000, z/1000, y/1000]`, **no** `[x/1000, y/1000, z/1000]`.

Elementos con `placementStatus='unplaced'` no se renderizan en la escena.

### 4.4 Inspector

#### Coordenadas relativas y globales

El inspector **muestra** la posición relativa al origen del proyecto, pero
**envía** al store la posición global (en mm desde el origen del sistema).
La distinción debe ser explícita en el código:

```
// Valor mostrado al usuario (editable en los inputs)
displayPos = globalTransform.positionMm - projectOrigin

// Valor enviado al store al aplicar
globalPos = displayPos + projectOrigin
store.updateElementPosition(selectedId, globalPos)
```

La acción `updateElementPosition` recibe siempre coordenadas globales.

#### Snap to floor — corrección por tipo de geometría

| geometry.kind | Dimensión de altura | Fórmula snap Z (global) |
|---|---|---|
| `box` | `heightMm` | `projectOrigin.z + geometry.heightMm / 2` |
| `cylinder` | `lengthMm` | `projectOrigin.z + geometry.lengthMm / 2` |
| otros o `null` | — | botón deshabilitado |

La fórmula deja la base del objeto en `Z = 0` global. El inspector calcula
`globalPos.z` y envía `updateElementPosition(id, { x, y, z: computed })`.

**Elementos rotados o con padre:** el snap asume que la geometría está
alineada con el eje Z del sistema global. Si el elemento tiene rotación no
identidad o `parentId != null`, el cálculo de apoyo geométrico correcto
requiere descomponer la rotación global, lo que no se implementa en esta
integración. Para esos casos, el botón Snap to floor se deshabilita con el
texto "No disponible para elementos rotados o compuestos."

#### Anti-pérdida de campos

El inspector nunca envía el elemento completo al store. Cada campo editable
llama a su acción granular correspondiente. El spread inmutable en la acción
preserva todos los `Datum<T>` y campos técnicos:

```typescript
// Inspector apply handler:
store.updateElementPosition(selectedId, newGlobalPos)
// no: store.patchElement({ ...partialFromUI })
```

#### Campos técnicos

Los campos `Datum<T>` se muestran en modo lectura. Edición en M3
(fichas técnicas). Los incidents de migración (`migrationIncidents`) son
visibles en el inspector si existen para el elemento.

### 4.5 Árbol de escena

#### Categorías v2 → grupos de display

| Grupo en árbol | Categorías v2 |
|---|---|
| Tableros | `electrical_panel`, `pneumatic_panel` |
| Motores | `motor` |
| Bombas | `pump` |
| Válvulas / electroválvulas | `process_valve`, `solenoid_valve` |
| Sensores | `sensor` |
| Actuadores | `actuator` |
| Iluminación | `luminaire` |
| Botoneras / bloques | `pushbutton`, `terminal_block` ² |
| Manifolds | `manifold` |
| Infraestructura | `infrastructure` |

² La categoría correcta del contrato es `pushbutton` (no `pushbutton_station`).

#### Indicadores de estado

- `lifecycle='retired'` → icono/color de inactivo.
- `placementStatus='unplaced'` → icono de posición pendiente.
- `migrationIncidents` existentes para el elemento → indicador de advertencia.

---

## 5. v2 como fuente de verdad — sin pérdida de campos

### El problema

Un elemento v2 contiene decenas de campos técnicos (`Datum<T>`) que los
adaptadores de posición e inspector no conocen. Si el store aceptara
reemplazos parciales del elemento, esos campos se perderían silenciosamente.

### La solución: acciones granulares con spread inmutable

```typescript
updateElementPosition(id, positionMm) {
  set(state => ({
    elements: state.elements.map(el =>
      el.id !== id ? el : {
        ...el,                               // preserva todos los campos técnicos
        version: el.version + 1,
        placementStatus: 'placed',
        transform: {
          positionMm,
          rotation: el.transform?.rotation ?? IDENTITY_QUATERNION,
        },
      }
    ),
  }))
}
```

### Regla de diseño

> Ninguna acción del store reconstruye un `EquipmentElement` desde datos
> de UI. Las acciones reciben solo el delta y aplican un spread del
> elemento existente.

---

## 6. Elementos sin ubicar y sin dimensiones conocidas

### Sin ubicar (`placementStatus = 'unplaced'`)

- **Visor 3D:** no se renderizan.
- **Árbol:** indicador de posición pendiente.
- **Inspector:** muestra nombre y campos técnicos; sin inputs de posición.
- **`updateElementPosition`:** establece `placementStatus='placed'` automáticamente.

### Sin geometría conocida (`geometry = null`)

Estos elementos no provienen de la migración v1→v2 (todos los objetos v1
tienen dimensiones). Pueden aparecer al crear elementos directamente en v2.

- **Visor 3D:** marcador etiquetado como "geometría no disponible" (no es
  una esfera genérica anónima; `geometryKind = 'unknown'` lo identifica).
- **Inspector:** sección de dimensiones muestra "No disponibles"; snap deshabilitado.
- **Árbol:** se muestra normalmente.

---

## 7. Conservación de geometrías, posiciones, origen y selección

### Posición

La posición se conserva en `transform.positionMm` tal como viene de v1.
Ningún paso de activación la modifica. La convención "posición = centro"
(z = heightMm/2 para objetos sobre el piso) no cambia.

### Geometría

| Tipo v1 | Geometry v2 |
|---|---|
| `floor` | `{ kind:'plane', widthMm, depthMm }` |
| `building`, `panel` | `{ kind:'box', widthMm, depthMm, heightMm }` |
| `motor` | `{ kind:'cylinder', diameterMm:width, lengthMm:height }` |

Los valores están almacenados en el respaldo M1b y no se recalculan.

### Origen

`projectOrigin: Vec3mm` v1 → `projectOrigin: Vec3` v2 (mismo valor y semántica).

### Selección y `migrationIncidents`

`hydrateProjectV2()` limpia `selectedId` (igual que `hydrateProject` v1).
`migrationIncidents` se carga desde `ProjectDataV2` al hidratar y se persiste
en cada escritura del auto-save.

### Rotación

Todos los objetos migrados de v1 tienen `rotation = IDENTITY_QUATERNION`.
El visor aplica la rotación global (§4.3). Las importaciones con rotaciones
no identidad se soportan mediante `resolveGlobalTransform`.

---

## 8. Secuencia de activación coordinada

La activación es un evento único, explícito, y sin camino de retorno
automático (ver §9.3 para recuperación).

### Pre-condiciones

- Los adaptadores de visor, inspector y árbol existen y fueron probados (I2–I4).
- La función `pauseAndFlush` existe en `projectManager` (I1).
- La función `activateMigrationWithBackup` existe en `migration-backup.ts` (I_act).
- El upgrade de BD a versión 3 ya ocurrió (I1).
- No hay otras pestañas con la BD abierta al iniciar la activación.

### Protocolo paso a paso

```
1. VERIFICAR EXCLUSIVIDAD
   await verifyNoOtherTabsHoldDb()
   → Intentar upgrade de BD sin otra pestaña abierta.
   → Si onblocked dispara: ABORTAR activación.
     Mostrar: "Cerrá otras pestañas antes de migrar."
     NO forzar cierre ni eliminar datos.

2. PAUSAR Y CONFIRMAR ESCRITURA EN MEMORIA
   const v1Snapshot = await pauseAndFlush()
   → Bloquea edición, persiste estado actual, espera oncomplete.
   → Si falla: desbloquear, mantener auto-save v1, reportar error.
     El usuario puede exportar el proyecto y reintentar.

3. ACTIVAR MIGRACIÓN — TRANSACCIÓN ATÓMICA
   const { backupId, v2Data } = await activateMigrationWithBackup(v1Snapshot, {
     backupId,
     timestamp,
     recordedAt,
     activatedAt: new Date().toISOString(),
   })
   → Transacción readwrite([project, migration-backups, project-v2, config])
   → Dentro de la transacción:
     a. Re-leer v1 y verificar fingerprint (STALE_V1_DATA si difiere)
     b. Verificar que backupId no exista (BACKUP_EXISTS si existe)
     c. Validar v2 generado (INVALID_V2 si falla)
     d. Escribir respaldo en migration-backups (add)
     e. Escribir v2 en project-v2 (put)
     f. Escribir metadatos de activación en config/active-format:
        { format: 'v2', backupId, activatedAt, generation: 1 }
   → Resuelve solo en oncomplete.
   → Si cualquier paso falla: CERO escrituras. Desbloquear. Auto-save v1 intacto.

4. SEÑALIZAR OTRAS PESTAÑAS
   broadcastChannel.postMessage({ type: 'v2-activated', backupId })
   → Es un aviso, no una garantía de exclusión (ver §10).

5. HIDRATAR STORE CON V2
   store.hydrateProjectV2(v2Data)
   → El store tiene EquipmentElement[]. selectedId = null.

6. ARRANCAR AUTO-SAVE V2
   initProjectManagerV2(store, generation: 1)
   → Subscripción a elements, projectOrigin, etc.
   → Cada escritura usa saveProjectV2ToDb con generation check.

7. DESBLOQUEAR EDICIÓN
   store.setEditBlocked(false)
```

### 8.1 `activateMigrationWithBackup` — extensión de M1b

Esta función extiende `prepareMigrationWithBackup` agregando el store `config`
a la transacción. El backupId incluido en los metadatos vincula la bandera de
activación con el respaldo exacto que contiene los datos migrados.

```typescript
export interface ActivateMigrationOptions {
  backupId: string;
  timestamp: string;
  recordedAt: string;
  activatedAt: string;
}

export interface ActivateMigrationResult {
  backupId: string;
  v2Data: ProjectDataV2;
  incidents: MigrationIncident[];
}

export async function activateMigrationWithBackup(
  v1Snapshot: ProjectData,
  options: ActivateMigrationOptions,
): Promise<ActivateMigrationResult>
// Transacción readwrite([STORE_NAME, BACKUP_STORE, V2_STORE, 'config'])
// Incluye todos los checks de prepareMigrationWithBackup más:
// - Escribe config/active-format en la misma transacción
// - Resuelve solo en oncomplete
```

No existe una función separada `setActivationFlag()`. La bandera solo puede
escribirse a través de esta transacción.

### 8.2 Gestión de errores

| Situación | Acción |
|---|---|
| Paso 1: `onblocked` | Desbloquear. Pedir cerrar otras pestañas. |
| Paso 2: `pauseAndFlush` falla | Desbloquear. Auto-save v1 sigue. Permitir exportación. |
| Paso 3: `STALE_V1_DATA` | Desbloquear. Auto-save v1 sigue. El usuario reintenta. |
| Paso 3: `INVALID_V2` | Desbloquear. Reportar bug. No migrar. |
| Paso 3: cualquier error IDB | Desbloquear. Auto-save v1 sigue. Config intacto. |
| Pasos 5–7 fallan post-oncomplete | No reactivar auto-save v1. Usar recuperación §9.3. |

> **Regla crítica:** una vez que `activateMigrationWithBackup` resuelve en
> `oncomplete`, el auto-save v1 no se reactiva bajo ninguna circunstancia.
> El formato está comprometido como v2. La vía de retorno es §9.3.

---

## 9. Apertura posterior, importación/exportación y recuperación

### 9.1 Apertura de sesión posterior (ya activado)

```
openDatabase() → DB_VERSION 3, config store presente
readActiveFormatMetadata()
  → { format: 'v2', backupId, generation }
loadProjectV2FromDb()
  → ProjectDataV2 | null
validateProjectDataV2(data)
  → si falla → §9.3 flujo de recuperación
store.hydrateProjectV2(data)
initProjectManagerV2(store, generation)
```

Si `readActiveFormatMetadata()` retorna `null` (pre-activación):
```
loadProjectFromDb() → ProjectData v1
store.hydrateProject(objects, origin)
initProjectManager(store)
```

### 9.2 Importación de proyecto

#### Sesión v2 — importar archivo v2

```
raw.schemaVersion === 2
→ validateProjectDataV2(raw)
→ confirmar("¿Reemplazar proyecto actual?")
→ Transacción atómica:
    - Desplazar v2 actual a migration-backups (add con key único)
    - Escribir nuevo v2 en project-v2
    - Actualizar config/generation
→ store.hydrateProjectV2(raw)
```

#### Sesión v2 — importar archivo v1 (permitido mediante migración en memoria)

No se requiere que el usuario abra software anterior ni exporte a v1 primero:

```
raw.schemaVersion === 1
→ validateProjectData(raw)                     // valida el v1 importado
→ migrateV1ToV2(v1Data, { recordedAt })        // migración en memoria, pura
→ validateProjectDataV2(v2Data)                // valida el v2 generado
→ Mostrar vista previa:
    "Se convertirán X elementos. Incidentes: [lista]."
→ confirmar("¿Importar y convertir?")
→ Transacción atómica (misma estructura que importar v2):
    - Desplazar v2 actual a migration-backups
    - Escribir nuevo v2 en project-v2
    - Actualizar config/generation
    - Guardar respaldo del v1 importado en migration-backups
      (para trazabilidad, no para downgrade)
→ store.hydrateProjectV2(v2Data)
```

Downgrade intencional (v2 → v1 activo) queda fuera del alcance de este plan.

#### Sesión v2 — exportación

```
buildProjectDataV2FromStore(store.getState())
→ JSON.stringify(data, null, 2)
→ download("proyecto-bandejas-v2-{DATE}.json")
```

El archivo exportado tiene `schemaVersion: 2` y todos los campos de
`ProjectDataV2`, incluyendo `migrationIncidents`.

### 9.3 Recuperación desde respaldo M1b

#### Caso: `project-v2` inválido o corrupto al abrir

```
validateProjectDataV2(data) falla
→ Mostrar: "El proyecto tiene un problema. Restaurar desde respaldo?"
→ listMigrationBackups() → listar respaldos disponibles
→ usuario elige el respaldo
→ readMigrationBackup(backupId)
   → { v1Data, v2Data }  ← el respaldo ya tiene el v2 validado de M1b
→ validateProjectDataV2(backup.v2Data)
   → si falla: informar al usuario que el respaldo también está dañado
→ Transacción atómica (project-v2 + migration-backups):
    - Desplazar el project-v2 actual (posiblemente corrupto) como displaced
      (con clave única; usar add, no put) ← preserva los datos, no los elimina
    - Escribir backup.v2Data en project-v2
    - Actualizar config/generation
→ store.hydrateProjectV2(backup.v2Data)
→ initProjectManagerV2(store, nuevaGeneration)
```

**No hay `resetDb`; no se eliminan respaldos; el formato sigue siendo v2.**

La recuperación no reactiva el auto-save v1. Si el usuario necesita
restaurar v1 como proyecto activo, es una operación deliberada y manual
fuera del alcance de este plan.

---

## 10. Seguridad multi-pestaña

### El riesgo

Tab B tiene v1 cargado con auto-save activo cuando Tab A activa v2.
Tab B podría escribir en `project/current` después de la activación.
Esto no corrompe `project-v2/current` directamente, pero puede confundir
si Tab B se recarga y encuentra v1 más reciente que el respaldo.

### Mecanismo 1 — Upgrade bloqueado como barrera de activación

Cuando Tab A intenta abrir la BD a versión 3 con otra pestaña que tiene v2
abierta, `onblocked` dispara:

```typescript
req.onblocked = () => {
  // La activación DEBE abortarse aquí
  store.setEditBlocked(false)
  reportError("Cerrá otras pestañas antes de migrar.")
}
```

La activación no procede si otra pestaña bloquea el upgrade. No se fuerza
el cierre de otras pestañas ni se eliminan datos.

### Mecanismo 2 — `db.onversionchange` en pestañas abiertas

```typescript
// En db.ts, al abrir la conexión (entrega I1):
req.onsuccess = () => {
  const db = req.result
  db.onversionchange = () => {
    db.close()           // libera la conexión para que el upgrade proceda
    _cancelDebounceTimer()
    store.setEditBlocked(true)
    showReloadBanner()   // "Otra pestaña actualizó el proyecto. Recargá."
  }
  resolve(db)
}
```

Este handler se agrega en I1. Pestañas que carguen código anterior (sin I1)
no tendrán este handler; para ellas, el upgrade queda en `onblocked` hasta
que el usuario las cierre manualmente.

### Mecanismo 3 — BroadcastChannel (aviso, no garantía)

```typescript
// Al activar (Tab A, en pasos 4 de §8):
channel.postMessage({ type: 'v2-activated', backupId })

// En todas las pestañas con I_act:
channel.onmessage = (e) => {
  if (e.data.type === 'v2-activated') {
    _cancelDebounceTimer()
    store.setEditBlocked(true)
    showReloadBanner()
  }
}
```

BroadcastChannel es un aviso de buena fe. No garantiza entrega en pestañas
con código anterior, en segundo plano, ni en situaciones de alta carga.
No sustituye a `onversionchange` ni a la verificación de generación.

### Mecanismo 4 — Comprobación de generación en cada escritura v2

Cada escritura del auto-save v2 lee el campo `generation` de `config/active-format`
dentro de la misma transacción IDB antes de escribir (ver §4.1). Si la generación
no coincide con la esperada, la escritura aborta y el auto-save registra un error.

### Límites conocidos

- Pestañas con código anterior (sin los handlers de I1 o I_act) no responden
  automáticamente al upgrade. El usuario debe cerrarlas manualmente.
- El auto-save v1 en Tab B seguirá escribiendo en `project/current` hasta que
  Tab B cierre o recargue. Esto no afecta `project-v2` pero puede confundir
  si se inspecciona la BD directamente.
- No hay protección contra instancias en dispositivos distintos (sin
  sincronización remota, fuera del alcance).
- No se promete tiempo de entrega de mensajes de BroadcastChannel ni cierre
  automático garantizado de otras pestañas.

**Procedimiento recomendado para el usuario:** antes de activar la migración,
abrir la aplicación en una sola pestaña y cerrar todas las demás instancias.

---

## 11. Pruebas de integración y pasos manuales de aceptación

### 11.1 Pruebas automáticas por entrega

**I1 (persistencia + pauseAndFlush):**
- `loadProjectV2FromDb` retorna null en BD vacía.
- `saveProjectV2ToDb` + `loadProjectV2FromDb` round-trip.
- Upgrade v2→v3 no destruye `migration-backups` ni `project-v2`.
- `pauseAndFlush` persiste el estado del store antes de retornar.
- `pauseAndFlush` falla si el guardado falla; no descarta memoria.
- `db.onversionchange` llama `_cancelDebounceTimer` y `setEditBlocked`.
- `saveProjectV2ToDb` con generation incorrecta → aborta sin escribir.

**I2 (adaptador de visor):**
- `resolveGlobalTransform` para elemento raíz = `transform.positionMm`.
- `resolveGlobalTransform` para hijo con padre colocado = posición compuesta.
- `resolveGlobalTransform` para hijo con padre `unplaced` = `null`.
- `elementToRenderProps` para cada `geometry.kind` produce coordenadas correctas.
- `elementToRenderProps` con `placementStatus='unplaced'` → `positionViewer=null`.
- `elementToRenderProps` con `geometry=null` → `geometryKind='unknown'`.
- `asset.boundsMm` → `sizeViewer = [x/1000, z/1000, y/1000]` (no `y` en segundo lugar).

**I3 (adaptador de inspector):**
- `updateElementPosition` establece `placementStatus='placed'` siempre.
- `updateElementPosition` preserva todos los campos técnicos del elemento.
- `updateElementPosition` con rotación preexistente preserva la rotación.
- Snap: `box` usa `heightMm`; `cylinder` usa `lengthMm`.
- Snap deshabilitado si `geometry=null`, rotación no identidad, o `parentId!=null`.
- Display Z = `globalPos.z - projectOrigin.z`; apply envía `globalPos.z`.

**I4 (árbol de escena):**
- Categoría `pushbutton` aparece en grupo "Botoneras / bloques".
- Categoría `pushbutton_station` NO existe (typo corregido).
- `lifecycle='retired'` → clase CSS o indicador visual de inactivo.
- `placementStatus='unplaced'` → indicador de posición pendiente.

**I5 (import/export):**
- Export → `schemaVersion:2` y `migrationIncidents` incluidos.
- Import v2 válido → hidrata store.
- Import v1 en sesión v2 → migra en memoria, muestra preview, hidrata.
- Import v1 inválido → error claro, store sin cambios.
- Import v2 inválido → error claro.
- Round-trip: export → reimport → `elements` idénticos.
- Import v2 reemplaza v2 actual con atomic transaction (desplazado conservado).

**I6 (recuperación UI):**
- `listMigrationBackups` retorna los respaldos disponibles.
- Recuperación usa `backup.v2Data` (no re-migra el v1).
- El v2 corrupto queda como displaced, no eliminado.
- Si `backup.v2Data` es inválido, se informa sin intentar hidratar.

**I7 (seguridad multi-pestaña):**
- BroadcastChannel `v2-activated` → cancela debounce, bloquea edición.
- `onversionchange` → cancela debounce, bloquea edición.
- `saveProjectV2ToDb` generation mismatch → aborta transacción.

**I_act (activación completa):**
- `pauseAndFlush` es llamado antes de leer v1.
- Upgrade `onblocked` → activación abortada, edición desbloqueada, auto-save v1 intacto.
- Transacción atómica: si falla en config → ni respaldo ni v2 ni config escritos.
- Transacción atómica: si falla en v2 → ni respaldo ni v2 ni config escritos.
- Post-activación: auto-save escribe en `project-v2`, no en `project`.
- Post-activación: auto-save v1 no se reactiva.
- `migrationIncidents` persisten en `project-v2` entre sesiones.

### 11.2 Pasos manuales de aceptación (al terminar I_act)

1. **Sesión limpia:**
   - Cargar la aplicación. Verificar: proyecto v1 inicial, `saveStatus='saved'`.

2. **Activación:**
   - Activar v2 (desde la función de activación, sin UI de botón aún).
   - Verificar: visor muestra los mismos objetos en las mismas posiciones.
   - Verificar: inspector muestra posición correcta relativa al origen.
   - Verificar: editar posición → el objeto se mueve en la escena.
   - Verificar: recargar → mismo proyecto v2 cargado.
   - DevTools: `project-v2/current.schemaVersion === 2`.
   - DevTools: `config/active-format.format === 'v2'`.
   - DevTools: `project/current` NO modificado post-activación.

3. **Multi-pestaña:**
   - Abrir dos pestañas antes de activar.
   - Intentar activar → `onblocked` → verificar mensaje de error, edición desbloqueada.
   - Cerrar una pestaña → activar en la restante.
   - Verificar: Tab cerrada no dejó datos corruptos.

4. **Importar v1 en sesión v2:**
   - Exportar un proyecto v1 desde una sesión pre-activación.
   - Importar ese archivo JSON en la sesión v2.
   - Verificar: se muestra preview de migración con elementos y posibles incidents.
   - Confirmar → proyecto v2 cargado con los datos del v1 importado.
   - Verificar: v2 anterior conservado como displaced.

5. **Recuperación:**
   - Corromper `project-v2/current` desde DevTools.
   - Recargar → verificar prompt de recuperación.
   - Restaurar desde respaldo → proyecto v2 recuperado desde `backup.v2Data`.
   - Verificar: datos corruptos conservados como displaced, no eliminados.

6. **Fallo en activación:**
   - Simular `STALE_V1_DATA` (guardar un cambio justo antes de migrar).
   - Verificar: edición desbloqueada, auto-save v1 sigue funcionando.
   - Verificar: `config/active-format` no fue escrito.

---

## 12. Desglose en entregas (I1–I_act)

Los identificadores I1–I_act son específicos de la integración v1→v2.
No interfieren con M2–M7 (ver §13).

### Dependencias

```
I1 (persistencia, pauseAndFlush, onversionchange)
I2 (adaptador visor)   ┐
I3 (adaptador inspector)│ paralelas, requieren M1a auditado
I4 (adaptador árbol)   ┘
I5 (import/export)
I6 (recuperación UI)
I7 (multi-pestaña)
       │
       └── I_act (activación) ← requiere todos los anteriores
```

I5, I6, I7 pueden desarrollarse en paralelo con I2–I4.
I_act es el único paso que activa v2 en producción.

### I1 — Persistencia v2 y pauseAndFlush

**Objetivo:** funciones IDB para v2, DB_VERSION=3, `pauseAndFlush`, generation check.  
**Archivos:** `src/persistence/db.ts`, `src/persistence/projectManager.ts`  
**NO activa v2; NO cambia UI.**  
**Tests:** 8–12 tests fake-indexeddb.

Deliverables:
- `loadProjectV2FromDb()`, `saveProjectV2ToDb(data, generation)`
- `readActiveFormatMetadata()`
- `DB_VERSION = 3`, store `config`, handler `onversionchange`
- `pauseAndFlush()` en projectManager

### I2 — Adaptador de visor

**Objetivo:** `elementToRenderProps`, `resolveGlobalTransform`, conversión de base.  
**Archivos:** `src/scene/v2-adapter.ts` (nuevo)  
**NO toca SceneObjects ni el store de producción.**  
**Tests:** 15–20 tests unitarios.

### I3 — Adaptador de inspector

**Objetivo:** acciones granulares en store, inspector leyendo v2, snap corregido.  
**Archivos:** `src/store/sceneStore.ts` (acciones nuevas), `src/ui/Inspector.tsx`  
**NO elimina la lógica v1.**  
**Tests:** unitarios de acciones del store; tests de interacción.

### I4 — Adaptador de árbol

**Objetivo:** SceneTree con 13 categorías v2 y estados.  
**Archivos:** `src/ui/SceneTree.tsx`  
**Tests:** tests de interacción con fixtures v2.

### I5 — Importación/exportación v2

**Objetivo:** import detecta versión; v1 en sesión v2 migra en memoria con preview;
export serializa v2 con `migrationIncidents`.  
**Archivos:** `src/ui/ProjectActions.tsx`, nuevo helper de migración en memoria.  
**Tests:** detección, round-trip, v1-en-v2 con preview.

### I6 — Recuperación UI

**Objetivo:** panel para listar respaldos M1b; restaurar usando `backup.v2Data`;
displaced conservado.  
**Archivos:** `src/ui/RecoveryPanel.tsx` (nuevo).  
**Tests:** integración con mock de `listMigrationBackups` / `readMigrationBackup`.

### I7 — Seguridad multi-pestaña

**Objetivo:** `onversionchange` y BroadcastChannel handlers en código de producción;
generation check en escrituras v2.  
**Archivos:** `src/persistence/db.ts`, `src/persistence/projectManager.ts`  
**Tests:** con BroadcastChannel mock, `_setDbForTesting`, generation mismatch.

### I_act — Activación completa

**Objetivo:** implementar `activateMigrationWithBackup` extendiendo M1b; implementar
`initProjectManagerV2`; cablear la secuencia de activación de §8.  
**Archivos:** `src/persistence/migration-backup.ts`, `src/persistence/projectManager.ts`,
nuevo `src/persistence/activationCoordinator.ts`  
**Esta es la única entrega que activa v2 en producción.**  
**Tests:** integración completa, incluyendo todos los casos de error de §8.2.

---

## 13. Plan general actualizado

### Ramas completadas

| Rama | Entrega | Commit | Tests | Estado |
|---|---|---|---|---|
| `feat/domain-v2-contracts` | M1a-base | `1eab3f6` | 216 | ✅ |
| `feat/domain-v2-contracts` | M1a-audit-1 | `7f59991` | 242 | ✅ |
| `feat/domain-v2-contracts` | M1a-audit-2 | `80e8e9c` | 270 | ✅ auditado |
| `feat/project-migration-backup` | M1b-base | `13b232e` | 298 | ✅ |
| `feat/project-migration-backup` | M1b-audit-1 | `e661160` | 310 | ✅ |
| `feat/project-migration-backup` | M1b-audit-2 | `4e43abc` | 310 | ✅ auditado |

### Entregas de integración (I1–I_act)

| Entrega | Rama sugerida | Requisitos | Activa v2 |
|---|---|---|---|
| I1 | `feat/v2-persistence` | M1b auditado | No |
| I2 | `feat/v2-viewer-adapter` | M1a auditado | No |
| I3 | `feat/v2-inspector-adapter` | M1a auditado | No |
| I4 | `feat/v2-tree-adapter` | M1a auditado | No |
| I5 | `feat/v2-import-export` | I3 | No |
| I6 | `feat/v2-recovery-ui` | I1 | No |
| I7 | `feat/v2-multitab` | I1 | No |
| I_act | `feat/v2-activation` | I1–I7 completos | **Sí** |

### Fases de producto (M2–M7, sin cambios respecto al modelo auditado)

Las fases M2–M7 definidas en `implementation-plan.md` y `equipment-domain-model.md`
no se modifican. Sus requisitos son independientes de la integración v1→v2:

| Fase | Descripción |
|---|---|
| M2 | Fábricas, subáreas y asociaciones |
| M3 | Ficha común y operaciones de elementos (13 categorías, Datum<T> editable) |
| M4 | Geometría editable y composición padre/hijo |
| M5 | Puertos, conexiones, cables y mangueras |
| M6 | Importación XLSX con trazabilidad por campo |
| M7 | Ruteo, BOM, checklist de campo |

**Requisitos preservados fuera de M1–M7:** DXF, PDF/BOM imprimible, PWA,
catálogo de bandejas, cálculos eléctrico/neumático/hidráulico (fuera del
alcance actual, documentados en `implementation-plan.md` §Funcionalidades
fuera del alcance).

---

## Apéndice A — Decisiones de diseño

### A.1 ¿Por qué no activar v2 parcialmente entrega por entrega?

La lógica condicional `if (v2Active)` penetraría en todos los componentes
y persistiría hasta eliminar el flag. La activación atómica produce código
más limpio: I2–I7 se construyen y prueban contra fixtures v2 sin activar v2
en producción, y I_act hace el corte limpio.

### A.2 ¿Por qué `activateMigrationWithBackup` y no dos funciones separadas?

Separar el commit de datos del commit de la bandera de activación crea
una ventana donde existe v2 escrito pero la bandera aún no está.
Si se fuerza un cierre entre los dos commits, la sesión siguiente no
encuentra bandera y recarga el v1 obsoleto, perdiendo la migración.
Una sola transacción elimina esa ventana.

### A.3 ¿Por qué DB_VERSION=3 no activa v2?

Abrir IDB v3 crea el store `config`, nada más. La activación solo ocurre
cuando `activateMigrationWithBackup` escribe en `config/active-format`.
Esto permite que I1 (que sube a v3) se despliegue sin activar v2, en
cualquier sesión pre-migración.

### A.4 ¿Por qué no garantizar cierre automático de otras pestañas?

Las pestañas con código anterior no tienen los handlers de I1/I_act.
`onversionchange` no puede cerrar pestañas remotamente; solo notifica.
El procedimiento seguro es que el usuario cierre otras instancias antes
de activar. Prometer cierre automático generaría falsa sensación de seguridad.

### A.5 ¿Por qué el downgrade intencional está fuera del alcance?

El flujo de recuperación (§9.3) ya permite volver a un estado v2 conocido-bueno
desde los respaldos M1b. Implementar un downgrade real (config → v1, auto-save → v1)
requiere razonar sobre todos los datos v2-exclusivos que no tienen representación
en v1 (physicalLocation, evidence, connections, etc.). Ese análisis corresponde
a una entrega propia si el requisito se confirma.
