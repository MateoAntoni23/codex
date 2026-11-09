# Auditoría integrada y plan de ejecución — CAD industrial

Documento autocontenido producido para dar cumplimiento a
`docs/strategy/PROMPT-MAESTRO-AUDITORIA-Y-PLAN-CAD.md`. No introduce código
ni modifica catálogos; propone orden y secuencia de trabajo.

## 0. Metadata y alcance de esta entrega

- Fecha: 2026-11-09.
- Repositorio local: `C:\Users\Usuario\Proyectos\codex`.
- Remoto: `https://github.com/MateoAntoni23/codex`.
- Rama base auditada: `docs/strategic-audit-handoff` (`047484c`), que añade el
  prompt sobre `feat/catalog-model-configurator` (`85137f2`).
- Rama de entrega: `docs/strategic-audit-handoff-work` (esta rama).
- Working tree: limpio al inicio de la auditoría; no se alteran fuentes.
- Salida: este documento + `requirements-traceability.csv` +
  `module-disposition.csv` + `source-inventory.csv` en `docs/strategy/`.
- Herramienta: Claude Code (Opus 4.7, 1M context) con lectura de código,
  ejecución de pruebas (ya corridas por tareas previas) y acceso Git normal.

Todas las afirmaciones apuntan a `archivo:línea` cuando hablan de código.
Los números son del snapshot HEAD del `work tree` a la fecha; si una línea
cambia esto queda documentado como evidencia del momento de la auditoría.

## 0.bis — Addendum de corrección (2026-11-09)

Una revisión externa sobre el commit `07b70da` detectó contradicciones entre
las afirmaciones de la auditoría y el código real. Este addendum documenta
las correcciones aplicadas. **La sección 1 "Cinco prioridades" original se
sustituye por la lista corregida al final de este addendum.** Las secciones
2–11 originales se conservan como contexto, pero sus afirmaciones deben
leerse a la luz de este addendum y de los CSV actualizados en el mismo
commit (`requirements-traceability.csv`, `module-disposition.csv`,
`source-inventory.csv`).

### Qué afirmaba 07b70da y qué muestra el código

| # | Afirmación 07b70da | Realidad verificada | Evidencia |
|---|--------------------|---------------------|-----------|
| 1 | "EquipmentEditorPanel no está conectado" / "no hay editor interactivo real (preview estático con datos demo)" | `EquipmentEditorPanel` vive en `src/preview/EquipmentEditorPanel.tsx:295` y **está conectado** al UnifiedWorkspace via `WorkspaceInspector.tsx:14,559`. También lo usa `?preview=v2`. | `grep -n EquipmentEditorPanel src/workspace/WorkspaceInspector.tsx` |
| 2 | "WorkspaceTree no edita circuitos; UI no acepta circuitos" | `WorkspaceTree.tsx:302-329` **edita circuitos inline** (cable_id, cantidad, recorrido). | `src/workspace/WorkspaceTree.tsx:58,70,302-329` |
| 3 | "UI no genera soportes" | `AddSupportForm.tsx` crea soportes con `buildSupport` y los persiste en `trayStore`. | `src/workspace/AddSupportForm.tsx:1-182` |
| 4 | "Motor calcula ocupación / cargas / corridas, falta exposición UI" (R-OCCUP-1, R-LOAD-1, R-LOAD-2) | Motor calcula ocupación por sección (`trazado.py:123-142`), cargas con tapas/PE/escenario (`trazado.py:146-161`), corridas + vanos (`trazado.py:163-179`) y cómputo (`trazado.py:187`). `TrayResults.tsx:48-101` **las presenta** con "Ocupación por pieza/boca", "PE y equipotencial" y "Cómputo de materiales" plegables. | `src/workspace/TrayResults.tsx:48-101` |
| 5 | "`migrateV1ToV2` y `migration-backup` son módulos a añadir en E3" | **Ya existen e están testeados**: `src/persistence/migrate-v1-to-v2.ts:36` (230 LOC, 24 tests en `__tests__/migrate-v1-to-v2.test.ts`) y `src/persistence/migration-backup.ts:172` (569 LOC, suite completa). Son **puras** y no tienen call site productivo fuera de `src/preview/previewData.ts:35` y los tests. | `grep -rn migrateV1ToV2 src` |
| 6 | "`source-inventory.csv` enumera top-level keys del snapshot" | 11 de las 16 claves citadas no existen en el snapshot. Las reales (python `json.load`) son: `APLICACIONES_SOPORTE, COMPATIBILIDADES, COMPONENTES_SOPORTE, COMPONENTES_UNION, FAMILIAS, FUENTES, IDS_PRODUCTOS, PRODUCTOS, PUERTOS_PRODUCTO, SISTEMAS_SOPORTE, TABLAS_CARGA, origen, tipo, version_formato`. | `python -c "import json;print(list(json.load(open('vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json',encoding='utf-8')).keys()))"` |
| 7 | "`src/workspace/exceptionStore.ts` persiste excepciones" (módulo citado en module-disposition) | **No existe tal archivo**. Las excepciones se persisten dentro de `workspaceFile` y se gestionan desde `RoutingPanel` + `continuationCandidates`. | `grep -r exceptionStore src` (0 matches) |
| 8 | "Gizmo de rotación en `src/workspace/*RotationGizmo*`" | **No existe tal archivo**. La rotación se hace vía `RotatePieceControls` (panel numérico en `WorkspaceInspector.tsx:43`) sobre `pieceTransforms.ts`. No hay gizmo 3D interactivo. | `grep -r RotationGizmo src` (0 matches) |
| 9 | "`src/types/workspace.ts` define los tipos" | **No existe**. Los tipos v2 están en `src/types/domain-v2.ts:248,472`. | `ls src/types/` |

### Taxonomía nueva aplicada a las matrices

En los CSV actualizados se sustituye la columna informal `disposition`/`gap_status`
por una taxonomía explícita:

- **existing-operational** — módulo presente y cableado al flujo productivo (ruta
  `?workspace=bandejas`).
- **existing-operational-legacy** — presente y vivo, pero asociado a un flujo
  en retirada controlada (editor v1).
- **existing-partial** — presente pero sólo en vistas experimentales
  (`?preview=v2`, `?pilot=*`).
- **existing-not-wired** — el módulo existe y está testeado, pero carece de
  call site productivo (caso `migrate-v1-to-v2` y `migration-backup`).
- **absent** — no existe en el repositorio; requiere creación.
- **not-verified** — no se pudo comprobar en esta auditoría.

### Decisiones del encargo que no se re-litigan

Mantenidas tal como fueron tomadas por el usuario en el prompt maestro y
confirmadas al revisar el motor:

- El **catálogo editorial** manda sobre las dimensiones nominales del CAD; el
  pipeline STEP no reemplaza al snapshot en la autoridad de `ancho`/`ala`.
- **Bajadas**: la longitud manual **sustituye** a la calculada y **no se suma**
  aparte; los accesorios no propagan longitud.
- La **geometría compartida** de escalera Z/G **no fusiona** los productos
  comerciales: el SKU y la mecánica permanecen separados aun con polígono
  idéntico.

### Tests y verificaciones ejecutadas en este commit

- `grep -rn EquipmentEditorPanel src` → confirma conexión en `WorkspaceInspector`.
- `grep -rn RotationGizmo src` → 0 matches.
- `grep -rn exceptionStore src` → 0 matches.
- `ls src/types/` → `domain.ts`, `domain-v2.ts` (no `workspace.ts`).
- `grep -rn migrateV1ToV2 src` → 29 matches (módulo + tests + 1 call site demo).
- `python json.load(...snapshot.json).keys()` → lista real de top-level keys.
- `wc -l` sobre `AddSupportForm.tsx` (182), `TrayResults.tsx` (133),
  `WorkspaceTree.tsx` (390), `WorkspaceInspector.tsx` (684),
  `migrate-v1-to-v2.ts` (230), `migration-backup.ts` (569).
