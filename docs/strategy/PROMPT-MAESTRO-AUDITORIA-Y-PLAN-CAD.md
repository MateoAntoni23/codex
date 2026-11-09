# Encargo maestro: auditoría y plan integrado del CAD industrial

Este archivo es un prompt autocontenido para Fable u otra IA de arquitectura con acceso al repositorio, o para Claude Code con Opus. Ejecutá el encargo completo. No necesitás conocer las conversaciones anteriores.

## 0. Misión y alcance de esta entrega

Actuá como arquitecto de software senior, diseñador de sistemas CAD web y auditor técnico. El objetivo es recuperar un rumbo integrado de producto y desarrollo: entender el flujo real del usuario, contrastarlo con el código y los datos actuales, localizar causas estructurales de los problemas y entregar un plan ejecutable de estabilización, simplificación y desarrollo.

El usuario es experto en su instalación y principiante en programación. Necesita una herramienta utilizable, no una colección de visores experimentales ni de formularios desconectados.

Esta entrega es de AUDITORÍA Y PLANIFICACIÓN. Inspeccioná código y fuentes, ejecutá pruebas y reproducciones, y generá documentos. No implementes funciones nuevas, no refactorices código funcional, no cambies catálogos, no elimines módulos ni datos. Las propuestas de limpieza requieren primero evidencia, dependencias y un plan de conservación. No confundas libertad de investigación con autorización para reescribir todo.

Trabajá autónomamente dentro de ese alcance. No te detengas tras presentar un plan ni pidas confirmación para leer archivos, ejecutar pruebas o preparar documentos. Si falta una fuente, registrá la limitación y seguí con el trabajo independiente. Agrupá las decisiones de producto realmente pendientes al final; no conviertas decisiones ya explicitadas aquí en nuevas preguntas.

## 1. Acceso, estado inicial y fuentes disponibles

Repositorio local de Windows:
`C:\Users\Usuario\Proyectos\codex`

GitHub:
`https://github.com/MateoAntoni23/codex`

Inspeccioná primero rama, HEAD, cambios locales, remotos y ramas relevantes. No asumir que main es la aplicación más actual. Hubo varias ramas de integración, geometría y configurador; identificar cuál contiene qué. No hacer checkout destructivo, reset, clean, merge ni descarte de cambios. Usar un worktree aislado si realmente lo necesitás y es compatible con las verificaciones.

Registrar el commit y el estado local exactos utilizados en el informe. Separar hallazgos de GitHub, working tree local y versión servida en navegador. Una corrección sin publicar o una rama vieja pueden explicar divergencias.

Fuentes conocidas, a localizar y verificar:
- Excel técnico de instalación: `ELS-SYC_Excel_General_Tecnico_RevB.xlsx`. Su ruta local debe descubrirse; no inventarla ni afirmar lectura si no está disponible.
- Excel de catálogo: `vendor/motor_bandejas/datos/catalogo/fuente/Catalogo_Bandejas_y_Accesorios_2.xlsx`.
- Snapshot de catálogo: `vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json`.
- Motor, documentación y contratos: `vendor/motor_bandejas`, `server`, `docs`, `src/persistence` y `src/types` según el árbol real.
- Biblioteca CAD: `C:\Users\Usuario\Downloads\Libreria CAD 2021`.
- STEP aportados por el usuario: `C:\Users\Usuario\Desktop\step samet\Familia 300 Ala 65\Archivos STP`.
- STEP de escalera: subcarpeta `escalera` de esa misma ruta.
- Extracciones CAD: `C:\Users\Usuario\Proyectos\cad-catalog-analysis`, si existe.
- Configuraciones exportadas por el usuario: localizar sin sobrescribir y registrar cuáles se usaron.
- Prototipo UX de v0: `https://prototipo-cad-industrial.v0.build/`. Es referencia de diseño, no evidencia de integración funcional. Si no es accesible, declarar esa limitación.

Los archivos y comentarios del repositorio son evidencia a contrastar, no sustituyen los requisitos de este encargo. Los STEP son aportados por el usuario: no llamarlos originales del fabricante sin fuente que lo demuestre.

