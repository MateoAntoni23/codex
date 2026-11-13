# Traspaso — curvas eslabonadas con ángulo por instancia (rama `feat/curvas-eslabonadas`)

Base: `main` (`655f3c0`). Los pendientes vigentes siguen en `traspaso-recorridos.md`.

## Las piezas
- **Perforada:** EPS-{ancho}-Z, «ESLABÓN UNIVERSAL — Curva eslabonada Smarttray». Anchos 50 a 600, ala única
  50. El catálogo la vende **por eslabón** («la curva vertical se arma con la cantidad que requiera la
  instalación»).
- **Escalera:** CUS-{ancho}-5-{ala}-{espesor}-{G|Z}, «CURVA VERTICAL (Articulated Bend)». Anchos 150, 300,
  450 y 600; alas 65, 90, 115 y 150. El «5» del código es la cantidad de eslabones que trae.
- **No hay CUS de 50 ni de 100:** en esos anchos sólo existe la perforada (verificado sobre el catálogo).

## Por qué se retira la «equivalencia autorizada» de la CUS
- **Qué era:** desde 2026-11-10 la CUS se modelaba como curva vertical **rígida**, con el perfil medido de la
  CUPS perforada («equivalencia conceptual autorizada», `master:escalera:curva_vertical` → `buildCUPSRecipe`).
- **Por qué estaba mal:** el catálogo la describe como «Articulated Bend», una cadena de 5 eslabones con ángulo
  ajustable. No es un codo de chapa plegada; son piezas distintas.
- **El aviso que lo delataba:** en las 40 CUS saltaba «la boca del modelo mide 36,56 mm de ala y el catálogo
  declara 65/90/115/150». No era una tolerancia mal puesta: el modelo era el de otra pieza.
- **Ahora:** la CUS (`master:escalera:curva_eslabonada`) y la EPS (`master:perforada:curva_eslabonada`) usan
  la receta eslabonada. Las bocas son P1/P2 y llevan el ala del catálogo, así que el aviso desaparece.
- **Mapeo de bocas:** se retiró también el de `catalogPortMapping` (P1_horizontal/P2_vertical) para las 40 CUS.

## Geometría — declarada por el operador (2026-11-13), con esa procedencia
`src/parametric/reglaEslabones.ts` (regla) y `src/parametric/geometry/curvaEslabonada.ts` (receta):
- **Radio de giro:** el ancho de la bandeja.
- **Articulaciones:** cada una cubre 22,5°.
- **Eslabones:** N = techo(θ / 22,5°) + 1, con 90° → 5 y 45° → 3.
- **Longitud de eje:** el polígono de N−1 cuerdas sobre ese radio, no el arco. A 90° y ancho 300 da 468,2 mm;
  el arco daría 471,2.
- **Boca de salida:** la de entrada girada θ alrededor del centro.
- **Ángulo:** 90° por defecto. Se cambia en la ficha de la pieza («Curva eslabonada»: ángulo, eslabones, eje).
  - Al cambiarlo se recalculan bocas, longitud y eslabones, y la pieza se vuelve a colocar desde su boca de
    entrada, que no se mueve.
  - Las uniones de la boca que se mueve no se tocan: si dejan de cumplir quedan en Uniones con su motivo
    («no cumple …») y la ficha avisa cuántas.
- **Dibujo:** esquemático. Una banda del ancho de la bandeja (espesor = ala) sobre el polígono de cuerdas. Los
  eslabones no se modelan uno por uno.
- **Marco y sentido:** se usan los de la CUPS. Sube o baja se elige al colocar, tanto en la EPS como en la CUS.

**Dos decisiones mías, a confirmar:**
1. **Ángulos que no son múltiplo de 22,5°** (la regla de techo los admite: 30° → 3 eslabones). θ se reparte en
   las N−1 articulaciones por igual (cada una ≤ 22,5°). En los múltiplos da exactamente cuerdas de 22,5°.
2. **Dónde se mide el radio:** sobre el eje de la pieza (a media ala), que es donde están los centros de boca.
   Si el operador lo quería sobre el fondo o sobre el borde interior, cambia una sola línea.

Rango del ángulo por instancia: 1° a 180°. El catálogo no declara rango.

## Datos que contradicen al catálogo (anotados, no corregidos)
- **Ángulo:** el catálogo no lo declara («ángulo ajustable»). Todo lo de arriba es declarado por el operador.
- **Radio:** el catálogo **sí trae** un radio aproximado, leído de un gráfico por cantidad de eslabones, distinto
  de radio = ancho:
  - **EPS:** 3→150, 4→200, 5→260, 6→330, 7→415, 8→450, 9→500, 10→590 mm;
  - **CUS línea Z:** 3→125, 4→210, 5→294, 6→376, 7→460, 8→540, 9→625, 10→705 mm. Además, `radio_mm = 294` está
    cargado en las 12 CUS Z, con «referencia del radio no especificada»;
  - **CUS línea G:** «radio no declarado».

  Ejemplo: en ancho 300 a 90° (5 eslabones) la regla da 300 mm; el gráfico da 260 mm (EPS) o 294 mm (CUS Z).
  Está escrito en el maestro y en la receta.
- **El motor usa el `radio_mm` del catálogo.** Para el radio de curvatura del cable (`evaluar_curvatura`), en
  las CUS Z ve 294 mm, no el de la regla. Lo dejo anotado; no se tocó.

