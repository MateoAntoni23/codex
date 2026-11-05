# Decisiones de producto – motor_bandejas

Los valores por defecto viven en `datos/decisiones_producto.json` (versión `2026-11-05.2`). Cambiar uno cambia la huella de todo resultado. Estados: **acordada** (definida por el equipo) · **producto** (adoptada por el desarrollo del motor, configurable; **no** aprobada explícitamente por el usuario ni respaldada por norma verificada) · **propuesta** (no implementada ni adoptada) · **pendiente**.

| ID | Tema | Estado | Regla |
|---|---|---|---|
| D-01 | Separado, cables iguales, una fila | acordada | g = D (hueco libre entre superficies). Paso entre centros = 2D. W = (2n−1)·D. Sin márgenes laterales ni reserva |
| D-02 | "Separado desactivado" | producto | Equivale a **contacto** en una capa: g = 0, W = Σ Dᵢ. *Separado desactivado no prueba una disposición física: es una convención del producto* |
| D-03 | Separado con diámetros distintos | **propuesta – no implementada** | Ver §D-03. Hoy el motor devuelve `BLOQUEADO / PENDIENTE_DECISION D-03` |
| D-04 | Ancho de referencia de la bandeja | producto | Ancho útil si el catálogo lo publica; si no, ancho nominal. Con ancho nominal el candidato es como máximo `PRESELECCION_CONDICIONADA` (condición `ANCHO_NOMINAL_NO_UTIL`), nunca aptitud completa. Alternativa `solo_util` |
| D-05 | Denominador de la reserva | producto (no aprobada; norma no verificada) | `fraccion_libre_ancho_bandeja`: W_ocup ≤ (1−r)·W_ref. Reserva informada = (W_ref − W_ocup)/W_ref. Alternativa `sobre_ancho_ocupado`: W_ref ≥ (1+r)·W_ocup (compatible con lo observado en Samet, H-S3). Ambas métricas salen siempre en el resultado |
| D-06 | Verificación mecánica | producto | Solo con un registro de `TABLAS_CARGA` del mismo producto, **luz = vano exacta**, unidad kg/m y carga uniformemente distribuida. Sin interpolar ni extrapolar; con varios registros se toma el menor y se advierte. Carga = masa propia de los cables. Solo la evidencia `documentada` da `VERIFICADA_*`; `validada_por_usuario` y `adoptada_por_decision` dan `CUMPLE_CONDICIONADO` / `NO_CUMPLE_CONDICIONADO` |
| D-06b | Registros que combinan fuentes | acordada (REV-020) + registro del motor | CAR-0046/0051/0056/0061 (escalera Z ala 65): 290 kg/m de F-004 (sin luz) aplicado a la luz 1500 de F-001, que publica 300. Se respeta la decisión del usuario de tomar el menor, pero el motor lo trata como **valor adoptado** (DER-001 en `datos/catalogo/cargas_derivadas.json`) y conserva las dos fuentes originales por separado. Tomar el menor no demuestra que las condiciones de ensayo sean equivalentes |
| D-07 | Grupos separados y en contacto en la misma bandeja | pendiente | `BLOQUEADO`: falta definir el hueco entre grupos |
| D-08 | Altura de referencia | producto | D_max ≤ alto útil; si no se publica, ≤ ala nominal, con advertencia |
| D-09 | Apilado (varias capas) | pendiente | `BLOQUEADO`. Samet limita a 4 apilados (`MAX_ALLOWED_PILED_UP = 4`), sin regla documentada |
| D-10 | ¿La carga mecánica incluye la reserva futura? | pendiente | Hoy **no**: q = cables actuales. Si la reserva de espacio se ocupa, la carga crece |
| D-11 | Circuitos de mando y señal | pendiente | `BLOQUEADO`. Samet deshabilita "separado" y "apilado" en ese modo; no hay regla documentada de ocupación |
| D-12 | Esquema del ensayo de carga | **resuelta v0.2.1** (usuario) | Los ensayos de la tabla F-001 siguen el esquema de la imagen aportada (`datos/esquemas_ensayo.json`, ESQ-SAMET-TABLA-ENSAYO: dos tramos de 3 m, una unión en el centro del vano central, carga uniforme). Cada vano se contrasta en lo que el modelo permite (uniones por vano, unión sobre apoyo, unión al centro ±D-30, vano con vecinos). Si el registro no declara esquema (`NO_DECLARADO`, p. ej. la fila C de F-005) o la instalación difiere (`DISTINTO`), un `VERIFICADA_CUMPLE` baja a `CUMPLE_CONDICIONADO`. Lo no contrastable se lista en `no_contrastado` |

