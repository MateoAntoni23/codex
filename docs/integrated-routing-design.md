# Diseño integrado de trazado — codex

**Rama base:** `feat/routing-smart-recommendation` · commit `723892c`
**Fecha:** 2026-11-05
**Alcance:** arquitectura, no código funcional

---

## 1. Flujo de usuario y estados

### 1.1 Flujo principal

```
IDLE
  │  Activar "Continuar trazado"
  ▼
SELECTING_PORT
  │  Clic en esfera naranja (puerto libre de cualquier pieza)
  ▼
CONFIGURING_SEGMENT          ← back() → SELECTING_PORT
  │  Producto recomendado pre-seleccionado (mismo producto origen, si es recta)
  │  Solo productos compatibles según COMPATIBILIDADES + D-13
  │  Preview en escena: posición, dirección, longitud editables
  │  Confirmar →
  ├─ compat.ok → COMMIT_DIRECT → IDLE
  └─ !compat.ok (elección excepcional) → CONFIRMING_EXCEPTION → COMMIT_DIRECT → IDLE
```

### 1.2 Derivación intermedia (pendiente de implementar)

```
IDLE → clic en tramo recto → SPLITTING_SEGMENT
  │  Deslizador: distancia desde P1 (mm), editable
  │  Preview: SEG-1a (acortado) + T (nuevo) + SEG-1b (nuevo)
  │  Confirmar: COMMIT_SPLIT (atómico)
  │  Luego: CONFIGURING_SEGMENT desde el puerto libre de la T
```

### 1.3 Estados del store de trazado

```
sin_calcular → calculando → vigente
                          → error
vigente → desactualizado  (cualquier edit() invalida)
```

Regla: ningún resultado se muestra a partir de un estado `desactualizado` sin recalcular.

### 1.4 Estados de compatibilidad de una conexión (producidos por el motor)

```
COMPATIBLE_DOCUMENTADA
COMPATIBLE_DOCUMENTADA + condición EQUIVALENCIA_EXTREMOS_RECTA_D-13
COMPATIBLE_DOCUMENTADA + condición REGLA_DE_FAMILIA_REV-032  (propuesta)
PENDIENTE_DECISION (bloqueos activos: D-03, D-07, D-09, D-11)
```

La UI local añade un estado previo al motor: **SIN_EVIDENCIA_CATALOGO** (lo que hoy muestra `checkDirectCompatibility` antes del commit). Este estado impide confirmar a menos que se aplique el flujo de elección excepcional.

---

## 2. Modelo de entidades, relaciones y unidades

### 2.1 Entidades del trazado (contrato `trazado/1`, motor v0.2.2)

| Entidad | ID | Campos clave | Unidades |
|---|---|---|---|
| Pieza | `instancia_id` | `producto_id`, `longitud_mm?`, `longitud_eje_mm?`, `puertos{}` | mm |
| Conexión | `conexion_id` | `a:[instancia_id, puerto]`, `b:[instancia_id, puerto]` | — |
| Circuito | `circuito_id` | `funcion:'potencia'`, `cable_id`, `cantidad`, `separado`, `recorrido[]` | — |
| Soporte | `soporte_id` | `sistema_soporte_id`, `producto_id`, `instancia_id`, `distancia_desde_P1_mm` | mm |
| Tapa | `tapa_id` | `producto_id`, `sobre:instancia_id` | — |
| Accesorio | `accesorio_id` | `producto_id`, `sobre:instancia_id` | — |
| Conductor PE | `conductor_id` | `recorrido[]`, `inicio:punto_id\|null`, `fin:punto_id\|null` | — |
| Punto equipotencial | `punto_id` | `tipo`, `conductores[]`, `instancias[]`, `conector?`, `conductor_puente?` | — |
| Escenario reserva | — | `circuitos[]` (igual esquema que circuitos) | — |

**Campos globales del `EntradaTrazado`:**
- `tipo_circuito: 'potencia'` (único valor admitido; mando/señal → D-11 pendiente)
- `reserva_solicitada_pct`: número en [0, 100)
- `eje_vertical`: vector unitario 3D (default implícito [0,0,1])

**Nota F12:** el motor no conoce las dimensiones físicas de piezas especiales (T, curvas, reducciones). Solo verifica la coherencia del modelo del CAD: ports coincidentes dentro de 1 mm y enfrentados dentro de 1° (D-14). Las dimensiones físicas reales están pendientes de planos SAMET (F12).

### 2.2 Puerto (TrayPort)

```typescript
{ posicion_mm: [x,y,z],  // mm, sistema Z-up
  direccion: [dx,dy,dz]  // vector unitario, apunta hacia afuera de la pieza }
```

