# Reconciliación de modelos patrón — perforada + escalera

Branch: `feat/pattern-models-reconciliation`. Estado: etapa 1 de 8 (matriz + duplicaciones + hipótesis de causa raíz del desfase CUPS). Las etapas posteriores — resolución común, caso CUPS cerrado, patrones restantes, configurador operativo, integración y entrega — se abordan en commits subsiguientes de esta misma rama.

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

### D6 — ⚠️ CUPS.P1_horizontal: v_dir local invertido respecto a TRPS.P1

**Diagnóstico del desfase reportado por el usuario (recto H → CUPS → recto V).**

Comparación de marcos locales al port en cada receta:

| Receta | Puerto | normal | u_dir (ancho) | v_dir (ala) | u×v |
|---|---|---|---|---|---|
| TRPS (`portOnEdgeXZ` en `outlines.ts:83`) | P1 | `(-1,0,0)` | `(0,0,+1)` | `(0,+1,0)` | `(-1,0,0)` ✓ |
| CUPS (`buildCUPSRecipe` en `outlines.ts:496`) | P1_horizontal | `(-1,0,0)` | `(0,0,-1)` | `(0,-1,0)` | `(-1,0,0)` ✓ |

Ambos puertos son right-handed con la misma normal. Pero están rotados 180° entre sí alrededor de `n`. Trazando al mundo con `M_base` (entrada horizontal, φ=0):

| Marco mundo | P2 del recto horizontal saliente | P1_horizontal de CUPS entrante |
|---|---|---|
| n | `(+1,0,0)` | `(-1,0,0)` (opuesto, flush) |
| u (ancho) | `(0,+1,0)` | `(0,+1,0)` ✓ |
| v (ala) | `(0,0,+1)` | `(0,0,-1)` ✗ **180° invertido** |

El recto espera las paredes (rails) hacia +Z (open-top arriba). CUPS.P1_horizontal expone su slot con rails hacia -Z. El cuerpo se conecta de todas formas porque las normales son opuestas y los centros coinciden, pero la sección transversal queda rotada 180°.

Secundario (no confirmado como desfase visual pero coherente): CUPS.P2_vertical mapea al marco de un recto vertical sin invertir — porque el `sectionUp` heurístico (`routingRules.computePortSectionUp`) ya normaliza a `(1,0,0)` perpendicular a la salida. Ese camino "compensa" el desalineamiento por azar, no por diseño.

### D7 — `sectionUp` como corrección local en `routingRules` vs definición del patrón

`routingRules.ts:49-66` deriva `sectionUp` heurísticamente a partir del par horizontal/vertical de puertos. Es una compensación local que se habilitó para sostener la continuación vertical (`parametricBridge.buildFramePlacement`). La definición transversal correcta debe vivir en la receta y no reconstruirse por cada visor.

## 4. Caso CUPS — plan de cierre

1. Repro numérico (vitest): cadena `recto H → CUPS → recto V` que mida (a) continuidad posicional, (b) continuidad de marco transversal (u, v) en cada junta, (c) reproducibilidad preview → confirmado → export/import.
2. Fijar en `buildCUPSRecipe` los `u_dir`/`v_dir` de `P1_horizontal` para que coincidan con el marco que exponen las piezas horizontales (`portOnEdgeXZ`: u=+Z, v=+Y). Reajustar `P2_vertical` en consecuencia manteniendo right-handedness.
3. Confirmar que `TrayObjects.ParametricMesh` (que llama a `placeRecipe` sin `sectionUp`) sigue dando el mismo marco: si no, la definición de la receta debe incluir suficiente info para reconstruirlo sin heurística.
4. Verificar export→import del proyecto: la sección transversal reconstruida al recuperar debe coincidir bit a bit con la del preview.
5. Documentar en `masterModels.ts` CUPS la validación geométrica (estado `validado` con evidencia del repro).

## 5. Resolución común (siguiente etapa)

Autoridad: `masterModels.ts` + `outlines.ts/escaleraOutlines.ts` (geometría y bocas) → `resolvedPortGeometry.resolveRecipeForProduct` (único punto de acceso con overrides aplicados) → `placeRecipe` (una sola implementación para preview y confirmado).

Migración mínima, sin eliminar rutas hasta validar consumidores:

- Unificar la declaración de `canonicalRotationZDeg` en un solo lado (patrón) y consumirlo en `buildRecipeByKey`/`buildCUPSRecipe` vía lectura del maestro.
- Reforzar la validación de nombres de boca en `resolvedPortGeometry` para que overrides inválidos fallen explícitamente.
- Reemplazar la heurística `routingRules.computePortSectionUp` por la lectura directa del `v_dir` mundial del puerto del patrón (ya calculado por `placeRecipe`).
- Dejar fallbacks actuales sólo con `console.warn` explícito mientras haya consumidores legacy.

## 6. Pendientes fuera de esta etapa

- Configurador operativo con filtros perforada / escalera Z / escalera G, apply/cancel/restore, comparar patrón vs variante, probar unión con rectos de referencia (`tasks #203`).
- Integración: configurador, variantes, preview, confirmado, recuperación consumiendo la misma definición efectiva + política de revisión de patrón que no modifica silenciosamente piezas colocadas (`task #204`).
- Entrega final con evidencia de todos los patrones y limitaciones concretas (`task #205`).

## 7. Procedimiento de arranque

`npm run dev:trays` — único procedimiento. Lanza `python server/tray_service.py` (puerto 8765) y Vite (puerto 5173). `vite.config.ts` proxy `/api/motor` → `http://127.0.0.1:8765`.
