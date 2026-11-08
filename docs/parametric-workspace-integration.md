# Integración paramétrica en el workspace de trazado

**Rama:** `feat/parametric-geometry-fidelity`
**Fecha:** 2026-11-07
**Alcance:** correcciones al catálogo y propuesta de integración (sin implementación)

---

## 1. Correcciones al mapa de cobertura

### 1.1 Errores previos a descartar

| Afirmación anterior | Corrección |
|---|---|
| ACPS-300-Z = reducción / adaptador de ancho | **ACPS-300-Z = acometida para tablero.** Es la pieza que empalma una bandeja con la entrada a un tablero. No cambia el ancho del trazado. |
| ACPS-300/200-Z = SKU de reducción | **No existe en el snapshot.** Inventado. Eliminar de cualquier lista. |
| CUPS-D-300-Z | Nomenclatura correcta: **CUPS-300-D-Z** (sufijo A/D va antes del espesor-Z, según el catálogo SAMET). |
| EMTS / EMPS = empalmes mecánicos neutros al trazado | **EMTS / EMPS son embudos de bajada** (perpendicular y paralelo). Afectan geometría, agregan boca vertical y cambian el recorrido. Son piezas de trazado, no accesorios. |
| CUPS-300-D-Z = reflexión de CUPS-300-A-Z | Hipótesis **sin evidencia**. No usar el master de CUPS-A para derivar CUPS-D hasta analizar su STEP. |
| EPS acepta cualquier θ ∈ [0, 90] | Rango **no verificado**. El catálogo declara EPS como articulada, pero los pasos admitidos y la geometría en los extremos deben leerse del STEP antes de parametrizar θ. |

### 1.2 Lista revisada — solo SKU presentes en `catalogo_bandejas_snapshot.json`

Prioridad reducida a lo que el catálogo soporta hoy. Todo lo marcado "pendiente STEP" requiere lectura previa del maestro con el toolchain CadQuery antes de pedir generador.

| # | SKU catálogo | Función del trazado | Generador reusable | ¿Master nuevo? | Parámetros del catálogo | Pendiente de medir |
|---|---|---|---|---|---|---|
| 1 | **TPS-NN-Z** (familia T simétrica) | Ramal 90° con tres bocas equivalentes | `derivacion_lateral.py` como base; **no** cubre TPS tal cual (DCPS tiene chaflán asimétrico; TPS no). Nota 2026-11-07: el STEP `DCPS-300-Z.STEP` que alimenta el polígono actual presenta forma **simétrica** en X — compatible con TPS. Identificación DCPS vs TPS pendiente de contraste con maestro oficial. | Sí | ancho, espesor, los tres puertos | polígono real, radios internos, posición de bocas |
| 2 | **CUPS-300-D-Z** | Curva vertical descendente | `curva_vertical.py` **a verificar**; no asumir reflexión | Sí (hasta confirmar) | ancho, espesor | polígono, posición de chaflanes, orientación |
| 3 | **EMTS-NN-Z** / **EMPS-NN-Z** | Embudo de bajada (perpendicular / paralelo); añade boca vertical al trazado | Nuevo (no es ni recto, ni curva, ni T) | Sí | ancho entrada, salida vertical, espesor | polígono completo, ángulo de garganta, altura |
| 4 | **RFPS-NN-Z** | Final de tramo (cierre) | Derivable de `tramo_recto.py` con 1 boca | No (recorte del recto) | ancho, espesor | profundidad del faldón |
| 5 | **EPS-NN-Z** | Curva vertical articulada, θ variable | `curva_vertical.py` con θ libre, **pendiente rango** | A confirmar | ancho, espesor, θ | pasos angulares válidos, geometría en extremos |
| 6 | **ACPS-NN-Z** | Acometida a tablero (no reducción) | Nuevo; no es recto ni curva | Sí | ancho de entrada, interfaz tablero | geometría exacta de acople |

Reducción de ancho propiamente dicha: **no figura en el snapshot como SKU separado**. Antes de proponer un generador de reducción hay que verificar con catálogo si SAMET resuelve el cambio de ancho con pieza específica o con solape de tramos.

---

## 2. Próxima integración — trazado recto → curva horizontal → recto

### 2.1 Decisión de arquitectura

**No se crea una red paralela.** La fuente de verdad es el estado que ya existe:

- `src/tray/model.ts` — `TrayInput { piezas, conexiones, pe, ... }`
- `src/workspace/useWorkspaceStore.ts` — selección, capas, herramienta de conexión
- `src/tray/store.ts` — snapshots, `undo()` / `redo()`, invocación del motor
- `src/workspace/workspaceOperation.ts` — `planAddSegment` / `planAddCurve` / `applyOperation`
- `src/workspace/workspaceFile.ts` — `exportWorkspace` / `importWorkspace`

Las recetas paramétricas (`src/parametric/catalog.ts`) aportan **geometría 3D y marco completo de boca** (posición + normal + `u` + `v` + `kind`). El modelo `Piece` del workspace permanece intacto: `puertos: { posicion_mm, direccion }` sigue siendo el contrato con el motor.

