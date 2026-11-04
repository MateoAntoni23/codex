# Plan de implementación — Diseñador de Bandejas Portacables 3D

> **Estado del documento:** activo  
> **Última actualización:** 2026-11-04  
> **Referencia:** `docs/product-requirements.md`

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
| A  | Árbol de escena por categorías contraíbles con contadores | rama activa |

### Cobertura de pruebas actual
- **177 pruebas** distribuidas en 10 archivos de test.
- Unitarias: conversión de coordenadas, validación, IndexedDB (fake-indexeddb).
- Integración: store Zustand, auto-save con timers simulados, identidad de sesión.
- Interacción (jsdom): Inspector, OriginPanel, ProjectActions, SceneTree.

---

## Principios para las próximas fases

1. **Un commit por sprint**, tipificado (`feat`, `fix`, `refactor`).
2. **No mezclar funciones de modelado con correcciones de guardado.**
3. **No agregar dependencias de producción sin justificación explícita.**
4. **Separar commit de corrección del commit de documentación.**
5. **Cada entrega: pruebas, typecheck y build deben pasar.**
6. **Sin backend, cuentas ni sincronización en la nube en el alcance actual.**

---

## Próximas fases planificadas

### Prioridad actual: modelo transversal de equipos (solo documentación)

Diseño: [equipment-domain-model.md](equipment-domain-model.md).
La secuencia M1–M7 de ese documento reemplaza el orden de implementación
inmediato de A.1/B/C/D; conserva A–F como referencia de alcance histórico.
En particular, no limitar la ficha ni las dimensiones editables a motores,
tablero y nave. Incluir tableros neumáticos, componentes internos y actuadores.

1. Revisar contratos e invariantes; sin cambios de código en esta entrega.
2. M1: validación y migración con respaldo de schemaVersion=1.
3. M2: organización de fábricas, FM y equipos compartidos sin duplicación.
4. M3: ficha común y operaciones de elementos con campos por categoría.
5. M4: geometría editable, anclajes y composición con coordenadas locales.
6. M5: puertos, cables, mangueras y relaciones funcionales.
7. M6: simulación de importación XLSX con vista previa y trazabilidad.
8. M7: integración con bandejas, validaciones, BOM y campo.

Anclaje propuesto: centro de base para equipos de piso/nave, centro de cara
posterior para gabinete de pared y centro para componentes internos. Puertos
locales y de cara se distinguen. Estas decisiones son propuestas revisables;
no requieren pedir datos al usuario para completar esta documentación.

Se preservan las fases futuras de DXF/DWG, accesorios y catálogo de bandejas,
ruteo, PDF/BOM, PWA y backend. Ninguna de estas funciones está implementada
por la presente entrega documental.

> Las fases A–F se corresponden con los requisitos nuevos de
> `docs/product-requirements.md`. El orden puede revisarse.

### Fase A — Árbol de elementos por categorías ✅

**Objetivo:** reemplazar la lista plana por un árbol jerárquico con
categorías contraíbles y conteo de elementos.

**Alcance implementado:**
- 8 categorías: Tableros, Motores, Bombas, Válvulas, Sensores, Iluminación,
  Botoneras, Infraestructura.
- Piso y Nave Industrial agrupados en Infraestructura.
- Conteo de elementos por categoría (incluye cero).
- Categorías con elementos abiertas al iniciar; vacías, cerradas.
- Contraer una categoría no deselecciona el objeto activo.
- Selección sincronizada con visor e inspector (sin cambios en el store).
- Accesibilidad: `aria-expanded` en botones de cabecera, `tabIndex={0}`
  en items seleccionables, `onKeyDown` para Enter/Space, `:focus-visible`.
- El estado expandido/contraído es UI-only: no modifica objetos, origen
  ni dispara guardado automático.
- 20 pruebas de interacción (jsdom).

**No incluye:** búsqueda por nombre/etiqueta, jerarquía de fábricas,
drag-and-drop.

**Archivos modificados:** `src/ui/SceneTree.tsx`, `src/styles/global.css`,
`src/ui/__tests__/SceneTree.interaction.test.tsx`.

---

### Fase A.1 — Jerarquía fábrica → categoría → equipo 📋

> **Decisiones confirmadas por el usuario (2026-11-04):**
>
> - **Tres fábricas:** Secado (códigos SEC / S1), Evaporador A (EVA / EA),
>   Evaporador B (EVB / EB).
> - **Filtro de manga (FM):** subárea de Secado. No es una cuarta fábrica
>   ni un alcance excluido; debe conservar su identificación como subárea.
> - **TAB-B:** tablero único que atiende a ambos evaporadores. No crear dos
>   objetos para representarlo; la asociación con múltiples evaporadores se
>   modela como atributo de relación, no como duplicación de objetos.
> - **Ubicación física ≠ fábricas atendidas:** no inferir la ubicación física
>   de un tablero por sus asociaciones lógicas.
> - **Sin asignación arbitraria:** los objetos de ejemplo (panel-1, motor-1,
>   etc.) no deben asignarse a ninguna fábrica hasta que el usuario lo indique
>   explícitamente.

**Jerarquía prevista:**

```
Fábrica (Secado | Evaporador A | Evaporador B)
  └── Subárea (opcional, p. ej. Filtro de Manga en Secado)
        └── Categoría (Tableros | Motores | Bombas | …)
              └── Equipo (DomainObject con id, name, type, position, …)
```

