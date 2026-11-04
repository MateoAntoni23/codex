# Plan de integración v2 — Diseñador de Bandejas Portacables 3D

> **Estado:** borrador activo — solo documentación, sin código de producción modificado  
> **Redactado:** 2026-11-04  
> **Rama:** `docs/v2-integration-plan` desde `4e43abc` (M1b auditado)  
> **Prerequisito:** M1a ✅ `80e8e9c` · M1b ✅ `4e43abc`

---

## 1. Contexto y objetivos

El dominio v2 (`ProjectDataV2`) está completamente definido y validado (M1a).
La API de respaldo transaccional está implementada y auditada (M1b).
Ninguna de estas piezas está activa en producción: la aplicación continúa
leyendo y escribiendo `schemaVersion=1`.

Este documento planifica **la activación coordinada de v2** y todas las
adaptaciones necesarias en capas de UI, store y persistencia.

**Objetivos de la integración:**
- v2 pasa a ser la única fuente de verdad en store, IndexedDB y exportación.
- Los componentes existentes (visor, inspector, árbol) siguen funcionando sin
  pérdida de campos v2 durante la edición.
- La activación es reversible: si falla, el respaldo de M1b permite restaurar v1.
- Una pestaña antigua con v1 cargado no puede sobrescribir un proyecto ya migrado.

**Fuera del alcance de este plan (futuras entregas M3–M7):**
- Fichas de equipos con campos técnicos editables desde la UI.
- Modelado de fábricas, subareas y vínculos de servicio.
- Gestión de circuitos neumáticos completa.
- Exportación DXF / integración de campo.
- Conexiones de cables y canalizaciones.

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
// Acciones relevantes para la activación:
hydrateProject(objects, projectOrigin)   // reemplaza todo, limpia selección
updateObjectPosition(id, position)       // parche de posición
_cancelAutoSave()                        // pausa debounce + desubscribe
```

Auto-save: debounce 1 s, `saveGeneration` evita writes obsoletos,
`sessionVersion` invalida operaciones de sesiones anteriores.

### Persistencia (`src/persistence/db.ts`)

| Store IDB | Uso actual |
|---|---|
| `project` (key `current`) | Proyecto v1 activo |
| `migration-backups` | Respaldos M1b + entradas displaced |
| `project-v2` (key `current`) | v2 preparado — inactivo |

### Schema v1 (`src/persistence/schema.ts`)

```typescript
interface DomainObject {
  id: string; name: string; type: ObjectType;
  position: Vec3mm;              // centro, mm, Z-arriba
  dimensions: { width; depth; height }; // mm
}
```

### Schema v2 (`src/types/domain-v2.ts`) — campos relevantes para rendering

```typescript
interface EquipmentElement {
  id: Id; name: string; version: number; // ≥ 1, incrementa por cambio confirmado
  placementStatus: 'placed' | 'unplaced';
  transform: { positionMm: Vec3; rotation: Quaternion } | null;
  geometry: Geometry | null;
  // Geometry = { kind: 'box', widthMm, depthMm, heightMm }
  //           | { kind: 'cylinder', diameterMm, lengthMm }
  //           | { kind: 'plane', widthMm, depthMm }
  //           | { kind: 'asset', assetId, boundsMm }
  category: Category; // 13 categorías
  physicalLocation: PhysicalLocation;
  // ... todos los campos técnicos (Datum<T>) no tocados por la UI de posición
}
```

---

## 3. Arquitectura del sistema con v2 activo

```
┌─────────────────────────────────────────────────┐
│  projectManager v2                               │
│  subscribe(elements, projectOrigin)              │
│  debounce 1s → saveProjectV2ToDb()               │
└────────────────────────┬────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Zustand Store       │
              │  elements: Element[] │  ← fuente de verdad
              │  projectOrigin: Vec3 │
              │  selectedId: string? │
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
          │  IndexedDB           │
          │  project-v2/current  │  ← ProjectDataV2 serializado
          │  migration-backups   │  ← respaldos M1b
          └─────────────────────┘
