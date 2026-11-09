# Importación de equipos, conexiones y fichas técnicas desde Excel — relevamiento de integración

> **Alcance.** Este documento no implementa el importador ni fija un formato Excel.
> Relevaa qué infraestructura existe hoy en el código, qué puede reutilizarse tal cual,
> y qué decisiones quedan pendientes del contrato que está preparando Claude Web.
> No introduce código productivo, stores, esquemas ni pantallas nuevas.

## 1. Rama y revisión inspeccionadas

- Rama: `feat/stabilize-core-workflow`
- SHA: `815d59749bf4c1bcccb5c40f57ade93ab9f40ee6`
- Working tree: limpio.

## 2. Taxonomía usada en cada fila

| Marca | Significado |
|-------|-------------|
| **existente-conectado** | Hay código productivo que lo crea/edita/consume hoy, y llega a la UI/export sin intervención manual. |
| **existente-sin-conectar** | El tipo, esquema, validador o utilitario está en el repo y usado por tests, pero ninguna ruta productiva lo alimenta. |
| **ausente** | No hay código, tipo ni validación — habría que incorporarlo. |
| **no-verificado** | No se inspeccionó el archivo o flujo específico; no confirmar sin leer antes. |

## 3. Diagrama breve del flujo actual (sin importador)

```
+---------------------+     +--------------------------+     +----------------------+
| Botón "Importar     | --> | importWorkspace(raw)     | --> | useWorkspaceStore    |
| JSON" (Toolbar)     |     |  → validateProjectDataV2 |     |  .loadFile(...)      |
+---------------------+     |  → assertInput(trayInput)|     |                      |
                            |  → parseCatalogConfig    |     +----------+-----------+
                            +--------------------------+                |
                                                                        v
                     +-----------------+   +-----------------+   +------+-----------+
                     | WorkspaceScene  |   | WorkspaceTree   |   | WorkspaceInspec. |
                     | (sólo placed)   |   | (lista equipos) |   | EquipmentEditor  |
                     +-----------------+   +-----------------+   +------------------+
                                                                        |
                                                                        v
                                                             EquipmentEditorPanel
                                                             (ficha técnica por
                                                              categoría + Datum)

Camino Excel → workspace (todavía sin construir):
+----------+   +-----------+   +--------+   +--------+   +-----------------+
|  .xlsx   |-->| Parser    |-->|Mapeo a |-->|validate|-->| loadFile con    |
| (externo)|   | (ausente) |   |ProjectV|   |-V2     |   | elements/evid/  |
|          |   |           |   |2+Field |   |        |   | ports/connect./ |
|          |   |           |   |Evidence|   |        |   | factories       |
+----------+   +-----------+   +--------+   +--------+   +-----------------+
```

## 4. Necesidad → implementación actual → evidencia → gap

