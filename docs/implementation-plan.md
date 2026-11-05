# Plan de implementación — Diseñador de Bandejas Portacables 3D

> **Estado del documento:** activo  
> **Última actualización:** 2026-11-05  
> **Referencia:** `docs/product-requirements.md`

---

## Entregas completadas en la rama `feat/domain-v2-contracts`

| Entrega | Commit | Tests | Descripción |
|---|---|---|---|
| M1a-base | `1eab3f6` | 216 | Contratos v2, validador inicial, migrador puro (20+1 test cases) |
| M1a-audit-1 | `7f59991` | 242 | Primera auditoría: +26 casos de prueba, corrección de 2 bugs confirmados |
| M1a-audit-2 | `80e8e9c` | 270 | Segunda auditoría: pendientes cerrados, +28 invariantes de dominio físico ✅ auditado |

## Entregas completadas en la rama `feat/project-migration-backup`

| Entrega | Commit | Tests | Descripción |
|---|---|---|---|
| M1b-base | `13b232e` | 298 | API transaccional de respaldo para migración v1→v2 (no activada) |
| M1b-audit-1 | `e661160` | 310 | Auditoría: restauraciones únicas, recoverabilidad de desplazados, atomicidad, coordinación |
| M1b-audit-2 | `4e43abc` | 310 | Atomicidad precisa: aborto desde onsuccess real del primer write ✅ auditado |

## Entregas completadas en la rama `feat/v2-persistence-foundation`

| Entrega | Commit | Tests | Descripción |
|---|---|---|---|
| I1 | pendiente | 339 | Persistencia v3 (CONFIG_STORE), pauseAndFlush, bloqueo de edición, versionchange |

### M1b — Respaldo transaccional y recuperación para migración v1→v2

**Objetivo:** preparar la infraestructura de respaldo atómica para una activación futura de v2. La aplicación sigue leyendo y escribiendo `schemaVersion=1`; la API no se llama desde la UI.

#### Distinción crítica: versión de IndexedDB vs. schemaVersion del proyecto

| Concepto | Valor actual | Significado |
|---|---|---|
| `DB_VERSION` en `db.ts` | `2` | Versión del *esquema de IndexedDB* (cuántos object stores existen). Ya activa. |
| `schemaVersion` en `ProjectData` | `1` | Versión del *formato del proyecto* guardado. No ha cambiado. |
| `schemaVersion` en `ProjectDataV2` | `2` | Versión del formato que producirá el migrador. No está activa en producción. |

La apertura de la BD a versión 2 ya ocurre (agrega los stores `migration-backups` y `project-v2`), pero el proyecto activo sigue siendo v1 hasta la activación explícita posterior.

#### API pública (`src/persistence/migration-backup.ts`)

| Función | Descripción |
|---|---|
| `prepareMigrationWithBackup(v1, opts)` | Valida v1, migra a v2, escribe backup + v2 en transacción atómica. No activa v2. |
| `listMigrationBackups()` | Lista resúmenes de respaldos de migración (kind='migration'). |
| `readMigrationBackup(id)` | Lee respaldo completo; lanza `BACKUP_NOT_FOUND` si no existe. |
| `restoreFromBackup(id, opts)` | Restaura v1 desde respaldo; conserva activo desplazado con `add` (clave única). |
| `listDisplacedProjects()` | Lista resúmenes de proyectos desplazados por restauraciones. |
| `readDisplacedProject(id)` | Lee desplazado completo; lanza `BACKUP_NOT_FOUND` si no existe. |
| `restoreFromDisplaced(id, opts)` | Restaura un proyecto desplazado; conserva el activo desplazado con `add`. |

#### Garantías

1. **Atomicidad:** backup de v1, proyecto v2 y project-v2 en una única transacción IDB. Si aborta, no hay escritura parcial (verificado con proxy de test que aborta mid-transaction).
2. **Stale-data check:** re-lectura de v1 dentro de la transacción; aborta si difiere del snapshot.
3. **Sin sobreescritura de backups:** `checkReq` verifica que el `backupId` no exista antes de escribir.
4. **Restauración no destructiva:** el activo desplazado se conserva usando `add` (IDB rechaza colisiones de clave a nivel de motor, no solo por convención).
5. **Claves únicas por restauración:** `displaced-{backupId}-{Date.now()}` por defecto, inyectable en tests.
6. **Solo `oncomplete` resuelve:** las promesas se resuelven únicamente cuando IDB confirma la persistencia.

