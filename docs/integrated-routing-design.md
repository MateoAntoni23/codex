# Diseño integrado de trazado — codex

**Rama base:** `feat/workspace-routing-operations`
**Fecha:** 2026-11-05
**Alcance:** arquitectura OBJETIVO — incluye capacidades pendientes de implementar

---

## 1. Capas de la arquitectura

### 1.1 Separación conceptual

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RED FÍSICA                                                              │
│  Piezas de bandeja y sus conexiones físicas                             │
│  rectos · curvas · T · X · reducciones · finales · tapas · soportes    │
│  Entidades: Pieza + Conexión + Soporte + Tapa                           │
│  Unidades: mm, Z-up                                                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ define dónde van los servicios
┌──────────────────────────▼──────────────────────────────────────────────┐
│  RECORRIDOS                                                              │
│  Qué servicio pasa por qué secuencia de piezas físicas                  │
│  Entidades: Circuito + ConductorPE + PuntoEquipotencial                 │
│  Cambio en red física que afecta un recorrido → actualizar recorrido    │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ declara qué recorren
┌──────────────────────────▼──────────────────────────────────────────────┐
│  CONEXIONES DE SERVICIO                                                  │
│  El cable/manguera como entidad de proyecto (origen, destino, función)  │
│  medium: 'power' | 'control' | 'signal' | 'pneumatic'                  │
│  Entidades: Connection + Element + Port (ProjectDataV2)                 │
│  Verificación: habilitada (potencia) · pendiente (control/señal/neumát) │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ envía a
┌──────────────────────────▼──────────────────────────────────────────────┐
│  ADAPTADOR PYTHON                                                        │
│  Traduce el modelo CAD al protocolo del motor (trazado/1)               │
│  Gestiona solicitudes: vigencia, revisión, sobre                        │
│  Presenta resultado: conexiones, ocupación, corridas, computo, PE       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Principio de separación:** cada capa tiene su propio ciclo de invalidación. Un cambio en la red física invalida el resultado del motor. Un cambio en conexiones de servicio (ProjectDataV2) no invalida la red física. Los recorridos vinculan ambas capas.

### 1.2 Qué vive en cada capa

| Capa | Almacenamiento | Contrato | Invalidación |
|---|---|---|---|
| Red física | `TrayInput.piezas + conexiones + soportes + tapas` | `trazado/1` | `trayEdit()` → `revision++` |
| Recorridos | `TrayInput.circuitos + pe + equipotencial` | `trazado/1` | `trayEdit()` → `revision++` |
| Conexiones de servicio | `ProjectDataV2.connections + elements + ports` | workspace v1 | edición de proyecto |
| Adaptador Python | `gestorSolicitudes`, `client.ts`, resultado | HTTP REST | resultado se descarta al desactualizar |

### 1.3 Control, señal y mangueras — modelables, verificación pendiente

El CAD puede modelar recorridos de control/señal y neumáticos **en la capa de conexiones de servicio** (`ProjectDataV2.connections` con `medium: 'control' | 'signal' | 'pneumatic'`). Son datos de proyecto válidos aunque el motor aún no los verifique.

**Lo que el motor no hace todavía** (entrega de ampliación E-CTL, no exclusión de función):
- `tipo_circuito` solo acepta `'potencia'` (D-11 pendiente para mando/señal)
- `EntradaTrazado` no tiene campo para mangueras (R-MAN)
- Verificación de ocupación conjunta potencia+control: pendiente (D-11)

**Regla:** no declarar `tipo_circuito: 'mando'` ni incluir mangueras en `circuitos[]` hasta que el motor amplíe el contrato. Registrarlos en la capa de conexiones de servicio no contamina el trazado.

---

## 2. Inventario del catálogo

### 2.1 Productos por familia — 896 en total

| Familia | Rectos | Curvas H | Curvas V | T / X | Reducciones | Finales | Notas |
|---|---|---|---|---|---|---|---|
| SAM-STE-G (escalera G) | 28 | ✓ | ✓ | ✓ | ✓ | ✓ | CTA G65 disponible |
| SAM-STE-Z (escalera Z) | 12 | ✓ | ✓ | ✓ | ✓ | ✓ | CTA Z65 condicional |
| SAM-STP-Z (perforada Z) | 7 | ✓ | ✓ | ✓ | **0 cargadas** | ✓ | Sin reducciones en catálogo |
| SAM-STP-ZN (perforada color) | 14 | — | — | — | Escasa | — | Sin entradas cross-family |
| FAMIQ-ALAMBRE-INOX | 9 | **✓** | — | **✓** | — | — | Curvas H y T disponibles |
| GEN-FERR / SAM-SMT-ACC / SAM-ESC-TRL | — | — | — | — | — | — | Accesorios y herrajes |

**Correcciones respecto a versión anterior del documento:**
- **Total real: 896 productos** (no ~850)
- **FAMIQ-ALAMBRE-INOX tiene curvas horizontales y T** (no solo rectos)
- **SAM-STP-Z (perforada Z): 0 reducciones** — sin entradas en COMPATIBILIDADES para reducción entre productos Z; `longitud_comercial_mm: null` en candidatos

### 2.2 Tablas del catálogo

| Tabla | Registros | Uso en routing |
|---|---|---|
| PRODUCTOS | 896 | Selector, tipo, familia, dimensiones |
| PUERTOS_PRODUCTO | ~1 400 | Puerto-level compat, dimensiones por boca |
| COMPATIBILIDADES | 4 373 | `getCompatibleProductIds`, `checkDirectCompatibility` |
| COMPONENTES_UNION | ~400 | Accesorios de unión por conexión (D-24) |
| FAMILIAS | 9 | Agrupamiento visual en selector |
| cables | 2 datasets | Masa, diámetro, radio mínimo de curvatura |