La dirección es el vector **saliente**. Dos puertos que se conectan tienen direcciones opuestas (d₁ · d₂ ≈ −1).

### 2.3 Entidades de servicio (ProjectDataV2 / workspaceFile)

Estas entidades existen en el modelo v2 del workspace pero aún **no** alimentan el trazado. Son la infraestructura hacia la que el trazado eventualmente se vinculará:

| Entidad | Estado | Relevancia futura |
|---|---|---|
| `Element` (13 categorías) | Tipos definidos, no implementados en UI | Orígenes y destinos del trazado |
| `Port` del elemento | Tipos definidos | Puerto de salida del trazado (inicio/fin de circuito) |
| `Connection` cable/manguera | Tipos definidos | Declara que el cable existe, el trazado define por dónde pasa |
| `CableCore` | Tipos definidos | Conductor individual dentro de un circuito |
| `FunctionalRelation` | Tipos definidos | A controla B: define qué conexiones van juntas |

### 2.4 Entidades del catálogo (Context)

| Tabla | Registros actuales | Uso en routing |
|---|---|---|
| PRODUCTOS | ~850 | Selector, tipo, familia, dimensiones |
| PUERTOS_PRODUCTO | ~1 400 | Puerto-level compat, dimensiones por boca |
| COMPATIBILIDADES | 4 373 | `getCompatibleProductIds`, `checkDirectCompatibility` |
| COMPONENTES_UNION | ~400 | Accesorios de unión por conexión (D-24: 1 juego/conexión) |
| FAMILIAS | 9 | Agrupamiento visual en selector |
| cables | 2 datasets | Masa, diámetro, radio mínimo de curvatura |

### 2.5 Unidades explícitas

| Magnitud | Unidad | Notas |
|---|---|---|
| Posiciones | mm | Dominio CAD (Z-up). Visor: m (Y-up), conversión en `toViewer()` |
| Longitudes de piezas | mm | `longitud_mm` (rectos), `longitud_eje_mm` (especiales, solo para PE) |
| Masa de cable | kg/m | Dato de ficha; suma sobre los cables del vano |
| Masa de tapa | kg/m o kg/ud | No publicada aún (F13) → vano NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA |
| Capacidad de soporte | kg/vano | STS-300-Z: 379 kg. Modelo de reparto: pendiente (D-29) |
| Ocupación | mm de ancho | W_ocup por sección; comparación con W_ref según D-04/D-05 |
| Reserva | % | `reserva_solicitada_pct`, criterio D-05 (configurable) |
| PE longitud | mm | Suma eje sin holgura (D-27); holgura = null hasta decisión |

**Principio:** desconocido ≠ cero. Los campos sin dato publican su estado (`NO_VERIFICABLE`, `MODELO_A_CONFIRMAR`) en vez de suponer un valor favorable.

---

## 3. Contrato de una operación

### 3.1 Esquema genérico: planificar → validar → previsualizar → confirmar → deshacer

```
PLANIFICAR
  Usuario indica intención (selecciona puerto, tipo de pieza, longitud)
  → El store transiciona al paso correspondiente del FSM
  → No escribe nada en TrayInput todavía

VALIDAR (síncrono, antes de preview)
  checkDirectCompatibility() → DirectCompatResult { ok, newPiecePort, reason }
  verifyStartPortValid()      → { valid, reason }
  Si !ok y no hay excepción registrada → mostrar razón, bloquear confirmación

PREVISUALIZAR
  PreviewMesh en escena (R3F):
    - Posición = startPort.pos + effDir * length / 2
    - Rotación = alignToDir(effDir)
    - Transparente, sin interacción
  Panel:
    - Producto seleccionado (SKU, familia, dimensiones)
    - Longitud editable
    - Resultado de compatibilidad (compat ID, D-13 si aplica)
    - Accesorios de unión que Python calculará

CONFIRMAR (atómico — un solo trayEdit())
  verifyStartPortValid()      ← re-verificar al momento del commit
  checkDirectCompatibility()  ← re-verificar (fuente única de verdad)
  Si ok:
    buildSegmentPiece(newId, productId, p1, p2)
      p1/p2 dependen de newPiecePort (ver §4)
    next.piezas.push(newPiece)
    next.conexiones.push({ conexion_id, a:[existente, portName], b:[newId, newPiecePort] })
    trayEdit(next)   ← invalida resultado del motor, bump revision
    deactivate()
  Si !ok (concurrent change): mostrar error, no escribir

DESHACER
  Todavía no implementado. Requisito: historial de TrayInput con índice.
  Mientras tanto: cancelar antes del commit es sin costo (nada fue escrito).
```

### 3.2 Atomicidad