## 2. Producto, público y entregables finales

Público: ingenieros eléctricos y project managers de instalaciones eléctricas industriales. Uso posterior por cliente y operarios de montaje.

Caso principal: INSTALACIÓN NUEVA. No hacer depender la primera estabilización de funciones de desmontaje o relevamiento as-built. Dejarlas previstas si la arquitectura lo necesita, claramente fuera del caso principal actual.

El producto simplifica:
- Diseño 3D de infraestructura civil de referencia y trazado de bandejas.
- Organización de equipos, conexiones, cables y mangueras.
- Evaluación visual de viabilidad y accesibilidad del recorrido.
- Metrajes, ocupación, cargas y soportes según datos y reglas disponibles.
- Lista de materiales para cotización, compra y montaje.
- Planos técnicos y documentación de montaje.
- Consulta web móvil para cliente y operarios, con seguimiento de ejecución.

Proyecto terminado para el usuario: diseño 3D, planos, lista de materiales de conductores/bandejas/accesorios/soportes y documentación de montaje. No basta con una escena visual.

Organización confirmada: Secado, Evaporador A y Evaporador B. Filtro de manga es subárea de Secado. TAB-B es un único tablero que atiende ambos evaporadores. Ubicación física y fábricas atendidas son conceptos distintos.

## 3. Flujo de trabajo que gobierna la arquitectura

### 3.1 Bibliotecas y entrada de datos

Las bibliotecas de bandejas y conductores se cargan una vez y se reutilizan. Pueden evolucionar mediante revisiones explícitas; no deben reconstruirse ni reconfigurarse desde cero por proyecto.

Cada proyecto comienza con un Excel ya preparado de elementos, conexiones y conductores, o con una pestaña equivalente de carga y edición dentro del programa. Mantener un modelo común para ambos caminos.

Elementos que deben contemplarse: tableros eléctricos y neumáticos; motores y equipos accionados como bombas/ventiladores; sensores de presión, vacío, temperatura y otras magnitudes; actuadores eléctricos/neumáticos; válvulas y electroválvulas; iluminación; botoneras/interruptores/bocas de maniobra; puntos de puesta a tierra; bocas de conexión; cámaras de seguridad; racks o equipos de red. No asumir que toda conexión parte de un tablero ni que todo equipo tiene un solo tendido.

Registrar origen y destino de cada cable/conductor/manguera. Servicios eléctricos diferenciados: potencia, maniobra/control, instrumentación, comunicación, equipotencialidad y puesta a tierra. No confundir servicio con medio físico, categoría de equipo o capa visual.

Representar correctamente cables multipolares y varios cables unipolares asociados a una conexión funcional. Ejemplo: motor trifásico con tres unipolares de potencia y un conductor de protección. La disposición se registra según datos del proyecto; no dimensionar ni inventar conductores desde la palabra «motor».

Un tablero neumático puede recibir cableado desde tablero eléctrico o interfaces y alojar borneras, electroválvulas y manifold. Sus mangueras se conectan a puertos de actuadores; puede necesitarse más de una por actuador. Mantener composición y conexiones distintas, sin asumir que el cable termina directamente en la bobina.

Importación: conciliar TAG/alias/IDs, detectar duplicados y conflictos, previsualizar cambios, conservar procedencia y permitir completar datos desconocidos. No usar cero como desconocido.

### 3.2 Civil y posicionamiento

Después de los listados, importar DXF 2D civil o dibujar una base dentro del programa. Seleccionar columnas/paredes y extruir; añadir techos y vigas sobre referencias existentes; organizar capas visibles/ocultas.

Se necesita modelado civil práctico, no un CAD mecánico general de fabricación. Evaluar las capacidades reales de herramientas 3D: Three.js es renderizado/interacción, no por sí solo un kernel CAD o editor de extrusión. Investigar qué hace falta para selección, dibujo, snapping, extrusión, orientación y referencias; justificar cualquier dependencia o cambio de motor con un caso de prueba. No proponer una migración total sin demostrar la insuficiencia del stack actual.

