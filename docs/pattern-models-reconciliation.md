# Reconciliación de modelos patrón — perforada + escalera

Branch: `feat/pattern-models-reconciliation`.

Estado operativo:

- Caso **CUPS cerrado** para el escenario *recto horizontal → CUPS por `P1_horizontal` → recto vertical por `P2_vertical`*. Regresión: `src/parametric/geometry/__tests__/cupsPortFrameRepro.test.ts` + `src/workspace/__tests__/cupsChainWorldContinuity.test.ts`.
- Caso **D7 pendiente** (ver §3 y §4b): la fuente de `sectionUp` para continuaciones verticales sigue siendo la heurística `routingRules.computePortSectionUp`. No limita el escenario CUPS actual (está verificado que la heurística entrega el mismo `sectionUp` que el `v_dir` mundial del puerto), pero sí **limita el cierre a la boca `P1_horizontal` como entrada** y a `P2_vertical` como salida. Otras combinaciones (p. ej. entrada vertical por `P2_vertical` + salida horizontal por `P1_horizontal`) no están regresionadas.
- **Patrones no-CUPS**: TRPS, CPS-45, CPS-90, TPS, XPS (perforada) y TRES, CS-45, CS-90, TS, XS, RIS (escalera) cumplen la convención común por construcción (helper compartido `portOnEdgeXZ` / `portOnEdge`). Regresión: `src/workspace/__tests__/patternChainContinuity.test.ts` (11 casos: una placa por patrón + una por boca). RIS se verifica a nivel receta (no participa aún en `placeRecipe` interactivo, ver §4c).

## 1. Matriz principal

| Tipo | Familia | Fuente geométrica (archivo) | Bocas (centro, normal, orientación transversal) | Regla de variante | Consumidores |
|---|---|---|---|---|---|
| Recto (TRPS) | Perforada Z | `src/parametric/geometry/outlines.ts:120` `buildTRPSRecipe` (polígono rectangular XZ) | `portOnEdgeXZ` (líneas 83–113): u=±Z, v=+Y, ancho=len(arista), ala=parámetro | `ancho-only-z` (`masterModels.ts:157`) | `parametricBridge.resolveRecipe:310`; `TrayObjects.ParametricMesh:154`; preview configurador |
| Curva 45° (CPS-45) | Perforada Z | `outlines.ts:156` `CPS45_OUTLINE_300` (7 vértices medidos ancho=300) | `portOnEdgeXZ` sobre V0→V1 y V4→V5 | `uniform-xz` (`masterModels.ts:189`) | mismos que TRPS + `continuationCandidates` |
| Curva 90° (CPS-90) | Perforada Z | `outlines.ts:206` `CPS90_OUTLINE_300` (8 vértices) | `portOnEdgeXZ` sobre V0→V1 y V4→V5 | `uniform-xz` (`masterModels.ts:221`) | idem |
| Curva vertical (CUPS) | Perforada Z | `outlines.ts:407` `CUPS_OUTLINE_300_XY_STEP` (8 vértices XY, perfil rotado +45°) | Construcción manual en `buildCUPSRecipe:432` | `depth-only` (`masterModels.ts:253`) | preview + confirmed + overrides configurador |
| Tee simétrica (TPS) | Perforada Z | `outlines.ts:266` `DCPS_OUTLINE_300` (polígono simétrico, archivo `DCPS-300-Z.STEP`) | `portOnEdgeXZ` (tronco_P1, tronco_P2) + manual (boca_derivacion) | `uniform-xz` (`masterModels.ts:290`) | preview + confirmed |
| Derivación (DCPS) | Perforada Z | **Sin patrón** — `masterModels.ts:317` placeholder "pendiente" | — | `none` | — |
| Cruz (XPS) | Perforada Z | `outlines.ts:328` `XPS_OUTLINE_300` (16 vértices) | Construcción manual 4 bocas en `buildXPSRecipe:347` | `uniform-xz` (`masterModels.ts:328`) | preview + confirmed |
| Recto (TRES) | Escalera Z / G | `src/parametric/geometry/escaleraOutlines.ts:46` `TRES_300_065_18_Z` (3000×298.9) | `portOnEdge:44` adaptación de `portOnEdgeXZ` | `ala-independent` (`masterModels.ts:362`) | `parametric/geometry/recipes.ts:145` `buildRecipeByKey('escalera:tramo_recto')` + `LadderPiece.tsx` |
| Curva 45° (CS-45) | Escalera Z / G | `CS_300_45_065_18_Z:65` (8 vértices mitreados) | `buildCS45Recipe:149` | `none` (polígono fijo) | `buildRecipeByKey('escalera:curva_h_45')` |
| Curva 90° (CS-90) | Escalera Z / G | `CS_300_90_065_18_Z:89` (8 vértices) | `buildCS90Recipe:183` | `none` | idem |
| Tee (TS) | Escalera Z / G | `TS_300_065_18_Z:112` (10 vértices) | `buildTSRecipe:217` | `none` | idem |
| Cruz (XS) | Escalera Z / G | `XS_300_065_18_Z:139` (16 vértices) | `buildXSRecipe:254` | `none` | idem |
| Reducción lateral (RIS) | Escalera Z / G | `RIS_15_065_18_Z:176` (6 vértices, 300→150) | `buildRISRecipe:295` (puertos 150 y 300) | `none` | idem |