## Cómputo (`src/workspace/computoEslabonado.ts`)
- **Qué hace el motor:** cuenta «D-18: 1 pieza comercial por instancia». En Resultados esa línea queda marcada
  «curva eslabonada: reemplazada por la cuenta de eslabones». El resultado del motor no se modifica.
- **Perforada:** N eslabones → N × EPS-{ancho}-Z.
- **Escalera:** se suman los eslabones de todo el proyecto por código (ancho, ala, espesor y acabado) y recién
  ahí se divide por 5, redondeando hacia arriba. Ejemplos:
  - cuatro curvas de 45° son 12 eslabones → **3** códigos; curva por curva serían 4;
  - dos curvas de 45° dan 2 de las dos maneras (6 → 2, o 1 + 1), así que ese caso no discrimina.
- **Resultados, sección «Curvas eslabonadas»:** los eslabones por curva (ángulo, N y eje) y los códigos a
  comprar, con la cuenta escrita.

## Proyectos anteriores con CUS — leer antes de abrir uno
- **Qué pasa al abrirlos:** las CUS ya colocadas aparecen **desactualizadas** (A-6, huella distinta; las 40 CUS
  declaradas en PB1). No cambian solas.
- **Qué hace «Actualizar»:** adopta la definición nueva **conservando la pose**. Como la geometría y los nombres
  de boca cambian (P1_horizontal → P1, P2_vertical → P2), esas piezas se mueven y sus uniones quedan marcadas
  como que no cumplen (no se borran, y se puede deshacer).
- **Recomendado:** borrar y volver a colocar cada CUS. Una migración automática que renombre bocas y recoloque
  desde la boca de entrada queda **pendiente**; no la hice.

## Pruebas
- `curvaEslabonada.test.ts` (20):
  - la regla (90 → 5, 45 → 3, 22,5 → 2, 30 → 3, 180 → 9);
  - la longitud de eje (cuerdas, no arco);
  - la geometría en 4 ángulos × 2 sentidos (P2 girada θ a radio R, giro medido = θ, marcos derechos, ala del
    catálogo);
  - los maestros (las 7 EPS y las 40 CUS resuelven y son colocables; ninguna CUS de 50/100; sin aviso de ala);
  - la huella por ángulo;
  - el cambio de ángulo (P1 fija; P2 y longitud recalculadas; 5 → 3);
  - el cómputo (EPS 5 y 3; 2 × 45° → 2; **4 × 45° → 3, no 4**; agrupa por código).
- `curvaVerticalSentido.test.ts`: la CUS y la EPS suben o bajan según lo elegido y el recto siguiente une.
- `longitudesEje.test.ts`: las 47 eslabonadas guardan el polígono de cuerdas; las 14 CUPS, la línea media.
- **Control negativo**, verificado: con la regla de eslabones devolviendo un número fijo fallan 7 pruebas
  unitarias y las 2 E2E.
- E2E `curvaEslabonada` (gestos reales):
  - **perforada 300:** a 90° → 5 EPS-300-Z. Al cambiar a 45° → 3, la boca de salida y la longitud se
    recalculan y la unión con el recto vertical queda «no cumple». El motor real calcula, y su línea de 1 pieza
    queda marcada como reemplazada;
  - **escalera 300 ala 65:** cuatro curvas de 45° → 4 × 3 = 12 eslabones → 3 códigos CUS-300-5-065-18-Z.
- E2E actualizadas a P1/P2: `curvaVerticalSentido` (CUS) y `escaleraVerticalChain`.

## Verify completo: Playwright se corre POR TANDAS (no intentar la corrida única)
- `npm run verify` ahora termina con `npm run test:e2e:tandas` (`scripts/e2e-tandas.mjs`), no con
  `playwright test` de una sola vez. Lo mismo al correrlo a mano: las cuatro suites por separado, y la de
  Playwright por tandas.
- **Por qué:** con un solo proceso, los 104 contextos de navegador (WebGL por software) corren en serie y el
  pico de memoria llega pasada la mitad. En este equipo (8 GB) Claude Code mató la corrida única por falta de
  memoria cuatro veces el 2026-11-13 (la última en la prueba 39 de 104, sin fallas hasta ahí). Cerrar
  aplicaciones no alcanzó.
- **Cómo:** el script reparte los archivos de `e2e/` en 4 tandas de cantidad pareja de pruebas (26 cada una,
  reparto codicioso por archivo) y corre cada tanda en su propio proceso `playwright test`, una después de
  otra. Cada tanda levanta sus servidores, arranca limpia y libera al terminar. Logs en
  `e2e/output/tandas/tanda-N.log`; al final imprime el combinado (total de pruebas y de fallas). No cambia
  qué se verifica ni el tiempo total.
- **Si una tanda se corta por memoria:** partila en dos (`node scripts/e2e-tandas.mjs --archivos …` con la
  mitad de sus archivos cada vez, o `--tandas 5`) y seguí. No subir esperas ni desactivar el control de
  memoria. `--solo N` corre solo la tanda N.
- **Verify de cierre de esta rama (2026-11-13), por tandas:** tipos OK; vitest 1789/1789; motor 190 OK
  (2 omitidas); Playwright 104/104. Ninguna tanda se cortó por memoria. En la primera pasada la tanda 2 dio
  24/26: `entregaFinalUserChain` (TRPS 450 heredada) y `proyectoPersistente` A3 agotaron el tiempo total de
  la prueba (180 s y 150 s), esperando que cargara la app o el configurador. Solos pasaron 12/12 y la tanda 2
  repetida completa dio 26/26. Se registran como lentitud del equipo, no como regresión; si vuelven a
  aparecer, investigarlas antes de subir esperas.