### 2.3 Restricciones de catálogo conocidas

| Restricción | Efecto concreto |
|---|---|
| `longitud_comercial_mm: null` en reducciones | Inserción bloqueada (geometría no documentada) — E-RED |
| 0 reducciones SAM-STP-Z | No es posible reducir dentro de familia perforada Z |
| G↔Z: 0 entradas directas en COMPATIBILIDADES | Solo vía elección excepcional con motivo — E4 |
| `tipo_circuito: 'potencia'` único | Control/señal: no verificable en motor actual — E-CTL |
| CTA solo para G65 y Z65 | Perforada, alambre FAMIQ, G115, Z115: NO_VERIFICABLE_CTA |
| Sin masa de tapas (F13) | Vanos con tapa: NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA |

---

## 3. Contrato de resolución de continuación

Una sola función — `resolveContinuation` — es la fuente de verdad para todo lo que el CAD decide al agregar una pieza desde un puerto existente. Las implementaciones actuales (`getCompatibleProductIds` + `checkDirectCompatibility`) son la aproximación parcial correcta; `resolveContinuation` las agrupa.

### 3.1 Interfaz objetivo

```typescript
interface ContinuationQuery {
  existingProduct: Product;
  existingPortName: string;
  newProduct: Product;
  requestedNewPortName: 'P1'; // solicitud inicial siempre P1
}

interface ContinuationResult {
  ok: boolean;

  // Si ok: qué agregar
  newPiecePort: string;          // 'P1' | 'P2' — qué puerto de la pieza nueva conectar
  orientation: 'direct' | 'reversed'; // si 'reversed': buildSegmentPiece(id, prod, endPos, startPos)
  compatibilidadId: string | null;
  accessories: string[];         // product_ids de COMPONENTES_UNION para esta conexión

  // Siempre presente
  evidence: {
    catalogMatch: boolean;       // hay entrada en COMPATIBILIDADES
    d13Applied: boolean;         // se aplicó equivalencia D-13
    d13Conditions: string | null; // "ancho 150mm, ala null" si d13Applied
  };
  pending: string[];             // IDs de decisiones del motor pendientes que afectan esta unión
  reason: string;                // mensaje legible para el usuario

  // Si !ok: qué proponer
  candidates: string[];          // product_ids compatibles (alternativas sugeridas)
}
```

### 3.2 Implementación actual vs. objetivo

| Función actual | Responsabilidad cubierta | Estado |
|---|---|---|
| `getCompatibleProductIds` | `candidates` y filtro del selector | Implementado (commit 51ca581) |
| `checkDirectCompatibility` | `ok`, `newPiecePort`, `orientation`, `reason` | Implementado (commit 723892c) |
| `getUnionComponents` | `accessories` | **No implementado** |
| `getPendingDecisions` | `pending` | **No implementado** |

Mientras `resolveContinuation` no esté unificado, las dos funciones separadas son la implementación correcta. Toda llamada en el panel y en `commitDirect` usa **la misma función** con los mismos argumentos.

### 3.3 D-13 — condiciones exactas

**Decisión del motor (propuesta activa, pendiente confirmación usuario):** dos piezas de tipo `recta` con igual `ancho_nominal_mm` e igual `ala_nominal_mm` tienen extremos P1/P2 equivalentes. El motor acepta P1↔P1 aunque el catálogo solo registre P1↔P2.

**Condiciones en `isD13Equivalent(a, b)` (`routingRules.ts`):**
- `a.tipo_pieza === 'recta'` y `b.tipo_pieza === 'recta'`
- `a.ancho_nominal_mm != null && a.ancho_nominal_mm === b.ancho_nominal_mm`
- `alaA === alaB` (si ambos `undefined`: igual → D-13 aplica; uno número y otro undefined: distinto → D-13 no aplica)

**Lo que D-13 no hace:**
- No aplica a curvas, T, reducciones (solo rectas)
- No aplica si los anchos difieren
- Interfaz de conexión: pendiente confirmar si debe agregarse como condición adicional

### 3.4 Dónde se llama (actualmente `checkDirectCompatibility`)

| Momento | Por qué | Regla |
|---|---|---|
| Al seleccionar producto en panel | Mostrar evidencia en tiempo real | Solo UI, no escribe |
| Al confirmar (`commitDirect`) | Re-verificar antes de escribir | Fuente única; si cambió → error |
| Al pre-filtrar selector | Eliminar candidatos inválidos | Puede usar `getCompatibleProductIds` (más rápido) |

### 3.5 Puerto y orientación de la pieza nueva

```
checkDirectCompatibility(ctx, existingProd, existingPort, newProd, 'P1')

Paso 1 — match exacto:
  findCompatEntryPortLevel(existingPort ↔ 'P1')
  → ok=true, newPiecePort='P1', orientation='direct'

Paso 2 — puerto alterno:
  findCompatEntryPortLevel(existingPort ↔ 'P2')
  → si D-13 aplica: ok=true, newPiecePort='P1', orientation='direct'
      (el motor acepta P1↔P1; no hay reversión de geometría)
  → si D-13 no aplica: ok=true, newPiecePort='P2', orientation='reversed'
      (buildSegmentPiece recibe endPos, startPos invertidos)

Paso 3 — sin entrada: ok=false, candidates=getCompatibleProductIds(...)
```