#### Limitaciones conocidas

- **Equipos de vacío:** `solenoid_valve.operatingPressure.minBar ≥ 0` (presión relativa). Presiones negativas (vacío) no soportadas hasta M3.
- **Sin UI de recuperación:** no hay interfaz para listar/restaurar respaldos en esta entrega.
- **Paginación:** `list*` devuelve todos los registros en memoria; adecuado para los volúmenes esperados.
- **Coordinación con auto-save (pendiente de activación):** ver comentario en `migration-backup.ts`. Nota: verificar `saveStatus !== 'saving'` es insuficiente — se requiere esperar la promesa de guardado en vuelo (ver sección `COORDINACIÓN CON EL GUARDADO AUTOMÁTICO` en el módulo). No reactivar auto-save v1 tras activar v2.

**Bugs corregidos en audit-1:**
1. `validateProjectDataV2` aceptaba cables con `ends[i].portId` apuntando a puertos inexistentes.
2. `validateProjectDataV2` aceptaba `efficiency.value = 2` en motores.

**Tabla de restricciones campo→dominio físico (validate-v2.ts):**

| Categoría | Campo | Restricción | Nota |
|---|---|---|---|
| motor | power | Quantity.value > 0 | nominal |
| motor | voltage | Quantity.value > 0 | nominal |
| motor | plateCurrent | Quantity.value > 0 | nominal |
| motor | efficiency | 0 < value ≤ 1 | ratio |
| motor | powerFactor | 0 < value ≤ 1 | ratio |
| sensor | range.min/max | min ≤ max (pueden ser negativos) | rango de medición |
| sensor | supply.voltageV | > 0 | nominal |
| process_valve | pressure | Quantity.value > 0 | nominal |
| process_valve | temperature | sin restricción de signo | puede ser negativa (criogenia) |
| solenoid_valve | coilSupply.voltageV | > 0 | nominal |
| solenoid_valve | operatingPressure | minBar ≥ 0, minBar ≤ maxBar | presión relativa (manométrica) |
| actuator | stroke | Quantity.value > 0 | longitud |
| actuator | bore | Quantity.value > 0 | diámetro |
| actuator | torque | Quantity.value > 0 | magnitud |
| actuator | workingPressure | Quantity.value > 0 | nominal |
| electrical_panel | ratedCurrent | Quantity.value > 0 | nominal |
| pneumatic_panel | inletPressure | Quantity.value > 0 | nominal |
| pump | flow | Quantity.value > 0 | nominal |
| pump | head | Quantity.value > 0 | nominal |
| luminaire | power | Quantity.value > 0 | nominal |
| luminaire | voltage | Quantity.value > 0 | nominal |
| terminal_block | terminalCount | entero ≥ 1 | conteo |
| manifold | stationCount | entero ≥ 1 | conteo |
| manifold | workingPressure | Quantity.value > 0 | nominal |

**PhysicalLocation.shared:** `factoryId: null`, `subareaId: null` (no hay fábrica única de residencia; usar `ElementService` para registrar las fábricas a las que atiende el equipo). Contrato documentado en `domain-v2.ts`.

---

## Estado actual del proyecto

### Rama activa: `feat/categorized-scene-tree`
Base: `feat/project-save-load` @ `fd9872b`

### Lo que ya está terminado

| Fase | Descripción | Commit de referencia |
|---|---|---|
| 0 | Prototipo inicial: visor 3D, árbol, inspector, 4 paneles | `0eaf3b6` |
| 1 | Correcciones de coordenadas y CVEs | `2c61804` |
| 2 | Floor usa 3 coords; INITIAL_OBJECTS extraído; Node 24 | `8309146` |
| 3 | Editor de posición en inspector: X/Y/Z, Aplicar, Cancelar, Snap | `ebc70ec` |
| 4 | Origen del proyecto: panel UI, marcador 3D, snap compensado | `863a560` |
| 5 | Guardado local (IndexedDB), exportación e importación JSON | `05614b5` |
| 5b | Correcciones de persistencia: db retry, guard initProject, export errors, tests con fake timers | `04f6139` |
| 5c | Correcciones de auditoría: tx.oncomplete, estado inmediato, cancel en useEffect, bloqueo UI, docs | `a490dcc` |
| 5d | Bloqueo OriginPanel, recoverProject, write-cancel check, estado recovering | `6e93cf2` |
| 5e | Identidad de sesión en recoverProject: _sessionVersion/_recoveryToken | `fd9872b` |
| A  | Árbol de escena por categorías contraíbles con contadores | `57cf161` |

