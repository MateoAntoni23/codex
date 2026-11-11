# Traspaso — Hito 2, fase B (rama `feat/m2b-definicion-unica`)

Estado al 2026-11-11. **B-2 cerrada y verificada** (`8242769`). Alcance recortado por el operador: ver
"Recorte de alcance" al final.
Base: `a7794b8`. Encargo completo: ver el mensaje del operador "ENCARGO: HITO 2, FASE B".

## Línea base (a7794b8, `npm run verify` aislado)
- Tipos OK · Vitest 1609/1609 · motor 190 OK (2 omitidas) · Playwright 86/86.
- Primera corrida: el motor falló por `test_host_ausente_rechazado` con
  `ConnectionAbortedError [WinError 10053]`. Es intermitente y preexistente (2 de 5 corridas sueltas); está en
  `vendor/`, que no se toca. El servidor responde 403 sin leer el cuerpo y cierra; en Windows el RST
  a veces llega antes que la respuesta.

## B-1 — hecha y empujada
| | Qué | Commit |
|---|---|---|
| 1 | Sin valores por defecto (ala 65, ancho 300, largo 3000, ángulo 90). Un dato que falta → sin definición, con motivo. | `636915f` |
| 2 | `escaleraOutlines.ts` generado (`tools/step_parametric/emit_escalera_outlines.mjs` + `escalera_bocas.json`, regla del ancho de boca). | `36a2add` |
| 3 | Perforada: CPS-45, CPS-90 y XPS generados desde el STEP (`emit_perforada_outlines.mjs`). DCPS NO (literales cuadrados al bbox, 0,051 mm). | `36a2add` |

Hallazgos de B-1:
- **CAS (40 curvas ajustables):** tomaban por desempate silencioso el maestro **CS-45** (el primero de
  la lista) y la receta les ponía **90°** por defecto. Ahora quedan sin definición, con un motivo de
  ángulo ajustable. Pendiente en B-3 (8b): ángulo por instancia, y el motivo "sin modelo geométrico;
  falta el STEP de la pieza".
- 8 curvas FAMIQ "3007": el ángulo falta de verdad (no son ajustables) y no tienen modelo.
- `extract_outlines.py` ya no omitía en silencio (eso se corrigió en la fase A).
  `masterVariants` emparejaba bocas por posición: en la T, P2 y P3 salían intercambiadas.

**PB1** (`huellasCatalogo.test.ts`, base `fixtures/huellas-base.json`, 392 productos con modelo):
cambian 209 huellas, todas declaradas en `fixtures/huellas-cambios.json` con su motivo:
- 40 CAS → sin modelo (B-1.1);
- 40 CS-90, 40 TS y 40 XS de escalera (decimales del JSON en lugar de la transcripción a 0,01 mm;
  máximo 0,002 / 0,005 / 0,004 mm);
- 21 CPS-45, 21 CPS-90 y 7 XPS de perforada (generados del STEP; máximo 0,009 / 0,009 / 0,0042 mm).

TRES, CS-45 y RIS no cambian. B-2 no cambió ninguna huella (la prueba sigue en verde).

**PB2** (`outlinesGenerated.test.ts` y demostración en disco): regenerar con el repo limpio no produce
cambios; alterar un vértice del JSON y regenerar sí. Controles negativos de la regla del ancho incluidos.

## B-2 — cerrada
| | Qué | Commits |
|---|---|---|
| 4 | `definicionEfectiva` (`placement/definitions.ts`) como única puerta a la geometría. El índice por SKU de `parametric/catalog.ts` sale del espacio de trabajo. La escalera se dibuja desde la definición. Se quitaron los `placeRecipe` de reserva. | `6ee27c0`, `17946cf` |
| 5 | Calibración por patrón: corrección por boca en sus propios ejes (`workspace/calibracionPatron.ts`, `placement/calibrarReceta.ts`). Marca "calibración heredada, sin verificar en este ancho". Excepciones explícitas. Sin `modelFrame`. | `0d8442f` + último |
| 6 | Migración de la biblioteca: v1 por SKU → v2 por patrón (`configurator/migracionCalibracion.ts`, store, bloque `codex:library/2`, `projectSession`). | `0d8442f` + último |