Posicionar equipos mediante arrastre/gizmos/snapping en el visor, recalculando XYZ; mantener edición numérica de precisión. No exigir tipear coordenadas como único método. Vistas frontal, posterior, superior, izquierda, derecha e isométrica; definir proyección y controles apropiados.

Tableros: dimensiones físicas configurables. Para otros equipos priorizar símbolos esquemáticos, con ficha y puntos de conexión. Se propone simbología IEC cuando corresponda, con fuente/licencia adecuada y sin afirmar conformidad automática. Los símbolos deben mirar a la cámara pero tener tamaño fijo en unidades de mundo: al alejarse se ven más pequeños; no tamaño constante en píxeles. Separar símbolo visual de envolvente física cuando sea necesaria para interferencias. Neumática puede requerir su propia simbología.

La UX visual se trabajará posteriormente con una herramienta dedicada como v0. Ahora son imprescindibles interacciones coherentes, selección y estados claros; no paralizar el dominio esperando el rediseño ni dedicar la estabilización a decoración o pestañas sin efecto.

### 3.3 Trazado y biblioteca de piezas

Con equipos posicionados, iniciar generalmente desde un tablero y construir un ramal principal, después secundarios. Permitir rectos de longitud editable, curvas planas 45/90, ascendentes/descendentes, articuladas, T, X, reducciones centrales/laterales, DCPS, embudos paralelo/perpendicular, acometidas, finales y tapas según producto disponible.

Conservar las distinciones:
- TPS = T que el usuario modeló.
- DCPS = derivación común lateral sobre un punto elegido de un tramo, sin cortar físicamente la bandeja principal.
- Subdividir la red lógica no equivale a crear dos piezas de compra ni duplicar metros.
- EMTS/EMPS = embudos de bajada que afectan el recorrido, no simples tornillos/uniones.
- ACPS = acometida a tablero, no una reducción inventada.

Los rectos se proponen normalmente de 3000 mm, respetando el producto real; distinguir longitud instalada, corte y longitud/unidad comercial. Al cerrar el proyecto, totalizar por tipo y SKU, no solo un total indiferenciado.

Bandejas y accesorios pueden estar en horizontal o vertical, con giro de sección. Existen fondo y orientación local aunque el recorrido cambie de dirección. Definir un marco completo por boca y distinguir calibración del modelo de colocación/giro de instancia.

El usuario desea configurar modelos maestros existentes y derivar anchos/alas, no diseñar un STEP por SKU. Conservar sus correcciones y revisiones. Evitar escalado uniforme indiscriminado. El espesor es atributo comercial/técnico y no necesita detalle visual para trazar.

Escalera Z/G: el usuario acepta geometría compartida cuando dimensiones pertinentes coinciden; mantener SKU, acabado/material y datos mecánicos separados. No declarar por ello compatibilidad mecánica universal. Incluir perforada, escalera Z/G y alambre inoxidable sin confundir sus formas.

### 3.4 Recomendaciones, compatibilidad y excepciones

Al continuar, recomendar el mismo recto cuando corresponda y ofrecer accesorios apropiados a la boca libre. Después de una T/curva/cruz deben seguir apareciendo las opciones pertinentes.

Separar familia comercial, familia geométrica, receta, SKU, nombre amigable e ID técnico de boca. Los nombres tronco_P1 o boca_derivacion no deben usarse directamente como si fueran P1/P2/P3 de catálogo: mapping explícito.

Igual ancho o misma familia no bastan para certificar una unión; tampoco ausencia de una fila equivale a imposibilidad física. Distinguir documentada, regla de proyecto, sin evidencia, incompatible explícita y pendiente de modelo/configuración.

Se permiten transiciones entre familias con advertencia, motivo y aceptación del usuario, preservando el diagnóstico técnico original. No borrar el conflicto ni inventar compatibilidades del fabricante. El proyecto puede tener reglas propias versionadas, separadas del catálogo fuente.