Toda operación que escribe en `TrayInput` lo hace en **un solo** `trayEdit(next)` con un `structuredClone` del estado anterior. Esto garantiza que:
- El motor siempre ve un estado coherente.
- Un error antes del commit no deja el trazado parcialmente modificado.
- La revisión se incrementa una sola vez por operación.

### 3.3 Invalidación

`trayEdit()` → `revision++` → `status = 'desactualizado'` → el resultado anterior se descarta. El motor devuelve `vigencia: 'DESACTUALIZADO'` si detecta que la `revision_entrada` del resultado no coincide con la actual; el store también lo detecta por sí mismo.

---

## 4. Resolución única de compatibilidad y relación con Python

### 4.1 El problema actual (resuelto en 723892c)

Había tres resoluciones independientes:

| Punto | Función | Puerto new piece |
|---|---|---|
| Selector de productos | `getCompatibleProductIds` | — (no determina puerto) |
| Panel (UI) | `checkDirectCompatibility(_, _, 'P1')` | hardcoded 'P1' |
| Commit | mismo `checkDirectCompatibility` hardcoded 'P1' | hardcoded 'P1' |

Resultado: `getCompatibleProductIds` encontraba CMP-01535 (P1↔P2) correctamente, pero `checkDirectCompatibility` buscaba P1↔P1 → no encontraba → "Sin evidencia".

### 4.2 Solución implementada: una sola función, una sola llamada

```
getCompatibleProductIds(compatibilidades, existingProductId, portName)
  → Set<productId>  (filtro del selector)
  
checkDirectCompatibility(ctx, existingProduct, existingPort, newProduct, 'P1')
  → DirectCompatResult { ok, newPiecePort, reason, compatibilidadId, ... }
  
  Lógica interna:
  1. Exacta: findCompatEntryPortLevel(existingPort ↔ 'P1')   → newPiecePort='P1'
  2. Alterna: findCompatEntryPortLevel(existingPort ↔ 'P2')  → si D-13: newPiecePort='P1'
                                                               → si no D-13: newPiecePort='P2'
  3. Sin entrada: fallback con motivo (familia, ancho distinto, sin evidencia)
```

**D-13** (decisión del motor, propuesta activa): si ambas piezas son `recta` con igual `ancho_nominal_mm` e igual `ala_nominal_mm`, los extremos P1/P2 son equivalentes. El motor aceptará P1↔P1 aunque el catálogo solo registre P1↔P2. `isD13Equivalent()` en `routingRules.ts` implementa la misma condición.

**El motor es la autoridad sobre fórmulas.** `checkDirectCompatibility` replica la lógica de *selección de entrada* (¿puedo generar esta conexión?), no la lógica de *cálculo* (ocupación, cargas, PE, cómputo). Toda divergencia entre la validación local y el motor debe resolverse actualizando la función local para que coincida.

### 4.3 Qué calcula Python que el CAD no debe replicar

| Cálculo | Dónde vive | Acceso desde CAD |
|---|---|---|
| Ocupación por sección/boca | motor Python | `resultado.ocupacion` |
| Verificación mecánica por vano | motor Python | `resultado.vanos` (dentro de corridas) |
| Componentes de unión (cantidad) | motor Python | `resultado.computo` |
| Longitud del PE (suma de ejes) | motor Python | `resultado.pe.conductores[].longitud_mm` |
| Cobertura equipotencial | motor Python | `resultado.equipotencial` |
| Carga por pieza (vano con tapa) | motor Python | `resultado.cargas_por_pieza` |
| Estado del trazado | motor Python | `resultado.estado_trazado` |
| Corridas y vanos | motor Python | `resultado.corridas` |
| Cómputo BOM | motor Python | `resultado.computo` |

**El CAD no duplica estas fórmulas.** Solo construye la `EntradaTrazado` correcta y presenta el resultado.

### 4.4 Qué calcula/decide el CAD

| Responsabilidad | Función/módulo |
|---|---|
| Qué productos son compatibles con este puerto | `getCompatibleProductIds` |
| Qué puerto de la nueva pieza usar | `checkDirectCompatibility` → `newPiecePort` |
| Geometría de la nueva pieza (posición P1/P2) | `buildSegmentPiece` |
| Generación de IDs únicos | `generateSegmentId`, `generateConnectionId` |
| Verificación del puerto antes del commit | `verifyStartPortValid` |
| Recomendación del mismo producto como origen | `RoutingObjects.onClick` |
| Atomicidad del commit | `trayEdit(structuredClone(next))` |

### 4.5 Elección excepcional (pendiente de implementar — diseño en docs/design-exceptional-product-choice.md)

Cuando `checkDirectCompatibility` devuelve `ok: false`, el usuario puede registrar una excepción:

```typescript
// En TrayInput (workspace-side, no en Solicitud al motor):
excepciones_conexion?: Record<string, {
  motivo: string;
  confirmado_por: string;
  fecha_iso: string;
}>
```