**Asociaciones compartidas (p. ej. TAB-B):**
- Un equipo puede estar asociado a más de una fábrica sin duplicarse.
- La asociación se modela como relación `{equipoId, fabricaId}` fuera del
  objeto mismo; no se duplica el `DomainObject`.

**Restricciones de esta fase:**
- No modificar el formato JSON persistido hasta que se audite el modelo.
- No implementar importación desde Excel todavía.
- No asignar los objetos de ejemplo a fábricas arbitrariamente.

**Prerequisito para implementar:** auditoría del modelo de datos con el
usuario antes de agregar `fabricaId` al esquema.

---

### Fase B — Dimensiones editables de tablero y nave 📋

**Objetivo:** permitir editar ancho, profundidad y altura del tablero y la
nave directamente desde el inspector.

**Decisiones de diseño a tomar antes de implementar:**
- ¿Qué punto permanece fijo al redimensionar? (propuesta: el punto inferior
  central de la base, equivalente a mantener `position.x`, `position.y` y
  `position.z - height/2` constantes).
- Redimensionar **no mueve ni escala** los objetos interiores.
- Validación: dimensiones positivas (y `height=0` solo para `floor`).

**Alcance:**
- Nuevas acciones en el store: `updateObjectDimensions`.
- Formulario en el inspector similar al de posición.
- Actualización del campo `dimensions` en `DomainObject`.

**No incluye:** modo de montaje (piso/pared) del tablero, puertos.

---

### Fase C — Catálogo básico y etiquetas de equipos 📋

**Objetivo:** separar categoría del equipo, geometría 3D y datos técnicos.
Agregar etiqueta configurable visible en el visor.

**Alcance:**
- Nuevos tipos: `pump`, `valve`, `sensor`, `luminaire`, `pushbutton`.
- Geometría 3D simplificada y reconocible para cada tipo (caja con icono).
- Etiqueta configurable visible sobre el objeto en el visor (`Html` de drei).
- La identificación nunca depende únicamente del color.
- Propiedades técnicas básicas por categoría (a definir por tipo).
- Separación clara en `domain.ts`: `ObjectType` (categoría), `DomainObject`
  (datos), geometría (scene components).

**Requisitos previos:** Fase A (árbol por categorías).

**Consideración normativa:**
- Iconos y geometrías son representaciones propias; no se afirma conformidad
  con IEC 60617 ni ISO 1219.
- Los símbolos deben usar recursos con licencia adecuada.

---

### Fase D — Puertos de conexión 📋

**Objetivo:** agregar puntos de conexión a los objetos del catálogo.

**Alcance:**
- Tipo `Port` en el dominio: posición relativa al centro del equipo,
  medio compatible (eléctrico, neumático, hidráulico).
- Visualización de puertos en el visor (esfera pequeña).
- El inspector permite ver los puertos disponibles (solo lectura inicialmente).

**No incluye en esta fase:** conexión de cables/mangueras entre puertos.

---

### Fase E — Bandejas y recorridos 📋

**Objetivo:** modelar bandejas portacables como entidades del dominio con
trayectoria y propiedades físicas.

**Alcance:**
- Tipo `CableTray` en el dominio: puntos de trayectoria, ancho, alto,
  material.
- Visualización 3D simplificada (extrusión a lo largo de la trayectoria).
- Distinción entre "compartir corredor" y "compartir la misma bandeja".
- Prever compartimentos y reglas de compatibilidad.

---

### Fase F — Cables, mangueras, asignación y validaciones 📋

**Objetivo:** modelar cables y mangueras como entidades propias, asignarlos
a bandejas y calcular ocupación y metraje.

**Cables:**
- Tipo, sección, tensión, número de conductores, origen, destino.

**Mangueras:**
- Diámetro exterior/interior, material, presión de trabajo, radio mínimo,
  origen, destino.

**Validaciones:**
- Ocupación física: considera diámetro exterior y carga si están disponibles.
- Si falta un dato necesario: estado "pendiente de validación", no "válido".
- BOM y checklist distinguen cables de mangueras.
- No se asume que compartir bandeja está siempre permitido.

**No incluye:** cálculo de caída de tensión, selección automática de sección.

---

## Decisiones pendientes (requieren alineación antes de implementar)

| Tema | Pregunta abierta |
|---|---|
| Redimensionar nave/tablero | ¿Qué punto geométrico permanece fijo? |
| Puertos | ¿Coordenadas relativas al centro o a la cara? |
| Símbolos/iconos | ¿Qué fuente con licencia adecuada se usará? |
| Catálogo externo | ¿Los equipos se definen solo en código o hay un archivo de configuración? |
| Validación de recorridos | ¿Qué reglas de compatibilidad aplican en el contexto específico del proyecto? |

---

## Lo que NO se implementará en las fases A–F
> Estas funcionalidades están previstas para etapas futuras; no se
> eliminan del plan general.

- Backend, autenticación ni sincronización en la nube.
- Importación/exportación DXF (formato de intercambio CAD).
- Exportación de reportes en PDF y listas de materiales (BOM) imprimibles.
- Aplicación web progresiva (PWA) para uso sin conexión en campo.
- Cálculo eléctrico (caída de tensión, selección de sección).
- Cálculo neumático (pérdida de carga, selección de compresor).
- Conformidad normativa certificada.
