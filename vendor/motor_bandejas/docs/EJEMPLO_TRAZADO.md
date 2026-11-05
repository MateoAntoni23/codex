# Ejemplo completo: trazado con derivación y cobertura del PE

> **EJEMPLO SINTÉTICO.** Productos y datos: catálogo real del proyecto y fichas Prysmian. Posiciones, longitudes de eje de piezas especiales, circuitos, soportes y puntos equipotenciales: inventados para mostrar el contrato. Generado por `herramientas/resumen_ejemplo.py` desde `ejemplos/trazado_derivacion_pe.json`.

## Trazado

Tronco R1–R2–T1–R3 (escalera Z 300 / ala 65 / 1,24 mm). Ramal desde la boca de derivación de T1: R4–CS1 (curva horizontal 90°, radio interior 300 mm publicado)–R5 (corte de 1500 mm). Tapa sobre R3. Nueve trapecios STS-300-Z (SIS-001).

| Circuito | Cable | Cant. | Recorrido |
|---|---|---|---|
| K1 | PRY-SVALIO-CU-1x35 | 3 | R1 → R2 → T1 → R3 |
| K2 | PRY-SVALIO-CU-1x35 | 3 | R1 → R2 → T1 → R4 → CS1 → R5 |

PE: `PRY-SASTFLEX-CU-1x16` (candidato, D-21). PE1 recorre el tronco desde la barra PE (SP1); PE2 nace en la derivación D1 dentro de T1 y recorre el ramal.

## Variante sin decisión de posición del PE (D-19 = pendiente)

- Estado del trazado: **CON_BLOQUEOS** — bloquea ['D-19'] (posición del PE junto a la potencia).
- Ejemplo de cota: R1 potencia 151,8 mm; con PE al menos 158,8 mm.

## Resultado con las decisiones vigentes (D-19: PE contra un ala, en contacto; aprobada por el usuario)

Estado del trazado: **PRESELECCION_CONDICIONADA** (nunca aprobación).

### Conexiones

| Conexión | Compatibilidad | Condiciones | Encaje (geometría del CAD) |
|---|---|---|---|
| C1 | COMPATIBLE_DOCUMENTADA | — | COHERENTE |
| C2 | COMPATIBLE_DOCUMENTADA | EQUIVALENCIA_EXTREMOS_RECTA_D-13 | COHERENTE |
| C3 | COMPATIBLE_DOCUMENTADA | — | COHERENTE |
| C4 | COMPATIBLE_DOCUMENTADA | — | COHERENTE |
| C5 | COMPATIBLE_DOCUMENTADA | EQUIVALENCIA_EXTREMOS_RECTA_D-13 | COHERENTE |
| C6 | COMPATIBLE_DOCUMENTADA | — | COHERENTE |

### Ocupación por sección

| Pieza | Sección | Circuitos | Ancho ocupado [mm] | Reserva libre [%] | Estado |
|---|---|---|---|---|---|
| R1 | pieza | K1, K2 + PE×1 | 158,8 | 47,1 | PRESELECCION_CONDICIONADA |
| R2 | pieza | K1, K2 + PE×1 | 158,8 | 47,1 | PRESELECCION_CONDICIONADA |
| T1 | P1 | K1, K2 + PE×1 | 158,8 | 47,1 | PRESELECCION_CONDICIONADA |
| T1 | P2 | K1 + PE×1 | 76,0 | 74,7 | PRESELECCION_CONDICIONADA |
| T1 | P3 | K2 + PE×1 | 76,0 | 74,7 | PRESELECCION_CONDICIONADA |
| R3 | pieza | K1 + PE×1 | 76,0 | 74,7 | PRESELECCION_CONDICIONADA |
| R4 | pieza | K2 + PE×1 | 76,0 | 74,7 | PRESELECCION_CONDICIONADA |
| CS1 | pieza | K2 + PE×1 | 76,0 | 74,7 | PRESELECCION_CONDICIONADA |
| R5 | pieza | K2 + PE×1 | 76,0 | 74,7 | PRESELECCION_CONDICIONADA |

Condiciones comunes: `ANCHO_NOMINAL_NO_UTIL`, `ALTURA_ALA_NOMINAL_NO_UTIL`, `D-19_PE_CONTRA_ALA_HUECO_PE_POTENCIA_NO_DEFINIDO` (se toma hueco PE–potencia = 0; el ancho del PE se suma al de la fila de potencia).

### Curvatura

- K1: T1 SIN_CURVATURA
- K2: T1 NO_VERIFICABLE_RADIO_CABLE_NO_PUBLICADO; CS1 NO_VERIFICABLE_RADIO_CABLE_NO_PUBLICADO
- PE1: T1 SIN_CURVATURA
- PE2: T1 NO_EVALUADO_EXTREMO_DE_RECORRIDO; CS1 NO_VERIFICABLE_RADIO_CABLE_NO_PUBLICADO

### Vanos (cargas: cables de potencia asignados + PE)

