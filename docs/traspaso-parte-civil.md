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

## Notas de implementación

### A0 — dónde corre la conversión
El Python del servicio (3.12.10, el mismo que levantan `npm run dev:trays` y Playwright) importa
**CadQuery 2.7.0** → la conversión va en `server/` (`server/civil_step.py`), nunca en `vendor/`.
`server/tray_service.py` atiende `POST /v1/civil/convertir` (cuerpo `application/octet-stream`, tope 200 MB)
dentro de `_manejar`, el mismo control de acceso (Host/Origin) del motor; el resto sigue al motor. CadQuery
se importa recién al primer pedido. Las pruebas de `server/` (que antes no corría nadie) se suman al verify
(`npm run test:servidor`).

### Decisiones tomadas (camino más chico; el otro, anotado)
- **Bloque propio, fuera del trazado** (`src/civil/`, bloque `parteCivil` del archivo): nunca llega a lo que
  se manda al motor. Alternativa no tomada: elementos `infrastructure` de `domain-v2` con geometría `asset`
  (faltan roles para viga y losa, y esos elementos pasan por la lógica de equipos).
- **Archivo de proyecto versión 4**; la 3 se sigue abriendo. Se subió porque una app anterior ignoraría el
  bloque civil sin avisar y lo perdería al guardar.
- **Desplazamiento x, y, z y giro en planta.** El encargo dice «desplazamiento y giro en planta»; se sumó z
  (por defecto 0) para pisos modelados cada uno en su origen. La cota del nivel es un dato declarado (agrupa y
  filtra): no mueve la geometría, porque por defecto se respetan las coordenadas del archivo.
- **Eje de la altura:** por defecto Z (el de la app); el operador lo cambia mirando la caja. No se deduce de
  la geometría.
- **Triangulación gruesa:** tolerancia lineal 0,5 % de la diagonal (mínimo 2 mm), angular 0,5 rad.

### A5 — medición (2026-11-15, este equipo: Intel Iris Xe, Chromium sin ventana con ANGLE D3D11)
Script `tools/civil_fixture/medir_peso.mjs` (con la app levantada). Naves sintéticas de prismas, un archivo,
cámara girando 4 s. Sin las opciones de GPU, Chromium sin ventana usa SwiftShader (software) y no representa
al operador.

| triángulos | fps (mediana) | p95 cuadro | carga | malla en el archivo | autoguardado |
|---|---|---|---|---|---|
| 250.000 | 59,9 | 16,8 ms | 0,4 s | 6,4 MB | 0,1 s |
| 500.000 | 59,9 | 16,8 ms | 0,4 s | 12,7 MB | 0,2 s |
| 1.000.000 | 59,9 | 16,7 ms | 0,7 s | 25,4 MB | 0,3 s |
| 2.000.000 | 59,9 | 16,8 ms | 1,4 s | 50,9 MB | 0,7 s |
| 4.000.000 | 59,9 | 16,7 ms | 2,3 s | 101,7 MB | 1,4 s |
| 8.000.000 | 59,9 | 16,7 ms | 4,3 s | 203,5 MB | — |

- **El giro no es el límite** en este equipo: 60 fps (tope de la pantalla) hasta 8 millones.
- **Lo que crece es el peso:** ~25 MB de archivo y ~0,3 s de autoguardado (en CADA cambio) por millón.
- **Umbral: 1.000.000 de triángulos** (`src/civil/peso.ts`): archivo ~25 MB, autoguardado ~0,3 s.
- Dos errores de la medición, corregidos: (1) un caché que retenía todas las mallas decodificadas (ahora se
  libera con la malla); (2) pasar ~100 MB por el protocolo de depuración tiraba la pestaña en 4 millones: no
  representa el uso real (la malla llega por `fetch` o IndexedDB); se arma dentro de la página.

### A5b — mallas en un almacén aparte (2026-11-15)
Los ~0,3 s por millón venían de que el registro `current` de IndexedDB llevaba las mallas adentro
(`buildRecord` → `parteCivil: archivos` con su base64) y se reescribía entero en cada autoguardado,
cualquiera fuera el cambio. Ahora la base `codex-workspace-v1` (versión 2) tiene el almacén
`mallasCiviles` (clave `<id>@<versión>`): `current` guarda de cada archivo sólo el ensamblado y
`mallaRef`; la malla se escribe sólo al importar, reemplazar, quitar o abrir otro proyecto, en la misma
transacción que el `current` que la nombra. La copia del proyecto sigue llevando todo adentro. Si al
restaurar falta una malla, el proyecto se abre sin ese archivo y se avisa. Un registro con la malla
adentro (formato previo de esta rama) se sigue abriendo y pasa al almacén aparte al guardar.

Medido con `medir_peso.mjs` (trazado real de 7 bandejas + nave sintética, mediana de 5 movimientos):

| triángulos | registro `current` antes → ahora | autoguardado al mover una bandeja antes → ahora | al girar la nave antes → ahora |
|---|---|---|---|
| 250.000 | 6,5 MB → 9 KB | 96 → 10 ms | 90 → 44 ms |
| 1.000.000 | 26 MB → 9 KB | 368 → 11 ms | 439 → 30 ms |
| 4.000.000 | 104 MB → 9 KB | 1.332 → 9 ms | 1.545 → 25 ms |

El autoguardado ya no depende del tamaño de la nave. El umbral de aviso (1.000.000) queda por el peso
del archivo de proyecto (~25 MB por millón) y la carga, no por el autoguardado.