## Por qué D-05 es conservadora por defecto

Con r = 20 %, el criterio por defecto exige W_ref ≥ 1,25·W_ocup. El alternativo exige W_ref ≥ 1,20·W_ocup. Caso real: 8 × Cu 1×6 separados (121,5 mm) en 150 mm deja 19,0 % libre del ancho, pero 23,5 % sobre lo ocupado. Con el criterio por defecto se rechaza; con el alternativo se acepta. Una fuente secundaria atribuye a la AEA 90364-7-771 (§771.12.3.9) el "× 1,20 sobre la suma de diámetros", que coincide con el alternativo. Hasta leer el texto oficial (pendiente F7) se deja el criterio más exigente, configurable. **Es una decisión de producto tomada en el desarrollo, no aprobada explícitamente por el usuario ni respaldada por una norma verificada.**

## D-03 – Propuesta para cables de distinto diámetro (separados)

> **Estado: propuesta, bloqueada.** No se adopta automáticamente g = max(Dᵢ, Dⱼ) como regla normativa ni como decisión aprobada. El motor sigue devolviendo `PENDIENTE_DECISION D-03`.

**Qué dice la documentación disponible**
- Prysmian (S-02 p.4 y p.6): "separación libre de un diámetro" / "separados un diámetro como mínimo". El texto supone cables iguales.
- IEC 60364-5-52, Método G (fuente secundaria): unipolares separados con *spacing at least one cable diameter*. Tampoco define qué diámetro se toma con tamaños distintos.
- NEC 502.10(A)(1)(6), citado en un foro técnico: *a space not less than the larger cable diameter between the two adjacent cables*. Es norma de EE. UU. para áreas clasificadas, no aplicable en forma directa. Solo indica un criterio conservador usado en la práctica.

**Propuesta**
1. Hueco entre vecinos i, j: **gᵢⱼ = max(Dᵢ, Dⱼ)**. Cumple "al menos un diámetro" para ambos cables del par.
2. Si el CAD informa el orden físico de los cables: W = Σ Dᵢ + Σ max(Dᵢ, Dᵢ₊₁) sobre los pares adyacentes.
3. Sin orden informado: se usa el orden que minimiza el ancho (ordenados por diámetro). Así, **W_min = 2·Σ Dᵢ − D_min**. El orden supuesto queda registrado en el resultado.
4. Con todos los D iguales se reduce a (2n−1)·D, es decir, es coherente con D-01.

**Alternativas descartadas o a elegir**
- g = D_max global, para todos los pares: más simple y más conservadora. W = Σ D + (n−1)·D_max.
- g = promedio de los D: no garantiza "un diámetro" para el cable mayor. Descartada.

**Advertencia:** cualquiera de estas reglas es geométrica. No convierte la disposición en "Método G" a efectos de intensidad admisible.

---

# Decisiones v0.2.0 (trazado, soportes, cómputo, PE y equipotencialidad)

Versión de decisiones: `2026-11-05.5` (v0.2.2). Clasificación pedida: **aprobadas** (definidas por el usuario), **propuestas** (activas con condición visible en el resultado o solo documentadas), **pendientes** (bloquean el cálculo que dependen de ellas).

## Aprobadas por el usuario