El puente es un **índice recipe-por-producto**: dado un `producto_id` (ya en el catálogo SAMET), resolver la receta paramétrica aplicable para render y para enriquecer la validación geométrica. Ese índice es un *selector derivado* del estado principal, no un nuevo store.

### 2.2 Alcance de esta iteración

Solo las dos primeras piezas confirmadas:

- **TRPS-300-22-Z** (recto)
- **CPS-300-45-Z** y **CPS-300-90-Z** (curva horizontal)

Flujo objetivo: partir de una boca libre, agregar un recto, agregar una curva, agregar otro recto. Sin T, sin X, sin curva vertical en esta iteración.

### 2.3 Flujo UI (reusa herramientas existentes)

1. **Seleccionar puerto** — la herramienta `connectionToolActive` + `connectionPortA` del `useWorkspaceStore` (líneas ~31) ya identifica `[instancia_id, puerto_id]` desde el panel de ruteo. Reuso directo.
2. **Recomendar recto o curva** — a partir del puerto seleccionado, consultar el catálogo SAMET por productos con `ancho_nominal_mm` compatible y marcar cuáles son `tramo_recto` vs `curva_horizontal`. Render de dos tarjetas: "Recto TRPS" / "Curva CPS 45°/90°".
3. **Previsualizar** — invocar `planAddSegment` / `planAddCurve` (ya existen) para obtener un `PendingSegmentAddition` sin tocar `TrayInput`. Render del mesh paramétrico de la receta correspondiente anclado al puerto, en modo "fantasma" (opacidad reducida). La previsualización vive en el store de UI, no en `TrayInput`.
4. **Confirmar** — `applyOperation(entrada, pending, peDecision)` se despacha a `useTrayStore.edit()`, que empuja a `history` y permite `undo()` / `redo()`.
5. **Propuesta PE** — `findPeExtensionProposal` ya está en `workspaceOperation.ts:114`. Para rectos y curvas (2 bocas) marca `status: 'ready'` cuando corresponde. El panel PE (`RoutingPanel.tsx`) ya lo muestra. Sin cambios.
6. **Calcular con Python** — `useTrayStore.calculate()` (`src/tray/store.ts:75`) ya envía `toMotorEntrada(input)` al motor vía `POST /api/motor/v1/calcular`. El motor opera sobre el modelo lógico (`producto_id`, `puertos` simplificados); la geometría paramétrica no se le envía. Sin cambios.
7. **Deshacer / rehacer** — `undo()` / `redo()` ya existen en `tray/store.ts:56–73`. No requiere trabajo nuevo.
8. **Exportar / importar** — `exportWorkspace` / `importWorkspace` (`workspaceFile.ts:40–88`) ya serializan `TrayInput` completo. Como no se agrega estado nuevo, no requiere trabajo nuevo.

### 2.4 Separación obligatoria — encaje geométrico vs. compatibilidad técnica

Son dos chequeos distintos y se evalúan en orden:

- **Encaje geométrico** (nuevo, aportado por la capa paramétrica)
  - ¿La posición de la nueva boca coincide con la boca ancla? (|Δ| < ε)
  - ¿La normal entrante es antiparalela a la normal del ancla? (|cos θ + 1| < ε)
  - ¿La orientación de la sección (vector `u` del marco de boca) rota lo esperado? (sin volteos espurios)
  - *Falla aquí* ⇒ "no encaja físicamente"; no se consulta compatibilidad técnica.
- **Compatibilidad técnica** (ya existe: `DirectCompatResult` en `routingRules.ts`)
  - ¿Ancho nominal igual? ¿Serie compatible? ¿Pieza válida en este punto del recorrido?
  - *Falla aquí* ⇒ "encaja mecánicamente pero no es la pieza correcta" (ej. requiere adaptador, o la serie no permite esa unión).

**Regla explícita:** igual ancho **no** garantiza compatibilidad; una boca modelada **no** demuestra compatibilidad mecánica. El UI presenta ambos chequeos por separado en el detalle de la propuesta.

### 2.5 Posiciones conservadas, sin movimientos en cascada

Las piezas ya colocadas **no se mueven**. La propuesta coloca la nueva pieza en el extremo libre del puerto seleccionado y nada más. Si el usuario quiere realinear un ramal completo, debe existir una operación explícita futura (fuera de alcance de esta iteración) que:

- se registre en `history` como un snapshot atómico, deshacible con `undo()`;
- declare el conjunto afectado antes de ejecutar;
- no se dispare como efecto lateral de agregar una pieza.

### 2.6 Diseño que contempla ramificaciones y futuras interconexiones

El modelo `conexiones: { conexion_id, a, b }[]` ya es un grafo general (no un árbol). Las operaciones de esta iteración lo preservan:

- Una boca libre puede ser extremo de recorrido (grado 1) o punto medio futuro (grado ≥ 2) sin cambios de esquema.
- Cuando se agreguen T/X en próximas iteraciones, se anexan como nodos de grado 3 ó 4 en el mismo grafo — sin rehacer el store.
- La resolución de pose del nuevo nodo depende **solo** del puerto ancla elegido, no de la "dirección padre→hijo"; interconectar dos ramales existentes será una operación de cerrar ciclo, no de mover un árbol.

### 2.7 Archivos afectados

Nuevo:

- `src/workspace/parametricBridge.ts` — resolvedor `productoId → recipeId`, chequeo de encaje geométrico (centros, normales, `u`); puro, testeable, sin efectos.
- `src/workspace/PreviewPiece.tsx` (o similar) — componente R3F que monta el mesh paramétrico de un `PendingOperation` en modo fantasma usando las utilidades ya existentes de `src/parametric/ParametricScene.tsx` (refactorizar lo mínimo para exportarlas).

Extendidos (sin cambios de contrato):

- `src/workspace/RoutingPanel.tsx` — dos tarjetas "Recto / Curva" cuando hay puerto seleccionado; ya renderiza PE.
- `src/workspace/useWorkspaceStore.ts` — opcional: campo `pendingPreview: PendingOperation | null` solo para el fantasma de previsualización (no se persiste, no entra en `TrayInput`).

Sin cambios:

- `src/tray/model.ts`, `src/tray/store.ts`, `src/tray/client.ts`
- `src/workspace/workspaceOperation.ts`, `src/workspace/addTraySegment.ts`, `src/workspace/addCurvePiece.ts`, `src/workspace/routingRules.ts`
- `src/workspace/workspaceFile.ts`
- `src/parametric/*` (sigue aislado para `?pilot=step`; se reutilizan utilidades de mesh sin acoplamiento)
- `tools/step_parametric/**` y motor Python (`vendor/motor_bandejas/**`)

### 2.8 Criterios de aceptación

- **AC1 — Fuente de verdad única.** Ninguna pieza existe fuera de `TrayInput.piezas`. El preview no se guarda en estado persistido.
- **AC2 — Seleccionar puerto.** Click en una boca libre activa `connectionPortA` y abre el panel de recomendación.
- **AC3 — Recomendación.** El panel lista exactamente los productos del catálogo SAMET con `ancho_nominal_mm` igual al del puerto, filtrados por `tramo_recto` y `curva_horizontal`.
- **AC4 — Preview.** Elegir una tarjeta renderiza el mesh paramétrico anclado, sin modificar `TrayInput` ni `history`.
- **AC5 — Encaje geométrico separado.** El preview expone en UI tres estados: posición OK, normal OK, orientación OK. Un falso cualquiera bloquea confirmar y muestra el motivo.
- **AC6 — Compatibilidad técnica separada.** El preview expone adicionalmente el resultado de `DirectCompatResult`. Puede ser OK cuando el encaje falla, o viceversa; ambos deben estar en verde para habilitar "confirmar".
- **AC7 — Confirmar.** Aceptar llama a `applyOperation` + `useTrayStore.edit()`; la nueva pieza aparece en `TrayInput.piezas` y la conexión en `TrayInput.conexiones` con `conexion_id` único.
- **AC8 — Propuesta PE.** Si `pendingOperation.peExtension !== null`, el panel PE existente muestra la propuesta; estado `ready` extiende `recorrido` en commit, `pending` no.
- **AC9 — Motor Python.** Tras confirmar, `calculate()` devuelve `version_motor === '0.2.2'` y acepta el nuevo `TrayInput` sin errores de validación. No se envía geometría paramétrica al motor.
- **AC10 — Undo/Redo.** `undo()` retira la pieza + conexión + eventual extensión PE en un solo paso; `redo()` las restaura idénticas.
- **AC11 — Posiciones preservadas.** Ninguna pieza previa cambia de `posicion_mm` ni de `direccion` al agregar la nueva. Test que compara snapshot antes/después.
- **AC12 — Export/Import round-trip.** Un proyecto con `recto → curva 45° → recto` exportado e importado produce `TrayInput` byte-idéntico (JSON estable) y el render es visualmente igual.
- **AC13 — Aislamiento parametric.** `?pilot=step` sigue funcionando con su store aislado; el cambio no rompe `ParametricScene`.
- **AC14 — Grafo, no árbol.** Un test añade dos recorridos que convergen en una boca libre común (preparando futura cruz) y confirma que `conexiones` acepta grado ≥ 2 sin romper `undo`/`redo` ni export/import.

### 2.9 Fuera de alcance de esta iteración

- T horizontal (TPS) y cruz (XPS): no se agregan tarjetas aun aunque el generador XPS exista — falta validar TPS.
- Curva vertical (CUPS-A / CUPS-D): la fidelidad geométrica ya está, pero el flujo de conexión vertical se trata en una iteración posterior.
- Embudos EMTS/EMPS, EPS, ACPS, RFPS: requieren lectura de STEP primero.
- Reducción de ancho: pendiente de verificar SKU en catálogo.
- Cerrar ciclo entre dos ramales existentes: operación futura explícita.