| # | Necesidad al importar | Implementación existente | Evidencia (file:line) | Estado | Gap |
|---|----------------------|--------------------------|-----------------------|--------|-----|
| 1 | Modelo de equipo con atributos tipados | `EquipmentElement` unión discriminada por `Category` (13 categorías) con `EquipmentElementCommon` + `Placement` + `technical` | `src/types/domain-v2.ts:72` (Category), `:248` (Common), `:265` (Base), `:268` (union), `:156` (TechnicalByCategory) | existente-conectado | Sin entrada: `terminal_block`, `manifold`, `pneumatic_panel`, `pump`, `luminaire`, `pushbutton`, `actuator`, `process_valve`, `solenoid_valve` ya están tipadas pero `createNewElement` solo cubre motor/sensor/electrical_panel (previewCrud.ts:21). Habilitar importación de esas categorías no requiere cambiar el modelo. |
| 2 | Componentes internos de tableros (celdas, bornes, electroválvulas, VFD) | Jerarquía vía `parentId` + `Port` + `InternalLink` + `functionalRelations` | `src/types/domain-v2.ts:256` (parentId), `:290` (Port), `:378` (InternalLink), `:390` (FunctionalRelation); validator cross-refs: `src/persistence/validate-v2.ts:1110,1310,1350,1385` | existente-sin-conectar | No hay UI que cree/edite ports, internalLinks ni functionalRelations; no hay panel "componentes internos" en `EquipmentEditorPanel`. El schema admite representar un VFD como `EquipmentElement` hijo de un `electrical_panel`. Decisión pendiente del contrato: qué subset de componentes trae el Excel. |
| 3 | Conexiones entre equipos (cables, mangueras) con conductores | `Connection` (`kind='cable'\|'hose'\|'manifold_passage'`) + `CableCore` | `src/types/domain-v2.ts:332` (Connection), `:366` (CableCore); validador medium-check: `src/persistence/validate-v2.ts:1400` | existente-sin-conectar | Validador exige que `connection.ends.portId` referencie un `Port` existente — si el Excel solo nombra equipos extremo sin indicar puerto, hay que usar `Endpoint.kind='unresolved'` con `sourceLabel` (ya tipado, `:323`). El workspace no tiene inspector de conexiones; para "mostrar circuitos" se lista `TrayInput.circuitos` que es otra cosa. |
| 4 | Identificadores estables y referenciables | `id` opaco único + `tag` único + `aliases[]` únicos | `src/types/domain-v2.ts:249-251`; validador: `src/persistence/validate-v2.ts:1139` (checkTagUniqueness: tag y aliases comparten el mismo espacio) | existente-conectado | El validador trata tag y aliases como claves fuertes — un TAG de Excel importado dos veces hará fallar la carga. Útil para conciliación idempotente. |
| 5 | Relación equipo ↔ planta / sub-área | `PhysicalLocation` + `Factory` + `Subarea` + `ElementService` (M:N) | `src/types/domain-v2.ts:129`, `:399`, `:405`, `:417`; aliases de factory: `:402` ("SEC, S1, EVA, EA, EVB, EB — para conciliación de importación"); validador: `src/persistence/validate-v2.ts:1255,1287` | existente-sin-conectar | Factories/subareas se exportan y validan pero no se editan en UI (no hay `FactoryEditor`). La `DEFAULT_PROJECT_META` las inicializa vacías. Preparado para conciliar alias-fábrica desde Excel. |
| 6 | Procedencia por campo con celda de origen | `FieldEvidence` con `source: 'xlsx' \| 'manual' \| 'datasheet' \| 'migration'`, `sheet`, `row`, `cell`, `formula`, `rawValue`, `fileChecksum`, `recordedAt` | `src/types/domain-v2.ts:431`; validador: `src/persistence/validate-v2.ts:1055` | existente-sin-conectar | El valor `xlsx` está permitido en el enum pero **nadie emite evidencia con ese source**: `grep source:\s*'xlsx'` en `src/` devuelve cero. La migración v1→v2 emite `source:'migration'` (`src/persistence/migrate-v1-to-v2.ts:55`). El importador futuro inyecta evidencias `source:'xlsx'` sin cambios al modelo. |
| 7 | "Desconocido ≠ cero" con estados intermedios | `Datum<T> { value, status, evidenceIds }` con status `unknown\|estimated\|provided\|verified\|conflict` + coherencia estricta | `src/types/domain-v2.ts:95`; validador coherencia: `src/persistence/validate-v2.ts:155-163` | existente-conectado | `EquipmentEditorPanel` ya muestra el estado y advierte cuando una modificación manual rebaja "verified" → "provided" (`src/preview/EquipmentEditorPanel.tsx:92-96`). Importador debe emitir `status:'provided'` (valor del Excel) o `'unknown'` (celda vacía), nunca `0`. |
| 8 | Fichas técnicas discriminadas por categoría | `TechnicalByCategory` con 13 variantes (motor, sensor, process_valve, …) | `src/types/domain-v2.ts:156-228`; validador por categoría: `src/persistence/validate-v2.ts:333-602` | existente-conectado | Motor tiene `power`, `voltage`, `phases`, `plateCurrent`, `efficiency`, `powerFactor`, `start`. Valve tiene `pressure`, `temperature`, `fluid`. Si el Excel aporta un campo no previsto (ej. "año de fabricación"), hoy solo puede ir como `FieldEvidence.rawValue` adjunta — no hay bolsa de atributos libres. |
| 9 | Equipo importado sin posición | `Placement = { placementStatus: 'unplaced', transform: null }` | `src/types/domain-v2.ts:147`; validador: `src/persistence/validate-v2.ts:308-327`; adapter escena: `src/scene/v2-adapter.ts:57` | existente-conectado | Un elemento `unplaced` se omite de la escena (no se renderiza) pero aparece en `WorkspaceTree` (listado por categoría) y es seleccionable → `EquipmentEditorPanel` lo muestra en modo read-only con "Elemento sin ubicar — no tiene posición en escena" (`src/preview/EquipmentEditorPanel.tsx:439-443`). Perfecto para equipos que vienen del Excel sin coordenadas. |
| 10 | Export/import JSON preserva todo | `exportWorkspace` empaca `ProjectDataV2` + `TrayInput` + `catalogConfig`; `importWorkspace` valida y restituye | `src/workspace/workspaceFile.ts:54`, `:84`; wiring en `UnifiedWorkspace.tsx:120-146` (export), `:148-191` (import) | existente-conectado | Todos los campos de `ProjectDataV2` (ports, connections, cableCores, factories, subareas, elementServices, evidence, migrationIncidents) ya se preservan. No hace falta ampliar el formato de archivo. |
| 11 | Migración v1→v2 reutilizable | `migrateV1ToV2` puro y determinista; emite `MigrationIncident` + evidencias `source:'migration'` | `src/persistence/migrate-v1-to-v2.ts:36`; incident schema `src/types/domain-v2.ts:451` | existente-sin-conectar | No lo llama código productivo (solo tests). El patrón `MigrationIncident` es reutilizable para "incidente de importación" (sin cambiar el tipo, basta con `ev-xls-{id}-{code}` como id). |
| 12 | Infra para leer Excel en el cliente | — | `package.json:15-38` (sin `xlsx`/`exceljs`/`papaparse`); grep `xlsx` en `src/` retorna solo referencias a `FieldEvidence.source` | ausente | No hay parser. `vendor/motor_bandejas/herramientas/importar_catalogo_xlsx.py` es Python para el catálogo de bandejas, no reutilizable del lado web. Decisión pendiente: elegir biblioteca (p. ej. `xlsx`/SheetJS, `exceljs`) o delegar el parseo a Python vía un endpoint nuevo del motor. |
| 13 | UI para agregar equipos en el workspace | `useWorkspaceStore.addElement` existe pero **ninguna UI lo invoca** | `src/workspace/useWorkspaceStore.ts:36,95`; `WorkspaceTree.tsx` (secciones: Capas, Equipos → sólo lista, Trazado, Conexiones, Circuitos, Soportes, PE); `PreviewAddForm` existe pero vive en `?preview=v2` | existente-sin-conectar | La ingesta en lote por importación no necesita UI de alta manual. Si se quiere "Importar Excel" como botón, el sitio natural es la `Toolbar` del `UnifiedWorkspace` (`src/workspace/UnifiedWorkspace.tsx:193-205`), al lado del actual "Importar JSON". |
| 14 | Selección en escena → ficha técnica | Click en objeto → `selectEquip` → `WorkspaceInspector` → `EquipmentCard` → `EquipmentEditorPanel` | `src/workspace/WorkspaceScene.tsx:50-53`; `src/workspace/useWorkspaceStore.ts:85`; `src/workspace/WorkspaceInspector.tsx:515-568`; editor: `src/preview/EquipmentEditorPanel.tsx:295` | existente-conectado | Para un motor placed se muestran: identificación, posición mm, dimensiones mm, fabricante/modelo, ficha técnica completa (potencia, tensión, fases, corriente, η, cosφ, arranque) con estado de Datum. La "ficha técnica" pedida ya existe — lo que falta es poblarla desde el Excel. |
| 15 | Selección vía árbol (equipos sin ubicar) | `WorkspaceTree` lista todos los elementos por categoría, incluso `unplaced` | `src/workspace/WorkspaceTree.tsx:217-238` | existente-conectado | Importante: un equipo sin posición es seleccionable desde el árbol, lo que valida el camino "importar sin coordenadas y consultar ficha". |
| 16 | Conciliación por alias de planta | `Factory.aliases` documentado "SEC, S1, EVA, EA, EVB, EB — para conciliación de importación" | `src/types/domain-v2.ts:402` | existente-sin-conectar | Esquema listo; el productor de aliases (Configurador u otro editor) no existe. Decisión pendiente del contrato: lista oficial de alias planta. |
| 17 | Conciliación por TAG entre importaciones sucesivas | `tag` + `aliases` como clave única global (validador) | `src/persistence/validate-v2.ts:1139` | existente-conectado | Un importador que preserve `tag`/`aliases` de corridas previas puede hacer upsert. El validador no permite dos equipos con el mismo tag. |
| 18 | Puentear "circuito eléctrico" con "recorrido de bandeja" | — | `src/tray/model.ts:5` (`Circuit { circuito_id, cable_id, cantidad, recorrido: string[] }`) vive en `TrayInput`; `Connection` v2 vive en `ProjectDataV2.connections`. No hay mapping entre ambos. | ausente | Hoy el workspace tiene dos modelos paralelos: `Connection[]` (equipo↔equipo, eléctrico) y `TrayInput.circuitos` (cable sobre bandeja, geométrico). El Excel describirá lo primero; el motor cosume lo segundo. Decisión pendiente del contrato: si el Excel aporta la cola "este cable corre por tales bandejas" o solo "este cable conecta A con B". |