- Lectura directa de `vendor/motor_bandejas/motor_bandejas/trazado.py:1-207`
  para verificar que el motor calcula ocupación, cargas, corridas y cómputo.
- Lectura de `src/App.tsx:28-46` para confirmar las rutas vivas.

**No se corrieron suites nuevas de tests en este commit** (la entrega es de
diagnóstico; el repositorio está en el mismo estado funcional que `07b70da`,
sin cambios en código productivo). La única modificación son los cuatro
documentos de `docs/strategy/`.

### Cinco prioridades corregidas (reordenadas por dependencia, no por ruta)

La reordenación respeta el principio "dependencias primero, ruta después":
el cambio de la ruta `/` es **consecuencia**, no causa, del cableado real de
la migración v1→v2. Se prefieren entregas completas que reutilicen
capacidades existentes a trabajos nuevos de scaffolding.

1. **Cablear la migración v1→v2 existente al EditorApp** — `migrate-v1-to-v2.ts`
   y `migration-backup.ts` están implementados, puros y probados (24 tests +
   suite completa de backup). Falta el **call site productivo** que:
   (a) detecte proyectos v1 en IndexedDB al arrancar; (b) ofrezca al
   usuario migrar con respaldo; (c) deposite el resultado en el
   `UnifiedWorkspace`. Sin esto, cualquier promoción de `/` al workspace v2
   deja a los usuarios con datos v1 sin acceso natural a sus proyectos.
   Entrega observable: un usuario con proyecto v1 abre `/`, ve el prompt,
   acepta, y queda en `UnifiedWorkspace` con el proyecto migrado y el
   backup disponible para `restoreFromBackup`.

2. **Promover `/` a `UnifiedWorkspace`** y mover el editor v1 a `?legacy=v1`
   con enlace recíproco — **depende estrictamente de (1)**. Cambio de una
   línea en `src/App.tsx:28-46`; el aviso y el banner son el 90 % del
   trabajo. Entrega observable: `/` muestra el workspace v2; `?legacy=v1`
   abre el editor antiguo con banner "herramienta en retirada".

3. **BOM agregado por SKU y exportable** — módulo `src/workspace/bom/`
   nuevo que reutiliza `computar()` del motor (ya devuelve `lineas`,
   `resumen_cables`, `resumen_por_producto`). `TrayResults.tsx:87-101` ya
   muestra `computo.lineas` por SKU; falta sumar por SKU en toda la escena
   y exportar CSV/JSON. Entrega observable: un botón "BOM" en el
   `WorkspaceInspector` abre una tabla con SKU, cantidad, unidad y
   descripción; "Exportar" produce un CSV reproducible.

4. **Ingesta real de equipos** — desbloquea R-LIB-2/3/4. La capacidad de
   edición (`EquipmentEditorPanel`) ya existe y está conectada; lo que
   falta es la **entrada de datos**. Depende de obtener
   `ELS-SYC_Excel_General_Tecnico_RevB.xlsx` autoritativo (bloqueante
   externo). Entrega observable: subir Excel → preview de reconciliación
   TAG/alias/ID → confirmar → equipos aparecen en la escena v2 y son
   editables con el panel existente.

5. **Bajadas con longitud manual** (R-DROP-1/2) — decisión ya tomada: la
   longitud manual **sustituye** a la calculada y no se suma. Entrega
   sobre `parametricBridge` + `trayStore` sin crear módulo civil.
   Entrega observable: seleccionar una pieza, declarar bajada con
   longitud manual, ver que el `resumen_cables` suma esa longitud en
   lugar de la geométrica; exportar/importar JSON conserva el valor.

Explícitamente fuera de las cinco primeras (quedan en las fases PRÓXIMO y
FUTURO del plan original de las secciones 8.2 y 8.3):

- Civil 3D (DXF, extrusiones, capas).
- Vistas predefinidas (frontal/posterior/superior/iso).
- Edición por grupo con preview (R-OCCUP-2).
- Hover 3D con detalle de ocupación (R-OCCUP-3).
- Planos PDF (R-DOC-2) y app móvil de montaje (R-DOC-3).

### Cambios concretos respecto de la primera auditoría

- `requirements-traceability.csv`:
  - R-LIB-4, R-OCCUP-1, R-LOAD-2, R-WIRE-1, R-DOC-1, R-SUPPORT-1, R-TRACE-3:
    estado reclasificado (NO → partial/operational según evidencia real).
  - R-POS-1: elimina referencia a `*RotationGizmo*` inexistente; cita
    `RotatePieceControls` + `pieceTransforms.ts` reales.
  - R-ENG-2: aclara que `migrate-v1-to-v2` y `migration-backup` existen
    pero no están cableados.
  - R-COMPAT-3: elimina referencia a `exceptionStore.ts` inexistente.
  - R-ENTRY-1: añade nota de dependencia con (1) del plan corregido.

- `module-disposition.csv`:
  - Eliminadas afirmaciones sobre módulos inexistentes (`exceptionStore`,
    `*RotationGizmo*`, `src/types/workspace.ts`).
  - Añadidas filas para `EquipmentEditorPanel`, `WorkspaceInspector`,
    `WorkspaceTree`, `TrayResults`, `AddSupportForm`, `pieceTransforms`,
    `previewCrud`, `domain-v2` types.
  - `migrateV1ToV2` y `migration-backup` reclasificados de "añadir (E3)"
    a `existing-not-wired`.
  - Nueva columna `evidence` (archivo:línea) obligatoria en todas las
    filas.
  - Nueva taxonomía `disposition` reemplaza al vocabulario informal
    ("conservar"/"añadir"/"retirar").

- `source-inventory.csv`:
  - `S-CAT-SNAP`: top-level keys sustituidas por las reales verificadas
    con `python json.load`.
  - `S-USER-XLSX`: confirmada ausencia por búsqueda recursiva.

- Este documento (`INTEGRATED-AUDIT-AND-EXECUTION-PLAN.md`):
  - Añadido este addendum completo (sección 0.bis).
  - Las secciones 1–11 conservan su texto original para trazabilidad;
    las cinco prioridades corregidas aparecen al final de este
    addendum.

## 1. Resumen para el usuario (versión 07b70da — superseded por el addendum 0.bis)

### Qué funciona hoy (evidencia breve)

- **Motor Python de bandejas** calcula sector y trazado con contrato `1.0`
  (versión 0.2.2), expone `/v1/salud`, `/v1/catalogos`, `/v1/ejemplos`,
  `/v1/calcular` en `127.0.0.1:8765`. 130 de 135 pruebas pasan sin
  dependencias extra (los 4 fallos son esperados: vectores vs. cambios
  recientes y un `aborted-connection` de prueba HTTP). Evidencia:
  `vendor/motor_bandejas/motor_bandejas/servicio.py:96`,
  `vendor/motor_bandejas/CHANGELOG.md`.
- **Workspace unificado `?workspace=bandejas`** importa/exporta proyecto
  (trayInput + overrides) con JSON v1 roundtrip verificable. Resolución
  paramétrica común: variantes del catálogo real (TRPS-450-20-Z) y toda la
  familia escalera (TRES/CS/TS/XS/RIS) heredan su receta del maestro, sin
  duplicar entradas en el índice legacy. Evidencia:
  `src/workspace/parametricBridge.ts:328`, `src/configurator/masterModels.ts:143`,
  `e2e/entregaFinalUserChain.visual.spec.ts`.