### Cobertura de pruebas actual
- **339 pruebas** distribuidas en 13 archivos de test.
- Unitarias: conversión de coordenadas, validación v1/v2, migración v1→v2, IndexedDB (fake-indexeddb).
- Integración: store Zustand, auto-save con timers simulados, identidad de sesión, pauseAndFlush.
- Interacción (jsdom): Inspector, OriginPanel, ProjectActions, SceneTree.
- v2 test breakdown: 72 casos en `validate-v2.test.ts`; 21 casos en `migrate-v1-to-v2.test.ts`; 40 casos en `migration-backup.test.ts`.
- I1 test breakdown: 15 casos en `db.test.ts` (upgrade v3, readActiveFormat, saveV2ProjectToDb, versionchange); 29 casos en `projectManager.test.ts` (pauseAndFlush, resumeAutoSave, bloqueo de edición).

---

## Principios para las próximas fases

1. **Un commit por sprint**, tipificado (`feat`, `fix`, `refactor`).
2. **No mezclar funciones de modelado con correcciones de guardado.**
3. **No agregar dependencias de producción sin justificación explícita.**
4. **Separar commit de corrección del commit de documentación.**
5. **Cada entrega: pruebas, typecheck y build deben pasar.**
6. **Sin backend, cuentas ni sincronización en la nube en el alcance actual.**

---

## Próximas fases — secuencia vigente M1a–M7

La secuencia M1a–M7 es el orden de implementación inmediato.
Diseño completo: [equipment-domain-model.md](equipment-domain-model.md).
Plan de integración v2 completo: [v2-integration-plan.md](v2-integration-plan.md).

La aplicación sigue leyendo y escribiendo `schemaVersion=1` hasta la
activación posterior a M1b, cuando visor, inspector y persistencia puedan
trabajar conjuntamente con v2 o exista un adaptador validado.

### M1a — Contratos, validadores y migrador puro ✅

**Objetivo:** definir todos los tipos TypeScript de v2, el validador actualizado
y la función de migración v1→v2 como código puro sin efectos de BD.

**Prerequisito:** revisar contratos en `equipment-domain-model.md` y preparar
fixtures v1 reales antes de codificar.

**Alcance:**
- Tipos TS: `ProjectDataV2`, `Element`, `ElementBase`, `Placement`, `Datum<T>`,
  `Geometry`, `Port`, `Connection`, `CableCore`, `Factory`, `Subarea`,
  `ElementService`, `InternalLink`, `FunctionalRelation`, `FieldEvidence`.
  `RouteAssignment` como stub documentado; no se inicializa en la migración.
- Función pura `migrateV1toV2(data: ProjectDataV1): ProjectDataV2`:
  sin efectos secundarios, sin IndexedDB, determinista.
- `validateV2` actualizado con nuevas invariantes (unicidad de TAG y alias,
  `version ≥ 1`, `transform` coherente con `placementStatus`, etc.).
- Semántica de `version`: inicializado en 1 al crear o migrar; incrementa
  exactamente una vez por cambio confirmado; no incrementa por selección ni
  borradores cancelados.

**Verificación requerida:**
- Round-trip: v1 → migrate → v2 → export → import → validate sin pérdida.
- IDs, posiciones y nombres intactos tras la migración.
- Motor: `diámetro = width`, `longitud = height`; `status: 'conflict'` si
  `depth ≠ width`; no se normaliza silenciosamente.
- Elemento sin TAG: `tag: null`, `aliases: []`, `condition: 'unknown'`.
- Validador rechaza v2 inválido (referencias rotas, `version < 1`, etc.).

**No incluye:** cambios de UI, IndexedDB, activación en producción.

---

### M1b — Respaldo transaccional y recuperación 📋

**Objetivo:** backup atómico de v1 antes de cualquier escritura de v2;
ruta de recuperación si la migración falla.

**Prerequisito:** M1a aprobado y mergeado.

**Alcance:**
- Guardar copia íntegra recuperable de v1 en clave separada de IndexedDB
  antes de reemplazar el registro activo.
- Si la escritura de v2 falla: v1 permanece activo y exportable; sin downgrade
  destructivo.
- Importación acepta v1 mediante migración en memoria; versiones futuras
  desconocidas se rechazan sin modificar el proyecto.
- v2 no se activa en producción en esta sub-entrega.