## 5. Puntos de conexión del flujo Leer → Validar → Previsualizar → Confirmar → Proyecto

| Paso | Dónde engancha | Qué existe hoy | Qué habría que decidir con el contrato |
|------|----------------|----------------|-----------------------------------------|
| **Leer** | Toolbar del workspace (`src/workspace/UnifiedWorkspace.tsx:193-205`) o pantalla separada | Botón "Importar JSON" como plantilla: usa `<input type="file">` oculto + `FileReader.readAsText` (líneas 118-191). Para Excel se necesitaría una lib binaria. | Librería (SheetJS/ExcelJS en cliente, o endpoint Python en el motor). Si el motor lee Excel, el contrato HTTP del motor crece (nuevo endpoint); si lee JS, agrega ~500 KB al bundle. |
| **Validar** | Antes de `loadFile` | `validateProjectDataV2` (strict, 1500 LOC) valida el resultado final. Un parser Excel primero construye `ProjectDataV2` parcial y luego delega. Las violaciones (tag duplicado, parentId inexistente, Datum incoherente) se reportan con `path`. | Mapeo celda→campo: qué columnas del Excel corresponden a `power.value`, `voltage.value`, etc. Tolerancia: ¿rechazar hoja completa al primer error o emitir `MigrationIncident[]` y continuar? El schema soporta ambos. |
| **Previsualizar** | Pantalla intermedia entre selección de archivo y confirmación | No existe hoy (la importación JSON va directo). Lo natural es un diff "N equipos nuevos, M actualizados, K con conflicto" antes de `loadFile`. | Nada dependiente del contrato — es decisión de UX. Reutilizable: `checkTagUniqueness` del validador (`src/persistence/validate-v2.ts:1139`) para detectar conflictos al cruzar con el workspace actual. |
| **Confirmar** | Botón que dispara `loadFile` o merge | `loadFile` (`src/workspace/useWorkspaceStore.ts:135`) **reemplaza** elementos y evidencias — no hace merge. | Si el importador debe hacer upsert ("actualizar motores existentes, agregar los nuevos") hace falta una variante `mergeFile` que no está. El validador requiere consistencia global, así que un merge parcial debe reconstruir `ProjectDataV2` completo antes de validar. |
| **Proyecto** | Persistencia del resultado | Cambios marcan `dirty=true`; el usuario guarda con "Exportar JSON". No hay IndexedDB en la ruta `?workspace=bandejas` — persiste sólo el archivo. | Nada dependiente del contrato. Si se agrega autoguardado, usar el patrón de `src/persistence/projectManager.ts` del editor v1. |

