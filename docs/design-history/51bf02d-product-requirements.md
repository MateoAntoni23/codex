> Propuesta histórica preservada del commit 51bf02d. No implementar como contrato vigente.
> Referencia vigente: ../equipment-domain-model.md y plan M1–M7.

# Requisitos del producto — Diseñador de Bandejas Portacables 3D

> **Estado del documento:** activo
> **Última actualización:** 2026-11-04
> **Convención de estado:** ✅ Implementado · 🔧 En corrección · 📋 Planificado

---

## Descripción general

Aplicación web para diseñar instalaciones industriales con bandejas
portacables. El diseñador trabaja en milímetros con eje Z vertical,
visualiza la instalación en 3D y puede exportar el proyecto como JSON.
El guardado local ocurre automáticamente en el navegador del usuario.

---

## Funcionalidades implementadas

### Visor 3D interactivo ✅
- Renderizado con React Three Fiber y Three.js.
- Cámara orbital: orbitar, zoom y desplazamiento.
- Iluminación ambiental y direccional con sombras.
- Piso con grilla de referencia (escala en metros).

### Escena base ✅
- Piso (`floor`): plano de referencia.
- Nave industrial (`building`): estructura en wireframe con dimensiones fijas.
- Tablero eléctrico (`panel`): objeto 3D seleccionable.
- Motor eléctrico (`motor`): objeto 3D seleccionable.
- Todos los objetos se apoyan sobre el piso (`position.z = height / 2`).

### Árbol de escena por categorías ✅
- 8 categorías contraíbles: Tableros, Motores, Bombas, Válvulas, Sensores,
  Iluminación, Botoneras, Infraestructura.
- Piso y Nave Industrial agrupados en Infraestructura.
- Contador de elementos por categoría (incluye cero).
- Categorías con elementos abiertas al iniciar; vacías, cerradas.
- Selección sincronizada con el visor y el inspector.
- Contraer una categoría no deselecciona el objeto activo.
- Accesible por teclado: `aria-expanded`, Enter/Space, foco visible.
- El estado expandido/contraído es UI-only: no modifica datos ni dispara
  guardado automático.
- Deselección al hacer clic en el fondo del visor.

### Inspector de propiedades ✅
- Dimensiones (solo lectura) para todos los tipos.
- Editor de posición X/Y/Z (en mm) para tablero y motor.
- Validación: rechaza campos vacíos, no numéricos e infinitos.
- Botón "Apoyar en piso": calcula Z global = `height / 2`.
- Botones Aplicar y Cancelar.
- Posiciones mostradas en coordenadas relativas al origen del proyecto.

### Origen del proyecto ✅
- Sección en el panel izquierdo para definir un origen arbitrario.
- Las coordenadas del inspector son relativas al origen (`global − origen`).
- Aplicar traslada el origen; los objetos no se mueven.
- Botones: Aplicar, Cancelar, Restablecer (`{0, 0, 0}`) y "Usar centro
  del objeto seleccionado".
- Marcador 3D de los tres ejes (X rojo, Y verde, Z azul) en el origen.
- El snap-to-floor compensa el origen Z (`Z_mostrado = height/2 − origen.z`).

### Guardado local automático (IndexedDB) 🔧
- El proyecto se guarda automáticamente tras 1 segundo de inactividad.
- Al recargar la página se recupera el último estado guardado.
- El guardado local pertenece al navegador del usuario; no requiere cuenta.
- Indicador de estado: Cargando / Guardando / Guardado localmente / Error.

### Exportación e importación JSON 🔧
- Exportar: descarga el proyecto como archivo `.json` con fecha.
- Importar: valida el archivo antes de reemplazar el proyecto; pide
  confirmación; un archivo inválido no altera el proyecto existente.
- El formato incluye `schemaVersion`, `objects` y `projectOrigin` (en mm
  respecto del sistema global).
- Validación completa: versión de esquema, tipos conocidos, IDs únicos,
  números finitos, dimensiones positivas (height=0 permitido solo en floor).

### Restablecer escena de ejemplo ✅
- Vuelve a los objetos por defecto con confirmación previa.

---

## Requisitos nuevos — pendientes de implementación

> Los requisitos de esta sección se documentan para orientar el diseño
> futuro. **No están implementados en la versión actual.**

### 1. Modelo de dominio extendido 📋

> Ver `docs/equipment-domain-model.md` para el diseño completo del modelo.

Todos los equipos comparten una **base común** con: ID estable, TAG único,
nombre, categoría, condición (existente/nuevo), estado de confirmación,
posición, orientación, geometría, puertos, datos técnicos, organización
(fábricas/subáreas) y procedencia.

**Categorías previstas (10):**
tablero eléctrico, tablero neumático, motor, bomba, sensor, válvula de
proceso, electroválvula, actuador, luminaria, botonera.

Cada categoría tiene su propia ficha técnica (ver sección 5 del modelo).
Los valores desconocidos se representan como `null`, nunca como `0`.

**Dimensiones editables** para todos los elementos, con forma (caja o
cilindro) y punto de anclaje al redimensionar.

**Composición:** un tablero neumático contiene electroválvulas y manifold.
Las posiciones de los hijos son locales respecto del padre. No se permiten
ciclos. Los hijos no se escalan automáticamente al redimensionar el contenedor.

**Conexiones** como entidades propias: cables (tablero eléctrico → componentes)
y mangueras (electroválvula → actuador). Un actuador de doble efecto requiere
dos mangueras. Los puertos eléctricos y neumáticos son incompatibles.

### 2. Organización 📋

Ver sección 8 de este documento (Jerarquía de fábricas y subáreas).

### 3. Normas, símbolos y representación gráfica 📋