```

**Cambio estructural central:** el store deja de tener `DomainObject[]` y pasa a
tener `EquipmentElement[]` (junto con los arreglos satelitales: `factories`,
`subareas`, `ports`, `connections`, etc.). El auto-save serializa
`ProjectDataV2` completo al store IDB `project-v2`.

---

## 4. Cambios por capa

### 4.1 Persistencia

**Funciones nuevas en `db.ts`:**

```typescript
export const V2_ACTIVE_KEY = 'v2-activated';

// Lee el proyecto v2 activo (post-activación)
export async function loadProjectV2FromDb(): Promise<ProjectDataV2 | null>

// Guarda el proyecto v2 activo
export async function saveProjectV2ToDb(data: ProjectDataV2): Promise<void>

// Lee y escribe la bandera de activación persistente
export async function getActivationFlag(): Promise<boolean>
export async function setActivationFlag(): Promise<void>
```

La bandera de activación se almacena en un nuevo object store `config`
(DB_VERSION = 3) con clave `v2-activated = true`. Su presencia determina
qué formato cargar al abrir la aplicación.

**Bump de versión IDB (3 → activa v2):**

```
DB_VERSION = 3

onupgradeneeded:
  oldVersion < 1 → createObjectStore('project')
  oldVersion < 2 → createObjectStore('migration-backups')
                    createObjectStore('project-v2')
  oldVersion < 3 → createObjectStore('config')
```

El bump de versión a 3 sirve de señal secundaria a pestañas antiguas
(ver §10 — seguridad multi-pestaña).

### 4.2 Store (Zustand)

**Estado nuevo:**

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

  // --- UI ---
  selectedId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
}
```

**Acciones granulares nuevas (ninguna reconstruye el elemento completo):**

```typescript
// Hidratación completa (activación, apertura, importación)
hydrateProjectV2(data: ProjectDataV2): void

// Posición — solo toca transform.positionMm y bumps version
updateElementPosition(id: string, positionMm: Vec3): void

// Geometría — solo toca geometry y bumps version
updateElementGeometry(id: string, geometry: Geometry): void

// Origen del proyecto — no mueve elementos
setProjectOriginV2(origin: Vec3): void
```

Las acciones existentes `hydrateProject`, `updateObjectPosition` y
`setProjectOrigin` se mantienen en paralelo durante las entregas M2a–M2d
para no romper tests existentes, y se eliminan en M2e (activación).

### 4.3 Visor 3D

**Adaptador `elementToRenderProps`** (`src/scene/v2-adapter.ts`, nuevo):

```typescript
interface ElementRenderProps {
  id: string;
  name: string;
  category: Category;
  placed: boolean;
  positionViewer: [number, number, number] | null; // null si unplaced
  sizeViewer: [number, number, number] | null;     // null si geometry null
  isFloor: boolean;
}

function elementToRenderProps(
  el: EquipmentElement,
): ElementRenderProps
```

Reglas de mapeo:

| Condición | positionViewer | sizeViewer |
|---|---|---|
| `placementStatus='placed'` y `transform != null` | `domainToViewerPosition(transform.positionMm)` | según geometry |
| `placementStatus='unplaced'` o `transform == null` | `null` | `null` |
| `geometry == null` | (mantener posición) | `null` → bbox de fallback |

**Geometrías v2 → viewer:**

| geometry.kind | Renderizado | sizeViewer |
|---|---|---|
| `box` | `<boxGeometry>` | `[widthMm/1000, heightMm/1000, depthMm/1000]` |
| `cylinder` | `<cylinderGeometry>` | `[diameter/1000, length/1000, diameter/1000]` |
| `plane` | `<planeGeometry>` / grid | `[widthMm/1000, 0, depthMm/1000]` |
| `asset` | `<boxGeometry>` con boundsMm | `[x/1000, y/1000, z/1000]` |
| `null` | esfera de radio 0.25 m | `[0.5, 0.5, 0.5]` (fallback visual) |

Los elementos con `placed = false` no se renderizan en la escena 3D.
Se listarán en el árbol con un indicador visual diferente.

**La transformación de coordenadas no cambia:**

```typescript
// Sigue siendo la misma función coords.ts
domainToViewerPosition({ x, y, z }):
  → [x/1000, z/1000, -(y/1000)]
```

### 4.4 Inspector

El inspector pasa de leer `obj.position` / `obj.dimensions` a leer
`element.transform.positionMm` y `element.geometry`.