## 6. Camino del operador: seleccionar motor → ver ficha técnica

1. El operador abre el proyecto (`npm run dev:trays`, luego `http://localhost:5173/?workspace=bandejas`).
2. Click en "Importar JSON" → archivo .json con equipos ya importados desde Excel.
3. La escena muestra sólo los equipos `placed`; el panel izquierdo (WorkspaceTree) lista todos — incluyendo los `unplaced` recién importados — agrupados por categoría (`src/workspace/WorkspaceTree.tsx:217-238`).
4. Click en un motor:
   - Si está `placed`: se resalta en escena (emissive azul, `src/workspace/WorkspaceScene.tsx:45-47`).
   - Si está `unplaced`: solo se selecciona en el árbol.
5. `WorkspaceInspector.EquipmentCard` abre `EquipmentEditorPanel` con los campos de motor:
   - Identificación (`id`, `name`, `tag` si existe, `category` localizada, `geometry` o "Dimensiones pendientes").
   - Fabricante y modelo (Datum, con hint "verificado — al modificar pasará a 'proporcionado'").
   - Datos técnicos del motor: potencia (kW/HP), tensión, fases, corriente de placa, eficiencia, cosφ, arranque (`src/preview/EquipmentEditorPanel.tsx:168-229`).
6. Cada campo imprime su estado Datum (estimado/proporcionado/verificado/conflicto) → el operador sabe si el valor vino del Excel sin vista a datasheet verificado, si lo capturó manualmente, o si hay conflicto con otra fuente.
7. **Lo que falta para "ficha técnica" completa**: visor de evidencias asociadas al Datum. Hoy `evidenceIds` se guardan y validan pero no se muestran — para ver el `rawValue` del Excel o el datasheet-adjunto haría falta un sub-panel. Sin cambios de modelo.