- **Configurador `?configurator=v1`** permite calibrar `modelFrame` y
  `portGeometry` por producto; la variante comparte el marco del maestro
  (herencia probada en Playwright). Persistencia dual: `localStorage`
  (`codex:catalogConfig:v1`) + bloque `catalogConfig` del JSON del proyecto.
  Evidencia: `src/configurator/catalogConfigStore.ts:38`,
  `src/workspace/workspaceFile.ts:41`.
- **Pipeline paramétrico ↔ malla**: la misma función `placeRecipe`
  construye preview y pieza confirmada (fin del drift histórico).
  Evidencia: `src/workspace/parametricBridge.ts:604`, llamada desde
  `src/workspace/RoutingPanel.tsx:365` y `workspaceOperation.ts`.
- **Suite vitest**: 977/977 pasa. `npx playwright test --workers=2`: 31/31
  cuando se corre con dos workers (en worker único hay flakiness
  pre-existente en tests que dependen del orden; no introducida en esta
  rama — verificado con `git stash` + re-ejecución).

### Qué falla o confunde hoy (evidencia breve)

- **Entrada cotidiana ambigua**: `/` sin query string arranca `EditorApp`
  (editor v1 con `useSceneStore` + IndexedDB), no el `UnifiedWorkspace` real
  de bandejas. El usuario necesita escribir `?workspace=bandejas` para
  entrar al flujo verdadero. `src/App.tsx:14,31,45`.
- **Dos herederos de "proyecto"**: `useSceneStore` (v1, IndexedDB) y
  `useWorkspaceStore` (v2, JSON export/import) conviven sin unificación. No
  hay autosave real en la ruta v2; el usuario pierde trabajo si olvida
  exportar. `src/workspace/useWorkspaceStore.ts:73`,
  `src/persistence/projectManager.ts:66`.
- **Configurador portable a medias**: los overrides se persisten
  localmente (`localStorage`) y se incluyen en el JSON del proyecto, pero si
  importás un JSON en otra PC *sin* bloque `catalogConfig`, los overrides
  locales se borran (semántica "reemplazar todo"). Es correcto para
  aislar proyectos pero puede sorprender. `src/workspace/UnifiedWorkspace.tsx:176`.
- **Civil, equipos, cables, ocupación, soportes, planos, BOM**: no
  existen aún en el código del editor. El motor no implementa cargas
  puntuales, planos, BOM ni ocupación residual
  (`vendor/motor_bandejas/README.md:13`). Hay estructura v2
  (`EquipmentElement`, `FieldEvidence`, `useWorkspaceStore`) pero sin
  interacción real de equipo/conector.
- **DCPS sin modelo**: existe maestro `derivacion_pendiente` con
  `variationRule.kind='none'` y `provenance='estimated'`; se usa el
  polígono de TPS como geometría cuando se pide (nota en el código).
  `src/configurator/masterModels.ts:343`, `src/parametric/catalog.ts:270`.
- **ala 50 vs 65** sigue siendo un ruido de origen mezclado: fallback
  silencioso en `recipes.ts:81`, warn-once y comentarios explícitos. No
  hay una fuente única autoritativa aún documentada (ver §6/H7).
- **Varias vistas experimentales** consumen espacio mental sin cumplir el
  flujo cotidiano: `?pilot=v1`, `?pilot=step`, `?preview=v2`. Están
  aisladas, pero sin aviso de "herramienta interna".

### Cinco prioridades (máximo)

1. **Una sola entrada cotidiana** del programa: `/` debe llevar al workspace
   productivo. Mover el editor v1 a una ruta explícita (p.ej. `?legacy=v1`)
   con aviso, sin borrarlo. Investigar qué datos "viven" todavía en
   IndexedDB para no romper proyectos existentes.
2. **Primer flujo cerrado end-to-end**: importar un JSON del usuario,
   trazar `TRPS 300 → CPS 90 → TRPS` y cerrar un ramal con T+reducción,
   exportar y re-importar. Hoy la cadena paramétrica está, pero no hay
   persistencia transparente (§4). Objetivo de "estabilización".
3. **Dominio de equipo/conexión mínimo**: carga por Excel o entrada
   manual del listado del escenario de aceptación integrado (A tablero,
   B motor, C sensor, D tablero neumático) y del §3.6 del prompt. No
   diseñar civil aún; sólo entidades y vínculos revisables.
4. **Bajadas con longitud efectiva** separada de la geométrica (§3.5 del
   prompt). Dibujar 1 m, computar 2 m si el usuario pone override; no
   sumar ambas, no propagar a accesorios. Decisión de diseño de dato
   antes de cualquier implementación.
5. **BOM derivable** del trazado actual (cantidades por SKU, totales
   indiferenciados actuales vs. segmentados). Sin precios, sin ERP;
   sólo contar. Prerrequisito para que el usuario perciba el programa
   como herramienta de trabajo, no demo técnica.

Lo civil, los cables como línea física, la ocupación, los soportes
distribuidos y los planos quedan planificados pero no en la primera
estabilización (§8).

## 2. Requisitos consolidados y flujo de trabajo validado

Los requisitos se derivan íntegramente del prompt maestro. Aquí se
reagrupan por fase de trabajo del ingeniero y se mencionan los párrafos
origen (§X del prompt) para trazabilidad.

### 2.1 Entrada de datos y biblioteca (§3.1 del prompt)

- Bibliotecas de bandejas y conductores se cargan una vez; evolucionan
  por revisión explícita. No reconstruir por proyecto.
- Proyecto arranca con un Excel preparado o una pestaña equivalente de
  edición; mismo modelo en ambos caminos.
- Entidades a soportar: tableros eléctricos/neumáticos, motores, equipos
  accionados, sensores, actuadores, válvulas, iluminación, botoneras,
  puntos de puesta a tierra, bocas de conexión, cámaras, rack/red.
- Servicios: potencia, maniobra/control, instrumentación, comunicación,
  equipotencialidad, PAT. Distintos del medio físico y la capa visual.
- Cables multipolares vs. varios unipolares. Mangueras con conexiones a
  actuadores.
- Importación: conciliar TAG/alias/IDs, duplicados, previsualización,
  completar pendientes. `0` nunca es desconocido.

### 2.2 Civil y posicionamiento (§3.2)

- DXF 2D civil o dibujo nativo. Selección de columnas/paredes → extruir.
  Techos, vigas sobre referencias.
- Three.js es renderizado, no kernel CAD: lo que falta es selección,
  snapping, extrusión, orientación, dibujo 2D sobre vista 2D. No migrar
  stack sin caso de prueba que lo demuestre.
- Tableros: dimensiones físicas. Otros equipos: símbolo (preferencia
  IEC) + ficha + puntos de conexión. Símbolos de tamaño fijo en unidades
  de mundo, mirando a cámara.

### 2.3 Trazado (§3.3)

- Rectos editables, curvas planas 45/90, verticales ascendentes y
  descendentes, articuladas, T, X, reducciones centrales/laterales,
  DCPS, EMTS/EMPS, ACPS, finales, tapas.
- **TPS ≠ DCPS ≠ ACPS ≠ reducción**: nombres independientes aunque la
  geometría comparta polígono en algún caso.
- Longitud instalada vs. comercial vs. corte; totalizar por SKU, no un
  total agregado único.
- Modelos maestros existentes que derivan en anchos/alas (ancho-only-z,
  uniform-xz, ala-independent, depth-only, none); conservar
  correcciones del usuario. Evitar escalado uniforme indiscriminado.
- Escalera Z/G: geometría compartida si las dimensiones pertinentes
  coinciden; SKU, material y mecánica aparte.

### 2.4 Recomendaciones y compatibilidad (§3.4)

- Separar familia comercial, familia geométrica, receta, SKU, alias,
  ID técnico de boca.