### Huecos reconocidos (tipos sin patrón hoy)

| Tipo | Causa | Nota |
|---|---|---|
| DCPS (derivación asimétrica) | Sin STEP de referencia | `masterModels.ts:317` marca `catalogSkuPrefixes:['DCPS-']` como pendiente |
| CUPS descendente (CUPS-B) | SAMET sólo publica CUPS-A | `catalog.ts:518` nota; asumible como espejo pendiente de confirmación |
| RCS-30-15, AMPS | No hay STEP ni regla pública | `masterModels.ts:582` nota en reducción_lateral |
| Curva vertical escalera | No listada | Sin maestro dedicado |

## 2. Overrides del configurador

- `src/configurator/catalogConfigStore.ts:42` persiste `ProductPortMapping` en `localStorage` bajo clave `codex:catalogConfig:v1`.
- `modelFrame` (tx/ty/tz + rx/ry/rz Euler XYZ) se aplica en `buildModelFrameMatrix:73` como pretransform raw→canónico.
- `portGeometry` por boca (centerMm, normal, uDir, vDir, installRotationDeg) se aplica en `resolvePort:135` (Rodrigues).
- Consumo en runtime: `resolveRecipeForProduct` (`src/workspace/resolvedPortGeometry.ts:168`) devuelve `{ recipe, preTransform, isIdentity }` — único punto de entrada antes de `placeRecipe`.
- Serialización en proyecto: formato `codex:catalogConfig/1` dentro del archivo exportado (`workspaceFile.ts`).

## 3. Duplicaciones y contradicciones

### D1 — Ala 50 vs 65 mm (ya resuelto operativamente, pero rastro vigente)

- Catálogo SAMET publica 50 mm (`src/parametric/catalog.ts:14-21`).
- STEP aportados muestran bbox 65 mm (nota de procedencia en `outlines.ts:22-24`).
- Fallback `ala_mm = 65` en `parametric/geometry/recipes.ts` para escalera cuando el producto no publica `ala_nominal_mm`.
- Riesgo residual: variante escalera sin snapshot explícito puede caer en el fallback.

### D2 — DCPS vs TPS (mismo archivo, SKU-prefix como discriminador)

- `outlines.ts:253-264` llama al polígono simétrico `DCPS_OUTLINE_300`, aunque corresponde a TPS.
- `masterModels.ts:290-317` separa los maestros por `catalogSkuPrefixes: ['TPS-']` vs `['DCPS-']`.
- Riesgo: un SKU DCPS asimétrico (si llegara) caería en la receta TPS por nombre de archivo.

### D3 — Rotación canónica CUPS (+45°) documentada pero no re-consumida

- `masterModels.ts:253` declara `canonicalRotationZDeg: 45` sólo como metadato.
- `outlines.ts:443-446` aplica la rotación dentro de `buildCUPSRecipe` → el polígono que llega a `placeRecipe` ya está rotado.
- No hay duplicación de aplicación, pero sí duplicación de declaración (puede divergir si uno se edita sin el otro).

### D4 — Mapping boca-receta ↔ puerto-catálogo sin validación cruzada