### 3.5 Longitud configurable de BAJADAS: aclaración del usuario

El valor manual configurable corresponde a la conexión exterior entre bandeja y equipo (bajada), NO al recorrido dentro de curvas, T, X u otros accesorios de bandeja. Esta aclaración sustituye la interpretación anterior de asignar valores fijos manuales a los accesorios.

Ejemplo de aceptación: el equipo está a 1000 mm del punto de conexión elegido en la bandeja. El programa propone el punto válido más cercano y dibuja solo ese enlace exterior de 1000 mm. El usuario puede configurar una longitud de bajada de 2000 mm para ese extremo. Se conserva la representación de 1000 mm, pero el metraje del tendido y su cómputo usan 2000 mm para la bajada. NO se suman 1000+2000 ni se alarga la línea dibujada para aparentar el valor manual.

Persistir por bajada: equipo/puerto y punto de unión a bandeja, longitud geométrica calculada, longitud manual opcional, modo automático/manual y longitud efectiva para cómputo. Mostrar las dos longitudes y su procedencia. En automático usar la longitud geométrica; en manual usar el valor ingresado como sustitución, no como incremento. Permitir volver al modo automático.

La bajada no tiene que ser estrictamente vertical: puede ser lateral u oblicua. El enlace puede incorporarse en un punto intermedio de bandeja sin introducir un corte físico ni material duplicado. La selección del punto más cercano debe respetar conectividad, servicios y decisiones del usuario, no elegir una red aislada solo por proximidad.

Para accesorios de bandeja, conservar el criterio de recorrido aplicable y contemplar la pareja de bocas atravesada en T/X, sin sumar ramales no recorridos. Esta aclaración NO autoriza una tabla de longitudes fijas arbitrarias por accesorio.

El plan debe separar geometría dibujada, longitud efectiva de tendidos, reservas, cálculo del PE y compra de materiales. No cambiar fórmulas existentes durante la auditoría; diseñar la integración sin doble cómputo. Las reservas adicionales, si existen, deben identificarse aparte y no duplicar márgenes ya incluidos en el valor manual de bajada.

### 3.6 Cableado y neumática

Terminada o suficientemente desarrollada la infraestructura, una pestaña presenta conexiones pendientes y completadas. Al elegir una, resaltar origen/destino; seleccionar los puntos y confirmar la asignación a la red. Mantener pendiente si la red no tiene camino válido. Si hay caminos alternativos, definir criterio y posibilidad de intervención del usuario.

Bajadas/exteriores: enlace geométrico entre equipo y bandeja, con longitud calculada y sustitución manual opcional por extremo, según §3.5. El tablero suele compartir un punto común de entrada/salida para varios circuitos, sin perder el cómputo individual por tendido. Motores y demás equipos pueden tener bajadas propias. El override de metraje no altera automáticamente el dibujo y nunca se suma además de su longitud geométrica.

Calcular longitud total origen-destino incluyendo principal, ramal, recorrido por accesorios, longitud efectiva de las bajadas de ambos extremos y reservas explícitas sin duplicación. Neumática usa el mismo concepto de recorrido con entidades propias.

Escenario integrado de aceptación:
- A tablero, B motor, C sensor, D tablero neumático; conexiones AB/AC/AD conocidas antes del dibujo.
- Principal desde A; T 300/300/300, reducción 300→150 y ramal hacia B, con salida de A y bajada de B.
- Derivación hacia C, con posible cambio aceptado a alambre inoxidable.
- Continuación hacia D y paso a otra sala.
- Manguera D→actuador reutiliza el principal en sentido inverso y sale por otra derivación.
- PE acompaña y se deriva en la infraestructura sin duplicarse por circuito.

### 3.7 Ocupación, separación y cambios de ancho

Cada tramo reconoce qué cables, conductores y mangueras pasan por él. Usar diámetro exterior y cantidades del catálogo o datos ingresados. El importador completo de catálogo de conductores puede evolucionar después, pero la asignación y la representación de estos datos deben estar previstas.