El motor **sigue recibiendo la misma entrada** sin el campo de excepción (no forma parte del contrato). El motor seguirá reportando incompatibilidad. La UI muestra ambos: diagnóstico del motor + motivo del usuario. El campo no afecta la `huella` del motor ni ninguna fórmula.

---

## 5. Dependencias e invalidación de cálculos

### 5.1 Grafo de dependencias

```
TrayInput (piezas, conexiones, circuitos, soportes, tapas, pe, equipotencial)
  │
  │ trayEdit() → revision++
  ▼
Motor Python (resultado vigente)
  ├─ estado_trazado
  ├─ conexiones (compat + encaje)
  ├─ ocupacion (por pieza/boca)
  ├─ corridas → vanos → verificación mecánica
  ├─ computo (BOM con cantidades)
  ├─ pe (longitudes, cobertura)
  ├─ equipotencial
  └─ cargas_por_pieza

Catálogo (Context) ─── cargado en initialize() ────────────────────┐
  PRODUCTOS, COMPATIBILIDADES, PUERTOS_PRODUCTO,                    │
  COMPONENTES_UNION, FAMILIAS, cables                               │
                                                                    │
  Cambio de catálogo (nueva versión del motor) → result = null ◄────┘
```

### 5.2 Reglas de invalidación

| Cambio | Efecto en CAD | Efecto en resultado motor |
|---|---|---|
| Agregar/quitar pieza | `trayEdit()` → `revision++` | Desactualizado; recalcular |
| Cambiar longitud de tramo | `trayEdit()` | Desactualizado |
| Agregar/quitar conexión | `trayEdit()` | Desactualizado |
| Agregar/quitar circuito | `trayEdit()` | Desactualizado |
| Agregar/quitar soporte | `trayEdit()` | Desactualizado |
| Agregar/quitar tapa | `trayEdit()` | Desactualizado |
| Cambiar PE | `trayEdit()` | Desactualizado |
| Nueva versión del catálogo | `context` cambia, resultado = null | Recalcular completo |
| Registrar excepción de conexión | workspace metadata | No afecta motor (no en Solicitud) |

### 5.3 Lo que el motor NO invalida automáticamente desde el CAD

El campo `meta` del `EntradaTrazado` está declarado como "libre; fuera del cálculo y de la huella". Futuras anotaciones de trazado (nombre del trazado, notas) pueden ir en `meta` sin invalidar el cálculo.

---

## 6. Matriz de capacidades: disponible / incompleto / pendiente

### 6.1 Infraestructura

| Capacidad | Estado | Notas |
|---|---|---|
| Tipos TrayInput + contrato motor | **Disponible** | `src/tray/model.ts`, `contrato-1.0.schema.json` |
| Motor Python v0.2.2 | **Disponible** | 190 tests, 78 archivos verificados |
| Cliente HTTP (gestorSolicitudes) | **Disponible** | Vigencia, revisión, validación de sobre |
| Catálogo snapshot (3,9 MB) | **Disponible** | SAMET escalera G/Z/perforada + alambre FAMIQ |
| Datos de cables (Prysmian) | **Disponible** | 2 datasets (Sintenax Valio, Superastic Flex) |
| Export/import workspace | **Disponible** | fileVersion=1, round-trip probado |
| IndexedDB v3 + autosave | **Disponible** | Proyecto y backup de migración |

### 6.2 Routing (trazado)

| Capacidad | Estado | Notas |
|---|---|---|
| Tramos rectos con 2 puertos | **Disponible** | `buildSegmentPiece`, `addTraySegment.ts` |
| Selección de puerto libre | **Disponible** | `getFreePorts`, esferas naranjas |
| Recomendación mismo producto | **Disponible** | `RoutingObjects.tsx` preselección |
| Selector por compatibilidad (port-level) | **Disponible** | `getCompatibleProductIds` |
| D-13 en validación local | **Disponible** | `isD13Equivalent` en `routingRules.ts` |
| `newPiecePort` correcto en commit | **Disponible** | `commitDirect` usa `compat.newPiecePort` |
| Reducción entre anchos distintos | **Disponible (parcial)** | UI existe; geometría bloqueada (F12 pendiente) |
| Curvas horizontales | **Incompleto** | Tipo existe en catálogo (171 productos); UI de creación no implementada |
| Curvas verticales | **Incompleto** | Tipo existe (47); UI no implementada. F11 pendiente (referencia de radio) |
| T y X (derivación) | **Incompleto** | Tipos en catálogo (110 T, 47 X); inserción UI pendiente. Prerequisito: `design-intermediate-derivation.md` |
| Final de tramo | **Incompleto** | 51 productos en catálogo; UI de colocación no implementada |
| Snap al eje | **Disponible** | `snapToAxis` en store + advertencia de ángulo |
| Preview 3D de nuevo tramo | **Disponible** | `RoutingObjects.tsx` → `PreviewMesh` |
| Deshacer operación | **Pendiente** | No implementado. Ver §8 entrega E3 |
| Derivación intermedia (split) | **Pendiente** | Diseñado en `design-intermediate-derivation.md` |
| Elección excepcional | **Pendiente** | Diseñado en `design-exceptional-product-choice.md` |
| Orientación editable de sección | **Pendiente** | `eje_vertical` no expuesto en UI |

