# Traspaso — recorridos de conexiones y longitudes (rama `feat/recorridos-longitud`)

Base: `675e2bc` (fase B cerrada). Alcance deliberadamente chico: un recorrido entre dos bocas del trazado
colocado, con su longitud. **No** incluye reserva, ocupación, varios circuitos, cables, informes ni
exportación.

## Qué había antes (relevamiento)
- **El motor no busca caminos.** Los circuitos le llegan con `recorrido` explícito (lista de piezas). Solo
  verifica continuidad (`analizar_recorrido`: CONTINUO o DISCONTINUO) y reparte cables por pieza.
- **El motor no da longitudes de circuitos.** Solo suma `longitud_eje_mm` por pieza para los conductores
  PE (D-27), sin distinguir ramal: en una T no sabe por qué boca se entra y se sale.
- **Lo guardado por pieza:**
  - en todas, sus bocas en el mundo y su colocación;
  - en los tramos rectos, `longitud_mm`;
  - en las curvas planas colocadas, `longitud_eje_mm`;
  - en T, X y CUPS (accesorios), ninguna longitud.
- **Campos del contrato `trazado/1` que el espacio de trabajo no arma:** `pe.conductores` (con
  `recorrido`, `inicio` y `fin`), `equipotencial`, `tapas`, `accesorios` y `escenario_reserva`. Los
  circuitos solo se editan a mano en Conexiones.

## Qué se hizo
- **`workspace/recorridos/caminoEntreBocas.ts`.** Busca el camino entre dos bocas: el de menor número de
  piezas, cruzando cada pieza una sola vez.
  - El camino puede salir del origen o llegar al destino por una unión de esa boca.
  - Las uniones que no cumplen la verificación (A-7 + sección B-3) no se atraviesan. Si solo ellas cortan
    el camino, se dice cuál y por qué; si no hay piezas que unan, se dice eso. Nunca un cero.
- **La longitud sale solo de lo persistido:**
  - tramo recto: `longitud_mm`;
  - pieza de dos bocas con `longitud_eje_mm`: esa longitud;
  - cruce en línea (bocas opuestas y alineadas, dentro de 1° y 1 mm, como en el tronco de una T o una X):
    distancia entre los centros guardados;
  - cualquier otro desvío: sin longitud, con motivo. El total queda **incompleto**: se muestra lo conocido
    y cuántas piezas faltan.
- **UI:** en la etapa Conexiones, sección "Recorrido entre dos bocas" (`RecorridoSection.tsx`). El
  operador elige origen y destino en dos listas con los nombres visibles. Se muestra la longitud total en
  mm y la lista de piezas atravesadas, con la boca de entrada y de salida, la longitud de cada una y de
  dónde sale.
- **Pruebas:**
  - `caminoEntreBocas.test.ts` (8): rectos, tronco de T, derivación incompleta, curva con longitud de eje,
    unión inválida, sin camino, bocas unidas como origen o destino, una sola pieza;
  - `e2e/recorridoLongitud.visual.spec.ts`: la cadena se arma con gestos reales. Recto, curva 90, recto,
    T y dos rectos dan **7.883,0 mm** por el tronco (comparado contra la suma de lo persistido); por la
    derivación da incompleto; una unión que no cumple deja "sin camino" con el motivo (hueco y ángulo).

## Cerrar la longitud (segundo encargo)
Las piezas guardan su longitud de eje **al colocarlas**, en `colocacion.longitudes_eje`: por par de bocas,
con la regla y la procedencia escrita. La curva de dos bocas guarda además `longitud_eje_mm`, campo del
contrato que el motor usa para el PE. `caminoEntreBocas.ts` no cambia de criterio: suma solo lo
persistido, ahora también desde esa nueva fuente.

| Familia | Regla | Procedencia |
|---|---|---|
| Curva vertical: CUPS-A (7), CUPS-D (7), CUS (40) | Línea media del canal del perfil medido: promedio de los vértices homólogos de la pared exterior y la interior. Se exige que sus extremos coincidan con los centros de boca (0,01 mm). | STEP CUPS-300-A-Z. El perfil no escala con el ancho: **227,59 mm** en todas. CUS usa el mismo patrón (perfil prestado de la CUPS), y la procedencia lo nombra. |
| T y X: TS (40), XS (40), TPS (21), XPS (7), DCPS (7) | Entrada → centro → salida. Centro = punto común (mínimos cuadrados) a los ejes de todas las bocas; se exige ≤ 1 mm (D-14) de cada eje. Semieje = distancia del centro de la boca al centro. | Modelo medido. Desvío del centro común: ≤ 0,045 mm en todo el catálogo. |

- **Decisión:** para la curva vertical **no** se usa un arco tangente a las bocas. El perfil medido es un
  polígono con chaflanes, no un arco. El arco daría 230,06 mm, 2,5 mm más, sobre una forma que el modelo no
  tiene.
- **Sin regla:** rectos y curvas horizontales no pasan por acá (ya guardaban `longitud_mm` y
  `longitud_eje_mm`). Las T, X y curvas verticales sin modelo no tienen definición, así que no se colocan
  y no tienen longitud.