El usuario necesita porcentaje de ocupación y disponibilidad. Proponer un criterio explícito y mostrar límites: no hay una fórmula universal de volumen ni basta siempre restar áreas. Distinguir capacidad geométrica estimada, disposición, compartimentos/separadores y verificación según reglas aplicables. La chapa/espesor no es por sí sola capacidad útil.

Agrupar y separar potencia, maniobra/control, instrumentación y comunicación según reglas del proyecto; prever coexistencia con mangueras. No falsificar otros servicios como potencia porque el motor actual solo admita ese tipo. Permitir modelar datos que todavía no pueden verificarse, con estado pendiente.

Operación necesaria: seleccionar varios tramos/accesorios y cambiar de ancho/sistema. Previsualizar reemplazos, nuevas reducciones, puertos y conflictos; conservar recorridos y referencias cuando sea posible; aplicar todo o nada, con deshacer. No desplazar equipos ni perder cables silenciosamente.

Hover/touch sobre bandeja: producto, dimensiones, ocupación, servicios y lista de tendidos. Seleccionar tendido ilumina recorrido completo. Filtros potencia/control/instrumentación/comunicación/neumática/PE/PAT con leyenda y sin depender solo de color.

### 3.8 Cargas y soportes

Cargas: masa por metro de cada cable/manguera y cantidades sobre cada tramo, más las masas disponibles de bandeja, accesorios, tapas y PE. Desconocido no es cero. Distinguir kg/m, kg y, cuando corresponda, fuerza; no inferir masas de envolventes conceptuales.

El usuario selecciona una corrida recta continua, no cada recto comercial por separado. Ejemplo: 3000+3000+3000+1500 = corrida de 10500 mm. Identificar límites por cambios de dirección/sección/orientación y reglas del montaje.

Seleccionar montaje pared/techo/piso/estructura y sistema/SKU de soporte. Su dibujo puede ser esquemático; el código y componentes reales alimentan el BOM. Separar soporte, anclaje y superficie de fijación.

Generación pedida:
- Primer y último soporte a offsets configurables desde extremos, por ejemplo 100 mm.
- Rellenar simétricamente el intervalo entre esos apoyos.
- Si la separación ingresada es MÁXIMA, proponer n=ceil(distancia_entre_apoyos/separacion_max), separación efectiva=distancia/n y n+1 apoyos, tratando casos degenerados.
- Ejemplo: distancia entre apoyos 3000, separación máxima 1500 → apoyos a 0,1500,3000.
- Distinguir esta política de pedir una separación EXACTA; explicitar cuál usa la interfaz.
- Respetar soportes fijados manualmente y restricciones en uniones/accesorios cuando estén documentadas.
- Orientar según marco local y cara de apoyo, no según ejes globales fijos.

La separación es configurable y puede respaldarse en especificaciones/carga. No afirmar que 1500 mm es norma universal. Verificación de bandeja por vano, capacidad del soporte y anclaje son responsabilidades distintas.

### 3.9 Documentación y campo

Entregar BOM por producto/unidad/cantidad y estados pendientes, lista de conductores y mangueras con metraje individual y totales segmentados. Soportar uso para cotización y pedido sin exigir precios automáticos o ERP no solicitados.

Planos: elegir vista o ventana de encuadre, capas/elementos visibles, escala, rótulo e información de revisión. Generar documentos técnicos y PDF multipágina. Definir plantillas; no afirmar cumplimiento normativo sin requisitos aplicables.

Consulta móvil del sistema para cliente y operarios: equipos, recorridos, cables, mangueras, soportes y anclajes. Seguimiento de corte/montaje/verificación, distinguiendo esos estados de recorrido diseñado y dimensionamiento. Planificar publicación/autenticación/sincronización/offline según necesidad; no asumir que todo debe construirse de inmediato.

## 4. Herramientas actuales y decisiones a evaluar