### 6.3 Motor Python — lo que calcula actualmente

| Cálculo | Estado | Condiciones / Pendientes |
|---|---|---|
| Compatibilidad de conexiones | **Disponible** | D-13 propuesta, D-13b propuesta, REV-032 |
| Ocupación por sección/boca | **Disponible** | Solo potencia (D-11 pendiente para mando/señal) |
| Cables iguales separados | **Disponible** | D-01 |
| Cables distintos separados | **Bloqueado** | D-03 pendiente |
| Cables en contacto | **Disponible** | D-02 |
| Cables apilados | **Bloqueado** | D-09 pendiente |
| Mezcla separado/contacto | **Bloqueado** | D-07 pendiente |
| Verificación mecánica por vano | **Disponible (parcial)** | Solo luz tabulada exacta (D-22); tapa bloquea (D-25); sin CTA para G115/Z115/perforadas (F1–F9) |
| CTA escalera G65 | **Disponible** | F-001, fila A. Verificación condicionada (D-06b, D-31) |
| CTA escalera Z65 | **Disponible (parcial)** | Fila C "validada por usuario" (REV-043). Sin esquema declarado → CUMPLE_CONDICIONADO |
| CTA perforada / FAMIQ / otros | **No disponible** | F1–F9 pendientes |
| Verificación de curvaturas | **No disponible** | F10 pendiente (radios de cables), F11 (curvas verticales) |
| Componentes de unión (BOM) | **Disponible** | D-24: 1 juego por conexión |
| Cómputo por pieza | **Disponible** | D-18: 1 pieza por instancia |
| PE longitud y cobertura | **Disponible** | D-27: sin holgura |
| PE modelo concreto | **Condicionado** | D-21: modelo a confirmar. Solo Superastic Flex declara verde/amarillo |
| PE posición (D-19) | **Condicionado** | Aprobado por usuario. Hueco PE–potencia sin definir (P-D19c) |
| Equipotencialidad diseño | **Disponible (parcial)** | F17/F18 pendientes (continuidad declarada de uniones, conectores de derivación) |
| Capacidad de soportes | **No disponible** | D-29 pendiente (modelo de reparto) |
| Anclajes | **Fuera de alcance** | REV-016, F16 |
| Cargas con tapa | **No verificable** | F13 pendiente (masa de tapas) |
| Mando/señal/instrumentación | **Bloqueado** | D-11 pendiente |
| Neumática | **Fuera de alcance** | No previsto en contrato v0.2.2 |

### 6.4 Catálogo — cobertura

| Familia | Rectos | Reducciones | T | Curvas | Otros |
|---|---|---|---|---|---|
| SAM-STE-G (escalera G) | 28 | ✓ | ✓ | ✓ | ✓ |
| SAM-STE-Z (escalera Z) | 12 | ✓ | ✓ | ✓ | ✓ |
| SAM-STP-Z (perforada Z) | 7 | ✓ | ✓ | ✓ | ✓ |
| SAM-STP-ZN (perforada color) | 14 | Escasa | — | — | — |
| FAMIQ-ALAMBRE-INOX (alambre inox) | 9 | — | — | — | — |
| G↔Z cross-family | 0 entradas directas | — | — | — | compat. excepcional |

**Inconsistencias conocidas:**
- G↔Z: misma `interfaz_conexion`; 0 entradas directas en COMPATIBILIDADES (REV-032: familias no compatibles por decisión de usuario).
- SAM-STP-ZN: sin entradas cross-family.
- Reducciones: `longitud_comercial_mm: null` en los 126 productos → `geometryDocumented: false` → inserción bloqueada.
- 3 familias con `acabado_normalizado: null`: GEN-FERR, SAM-ESC-TRL, SAM-SMT-ACC.

---

## 7. Plan de migración y conservación de archivos existentes

### 7.1 Lo que se preserva incondicionalmente

