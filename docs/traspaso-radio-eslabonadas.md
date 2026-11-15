# Traspaso — radio de las curvas eslabonadas por cantidad de eslabones (rama `feat/radio-eslabonadas`)

Base: `feat/curva-ajustable` (`f99eb79`). PR #9 (interfaz) sigue esperando al operador: no tocarlo.

## El encargo (2026-11-15)
Corrección de la regla de radio de las curvas eslabonadas (EPS perforada, CUS escalera). El operador
confirma que vale el dato del catálogo y no su regla anterior.

- La regla «radio = ancho» (2026-11-13) era una observación del operador sobre una curva de 300, donde 294
  y 300 son casi lo mismo. No generaliza: en 600 daba el doble, y eso iba a la longitud de cable.
- **Nueva regla, declarada por el operador y respaldada por el catálogo:**
  - el radio sale de la **cantidad de eslabones**, según el gráfico del catálogo
    (EPS: 3→150, 4→200, 5→260, 6→330 mm; CUS línea Z: 3→125, 4→210, 5→294, 6→376 mm);
  - **no depende del ancho** de la bandeja: el eslabón es la misma pieza en todos los anchos;
  - para cantidades que el gráfico no tabula: **informar qué se encontró antes de interpolar**.
- Retirar la nota «CONTRADICE AL CATÁLOGO» de `curvaEslabonada.ts` (deja de contradecirlo).
- Cambia la longitud de eje de las eslabonadas ya colocadas: las piezas afectadas quedan
  **desactualizadas con su motivo**, como cualquier cambio de definición.
- **La CAS no se toca** (radio interior = ancho, como las curvas planas fijas).
- Cierre: verify completo en 8 tandas (vitest con 2 procesos, fijo en la configuración).

## Qué dice el catálogo (snapshot, observaciones de los productos; PDF 5 / impr. 8)
- **El gráfico «RADIO APROX EN MM» tabula de 3 a 10 eslabones**, no sólo de 3 a 6:
  - EPS: 3→150, 4→200, 5→260, 6→330, **7→415, 8→450, 9→500, 10→590** mm;
  - CUS línea Z: 3→125, 4→210, 5→294, 6→376, **7→460, 8→540, 9→625, 10→705** mm.
- Con el rango de ángulo vigente (1°–180°) y N = techo(θ/22,5°)+1, salen **N = 2 a 9**. El único caso sin
  tabular es **N = 2** (θ ≤ 22,5°).
- **CUS línea G (28 códigos):** «radio no declarado para la línea G (la tabla figura sólo en la sección
  Z)».
- **Referencia del radio:** «valor aproximado; referencia del radio no declarada» (no dice si es al
  interior, al eje o al exterior). Hoy los centros de boca y la longitud de eje se miden sobre el eje.
- `radio_mm = 294` está cargado en las 12 CUS Z (lectura para 5 eslabones), «referencia no especificada».

## Decisiones del operador (2026-11-15)

### 1. El radio depende de la apertura de cada articulación, no de la cantidad de eslabones
Derivación del operador: el gráfico es «curva de 90° armada con N eslabones». Con θ_art = 90°/(N−1) y
L = 2R·sen(θ_art/2), las filas implican un eslabón de largo fijo; el gráfico varía porque, para llegar a
90° con menos eslabones, hay que abrir más cada articulación. Como la regla del operador fija **22,5° por
articulación** (= 5 eslabones a 90°), el radio es el de esa apertura **para cualquier ángulo total**:

- **EPS: radio interior 260 mm** (fila de 5 eslabones);
- **CUS: radio interior 294 mm** (fila de 5 eslabones; además es el único armado que se vende como código:
  los 40 CUS son de 5 eslabones, el «5» está en el código).

La cantidad de eslabones sigue saliendo de N = techo(θ/22,5°)+1 y se usa **sólo para el cómputo**. El
resto del gráfico (3, 4, 6…10) no se usa para elegir radio. No depende del ancho.

**Verificación de la cuenta (hecha acá, todas las filas):**

| N | θ_art | EPS R → L | CUS Z R → L |
|---|---|---|---|
| 3 | 45° | 150 → 114,8 | 125 → 95,7 |
| 4 | 30° | 200 → 103,5 | 210 → 108,7 |
| 5 | 22,5° | 260 → 101,4 | 294 → 114,7 |
| 6 | 18° | 330 → 103,2 | 376 → 117,6 |
| 7 | 15° | 415 → 108,3 | 460 → 120,1 |
| 8 | 12,86° | 450 → 100,8 | 540 → 120,9 |
| 9 | 11,25° | 500 → 98,0 | 625 → 122,5 |
| 10 | 10° | 590 → 102,8 | 705 → 122,9 |

