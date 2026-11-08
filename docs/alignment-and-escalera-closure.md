# Cierre — alineación paramétrica y familia escalera STEP

Rama: `feat/ladder-routing-alignment`
SHA en `origin`: `a668afae8cde51e744a7d844ddd35b41aca33e3e`
Fecha: 2026-11-08

Este documento consolida la evidencia de cierre de A1–A3 (alineación
TRPS/CPS en paramétrico), la tabla de STEP de escalera analizados (C1–C3,
D1), y aclaraciones de alcance.

---

## 1. A1–A3 — Alineación visual TRPS/CPS (preview ↔ confirmed)

**Escenario**: proyecto real con tres piezas conectadas tramo→curva→tramo
sobre la familia paramétrica (TRPS-300-22-Z + CPS-300-90-Z). Camino
reproducido en `e2e/trpsCpsAlignment.visual.spec.ts` sobre el dev server
`http://localhost:5173` con dataset del motor 0.2.2.

### Medición directa (vuelta derecha, quiralidad nativa)

Reporte de la escena 3D (dump R3F en mm globales Z-up):

```
CONFIRMED (right turn)
  T1 (TRPS-300-22-Z)  chirality=native  mirrored=false
     placedP1=(0.000, 0.000, 0.000)  placedP2=(3000.000, 0.000, 0.000)
  CRV-1 (CPS-300-90-Z)  chirality=native  mirrored=false
     placedP1=(3000.000, 0.000, 0.000)  placedP2=(3593.161, -595.427, 0.000)
  SEG-1 (TRPS-300-22-Z)  chirality=native  mirrored=false
     placedP1=(3593.161, -595.427, 0.000)  placedP2=(3579.912, -3595.398, 0.000)

PREVIEW (misma curva)
  preview.placedP1   = (3000.000, 0.000, 0.000)
  preview.placedP2   = (3593.161, -595.427, 0.000)
  confirmed CRV.placedP1 = (3000.000, 0.000, 0.000)
  confirmed CRV.placedP2 = (3593.161, -595.427, 0.000)

Δ P1 preview ↔ confirmed = 0.0000 mm
Δ P2 preview ↔ confirmed = 0.0000 mm
max |Δ matrixWorld|      = 0.000e+0

gap CON-001  T1.P2   ↔ CRV-1.P1  = 0.0000 mm
gap CON-002  CRV-1.P2 ↔ SEG-1.P1 = 0.0000 mm
```

### Vuelta izquierda (quiralidad mirrored)

```
LEFT: CRV-1  chirality=mirrored  mirrored=true
  placedP1 = (3000.000, 0.000, 0.000)
  placedP2 = (3593.161, 595.427, 0.000)
```

Simétrico exacto (±Y) respecto a la vuelta derecha. Sin deriva.

### Conclusión A1–A3

- **A1 (diagnóstico)**: no hay desfase visual residual entre `preview` y
  `confirmed` ni entre piezas vecinas. Δ matrixWorld = 0 a precisión
  flotante, gaps = 0 mm.
- **A2 (unificación)**: preview y confirmed consumen el mismo
  `placeRecipe` del puente paramétrico (`src/workspace/parametricBridge.ts`).
  La matriz canónica y las bocas son idénticas byte-a-byte.
- **A3 (pipeline STEP→malla→mundo)**: el commit `78dcb76` (previo a esta
  rama) corrige el marco GLB y aplica calibración persistente de malla;
  el paso restante de alineación mesh↔polígono se cubre en el pipeline
  `AlignedGlb` de `ParametricScene.tsx`. Los tests Playwright miden
  directamente `object.matrixWorld` de los `Object3D` de R3F, no un
  bbox aproximado — no hay vía para que el error se "oculte" en la
  renderización.

Capturas: `e2e/output/01-confirmed-right.png`,
`e2e/output/02-preview-right.png`, `e2e/output/03-confirmed-left.png`.
Dumps: `e2e/output/confirmed-right.dump.json`,
`e2e/output/preview-right.dump.json`,
`e2e/output/confirmed-left.dump.json`.

Comando de reproducción (requiere dev server activo):

```
npx playwright test trpsCpsAlignment.visual.spec.ts
```

---

## 2. Familia escalera STEP — cobertura

Fuente: `C:\Users\Usuario\Desktop\step samet\Familia 300 Ala 65\
Archivos STP\escalera`.
Extracción: `tools/step_parametric/extract_outlines.py` (CadQuery 2.7 + OCP).
Reporte crudo: `tools/step_parametric/report/escalera/*.json`.
Catálogo: `src/parametric/geometry/escaleraOutlines.ts`.

Los anchos de boca medidos son **298.9 mm** (nominal 300); se registra el
valor medido tal cual. La altura de perfil (ala) medida es **65 mm** en
todos los STEP, consistente con la familia ala 65.