**Principio anti-pérdida de campos:**  
El inspector NUNCA envía el elemento completo al store. Solo invoca
acciones granulares:

```typescript
// Al aplicar posición editada:
updateElementPosition(selectedId, newPositionMm)
// no: store.patchElement(selectedId, { transform: { positionMm: ... } })
// no: store.replaceElement(selectedId, reconstructedElement)
```

La lógica de coordenadas relativas al origen sigue igual:
```
display = transform.positionMm - projectOrigin
on apply: positionMm = displayValue + projectOrigin
```

**Snap to floor** sigue siendo:
```
positionMm.z = geometry.heightMm / 2 - projectOrigin.z
```
(solo aplica si geometry?.kind === 'box' | 'cylinder').

**Campos técnicos** (Datum<T>): se muestran en modo lectura en esta fase.
La edición de campos técnicos (fichas) queda para M3+.

**Elementos sin geometría conocida:** el inspector muestra
`"Dimensiones: no disponibles"` y oculta el botón Snap to floor.

### 4.5 Árbol de escena

Cambios necesarios:

1. **Categorías de display:** mapear las 13 categorías v2 a los grupos de
   árbol existentes más las nuevas necesarias.

   | Grupos actuales | Categorías v2 agrupadas |
   |---|---|
   | Tableros | `electrical_panel`, `pneumatic_panel` |
   | Motores | `motor` |
   | Bombas | `pump` |
   | Válvulas / electroválvulas | `process_valve`, `solenoid_valve` |
   | Sensores | `sensor` |
   | Actuadores | `actuator` |
   | Iluminación | `luminaire` |
   | Botoneras / bloques | `pushbutton_station`, `terminal_block` |
   | Manifolds | `manifold` |
   | Infraestructura | `infrastructure` |

2. **Indicadores de estado:**
   - `lifecycle='retired'` → icono/color diferente (inactivo).
   - `placementStatus='unplaced'` → icono de posición pendiente.

3. **Selección:** sigue usando `id`; `selectedId` es string en ambas versiones.

---

## 5. v2 como fuente de verdad — sin pérdida de campos

### El problema

Un elemento v2 contiene decenas de campos técnicos (`Datum<T>`) que los
adaptadores de posición e inspector no conocen. Si el store aceptara
reemplazos parciales del elemento, esos campos se perderían silenciosamente.

### La solución: acciones granulares con spread inmutable

Cada acción del store solo toca el sub-objeto que modifica:

```typescript
updateElementPosition(id, positionMm) {
  set(state => ({
    elements: state.elements.map(el =>
      el.id !== id ? el : {
        ...el,
        version: el.version + 1,
        transform: el.transform
          ? { ...el.transform, positionMm }
          : { positionMm, rotation: IDENTITY_QUATERNION },
      }
    ),
  }))
}
```

El spread `{ ...el, ... }` preserva todos los campos técnicos de `el`
(`manufacturer`, `model`, `technical`, `physicalLocation`, etc.) porque
solo se sobreescriben `version` y `transform`.

### Regla de diseño

> Ninguna acción del store reconstruye un `EquipmentElement` desde datos
> de UI. Las acciones solo reciben el delta (el campo y el nuevo valor)
> y aplican un spread del elemento existente.

---

## 6. Elementos sin ubicar y sin dimensiones conocidas

### Elementos sin ubicar (`placementStatus = 'unplaced'`)

- **Visor 3D:** no se renderizan (omitidos en SceneObjects).
- **Árbol:** se muestran con un indicador visual (p. ej. icono de pin vacío).
- **Inspector:** muestra nombre y campos técnicos; oculta posición.
- **Acción "Colocar":** futura acción que asigna `transform` y cambia
  `placementStatus` a `'placed'`.

Los migrados de v1 siempre tienen `placementStatus = 'placed'` porque
todos los objetos v1 tienen posición.

### Elementos sin geometría conocida (`geometry = null`)

Estos no existen en la migración v1→v2 (todos los objetos v1 tienen
dimensiones). Pueden aparecer al crear elementos directamente en v2.