Stack reportado: React, TypeScript, Vite, Three.js/R3F, Zustand, motor Python, CadQuery/OpenCascade, ODA/ezdxf, Vitest, Playwright, Git/GitHub, Windows/PowerShell, Node y Python. Persistencia mixta reportada: archivos JSON de proyecto, IndexedDB en ciertas rutas y localStorage para configuraciones. Verificar qué usa realmente cada pantalla; no describir autosave universal si el workspace depende de exportación manual.

Claude Code implementa; Fable puede realizar el análisis y planificación si tiene acceso suficiente; ChatGPT ayuda a consolidar requisitos; v0 es herramienta de diseño de interfaz. No asumir capacidades de Fable ni otro producto por su nombre. Si no puede leer/ejecutar repositorio, diferenciar propuesta conceptual de auditoría evidenciada y usar el paquete de evidencias de Claude, sin fingir inspección.

Evaluar el stack por capacidades concretas y coste de integración. Reutilizar lo correcto. No añadir motor gráfico, base de datos, framework o librería porque «podría servir». Identificar rendering, edición civil, geometría paramétrica y cálculo como necesidades diferentes.

Las bibliotecas deben tener revisiones; los proyectos deben conservar qué versión/configuración usaron. Una actualización no puede mover instalaciones guardadas silenciosamente. Necesitar localStorage para ver correctamente un proyecto compartido es un problema a investigar.

## 5. Auditoría técnica requerida

### 5.1 Mapa de arquitectura REAL

Identificar rutas actuales de la aplicación: editor, workspace, pilotos STEP/CAD, configurador y vistas legacy. Para cada una: propósito, stores, fuentes, persistencia, resolutores, renderizadores y contratos. Seguir datos desde archivo/catálogo hasta malla, boca, operación, payload Python y proyecto guardado.

Inventariar las fuentes de verdad: PRODUCTOS/FAMILIAS/PUERTOS/COMPATIBILIDADES/COMPONENTES, PARAMETRIC_CATALOG, índices por SKU, maestros, recetas, mappings, overrides y fallbacks; verificar sus nombres reales. Distinguir registro comercial de modelo geométrico y configuración de proyecto. Localizar duplicación, conversiones implícitas y reglas contradictorias.

### 5.2 Hipótesis que se deben comprobar, no dar por ciertas

- Recetas existentes que no aparecen en el configurador por índices parciales.
- Puertos de receta confundidos con IDs de catálogo; pérdidas después de TPS/XPS.
- Actualizaciones de malla no reactivas mientras bocas sí cambian.
- Preview y confirmado que resuelven geometrías o poses distintas.
- Cambio de base duplicado, reflexión, matrices, escalas y normales incorrectas.
- Configuraciones que se guardan pero no consumen todas las rutas.
- Familias inferidas por prefijo cuando ya existe dato estructurado.
- Fallback que oculta un error, en vez de indicar su limitación.
- Cambio de receta/revisión que altera proyectos existentes.
- Historial parcial que mezcla entidades al deshacer o importar.
- Uso de tests/fixtures que omiten el camino defectuoso de la UI.
- Simetrías, radios, SKU o datos del fabricante inferidos sin evidencia.
- Pipelines CAD o paquetes grandes ejecutados innecesariamente en runtime.
- Dependencias, servidores y procesos duplicados que dificultan reproducir.

Cada hallazgo debe traer archivo/símbolo/línea o reproducción, impacto, causa propuesta, nivel de certeza y solución mínima. Si una hipótesis no se reproduce, indicarlo junto al escenario y versión comprobados. No descartar un reporte del usuario porque un test distinto da cero error.

### 5.3 Modelo de dominio y operaciones

Contrastar tipos existentes antes de proponer otros. No duplicar servicio eléctrico y medio físico en enums incompatibles. Mantener separados equipo, puerto, conexión requerida, tendido físico, recorrido, bandeja comercial, segmento lógico y soporte.

Revisar conectividad de grafo: múltiples bocas, cruces, convergencias, ciclos posibles y recorridos en ambos sentidos. No suponer árbol de padres/hijos para toda la instalación. Detectar rutas ambiguas y tramos compartidos.