**Cuando `orientation='reversed'`:**
```typescript
const newPiece = newPiecePort === 'P2'
  ? buildSegmentPiece(newId, productId, endPos, startPos)   // P1 queda en endPos
  : buildSegmentPiece(newId, productId, startPos, endPos);  // normal
```

---

## 4. Escenario A–B–C–D completo

El escenario de aceptación del producto cubre el trazado desde un tablero principal (A) hasta una máquina (D) con derivación (B) y equipo de campo (C). Todos los pasos son requisito del producto aunque la implementación sea progresiva.

### 4.1 Topología del escenario

```
A. Tablero principal (origen)
   │
   ├─ SEG-1: tramo recto (3000 mm, escalera G150×65)
   │
   ├─ CRV-1: curva horizontal 90° (G150×65)
   │
   ├─ SEG-2: tramo recto (continúa)
   │
   ├─ DER-1: T 300/150/300 ← deriva hacia B
   │  │
   │  └─ SEG-3: tramo recto 150 mm
   │       RED-1: reducción 150→100 mm
   │       CRV-2: bajada vertical
   │       FIN-1: final de tramo
   │
   │       Circuito K1 (potencia, 3×1×35 mm² Prysmian)
   │       Soportes STS cada 1500 mm
   │
   │   B. Máquina / variador
   │
   ├─ RED-2: reducción 300→150 (tramo a C)
   │
   ├─ CRV-3: curva vertical + bajada
   │
   ├─ SEG-4: tramo recto (150 mm, sala de máquinas)
   │
   └─ FIN-2: final de tramo
        C. Sensor de campo / actuador
        Circuito control/señal (conexión de servicio, medium:'control')
        Manguera neumática hacia actuador (medium:'pneumatic')

D. Circuito K2: mismo trazado en sentido D→A
   recorrido: [SEG-4, CRV-3, RED-2, SEG-2, DER-1, CRV-1, SEG-1]

Infraestructura transversal:
   Conductor PE a lo largo del trazado
   3 puntos equipotenciales (tablero, T, máquina)
   Tapas en SEG-4 (sala de máquinas)
   Pared: abertura 155×70 mm a 2100 mm de altura (entre A y C)
```

### 4.2 Estado de implementación por paso

| Paso | Capacidad | Estado actual | Entrega |
|---|---|---|---|
| Rectos escalera G potencia | Tramos rectos, confirmación sin ambigüedad | **Disponible** | — |
| Curva horizontal (CRV-1, CRV-3) | `buildCurvePiece`, UI de inserción | **Pendiente** | E2 |
| `eje_vertical` editable | Campo en UI | **Pendiente** | E2 |
| Curva vertical (CRV-2) | `buildCurvePiece` vertical | **Pendiente** | E2+ |
| T 300/150/300 (DER-1) | `splitSegment` + UI derivación | **Pendiente** | E3 |
| Reducción 300→150 (RED-1, RED-2) | UI existe; geometría bloqueada (F12) | **Incompleto** | E-RED |
| Final de tramo (FIN-1, FIN-2) | UI colocación + `buildEndPiece` | **Pendiente** | E-FIN |
| Circuito potencia K1 | UI formulario circuito | **Pendiente** | E5 |
| Soportes STS | UI formulario soporte | **Pendiente** | E5 |
| Circuito K2 — recorrido inverso | Motor acepta orden inverso | **Motor acepta** | E5 (UI) |
| Circuito control/señal | `medium:'control'` en ProjectDataV2 | **Parcial (tipo)** | E-CTL |
| Manguera neumática | `medium:'pneumatic'` en ProjectDataV2 | **Parcial (tipo)** | E-CTL |
| Control verificado motor | D-11 pendiente | **Pendiente (motor)** | E-CTL |
| Conductor PE | UI formulario PE | **Pendiente** | E5 |
| Puntos equipotenciales | UI formulario PE | **Pendiente** | E5 |
| Tapas | UI colocación | **Pendiente** | E5 |
| Pared — detección colisión | Geometría 3D edificio + OBB/AABB | **No planificado** | E-COL |
| Pared — UI abertura | Diálogo holgura + registro | **No planificado** | E-COL |
| Elección excepcional G↔Z | Modal de motivo, `excepciones_conexion` | **Pendiente** | E4 |

### 4.3 Recorrido inverso — modelo

Un circuito que va de D hacia A usando las mismas piezas se modela con `recorrido[]` en orden inverso:

```json
{
  "circuito_id": "CIR-K2",
  "funcion": "potencia",
  "cable_id": "SINTENAX_35",
  "cantidad": 3,
  "separado": false,
  "recorrido": ["SEG-4", "CRV-3", "RED-2", "SEG-2", "DER-1", "CRV-1", "SEG-1"]
}
```

El motor acepta recorridos en orden inverso sin restricción de dirección. La UI de circuitos (E5) debe permitir definir el orden explícitamente.

---

## 5. Contrato de operación global

### 5.1 Ciclo planificar → validar → previsualizar → confirmar → deshacer