- `masterModels.ts:124-129` declara `recipePortName` vs `catalogPortName` por boca.
- `resolvedPortGeometry.ts:135-195` acepta overrides por boca sin verificar que el nombre exista en la receta.
- Consecuencia: un override con `portName` desalineado se silencia; el usuario no ve el error.

### D5 — Escalera sin entradas en el catálogo paramétrico legacy

- `parametric/catalog.ts` sólo contiene entradas perforada.
- `parametricBridge.resolveRecipe` recorre `resolveParametricEntryViaMaster` y, para escalera, construye sintéticamente la entrada vía `buildRecipeByKey('escalera:…')` en runtime.
- No es duplicación en sí, pero obliga a mantener coherente: `escaleraRecipes.ts` (geometría) + `masterModels.ts` (reglas) + `buildRecipeByKey` (dispatch).

### D6 — CUPS.P1_horizontal: v_dir local invertido respecto a TRPS.P1 — **CERRADO**

Diagnóstico original: `buildCUPSRecipe` construía `P1_horizontal` con `u_dir=(0,0,-1), v_dir=(0,-1,0)` — right-handed pero rotado 180° alrededor de `n` respecto al marco canónico de `portOnEdgeXZ` (`u=(0,0,+1), v=(0,+1,0)` para `n=(-1,0,0)`).

Fix: `P1_horizontal` se unifica con la convención de `portOnEdgeXZ`/`TRPS.P1`. Consecuencia derivada: la construcción de `P2_vertical` también se re-expresa para preservar `u×v=n` con la nueva convención; el `v_dir` local sigue siendo el mismo (`≈(1,0,0)`) por lo que la heurística `routingRules.computePortSectionUp` (ver D7) sigue entregando valores consistentes.

Regresiones vigentes:

- `src/parametric/geometry/__tests__/cupsPortFrameRepro.test.ts` — snapshot del marco local + orto-normalidad.
- `src/workspace/__tests__/cupsChainWorldContinuity.test.ts` — flush en mundo de ambas juntas (P1_horizontal ↔ TRPS.P2 y P2_vertical ↔ TRPS(vert).P1), midiendo `sectionUp` tanto desde `v_dir` mundial del puerto (ruta canónica futura) como desde la heurística actual.

### D7 — `sectionUp` como corrección local en `routingRules` vs definición del patrón — **PENDIENTE (acotado)**

`routingRules.ts:49-66` deriva `sectionUp` heurísticamente a partir del par horizontal/vertical de puertos. Es una compensación local que se habilitó para sostener la continuación vertical (`parametricBridge.buildFramePlacement`). La definición transversal correcta debe vivir en la receta y consumirse como `port.vDir` mundial sin reconstruirla por visor.

Alcance real del "pendiente":

- **No bloquea el caso CUPS cerrado**: la regresión `cupsChainWorldContinuity.test.ts` demuestra que, con el fix de D6, la heurística `+X proyectado` entrega el mismo marco transversal que el `v_dir` mundial del puerto para la cadena *horizontal → CUPS → vertical*.
- **Bloquea generalizar** a otras combinaciones: entrada por `P2_vertical` + salida por `P1_horizontal` (CUPS recorrida de abajo hacia arriba), encadenar dos CUPS consecutivos, o insertar continuaciones verticales en patrones donde el par de bocas no cumpla la relación horizontal/vertical que asume `computePortSectionUp`.
- **Camino de cierre**: migrar `buildFramePlacement` a leer `sectionUp` directamente de `sourcePort.vDir` (la ruta canónica ya verificada por el test de `cupsChainWorldContinuity`). Al hacerlo, la heurística queda superflua y puede eliminarse — `routingRules.computePortSectionUp` ya no tendrá llamantes.

## 4. Caso CUPS — cierre

### 4a. Escenario efectivamente cerrado

Cadena verificada: **recto horizontal (TRPS) → CUPS entrando por `P1_horizontal` → recto vertical (TRPS) saliendo por `P2_vertical`**.

Invariantes exigidos y regresionados en cada junta:

- (I-pos) Los centros de las bocas coinciden en mundo (tolerancia 1e-2 mm).
- (I-normal) Las normales exteriores son opuestas (tolerancia 1e-6 para normales axis-aligned).
- (I-section) Los marcos transversales comparten "arriba de sección": `v_a_mundo = v_b_mundo` y `u_a_mundo = -u_b_mundo` (consecuencia de u×v=n cuando las normales son opuestas).

Rutas regresionadas para el `sectionUp` del tramo vertical:

- **Canónica (futura)**: `sectionUp = sourcePort.vDir` del `P2_vertical` en mundo.
- **Heurística (presente)**: `sectionUp` via `routingRules.computePortSectionUp` (offset XY entre `P1_horizontal` y `P2_vertical`).

Ambas son flush con el fix de D6; la heurística se mantiene operativa hasta la migración D7.

### 4b. Limitaciones concretas que quedan después del cierre

- **Dirección de recorrido**: sólo se verifica *horizontal → CUPS → vertical*. El recorrido inverso (vertical → CUPS → horizontal) no está regresionado y depende del mismo `computePortSectionUp` evaluado en condiciones no cubiertas. No bloquea el caso del usuario pero no debe anunciarse como cerrado.
- **Dos CUPS encadenadas**: continuación vertical → curva vertical → horizontal (bajar-subir compuesto) no está regresionada.
- **Variantes de CUPS**: sólo CUPS-A (ascendente, STEP publicado). CUPS-B descendente queda pendiente (sin STEP).
- **Overrides del configurador**: `modelFrame` y `portGeometry` sobre CUPS se aplican vía `resolveRecipeForProduct` igual que el resto, pero no se regresionan específicamente para CUPS invertida (p. ej. un `installRotationDeg` sobre `P1_horizontal` podría romper la coincidencia con la heurística D7).

### 4c. Acciones restantes para elevar CUPS a "validado global"

1. Migrar `buildFramePlacement` a consumir `sectionUp = sourcePort.vDir` (una línea en el pipeline + eliminación de `computePortSectionUp`).
2. Añadir regresión del recorrido inverso.
3. Publicar CUPS-B cuando haya STEP o justificar su ausencia.
4. Marcar `provenance: 'validated'` para CUPS en `masterModels.ts` con referencia a los commits que demuestran los invariantes.

## 5. Resolución común (siguiente etapa)

Autoridad: `masterModels.ts` + `outlines.ts/escaleraOutlines.ts` (geometría y bocas) → `resolvedPortGeometry.resolveRecipeForProduct` (único punto de acceso con overrides aplicados) → `placeRecipe` (una sola implementación para preview y confirmado).

Migración mínima, sin eliminar rutas hasta validar consumidores:

- Unificar la declaración de `canonicalRotationZDeg` en un solo lado (patrón) y consumirlo en `buildRecipeByKey`/`buildCUPSRecipe` vía lectura del maestro.
- Reforzar la validación de nombres de boca en `resolvedPortGeometry` para que overrides inválidos fallen explícitamente.
- Reemplazar la heurística `routingRules.computePortSectionUp` por la lectura directa del `v_dir` mundial del puerto del patrón (ya calculado por `placeRecipe`).
- Dejar fallbacks actuales sólo con `console.warn` explícito mientras haya consumidores legacy.

## 5b. Procedimiento común por patrón

Para cada patrón (perforada o escalera), el cierre exige verificar los mismos cinco puntos. Ninguno se corrige por visor: todo cambio consolida la definición compartida (receta + master) y preserva las configuraciones del usuario (overrides persistidos vía `resolveRecipeForProduct`).