| Qué | Dónde | Por qué |
|---|---|---|
| Contrato `trazado/1` | `contrato-1.0.schema.json` | El motor Python lo valida |
| `additionalProperties: false` en EntradaTrazado | Motor | Campo no declarado → ENTRADA_INVALIDA |
| `excepciones_conexion` fuera de Solicitud | workspace metadata, no en `entrada` | No contamina huella ni fórmulas |
| Archivo workspace v1 `{ fileVersion, projectV2, trayInput }` | `workspaceFile.ts` | Round-trip probado; archivos de usuario existentes |
| IDs `SEG-N`, `CON-NNN`, `SOP-N` | convención actual | Pueden existir en archivos persistidos |
| DB_VERSION=3, stores IndexedDB | `db.ts` | Backups de migración ya escritos en campo |
| Motor vendor (78 archivos verificados) | `vendor/motor_bandejas/` | SHA-256 en manifest; no se modifica |

### 7.2 Extensiones compatibles hacia atrás

Estas adiciones **no rompen** archivos existentes porque los campos son opcionales o están en `meta`:

| Extensión | Ubicación | Compatible hacia atrás |
|---|---|---|
| `excepciones_conexion` en workspace | TrayInput (opcional) | Sí; import ignora si falta |
| Notas de trazado | `EntradaTrazado.meta` | Sí; motor ignora `meta` |
| `eje_vertical` en EntradaTrazado | Campo opcional (default [0,0,1]) | Sí |

### 7.3 Cambios que requieren incrementar fileVersion

Ninguno en las entregas E1–E4 del §8. Se incrementará cuando se agreguen entidades al formato de archivo que archivos viejos no puedan leer sin migración.

### 7.4 Nomenclatura de IDs en nuevas entidades

| Entidad | Prefijo | Ejemplo |
|---|---|---|
| Tramo recto | SEG- | SEG-7 |
| T / X (derivación) | DER- | DER-1 |
| Mitad de tramo partido | (preserva SEG-) | SEG-1a, SEG-1b |
| Curva | CRV- | CRV-1 |
| Reducción | RED- | RED-1 |
| Final de tramo | FIN- | FIN-1 |
| Conexión | CON- | CON-007 |
| Soporte | SOP- | SOP-3 |
| Tapa | TAP- | TAP-1 |
| Conductor PE | PE- | PE-1 |
| Punto equipotencial | PEQ- | PEQ-1 |
| Circuito | CIR- | CIR-1 |

---

## 8. Entregas funcionales

Cada entrega: un recorrido completo observable, pruebas de aceptación, sin mezclar con main.

### E1 — Selector y confirmación sin ambigüedad (commit 723892c — ENTREGADO)

**Recorrido:** R1.P1 de SAM_TRES-300-065-18-Z → selector muestra 1 compatible pre-seleccionado → confirmación dice "Compatible según catálogo (CMP-01535) — equivalencia D-13" → Python acepta.

**Pruebas de aceptación (observables):**
1. `npx vitest run src/workspace/__tests__/routingRules.test.ts` → 64/64.
2. Con motor activo: `npx vitest run routing.integration` → tests Z-product pasan.
3. En navegador: activar trazado en R1.P1 → panel muestra "1 compatible", no "Sin evidencia".

---

### E2 — Curvas planas y orientación de sección (siguiente)

**Qué agrega:** herramienta para insertar curva horizontal (90°, 45°, 30°) desde un puerto libre, con elección del producto de catálogo (171 disponibles).

**Recorrido completo:** A.puerto → tramo recto → curva H 90° → tramo recto → Python calcula ocupación + corridas.

**Prerequisito técnico:**
- Geometría de curva: el CAD construye la pieza con `longitud_eje_mm` (para PE). El motor solo necesita el ID de producto, posición de puertos y conexiones. No se requieren F12 (dimensiones físicas de piezas especiales) para insertar; solo para verificar encaje real.
- `tipo_circuito: 'potencia'`; mando/señal bloqueado (D-11).

**Pruebas de aceptación:**
1. Test unitario: `buildCurvePiece(id, productId, p1Pos, p1Dir, p2Dir, lonEje)` → Piece con 2 puertos y `longitud_eje_mm`.
2. Test de integración: trazado con 1 curva → Python no devuelve ENTRADA_INVALIDA.
3. En navegador: tramo + curva + tramo → estado_trazado visible.

---

### E3 — Derivación intermedia con T (implementar design-intermediate-derivation.md)

**Qué agrega:** clic en tramo recto → deslizador de punto → preview SEG-1a + T + SEG-1b → commit atómico que actualiza circuitos, soportes y conexiones.

**Recorrido completo:** trazado con K1 en R1→R2→R3 → insertar T en R2 a 1500 mm desde P1 → ramal K2 → Python calcula ocupación por boca de T.

