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

## Pendiente (anotado, no hecho)
- **Longitud de eje de los accesorios** (T, X, CUPS): no se guarda al colocarlos, así que todo desvío por
  ellos queda incompleto. Para cerrarlo hay que guardarla al colocar, con una regla publicada o medida;
  no se infiere al consultar.
- Elegir origen y destino haciendo clic en la escena, y resaltar el camino en 3D.
- Si hay varios caminos, hoy se toma el de menos piezas. Elegir el más corto en mm o listarlos queda
  pendiente.
- El recorrido no se guarda como circuito (`circuitos[].recorrido`): no entraba en este encargo.
