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

## Decisiones pendientes del operador
Ver la sección siguiente (se completa con las respuestas).