**PB3** (`caminoUnicoGeometria.test.ts`): verde. Inyectar imports reales prohibidos en `RoutingObjects`
y `tray/store` la hace fallar (comprobado y revertido). Excepciones declaradas con motivo:
- `parametricBridge`, `resolvedPortGeometry` y `definitions` (motor interno de la definición);
- `placement/migration` (A-10);
- `configurator/migracionCalibracion` (B-2.6).

**PB4** (`calibracionPatronPB4.test.ts`): una corrección de patrón hecha por la acción del configurador
mueve la boca de las 7 variantes de TPS exactamente 5 mm sobre su normal (sin escalar). La 300 sale sin
marca y las demás con la marca de heredada. La pieza ya colocada conserva huella y bocas y queda como
desactualizada. Otro patrón no cambia.

**PB5** (`migracionCalibracion.test.ts`) — **SOLO CON BIBLIOTECAS DE PRUEBA.** La biblioteca real del
operador vive en el `localStorage` de su navegador. No se vio ni se migró en esta sesión: se migra sola
la primera vez que la app hidrata con este código. La v1 queda intacta, se guarda una copia fechada en
`codex:catalogConfig:v1:backup:migracion-v2:<ISO>` y el informe queda en `v2.migradoDesdeV1.informe`.

Escenario de prueba: 6 overrides por SKU.
- **2 → corrección de patrón.** TPS-300: patrón TPS. XPS-300: solo `modelFrame` rígido → corrección nula,
  `modelFrame` informado como descartado.
- **2 → excepción de variante por discrepar.** CPS-300-90 (giro 5°) y CPS-450-90 (giro 7°).
- **1 → pendiente sin aplicar.** Producto inexistente; se conserva el original.
- **1 → solo nombres.** Se conserva tal cual.
- **Ninguna calibración perdida.** Los SKU con calibración propia reproducen sus bocas a ≤ 5e-14 mm.

Diferencias listadas pieza por pieza (variantes que antes heredaban por búsqueda):
- TPS-050/100/150/200/450/600: **3,00 mm**. Antes heredaban sin el centro absoluto; ahora aplican la
  corrección del patrón.
- CPS-050/100/150/200/600-90: **5,00°**. Antes heredaban el giro de la CPS-300; ahora quedan **sin
  calibración**, porque el patrón quedó en conflicto (solo excepciones).
- TRPS (todas) y XPS (todas): iguales.

Defecto encontrado y corregido antes de empujar: `upsertOverride` descartaba la geometría cuando no podía
convertirla (producto fuera del índice). Ahora el override queda intacto y se registra como pendiente.

## Cierre de B-2
- E2E del configurador (5) reescritas para la calibración por patrón (`424921e`). Encontraron que el visor
  no se refrescaba al calibrar (corregido).
- `npm run verify` sobre `424921e`, tras cerrar el Vite y el motor que quedaron abiertos: Playwright 81/87.
  Las 6 fallas eran pruebas que seguían en la biblioteca v1 o el marco del modelo:
  - `entregaFinalUserChain` (3);
  - `proyectoPersistente` A4 y A5, que leían `codex:catalogConfig:v1`;
  - `proyectoPersistente` A3: en la corrida completa la migración superó una espera de 5 s.

  Reescritas en `8242769`.
- **`npm run verify` sobre `8242769`: limpio.** Tipos OK, Vitest 1675/1675, motor 190 OK (2 omitidas),
  Playwright 87/87.
- `measuredLadder.ts` quedó sin uso en la app (solo lo importan pruebas).

## Decisiones del operador tras el punto de control (aplicadas)
- **CAS:** el maestro que tomaban por desempate era el de **CS-45** (verificado con una sonda sobre
  `findMasterForProduct`); la receta ponía 90° por defecto.
- **Decisión 1, DCPS** (`1f8b7e7`, `d277cd6`): fue un **descuido de transcripción**. En el STEP, las bocas
  del tronco (300,951 mm) inclinan 0,0097°; los literales las enderezaban (0 / 449,5 donde el STEP dice
  0,051 / 449,449). Se genera desde el STEP. PB1: +28 huellas declaradas (7 DCPS y 21 TPS).
  `1f8b7e7` se empujó con PB5 en rojo (ruido de 1,2e-6° en la medición de ángulos); `d277cd6` lo corrige.