```
PLANIFICAR
  Usuario indica intención (puerto, tipo de pieza, producto, posición, longitud)
  FSM transiciona al paso correspondiente
  Nada se escribe en TrayInput

VALIDAR (síncrono, antes de preview)
  resolveContinuation() — o checkDirectCompatibility() en la implementación actual
  verifyStartPortValid()
  Si !ok y sin excepción registrada → mostrar razón, bloquear confirmación
  Resultado mostrado en panel: evidencia, accesorios, decisiones pendientes

PREVISUALIZAR (R3F)
  PreviewMesh en escena: posición, dirección, longitud editables
  Transparente, sin interacción
  Panel: SKU, familia, dimensiones, compatibilidad, accesorios que Python calculará

CONFIRMAR (atómico — un solo trayEdit())
  resolveContinuation() ← re-verificar al momento del commit
  verifyStartPortValid() ← re-verificar
  Si ok:
    buildPiece(newId, productId, geometry)   ← geometría según orientation
    next.piezas.push(newPiece)
    next.conexiones.push(connection)
    trayEdit(structuredClone(next))          ← invalida motor, revision++, push historial
    deactivate()
  Si !ok (concurrent change): mostrar error, no escribir

DESHACER (historial de TrayInput — E3)
  array de TrayInput snapshots, índice actual
  Límite inicial: 10 pasos
  undo() → índice-- → restaurar sin push al historial
  redo() → índice++ → restaurar sin push al historial
  Cancelar antes del commit: sin costo (nada fue escrito)
```

### 5.2 Atomicidad

Toda operación que escribe en `TrayInput` lo hace en un solo `trayEdit(structuredClone(next))`. Garantiza:
- El motor siempre ve un estado coherente.
- Un error antes del commit no deja el trazado parcialmente modificado.
- La revisión se incrementa una sola vez por operación.
- El historial recibe un snapshot completo.

### 5.3 Invalidación por capa

| Cambio | Red física | Recorridos | Motor |
|---|---|---|---|
| Agregar/quitar pieza | Modifica | Puede afectar | Desactualiza |
| Cambiar longitud | Modifica | Puede afectar longitud PE | Desactualiza |
| Agregar/quitar circuito | — | Modifica | Desactualiza |
| Cambiar PE | — | Modifica | Desactualiza |
| Registrar excepción | workspace metadata | — | No afecta |
| Cambiar ProjectDataV2 | — | — | No afecta |
| Nueva versión catálogo | — | — | Resultado = null |

**Campo `meta`:** libre, fuera del cálculo y de la huella. Notas de trazado van en `EntradaTrazado.meta` sin invalidar.

### 5.4 Qué calcula Python (el CAD no replica)

| Cálculo | Acceso desde CAD |
|---|---|
| Ocupación por sección/boca | `resultado.ocupacion` |
| Verificación mecánica por vano | `resultado.vanos` |
| Componentes de unión (cantidad) | `resultado.computo` |
| Longitud del PE (suma de ejes) | `resultado.pe.conductores[].longitud_mm` |
| Cobertura equipotencial | `resultado.equipotencial` |
| Cargas por pieza | `resultado.cargas_por_pieza` |
| Estado global del trazado | `resultado.estado_trazado` |
| Corridas y vanos | `resultado.corridas` |
| Cómputo BOM | `resultado.computo` |

### 5.5 Qué decide el CAD

| Responsabilidad | Función/módulo |
|---|---|
| Productos compatibles con un puerto | `getCompatibleProductIds` |
| Puerto de la pieza nueva + orientación | `checkDirectCompatibility` → `newPiecePort` |
| Geometría de posición P1/P2 | `buildSegmentPiece`, `buildCurvePiece` (pendiente) |
| Generación de IDs únicos | `generateSegmentId`, `generateConnectionId` |
| Verificación del puerto antes del commit | `verifyStartPortValid` |
| Recomendación mismo producto como origen | preselección en `RoutingObjects.onClick` |
| Atomicidad del commit | `trayEdit(structuredClone(next))` |
| Excepción de conexión (motivo, fecha) | `excepciones_conexion` en workspace |

---

## 6. Adaptador Python

### 6.1 Qué recibe el motor

```
Solicitud {
  version_contrato: '1.0',
  tipo: 'trazado',
  solicitud_id: string,
  clave: string,
  revision_entrada: number,
  entrada: EntradaTrazado        ← red física + recorridos
}
```

**Campos de `EntradaTrazado` (contrato `trazado/1`):**
- Requeridos: `version_contrato`, `tipo_circuito`, `reserva_solicitada_pct`, `piezas`, `conexiones`, `circuitos`
- Opcionales: `meta`, `eje_vertical`, `tapas`, `accesorios`, `soportes`, `pe`, `equipotencial`, `escenario_reserva`
- `additionalProperties: false` — campo no declarado → ENTRADA_INVALIDA

**Lo que nunca va en Solicitud al motor:**
- `excepciones_conexion` (workspace metadata, no en contrato)
- Datos de ProjectDataV2 (conexiones de servicio)
- Notas de proyecto (pueden ir en `meta`)

### 6.2 Restricciones actuales del motor — entregas de ampliación, no exclusiones

| Restricción | Decisión pendiente | Entrega |
|---|---|---|
| `tipo_circuito: 'potencia'` único | D-11 (mando/señal) | E-CTL |
| Sin mangueras en circuitos | R-MAN | E-CTL |
| CTA solo G65 y Z65 | F1–F9 (otras familias) | Motor v0.3+ |
| Sin verificación de curvaturas | F10, F11 | Motor v0.3+ |
| Sin capacidad de soportes | D-29 | Motor v0.3+ |
| Sin masa de tapas | F13 | Motor v0.3+ |

### 6.3 Estados de compatibilidad que produce el motor

