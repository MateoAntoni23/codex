# Plan de implementación — Diseñador de Bandejas Portacables 3D

> **Estado del documento:** activo  
> **Última actualización:** 2026-11-04  
> **Referencia:** `docs/product-requirements.md`

---

## Estado actual del proyecto

### Rama principal auditada: `feat/project-save-load`
Commit más reciente: `04f6139` (correcciones de persistencia post-auditoría)

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

### Cobertura de pruebas actual
- **121 pruebas** distribuidas en 9 archivos de test.
- Unitarias: conversión de coordenadas, validación, IndexedDB (fake-indexeddb).
- Integración: store Zustand, auto-save con timers simulados.
- Interacción (jsdom): Inspector, OriginPanel, ProjectActions.

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

> Las fases A–F se corresponden con los requisitos nuevos de
> `docs/product-requirements.md`. El orden puede revisarse.

### Fase A — Árbol de elementos por categorías 📋

**Objetivo:** reemplazar la lista plana por un árbol jerárquico con
categorías contraíbles y conteo de elementos.

**Alcance:**
- Categorías: Tableros, Motores, Bombas, Válvulas, Sensores, Iluminación,
  Botoneras, Infraestructura.
- Conteo de elementos por categoría.
- Selección sincronizada con visor e inspector (sin cambios en el store).
- El campo `type` del `DomainObject` mapea a la categoría correspondiente.

**No incluye en esta fase:** búsqueda por nombre/etiqueta, categorías
anidadas, drag-and-drop.

**Archivos clave:** `src/ui/SceneTree.tsx`, `src/types/domain.ts`,
`src/styles/global.css`.

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

## Lo que NO se implementará en estas fases

- Backend, autenticación ni sincronización en la nube.
- Importación/exportación DXF.
- Cálculo eléctrico (caída de tensión, selección de sección).
- Cálculo neumático (pérdida de carga, selección de compresor).
- Conformidad normativa certificada.
