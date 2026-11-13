# Traspaso — anchos ofrecibles y derivación que coloca sólo el accesorio (rama `fix/anchos-derivacion-accesorio`)

Base: `91f5b4c` (`fix/cups-orientacion-compat`). Los pendientes vigentes siguen en `traspaso-recorridos.md`.

## Defecto 1 — "en perforada de 50 y 100 no se ofrecen CUPS ni XPS"

### Dónde estaba el filtro
No hay un filtro roto en el camino de oferta. Desde un recto **SAM-STP-Z** de 50 o 100, la continuación ofrece
CUPS-A, CUPS-D y XPS de ese ancho, y se colocan; lo comprobé con gestos reales en 50, 100 y 300. Lo que las
filtra es la **familia**: en la ronda del operador, los tramos de 50 y 100 son **SAM-STP-ZN**
(TRPS-050-22-ZN, CPS-050-90-ZB, TPS-100-ZN…; se ve en la lista de su captura), y desde 150 son SAM-STP-Z.

El catálogo dice:
- SAM-STP-ZN, «Smarttray Perforada color» (ZN negro / ZB blanco): «Solo existen en color: tramo recto, curva
  plana 90°/45° y unión T». **No hay CUPS ni XPS en color**, en ningún ancho.
- Las dos familias: «Sin compatibilidad con otras familias (usuario, REV-032)».

La regla física (misma familia, ancho y ala) aplica REV-032 tal cual, así que **no se cambió**. Ofrecer una
CUPS zincada desde una bandeja color sería contradecir una decisión del usuario.

**REV-032 no se toca:** el operador lo está decidiendo. Permitir que la familia color continúe con accesorios
de la familia Z (curva vertical y X) sería cambiar esa decisión, no corregir un defecto.

### Pendiente para el encargo de interfaz
- **El vacío silencioso de la familia color.** Cuando el operador traza en familia color (SAM-STP-ZN, ZN/ZB) y
  llega a un punto donde necesitaría una curva vertical, una X o una derivación, hoy la app no le ofrece nada
  y no dice por qué. Un vacío silencioso parece un error del programa.
  - **Qué tiene que pasar:** decirle que la familia color no incluye ese tipo de pieza. Sólo tiene recto,
    curva plana 90°/45° y T.
  - **Dónde:** en el selector de continuación y en la herramienta «Derivación en tramo». La DCPS se busca
    hoy por ancho, sin mirar la familia.

### Prueba sobre el catálogo (`anchosOfrecibles.test.ts`)
- **Por familia con modelo** (perforada Z, perforada color y las de escalera): cada (tipo de pieza, ancho)
  colocable que el catálogo declara se ofrece como recomendado desde un recto de su familia y ancho, y su
  definición resuelve. Usa lo mismo que el selector: `compatiblesDirectos` + `buildContinuationCandidates`.
- **Huecos de modelo:** si un tipo es colocable en algún ancho, tiene que serlo en todos los anchos del
  catálogo.
- **DCPS:** la herramienta de derivación encuentra la DCPS de cada ancho del catálogo.
- **Familia color:** se fija que no publica curva vertical ni X, y que desde ZN 50/100 no se ofrecen las Z;
  sí se ofrecen su T y su curva.
- **Control negativo**, verificado:
  - sacar la XPS-100 del selector → falla «XPS-100-Z (X, 100 mm) no se ofrece desde TRPS-100-22-Z»;
  - dejar la CUPS-050 sin modelo → falla nombrando CUPS-050-A-Z y CUPS-050-D-Z.

## Defecto 2 — la derivación coloca sólo el accesorio (corrección de la especificación, 2026-11-13)

### La operación
`crearEnganche` recibe tronco, boca de referencia, distancia, lado y **ancho de la derivación**. Ya no recibe
ramal ni largo, y **no crea ninguna bandeja**.
- **Perforada:** coloca la DCPS del ancho elegido con la cara de apoyo contra el flanco. Su boca P1 queda
  libre (sin conexión) y se continúa desde ahí por el camino normal. El cómputo trae 1 DCPS del ancho elegido.