| Archivo STEP | SHA-256 (primeros 8) | SKU en catálogo | Vértices polígono | Bocas (`boundary_edges` como puertos) | bbox local [X, Z, Y=ala] mm | Variantes generadas | Datos medidos vs estimados |
|---|---|---|---|---|---|---|---|
| `TRES-300-065-18-Z.STEP` | `76f3fbb4` | `SAM_TRES-300-065-18-Z` | 4 | 2 (P1: x_min len 298.9, P2: x_max len 298.9) | 3000 × 298.9 × 65 | 1 — recto 3000 mm | Todo medido. Rails z_min/z_max (3000 mm) se ignoran como puertos; entran como polilíneas en `segmentRailsFromOutline`. |
| `CS-300-45-065-18-Z.STEP` | `2f572cc3` | `SAM_CS-300-45-065-18-Z` | 8 (mitreada) | 2 (P1: z_max len 298.9, P2: x_min len 213.27) | 541.80 × 652.57 × 65 | 1 — curva 45° mitreada | Todo medido. El radio nominal NO figura: el STEP presenta polígono mitreado de 8 vértices, no un arco. No se infiere radio. |
| `CS-300-90-065-18-Z.STEP` | `e110db9d` | `SAM_CS-300-90-065-18-Z` | 8 (mitreada) | 2 (P1: z_min len 333.0, P2: x_min len 332.91) | 744.12 × 744.03 × 65 | 1 — curva 90° mitreada | Todo medido. Las bocas tienen longitud 333 mm (no 298.9) porque corresponden al mitre externo; el arco interno es más corto (ver `segmentRailsFromOutline`). |
| `TS-300-065-18-Z.STEP` | `7e10f01e` | `SAM_TS-300-065-18-Z` | 10 | 3 (P1: z_min, P2: x_max, P3: z_max — todas ≈ 298.9) | 743.46 × 1189.0 × 65 | 1 — Tee simétrica | Todo medido. Arista x_min (1189 mm) es rail de tronco, no puerto. |
| `XS-300-065-18-Z.STEP` | `4731b052` | `SAM_XS-300-065-18-Z` | 16 | 4 (P1..P4 simétricas, cada boca 298.9) | 1187.94 × 1187.94 × 65 | 1 — Cruz simétrica | Todo medido. Cuatro rails intermedios entre bocas (segmentos de 209 mm) quedan como aristas no-puerto. |
| `RIS-15-065-18-Z.STEP` | `93957e14` | `SAM_RIS-15-065-18-Z` | 6 (asimétrica) | 2 (P1: z_min len 148.9 "boca estrecha", P2: z_max len 298.9 "boca ancha") | 298.9 × 450.0 × 65 | 1 — reducción lateral 300↔150 | Todo medido. Asimetría 74.448 (centroide boca estrecha X) vs 149.452 (centroide boca ancha X) — rechazada una pose simétrica en test. |
| `RCS-30-15-065-18-Z.STEP` | `1e30e0fc` | — pendiente — | — | — | 298.9 × 450.0 × 65 (bbox cruda, ejes rotados) | — | **No integrado**. STEP con eje longitudinal en Y (en vez de X o Z); el extractor actual asume eje libre en el plano XZ. Documentado en `escaleraOutlines.ts:202-203`. |

Notas:
- Los SHA-256 completos están en `tools/step_parametric/report/escalera/inventory.json`.
- Las "variantes generadas" aquí son **reconstrucciones 1:1** del STEP,
  no familias paramétricas de longitudes/radios. La única familia con
  parámetro variable es `TRES-300-065-18-Z`, cuya longitud puede
  cambiarse por el `longitud_mm` de la pieza cuando se usa como tramo
  recto base (el renderer `measuredLadder.ts` mantiene el perfil medido
  y escala sólo la coordenada longitudinal).
- La longitud de arco de las curvas CS-45/CS-90 NO se extrapola a otros
  radios: cada SKU tiene su polígono medido y punto.

Cobertura del catálogo escalera Z 300 (según archivos STP aportados): 6/7
analizados, 6/6 extraídos a polígono, 6/6 enganchados al render
(`ESCALERA_OUTLINES_BY_SKU`). Resta `RCS-30-15` por orientación.

---

## 3. Alcance del historial

`trayStore.edit()` empuja a `history` / `future` arrays en memoria
(`src/tray/store.ts`) y es consumido por los botones ↩/↪ del inspector
y por el atajo del navegador. Alcance:

- **Vigente** durante la sesión. Las pilas se limpian al llamar
  `importEdit` (p.ej. al cargar un proyecto nuevo) o al refrescar la
  página.
- **No persiste** al cerrar/recargar la pestaña. El estado del `trayInput`
  sí persiste si el usuario exporta el workspace (Export JSON) o si
  dispara el save a disco explícito. El historial no se serializa.

La calibración del mesh (`useCalibrationStore`, parámetrica) sí es
persistente a través de `localStorage` (clave `parametric.calibrations.v1`)
porque es un ajuste del modelo, no de la sesión de edición.

---

## 4. Procesos activos y endpoints

```
:5173  node.exe (PID 3372)  — Vite dev server (npm run dev:trays)
:5556  node.exe (PID 5480)  — Vite dev server (instancia adicional)
:8765  python.exe (PID 27384) — Motor de bandejas (tray_service.py)
```

Ambas instancias de Vite proxyan `/api/motor/*` → `http://127.0.0.1:8765/*`
según `vite.config.ts`. Verificación directa:

```
curl -s http://127.0.0.1:8765/v1/salud                 → 200 {"estado":"ok","version_motor":"0.2.2",...}
curl -s http://localhost:5173/api/motor/v1/salud       → 200 (proxied)
curl -s http://localhost:5556/api/motor/v1/salud       → 200 (proxied)
```

El proceso en `:5556` **es** sólo Vite, como señalaste — pero su
`/api/motor/v1/salud` responde correctamente porque la proxy a `:8765`
está bien configurada en `vite.config.ts`. No requiere corrección; el
origen del motor (Python) es `127.0.0.1:8765`.

---

## 5. Checks finales (SHA `a668afae`)

- `npx tsc --noEmit` → OK
- `npx vitest run` → 37 files / 860 tests / 0 fallos (12 s)
- `npx playwright test` → 10 / 10 tests (1.1 min) en Chromium con dev
  server `:5173`
- `npm run build` → bundle 1,420.39 kB / 396.12 kB gz / build 7.5 s

Push:

```
origin/feat/ladder-routing-alignment = a668afae8cde51e744a7d844ddd35b41aca33e3e
```