- Mapping explícito recipe-port ↔ catalog-port
  (`tronco_P1` ≠ `P1` catálogo). Hoy existe en
  `src/workspace/catalogPortMapping.ts`.
- Niveles de compatibilidad: documentada, regla proyecto, sin evidencia,
  incompatible explícita, pendiente. Excepciones con motivo documentado.

### 2.5 Bajadas (§3.5, aclaración autoritativa)

- Valor manual = conexión exterior equipo↔bandeja. **No** aplicar a
  curvas, T, X ni otros accesorios de bandeja.
- Longitud geométrica = `1 m` dibujada; `longitud manual = 2 m`
  configurada ⇒ cómputo usa `2 m`, dibujo sigue siendo `1 m`. No
  acumular `3 m`.
- Persistir por bajada: equipo/puerto, punto de unión a bandeja,
  longitud geométrica, longitud manual, modo auto/manual, longitud
  efectiva. Mostrar las dos y su procedencia.
- Permite enlace lateral/oblicuo y punto intermedio de bandeja sin
  corte físico.

### 2.6 Cableado y neumática (§3.6)

- Pestaña de conexiones pendientes/completadas, resaltado origen/destino,
  selección de puntos, confirmación a red. Caminos alternativos con
  criterio+intervención.
- Longitud total origen-destino = principal + ramal + accesorios +
  bajadas efectivas (§3.5) + reservas explícitas. Sin doble suma.
- Escenario integrado de aceptación (A/B/C/D con T + reducción +
  cambio aceptado a alambre inoxidable + manguera inversa) queda como
  criterio de cierre más ambicioso.

### 2.7 Ocupación, separación, cambios de ancho (§3.7)

- Diámetro exterior y cantidades por tramo. Criterio explícito de
  ocupación (no una fórmula universal), capacidad geométrica,
  compartimentos, verificación por reglas del proyecto. No afirmar
  norma universal.
- Cambiar ancho/sistema por grupo con preview, conservación de recorridos
  y posibilidad de deshacer.
- Hover muestra producto, dimensiones, ocupación, servicios, tendidos.

### 2.8 Cargas y soportes (§3.8)

- Masa por metro de cada cable + cantidades + masas de bandeja/
  accesorios/tapa/PE. Desconocido ≠ 0.
- Corrida recta continua (3000+3000+3000+1500 = 10500 mm) como unidad
  de reparto.
- Primer y último soporte en offsets (p.ej. 100 mm), reparto simétrico
  con `n=ceil(distancia/sep_max)` y `n+1` apoyos.
- Soportes fijados manual + restricciones documentadas se respetan.
- Verificación de bandeja/soporte/anclaje son responsabilidades
  distintas. El motor hoy devuelve `NO_VERIFICABLE` para carga por apoyo
  (evidencia: `vendor/motor_bandejas/motor_bandejas/soportes.py:1`).

### 2.9 Documentación y campo (§3.9)

- BOM por SKU, estado, cantidades. Lista de cables/mangueras con
  metraje individual y totales segmentados.
- Planos: vista/ventana, capas, escala, rótulo, revisión. PDF
  multipágina. No afirmar conformidad automática.
- Consulta móvil: equipos, recorridos, cables/mangueras, soportes,
  anclajes. Seguimiento de corte/montaje/verificación distinto de
  recorrido diseñado.

## 3. Matriz requisito → implementación real → evidencia → brecha

La matriz completa está en `requirements-traceability.csv`. Un extracto
ilustrativo (10 filas) va aquí:

| Requisito | Impl. real hoy | Evidencia | Brecha / estado |
|-----------|----------------|-----------|-----------------|
| Bibliotecas se cargan una vez (§3.1) | `loadContext()` trae catálogo+ejemplos del motor al iniciar store | `src/tray/client.ts:19`, `src/tray/store.ts:82` | OK. Falta flujo explícito de "revisión de biblioteca" con versión fija por proyecto. |
| Importación Excel/entidades (§3.1) | No existe pestaña; sólo roundtrip JSON de workspace | `src/workspace/workspaceFile.ts`, `src/persistence/projectManager.ts` | NO implementado. El `ELS-SYC_Excel_General_Tecnico_RevB.xlsx` no está en el repo. |
| Civil (DXF, extrusión) (§3.2) | Inexistente en editor. `EquipmentElement` tiene floor/transforms pero sin edición real | `src/types/workspace.ts` (si existe), `useWorkspaceStore.ts:73` | NO implementado. |
| Posicionamiento con arrastre/gizmo (§3.2) | Gizmo de rotación manual existe (B1–B4 hechas en tareas previas) pero para piezas de bandeja, no para equipos | `src/workspace/RotationGizmo.tsx` (si existe) | Parcial. Equipos no son draggables. |
| Trazado: rectos, curvas, T/X, reducciones (§3.3) | `placeRecipe` + `MasterModel` cubren: perforada TRPS/CPS45/CPS90/TPS/XPS/CUPS y escalera TRES/CS/TS/XS/RIS; DCPS pendiente | `src/parametric/geometry/outlines.ts`, `escaleraRecipes.ts`, `src/configurator/masterModels.ts:143` | OK para los tipos cubiertos. DCPS sin modelo medido. |
| Longitud comercial vs. instalada (§3.3) | Hoy `longitud_comercial_mm` del catálogo alimenta recetas; totaliza por `producto_id` en motor | `src/parametric/geometry/recipes.ts:85`, `vendor/motor_bandejas/motor_bandejas/computo.py` | Se totaliza; falta exposición UI por SKU vs. agregado. |
| Mapping boca-receta ↔ puerto-catálogo (§3.4) | Explícito, con overrides persistidos | `src/workspace/catalogPortMapping.ts:234` | OK. |
| Longitud efectiva de bajada (§3.5) | NO implementado | — | NO implementado. Fórmulas del motor no distinguen bajada aún. |
| Cableado / neumática (§3.6) | NO implementado en UI. Motor acepta `circuitos[]` en `entrada.trazado/1` | `vendor/motor_bandejas/docs/CONTRATO_INTEGRACION.md` | NO implementado en UI. |
| Soportes (§3.8) | Motor devuelve diagnóstico (no verificación eléctrica/mecánica). UI no genera soportes | `vendor/motor_bandejas/motor_bandejas/soportes.py:23` | NO implementado en UI. |

## 4. Diagramas de arquitectura

### 4.1 Arquitectura actual

```
         ┌──────────────────────────────┐
         │   Browser (React + R3F)      │
         │                              │
URL = /  │  EditorApp → Layout          │  ← legacy v1 + IndexedDB autosave
         │  (useSceneStore)             │
         │                              │
 ?ws=    │  UnifiedWorkspace            │  ← flujo productivo v2
 bandejas│  (useWorkspaceStore,         │     export/import JSON manual
         │   useTrayStore,              │
         │   useRoutingStore)           │
         │                              │
 ?cfg=v1 │  ConfiguratorLayout          │  ← overrides modelFrame/portGeometry
         │  (useCatalogConfigStore,     │     localStorage + bloque en JSON
         │   useTrayStore)              │
         │                              │
 ?pilot= │  ParametricLayout            │  ← experimental: visor catálogo STP-Z
 step    │  (useParametricStore)        │
         │                              │
 ?pilot= │  PilotLayout                 │  ← experimental: 4 piezas de prueba
 v1      │  (usePilotStore)             │
         │                              │
 ?prev=v2│  PreviewApp                  │  ← experimental: demo v2 UI
         │  (usePreviewStore)           │
         │                              │
 ?ws=    │  TrayWorkspace               │  ← legacy "en memoria" (banner)
 bandejas│                              │
 -legacy │                              │
         └───────────────┬──────────────┘
                         │  fetch /api/motor/v1/*
                         ▼
         ┌──────────────────────────────┐
         │  Python motor (stdlib http)  │
         │  127.0.0.1:8765              │
         │  /salud /catalogos           │
         │  /ejemplos /calcular         │
         │  contract 1.0, version 0.2.2 │
         └──────────────────────────────┘

Persistencia:
- IndexedDB            →  EditorApp (v1 legacy)
- localStorage         →  useCatalogConfigStore, useCalibrationStore
- JSON export/import   →  UnifiedWorkspace (trayInput + catalogConfig + elements)
- memoria sola         →  TrayWorkspace, PreviewApp, PilotLayout, ParametricLayout
```