- **Escalera:** no coloca ninguna pieza. El enganche guarda la **boca** sobre el flanco (`boca`: posición,
  dirección hacia afuera, «arriba») y un **recto de referencia** (`ref_producto_id`: familia y ala del tronco,
  ancho elegido).
  - La boca aparece como extremo libre (`enganche:ENG-k` del tronco, «Boca de derivación ENG-k (flanco del
    tronco)») y es un extremo libre legítimo.
  - El ancho fija la huella (corte en obra) y qué se puede continuar.
  - El cómputo no trae ninguna pieza.

### Continuar desde la boca de escalera (`extremosLibres.ts`, `enganche.ts`)
- `extremosLibres(entrada)`: las bocas libres de las piezas más las bocas de enganche de escalera sin
  continuar. Reemplaza a `getFreePorts(...)` en Bandejas, RoutingPanel, RoutingObjects y StageInspector.
- `origenDeBoca`: la compatibilidad (selector, previa y confirmación) se decide contra el recto de referencia,
  por su P2.
- `asentarSalidasDeEnganche`: el camino normal arma una `conexion` contra `enganche:ENG-k`. Al confirmar, esa
  conexión se convierte en la `salida` del enganche, porque la boca no es del catálogo y no viaja al motor.
  Vale también para la continuación con reducción.
- `verificarOrigen`: la boca sigue libre y en el mismo lugar.
- **Si se borra lo continuado:** la boca vuelve a quedar libre. No es un error.

### Recorrido
- **Perforada:** tronco → `enganche:ENG-k` → DCPS (`apoyo` → P1, profundidad guardada) → lo continuado.
- **Escalera:** tronco → `enganche:ENG-k` → lo continuado.
- La maquinaria es la misma de antes: `salida` del enganche y conexiones normales.

### El dibujo (sí era un defecto de render)
- **Causa:** `TrayObjects.tsx` descartaba toda pieza con menos de dos bocas (`if (!p1 || !p2) return null`).
  La DCPS tiene una sola, así que **nunca se dibujó**.
- **Efecto:** el ramal arrancaba en la boca de la DCPS, a 80,5 mm del flanco, con el hueco invisible. Por eso
  el operador lo veía como una pieza suelta, sin junta.
- **Colocación persistida:** era correcta.
- **Corrección:** una pieza con definición colocada se dibuja aunque tenga una sola boca.
- **Control negativo:** con el filtro viejo, la E2E falla en «la pieza DER-1 tiene malla en la escena».

### Proyectos anteriores
- Los enganches con un ramal creado por la operación vieja se siguen leyendo: su salida es ese ramal y el
  recorrido lo atraviesa.
- Un enganche viejo de escalera no tiene boca guardada: si se borra su ramal, sigue informando «el ramal ya
  no está en el trazado».

### Pruebas
- `enganche.test.ts` (17): continúa por el camino de la UI (extremo libre → `planAddSegment` →
  `applyOperation` → `asentarSalidasDeEnganche`).
  - **Perforada:** sólo la DCPS, boca libre, recto de 100 con unión válida (101,315 mm), recorrido 1500 +
    80,542 + 1000, circuito.
  - **Escalera:** sólo la boca, recto de 150 sin conexión, la salida se asienta, la boca se libera al borrar,
    no se continúa con otro ancho ni con perforada, recorrido 1500 + 1000.
  - **Proyecto anterior.**
- E2E `derivacionTramo` (gestos reales):
  - **Perforada:** tronco 300, derivación de 100 a mitad de tramo. Sólo la DCPS-100-Z, ninguna bandeja; se
    continúa con TRPS-100 desde su boca. Unión válida, recorrido 2.580,5 mm, motor 1 DCPS-100-Z, tronco intacto.
  - **Escalera:** tronco 300, derivación a mitad. Sólo la boca libre, ninguna pieza; se continúa con TRES-150.
    Ninguna conexión, recorrido 2.500,0 mm, ningún accesorio computado.
  - **Capturas cenitales:** `e2e/output/derivacion-02-perforada-continuada.png` y
    `derivacion-04-escalera-continuada.png`.
