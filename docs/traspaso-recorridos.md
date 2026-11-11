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
  definición. Alternativa no hecha: llevar la línea media dentro de la definición, lo que cambiaría
  huellas.
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

## Pendiente (anotado, no hecho)
- **Proyectos anteriores:** las piezas colocadas antes de esta regla (o resueltas por la migración A-10)
  no tienen longitudes guardadas y siguen dando incompleto. Hoy solo se recalculan con "Actualizar piezas"
  si además están desactualizadas. Falta una acción explícita para guardarles la longitud.
- Elegir origen y destino haciendo clic en la escena, y resaltar el camino en 3D.
- Si hay varios caminos, hoy se toma el de menos piezas. Elegir el más corto en mm o listarlos queda
  pendiente.
- El recorrido no se guarda como circuito (`circuitos[].recorrido`): no entraba en este encargo.