```
COMPATIBLE_DOCUMENTADA
COMPATIBLE_DOCUMENTADA + EQUIVALENCIA_EXTREMOS_RECTA_D-13
COMPATIBLE_DOCUMENTADA + REGLA_DE_FAMILIA_REV-032  (propuesta)
PENDIENTE_DECISION (bloqueos activos: D-03, D-07, D-09, D-11)
SIN_EVIDENCIA_CATALOGO
```

El CAD añade antes: **SIN_EVIDENCIA_LOCAL** — `checkDirectCompatibility` no encontró entrada ni por match exacto ni por D-13. Impide confirmar salvo elección excepcional (E4).

---

## 7. Flujos del usuario

### 7.1 Continuar trazado (recto)

```
IDLE
  │  Activar "Continuar trazado"
  ▼
SELECTING_PORT
  │  Clic en esfera naranja (puerto libre)
  ▼
CONFIGURING_SEGMENT                    ← back() → SELECTING_PORT
  │  Mismo producto origen pre-seleccionado
  │  Selector: solo productos compatibles (getCompatibleProductIds)
  │  Panel: evidencia, accesorios, decisiones pendientes
  │  Preview 3D en escena
  │  Confirmar →
  ├─ compat.ok → COMMIT_DIRECT → IDLE
  └─ !compat.ok → CONFIRMING_EXCEPTION (E4) → COMMIT_DIRECT → IDLE
```

### 7.2 Derivación intermedia (E3)

```
IDLE → clic en tramo recto → SPLITTING_SEGMENT
  │  Deslizador: distancia desde P1 (mm)
  │  Preview: SEG-1a + T + SEG-1b
  │  Confirmar: COMMIT_SPLIT (atómico, actualiza circuitos + soportes + PE)
  │  → CONFIGURING_SEGMENT desde puerto libre de T
```

### 7.3 Estados del store de trazado

```
sin_calcular → calculando → vigente
                          → error
vigente → desactualizado  (cualquier trayEdit() invalida)
```

Regla: ningún resultado se muestra a partir de un estado `desactualizado` sin recalcular.

---

## 8. Conservación de archivos y contratos

### 8.1 Qué se preserva incondicionalmente

| Qué | Dónde | Por qué |
|---|---|---|
| Contrato `trazado/1` | `contrato-1.0.schema.json` | El motor Python lo valida |
| `additionalProperties: false` en EntradaTrazado | Motor | Campo no declarado → ENTRADA_INVALIDA |
| `excepciones_conexion` fuera de Solicitud | workspace metadata, no en `entrada` | No contamina huella ni fórmulas |
| Archivo workspace v1 `{ fileVersion, projectV2, trayInput }` | `workspaceFile.ts` | Round-trip probado; archivos de usuario existentes |
| IDs `SEG-N`, `CON-NNN`, `SOP-N` | convención actual | Pueden existir en archivos persistidos |
| DB_VERSION=3, stores IndexedDB | `db.ts` | Backups de migración ya escritos en campo |
| Motor vendor (78 archivos verificados) | `vendor/motor_bandejas/` | SHA-256 en manifest; no se modifica |

### 8.2 Extensiones compatibles hacia atrás

| Extensión | Ubicación | Compatible hacia atrás |
|---|---|---|
| `excepciones_conexion` | TrayInput (opcional) | Sí; import ignora si falta |
| Notas de trazado | `EntradaTrazado.meta` | Sí; motor ignora `meta` |
| `eje_vertical` | Campo opcional | Sí; default [0,0,1] |
| `medium` en Connection (ProjectDataV2) | ProjectDataV2 (opcional) | Sí; import ignora si falta |

### 8.3 Nomenclatura de IDs

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

## 9. Entregas como recorridos utilizables

Cada entrega agrega un recorrido completo que el usuario puede observar y validar desde el primer commit. Formato: **Resultado visible → Datos necesarios → Cambios de contrato → Conservación → Prueba de aceptación**.

---

### E0 — Operaciones integradas del workspace (ENTREGADO — rama feat/workspace-routing-operations)

**Resultado visible:** continuar un recto desde P1 o P2 → previsualizar cambios → confirmar pieza + conexión en un solo commit → deshacer/rehacer la operación. Si hay un conductor PE cuyo recorrido termina en el extremo seleccionado, el panel propone "✓ Extender / ✗ No extender" antes de confirmar.

**Decisiones de implementación:**

| Decisión | Elección | Alternativa descartada |
|---|---|---|
| Historial de deshacer | `history: TrayInput[]` + `future: TrayInput[]` en `useTrayStore` | Store separado de historial |
| Límite de historial | 20 pasos | Ilimitado (riesgo de memoria con trazados grandes) |
| Invalidación al deshacer | `undo()`/`redo()` llaman a `manager.invalidar('trazado')` y `revision++` | Dejar resultado vigente (incoherente con estado anterior) |
| Adaptador Python | `toMotorEntrada(trayInput)`: itera entradas y omite campos en `WS_ONLY` | Strip antes de serializar en `calculate()` directamente |
| Campos WS-only actuales | `excepciones_conexion` (futuro E4); ninguno en E0 | — |
| PE — detección de extensión | Solo el **último** elemento del `recorrido[]` se compara con `startPieceId` | Buscar en toda la secuencia (provocaría extensiones incorrectas) |
| PE — conductor principal | El primero con match (conductorIdx); `ambiguous=true` si hay más de uno | Bloquear si es ambiguo (demasiado restrictivo para E0) |
| PE — decisión por defecto | `'accept'` (extender); el usuario puede cambiar a `'reject'` | `'reject'` por defecto (omite la extensión silenciosamente) |
| Operación planificada | `planAddSegment()` pura → `PendingSegmentAddition` → `applyOperation()` | Mezclar plan y escritura en `commitDirect` |
| Atomicidad | Un único `trayEdit()` recibe la TrayInput ya completa (piezas + conexiones + PE) | Múltiples `trayEdit()` para pieza, conexión y PE por separado |
| `excepciones_conexion` | Preservado por `structuredClone` en `applyOperation`; nunca enviado al motor | — |