| ID | Decisión | Fuente |
|---|---|---|
| D-20 | PE de **16 mm²** que recorre **todos** los tramos de bandeja, incluidos los ramales. Es un requisito del proyecto, **no** una suficiencia normativa: el dimensionamiento y el montaje requieren verificación independiente. Desde v0.2.2 el valor está en las decisiones (`D-20_seccion_pe_mm2`); la entrada del CAD no lo puede redefinir: si declara otra sección, el resultado lo marca como incumplimiento | Pedido v0.2.0; auditoría H2 |
| D-01 | g = D para cables iguales separados. **No se aplica automáticamente al PE** | v0.1.0 |
| REV-020 / REV-032 / REV-010 | Valor menor de CTA Z65; familias G↔Z no compatibles; compatibilidad por ancho y ala | Hoja REVISION del catálogo |
| REV-043 | Filas de carga Z65 separadas: A (F-001, 1500 mm, 300 kg/m, documentada), B (F-004, sin luz, 290 kg/m, documentada), **C** (F-005, 1500 mm, 290 kg/m, "validada por usuario", regla REV-020). El motor usa C. La derivación DER-001 de v0.2.0 queda reemplazada | Usuario, 2026-11-05 ("Separamos, Fila C") |
| D-12 | Esquema de ensayo = imagen SAMET (ver arriba) | Usuario, 2026-11-05 |
| **D-19** | PE **contra un ala, en contacto con ella**, recorriendo la bandeja. Ocupación: W = W_potencia + D_PE con hueco PE–potencia = 0 (no definido por el usuario) | Usuario, 2026-11-05. Condición visible `D-19_PE_CONTRA_ALA_HUECO_PE_POTENCIA_NO_DEFINIDO` |
| **D-21 (requisitos)** | PE de 16 mm², **verde/amarillo**. El motor marca `NO_CUMPLE_REQUISITO` si el cable no declara ese color. El **modelo** concreto sigue a confirmar (`MODELO_A_CONFIRMAR`) | Usuario, 2026-11-05 |

## Propuestas activas (el resultado muestra la condición)

| ID | Regla | Condición visible |
|---|---|---|
| D-13 | Los dos extremos de un tramo recto con igual ancho, ala e interfaz son equivalentes. El catálogo registra la compatibilidad solo con P1 del recto | `EQUIVALENCIA_EXTREMOS_RECTA_D-13`. Configurable: `no_aplicar` |
| D-13b | La incompatibilidad entre familias (REV-032, registrada con pares de rectos de ejemplo) vale para cualquier pieza de esas familias | `REGLA_DE_FAMILIA_REV-032` |
| D-14 | Encaje del CAD: puertos coincidentes dentro de 1 mm y enfrentados dentro de 1°. Verifica la coherencia del modelo del CAD, no la pieza real (el catálogo no publica dimensiones de piezas especiales) | campo `alcance` |
| D-15 | Orientación de curvas a partir de las direcciones salientes: giro = ángulo(−d₁, d₂); vertical interior si (d₁+d₂)·eje > 0, exterior si < 0, horizontal si ambas son horizontales. El `eje_vertical` lo declara el CAD | — |
| D-16 | Radio disponible para un cable en curva horizontal, T o X = **borde interior** (peor caso: cable contra el ala interior). Si la pieza publica radio al eje: R − W/2; si exterior: R − W. Si la ficha del cable refiere el radio al eje: borde + D/2; si no lo especifica, se compara contra el borde (conservador) | `supuesto`, `REFERENCIA_RADIO_CABLE_NO_ESPECIFICADA` |
| D-17 | Ocupación por **pieza** si tiene ≤ 2 bocas del mismo ancho; por **boca** en T, X y reducciones, con los cables que cruzan cada boca según los recorridos | `modo_seccion` |
| D-18 | Cómputo: 1 pieza comercial por instancia; cortes sin reaprovechamiento de recortes | `estado_cantidad = regla_producto` + nota de corte |
| D-22 | Luz de verificación = distancia entre soportes consecutivos de una corrida recta; CTA solo si la luz coincide con una tabulada (tolerancia 0 mm). No se interpola | `NO_VERIFICABLE` en otras luces |
| D-24 | Componentes de unión: un juego por **conexión** (nunca por extremo) | `regla` de cada línea |
| D-25 | Una tapa sin masa publicada bloquea la verificación del vano que cubre (omitirla subestimaría la carga) | `NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA` |
| D-27 | Longitud del PE = suma de longitudes de eje informadas por el CAD (rectos: `longitud_mm`; piezas especiales: `longitud_eje_mm`; tramos parciales explícitos). **Sin holgura** mientras no exista regla | `holgura_mm: null` |
| D-28 | Ocupación futura de la reserva: escenario aparte, solo si se declaran sus circuitos (`escenario_reserva`) | `corridas_escenario_reserva` |
| D-30 | Tolerancia para "unión al centro del vano" al contrastar el esquema de ensayo: **10 mm**. Valor de producto, sin respaldo de fuente | verificación `unión al centro del vano` con `tolerancia_mm` |
| D-31 (v0.2.2) | Contraste de contexto con el esquema de ensayo (auditoría H8). El ensayo es una ventana de tres vanos: lateral – central (unión al centro) – lateral, sobre dos tramos de 3000 mm. **Central**: una unión al centro (D-30), no sobre apoyo, un vano de igual luz (D-22) a cada lado y los dos tramos del vano de 3000 mm (±1 mm, D-14). **Lateral**: sin unión, dentro de un único tramo de 3000 mm, contiguo a un central que coincide y de igual luz. No exige unión en todos los vanos. Fuera de la ventana no se contrasta. La igualdad de luz de los laterales sale de la rotulación de la imagen; para 2,25 y 2,5 m tres vanos no caben en 6 m (inconsistencia del dibujo, ver PENDIENTES) | `rol_en_ensayo`, `regla_contraste: "D-31 (propuesta)"`, `no_contrastado` |
| D-14 (extensión v0.2.2) | La tolerancia de posición de D-14 (1 mm) también se usa para: rechazar soportes coincidentes en una corrida (auditoría H4) y considerar "entero" un tramo parcial del PE. La tolerancia angular (1°) se usa para la alineación de las direcciones de un recto con su eje P1→P2 (auditoría H5) | mensajes de error y `desvio_direcciones_eje_grados` |

