# Traspaso — etapa 3: el cálculo del motor (rama `feat/calculo-motor`)

La rama sale de `feat/cables-circuito` (etapa 2, PR #6): necesita el cable del circuito. El PR va contra `main`
e incluye los commits del #6 hasta que se fusione.

## Cierres del traspaso (operador, 2026-11-13)
- **Procedencia de los STEP — cerrado.** Los dibujó el operador a partir de los CAD de SAMET: lo medido tiene
  autoridad al milímetro, no a la décima. La guarda de 0,5 mm queda **confirmada** (`traspaso-recorridos.md`,
  `parametric/catalog.ts`).
- **Ignorados, fuera del traspaso:** reexportación de la DCPS-450, ángulo por instancia de la CAS, 3 filas de
  compatibilidad con producto nulo.

## Parte A — los circuitos de potencia viajan al motor (`workspace/motor/paraMotor.ts`)
- **Circuitos:** cada circuito guardado se traduce al contrato `trazado/1` (`circuito_id`, `funcion`,
  `cable_id`, `cantidad`, `separado`, `recorrido` = piezas de bandeja en orden; las bajadas no son bandeja y no
  viajan). Viaja sólo si es de potencia, tiene cable, está vigente y su cable no es el del PE. Los que no viajan
  se listan en Resultados con su longitud y el motivo.
- **Función:** se elige (potencia, maniobra, instrumentación). Maniobra e instrumentación se trazan, se miden y
  llevan su cable, pero no van al motor: el motivo en pantalla cita **D-11** (mando y señal sin reglas).
- **`separado` = false para todos:** confirmado por el operador (cables agrupados, en contacto, D-02). Ya no se
  elige en pantalla. Con eso D-01, D-03 y D-07 no se activan.
- **PE real, sin pedir nada nuevo al operador:**
  - sección **16 mm²** = D-20, aprobada en las decisiones del motor (la entrada no puede redefinirla);
  - cable **PRY-SASTFLEX-CU-1x16**: el único del catálogo unipolar de 16 mm² con aislación verde/amarillo
    (D-21). Lo fija una prueba contra los datasets;
  - recorrido: todas las piezas («todos los tramos, incluidos los ramales», D-20). Hay un conductor principal
    desde un extremo y uno por cada ramal, que arranca en la T de la que sale, con un punto `derivacion_pe`.
    Las derivaciones en un tramo unen redes con un `derivacion_pe` sin pieza. Cada red tiene un
    `sistema_proteccion` al inicio de su conductor principal; el motor informa su ubicación como
    NO_CONTRASTABLE;
  - un `pe` propio del proyecto (no neutro) o puntos equipotenciales propios se respetan.
  Contra el motor real: cobertura COMPLETA, sistema de protección PRESENTE, sección y color COINCIDEN.
- **Observaciones del motor** que quedan a la vista y no se traducen:
  - el Superastic Flex no menciona bandejas en sus condiciones de empleo;
  - el modelo de PE queda «MODELO_A_CONFIRMAR»;
  - las piezas no tienen vínculo PE ↔ bandeja previsto (D-26: se informa, no se exige);
  - la pieza del ramal se cuenta en los dos conductores (el motor la lista en «segmentos compartidos»).
- **Resultados** («Circuitos y el motor» y «Cálculo del motor», `stages/CalculoMotor.tsx`): resumen del motor
  (estado, incumplimientos, decisiones que bloquean), recorrido y curvatura por circuito, ocupación y reserva
  por pieza (con método y decisión), masa por pieza, soportes y vanos, y PE. Cada bloque lleva su procedencia.
  Un bloqueo se muestra con su código y su `decision_id`.
- **Defecto de la etapa 1 corregido:** `bajadas_ws` no estaba en las claves que no viajan al motor. Calcular un
  proyecto con enlaces fallaba con «claves desconocidas».
- **Limitación conocida:** una derivación en un tramo no es una `conexion` del trazado. Un circuito de potencia
  que la atraviese llega al motor con el recorrido partido, y el motor lo informa DISCONTINUO.

## Pruebas (parte A)
- Unitarias:
  - `motor/__tests__/paraMotor.test.ts`: qué viaja y qué no (D-11, incompleto, desactualizado, cable del PE),
    control negativo de la función, PE por decisiones y datasets, recorrido con ramal y redes sueltas;
  - `tray/__tests__/integration.test.ts`: el PE neutro no viaja tal cual y viaja el del trazado; ninguna clave
    `_ws` viaja.
- E2E:
  - `calculoMotor` (nueva): potencia × 2 con tripolar 3 × 50; ocupación y reserva iguales a las del motor en
    pantalla; PE con cobertura completa; maniobra con su longitud y D-11;
  - `etapas` B6 reescrita: sin PE declarado, el motor da preselección condicionada;
  - `cablesCircuito`: elige la función; la disposición es fija.