Cadena paramétrica (preview = confirmado, misma función):

```
Producto SKU
  │
  ▼
resolveParametricEntry(product)        parametricBridge.ts:328
  │     │
  │     └─► ENTRY_BY_SKU (6 entries × 2 SKUs = 12)
  │         PARAMETRIC_CATALOG (perforada TRPS/CPS/CUPS/TPS/XPS)
  │
  └─► resolveParametricEntryViaMaster  parametricBridge.ts:219
         │
         ├─► findMasterForProduct         masterModels.ts:…
         │     (13 masters, 7 perforada + 6 escalera)
         │
         └─► buildRecipeByKey             recipes.ts
               ├─ perforada       → buildRecipeFor('tramo_recto' | …)
               └─ 'escalera:*'    → buildTRESRecipe | CS45 | CS90 | TS | XS | RIS
  │
  ▼
ParametricEntry (sintética o directa)
  │
  ▼
buildRecipeFromProduct(product, entry, overrides)   parametricBridge.ts:367
  │       └─ dispatcher: entry.recipe.endsWith('.STEP') ? legacy : buildRecipeByKey
  ▼
GeometryRecipe (polígono local)
  │
  ▼
resolveRecipeForProduct(rawRecipe, producto_id)     resolvedPortGeometry.ts
  │       └─ aplica modelFrame + portGeometry overrides del Configurador
  ▼
{ recipe, preTransform, isIdentity }
  │
  ▼
buildLocalMesh(recipe) → THREE.BufferGeometry       parametricBridge.ts:728
  │
  ▼
placeRecipe(product, entry, startPos, entryDir, chirality, opts)
  │       └─ M_base + Rz(φ) + traslación + Householder opcional
  ▼
PlacedRecipe { ports[], matrix, finalMatrix }
  │       Usado por:
  │       - preview       (RoutingPanel.tsx:365)
  │       - confirmed     (workspaceOperation.ts)
  │       - motor payload (tray/client.ts:12 → /v1/calcular)
```

### 4.2 Arquitectura objetivo (sin reescrituras masivas)

```
        ┌──────────────────────────────┐
        │   Browser (React + R3F)      │
        │                              │
URL=/   │   MainWorkspace              │  ← ENTRADA ÚNICA del usuario
        │   (pestañas internas:        │     v1 reubicado a herramienta interna
        │    Proyecto · Civil ·        │
        │    Trazado · Cableado ·      │
        │    Soportes · Planos ·       │
        │    Biblioteca · Config)      │
        │                              │
 ?lab=  │   Vistas internas            │  ← pilot, preview, parametric, legacy
 <name> │   (herramientas de           │     con banner "uso interno"
        │    diagnóstico)              │
        │                              │
        └───────────────┬──────────────┘
                        │
                        ▼
        Un store "projectStore" unificado (compuesto, no monolítico):
          · library:   catálogo + versión fijada por proyecto
          · design:    elementos + conexiones + bandejas + bajadas
          · config:    overrides del configurador (modelFrame, portGeometry)
          · runtime:   estado de rutas, selección, routing activo
                        │
                        ▼
        Persistencia:
          · IndexedDB para autoguardado transparente
          · Export/Import JSON v2 (migración desde v1)
          · Sincronización opcional (fuera de esta auditoría)
                        │
                        ▼
        Motor Python 0.2.2 (sin cambios de contrato en esta fase)
          + adaptador explícito para los campos v2 (equipo, bajadas,
            ocupación, soportes) que el motor aún no verifica.
```

Clave: el objetivo **no es reescribir**. Es:
1. Reducir rutas-entrada a una + "laboratorio interno".
2. Consolidar los 9 stores actuales a un store compuesto con lifecycle claro.
3. Introducir autosave transparente en v2 reutilizando `IndexedDB` del v1.
4. Documentar el adaptador v2 → motor contract/1.0 para que el motor
   ignore datos que todavía no procesa sin romperse.

## 5. Inventario de fuentes, herramientas y responsabilidades

Detalle completo en `source-inventory.csv`. Resumen:

### 5.1 Fuentes de datos

| Fuente | Dónde vive | Uso | Autoridad |
|--------|-----------|-----|-----------|
| `catalogo_bandejas_snapshot.json` (4 MB) | `vendor/motor_bandejas/datos/catalogo/` | 5 archivos TS + motor Python. Dato vivo. | Fabricante (SAMET) snapshot. |
| `Catalogo_Bandejas_y_Accesorios_2.xlsx` | `vendor/motor_bandejas/datos/catalogo/fuente/` | Origen editorial del snapshot. | Fabricante. |
| `ELS-SYC_Excel_General_Tecnico_RevB.xlsx` | **No encontrado en el repo** | Pretendido para importar equipamiento. | Usuario (aún no localizado). |
| STEP del usuario | `artifacts/parametric/*.step` (6 recon + 6 variant) | Reconstrucciones/variantes para medir polígono. | Usuario (aportados). |
| GLB | `public/parametric/{originals_glb,reconstructions,variants}/*.glb` (18) | Renderizado experimental en `?pilot=step`. | Pipeline tools/step_parametric. |
| Fixtures E2E | `e2e/fixtures/*.json` | Playwright — incluye `user-report-20261107.workspace.json` real. | Usuario. |
| cad-catalog-analysis | `C:\Users\Usuario\Proyectos\cad-catalog-analysis` (fuera del repo) | Paquete separado con DXF/DWG piloto y scripts Python. | Proyecto externo. |
| Libreria CAD 2021 | `C:\Users\Usuario\Downloads\Libreria CAD 2021` | 8 directorios + Tutorial PDF. Solo lectura. | Fabricante (histórico 2020/21). |

### 5.2 Herramientas disponibles y vigentes

| Herramienta | Vigente | Dónde | Observación |
|-------------|---------|-------|-------------|
| `npm run dev:trays` | Sí | `scripts/dev-trays.mjs` + `server/tray_service.py` | Spawna motor y Vite; strict port 5173/8765. |
| Vitest | Sí | `src/**/__tests__` | 977 pruebas pasan. |
| Playwright | Sí | `e2e/` + `playwright.config.ts` | 31 pruebas E2E (2 workers). |
| Python stdlib | Sí | `vendor/motor_bandejas` | Server http sin FastAPI. 130/135 pruebas. |
| CadQuery / OpenCascade | Parcial | `tools/step_parametric/` | Pipeline para construir STEP/GLB — opcional en runtime. |
| ODA / ezdxf | No en runtime | — | Solo para pipeline CAD fuera del repo (cad-catalog-analysis). |

### 5.3 Responsabilidades

| Área | Quién la ejecuta | Nota |
|------|------------------|------|
| Receta geométrica | TS (`src/parametric`) | Única fuente; motor recibe puertos en payload. |
| Resolución boca↔puerto | TS (`src/workspace/catalogPortMapping.ts`) | Overrides del Configurador. |
| Persistencia proyecto | TS mixto | IndexedDB (v1), JSON (v2), localStorage (config). |
| Cálculo eléctrico/mecánico | Python (motor) | Sector + trazado contrato 1.0. |
| BOM, planos, consulta móvil | **Ningún módulo todavía** | Pendientes del plan. |
| Civil, equipos interactivos | **Ningún módulo todavía** | Preview v2 muestra demo estática. |