> **Aclaración importante sobre conformidad normativa:**
> Las referencias a normas IEC 60617 e ISO 1219 sirven como guía de
> simbología para diagramas eléctricos y neumáticos
> respectivamente. **Estas normas no definen geometrías 3D universales.**
> Usar un icono o forma inspirada en una norma **no equivale a declarar
> conformidad normativa.** No se afirmará conformidad a ninguna norma sin
> una evaluación técnica y legal específica.

- **IEC 60617**: referencia para símbolos de diagramas eléctricos.
- **ISO 1219**: referencia para diagramas neumáticos/hidráulicos.
- Los símbolos utilizados en la aplicación deben provenir de recursos con
  licencia adecuada para uso comercial. **No se descargará ni incorporará
  ninguna biblioteca de símbolos en la etapa actual.**
### 4. Nave industrial con dimensiones editables 📋

- Dimensiones editables: ancho, largo y altura de la nave.
- **Punto de anclaje fijo al redimensionar:** a definir antes de implementar
  (propuesta: esquina en `{0, 0, 0}` del dominio o centro de la planta).
- Redimensionar la nave **no escala ni desplaza automáticamente** los
  equipos interiores; los equipos mantienen sus coordenadas globales.
- Etapa posterior: paredes con grosor, columnas, vigas y aperturas (puertas,
  ventanas). Fuera del alcance de la próxima entrega.

### 5. Árbol de elementos por categorías ✅

Implementado en `feat/categorized-scene-tree`. Véase la sección
"Árbol de escena por categorías" en Funcionalidades implementadas.

**Pendiente para etapas posteriores:**
- Búsqueda por nombre y etiqueta.
- Jerarquía fábrica → categoría → equipo (ver requisito 8).

---

### 8. Jerarquía de fábricas y subáreas 📋

> **Decisiones confirmadas (2026-11-04):**

#### Fábricas del proyecto

| Nombre | Códigos |
|---|---|
| Secado | SEC, S1 |
| Evaporador A | EVA, EA |
| Evaporador B | EVB, EB |

**Filtro de manga (FM):** subárea de Secado. No es una cuarta fábrica
independiente ni un alcance excluido; conserva su identificación como
subárea de Secado.

#### Equipos compartidos entre fábricas

- **TAB-B** atiende a Evaporador A y Evaporador B. Se representa como
  un único `DomainObject`; la asociación con múltiples fábricas se modela
  como relación separada, no como duplicación del objeto.
- La ubicación física de un equipo no se infiere de sus asociaciones
  lógicas (un tablero puede estar en un área y atender a otra).

#### Jerarquía prevista

```
Fábrica
  └── Subárea (opcional, p. ej. Filtro de Manga en Secado)
        └── Categoría (Tableros | Motores | Bombas | …)
              └── Equipo
```

#### Restricciones actuales

- Los objetos de ejemplo (panel-1, motor-1, etc.) **no** están asignados
  a ninguna fábrica. La asignación será explícita y manual.
- El formato JSON persistido no incluye `fabricaId` todavía.
  Se auditará el modelo antes de modificar el esquema.
- No se implementará importación desde Excel hasta que se defina el modelo.

#### Criterios de diseño

1. Un equipo puede asociarse a más de una fábrica sin duplicar el objeto.
2. Separar ubicación física de fábricas atendidas.
3. Las subáreas son atributos de clasificación, no fábricas separadas.
4. El árbol mostrará la jerarquía fábrica → categoría → equipo cuando
   se implemente esta fase.

### 6. Neumática 📋

Las mangueras son entidades propias, distintas de los cables eléctricos:

| Propiedad | Descripción |
|---|---|
| Diámetro exterior / interior | En mm. |
| Material | Polietileno, nylon, acero, etc. |
| Presión de trabajo | En bar o kPa. |
| Radio mínimo de curvatura | En mm. |
| Origen y destino | Puerto en un equipo del catálogo. |
| Metraje | Con acometidas y reservas explícitas. |

- Los puertos de conexión deben ser compatibles con el medio transportado
  (eléctrico, neumático, hidráulico, etc.).
- El BOM (lista de materiales) distinguirá cables de mangueras.

### 7. Recorridos compartidos (bandejas y ductos) 📋

**Principios de diseño:**

- Distinguir "compartir corredor" (objetos en el mismo pasillo) de
  "compartir la misma bandeja" (objetos en el mismo contenedor físico).
- El dominio debe permitir ocupantes de tipo cable **o** manguera.
- La compatibilidad entre ocupantes se rige por reglas configurables
  (separación entre circuitos, incompatibilidad de medios, etc.).
- La ocupación física considera el diámetro exterior y la carga cuando
  los datos estén disponibles.
- **No se asume que compartir bandeja siempre está permitido.**
- Si falta una regla o dato necesario, el sistema mostrará
  _"pendiente de validación"_ sin declarar la instalación como válida.
- La BOM y el checklist distinguirán cables y mangueras por separado.

---

## Principios generales de diseño

1. **Sin backend por ahora:** no hay cuentas de usuario, sincronización
   en la nube ni autenticación en el alcance actual.
2. **Coordenadas en mm, eje Z vertical:** el dominio usa milímetros con
   Z apuntando hacia arriba. La conversión a Three.js (metros, Y vertical)
   está centralizada en `src/scene/coords.ts`.
3. **`position` = centro geométrico:** todos los objetos almacenan la
   posición de su centro. Para apoyar en piso: `position.z = height / 2`.
4. **Separación de conceptos:** categoría del equipo, geometría 3D y datos
   técnicos se mantienen separados para permitir evolución independiente.
5. **Validación antes de modificar:** cualquier importación o acción
   destructiva valida los datos antes de alterar el estado del proyecto.
6. **"Pendiente de validación" antes que falso positivo:** si falta
   información para declarar algo válido, el sistema lo indica explícitamente.
