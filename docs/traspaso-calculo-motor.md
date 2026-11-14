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
- **Derivación en tramo y «recorridos discontinuos» (2026-11-14):** para el motor una derivación en tramo no es
  una `conexion`. Un circuito de potencia que la atraviesa llega partido y el motor lo informa DISCONTINUO, con
  el incumplimiento «recorridos discontinuos». **No se oculta ni se traduce, y el resultado no se modifica:** se
  explica en el propio incumplimiento (`stages/discontinuidades.ts`), con el criterio de las mezclas:
  - si todas las discontinuidades (`saltos_sin_conexion` de circuitos y conductores PE) son pares tronco ↔
    ramal de una derivación que la app conoce: «las N discontinuidades corresponden a derivaciones en tramo; el
    motor no las modela como conexión (no afecta ocupación, reserva ni curvatura)»;
  - **ajuste a lo pedido, para no afirmar de más:** en perforada la DCPS es una «T» para el motor, y en la pieza
    del salto deja la curvatura NO_EVALUADO_EXTREMO_DE_RECORRIDO. En ese caso el texto dice «no afecta ocupación
    ni reserva; el motor no evaluó la curvatura en <pieza>». Sólo dice «ni curvatura» cuando el resultado lo
    confirma;
  - si alguna discontinuidad no es una derivación, el incumplimiento queda y se nombra cuál
    («K de N no corresponden a una derivación en tramo: circuito … entre … y …»);
  - control negativo en `stages/__tests__/discontinuidades.test.ts`. E2E con el motor real en `calculoMotor`.

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

## Parte B — segregación con banda divisoria (`workspace/segregacion/bandaDivisoria.ts`)
- **Piezas:** BDS090G y BDS115G (espesor 1,24 mm), BDS090Z y BDS115Z (0,71 mm) para escalera de ala 90 y 115;
  BDS01Z para perforada. Todas tipo «separador», compatibles **sólo con rectas** («accesorio interior»). Ala 65 y
  ala 150 no tienen banda. Se coloca desde la ficha del tramo (Bandejas → «Banda divisoria»): una por tramo,
  sólo si el catálogo declara la compatibilidad.
- **Regla del operador**, con esa procedencia en pantalla: al ancho útil se le descuenta primero el espesor de
  la banda, y lo que queda se reparte entre los grupos **según la cantidad de cables** de cada grupo. Grupos:
  potencia | maniobra + instrumentación.
- **El motor no sabe que la banda existe:** `bandas_ws` no viaja, no se declara como accesorio y no cambia el
  ancho. La ocupación de una bandeja segregada la calcula la **app**, marcada como «cálculo de la app». En
  «Cálculo del motor» y en el inspector de la pieza, la ocupación que el motor dio para esa pieza (sin banda)
  se reemplaza por la de la app, con el aviso de que no se usa.
- **PE en el grupo de potencia — regla declarada por el operador (2026-11-14):** el PE va en el grupo de
  potencia y cuenta como un cable más en el reparto: el conductor de protección va con el sistema de potencia y
  ocupa ancho como cualquier cable. (En la primera entrega era un criterio de la app; el operador lo confirmó.)
- **Criterios de la app** (declarados como tales, no del operador):
  - ancho útil = el del catálogo si existe, si no el nominal (como D-04). Las rectas no publican útil: nominal;
  - ocupación por grupo W = Σ n·D (contacto, como D-02); reserva con el criterio D-05 sobre el ancho del grupo;
    altura contra el ala (D-08);
  - un circuito sin cable o desactualizado que cruza la pieza no se cuenta y se nombra.
- **BDS01Z (perforada) no publica espesor:** la ocupación de una perforada segregada queda **NO VERIFICABLE**,
  con el motivo. Hace falta el **espesor de la BDS01Z en mm** para calcularla.
- **Cómputo:** la banda SÍ se computa, «[AGREGADA POR LA APP]», una por tramo segregado, con la longitud a cubrir.
  El catálogo no publica longitud comercial ni unidad de compra, y la fijación (JB-CC-M6) no declara cantidad.
- **Controles negativos:**
  - el reparto mitad y mitad hace fallar la unitaria y la E2E;
  - la ocupación de la pieza segregada tomada del motor hace fallar la E2E.
  Los dos se verificaron saboteando el código.

## Pruebas (parte B)
- Unitarias `segregacion/__tests__/bandaDivisoria.test.ts`: compatibilidad, colocar y quitar, regla (espesor y
  reparto por cantidad, PE con potencia), BDS01Z no verificable, la banda no viaja al motor, cómputo.
- E2E `calculoMotor` (parte B, con gestos reales): escalera 300 ala 90 Z con BDS090Z, potencia 3×50 × 2 y
  maniobra 4×2,5 × 1:
  - la app reparte (300 − 0,71) en 3/4 y 1/4;
  - la ocupación y la reserva de cada grupo las informa la app;
  - la banda aparece en el cómputo;
  - con el motor, la ocupación de esa pieza no sale de él (ni en Resultados ni en el inspector).