- **Decisión 3, geometría y no huella** (`15b33ae`): tolerancia de 0,01 mm × max(1, ancho/300) y 0,01°.
  Sobre las 237 huellas cambiadas desde a7794b8:
  - **173** con la misma geometría;
  - **24** con cambio real: DCPS/TPS 100–600, de 0,0185 a 0,111 mm;
  - **40** sin definición (CAS).

  Las aprobaciones guardan la definición aprobada; las anteriores se reconstruyen desde su
  `approvedMapping`. Se corrigió un defecto de c80ea84: la huella de calibración de las aprobaciones no
  cambiaba al calibrar el patrón.
- **Decisión 2, geometría nominal** (`e068eb0`): de 896 productos,
  - **352** tienen modelo medido;
  - **9** tienen geometría nominal suficiente (tramos rectos FAMIQ);
  - **535** no tienen nada: reducciones 126, tapas 111, finales 51, curvas horizontales 49 (ninguna
    declara radio ni ángulo), T 42, otros.

  La procedencia se ve en la escena, la ficha y Resultados. La migración resuelve las piezas nominales.

## B-3 (reducida) — cuarta condición de unión
`placement/joins.ts`. La sección de cada boca sale de su definición guardada, y el ala declarada de
`colocacion.definicion.params.ala_mm`, que es la del catálogo al colocar.
- **Ancho:** la unión es inválida si |La − Lb| > 2 × 0,379 % × max(La, Lb), unos 2,27 mm en 300.
  - **Derivación:** el mayor desvío de una boca medida respecto del nominal, sobre las 361 definiciones,
    es 0,3782 %. Es la CPS-45: 1,134 mm en 300 y 2,269 mm en 600, porque el perfil escala.
  - **Discrimina:** con el peor desvío hacia adentro, cada par de anchos vecinos del catálogo (el paso
    más chico es 44 → 50) queda separado por más que la tolerancia.
  - **Primera versión descartada (1,11 mm):** venía de la regla de bocas de escalera. Rompía recto–CPS-45
    en la cadena del operador (300 contra 301,134).
- **Ala:**
  - si el catálogo declara alas distintas, la unión es inválida;
  - si declara la misma y el modelo mide otra cosa, hay aviso: "la boca del modelo mide X mm de ala y el
    catálogo declara Y mm". El umbral es la tolerancia de posición D-14 (1 mm); las diferencias reales
    son 0 o ≥ 13,44 mm;
  - si falta el dato, "no verificable".
- **Dónde se ve el aviso:** en la fila de la unión (`join-aviso-ala`), en la ficha (`piece-aviso-modelo`),
  en Resultados ("Avisos de modelo", `aviso-modelo-list`) y en el diálogo de unir.
- **No cambia:** el registro guardado de cada unión (`uniones_ws`); la verificación se recalcula en vivo.
- **Otros con el aviso:** las CUS de escalera (curva vertical) también dan aviso de ala, porque usan el
  perfil de 36,56 mm con alas declaradas de 65 a 150.
- **Pruebas:** `anchoBocaJoins.test.ts` (PB6, alas distintas, no verificable, regresión de la cadena,
  derivación sobre el catálogo). `cadenaOperador` E2E (PB9) ahora exige los 4 avisos en las uniones con
  CUPS, 2 en la ficha y 2 filas en Resultados.

## Recorte de alcance (operador, 2026-11-11)
- **Descartado:** reglas nominales para T y X (aunque 40 T y 40 X declaran `radio_mm`); reducciones (les
  falta el largo y el segundo ancho está solo en la descripción); tapas y finales de tramo. Tema de
  modelado para después: tapas y finales no son piezas de recorrido, deberían ser material asociado a una
  pieza.
- **B-3 se reduce a la cuarta condición de unión** (ancho de boca y aviso de ala de las CUPS).
- **POSPUESTOS, no cancelados (no se tocan en esta fase):**
  - **Anclaje de la DCPS (8):** el patrón declara una sola boca (P1). La pieza guarda tramo anfitrión,
    distancia a lo largo del eje y lado; la pose se deriva del anclaje. El anfitrión conserva sus extremos
    y su largo, y mover o rotar el anfitrión arrastra a la DCPS (PB7).
  - **Ángulo por instancia de las CAS (8b):** solo código. Sin rango inventado, se registra quién lo
    declaró y el ángulo entra en la huella. Sin modelo, el motivo es "curva de ángulo ajustable sin modelo
    geométrico; falta el STEP de la pieza"; no se construye desde la curva de 90°. Incluye listar los
    productos que toman prestado un maestro que no es suyo.
- **B-4 (gizmo de rotación) se mantiene completa.**