## 7. Riesgos de pérdida o duplicación de datos

| Riesgo | Mecanismo actual | Mitigación disponible |
|--------|------------------|-----------------------|
| **Atributos fuera del schema** (campo del Excel que no existe en `TechnicalByCategory`) | Validator rechaza la carga completa si el objeto trae `obj.technical.frecuencia` inesperada → no, en realidad **no lo rechaza**: los validators por categoría extraen sólo los campos conocidos (`validateTechnicalMotor` y similares) y descartan el resto silenciosamente. El dato se pierde. | Adjuntar el campo extra como `FieldEvidence.rawValue` (campo libre, tipo `unknown`). Requiere que el importador llame a `addEvidence` con el raw antes de descartar. |
| **Reimportación crea duplicados** | `loadFile` reemplaza todo; si en cambio se usa `addElement` en bucle sin chequear `tag`, el validador lanzará `TAG duplicado` y abortará la operación. | Hacer el upsert por `tag`/`alias` **antes** de llamar al validador. Reusar `checkTagUniqueness` como pre-flight. |
| **Cero numérico interpretado como "desconocido"** | El schema separa `value:0, status:'provided'` de `value:null, status:'unknown'`. Depende enteramente del importador respetar la distinción. | Documentarlo en el contrato Excel: "celda vacía → `status:'unknown'`, `value:null`; cero explícito → `status:'provided'`, `value:0`". |
| **Coordenadas inventadas** | Un importador descuidado podría asignar `{x:0,y:0,z:0, placementStatus:'placed'}` a equipos sin posición, apilándolos en el origen. | Preferir `placementStatus:'unplaced', transform:null` para equipos sin coordenada confirmada. Mejor pérdida visual (no aparece en escena) que posición falsa. |
| **Pérdida de conexiones** | Si el Excel describe "cable A→B" sin IDs de puerto, el validador rechaza `connection.ends[0].kind='port'` con `portId` inexistente. | Usar `Endpoint.kind='unresolved', sourceLabel:'<texto del Excel>'` — tipado, validado y persistido. El motor de bandejas no consume estas conexiones (son equipo↔equipo), así que un `unresolved` no bloquea cálculo. |
| **Conflicto no resuelto** | `status:'conflict'` deja el valor congelado y read-only en el editor (ConflictField), pero no hay panel para elegir una fuente candidata. | A corto plazo, mostrar las evidencias candidatas en modo read-only es suficiente; a mediano plazo hace falta un resolve-UI. No bloquea importar. |
| **Factory alias no reconocido** | Si el Excel dice "EVA" y no hay `Factory` con `aliases:['EVA']`, el importador debe decidir: (a) crear la Factory con alias inferido, (b) marcar el equipo `physicalLocation.kind='unassigned'` y abrir `MigrationIncident`. | Opción (b) es la segura: no inventa estructura organizacional. |