**Prerequisito técnico:**
- Función `splitSegment(entrada, instanciaId, distanciaMm, tProductId)` → TrayInput. Pura, sin efectos.
- Debe actualizar: `piezas` (SEG-1a, T, SEG-1b), `conexiones` (reconectar), `circuitos[].recorrido` (sustituir SEG-1 por [SEG-1a, T, SEG-1b] en cada circuito que lo contenga), `soportes` (reubicar por posición), `tapas` (reubicar por posición).
- **No actualiza automáticamente:** `pe.conductores[].recorrido` si el recorrido del PE no incluye la pieza partida. Si sí la incluye, debe actualizarse; si no puede resolverse automáticamente, bloquear con mensaje.
- Deshacer: primera implementación de historial (array de TrayInput, índice). Límite: 10 pasos.

**Pruebas de aceptación:**
1. Test unitario: `splitSegment` con 1 circuito → array `recorrido` actualizado; soportes reubicados.
2. Test unitario: `splitSegment` con soporte a 800 mm → soporte queda en SEG-1a a 800 mm.
3. Test de integración: trazado dividido → Python acepta y produce ocupación por boca.
4. En navegador: seleccionar tramo → aparece botón "Insertar derivación" → preview visible → confirmar → 3 piezas en escena.

---

### E4 — Elección excepcional con motivo (implementar design-exceptional-product-choice.md)

**Qué agrega:** "Ver otros productos" en el selector → selector expandido con marcas ⚠ → modal de confirmación con motivo obligatorio → `excepciones_conexion` en archivo exportado.

**Recorrido completo:** R1.P1 de SAM_TRES-150-065-18-G → elegir SAM_TRES-150-065-18-Z (familia distinta, 0 entradas) → modal con "Motivo: cambio de familia aprobado por cliente REF-2026-04" → confirmar → Python reporta incompatibilidad en resultado → UI muestra diagnóstico del motor + motivo registrado.

**Prerequisito técnico:**
- `exceptionalConnection` en `useRoutingStore` (motivo, fecha, confirmado_por).
- En `commitDirect`: si `compat.ok === false && excepcion.motivo`: escribir en `excepciones_conexion`; enviar la misma entrada al motor.
- UI de `TrayResults`: badge ⚠ en conexiones con excepción → tooltip con motivo.
- Export: `excepciones_conexion` en `trayInput` del archivo.
- Import: `excepciones_conexion` restaurado; badge visible sin recalcular.

**Pruebas de aceptación:**
1. Test unitario: `commitDirect` con excepción → conexión en trazado + entrada en `excepciones_conexion`.
2. Round-trip: export con excepción → import → badge ⚠ visible.
3. En navegador: modal visible, confirmación sin motivo bloqueada, motor reporta incompatibilidad visible junto al motivo.

---

### E5 — Circuitos, PE y soportes desde la UI (cubre pasos 7 y 8 del escenario)

**Qué agrega:** formularios para agregar circuitos (cable, cantidad, recorrido sobre piezas existentes), conductor PE (recorrido, puntos equipotenciales), soportes (sistema, producto, posición en tramo).

**Recorrido completo:** trazado de 3 piezas → agregar circuito K1 con 3 × 1×35 → agregar PE → agregar 3 soportes a 1500 mm → Python calcula ocupación, vanos, cobertura PE.

**Prerequisito técnico:**
- Los formularios existen parcialmente en `AddTraySegmentForm.tsx`; necesitan extensión.
- `pe.conductores` requiere al menos 1 conductor (contrato); el primer conductor se crea automáticamente al declarar el PE.

---

## 9. Decisiones pendientes y riesgos concretos

### 9.1 Decisiones del motor que afectan el CAD

| ID | Qué decide | Efecto si no se decide |
|---|---|---|
| D-13 (confirmación usuario) | P1/P2 equivalentes en rectos con igual ancho/ala | Condición visible en resultado; no bloquea; nuestra validación local ya implementa |
| D-21 (modelo PE) | Qué cable PE usar | `MODELO_A_CONFIRMAR` en resultado; Superastic Flex es el único candidato con verde/amarillo |
| P-D19c | Hueco PE–potencia | Condición permanente en resultados hasta que se defina |
| D-03 | Cables separados distintos diámetros | Motor devuelve PENDIENTE_DECISION para ese par; bloquea ese circuito |
| D-11 | Mando/señal en trazado | `tipo_circuito` solo acepta `'potencia'`; bloquea todo el trazado si se declara otro |
| D-23 | Reglas de colocación de soportes | `SIN_REGLA_ACREDITADA` en resultado; no bloquea |
| D-29 | Modelo de reparto de cargas | Capacidad del soporte `NO_VERIFICABLE_SIN_MODELO_DE_REPARTO` |

### 9.2 Datos faltantes que bloquean verificaciones específicas

