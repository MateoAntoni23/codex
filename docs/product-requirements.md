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

### Árbol de escena ✅
- Lista plana de objetos en el panel izquierdo.
- Selección sincronizada con el visor y el inspector.
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

### 1. Tableros configurables 📋

- Nombre y etiqueta editables.
- Dimensiones editables: ancho, profundidad y altura.
- Modo de montaje: en piso o en pared.
- Posición editable (ya implementada para el tipo actual).
- Puertos de entrada/salida: a definir en etapa posterior.
- Distribución interna (interruptores, barras, etc.): reservada para etapa
  posterior, fuera del alcance actual.

### 2. Catálogo de equipos 📋

**Categorías previstas:** motores, bombas, válvulas, sensores, luminarias,
botoneras.

Cada equipo debe distinguir tres conceptos independientes:

| Concepto | Descripción |
|---|---|
| Categoría | Grupo funcional del equipo (p.ej. motor, válvula). |
| Representación gráfica | Geometría 3D simplificada y reconocible. No depende únicamente del color. |
| Datos técnicos | Propiedades como potencia, presión, voltaje, según categoría. |

- Etiqueta visible configurable directamente sobre el objeto 3D.
- Icono de categoría para identificación rápida.
- La identificación nunca debe depender exclusivamente del color.

### 3. Normas y símbolos 📋

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

### 5. Árbol de elementos por categorías 📋

La lista plana actual se reemplazará por un árbol jerárquico:

```
▾ Tableros (1)
    Tablero Eléctrico
▾ Motores (1)
    Motor Eléctrico
▸ Bombas (0)
▸ Válvulas (0)
▸ Sensores (0)
▸ Iluminación (0)
▸ Botoneras (0)
▸ Infraestructura (2)
    Nave Industrial
    Piso
```

- Cada categoría muestra la cantidad de elementos.
- Categorías contraíbles y expandibles.
- Selección en el árbol sincronizada con el visor y el inspector.
- Búsqueda por nombre y etiqueta (a implementar en etapa posterior).

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