- **EPS: cierra** (N = 4…10: L entre 98 y 108 mm, ≈102 ± 6 %; N = 3 queda fuera, 114,8). Las filas 7 y 9
  se apartan ≈6 %, compatible con valores leídos de un gráfico.
- **CUS Z: no cierra tal cual** (L crece de 95,7 a 122,9), **pero cierra con un solo desplazamiento
  constante**: con R + 41,4 mm, L = 130,5 ± 0,3 mm en todas las filas N = 4…10 (N = 3 da 127,4).
- **Conclusión (operador, 2026-11-15) — punto cerrado:** que el largo del eslabón de la CUS cierre en
  130,5 ± 0,3 mm en todas las filas con un único desplazamiento constante **confirma** la lectura del gráfico
  como curva de 90° armada con N eslabones. Los ~41 mm son el radio del **círculo de pivotes**, que en una
  curva vertical van abulonados por fuera del codo; no tienen por qué coincidir con ala/2, que es por donde
  corre el cable. La longitud de eje sigue en radio interior + ala/2: no cambia nada.

### 2. N = 2 (θ ≤ 22,5°): se rechaza, sin callejón — el motivo según el PLANO del giro
El ángulo tiene que ser **mayor que 22,5°** (3 eslabones o más). El motivo dice el ángulo mínimo y el porqué
(el gráfico del catálogo arranca en 3 eslabones), y después depende del plano, porque la CAS gira en
horizontal y la eslabonada sube o baja: no son intercambiables.
- **Giro VERTICAL** (el de la eslabonada, que sube o baja): «Para un cambio de nivel menor, el catálogo no
  publica ninguna pieza.» Nada más: no se inventa una alternativa ni se sugiere una pieza de otro plano.
- **Giro HORIZONTAL**: «Para un giro horizontal menor está la curva ajustable CAS, de 1° a 90°.»
- El plano sale de la geometría de la pieza colocada (eje de giro entre P1 y P2: vertical → giro
  horizontal). Al colocar una nueva vale el tipo del catálogo, «curva vertical articulada». Hoy la app
  coloca las eslabonadas siempre subiendo o bajando, así que en la práctica el texto es el vertical.

### 3. CUS línea G: se parte según coincida la GEOMETRÍA, no el acabado
Verificado contra el catálogo por el operador (y por una prueba): las 12 combinaciones de ancho, ala y
espesor de la línea Z son un subconjunto exacto de la G.
- **CUS G con chapa 1,24 y ala 65, 90 o 115** (12): existe una Z con el mismo ancho, ala y espesor. Toman
  la tabla de la Z. Procedencia: **equivalencia por acabado** (mismo eslabón, distinto baño), con la
  coincidencia de ancho, ala y espesor verificada en el catálogo. No es «declarado por el operador» a secas.
- **CUS G con chapa 2,1 o ala 150** (16): no hay Z equivalente. **Sin definición**, con el motivo visible:
  el catálogo no publica radio para esa combinación y no hay pieza equivalente de la que tomarlo.

### 4. Referencia del radio: al interior (inferencia fundada, no dato del catálogo)
El catálogo no declara la referencia en la tabla de las eslabonadas, pero SÍ en las curvas planas fijas de
la misma familia (CS-300-90-065-18-G: `radio_mm = 300`, `referencia_radio = interior`). Se toma esa
convención de la casa. El eje queda a **radio + ala/2 en las curvas verticales** (el radio corre en la
dirección del ala) y a radio + ancho/2 en las horizontales (como ya hace la CAS). La referencia de la
tabla sigue sin estar declarada.

### Lo que sigue igual
- Articulaciones de 22,5°, N = techo(θ/22,5°)+1, longitud de eje = polígono de N−1 cuerdas (ahora sobre
  el radio del EJE = interior + ala/2).
- Cómputo por eslabones (EPS por eslabón; CUS sumando eslabones y dividiendo por 5).
- La CAS no se toca.

## Implementación
- **Regla** — `src/parametric/reglaEslabones.ts`: `RADIO_INTERIOR_EPS_MM = 260`, `RADIO_INTERIOR_CUS_MM = 294`,
  `radioEslabonadaDe(producto, catálogo)` (EPS; CUS Z; CUS G por equivalencia de ancho, ala y espesor con una
  Z, buscada en el catálogo y no por el nombre; si no hay, motivo), `medidasEslabonada({ radioInteriorMm,
  alaMm, anguloDeg })` (eje = interior + ala/2), `motivoAnguloEslabonada` (más de 22,5° y hasta 180°).
  `eslabonesPara` valida; `eslabonesDeAnguloGuardado` cuenta sin validar, para piezas ya colocadas.