- **Visor 3D:** esfera de radio 0.25 m como marcador (no es la geometría real).
- **Inspector:** no muestra dimensiones ni snap to floor.
- **Árbol:** se muestra normalmente (la geometría no es requisito para listado).

---

## 7. Conservación de geometrías, posiciones, origen y selección

### Posición

La posición se conserva tal como viene de v1 en `transform.positionMm`.
Ningún paso de activación la modifica. La convención "posición = centro"
(z = height/2 para objetos sobre el piso) no cambia.

### Geometría

La migración v1→v2 ya convierte:

| Tipo v1 | Geometry v2 |
|---|---|
| `floor` | `{ kind:'plane', widthMm, depthMm }` |
| `building`, `panel` | `{ kind:'box', widthMm, depthMm, heightMm }` |
| `motor` | `{ kind:'cylinder', diameterMm:width, lengthMm:height }` |

Estos valores están almacenados en el respaldo (M1b) y no se recalculan.

### Origen del proyecto

`projectOrigin: Vec3mm` v1 → `projectOrigin: Vec3` v2 (misma semántica, mismo
valor). Se migra directamente.

### Selección

`selectedId: string | null` no cambia de tipo. Los IDs son los mismos en v1
y v2 (el migrador los preserva). La selección activa no necesita ajuste.

### Rotación

Todos los objetos migrados tienen `rotation: IDENTITY_QUATERNION { x:0, y:0, z:0, w:1 }`.
El visor aún no renderiza rotaciones; cuando lo haga, leerá `transform.rotation`.

---

## 8. Secuencia de activación coordinada

La activación es un evento único, explícito, y no reversible sin usar
el flujo de recuperación.

### Pre-condición

La función `prepareMigrationWithBackup` (M1b) ya fue llamada: existe un
respaldo en `migration-backups` y el v2 preparado en `project-v2`.
Los adaptadores del visor, inspector y árbol ya existen y fueron probados.

### Protocolo paso a paso

```
1. BLOQUEAR EDICIÓN
   store.setEditBlocked(true)
   → Deshabilita todos los inputs y botones de modificación en la UI.

2. CANCELAR AUTO-SAVE
   _cancelAutoSave()
   → Cancela el debounce pendiente. No habrá nuevas escrituras v1.

3. ESPERAR ESCRITURA EN VUELO
   await currentSavePromise   ← nueva handle expuesta por projectManager
   (no es suficiente consultar saveStatus; ver §8.1)

4. LEER V1 ACTUAL
   const v1 = await loadProjectFromDb()
   → Snapshot justo antes de la transacción.

5. RESPALDAR Y PREPARAR V2 (M1b)
   const { backupId } = await prepareMigrationWithBackup(v1, { backupId, timestamp })
   → Si falla (STALE_V1_DATA, INVALID_V2, etc.), desbloquear edición y reportar error.

6. ESCRIBIR BANDERA DE ACTIVACIÓN Y BUMP DE VERSION IDB
   _resetIdbFactory() / await setActivationFlag()
   → DB_VERSION sube a 3; otras pestañas reciben 'versionchange'.

7. SEÑALIZAR OTRAS PESTAÑAS
   broadcastChannel.postMessage({ type: 'v2-activated', backupId })
   → Pestañas antiguas reciben el mensaje y se bloquean (ver §10).

8. HIDRATAR STORE CON V2
   const backup = await readMigrationBackup(backupId)
   store.hydrateProjectV2(backup.v2Data)
   → El store ahora tiene EquipmentElement[]. La selección se limpia.

9. ARRANCAR AUTO-SAVE V2
   initProjectManagerV2(store)
   → Nueva subscripción a elements/projectOrigin, guarda en project-v2.

10. DESBLOQUEAR EDICIÓN
    store.setEditBlocked(false)
```

### 8.1 Esperar la escritura en vuelo

Consultar `saveStatus !== 'saving'` es insuficiente porque:
- `saveStatus` refleja el estado del debounce en JavaScript, no la
  confirmación de IndexedDB (`oncomplete`).
- Una escritura puede estar en curso con `saveStatus` ya en `'saved'`
  si la promesa aún no resolvió.

**Solución requerida:** `projectManager.ts` debe exponer la promesa
de la escritura activa:

```typescript
// En projectManager.ts
let _currentSavePromise: Promise<void> = Promise.resolve();

export function getCurrentSavePromise(): Promise<void> {
  return _currentSavePromise;
}
```

La secuencia de activación await-ea `getCurrentSavePromise()` antes de
leer el v1.

### 8.2 Gestión de errores en la activación

| Error en paso | Acción |
|---|---|
| Paso 5 `STALE_V1_DATA` | Desbloquear, mostrar error, el usuario reintenta |
| Paso 5 `INVALID_V2` | Desbloquear, mostrar error, reportar bug |
| Paso 5 `BACKUP_EXISTS` | No debería ocurrir con backupId único; desbloquear |
| Paso 6–8 error IDB | Desbloquear; v1 auto-save NO se reactiva; usar recuperación |
| Ningún error | No reactivar auto-save v1 jamás |

> **Crítico:** una vez que la bandera de activación está escrita (paso 6),
> el auto-save v1 no debe reactivarse bajo ninguna circunstancia.
> Si los pasos 7–9 fallan, el usuario debe usar el flujo de recuperación
> (§9.3) para restaurar el respaldo, no reiniciar el auto-save v1.

---

## 9. Apertura posterior, importación/exportación y recuperación

### 9.1 Apertura de sesión posterior (ya activado)

```
openDatabase()
  → DB_VERSION = 3; config store existe
getActivationFlag()
  → true (v2 activo)
loadProjectV2FromDb()
  → ProjectDataV2 | null
validateProjectDataV2(data)
  → si falla: ir a flujo de recuperación (§9.3)
store.hydrateProjectV2(data)
initProjectManagerV2(store)
```

Si `getActivationFlag()` retorna false (sesión pre-activación):
```
loadProjectFromDb() → ProjectData v1
store.hydrateProject(objects, origin)   // flujo actual
initProjectManager(store)               // auto-save v1 actual
```

### 9.2 Importación y exportación v2

**Exportación:**

```typescript
// projectActions.ts (v2)
function exportProjectV2(store) {
  const data: ProjectDataV2 = buildProjectDataV2FromStore(store)
  const json = JSON.stringify(data, null, 2)
  download(`proyecto-bandejas-v2-${DATE}.json`, json)
}
```

**Importación — detección de versión:**

```typescript
function importProject(file) {
  const raw = JSON.parse(await file.text())
  if (raw.schemaVersion === 2) {
    const data = validateProjectDataV2(raw)   // lanza si inválido
    confirm("Reemplazar proyecto actual?")
    store.hydrateProjectV2(data)
  } else if (raw.schemaVersion === 1) {
    if (activationFlag) {
      error("El proyecto importado es v1. Migralo primero o usá una sesión anterior.")
    } else {
      const data = validateProjectData(raw)
      confirm("Reemplazar proyecto actual?")
      store.hydrateProject(data.objects, data.projectOrigin)
    }
  } else {
    error("Formato de proyecto no reconocido.")
  }
}
```

**Regla:** después de la activación, solo se puede importar v2.
Si el usuario necesita importar v1, debe hacerlo en una sesión
anterior (con `restoreFromBackup`) o migrar el archivo manualmente.

### 9.3 Recuperación

**Caso: v2 inválido al abrir**

```
loadProjectV2FromDb() → validateProjectDataV2 falla
→ Mostrar: "El proyecto tiene un problema. ¿Restaurar desde respaldo?"
→ listMigrationBackups() → listar respaldos disponibles
→ usuario elige → restoreFromBackup(backupId)
→ La bandera de activación queda activa: NO restaura v1 auto-save
   (el respaldo restaura el v1 en STORE_NAME; para usarlo hay
   que reactivar v1 explícitamente o re-migrar)
```

**Caso: quiere volver a v1 intencionalmente**

```
1. restoreFromBackup(backupId)   → restaura v1 en STORE_NAME
2. deleteActivationFlag()        → borra bandera de activación
3. resetDb o DB_VERSION bump     → opcional, dependiendo del estado
4. hydrateProject(v1Data)        → store vuelve a v1
5. initProjectManager(store)     → auto-save v1
```

Este flujo es manual y deliberado; no hay botón de "desactivar v2" en la UI
(requiere implementación futura).

---

