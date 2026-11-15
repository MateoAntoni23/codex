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
- **CUS Z: NO cierra tal cual**: L crece siempre (95,7 → 122,9). **Sí cierra si las articulaciones están
  ~41 mm por fuera del radio tabulado**: con R + 41,4 mm, L = 130,5 ± 0,3 mm en N = 4…10 (N = 3 da 127,4).
  Es decir, el radio del gráfico de la CUS se mide unos 41 mm por dentro de la línea de articulaciones,
  coherente con «al interior» (decisión 3), aunque no coincide con ala/2 (32,5 mm en ala 65). **No cambia
  lo decidido** (294 interior para 22,5°); queda anotado para el operador.

### 2. N = 2 (θ ≤ 22,5°): se rechaza, sin callejón
El ángulo tiene que ser **mayor que 22,5°** (3 eslabones o más). El motivo dice el ángulo mínimo, que el
gráfico del catálogo arranca en 3 eslabones, y que para un giro horizontal menor está la curva ajustable
CAS (1° a 90°).

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