Definir la frontera de una operación que pueda modificar piezas, conexiones, recorridos, PE y configuración: planificación sin escritura, validación, preview, commit completo, deshacer/rehacer e invalidación pertinente. No llamar «transacción global» a actualizar solo TrayInput cuando hay más stores afectados.

Separar pendiente de recorrido, pendiente de datos, dimensionamiento, verificación técnica y montaje. Especificar qué estados y cálculos son derivados, qué se persiste y cómo se evita doble contabilización.

### 5.4 Motor y datos

Inspeccionar contratos y comportamiento real del motor, no solo sus documentos. Clasificar capacidad actual, ampliación necesaria, regla configurable del proyecto y función fuera de su responsabilidad. No replicar fórmulas indiscriminadamente ni prohibir modelar todo lo que el motor aún no verifica.

La equivalencia de puertos/D-13 y otras decisiones activas deben reflejar su configuración real. Los datos de proyecto adicionales no deben filtrarse a payloads con esquema cerrado. Proponer un adaptador explícito y validable.

La sustitución manual de longitud de bajadas (§3.5) debe incorporarse al plan, separada de su representación geométrica y del recorrido por accesorios. Ejemplo obligatorio: enlace dibujado de 1 m, bajada configurada de 2 m, aporte efectivo al metraje de 2 m y no de 3 m. No extender este override a accesorios ni a otras fórmulas sin requisito explícito.

### 5.5 Herramientas y verificación

Intentar ejecutar la aplicación y los casos de aceptación. Instalar dependencias de desarrollo necesarias desde fuentes oficiales si corresponde. No confundir falta de Playwright instalado con imposibilidad de usar navegador. Si hay un bloqueo real, registrar el error concreto.

Mantener un solo stack identificado; `npm run dev:trays` inicia web/Python cuando ese script siga vigente. Verificar puertos y origen permitido. No terminar todos los procesos node.exe ni abrir repetidamente servidores y monitores. Limitar esperas con timeout, recoger el primer error y evitar reintentos idénticos sin diagnóstico.

Comprobar que el comando de test devuelva fallo cuando falla un caso. No contar tests omitidos por falta de Python como integración aprobada. No afirmar funcionamiento visual por HTTP 200, screenshot distinto o número de tests verdes.

Revisar mantenibilidad de pruebas, fixtures reales, configuración importada del usuario y posible exposición de hooks de diagnóstico en producción. No construir una batería nueva enorme en esta fase: ejecutar lo disponible y agregar solo scripts de diagnóstico aislados si aportan evidencia.

## 6. Reorganización y limpieza: propuesta, no borrado

Clasificar módulos/datos/herramientas:
- conservar;
- unificar;
- adaptar;
- retirar del flujo activo conservando recuperación;
- eliminar en una fase posterior, solo con dependencias demostradas;
- posponer.

Para cada cambio propuesto: problema, evidencia, dependencias, sustitución, protección de archivos/configuraciones, migración y reversión. Diferenciar código fuente, artefacto generado, modelo CAD original, datos maestros, caché, fixture y documento histórico.

Preservar modelos y configuraciones que el usuario validó. No «normalizar» su trabajo sin comparar antes/después. Proponer una sola entrada cotidiana del programa y documentar qué vistas son herramientas internas, no pasos obligatorios del usuario.

## 7. Plan de ejecución integrado

Entregar una secuencia que cubra TODO el producto descrito, diferenciando ahora/próximo/futuro. No excluir DXF, civil, neumática, soportes o planos porque el motor actual no los soporte. Tampoco implementarlos todos para estabilizar el primer recorrido.

Cada entrega debe especificar:
- problema de usuario y resultado observable;
- alcance y exclusiones;
- dependencia de datos y de otras entregas;
- módulos/contratos que toca;
- conservación/migración de proyectos;
- criterio de aceptación de extremo a extremo;
- límites técnicos y datos desconocidos;
- forma de reversión;
- prueba manual breve para el usuario.

