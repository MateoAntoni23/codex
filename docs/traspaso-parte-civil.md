# Traspaso — parte civil de la planta por importación de STEP 3D (rama `feat/parte-civil`)

Base: `main` (`1bd87f7`). Encargo del operador (2026-11-15), completo, para que no se pierda si se corta la
sesión. Tres partes. **Al cerrar la A, parar y esperar**: el operador va a importar un archivo suyo.

Regla de trabajo: no hacer preguntas de decisión salvo que algo sea imposible o se pierdan datos del
operador. Si se duda entre dos caminos, tomar el más chico y anotar el otro.

## Objetivo
Que el trazado de bandejas se diseñe dentro de la nave real: columnas, vigas, muros y losas como contexto
visual. En esta versión la parte civil **NO interactúa** con las bandejas, no entra en uniones, cómputo ni
cálculo, y **NUNCA viaja al motor** (ya pasó con las bajadas de equipos: el motor rechaza lo que no conoce).

## Decisiones del operador (no reabrir)
- Se importa **STEP 3D**. No hay dibujo en la app ni DXF.
- **Un archivo por piso y por tipo** (PB-columnas.stp, PB-vigas.stp, …). Al importar, el operador declara el
  tipo y el nivel. No se deduce nada de la geometría ni de los nombres internos del STEP.
- El ensamblado se hace en la app.

## Lo que ya existe (no redescubrir)
- El dominio ya tiene geometría `{ kind: 'asset', assetId, boundsMm }` y roles
  `'floor' | 'building' | 'wall' | 'column' | 'other'` (`src/types/domain-v2.ts`).
- La etapa Planta existe (`PlantaPanel.tsx`) y hoy sólo lista piso y nave.
- El proyecto se autoguarda en IndexedDB (`src/project/projectDb.ts`); el archivo de proyecto va por la
  versión 3.
- CadQuery ya se usa en `tools/step_parametric/`, fuera de la app.

## Parte A — importar, ensamblar y guardar
- **A0.** Antes de programar, verificar en diez minutos y reportar en una línea: ¿el Python del servicio
  (`server/tray_service.py`) puede importar CadQuery? Si sí, la conversión va ahí, en `server/`, nunca en
  `vendor/`. Si no, un conversor en el navegador (elegir, decir cuál y seguir).
- **A1. Conversión.** El STEP se convierte UNA vez, al importar, a una malla liviana que se guarda.
  Triangulación gruesa (contexto, no fabricación). Todos los sólidos de un archivo, en una sola malla.
- **A2.** Al importar, el operador declara: tipo (columna, viga, muro, losa/entrepiso u otro) y nivel
  (nombre PB, P1… y cota en mm). Y VE antes de confirmar: unidades leídas del STEP, caja envolvente (ancho ×
  fondo × alto) y cantidad de triángulos. SolidWorks suele exportar con otro eje vertical: mostrar qué eje
  quedó como altura y dejar elegirlo. Las medidas de la caja son el control (una columna de 6 m acostada se
  ve ahí).
- **A3. Ensamblado.** Por defecto se respetan las coordenadas del archivo (pisos modelados en el mismo
  sistema encajan solos). Cada archivo admite además un desplazamiento y un giro en planta, editables. Un
  archivo se puede REEMPLAZAR por una versión nueva conservando tipo, nivel y posición, y se puede quitar.
- **A4. Guardado.** Se autoguarda con el proyecto y viaja en la copia del proyecto: una copia abierta en un
  navegador limpio tiene que mostrar la nave. Reportar cuánto pesa el archivo de proyecto con la nave de
  ejemplo. Si hay que subir la versión del archivo, subirla, y la versión 3 se sigue abriendo.
- **A5. Peso.** Medir en este equipo, con naves de ejemplo de tamaño creciente, hasta dónde la escena se
  mueve fluida; fijar el umbral de aviso con esa medición, escrita. Al importar un archivo que lo pasa, avisar
  ANTES de sumarlo a la escena, con el número y la sugerencia de simplificar el modelo (sin redondeos ni
  detalles).
- **A6. Dónde vive:** etapa Planta. A la izquierda, los archivos agrupados por nivel. En el inspector, el
  archivo seleccionado con sus datos y acciones. Si falla la conversión o el servicio no está, decir por qué.
- **Pruebas de la A:** nave de ejemplo generada con CadQuery (columnas, vigas, muros, dos niveles) como
  fixture. E2E: importar, ver las medidas, confirmar, recargar y que siga ahí; reemplazar un archivo; abrir la
  copia en limpio. **Control negativo:** un trazado con parte civil se calcula igual que sin ella, y nada civil
  aparece en lo que viaja al motor.
- **PARAR ACÁ.** Reportar y decirle al operador cómo importar su primer archivo.

## Parte B — ver sin que la nave estorbe
- **B1.** Filtro por nivel: todos o sólo el elegido.
- **B2.** Visibilidad por tipo: columnas, vigas, muros, losas, otro.
- **B3.** Transparencia de la parte civil, ajustable. Bandejas y equipos siguen opacos.
- **B4.** Selección: la parte civil NO se selecciona con clic en la escena por defecto (los clics llegan a
  las bandejas). Se selecciona desde la lista de Planta o activando un modo «seleccionar parte civil».
- **B5.** Aislar: mostrar sólo lo seleccionado y volver con un clic.
- **B6.** Plano de corte alineado a un eje, con deslizador de posición y botón para invertir el lado. Por
  defecto corta SÓLO la parte civil; opción de cortar todo. Caso principal: entrar a un espacio encerrado
  entre columnas.
- **B7.** Todo junto en un control «Vista» de la escena, plegable, en todas las etapas. Preferencias de
  pantalla: no cambian el proyecto.

## Parte C — color y cierre
- **C1.** Colores por tipo civil con el mismo mecanismo que los de bandeja (configurables, en el navegador,
  en la misma leyenda). Por defecto tonos apagados: muros pizarra, columnas arena, vigas verde grisáceo,
  losas gris oscuro.
- **C2.** Verificar con números (como la paleta de bandejas): que se distingan entre sí, contra el fondo y
  contra los cuatro colores de bandeja, también con visión reducida del color. Si alguno no pasa, ajustarlo y
  decir cuál quedó.
- **C3.** Una E2E por cada punto de la B y de la C, a 1366×768. Plano de corte y transparencia verificados
  sobre píxeles o estado real de la escena, no sólo sobre el control.
- **C4.** Verify completo en 8 tandas. Rama desde main, con su PR, **sin fusionar**.

## Fuera de alcance
Soportes anclados a vigas, avisos por atravesar un muro, editar la geometría civil, DXF, y editar el piso y
la nave viejos.

## Notas de implementación (se completan al avanzar)