## Pendientes (bloquean o quedan sin verificar)

| ID | Tema | Efecto hoy | Opción propuesta |
|---|---|---|---|
| **D-21 (modelo)** | Modelo concreto del PE (requisitos ya aprobados) | `MODELO_A_CONFIRMAR`; el ejemplo usa Superastic Flex 16 V/A, único cargado que declara el color | Ver §D-21 |
| Arquitectura | Servicio Python vs. port TS vs. Pyodide | Frontera propuesta, sin adoptar | La define el auditor/desarrollador de la arquitectura (indicación del usuario) |
| D-23 | Reglas de colocación de soportes (vano máximo, voladizos, posición de uniones, apoyos en piezas especiales) | Solo diagnóstico `SIN_REGLA_ACREDITADA` | Requiere documento del fabricante o norma |
| D-26 | Qué partes conductoras requieren vínculo al PE (cada pieza, cada tramo continuo, tapas) | Se informa `SIN_VINCULO_PREVISTO`, sin exigir | Requiere texto reglamentario vigente |
| D-29 | Modelo estructural para repartir cargas en apoyos, ramales y curvas | Capacidad del soporte `NO_VERIFICABLE_SIN_MODELO_DE_REPARTO` | — |

## §D-21 – Candidatos para el PE 16 mm² (datos de ficha, no deducidos de la sección)

| | Superastic Flex 1×16 (IRAM NM 247-3) | Sintenax Valio 1×16 (IRAM 2178-1) |
|---|---|---|
| Construcción | Conductor Cu clase 5, aislación PVC, **sin envoltura** | Cu clase 5, aislación + envoltura PVC |
| D exterior aprox. | 7,0 mm | 10,0 mm |
| Masa aprox. | 167 kg/km | 227 kg/km |
| Verde/amarillo | **Sí** (p. 02) | No declarado (unipolar: alma marrón) |
| Condiciones de empleo | Cañería embutida, a la vista, tableros. **Bandeja no declarada** | **En bandejas**, enterrado |
| Radio mínimo de curvatura | No publicado | No publicado |
| Fuente | PRY2026 / PRY2020 Superastic Jet, p. 02–03 (extracción web) | PRY2020 Sintenax Valio, p. 02–03 |

Ninguno cumple a la vez "identificación verde/amarillo declarada" y "uso en bandeja declarado". La admisibilidad de un conductor aislado sin envoltura **como PE dentro de bandeja** depende de la reglamentación (AEA 90364), que no está disponible en el entorno: **decisión del usuario**.