## 10. Seguridad multi-pestaña

### El problema

Tab A activa v2 y empieza a guardar en `project-v2`.
Tab B tiene v1 cargado con auto-save activo y escribe en `project`.
Resultado: el store IDB tiene datos inconsistentes.

### Solución en dos capas

**Capa 1 — BroadcastChannel (señal inmediata):**

```typescript
// En projectManager.ts
const channel = new BroadcastChannel('codex-v2-channel')

// Al activar (Tab A):
channel.postMessage({ type: 'v2-activated', timestamp: Date.now() })

// En todas las pestañas:
channel.onmessage = (e) => {
  if (e.data.type === 'v2-activated') {
    _cancelAutoSave()           // parar writes v1
    store.setEditBlocked(true)  // bloquear UI
    showReloadPrompt()          // "Esta sesión fue actualizada, recargá"
  }
}
```

**Capa 2 — IDB `versionchange` (fallback si BroadcastChannel falla):**

```typescript
// En db.ts, cuando se abre la conexión:
req.onsuccess = () => {
  const db = req.result
  db.onversionchange = () => {
    db.close()           // liberar la conexión
    _cancelAutoSave()    // en projectManager
    showReloadPrompt()
  }
  resolve(db)
}
```

Cuando el Tab A eleva DB_VERSION a 3 (paso 6 de la activación), los
Tabs B y C reciben `onversionchange` y cierran su conexión. Sus próximas
llamadas a `getDb()` abrirán la v3 con el handler de upgrade y se
bloquearán en la parte de código que no conoce v3.

**Combinación:** BroadcastChannel reacciona en < 50 ms (misma máquina).
`onversionchange` es el safety net si el canal falla o si la pestaña
estaba en segundo plano.

### Qué NO hace esta solución

- No protege contra pestañas en dispositivos distintos (sin sincronización remota).
- No protege contra una pestaña que ignoró o no recibió el mensaje (p.ej.,
  worker Service Worker). Documentar como limitación conocida.

---

## 11. Pruebas de integración y pasos manuales de aceptación

### 11.1 Pruebas automáticas por entrega

**M2a (persistencia):**
- `loadProjectV2FromDb` retorna null en BD vacía.
- `saveProjectV2ToDb` + `loadProjectV2FromDb` round-trip.
- `setActivationFlag` / `getActivationFlag` persisten entre conexiones.
- Upgrade de BD v2→v3 no destruye `migration-backups`.
- Usar fake-indexeddb.

**M2b/M2c/M2d (adaptadores — vitest con fixtures v2):**
- `elementToRenderProps` para cada `geometry.kind` produce coordenadas correctas.
- `elementToRenderProps` con `placementStatus='unplaced'` produce `null`.
- `elementToRenderProps` con `geometry=null` produce bbox de fallback.
- Inspector: `updateElementPosition` no modifica campos técnicos del elemento.
- Inspector: "snap to floor" calcula Z correcto con geometría box y cylinder.
- Árbol: elemento con `lifecycle='retired'` recibe la clase CSS de inactivo.
- Árbol: elemento con `placementStatus='unplaced'` recibe indicador correcto.

**M2e (store + activación — vitest + fake-indexeddb):**
- `hydrateProjectV2(data)` reemplaza `elements`, limpia `selectedId`.
- `updateElementPosition` hace spread correcto (no pierde campos técnicos).
- Activación completa con mock de `prepareMigrationWithBackup`:
  - Verifica que `_cancelAutoSave` fue llamado antes del read.
  - Verifica que `setEditBlocked(true)` ocurrió antes.
  - Verifica que el auto-save v2 escribe en `project-v2`, no en `project`.
  - Verifica que el auto-save v1 no se reactiva después.

**M2f (multi-pestaña — vitest con BroadcastChannel mock):**
- El mensaje `v2-activated` cancela auto-save y bloquea edición.
- `db.onversionchange` llama `_cancelAutoSave`.

**M2g (import/export):**
- Export → JSON con `schemaVersion:2`.
- Import de JSON v2 válido → hidrata store con v2.
- Import de JSON v1 en sesión activada → error claro.
- Import de JSON v2 inválido → error claro con mensaje del validador.
- Round-trip completo: export → reimport → mismos `elements`.