## 8. Propuesta mínima de integración (reutilizando lo existente)

- **No tocar `ProjectDataV2`, el validador ni los stores.** El modelo cubre lo que el Excel va a aportar (equipos con atributos tipados, procedencia por campo, factories, equipos sin posición, equipos sin coordenadas, equipos compartidos).
- **Agregar un módulo `src/import/xlsx/*` que no está en el repo**, con:
  - `readWorkbook(file: File): Promise<WorkbookData>` — depende de la lib elegida.
  - `buildProjectV2(wb: WorkbookData, currentWorkspace: Partial<ProjectDataV2>): { next: ProjectDataV2; incidents: MigrationIncident[] }` — puro, determinista, se puede testear sin DOM. Patrón: `migrateV1ToV2`.
  - Reutilizar `validateProjectDataV2` al final; si falla, no cargar y mostrar el path del error.
- **Un botón "Importar Excel" en la Toolbar** (`src/workspace/UnifiedWorkspace.tsx:193-205`), al lado de "Importar JSON". Mismo patrón `<input type="file">` oculto; reemplazar `FileReader.readAsText` por `readAsArrayBuffer`.
- **Una pantalla de previsualización simple** con contadores: "N equipos nuevos", "M con TAG coincidente serán actualizados", "K conflictos", y un botón "Confirmar" que llama a `loadFile` con el `ProjectDataV2` resultante.
- **Visor de evidencias en `EquipmentEditorPanel`** (nuevo sub-panel) para que al hacer click en un Datum se vean las `FieldEvidence` asociadas (sheet, row, cell, rawValue, recordedAt). Hoy los evidenceIds están guardados y validados pero no se exhiben.
- **No crear un modelo paralelo** para "componentes internos de tableros": si el Excel describe un VFD dentro de un tablero, se importa como `EquipmentElement` con `parentId: <tablero.id>` y `category: 'electrical_panel'` — ya soportado por el schema y la recursión de transform (`src/scene/v2-adapter.ts:49-79`).

## 9. Escenarios de aceptación para cuando llegue el contrato

1. **Equipo nuevo sin posición**: importar fila "M-101 / motor / 5.5 kW / 400 V / planta EVA" — el equipo aparece en `WorkspaceTree` bajo "Motores", seleccionable, con ficha técnica completa, posición "sin ubicar", sin dibujarse en escena.
2. **Equipo existente actualizado**: importar fila con TAG que ya existe en el proyecto — el equipo conserva `id`, su posición, sus relaciones y sus evidencias previas; se agregan `FieldEvidence source:'xlsx'` para los campos actualizados y sus Datum pasan a `status:'provided'` (o `conflict` si el valor nuevo difiere del verificado).
3. **Celda vacía ≠ cero**: celda "potencia" en blanco → `Datum.value=null, status='unknown'`. Celda "potencia = 0" → `Datum.value={value:0,unit:'kW'}, status='provided'` (y el validador acepta: `assertDatumQuantityPositive` se saltea cuando `value===null` pero rechazará `value:0` → confirmar si cero tiene sentido físico o si se emite `MigrationIncident`).
4. **Conexión sin puerto conocido**: Excel dice "Cable X: TAB-01 ↔ M-101" sin detallar bornes — se crea `Connection{ kind:'cable', ends:[{kind:'unresolved',sourceLabel:'TAB-01'},{kind:'unresolved',sourceLabel:'M-101'}], ...}`. El validador acepta y el proyecto conserva la cola sin inventar puertos.
5. **Alias de fábrica desconocido**: Excel dice "planta: ZZZ" sin match — se emite `MigrationIncident{ code:'UNKNOWN_FACTORY_ALIAS', originalValues:{alias:'ZZZ'} }` y el equipo queda `physicalLocation.kind='unassigned'`. El proyecto valida y se puede editar manualmente después.
6. **Reimportación idempotente**: importar el mismo Excel dos veces no duplica equipos ni duplica `FieldEvidence` (clave determinista `ev-xls-{tag}-{field}-{checksum}` similar a lo que hace `migrateV1ToV2`). El workspace queda con la misma información y sin TAGs duplicados.
7. **Export → import JSON preserva todo**: luego de importar un Excel y editar un motor en escena, exportar a JSON y reimportar debe recuperar los equipos, sus evidencias `source:'xlsx'`, los `MigrationIncident` y los `catalogConfig.overrides`. Ya cubierto por `exportWorkspace`/`importWorkspace` sin cambios.
8. **Equipo seleccionado muestra ficha completa**: click en motor en escena → inspector derecho muestra potencia/tensión/fases/corriente/η/cosφ/arranque con su estado Datum, fabricante+modelo, ubicación lógica (factory/subarea) y, si se agrega el visor, las evidencias Excel con sheet+row+cell.