1. **Fuente y dimensiones base**: STEP o polígono medido con hash + report JSON cuando corresponde. Registrado en `masterModels.ts:source` y la fila correspondiente de la matriz (§1).
2. **Marco local y bocas**: receta construye cada boca con el helper canónico (`portOnEdgeXZ` para perforada, `portOnEdge` para escalera). Convención compartida: `u × v = n`, `v_dir=(0,+1,0)` en marco local (ala vertical); `u_dir` queda definido por la tangente de la arista. La orto-normalidad se verifica por boca en `patternChainContinuity.test.ts`.
3. **Unión con rectos de referencia**: para cada boca, colocar el recto correspondiente usando `entryDir = port.outwardNormal`, `sectionUp = port.vDir` y exigir flush en mundo (I-pos, I-normal, I-section). Esto fuerza que la convención compartida sea observable, no implícita.
4. **Generación de variantes de ancho/ala según reglas explícitas**: cada master declara su `variationRule` (`ancho-only-z`, `uniform-xz`, `depth-only`, `ala-independent`, `none`) con `provenance` (`measured`, `derived`, `estimated`, `pending`) y `rationale`. Las variantes se derivan por `paramsForMaster` sin copiar polígonos entre SKUs.
5. **Coincidencia configurador = preview = confirmado = recuperación**: una sola ruta de resolución (`resolveRecipeForProduct` → `placeRecipe`) aplica overrides del configurador ANTES de la matriz local→mundo. El formato de persistencia `codex:catalogConfig/1` reserva los overrides en el archivo exportado y los re-aplica al cargar, idéntico bit a bit al preview.

## 5c. Matriz de estado por patrón

Estados: **validado** = regresión flush con rectos + variantes derivables sin alterar polígono / **estimado** = regresión flush pasa pero la regla de variación es `derived`/`estimated` (no medida en múltiples SKUs reales) / **pendiente** = falta STEP o falta regresión.

| Patrón | Sistema | Estado | Regresión | Limitaciones |
|---|---|---|---|---|
| TRPS | Perforada Z | validado | `patternChainContinuity.test.ts > TRPS` | — |
| CPS-45 | Perforada Z | validado | `… > CPS-45` | Regla `uniform-xz`: polígono medido 300, derivado el resto |
| CPS-90 | Perforada Z | validado | `… > CPS-90` | Igual que CPS-45 |
| CUPS | Perforada Z | validado (acotado) | `cupsChainWorldContinuity.test.ts` + `cupsPortFrameRepro.test.ts` | Ver §4b (dirección, encadenamiento, CUPS-B) |
| TPS | Perforada Z | validado | `… > TPS` (3 bocas) | Mismo archivo que DCPS; discriminación por `catalogSkuPrefixes` |
| DCPS | Perforada Z | pendiente | — | Sin STEP de referencia (`masterModels.ts:317`) |
| XPS | Perforada Z | validado | `… > XPS` (4 bocas) | Construcción manual de 4 bocas; regla `uniform-xz` |
| TRES | Escalera Z/G | validado | `… > TRES` | Regla `ala-independent`: una única geometría cubre todas las variantes de ala |
| CS-45 | Escalera Z/G | validado | `… > CS-45` (entrada P2 x_min) | Regla `none` (polígono fijo); variantes de ancho pendientes |
| CS-90 | Escalera Z/G | validado | `… > CS-90` (entrada P2 x_min) | Igual que CS-45 |
| TS | Escalera Z/G | validado | `… > TS` (3 bocas, entrada P2) | Regla `none` |
| XS | Escalera Z/G | validado | `… > XS` (4 bocas, entrada P4) | Regla `none` |
| RIS | Escalera Z/G | validado a nivel receta | `… > RIS` | No participa en `placeRecipe` interactivo (`masterPieceKindToParametric → null` para `reduccion_lateral`); flush verificado al construir receta vía `buildRecipeByKey`. Falta publicar TRES-150 para cerrar el flush world-level de la boca 150 mm |
| Curva vertical escalera | Escalera Z/G | pendiente | — | Sin master declarado |
| RCS-30-15 / AMPS | Escalera Z/G | pendiente | — | Sin STEP ni regla pública (`masterModels.ts:582`) |

## 6. Pendientes fuera de esta etapa

- Configurador operativo con filtros perforada / escalera Z / escalera G, apply/cancel/restore, comparar patrón vs variante, probar unión con rectos de referencia (`tasks #203`).
- Integración: configurador, variantes, preview, confirmado, recuperación consumiendo la misma definición efectiva + política de revisión de patrón que no modifica silenciosamente piezas colocadas (`task #204`).
- Entrega final con evidencia de todos los patrones y limitaciones concretas (`task #205`).

## 7. Procedimiento de arranque

`npm run dev:trays` — único procedimiento. Lanza `python server/tray_service.py` (puerto 8765) y Vite (puerto 5173). `vite.config.ts` proxy `/api/motor` → `http://127.0.0.1:8765`.