### 11.2 Pasos manuales de aceptación (por entrega)

**Al terminar M2e (activación completa):**

1. Cargar la aplicación sin sesión previa.
   - Verificar: se muestra el proyecto v1 inicial.
   - Verificar: `saveStatus` llega a `'saved'`.

2. Activar v2 (desde la función de activación, sin UI).
   - Verificar: el visor sigue mostrando los mismos objetos en las mismas posiciones.
   - Verificar: el inspector abre para un motor y muestra posición correcta.
   - Verificar: editar la posición → el motor se mueve en la escena.
   - Verificar: recargar la página → el proyecto v2 se carga con las mismas posiciones.
   - Verificar: en DevTools, `project-v2/current` contiene `schemaVersion:2`.
   - Verificar: `project/current` NO fue modificado después de la activación.

3. Abrir una segunda pestaña antes de activar.
   - Activar v2 en Tab 1.
   - Verificar: Tab 2 muestra prompt de recarga y no guarda más.
   - Verificar: en Tab 2, el auto-save no escribe en `project/current`.

4. Exportar desde la sesión v2.
   - Verificar: el JSON descargado tiene `"schemaVersion":2`.
   - Importar ese JSON en la misma sesión.
   - Verificar: el proyecto no cambia.

5. Simular fallo de activación (paso 5 con STALE_V1_DATA):
   - Verificar: la edición se desbloquea.
   - Verificar: el auto-save v1 sigue funcionando.
   - Verificar: el proyecto está intacto.

6. Verificar recuperación desde respaldo:
   - Desde DevTools, corromper `project-v2/current`.
   - Recargar.
   - Verificar: se muestra opción de recuperación.
   - Restaurar desde respaldo.
   - Verificar: el proyecto v1 original es accesible.

---

## 12. Desglose en entregas

### Dependencias entre entregas

```
M2a (persistencia)  ──────────────────────┐
M2b (adaptador visor)   ┐                 │
M2c (adaptador inspector)│ paralelas       │
M2d (adaptador árbol)   ┘                 │
                                          ▼
M2e (store + activación) ← necesita M2a + M2b + M2c + M2d
     │
     ▼
M2f (multi-pestaña) ← necesita M2e
M2g (import/export) ← necesita M2e (paralelo con M2f)
M2h (recuperación UI) ← necesita M2e
```

### M2a — Persistencia v2

**Objetivo:** funciones IDB para v2, bandera de activación, DB_VERSION=3.  
**Archivos:** `src/persistence/db.ts`  
**Tests:** 6–8 tests fake-indexeddb  
**NO activa v2; NO cambia UI.**

Deliverables:
- `loadProjectV2FromDb()`, `saveProjectV2ToDb()`
- `getActivationFlag()`, `setActivationFlag()`
- `DB_VERSION = 3`, store `config`, `onversionchange` handler
- `getCurrentSavePromise()` expuesto por projectManager

### M2b — Adaptador de visor

**Objetivo:** `elementToRenderProps` que convierte v2 → props de renderizado.  
**Archivos:** `src/scene/v2-adapter.ts` (nuevo), tests  
**NO toca SceneObjects ni el store.**  
**Tests:** 10–15 tests unitarios con fixtures v2.

### M2c — Adaptador de inspector

**Objetivo:** inspector leyendo desde v2, acciones granulares en store.  
**Archivos:** `src/store/sceneStore.ts` (acciones nuevas), `src/ui/Inspector.tsx`  
**NO elimina la lógica v1 todavía.**  
**Tests:** unitarios de acciones del store; tests de interacción del inspector.

### M2d — Adaptador de árbol

**Objetivo:** SceneTree mapeando categorías v2 con indicadores de estado.  
**Archivos:** `src/ui/SceneTree.tsx`  
**Tests:** tests de interacción con fixtures v2.

### M2e — Store v2 + activación coordinada

**Objetivo:** migrar el store de v1 a v2; implementar la secuencia de
activación completa incluyendo `hydrateProjectV2`, `initProjectManagerV2`
y `setEditBlocked`.  
**Archivos:** `src/store/sceneStore.ts`, `src/persistence/projectManager.ts`,
nuevo `src/persistence/activationCoordinator.ts`  
**Esta entrega activa v2 en la aplicación.**  
**Tests:** integración completa con fake-indexeddb y store mock.