| Dato | Bloqueo concreto |
|---|---|
| F10: radio de curvatura de cables | Toda verificación de curvatura → NO_VERIFICABLE |
| F12: dimensiones físicas de piezas especiales | Encaje geométrico real de T, curvas, reducciones |
| F13: masa de tapas | Vanos con tapa → NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA |
| F14: luz máxima, voladizos, uniones | Colocación de soportes → SIN_REGLA_ACREDITADA |
| F15: capacidad de soportes y modelo de reparto | NO_VERIFICABLE_SIN_MODELO_DE_REPARTO |
| F17/F18: continuidad declarada de uniones | Equipotencialidad condicionada |
| CTA perforada, G115, Z115 | No verificable para esas familias (F1–F9) |

### 9.3 Riesgos de arquitectura

**R1 — Divergencia CAD–motor en compatibilidad**
Riesgo: `checkDirectCompatibility` local acepta una conexión que Python rechaza (o viceversa). Mitigación: test de integración en `routing.integration.test.ts`; toda divergencia detectada actualiza la función local.

**R2 — Contrato motor sin mando/señal**
Riesgo: escenario de aceptación paso 1 incluye circuitos de control hacia sensores y actuadores. `tipo_circuito: 'potencia'` es el único valor aceptado; D-11 (mando/señal) está pendiente. Mitigación: separar físicamente las bandejas de potencia vs. control/señal y registrarlas como trazados separados hasta que el motor soporte D-11. No falsificar el tipo.

**R3 — Mangueras neumáticas fuera del contrato**
Riesgo: escenario de aceptación paso 6 (neumática hacia actuador) requiere mangueras como entidad separada del cable. El contrato `trazado/1` no tiene campo para mangueras; los circuitos solo aceptan `cable_id` de los datasets Prysmian. Mitigación: modelar recorrido neumático como metadato del workspace (`Connection` con `medium: 'pneumatic'` en el modelo v2 de equipos), no en la `EntradaTrazado`. La coexistencia neumática en bandeja no tiene cobertura de verificación en el motor actual.

**R4 — Geometría de reducciones bloqueada**
`longitud_comercial_mm: null` en los 126 productos de reducción → `geometryDocumented: false`. Inserción bloqueada en UI. No es un bug: es dato faltante real. No estimar longitudes sin fuente documental.

**R5 — Interferencia con paredes (paso 5 del escenario)**
Detección de colisiones entre el trazado y la geometría del edificio requiere:
1. Que el edificio tenga geometría 3D con caras y normales (hoy solo tiene dimensiones escalares en el modelo v2).
2. Un algoritmo de intersección OBB/AABB en el CAD.
3. Una UI para proponer abertura con holgura.
Ninguno de los tres está implementado ni en el plan de entregas actual. Es capacidad nueva que requiere un plan de entrega propio antes de E5.

**R6 — Deshacer**
No existe historial de TrayInput. Cancelar antes del commit es sin costo, pero una vez confirmado no hay deshacer. E3 agrega historial básico (10 pasos). Hasta entonces, la única mitigación es el export previo al edit.

**R7 — Multi-trazado y sentido inverso (paso 6 del escenario)**
Reutilizar bandejas en sentido inverso (un circuito que va de D hacia A usando las mismas piezas) se modela como un circuito con `recorrido` en orden inverso. El motor acepta esto. No hay restricción de dirección en los recorridos. Sin embargo, el CAD actualmente no tiene UI para agregar circuitos a un trazado existente (pendiente E5).

### 9.4 Capacidades del escenario de aceptación — cobertura actual

| Paso | Capacidad requerida | Estado |
|---|---|---|
| 1. Principal con rectos | Rectos, `tipo: 'potencia'`, 3000 mm comercial | **Disponible** |
| 1. Curvas planas | Inserción de curva H | **Pendiente (E2)** |
| 1. Curvas ascendentes/descendentes | Curva vertical | **Pendiente (E2+)** |
| 1. Orientación de sección editable | `eje_vertical` en UI | **Pendiente** |
| 2. T 300/300/300 | Derivación intermedia | **Pendiente (E3)** |
| 2. Reducción 300/150 | UI existe; geometría bloqueada (F12/F14) | **Incompleto** |
| 3. Salida de tablero y bajada al motor | Final de tramo, metraje | **Pendiente** |
| 4. Alambre inox vía excepción | Elección excepcional | **Pendiente (E4)** |
| 5. Atravesar pared — detección | Colisión CAD–edificio | **No planificado (R5)** |
| 6. Circuito neumático | Mangueras en contrato | **No planificado (R3)** |
| 7. PE con el trazado | UI de PE | **Pendiente (E5)** |
| 8. Soportes editables | UI de soportes | **Pendiente (E5)** |