## 6. Hallazgos priorizados y causas raíz

Diez hallazgos, con nivel de certeza, impacto y evidencia. "Alto/Medio/
Bajo" aplica a certeza (`C`) e impacto (`I`).

### H1. La entrada cotidiana manda al editor v1 — Alto C, Alto I

- `src/App.tsx:14,31,45`: `/` sin query renderiza `EditorApp` (v1).
- `useSceneStore` sigue siendo consumido por `Layout.tsx`,
  `SceneTree.tsx`, `Inspector.tsx`, `OriginPanel.tsx`, `ProjectActions.tsx`
  (16 archivos).
- Impacto: el usuario necesita conocer la URL `?workspace=bandejas` para
  llegar al flujo real; si inicia desde un favorito viejo entra al editor
  v1 con datos persistidos en IndexedDB que no viajan al workspace v2.
- Causa raíz: no se tomó la decisión explícita de "promover v2 a
  entrada" cuando `UnifiedWorkspace` quedó estable. El v1 no está
  marcado como legacy en la UI.

### H2. Dos "proyecto" viven en paralelo — Alto C, Alto I

- `useSceneStore` (IndexedDB + `projectManager.initProject`) vs.
  `useWorkspaceStore` (sin IndexedDB) +
  `useTrayStore` (motor payload) + `useCatalogConfigStore`
  (localStorage + JSON).
- Impacto: el usuario trabaja en v2 sin autosave transparente. Perder
  cambios por recarga es posible.
- Causa raíz: la migración de dominio entre v1 y v2 quedó incompleta;
  v1 mantuvo su autosave; v2 priorizó portabilidad de archivo.

### H3. Overrides del Configurador se borran al importar JSON sin `catalogConfig` — Medio C, Medio I

- `src/workspace/UnifiedWorkspace.tsx:176`:
  `replaceAll(ws.catalogConfig?.overrides ?? {})`. Al importar un
  archivo viejo sin bloque `catalogConfig`, los overrides locales se
  pierden.
- Impacto: el usuario que calibró un maestro y luego importa un proyecto
  anterior pierde la calibración sin aviso.
- Causa raíz: la semántica "el proyecto manda" está bien, pero no hay
  rescate del estado previo ni aviso antes de sobreescribir.

### H4. Resolución paramétrica tiene dos rutas asimétricas — Medio C, Bajo I (mitigado)

- `ENTRY_BY_SKU` (12 SKUs legacy) vs. `resolveParametricEntryViaMaster`
  (fallback). La asimetría se resolvió en `85137f2`, pero el dispatcher
  dentro de `buildRecipeFromProduct` discrimina por sufijo `.STEP` del
  nombre — frágil si alguna entrada futura no termina así.
- Impacto actual: bajo (todos los legacy terminan en `.STEP`).
- Causa raíz: `ParametricEntry.recipe` cumple dos roles (nombre de
  archivo + `recipeKey` sintética).

### H5. Fallback silencioso de `ala` en `buildRecipeByKey` — Medio C, Medio I

- `src/parametric/geometry/recipes.ts:136-140`: si el producto no trae
  `ala_mm`, asume `65` sin `warnFallback`. `buildRecipeFor` sí avisa.
- Impacto: variante escalera sin `ala` en params se renderiza con `65`
  y el bug queda invisible.
- Causa raíz: la ruta sintética se agregó sin replicar el `warnFallback`
  de la ruta legacy.

### H6. DCPS sigue sin modelo medido — Alto C, Alto I

- `src/configurator/masterModels.ts:343`: master
  `derivacion_pendiente` con `kind='none'` y provenance `estimated`.
- Impacto: el usuario no puede insertar un DCPS real en el workspace.
  Se puede empujar la geometría de TPS como visualización, pero no
  corresponde comercial ni mecánicamente.
- Causa raíz: falta STEP medido de DCPS; distinción TPS/DCPS reconocida
  pero sin geometría del segundo.

### H7. Ala 50 vs 65 — convivencia no autoritativa — Medio C, Bajo I

- `src/parametric/geometry/recipes.ts:81`: fallback 65. Comentarios
  explícitos sobre familia y warn-once.
- En el catálogo paramétrico se decidió usar 50 para SAM-STP-Z
  (`src/parametric/catalog.ts:163`).
- Impacto: hoy baja (el warn ayuda); pero la decisión no está
  consolidada en un documento autoritativo tipo "ala autoritativa por
  familia".

### H8. Experimentales conviven sin aviso — Bajo C, Medio I

- `?pilot=v1`, `?pilot=step`, `?preview=v2`, `?workspace=bandejas-legacy`
  son herramientas internas. Solo `TrayWorkspace.tsx:64` muestra un banner
  explícito.
- Impacto: usuarios que lleguen a esas rutas por error ven algo que no
  es el programa.
- Causa raíz: no se marcaron como "lab" / "interno" en UI.

### H9. Motor tiene campos del contrato 1.0 que el UI no llena — Bajo C, Medio I

- `vendor/motor_bandejas/docs/CONTRATO_INTEGRACION.md` y
  `motor.py` aceptan `circuitos[]`, `soportes[]`, `pe`,
  `equipotencial`, `tapas/accesorios` en `trazado/1`. Hoy el UI sólo
  llena `piezas[]` + `conexiones[]`.
- Impacto: el motor queda sub-utilizado; no se puede obtener un cómputo
  de cables/mangueras aunque el motor lo pueda procesar.
- Causa raíz: la UI no tiene aún edición de circuitos.

### H10. Tests E2E flakean por orden en single-worker — Bajo C, Bajo I

- Verificado con `git stash` + re-ejecución: el mismo conjunto falla
  igual antes de cambios recientes. Con `--workers=2`: 31/31.
- Impacto: riesgo de confiar en fallos que no son del cambio en curso.
- Causa raíz: estado global de `window.__codex` entre tests y/o
  `localStorage` no limpiado entre pares concretos.

## 7. Propuesta de consolidación y limpieza (sin borrar en esta entrega)

Clasificación módulo a módulo en `module-disposition.csv`. Resumen:

### 7.1 Conservar como está

- `vendor/motor_bandejas` (contrato 1.0, fórmulas documentadas).
- `src/workspace/parametricBridge.ts` (pipeline unificado preview=confirmado).
- `src/workspace/catalogPortMapping.ts` (mapping explícito + overrides).
- `src/configurator/masterModels.ts` y `masterVariants.ts` (maestros + regla).
- `src/parametric/geometry/outlines.ts` + `escaleraRecipes.ts`
  (polígonos medidos).
- `src/workspace/workspaceFile.ts` (JSON v1 con `catalogConfig`).
- `src/tray/client.ts` + `src/tray/store.ts` + `src/tray/model.ts`.

### 7.2 Unificar (cambio controlado, no reescribir)

- Consolidar stores de "proyecto" bajo un mismo ciclo de vida:
  `useWorkspaceStore` + `useTrayStore` + `useCatalogConfigStore` →
  un "projectStore" compuesto. Hoy ya están sincronizados al importar
  en `UnifiedWorkspace.tsx:168-176`, pero no al editar.
- Promover `/` a `UnifiedWorkspace` y mover `EditorApp` detrás de una
  query explícita (`?legacy=v1`). Conservar IndexedDB y la migración.

### 7.3 Adaptar

- `src/preview/*` (vistas v2) → convertir en pestañas internas del
  workspace o en herramienta de "muestra" bajo `?lab=preview`.
- `src/pilot/*` (piezas de prueba) → documentar como "banco de pruebas
  geométricas" bajo `?lab=pilot-v1`.
