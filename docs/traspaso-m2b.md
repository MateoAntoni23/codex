# Traspaso — Hito 2, fase B (rama `feat/m2b-definicion-unica`)

Estado al 2026-11-11, punto de control después de B-2. **B-3 y B-4 no empezaron.**
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

## B-2 — hecha, último tramo sin empujar al escribir esto (se empuja con este archivo)
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

## Quedó a medias / sin verificar
- **E2E del configurador en ROJO (5), sin reescribir.** Todas usan los campos `cfg-mf-*` (marco del
  modelo, que ya no existe) o exigen que el `modelFrame` rote la malla:
  1. `configuratorCalibrationChain` › "visor del Configurador responde al aplicar modelFrame";
  2. `configuratorCalibrationChain` › "override sobrevive reload de la página";
  3. `configuratorMeshReactivity` › "B. modelFrame rota la MALLA…";
  4. `configuratorOrientacion` › "aplica giro de instalación y modelFrame.rz_deg y persiste tras reload";
  5. `configuratorOrientacion` › "Cancel descarta cambios sin persistir".

  Hay que reescribirlas para la pestaña nueva (corrección por boca y excepción) antes de dar B-2 por
  cerrada. Del mismo lote pasaron calibrationPlayground, configuratorMaestroTab, modeloNoResuelto y
  sharedVerticalPattern.
- `npm run verify` completo de B-2: **no corrido.**
- Aprobaciones: su huella ahora incluye la calibración del patrón, así que toda aprobación previa va a
  figurar como "calibración cambió" tras migrar.
- Pendiente de decidir: si una pieza **sin modelo** debe poder colocarse (hoy tramos y arcos esquemáticos
  con el largo o el radio del catálogo; el radio por defecto 300 ya no existe).
- DCPS: literales a 0,051 mm del STEP; no hay prueba contra el GLB porque fallaría. Decidir antes de B-3.
- `measuredLadder.ts` quedó sin uso en la app (solo lo importan pruebas).
