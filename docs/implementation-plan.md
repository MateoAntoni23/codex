# Plan de implementación — Diseñador de Bandejas Portacables 3D

> **Estado del documento:** activo  
> **Última actualización:** 2026-11-04  
> **Referencia:** `docs/product-requirements.md`

---

## Entregas completadas en la rama `feat/domain-v2-contracts`

| Entrega | Commit | Tests | Descripción |
|---|---|---|---|
| M1a-base | `1eab3f6` | 216 | Contratos v2, validador inicial, migrador puro (20+1 test cases) |
| M1a-audit | *(ver SHA de este commit)* | 242 | Auditoría completa: +26 casos de prueba, corrección de 2 bugs confirmados |

**Bugs corregidos en la auditoría:**
1. `validateProjectDataV2` aceptaba cables con `ends[i].portId` apuntando a puertos inexistentes → corregido.
2. `validateProjectDataV2` aceptaba `efficiency.value = 2` en motores → corregido (rango `(0, 1]`).

**Nuevas invariantes de validación activadas (validate-v2.ts):**
- **Datum coherencia:** `status='unknown'` → `value` debe ser null; `status ∈ {estimated,provided,verified}` → `value` no puede ser null.
- **Motor:** `efficiency.value ∈ (0, 1]`; `powerFactor.value ∈ (0, 1]` cuando no es null.
- **Sensor:** `range.min ≤ range.max` cuando `value` conocido.
- **Puerto:** `localDirection` no puede ser el vector cero; `pinCount` entero positivo cuando no es null.
- **Cable:** `coreCount` entero positivo; `sectionMm2`, `outerDiameterMm`, `minBendRadiusMm` positivos cuando conocidos.
- **Manguera:** `innerDiameterMm < outerDiameterMm` cuando ambos conocidos; `workingPressureBar` positivo cuando conocido.
- **Endpoints de conexión:** todos los `{kind:'port'}` verifican existencia del puerto referenciado y compatibilidad de medium.
- **InternalLink:** `conductive` → ambos extremos eléctricos; `passage` → ambos no-eléctricos del mismo medium.
- **physicalLocation:** `factoryId` y `subareaId` verifican existencia; `subareaId` debe pertenecer al `factoryId` declarado.
- **ElementService:** no se permiten pares `(elementId, factoryId)` duplicados.
- **FieldEvidence:** `elementOrConnectionId` debe referenciar un elemento o conexión existente.
- **MigrationIncident:** `elementId` debe referenciar un elemento existente.
- **Datum evidenceIds:** todos los IDs referenciados en Datum deben existir en `evidence[]`.

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
- **242 pruebas** distribuidas en 12 archivos de test.
- Unitarias: conversión de coordenadas, validación v1/v2, migración v1→v2, IndexedDB (fake-indexeddb).
- Integración: store Zustand, auto-save con timers simulados, identidad de sesión.
- Interacción (jsdom): Inspector, OriginPanel, ProjectActions, SceneTree.
- v2 test breakdown: 44 casos en `validate-v2.test.ts`; 21 casos en `migrate-v1-to-v2.test.ts`.

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