- `src/parametric/ParametricLayout.tsx` (`?pilot=step`) → mantener,
  documentar que es inspector de la biblioteca paramétrica.

### 7.4 Retirar del flujo activo, conservar como herramienta

- `src/tray/TrayWorkspace.tsx` (`?workspace=bandejas-legacy`): ya tiene
  banner; añadir enlace a la vista nueva y marcar como "obsoleta
  para consulta".

### 7.5 Eliminar en fase posterior (solo con dependencias demostradas)

- `src/store/sceneStore.ts` únicamente cuando `/legacy=v1` deje de ser
  necesario y la migración de IndexedDB → v2 esté completa y validada.
  **No eliminar en esta entrega.**

### 7.6 Posponer

- Decisión de framework CAD para civil (Three.js + utilidades propias
  vs. otra librería). No cambiar motor gráfico sin prototipo validable.
- Reestructuración de documentación en `docs/design-history/`. Los
  documentos `51bf02d-*.md` quedan como historia.

### 7.7 Protecciones obligatorias en cada cambio propuesto

- Migración: cualquier cambio en formato de archivo del proyecto debe
  venir con lector de versión anterior y mensaje al usuario.
- Reversión: branch por entrega; no operar sobre `main`.
- Conservación de calibraciones del Configurador: cualquier esquema
  nuevo debe conservar `codex:catalogConfig:v1`.
- `useCalibrationStore` tiene `isStale` y `source_version`
  (`useCalibrationStore.ts:241`); conservar.

## 8. Plan integrado de ejecución

Secuencia AHORA / PRÓXIMO / FUTURO. Cada entrega lleva: problema,
alcance, exclusiones, dependencias, módulos tocados, conservación,
aceptación E2E, reversión, prueba manual breve.

### 8.1 AHORA — "primera estabilización" (semanas 1–3)

#### Entrega E1: entrada única `/` = workspace productivo

- **Problema:** El usuario entra al editor v1 por accidente; pierde
  horas en una ruta equivocada.
- **Alcance:** mover `/` a `UnifiedWorkspace`. Mover `EditorApp`
  (v1) a `?legacy=v1`. Mantener auto-persistencia de IndexedDB bajo
  esa ruta.
- **Exclusiones:** nuevas features; migración de datos v1 → v2
  (otra entrega).
- **Dependencias:** ninguna.
- **Módulos:** `src/App.tsx:28` (único cambio real).
- **Conservación:** proyectos v1 siguen abriéndose desde `?legacy=v1`;
  datos en IndexedDB intactos.
- **Aceptación:** abrir `/` → UnifiedWorkspace; abrir `?legacy=v1` →
  Layout v1 con autosave; recarga preserva sesión v1.
- **Reversión:** revertir App.tsx.
- **Prueba manual:** 1) `/`, 2) `?legacy=v1` desde un proyecto v1
  previo, 3) `?workspace=bandejas` (redundante, se conserva compat).

#### Entrega E2: autosave transparente en v2 (reusa IndexedDB)

- **Problema:** v2 depende de exportación manual.
- **Alcance:** autosave debounced de `useWorkspaceStore` + `useTrayStore`
  en IndexedDB. Reutilizar `src/persistence/db.ts`.
- **Exclusiones:** sincronización remota, multi-proyecto; migración
  de v1 a v2 (planteada en E3).
- **Dependencias:** E1.
- **Módulos:** `src/workspace/useWorkspaceStore.ts`,
  `src/persistence/db.ts`, `src/persistence/projectManager.ts`,
  `src/workspace/UnifiedWorkspace.tsx`.
- **Conservación:** el JSON de proyecto sigue siendo el "único archivo
  compartible". IndexedDB = cache local.
- **Aceptación:** mutar workspace → recargar → recupera. Botón
  "Exportar JSON" produce archivo byte-equivalente al roundtrip
  export→reload→import de `entregaFinalUserChain`.
- **Reversión:** feature flag `codex.autosave.v2 = off`.
- **Prueba manual:** importar JSON del usuario, mover una pieza,
  cerrar pestaña, abrir — debe recuperar.

#### Entrega E3: migración v1 → v2 one-shot

- **Problema:** Datos en IndexedDB v1 no están disponibles en v2.
- **Alcance:** leer un proyecto v1 de IndexedDB y traducir a
  `WorkspaceFileV1` (esquema actual). Un sólo paso, con backup.
- **Exclusiones:** autosave; UI de selección de proyecto (otra entrega).
- **Dependencias:** E1 + E2.
- **Módulos:** nuevo `src/persistence/migrateV1ToV2.ts`,
  `src/App.tsx` (prompt al abrir `/`).
- **Conservación:** backup del snapshot v1 antes de traducir; `?legacy=v1`
  sigue abriéndose contra IndexedDB v1.
- **Aceptación:** abrir `/` sobre PC con proyecto v1 → aparece
  prompt "importar v1"; aceptar → todos los objetos v1 visibles en v2.
- **Reversión:** eliminar el prompt; v1 no se mueve.
- **Prueba manual:** poner un proyecto v1, abrir /, importar, verificar.

#### Entrega E4: BOM mínimo desde el trazado actual

- **Problema:** usuario no percibe valor sin lista de materiales.
- **Alcance:** BOM por `producto_id` × cantidad, agrupado por SKU y
  tipo; desglose de totales (longitud instalada, longitud comercial
  pedida). PDF o descarga JSON/CSV.
- **Exclusiones:** precios, ERP, planos, cables, soportes.
- **Dependencias:** ninguna.
- **Módulos:** nuevo `src/workspace/bom/*`, boton en `UnifiedWorkspace`.
- **Conservación:** no toca motor ni catálogo.
- **Aceptación:** JSON real del usuario → BOM muestra las 7 piezas
  con sus SKUs y cantidades.
- **Reversión:** ocultar botón.
- **Prueba manual:** importar fixture, ver BOM, exportar CSV.

### 8.2 PRÓXIMO — "dominio del proyecto" (semanas 4–8)

#### Entrega N1: importación de equipamiento (Excel + edición)

- **Alcance:** pestaña de Proyecto → equipos + conexiones. Importa
  Excel (equivalente a `ELS-SYC_Excel_General_Tecnico_RevB.xlsx` cuando
  esté disponible) o entrada manual.
- **Exclusiones:** civil 3D; posicionamiento por arrastre; cableado.
- **Dependencias:** dato autoritativo del Excel del usuario; si no
  está, usar entidad de dominio v2 ya tipada (`EquipmentElement`,
  `FieldEvidence`).
- **Aceptación:** escenario integrado (A/B/C/D) representado como
  equipos y conexiones pendientes.

#### Entrega N2: posicionamiento visual del equipamiento

- **Alcance:** arrastrar equipo en planta; edición numérica XYZ;
  vistas frontal/sup/iso; simbología IEC básica para motores/sensores.
- **Exclusiones:** extrusión civil (paredes/columnas); mostrado de
  cables.

#### Entrega N3: bajadas con longitud efectiva separada

- **Alcance:** modelar bajada con `longitud_geometrica` y
  `longitud_manual` (override), `modo auto/manual`, `longitud_efectiva`
  (no sumativa). Mostrar las dos.
- **Exclusiones:** cómputo de cables global (N4).
- **Aceptación:** dibujar enlace 1 m, override 2 m, verificar en
  BOM/dato de tendido que efectivo = 2 m, no 3 m.

#### Entrega N4: cableado mínimo (asignación de tendidos)

- **Alcance:** pestaña conexiones pendientes; seleccionar origen
  equipo, destino equipo, elegir red de bandejas, confirmar.
- **Exclusiones:** separación por servicio; ocupación detallada; neumática.

### 8.3 FUTURO — "ingeniería completa" (semanas 9+)