**Verificación requerida:**
- Fallo transaccional conserva v1 activo (prueba con fake-indexeddb).
- Respaldo recuperable mediante función de restauración.
- Pruebas existentes siguen pasando sin cambios de comportamiento en v1.

**Activación de v2:** solo cuando visor, inspector y persistencia puedan
trabajar conjuntamente con v2, o cuando exista un adaptador validado que
permita a los componentes existentes leer v2 sin regresiones.

---

---

### I1 — Persistencia v3 y pausa segura del guardado

**Rama:** `feat/v2-persistence-foundation`  
**Objetivo:** preparar la capa de persistencia y el mecanismo de pausa necesarios para la activación posterior de v2. La aplicación sigue leyendo y escribiendo `schemaVersion=1`; v2 no se activa.

#### Distinción crítica: DB_VERSION=3 ≠ activación de v2

| Concepto | Valor | Significado |
|---|---|---|
| `DB_VERSION` en `db.ts` | `3` | Upgrade estructural: agrega `CONFIG_STORE`. No activa v2. |
| `config/active-format` ausente | `null` | Formato activo = v1 (sin entrada = v1). |
| `config/active-format.version = 2` | solo escritura por I_act | Activación real de v2 (fuera de alcance de I1). |

#### API pública nueva (`src/persistence/db.ts`)

| Función / Tipo | Descripción |
|---|---|
| `CONFIG_STORE = 'config'` | Store de metadatos de formato activo (nuevo en v3). |
| `ActiveFormatMetadata` | `{ version: 2; generation: number }` — ausencia = v1. |
| `V2WriteError` | Error tipado con `code: V2WriteErrorCode`. |
| `readActiveFormat()` | Lee metadatos; `null` = v1 activo. |
| `readV2ProjectFromDb()` | Lee el proyecto v2 preparado (store `project-v2`). |
| `saveV2ProjectToDb(data, gen)` | Escribe v2 con check de formato+generación en la misma tx. |
| `registerVersionChangeListener(cb)` | Registra callback para evento `versionchange`; retorna unsub. |

#### API pública nueva (`src/persistence/projectManager.ts`)

| Función | Descripción |
|---|---|
| `pauseAndFlush(store)` | Bloquea edición, cancela timer, espera writes en vuelo, persiste snapshot. Retorna `{ snapshot, pauseToken }`. Si la escritura falla lanza `PauseFlushError` (expone `pauseToken`). |
| `resumeAutoSave(store, pauseToken)` | Desbloquea edición, reinstala suscripción de auto-save. Requiere el token de la pausa activa; lanza si la fase no es `paused` o el token no coincide. |
| `PauseFlushError` | Error lanzado por `pauseAndFlush` al fallar la escritura. Expone `pauseToken` para permitir `resumeAutoSave`. |

#### API pública nueva (`src/store/sceneStore.ts`)

| Campo / Acción | Descripción |
|---|---|
| `editingBlocked: boolean` | true mientras pauseAndFlush está activo. |
| `setEditingBlocked(blocked)` | Bloquea/desbloquea; usado por projectManager. |
| `updateObjectPosition`, `setProjectOrigin`, `hydrateProject` | No-op cuando `editingBlocked = true`. |

#### Garantías de pauseAndFlush

1. `_pauseOp` (con `token: symbol` único) se establece ANTES de cualquier await (fase `waiting`); segunda llamada concurrente rechaza inmediatamente.
2. Cancela el temporizador de debounce sin descartar la memoria.
3. Espera TODAS las escrituras en vuelo (`_inflightWrites: Set`) antes del flush final, incluidas escrituras de sesiones previas. El debounce no garantiza exclusividad; el Set rastrea todas.
4. Rechaza si hay recuperación en curso (`_recovering`) o carga inicial sin terminar (`saveStatus === 'loading'`).
5. `resumeAutoSave` lanza si `_pauseOp.phase` es `waiting` o `writing`; solo permite la reanudación en fase `paused` (éxito o fallo). Si la escritura falló, `PauseFlushError` expone el token.
6. Solo la operación propietaria (verificada por `token`) puede cambiar `_pauseOp`; el `catch` de una pausa antigua no altera el estado de una pausa posterior.
7. `cancel()` limpia `_pauseOp` y desbloquea el editor; tokens de esa sesión quedan inválidos.
8. Verifica `_sessionVersion` antes Y después de la escritura del flush; una sesión cancelada no modifica el estado de la siguiente.

#### Limitaciones conocidas de I1