## 10. Resumen de puntos de integración y decisiones pendientes

**Puntos de integración listos (sin cambios de modelo ni UI productiva).**
`ProjectDataV2` ya tipa todo lo que el Excel va a aportar: equipos con 13 categorías, fichas técnicas por categoría con Datum, factories+subareas con aliases para conciliación, `FieldEvidence source:'xlsx'` con sheet/row/cell/rawValue, equipos `unplaced`, conexiones con endpoints `unresolved`, incidentes de importación reutilizando el patrón `MigrationIncident`. El validador los enforcea en el `import JSON` actual. El editor de ficha técnica (`EquipmentEditorPanel`) funciona para equipos placed y para unplaced (read-only). La toolbar tiene el espacio natural para un botón "Importar Excel" al lado de "Importar JSON".

**Falta un parser y una pantalla.**
No hay librería Excel en `package.json`, ni UI de "preview de importación" entre archivo y `loadFile`, ni visor de evidencias en el panel técnico. Todo esto es construcción nueva pero cae fuera del alcance de este relevamiento.

**Decisiones que dependen del contrato de Claude Web.**
1. **Mapeo celda → campo**: columnas del Excel por categoría (motor, sensor, tablero, válvula, etc.) y correspondencia exacta con `TechnicalByCategory`.
2. **Modelo de componentes internos de tableros**: qué subset de VFD/borneras/electroválvulas viene en el Excel y cómo se referencian al tablero padre (TAG completo "TAB-01/VFD-1", columna separada, hoja aparte).
3. **Conciliación TAG**: reglas para considerar dos filas como el mismo equipo (TAG exacto, TAG + fábrica, algoritmo de alias).
4. **Unidades canónicas**: si el Excel permite "5.5" vs "5,5", "kW" vs "kw" vs "KW", "400V" vs "400 V" — definir normalización antes del mapeo a `Quantity<U>`.
5. **Cola conexión ↔ recorrido**: si el Excel aporta sólo "cable A↔B" (va a `Connection[]`) o también "este cable corre por bandejas X, Y, Z" (debería alimentar `TrayInput.circuitos.recorrido[]` — pero hoy no hay bridge entre los dos modelos).
6. **Factory aliases oficiales**: lista cerrada de alias por planta para que el importador no tenga que inferirlos.
7. **Librería Excel vs delegación al motor Python**: si el parser corre en navegador (bundle +500 KB, SheetJS) o en el motor (nuevo endpoint HTTP, hoy el motor expone 4 endpoints de bandejas).
8. **Política ante celdas vacías vs inválidas**: emitir `MigrationIncident` y continuar, o rechazar la hoja al primer error.

**No se avanza a implementación sin estas decisiones.** El código existente soporta la ingesta con cambios acotados (parser + pantalla), pero la forma exacta del parser depende del contrato Excel.