**Nuevos módulos:**
- `src/workspace/workspaceOperation.ts` — `findPeExtensionProposal`, `planAddSegment`, `applyOperation`, `PendingOperation`
- `src/workspace/__tests__/workspaceOperation.test.ts` — 32 pruebas de las funciones puras

**Funciones modificadas:**
- `useTrayStore.edit()` — push a `history`, clear `future`
- `useTrayStore.undo()` / `undo()` — restauran TrayInput anterior/siguiente e invalidan el motor
- `toMotorEntrada()` — exportado desde `store.ts`; usado en `calculate()`
- `RoutingPanel.commitDirect()` — usa `planAddSegment` + `applyOperation` + `peDecision`

**Datos necesarios:** ninguno adicional. Funciona con catálogo actual.

**Cambios de contrato:** ninguno en `trazado/1`. `excepciones_conexion` sigue siendo workspace-only.

**Conservación:** workspace v1 y `trazado/1` intactos. `TrayInput extends Record<string,unknown>` preserva campos desconocidos en `structuredClone`. Archivos exportados antes de E0 importan sin error.

**Prueba de aceptación:**
1. `npx vitest run src/workspace/__tests__/workspaceOperation.test.ts` → 32/32 ✓
2. `npx vitest run` → 727/727 (todos los tests del proyecto) ✓
3. `npx tsc --noEmit` → 0 errores ✓
4. Con catálogo real: desde P1 y P2 de un recto, confirmar → pieza aparece en escena; deshacer → desaparece; rehacer → reaparece; PE extendido al aceptar, no duplicado; motor recibe `version_contrato:'trazado/1'` sin `excepciones_conexion`.

---

### E1 — Recto con confirmación sin ambigüedad (ENTREGADO — commit 723892c)

**Resultado visible:** R1.P1 de SAM_TRES-300-065-18-Z → selector "1 compatible" → confirmación "Compatible (CMP-01535) — equivalencia D-13" → Python acepta → estado_trazado visible.

**Datos necesarios:** Catálogo cargado (COMPATIBILIDADES, PUERTOS_PRODUCTO). Motor activo para test de integración.

**Cambios de contrato:** ninguno. `newPiecePort` y `orientation` son campos internos de `DirectCompatResult` (CAD).

**Conservación:** `trazado/1`, workspace v1 y archivos existentes intactos.

**Prueba de aceptación:**
1. `npx vitest run src/workspace/__tests__/routingRules.test.ts` → 64/64 ✓
2. Con motor: `npx vitest run routing.integration` → tests Z-product pasan ✓
3. Navegador: activar desde R1.P1 → panel "1 compatible", no "Sin evidencia" ✓

---

### E2 — Curvas planas y orientación de sección

**Resultado visible:** trazado A.recto → curva H 90° → A.recto → Python calcula ocupación + corridas. Campo `eje_vertical` editable en panel (orienta la sección transversal).

**Datos necesarios:**
- Nueva función `buildCurvePiece(id, productId, p1Pos, p1Dir, p2Dir, lonEje)` → Pieza con 2 puertos y `longitud_eje_mm`
- Productos disponibles: 171 curvas H en escaleras G/Z; 47 V. FAMIQ-ALAMBRE-INOX tiene curvas H.
- Geometría: posiciones P1/P2 se calculan desde `angulo_curva` del producto. F12 no requerida para insertar; solo para verificar encaje real (F12 bloquea solo la exactitud del encaje, no la inserción).

**Cambios de contrato:** ninguno. `longitud_eje_mm` ya es campo de Pieza en `trazado/1`.

**Conservación:** no agregar campos no declarados (`additionalProperties: false`). Archivos sin curvas importan sin error.

**Prueba de aceptación:**
1. Test unitario: `buildCurvePiece(...)` → Pieza con 2 puertos y `longitud_eje_mm`.
2. Test integración: trazado con 1 curva → Python no devuelve ENTRADA_INVALIDA.
3. Navegador: tramo + curva + tramo → estado_trazado visible + corridas calculadas.

---

### E3 — Derivación intermedia con T

**Resultado visible:** trazado R1→R2→R3, insertar T en R2 a 1500 mm → preview SEG-2a + T + SEG-2b → confirmar → ramal K2 desde T → Python produce ocupación por boca de T. Deshacer disponible (10 pasos).

**Datos necesarios:**
- Función pura `splitSegment(entrada, instanciaId, distanciaMm, tProductId) → TrayInput`
  - Actualiza: `piezas` (SEG-1a, T, SEG-1b), `conexiones` (reconectar), `circuitos[].recorrido` (sustituir SEG-1 por [SEG-1a, T, SEG-1b] en cada circuito que lo contenga), `soportes` (reubicar por posición), `tapas` (reubicar por posición)
  - Si PE incluye la pieza partida y no puede resolverse automáticamente: bloquear con mensaje
- UI: modo SPLITTING_SEGMENT con deslizador de distancia
- Historial de TrayInput: array de snapshots + índice, límite 10 pasos