| Corrida | Luz [mm] | Carga [kg/m] | Registro | Esquema de ensayo | Estado |
|---|---|---|---|---|---|
| CORR-R1 | 1500 | 2,849 | CAR-0051 | NO_DECLARADO | CUMPLE_CONDICIONADO |
| CORR-R1 | 1500 | 2,849 | CAR-0051 | NO_DECLARADO | CUMPLE_CONDICIONADO |
| CORR-R1 | 1500 | 2,849 | CAR-0051 | NO_DECLARADO | CUMPLE_CONDICIONADO |
| CORR-R3 | 1500 | 1,508 | — | — | NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA |
| CORR-R4 | 1500 | 1,508 | CAR-0051 | NO_DECLARADO | CUMPLE_CONDICIONADO |
| CORR-R5 | — | — | — | — | NO_VERIFICABLE_UN_SOLO_SOPORTE |

Z 300/65/1,24: el registro aplicable es la fila C (CTA 290 kg/m, F-005 'validada por usuario', REV-020/REV-043), sin esquema de ensayo declarado → `NO_DECLARADO` y el vano queda `CUMPLE_CONDICIONADO`. Con la misma geometría en escalera G (registro F-001) los vanos del tronco dan `COINCIDE_EN_LO_CONTRASTADO` y `VERIFICADA_CUMPLE`; los de corridas de un solo vano, `DISTINTO` (sin vanos vecinos).

Escenario de reserva ocupada (circuito K3 adicional en el tronco), evaluado aparte:

- CORR-R1 luz 1500 mm: 4,190 kg/m → CUMPLE_CONDICIONADO
- CORR-R1 luz 1500 mm: 4,190 kg/m → CUMPLE_CONDICIONADO
- CORR-R1 luz 1500 mm: 4,190 kg/m → CUMPLE_CONDICIONADO
- CORR-R3 luz 1500 mm: 2,849 kg/m → NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA
- CORR-R4 luz 1500 mm: 1,508 kg/m → CUMPLE_CONDICIONADO

Soporte S1: aplicabilidad APLICA_DOCUMENTADA; capacidad del soporte NO_VERIFICABLE_SIN_MODELO_DE_REPARTO; anclaje NO_VERIFICABLE_FUERA_DE_ALCANCE. Colocación de uniones y voladizos: SIN_REGLA_ACREDITADA (diagnóstico).

### PE y equipotencialidad

- Cobertura física: **COMPLETA** (7 piezas).
- Longitudes geométricas (sobre eje de bandeja, sin holgura): PE1 9600 mm, PE2 5507 mm; total 15107 mm.
- Segmentos compartidos: ['T1'].
- Cable: sección COINCIDE_CON_REQUISITO; color CUMPLE; elección MODELO_A_CONFIRMAR (D-21: requisitos 16 mm² verde/amarillo aprobados); observaciones: Las condiciones de empleo de la ficha (cañería embutida, cañería a la vista, cableado de tableros) no incluyen bandejas: admisibilidad en bandeja a verificar con la reglamentación. / Radio mínimo de curvatura no publicado en la ficha.
- cobertura_fisica_pe: **COMPLETA**
- conexion_sistema_proteccion: **PRESENTE**
- conductores_sin_vinculo_al_sistema_proteccion: **[]**
- puntos_fisicamente_inconsistentes: **[]**
- vinculos_bandeja: **PIEZAS_SIN_VINCULO_PREVISTO**
- conexiones_previstas: **PENDIENTES**
- verificacion_electrica_de_diseno: **PENDIENTE**
- verificacion_por_inspeccion_o_medicion: **NO_REALIZADA**

| Pieza | Vínculo previsto | PE pasa | Alcanzada en el modelo |
|---|---|---|---|
| CS1 | SIN_VINCULO_PREVISTO | True | False |
| R1 | DIRECTO | True | True |
| R2 | VIA_PUENTE | True | True |
| R3 | SIN_VINCULO_PREVISTO | True | False |
| R4 | DIRECTO | True | True |
| R5 | SIN_VINCULO_PREVISTO | True | False |
| T1 | SIN_VINCULO_PREVISTO | True | False |

### Cómputo (resumen por producto)

| Producto | Cantidad | Unidad | Estado de la cantidad | Envases |
|---|---|---|---|---|
| GEN_ARANDELA-3_8__PENDIENTE | 36 | pieza | propuesta | — |
| GEN_TORNILLO-3_8-W__LARGO-PENDIENTE | 18 | juego | validada_usuario | — |
| GEN_TUERCA-3_8-W__PENDIENTE | 36 | pieza | propuesta | — |
| VRW101-3.8Z | 18 | pieza | validada_usuario | — |
| CS-300-90-065-18-Z | 1 | pieza | regla_producto | — |
| GFCE-B | 2 | pieza | declarada_en_trazado | 1 |
| GFS-02-Z | 18 | pieza | propuesta | — |
| JB-CC-3/8 | 24 | juego | documentada | 1 |
| STS-300-Z | 9 | pieza | declarada_en_trazado | — |
| TRES-300-065-18-Z | 5 | pieza | regla_producto | — |
| TS-300-065-18-Z | 1 | pieza | regla_producto | — |
| TTRS-300-22-Z | 1 | pieza | declarada_en_trazado | — |
| PRY-SASTFLEX-CU-1x16 | 15507 | mm | geométrica (sin holgura) | — |

Líneas pendientes sin cantidad técnica: 5 (fijación de tapa, conectores, terminales y componentes de soporte con evidencia 'propuesta').

> Resultado de preselección. No aprueba la instalación: no contrasta todas las condiciones de montaje y ensayo, ni verifica eléctricamente (intensidad, PE frente a la falla, continuidad medida).