Primera recomendación de estabilización debe derivarse de la auditoría, con comparación entre corrección acotada, consolidación gradual o reescritura parcial. No elegir reescritura general por defecto. Pocas entregas de valor, sin convertir cada detalle en una ronda separada de implementación/auditoría.

Incluir escenarios de aceptación:
1. Excel → equipos/conexiones → importación revisable.
2. Civil básico → posición visual de equipo → vistas/capas.
3. Maestro configurado → variante → preview → confirmado → guardar/recuperar.
4. Recto → curva → recto; luego T/X y continuidad por todas las salidas.
5. DCPS sobre tramo físico sin corte ni material duplicado.
6. A–B con bajadas automáticas/manuales (dibujo 1 m, cómputo 2 m), recorrido por accesorios y asignación de tendidos sin doble suma.
7. A–C y A–D comparten principal; manguera desde D en sentido inverso.
8. Ocupación/servicios → sustitución de ancho por grupo con conservación de recorridos.
9. Corrida de 10500 mm → soportes por offsets y reparto simétrico.
10. BOM, planos por vista/ventana y consulta de campo.

Definir qué prueba ahora el código y qué será prueba de futuras entregas. No exigir aprobar escenarios futuros para terminar esta auditoría.

## 8. Entregables de esta auditoría

Crear un documento principal `docs/strategy/INTEGRATED-AUDIT-AND-EXECUTION-PLAN.md`, legible sin contexto previo, con:
1. Resumen para el usuario: qué funciona, qué falla y cinco prioridades como máximo.
2. Requisitos consolidados y flujo de trabajo validado de este encargo.
3. Matriz requisito → implementación real → evidencia → brecha.
4. Diagramas de arquitectura actual y objetivo, y flujo de datos.
5. Inventario de fuentes/herramientas y responsabilidades.
6. Hallazgos priorizados y causas raíz comprobadas/hipotéticas.
7. Propuesta de consolidación/limpieza, conservación y migración.
8. Plan integrado de ejecución con dependencias y aceptación por entrega.
9. Decisiones pendientes estrictamente necesarias, con recomendación y efecto.
10. Protocolo de trabajo futuro para evitar volver al ciclo de parches.

Agregar anexos legibles por máquina si aportan utilidad:
`requirements-traceability.csv`, `module-disposition.csv` y `source-inventory.csv`.
No crear otra documentación paralela contradictoria: identificar documentos anteriores que quedarán históricos o reemplazados, sin borrarlos en esta entrega.

El protocolo futuro debe exigir: objetivo funcional completo, una versión de referencia, autorrevisión, demo real, tests apropiados y reporte honesto. Definir cuándo requiere revisión externa y cuándo puede cerrarlo el implementador; no auditar cada commit por defecto.

## 9. Límites de autoridad y cierre

No modificar originales CAD, fórmulas, catálogos ni código funcional en esta entrega. Los tests pueden generar archivos en una carpeta de auditoría separada. No subir modelos a terceros ni desplegar/publicar la aplicación. No comprar servicios. No hacer force push ni merge con main.

Si trabajás en Claude Code con acceso Git: crear una rama de documentación desde el estado identificado, sin incluir cambios ajenos; commit y push normal solamente de los entregables del informe. Si eso no puede hacerse preservando el trabajo actual, entregar los documentos sin manipularlo y explicar el límite. No esperar aprobación para terminar el análisis autorizado.

Si trabajás en Fable sin ejecución/repositorio: producir la parte estratégica y marcar las comprobaciones que necesita ejecutar Claude. No llamar auditado al código no leído. Entregar una única lista de evidencias necesarias y el encargo operativo para obtenerlas, preservando el mismo mapa de requisitos.

Finalizar con: commit/rama o archivos entregados, evidencia efectivamente consultada, bloqueos, las decisiones pendientes y el primer objetivo de implementación recomendado. No implementar ese objetivo todavía.

El resultado esperado no es «agregar más arquitectura»: es un panorama verificable que reduzca fuentes de verdad, conserve lo útil y ordene el desarrollo según el trabajo del ingeniero.