**Cambios de contrato:** ninguno. Las entidades T ya están en `trazado/1`.

**Conservación:** IDs SEG-1a/SEG-1b son piezas nuevas; archivos previos sin T importan sin error.

**Prueba de aceptación:**
1. Test unitario: `splitSegment` con 1 circuito → `recorrido` actualizado a [SEG-1a, T-1, SEG-1b].
2. Test unitario: `splitSegment` con soporte a 800 mm → soporte queda en SEG-1a a 800 mm.
3. Test integración: trazado dividido → Python acepta y produce ocupación por boca.
4. Navegador: seleccionar tramo → "Insertar derivación" → preview → confirmar → 3 piezas en escena → deshacer → 1 pieza restaurada.

---

### E4 — Elección excepcional con motivo

**Resultado visible:** R1.P1 de SAM_TRES-150-065-18-G → elegir SAM_TRES-150-065-18-Z (familia distinta, 0 entradas) → modal con "Motivo (requerido)" → confirmar → Python reporta incompatibilidad → UI muestra diagnóstico Python + motivo registrado con badge ⚠.

**Datos necesarios:**
- `exceptionalConnection` en `useRoutingStore` (motivo, fecha, confirmado_por)
- En `commitDirect`: si `compat.ok === false && excepcion.motivo`: escribir `excepciones_conexion[conexion_id]`
- UI `TrayResults`: badge ⚠ en conexiones con excepción → tooltip con motivo
- Export/import preserva `excepciones_conexion` en archivo

**Cambios de contrato:** campo `excepciones_conexion` en workspace (`TrayInput`, fuera de `entrada` al motor). No cambia `trazado/1`.

**Conservación:** campo opcional; archivos sin él importan sin error. Badge no requiere recalcular.

**Prueba de aceptación:**
1. Test unitario: `commitDirect` con excepción → conexión en trazado + entrada en `excepciones_conexion`.
2. Round-trip: export con excepción → import → badge ⚠ visible sin recalcular.
3. Navegador: modal visible → confirmación sin motivo bloqueada → motor reporta incompatibilidad visible junto al motivo.

---

### E5 — Circuitos, PE y soportes desde la UI

**Resultado visible:** trazado de 3 piezas → circuito K1 (3 × 1×35 mm² Prysmian) → conductor PE → 3 soportes a 1500 mm → Python: ocupación, vanos, cobertura PE, cómputo BOM completo. Circuito K2 en sentido inverso incluido.

**Datos necesarios:**
- Formularios de circuito (cable, cantidad, separado, recorrido sobre piezas)
- Formulario PE (recorrido, puntos equipotenciales, conductor_puente)
- Formulario soporte (sistema, producto, instancia, distancia_desde_P1_mm)
- `pe.conductores` requiere al menos 1 conductor; se crea automáticamente al declarar PE
- UI de recorrido: selección de piezas en orden (incluyendo orden inverso para K2)

**Cambios de contrato:** ninguno. `pe`, `circuitos`, `soportes` ya están en `trazado/1`.

**Conservación:** todos los campos son opcionales; archivos sin ellos importan sin error.

**Prueba de aceptación:**
1. Test unitario: `trayEdit` con circuito válido → motor devuelve `estado_trazado: 'ok'`.
2. Test integración: entrada con K1 + PE → `resultado.pe.conductores[0].longitud_mm > 0`.
3. Navegador: formulario circuito → PE → soportes → Python calcula → cómputo BOM visible.

---

### E-CTL — Modelado de control, señal y neumática

**Resultado visible:** ProjectDataV2 permite registrar conexiones de control/señal/neumática. Visible en vista de proyecto como líneas de servicio separadas de la potencia (color distinto). Verificación por motor: pendiente (D-11 y ampliación de contrato).

**Datos necesarios:**
- `Connection.medium: 'power' | 'control' | 'signal' | 'pneumatic'` en ProjectDataV2 (campo nuevo opcional)
- UI de edición de conexiones de servicio en vista de proyecto
- Motor (ampliación): D-11 soporte de `tipo_circuito: 'mando'`; nuevo campo o entidad para mangueras en `EntradaTrazado`

**Cambios de contrato (fase 1 — solo CAD):** campo `medium` en `Connection` de ProjectDataV2. No cambia `trazado/1`.
**Cambios de contrato (fase 2 — motor):** cuando el motor amplíe, nuevo valor `tipo_circuito` y posiblemente nueva entidad en `EntradaTrazado`.

**Conservación:** `Connection.medium` es campo nuevo opcional; archivos sin él importan sin error. Regla: nunca falsificar `tipo_circuito: 'potencia'` para un circuito de control.

**Prueba de aceptación:**
1. Navegador (fase 1): agregar conexión de control → visible como línea de color diferente en vista de proyecto.
2. Con motor ampliado (fase 2): circuito de mando → Python no devuelve ENTRADA_INVALIDA.
3. Navegador (fase 2): manguera neumática registrada → aparece en cómputo de proyecto (no de bandeja).

---

### E-RED — Reducciones (desbloqueada cuando F12 disponible)

**Resultado visible:** trazado con reducción 300→150 → Python calcula cambio de ocupación. Geometría real de la reducción en 3D.

**Datos necesarios:**
- F12: dimensiones físicas de reducciones (longitud real, posiciones de puertos)
- Actualmente: `longitud_comercial_mm: null` en los 126 productos de reducción → inserción bloqueada
- **SAM-STP-Z (perforada Z): 0 reducciones cargadas en catálogo** — sin reducción posible dentro de familia Z perforada hasta que se carguen datos