- `pauseAndFlush` no está conectado a ningún botón ni al inicio de la aplicación.
- `registerVersionChangeListener` está disponible pero no conectado al store; projectManager no lo llama todavía.
- `saveV2ProjectToDb` requiere que v2 esté activo (I_act); en I1 siempre rechazará con `FORMAT_NOT_ACTIVE`.
- Downgrade (v2→v1 activo) está fuera de alcance.
- Clientes antiguos sin controles de generación: requieren cierre/recarga. `BroadcastChannel` es solo notificación.

---

### M2 — Fábricas, subáreas y asociaciones 📋

**Objetivo:** árbol de elementos con jerarquía fábrica → categoría → equipo.

**Alcance:**
- Fábricas: Secado (SEC/S1), Evaporador A (EVA/EA), Evaporador B (EVB/EB).
- FM como subárea de Secado; no es una cuarta fábrica independiente.
- TAB-B: un único elemento con dos `ElementService`; no duplicar el objeto.
- Árbol muestra grupos «Compartidos» y «Sin asignar».
- BOM deduplica por ID al mostrar equipos en más de una fábrica.
- Los objetos de ejemplo (`panel-1`, `motor-1`, etc.) permanecen sin asignar.

**Verificación requerida:**
- FM aparece bajo Secado, no como raíz.
- TAB-B tiene un único ID visible en dos vistas del árbol.
- BOM sin duplicación de cantidades para equipos compartidos.

---

### M3 — Ficha común y operaciones de elementos 📋

**Objetivo:** alta, edición y archivo de elementos con campos por categoría.

**Alcance:**
- Ficha: Identificación, Técnica, Geometría, Conexiones, Componentes,
  Procedencia/pendientes.
- Todos los tipos (13 categorías); campos desconocidos explícitos; borradores
  cancelables sin mutar el store.
- Parámetros no aplicables a una tecnología se ocultan y validan
  condicionalmente; un actuador eléctrico no recibe presión neumática.
- Duplicar: nuevos IDs, TAG pendiente de confirmar, sin copiar conexiones
  externas ni confirmaciones de campo.
- Eliminar: mostrar dependencias, ofrecer archivar; no borrar conexiones
  silenciosamente.

**Verificación requerida:**
- Desconocidos explícitos (`null` + `status: 'unknown'`), nunca `0` falso.
- Borrador cancelable: cancelar no muta el store.
- Archivado preferible sobre eliminación para elementos ya montados.

---

### M4 — Geometría editable y composición 📋

**Objetivo:** dimensiones editables con anclajes correctos y composición
padre/hijo sin escalado automático.

**Alcance:**
- Dimensiones editables para todos los tipos; anclaje configurable.
- Anclaje por defecto: centro de base para piso/nave; cara posterior para
  gabinete de pared; centro para objetos internos.
- Redimensionar el padre no mueve ni escala los hijos; compensar coordenadas
  locales para conservar posición global de los hijos.
- Mover o rotar el padre sí mueve los hijos.
- Validar ausencia de ciclos en `parentId`; rechazar referencias inexistentes.
- Nave: redimensionar conserva centro de base; equipos raíz no se desplazan.

**Verificación requerida:**
- Anclajes correctos en las tres clases de objeto.
- Hijos conservan posición global al redimensionar el padre.
- Ciclos en `parentId` rechazados.

---

### M5 — Puertos, conexiones y fichas técnicas específicas 📋

**Objetivo:** puntos de conexión, cables, mangueras y relaciones funcionales.

**Alcance:**
- `Port` con `connectorKind: 'terminal' | 'multipolar'` y medium eléctrico /
  neumático / hidráulico (hidráulico previsto en contratos, sin cálculos).
- `CableCore` con extremos en terminales individuales; PE y apantallamiento
  explícitos.
- `InternalLink` para continuidad en borneras y paso fluídico en manifold.
- `FunctionalRelation` para electroválvula→actuador y actuador→válvula de
  proceso.
- Visualización de puertos en visor (esfera pequeña).
- Inspector: puertos disponibles y conexiones (solo lectura inicialmente).
- Composición interna de conectores multipolares: definir en esta fase si
  se vinculan mediante `parentPortId` o `InternalLink`.

**Verificación requerida:**
- Cable y manguera diferenciados por `medium`.
- Bornera intermedia: `InternalLink{kind:'conductive'}` correcto.
- Actuador doble efecto: dos mangueras neumáticas a puertos A y B.
- `CableCore.ends` solo referencian `Port{connectorKind:'terminal'}`.