- **Dónde se guarda:** se aplica en `workspaceOperation.pieceFromPlacement` (toda colocación por
  recorrido) y en `updateOutdatedPieces` (al actualizar se recalcula con la definición vigente), siempre
  con la misma función, `conLongitudesEje`.
- **PB3:** excepción declarada para `longitudesEje.ts`, porque lee el perfil de la CUPS por fuera de la
  definición. Se queda así (operador, 2026-11-12).
- **Pruebas:**
  - `longitudesEje.test.ts`, sobre todo el catálogo:
    - T y X (115 piezas, más de 400 pares): tronco igual a la distancia entre bocas opuestas; derivación
      igual al semieje por el pie de la perpendicular más la distancia al eje. La tolerancia es la de las
      fuentes (0,01 mm × ancho/300 más 0,01° sobre el brazo, por la inclinación de 0,0097° de las bocas
      de la TPS) más el desvío del centro;
    - curva vertical (54): extremos en los centros de boca, tramos extremos sobre las normales, longitud
      entre la cuerda y la suma de tangentes;
    - familias sin regla: null;
    - actualizar recalcula;
    - control negativo.
  - `caminoEntreBocas.test.ts`: la T sin la regla aplicada queda incompleta (control negativo); con la
    regla, completa y con procedencia.
  - E2E `recorridoLongitud`, cadena con gestos reales y una CUPS agregada:
    - completa por el tronco, por la derivación y por la derivación y la CUPS (9.110,5 mm, 7 piezas);
    - control negativo: borrar las longitudes guardadas de la T vuelve a dar incompleto;
    - una unión inválida corta el camino.

## Circuitos guardados y longitudes de proyectos anteriores (tercer encargo)
- **Guardar el recorrido como circuito** (`recorridos/circuitosGuardados.ts`). Desde el recorrido en
  Conexiones, con nombre (obligatorio y único). Se guarda en el proyecto, clave workspace-only
  `circuitos_ws` del trazado, que se quita antes de ir al motor (`tray/store.ts`, `WS_ONLY`); los
  `circuitos` del contrato exigen cable y cantidad y no se tocan. Guarda:
  - origen y destino;
  - por pieza atravesada: bocas de entrada y salida, longitud y fuente, y la posición, dirección y
    orientación de sección de esas dos bocas;
  - uniones cruzadas y la longitud total.
- **Desactualizado, nunca recalculado solo.** `estadoCircuito` compara lo guardado con el trazado y da
  los motivos:
  - pieza borrada;
  - pieza movida o rotada, incluso girada sobre su propio eje, que solo cambia la orientación de la
    sección;
  - longitud cambiada;
  - unión borrada o que ya no cumple.

  Recalcular es un botón; si no hay camino, lo dice y deja lo guardado como estaba.
- **Resultados:** tabla "Circuitos" con nombre, origen, destino, longitud (mm), piezas y estado.
  - "Copiar tabla" copia texto separado por tabulaciones con CRLF, coma decimal y sin separador de
    miles, para pegar en una planilla.
- **Proyectos anteriores** (`recorridos/longitudesAnteriores.ts`): en Conexiones aparece "N pieza(s) sin
  longitud de eje guardada" con el botón "Guardar longitudes con las reglas vigentes".
  - Aplica las reglas sobre la definición guardada de cada pieza, que es su geometría tal como quedó
    colocada.
  - Dice cuántas actualizó y cuáles no pudo, con el motivo: sin colocación resuelta, falta la definición
    guardada, o el motivo de la regla.
  - Es una edición más: se puede deshacer.
- **Pruebas:**
  - `circuitosGuardados.test.ts` (6): guardar, ida y vuelta por JSON, nombre obligatorio y único;
    desactualizado por mover, rotar sobre el propio eje, borrar, cambiar largo o unión; recalcular
    explícito; longitudes anteriores (actualiza T y CUPS; no pudo, con motivo).
  - E2E `circuitosGuardados` (2, gestos reales):
    - guardar con nombre y ver la fila en Resultados (9.110,5 mm, 7 piezas);
    - copiar y leer el portapapeles;
    - sobrevive a recargar la página y a guardar copia, Nuevo y abrir el archivo;
    - rotar una pieza con la herramienta Rotar y borrar otra: desactualizado con motivo; recalcular sin
      camino no toca lo guardado;
    - longitudes anteriores: 2 actualizadas y recorrido completo. Con el fixture real del operador:
      0 actualizadas, 1 no pudo (la T, "sin colocación resuelta: no encaja con el modelo vigente").
- **Defecto encontrado y corregido:** al abrir otro proyecto, las listas de origen y destino conservaban
  la elección anterior y mostraban un falso "sin camino". Ahora una elección que no está en el trazado
  cuenta como "sin elegir".

## Pendientes (los únicos)
1. Elegir origen y destino haciendo clic en la escena, con el recorrido resaltado en 3D.
2. Mover el grupo unido al rotar una pieza (hoy se pide confirmación y se descartan las uniones que dejan
   de cumplir).