Incluye:
- Remover las acciones y tipos v1 del store (breaking change).
- Adaptar `initProject` para detectar si abrir v1 o v2.
- Implementar la secuencia de los 10 pasos del §8.

### M2f — Seguridad multi-pestaña

**Objetivo:** BroadcastChannel + `db.onversionchange` que bloquean pestañas antiguas.  
**Archivos:** `src/persistence/db.ts`, `src/persistence/projectManager.ts`  
**Tests:** con BroadcastChannel mock y `_setDbForTesting`.

### M2g — Importación/exportación v2

**Objetivo:** import/export detecta versión; en sesión v2 exporta v2 e importa v2.  
**Archivos:** `src/ui/ProjectActions.tsx`, `src/persistence/projectManager.ts`  
**Tests:** unitarios de detección, round-trip, error en v1 sobre sesión v2.

### M2h — Recuperación UI

**Objetivo:** listar respaldos disponibles en la UI; flujo de restauración guiado.  
**Archivos:** nuevo `src/ui/RecoveryPanel.tsx`  
**Tests:** integración con mock de `listMigrationBackups` / `restoreFromBackup`.

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

### Entregas planificadas (M2+)

| Entrega | Rama sugerida | Requisitos previos | Prioridad |
|---|---|---|---|
| M2a | `feat/v2-persistence` | M1b auditado | Alta |
| M2b | `feat/v2-viewer-adapter` | M1a auditado | Alta |
| M2c | `feat/v2-inspector-adapter` | M1a auditado | Alta |
| M2d | `feat/v2-tree-adapter` | M1a auditado | Media |
| M2e | `feat/v2-activation` | M2a + M2b + M2c + M2d | Alta |
| M2f | `feat/v2-multitab` | M2e | Media |
| M2g | `feat/v2-import-export` | M2e | Media |
| M2h | `feat/v2-recovery-ui` | M2e | Baja |

### Fases futuras (M3–M7, no en el alcance de este documento)

| Fase | Descripción |
|---|---|
| M3 | Fichas técnicas editables: campos Datum<T> por categoría; equipos de vacío |
| M4 | Gestión de fábricas, subareas y vínculos de servicio (ElementService) |
| M5 | Puertos, conexiones y canalizaciones de cables |
| M6 | Circuitos neumáticos, manifolds y racords |
| M7 | Exportación DXF e integración de campo; importación desde datasheet/xlsx |

Los requisitos de M3–M7 están documentados en `equipment-domain-model.md` y
en los contratos de `domain-v2.ts`. Este plan no los modifica.

---

## Apéndice A — Decisiones de diseño y alternativas descartadas

### A.1 ¿Por qué no mantener v1 y v2 en paralelo en el store?

Mantener dos fuentes de verdad simultáneas requeriría sincronización
permanente entre `DomainObject[]` (v1) y `EquipmentElement[]` (v2).
Cualquier edición debería reflejarse en ambas representaciones, con riesgo
de divergencia. Se prefiere la migración limpia en el punto de activación.

### A.2 ¿Por qué acciones granulares en lugar de `Partial<EquipmentElement>`?

`Partial<EquipmentElement>` permite accidentalmente omitir campos requeridos
o sobrescribir campos técnicos con `undefined`. Las acciones granulares son
contratos explícitos: el caller solo provee lo que sabe cambiar.

### A.3 ¿Por qué DB_VERSION=3 y no una clave en project-v2?

Una clave en `project-v2` puede ser escrita sin coordinación de versión IDB.
El bump de versión garantiza que las pestañas antiguas (con conexión v2)
reciban el evento `versionchange` y cierren su conexión antes de que el
auto-save v1 siguiente pueda ejecutarse.

### A.4 ¿Por qué no activar v2 de forma gradual (feature flag)?

La lógica condicional `if (v2Active) { ... } else { ... }` penetra en todos
los componentes y persiste indefinidamente hasta que se elimina el flag.
La activación puntual produce código más limpio: los adaptadores se construyen
antes de la activación y se usan desde el primer momento en que v2 está activo.