---

### M6 — Simulación de importación XLSX 📋

**Objetivo:** importar una muestra del Excel con vista previa, conciliación
de identidad y trazabilidad por campo.

**Alcance:**
- Checksum del archivo y referencia hoja/fila/celda en `FieldEvidence`.
  No incrustar el archivo binario en el proyecto.
- Vista previa de altas, cambios y conflictos antes de confirmar.
- Reglas de conciliación de TAGs (ver sección 7 del modelo de dominio):
  TAG repetido → conciliar o presentar ambigüedad; no fusionar automáticamente;
  no renumerar CB ni IDs; no sobreescribir decisiones manuales.
- Descripciones libres no se usan como claves de conciliación.
- Sin rutas automáticas: `routeId: null` para todas las conexiones importadas.

**Verificación requerida:**
- Vista previa muestra altas, cambios y conflictos por separado.
- Decisiones manuales previas no se sobreescriben sin confirmación.
- Proyecto permanece inalterado si el usuario cancela la importación.

---

### M7 — Integración con ruteo, BOM y campo 📋

**Objetivo:** `RouteAssignment`, metraje, ocupación y validaciones de campo.

**Alcance:**
- `RouteAssignment`: tramos de bandeja asignados a conexiones.
- BOM: metraje separado por medio (eléctrico / neumático).
- Checklist de campo: estado de instalación por conexión.
- Rutas compartidas: suman ocupación de cables y mangueras sin asumir
  compatibilidad normativa.
- Si falta un dato necesario: estado "pendiente de validación", no "válido".

**Verificación requerida:**
- Metraje separado de validación eléctrica/neumática.
- Ocupación calculada a partir de diámetros exteriores; sin asumir
  compatibilidad entre medios distintos.

---

## Funcionalidades fuera del alcance M1a–M7

> Previstas para etapas futuras; no eliminadas del plan general.

- Backend, autenticación ni sincronización en la nube.
- Importación/exportación DXF (formato de intercambio CAD).
- Exportación de reportes en PDF y listas de materiales (BOM) imprimibles.
- Aplicación web progresiva (PWA) para uso sin conexión en campo.
- Cálculo eléctrico (caída de tensión, selección de sección).
- Cálculo neumático (pérdida de carga, selección de compresor).
- Cálculo hidráulico (contratos de medio previstos en M5; sin cálculos).
- Conformidad normativa certificada.
- Catálogo de bandejas portacables, accesorios y soportes.

---

## Referencia histórica — fases anteriores A.1 y B–F

> Estas fases fueron reemplazadas por la secuencia M1a–M7.
> Se conservan como referencia de requisitos; no son el plan activo.
> Los requisitos de fondo (fichas técnicas, dimensiones editables, puertos,
> bandejas, cables, mangueras) están cubiertos en M1a–M7 con mayor detalle.

### Fase A.1 — Jerarquía fábrica → categoría → equipo

Requisitos absorbidos por M2. Decisiones confirmadas:
- Tres fábricas: Secado (SEC/S1), Evaporador A (EVA/EA), Evaporador B (EVB/EB).
- FM: subárea de Secado; no es una cuarta fábrica.
- TAB-B: un único objeto con dos `ElementService`.
- Ubicación física ≠ fábricas atendidas.
- Sin asignación arbitraria de los objetos de ejemplo.

### Fase B — Dimensiones editables de tablero y nave

Requisitos absorbidos por M4. Punto de anclaje a definir antes de implementar.
Redimensionar no mueve ni escala objetos interiores.

### Fase C — Catálogo básico y etiquetas de equipos

Requisitos absorbidos por M3. Nuevas categorías (10 tipos), geometría 3D
simplificada y etiqueta configurable en el visor.
Consideración normativa: iconos y geometrías son representaciones propias;
no se afirma conformidad con IEC 60617 ni ISO 1219.

### Fase D — Puertos de conexión

Requisitos absorbidos por M5. Visualización de puertos; inspector en modo
solo lectura inicialmente.

### Fase E — Bandejas y recorridos

Requisitos absorbidos por M7. `CableTray` con trayectoria y propiedades físicas;
distinción entre "compartir corredor" y "compartir la misma bandeja".

### Fase F — Cables, mangueras, asignación y validaciones

Requisitos absorbidos por M5 (cables y mangueras) y M7 (metraje y validaciones).
BOM y checklist distinguen cables de mangueras por separado.