- **Definición** — `radio_interior_mm` entra en los parámetros de la definición (y en la huella). Una CUS G
  sin Z equivalente no tiene definición: el motivo es el del radio, no un «sin modelo» genérico.
- **Receta** — `geometry/curvaEslabonada.ts` dibuja sobre el radio de eje. Nota «CONTRADICE AL CATÁLOGO»
  retirada.
- **Piezas ya colocadas** — `outdatedPieces` antepone la causa al motivo geométrico: «cambió la regla de
  radio de las curvas eslabonadas (2026-11-15): radio = ancho (300 mm, sobre el eje) → radio interior 260 mm
  del producto…». Nuevo `piezasSinDefinicionVigente`: las que ya no tienen definición (p. ej. guardadas a
  20°, o una CUS G sin Z equivalente) se listan con su motivo; no se pueden actualizar y se siguen dibujando
  como fueron colocadas. El panel de Bandejas muestra los dos avisos con el motivo de cada pieza.
- **Cómputo** — los eslabones salen sólo del ángulo; una pieza guardada a 20° se sigue computando (2
  eslabones) sin romper Resultados.

## Pruebas
- `curvaEslabonada.test.ts` (26): N = 2 rechazado con el mínimo, el porqué y la alternativa CAS; longitud
  sobre el radio de eje; EPS 260 y CUS Z 294 en todos los anchos (y coincide con `radio_mm = 294`); en 600 ya
  no da el doble; **reparto G/Z sobre el catálogo** (12 con Z equivalente reciben radio con procedencia
  «equivalencia por acabado»; 16 sin Z equivalente, ninguno, todas con chapa 2,1 o ala 150); geometría en 4
  ángulos × 2 sentidos; desactualizadas con el motivo; a 20° listadas como sin definición.
- `longitudesEje.test.ts`: las 31 eslabonadas con definición guardan el polígono sobre el radio de eje; las
  16 CUS G sin radio no se colocan.
- E2E `curvaEslabonada`: valores de la EPS-300 con radio de eje 285; 20° rechazado en la ficha con el motivo
  completo; proyecto con piezas de la regla anterior → aviso con el motivo, «Actualizar» las lleva a la regla
  nueva, la de 20° queda listada sin definición.
- **Controles negativos, verificados**: si toda CUS G recibe radio, fallan 3 pruebas (reparto, maestros,
  longitudes); con la regla anterior (radio de eje = ancho), fallan 7.
- **Pruebas que cambian a propósito** (no se aflojaron): `portFidelity` y `portsOutward` pasan el radio del
  maestro (nuevo `baseParams.radio_interior_mm`, igual que el sentido); `sharedVerticalPatternClosure` sigue
  exigiendo que el maestro de la CUS no hable de «equivalencia» (la de la CUPS): la redacción del maestro se
  ajustó, la prueba no; huellas de las 47 eslabonadas declaradas con su motivo.

## Pendiente para el operador
- (Cerrado) Los ~41 mm de la CUS Z: radio del círculo de pivotes, ver la conclusión en la decisión 1.
- (Cerrado) El texto del rechazo de N = 2 ya distingue el plano del giro: vertical → no hay pieza; horizontal
  → CAS.

## Corrección del texto del rechazo por plano (2026-11-15)
- `motivoAnguloEslabonada(ángulo, plano)` y `planoDeGiro(dirP1, dirP2)` en `reglaEslabones.ts`; la
  corrección del ángulo y la lista de piezas sin definición usan el plano de la pieza colocada.
- Pruebas: texto vertical (por defecto) sin mención de la CAS ni de otro plano; texto horizontal con la CAS;
  plano por geometría; una EPS colocada girando en planta (sección acostada) recibe el texto horizontal.
  E2E: la ficha de una EPS que sube muestra «el catálogo no publica ninguna pieza» y no menciona la CAS.
- **Control negativo, verificado:** si el texto sugiere siempre la CAS, fallan 3 pruebas.

## Verify de cierre (2026-11-15, sobre `b4fd29a`)
Por pasos y en primer plano: tipos OK; vitest 1883/1883 (forks, 2 procesos); motor 190 OK (2 omitidas);
Playwright en 8 tandas **130/130**, 0 fallos, 0 inestables.