**Cambios de contrato:** ninguno (piezas de reducción son Pieza estándar).

**Conservación:** inserción bloqueada en UI hasta recibir F12; archivos existentes sin reducciones importan sin error.

**Prueba de aceptación:**
1. Con F12: `buildReductionPiece(...)` → puertos en posiciones reales según datos F12.
2. Test integración: recto + reducción + recto → Python acepta sin ENTRADA_INVALIDA.
3. Navegador: seleccionar reducción → pieza 3D con geometría real visible.

---

### E-FIN — Final de tramo

**Resultado visible:** tramo con final de tramo en extremo libre → Python incluye el final en cómputo BOM.

**Datos necesarios:**
- Nueva función `buildEndPiece(id, productId, portPos, portDir)` → Pieza con 1 puerto
- 51 productos de tipo `final` disponibles en catálogo

**Cambios de contrato:** ninguno (tipo `final` ya existe en PRODUCTOS).

**Prueba de aceptación:**
1. Test unitario: `buildEndPiece(...)` → Pieza con 1 puerto.
2. Test integración: trazado con final → Python incluye en cómputo.
3. Navegador: colocar final en puerto libre → pieza visible en escena.

---

### E-COL — Detección de interferencia con paredes

**Resultado visible:** tramo que atraviesa pared → alerta de interferencia → diálogo "Registrar abertura 155×70 mm a 2100 mm de altura" → confirmación → abertura registrada en archivo exportado.

**Datos necesarios:**
- Edificio con geometría 3D (caras y normales) — hoy solo dimensiones escalares en ProjectDataV2
- Algoritmo OBB/AABB para intersección trazado–edificio en CAD
- UI de diálogo de abertura con dimensiones y altura editables

**Cambios de contrato:** nueva entidad `abertura` en workspace (opcional).

**Conservación:** archivos sin aberturas importan sin error.

**Prueba de aceptación:**
1. Test unitario: intersección OBB con pared → devuelve punto, dimensiones, vector normal.
2. Navegador: tramo que atraviesa pared → alerta visible → confirmar abertura → registrada en export.

---

## 10. Decisiones pendientes y datos faltantes

### 10.1 Decisiones del motor que afectan el CAD

| ID | Qué decide | Efecto si no se decide |
|---|---|---|
| D-13 (confirmación usuario) | P1/P2 equivalentes en rectos con igual ancho/ala | Condición visible en resultado; CAD ya implementa |
| D-21 (modelo PE) | Qué cable PE usar | MODELO_A_CONFIRMAR en resultado |
| P-D19c | Hueco PE–potencia | Condición permanente en resultados |
| D-03 | Cables separados distintos diámetros | Motor devuelve PENDIENTE_DECISION para ese par |
| D-11 | Mando/señal en trazado | Bloquea E-CTL fase 2 |
| D-23 | Reglas de colocación de soportes | SIN_REGLA_ACREDITADA |
| D-29 | Modelo de reparto de cargas | NO_VERIFICABLE_SIN_MODELO_DE_REPARTO |

### 10.2 Datos faltantes que bloquean verificaciones específicas

| Dato | Bloqueo concreto |
|---|---|
| F10: radio de curvatura de cables | Verificación de curvaturas → NO_VERIFICABLE |
| F12: dimensiones físicas de piezas especiales | E-RED bloqueada; encaje real de T y curvas |
| F13: masa de tapas | Vanos con tapa → NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA |
| F14: luz máxima, voladizos, uniones | SIN_REGLA_ACREDITADA para soportes |
| F15: capacidad de soportes | NO_VERIFICABLE_SIN_MODELO_DE_REPARTO |
| F17/F18: continuidad de uniones | Equipotencialidad condicionada |
| CTA perforada, G115, Z115 | No verificable para esas familias (F1–F9) |

### 10.3 Riesgos de arquitectura

**R1 — Divergencia CAD–motor en compatibilidad**
Riesgo: `checkDirectCompatibility` local acepta una conexión que Python rechaza (o viceversa).
Mitigación: `routing.integration.test.ts`; toda divergencia detectada actualiza la función local.

**R2 — Contrato motor sin mando/señal**
Riesgo: escenario incluye circuitos de control hacia sensores y actuadores.
Mitigación: modelar como `Connection.medium:'control'` en ProjectDataV2 (no en `circuitos[]`). No falsificar `tipo_circuito: 'potencia'`.

**R3 — Mangueras fuera del contrato**
Riesgo: escenario incluye manguera neumática hacia actuador.
Mitigación: `medium: 'pneumatic'` en `Connection` de ProjectDataV2. No incluir en `circuitos[]` hasta E-CTL fase 2.

**R4 — Geometría de reducciones bloqueada**
`longitud_comercial_mm: null` en los 126 productos de reducción. No estimar longitudes sin F12. E-RED bloqueada explícitamente hasta disponer del dato.

**R5 — Interferencia con paredes sin geometría 3D**
Detección requiere edificio con caras y normales (hoy solo escalares), algoritmo OBB/AABB, y UI de abertura. Capacidad nueva; plan propio en E-COL.

**R6 — Deshacer**
Cancelar antes del commit: sin costo. E3 agrega historial de 10 pasos. Hasta entonces: export previo al edit como única mitigación.

**R7 — Recorrido inverso sin UI**
El motor acepta `recorrido[]` en orden inverso. La UI de circuitos (E5) debe permitir definir el orden explícitamente, no inferirlo.