- F1: civil 2D/3D con DXF import + extrusión de paredes/columnas.
- F2: ocupación con criterio explícito + separación por servicios.
- F3: cambio de ancho por grupo con conservación de recorridos.
- F4: soportes distribuidos (offsets + reparto simétrico + corrida
  10500 mm).
- F5: planos por vista/ventana + PDF multipágina.
- F6: consulta móvil + seguimiento de montaje.
- F7: neumática plena (mangueras, manifolds, actuadores).
- F8: adaptador explícito motor v2: pasar `circuitos[]`, `soportes[]`,
  `pe` a `/v1/calcular` cuando corresponda; ignorar en motor viejo.

### 8.4 Escenarios de aceptación del plan

Los 10 del §7 del prompt se mapean a entregas:

| # | Escenario | Entrega que lo cubre |
|---|-----------|----------------------|
| 1 | Excel → equipos/conexiones | N1 |
| 2 | Civil básico → posicionar equipo → vistas/capas | N2 + F1 |
| 3 | Maestro configurado → variante → preview → confirmado → guardar/recuperar | Ya existente (TRPS 300→450, TRES 300→450+ala) |
| 4 | Recto → curva → recto; T/X y continuidad por todas las salidas | Ya existente |
| 5 | DCPS sobre tramo físico sin corte ni duplicación | **Pendiente: STEP medido** (bloqueo H6) |
| 6 | A–B con bajadas (dibujo 1 m, cómputo 2 m), recorrido por accesorios | N3 + N4 |
| 7 | A–C y A–D comparten principal; manguera desde D inversa | N4 + F7 |
| 8 | Ocupación/servicios → sustitución de ancho por grupo | F2 + F3 |
| 9 | Corrida 10500 mm → soportes por offsets y reparto | F4 |
| 10 | BOM, planos por vista, consulta móvil | E4 (BOM) + F5 + F6 |

## 9. Decisiones pendientes estrictamente necesarias

Lista corta de lo que depende del usuario. Recomendación y efecto.

1. **¿Dónde vive `ELS-SYC_Excel_General_Tecnico_RevB.xlsx`?**
   Recomendación: copiar a `vendor/user-data/` o anexar como adjunto del
   proyecto. Efecto: habilita N1 sin inventar schema.

2. **`/` default: `UnifiedWorkspace` o `EditorApp`?**
   Recomendación: `UnifiedWorkspace`. Efecto: H1 resuelto. Legacy queda
   bajo `?legacy=v1`.

3. **Autosave v2: ¿sólo local (IndexedDB) o también cloud?**
   Recomendación: solo local en esta fase. Cloud es decisión posterior
   con autenticación. Efecto: E2 no requiere backend.

4. **DCPS: ¿esperar STEP medido, o aceptar "forma TPS" documentada como
   aproximación?**
   Recomendación: documentar como "visualización aproximada con nota" y
   bloquear cómputo hasta STEP medido. Efecto: evitar prometer una
   geometría que no es la del fabricante.

5. **¿Cómo debe presentarse a los usuarios finales la app? URL única,
   iconos distintos, etc.**
   Recomendación: URL única con pestañas internas (§4.2). Efecto: mapa
   mental único.

6. **Ala autoritativa por familia (50 vs 65):** ¿consolidar en un
   documento `docs/strategy/geometry-authority.md` o en un enum tipado?
   Recomendación: un pequeño módulo de constantes tipadas por `familia_id`
   + doc apuntando al Excel SAMET. Efecto: H7 resuelto con fuente única.

## 10. Protocolo de trabajo futuro

Reglas que reducen el ciclo "parche → regresión".

- **Una rama por entrega**, con objetivo funcional completo y criterio
  de aceptación E2E en el mismo PR. Evitar PRs que "arreglan y además
  refactorizan".
- **Autorrevisión antes de pedir revisión**: typecheck + vitest + build
  + playwright del scope de la entrega. Si una prueba E2E no cabe,
  describir la limitación en el PR.
- **Demo real en browser** antes de marcar entrega como terminada. Si
  es UI, grabar o capturar la ruta efectiva. Si es dominio puro, incluir
  un test que lo demuestre.
- **Reporte honesto de fallos**: cuando un test externo a la entrega
  falla, verificar si es pre-existente (`git stash` + re-ejecución) y
  reportarlo como tal en el PR.
- **Revisión externa cuando:** se cambia un contrato (motor, archivo de
  proyecto, catálogo), se promueve una experimental a producción, o se
  altera la entrada cotidiana. El resto puede cerrarlo el implementador.
- **No auditar cada commit** por defecto. Se audita por entrega y
  cuando el usuario reporta divergencia.
- **Nunca `--amend` sobre commit publicado, nunca `--force` a `main`.**
- **Fuentes del usuario son solo-lectura**: `Libreria CAD 2021`,
  Excels originales, STEP aportados. Copiar antes de modificar.

## 11. Cierre de esta entrega

- **Rama entregable**: `docs/strategic-audit-handoff-work` (sobre
  `origin/docs/strategic-audit-handoff` en `047484c`).
- **Commit de entrega**: ver el último commit de esta rama.
- **Archivos añadidos** por esta auditoría:
  - `docs/strategy/INTEGRATED-AUDIT-AND-EXECUTION-PLAN.md` (este doc).
  - `docs/strategy/requirements-traceability.csv`.
  - `docs/strategy/module-disposition.csv`.
  - `docs/strategy/source-inventory.csv`.
- **Evidencia efectivamente consultada**:
  - Estado git: `git log`, `git branch -a`, `git status`.
  - Rutas y stores: `src/App.tsx`, `src/workspace/*`,
    `src/configurator/*`, `src/parametric/*`, `src/store/*`,
    `src/persistence/*`, `src/tray/*`, `src/preview/*`, `src/pilot/*`.
  - Motor: `vendor/motor_bandejas/motor_bandejas/servicio.py`,
    `calculos.py`, `soportes.py`, `README.md`, `CHANGELOG.md`.
  - Fuentes: `vendor/motor_bandejas/datos/catalogo/`,
    `artifacts/parametric/`, `public/parametric/`, `e2e/fixtures/`.
  - Externo: listado de `C:\Users\Usuario\Downloads\Libreria CAD 2021`,
    inspección top-level de `C:\Users\Usuario\Proyectos\cad-catalog-analysis`.
  - Pruebas: últimas ejecuciones vitest (977/977) y Playwright
    (31/31 a dos workers; flakiness pre-existente a worker único
    verificada con `git stash`).
- **Bloqueos**:
  - `ELS-SYC_Excel_General_Tecnico_RevB.xlsx` no está en el repo ni en
    las rutas estándar inspeccionadas. Localización requiere el usuario.
  - Prototipo UX v0 (`https://prototipo-cad-industrial.v0.build/`)
    no se consultó: fuera del scope de lectura local.
  - cad-catalog-analysis existe fuera del repo; para el piloto DWG→DXF
    (tarea paralela planteada por el usuario) hace falta o bien instalar
    ODA File Converter (download oficial:
    `https://www.opendesign.com/guestfiles/oda_file_converter`, versión
    25.x en noviembre 2026; instalación: ejecutable firmado por ODA;
    alternativa: AutoCAD u otro visor compatible). Esa tarea se trata
    como paralela y no bloquea este informe.

- **Decisiones pendientes** (ver §9): seis, con recomendación y efecto.
- **Primer objetivo de implementación recomendado**: Entrega E1 —
  promover `/` a `UnifiedWorkspace`, mover v1 a `?legacy=v1`. Es un
  cambio mínimo (`src/App.tsx:28`) con efecto grande en la experiencia
  cotidiana y sin riesgo de pérdida de datos. **No se implementa en
  esta entrega.**

Fin del documento.
