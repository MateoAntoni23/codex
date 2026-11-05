# CHANGELOG

## v0.2.2 – 2026-11-05 · Correcciones de la auditoría independiente de v0.2.1

Procedimiento: primero se convirtieron los 9 hallazgos en pruebas (`pruebas/test_regresiones_auditoria_v021.py`, `integracion/ts/auditoria_v021.test.ts`) y se ejecutaron sobre v0.2.1. **Los 9 se confirmaron.** Después se corrigió el motor. No se cambió ninguna expectativa de las pruebas anteriores: las 144 + 7 originales pasan sin modificaciones.

| # | Hallazgo | Reproducción en v0.2.1 (observado) | Corrección | Prueba | Resultado v0.2.2 |
|---|---|---|---|---|---|
| 1 | Cobertura parcial del PE | Todos los pasos con 1 mm → `cobertura COMPLETA`, `longitudes_completas: true`, total 8 mm, sin incumplimientos | Cobertura por pieza: COMPLETA / PARCIAL / INDETERMINADA / SIN_PE. Un tramo parcial solo es físico en los extremos del recorrido; si es intermedio, se marca incoherente | `H1_*` (6) | `INCOMPLETA`, R1 `PARCIAL`, `longitudes_completas: false`, incumplimiento. Ejemplo original: sigue `COMPLETA` |
| 2 | Requisito redefinible | 10 mm² + cable 1×10 → `COINCIDE_CON_REQUISITO`, sin incumplimientos | El requisito sale de las decisiones (`D-20_seccion_pe_mm2` = 16). La entrada se compara contra él | `H2_*` (4) | `ENTRADA_DISTINTA_DEL_REQUISITO_APROBADO`, `NO_COINCIDE_CON_REQUISITO`, dos incumplimientos |
| 3 | Derivación inconsistente | D1 en R1 → solo una observación; PE2 sigue unido al sistema de protección | Un punto que contradice el recorrido (conductor que no pasa por la pieza, o inicio/fin en otra pieza) no crea vínculo en el grafo. `estado_fisico` por punto | `H3_*` (4) | D1 `FISICAMENTE_INCONSISTENTE`; PE2 sin vínculo al sistema de protección; R4 no alcanzada; dos incumplimientos |
| 4 | Apoyos coincidentes | S2 = R1@3000, S3 = R2@0 → `ValueError: max() iterable argument is empty` | Error de dominio si dos soportes de una corrida están a ≤ 1 mm (D-14), en cualquier pieza. Además, un vano sin tramos nunca llega a `max()` | `H4_*` (4) | `ENTRADA_INVALIDA`, campo `soportes`, nombra S2 y S3 |
| 5 | Recta incoherente | R3 con P2 = (6600, 3000, 3000) y direcciones −X/+X → `COHERENTE` | Las direcciones de un recto deben seguir su eje P1→P2 dentro de 1° (D-14) | `H5_*` (4) | `INCOHERENTE` (desvío 90°/90°); 0,5° coherente; 2° incoherente |
| 6 | Contrato HTTP | `tipo_circuito=[]` → `TypeError`; UTF-8 inválido y `Content-Length: abc` → conexión cerrada sin respuesta | Validación de tipo en `tipo_circuito`. Servicio: errores 400/411/413/415/500 en JSON versionado. Barrido de valores raros en todas las claves | `H6_*` (9; barrido de 9 valores raros en cada clave de sector y trazado y en 7 campos anidados) | `ENTRADA_INVALIDA`; `CODIFICACION_INVALIDA`; `CONTENT_LENGTH_INVALIDO` |
| 7 | Cliente TypeScript | `estado="inventado"` aplicada; ok sin resultado → excepción; respuesta `sector` aplicada a solicitud `trazado` | `validarSobre` en tiempo de ejecución; el gestor guarda el `tipo` de la solicitud vigente | `auditoria_v021.test.ts` (6) | Rechazadas como `respuesta_malformada` o `eco_inconsistente`, sin excepciones |
| 8 | Esquema de ensayo | `contrastar_esquema` sin unión con n_vanos = 2 → `COINCIDE_EN_LO_CONTRASTADO` | Regla propuesta D-31: el vano debe reproducir un papel de la ventana del ensayo (central o lateral) con vecinos reales, luces y longitudes de tramo. Sin contexto: `SIN_CONTEXTO_DE_CORRIDA` | `H8_*` (6) + las 5 de v0.2.1 | Casos del informe `DISTINTO`/sin contexto → `CUMPLE_CONDICIONADO`; ventana del ensayo en G sigue `VERIFICADA_CUMPLE` (lateral, central, lateral) |
| 9 | Servicio sin control Host/Origin | Host `evil.example` → 200 | Allowlist de `Host`, `Origin` exacto, CORS solo a ese origen, `Content-Type` JSON obligatorio | `H6_H9_Servicio`, `H9_*` (8) | 403 `HOST_NO_PERMITIDO` / `ORIGEN_NO_PERMITIDO`; 415 |

Las mutaciones de cada corrección (15 en Python, 3 en TypeScript) hacen fallar al menos una prueba.

### Otros cambios
- `herramientas/verificar_snapshot.py` y `pruebas/test_snapshot_excel.py`: comparan el snapshot con el Excel REV-043 tabla por tabla (11 tablas). El Excel va incluido en `datos/catalogo/fuente/`.
- Resultado del trazado: `resumen.verificaciones_bloqueadas` (por ejemplo, cobertura del PE indeterminada). Con entradas en esa lista el estado es `CON_BLOQUEOS`, nunca preselección.
- Campos nuevos (aditivos): `pe.cobertura.por_pieza`, `piezas_con_cobertura_parcial`, `piezas_con_cobertura_indeterminada`; `pe.requisito.estado`, `seccion_declarada_en_entrada_mm2`; `equipotencial.puntos[].estado_fisico`, `estados.puntos_fisicamente_inconsistentes`; `geometria_piezas.*.desvio_direcciones_eje_grados`; `esquema_ensayo.rol_en_ensayo`, `regla_contraste`. Vectores de paridad regenerados: en el ejemplo solo cambian versión, huella, decisiones y esos campos agregados.
- Decisiones `2026-11-05.5`: se agrega `D-20_seccion_pe_mm2: 16` (valor ya aprobado) y la propuesta D-31. **No se cambió ninguna decisión abierta** (D-19 hueco, D-21 modelo, D-23, D-26, D-29, D-30 siguen igual).

### Pruebas
190 Python (144 originales sin cambios + 45 de regresión de la auditoría + 1 de snapshot contra el Excel) y 13 TypeScript (7 + 6). `tsc` estricto sin errores.

## v0.2.1 – 2026-11-05 · Respuestas del usuario: REV-043, esquema de ensayo, posición y color del PE

### Datos
- Catálogo `_2` (REV-043): filas Z65 separadas en A (F-001), B (F-004) y **C** (F-005, validada por usuario, regla REV-020). El motor usa C (290 kg/m a 1500 mm). `cargas_derivadas.json` queda vacío: DER-001 fue reemplazada por la fila C.
- Nuevo `datos/esquemas_ensayo.json` (ESQ-SAMET-TABLA-ENSAYO, desde la imagen aportada) y `docs/fuentes/esquema_ensayo_samet.png`. Entra en la huella.
- Decisiones `2026-11-05.4`: D-19 = `contra_ala_en_contacto`, D-21 color verde/amarillo, D-30 = 10 mm.

### Motor
- **D-12**: cada evaluación de vano trae `esquema_ensayo` (`COINCIDE_EN_LO_CONTRASTADO` / `DISTINTO` / `NO_DECLARADO`) y `estado_mecanico_registro`. `VERIFICADA_CUMPLE` solo se conserva si el vano coincide con el esquema; si no, `CUMPLE_CONDICIONADO`.
- **D-19**: modo `contra_ala_en_contacto` (W = W_potencia + D_PE, hueco 0, condición visible). `pendiente` sigue bloqueando.
- **D-21**: `estado_color` del PE (`CUMPLE` / `NO_CUMPLE_REQUISITO`) y `estado_eleccion = MODELO_A_CONFIRMAR`; un color no declarado entra en `incumplimientos`.

### Contrato
- Campos nuevos en vanos y en `pe.cable` (aditivos). Los vectores de paridad se regeneraron (versión 0.2.1).

### Pruebas
- 144 Python (+9 nuevas: esquema coincide / unión fuera de centro / unión sobre apoyo / vano aislado / esquema no declarado / esquema en la huella / D-19 por defecto / color / contacto ≠ vínculo) + 7 TS. Mutaciones sobre el contraste: 3/3 detectadas.
- Pruebas modificadas por el **cambio de datos aprobado** (no por ajuste de resultados): `test_casos_y_sesion` (sha del catálogo; condición `CTA_VALIDADA_POR_USUARIO`), `test_datos` (sha; registros Z65 A/B/C), `test_regresiones_revision_v010` H3 (Z65 ahora usa CAR-0046 validada; la curaduría se prueba con una derivación sintética DER-TEST), `test_trazado.test_d19_pendiente_bloquea` (fija `pendiente` explícitamente, porque el valor por defecto cambió).


## v0.2.0 – 2026-11-05 · Trazado, soportes, cómputo, PE y equipotencialidad

### Nuevo
- **Trazado (`trazado/1`)**: instancias de piezas del catálogo + conexiones por puerto (grafo), separadas de la asignación explícita de cables por circuito. Nada se reparte automáticamente entre ramales.
- **Compatibilidad por puerto** desde COMPATIBILIDADES. Distingue `NO_REGISTRADA` de `NO_COMPATIBLE`. Reglas propuestas D-13 (extremos de rectos) y D-13b (familias, REV-032), con condición visible.
- **Encaje y orientación** con la geometría que entrega el CAD (D-14, D-15). Ángulo publicado contra giro modelado. Clasificación horizontal / vertical interior / vertical exterior.
- **Radio de curvatura**: radio de la pieza con su referencia (interior/eje/exterior) contra el radio mínimo del cable con su condición y referencia. Peor caso: cable contra el ala interior (D-16). Con los datos actuales queda bloqueado: las fichas no publican el radio del cable.
- **Ocupación por sección** (pieza o boca, D-17), reutilizando las reglas v0.1.x.
- **Soportes**: corridas rectas, vanos reales, CTA solo a luz tabulada (D-22), escenario de reserva aparte (D-28). Capacidades de bandeja, soporte y anclaje separadas. Colocación como diagnóstico `SIN_REGLA_ACREDITADA`.
- **Cómputo**: por pieza, por conexión (D-24, sin duplicar extremos), tapas, accesorios, soportes y PE. Cada línea con origen, regla, evidencia y estado de la cantidad. Envases solo con cantidad por envase publicada.
- **PE 16 mm²** (requisito D-20): fichas Superastic Flex y Sintenax Valio, cobertura física por pieza, longitudes por conductor, segmentos compartidos y derivaciones. Se cuenta una sola vez: no puede figurar como circuito.
- **Red equipotencial**: sistema de protección, derivaciones, conexiones PE-bandeja, puentes y conectores. Estados separados de cobertura, conexiones previstas, verificación de diseño (`PENDIENTE`) y verificación de campo (`NO_REALIZADA`).
- **Integración**: sobre versionado `1.0`, servicio HTTP local, esquema JSON, vectores de paridad y cliente TypeScript con descarte de respuestas viejas y presentación sin "aprobado".

### Cambios de contrato y de datos
| Antes (v0.1.1) | Ahora (v0.2.0) |
|---|---|
| Snapshot formato 2 (solo rectos) | Formato 3: todas las hojas necesarias. El formato 2 sigue admitido |
| `Catalogo.productos` = rectos | Sin cambios. Nuevos: `piezas`, `puertos`, `compatibilidades`, `componentes_union`, `sistemas_soporte`, `componentes_soporte`, `aplicaciones_soporte` |
| Hash de contenido recalculado en cada consulta | Calculado una vez al construir (objeto inmutable); `verificar_hash()` recalcula para auditoría |
| `Cable` | + `colores`, `condiciones_empleo`, `radio_minimo`, `radio_minimo_estado` (dataset Sintenax v2) |
| Decisiones `2026-11-05.2` | `2026-11-05.3` (D-13…D-27) |
| `cargar_contexto()` | Sin cambios (sector). Nuevo `cargar_contexto_trazado()` con los candidatos a PE |

La huella de los resultados de sector cambia porque cambian el contenido del catálogo y la versión de decisiones. Los valores numéricos de los casos de sector no cambian.

### Pruebas
- 135 pruebas Python: las 78 de v0.1.1 **byte a byte sin cambios**, 47 de trazado y 10 de integración. A esto se suman 7 pruebas TypeScript y `tsc --strict`.
- Prueba de mutación: 6 reglas alteradas a propósito (uniones duplicadas, vínculo forzado, radio no conservador, cables en todas las bocas, D-13 sin condición, tapa ignorada). Las pruebas detectaron las 6.

## v0.1.1 – 2026-11-05 · Correcciones de la revisión independiente de v0.1.0

Cada hallazgo tiene pruebas en `pruebas/test_regresiones_revision_v010.py`. Los escenarios 1, 2 y 5 se reprodujeron primero sobre v0.1.0 intacta: huellas idénticas con CTA alterada; sesión vigente y selección conservada tras cambiar decisiones; ancho infinito → `APTA_GEOMETRIA_Y_MECANICA` y fallo de JSON estricto. Con v0.1.1, los tres quedan corregidos.

### Correcciones
- **H1 (alta) – huella.** `Catalogo.version()` y `RegistroCables.version()` incluyen un SHA-256 canónico del **contenido efectivo** (productos, cargas, familias, fuentes y derivaciones; cables), recalculado en cada llamada. Cambiar una CTA, una medida, una luz o una evidencia cambia la huella. Reimportar el mismo Excel no la cambia, porque la fecha de importación queda fuera. Catálogo y registro de cables pasan a ser inmutables (dataclasses congeladas, tuplas, `mappingproxy`).
- **H2 (alta) – sesión.** `SesionSector` revalida contra la huella en `vigente()`, `resultado`, `seleccion` y `seleccionar()`. Si cambian la entrada, los datos, las decisiones (incluida una mutación del dict suministrado) o el motor, el resultado pasa a `DESACTUALIZADO` y la selección se borra. Se agrega `actualizar_contexto()`.
- **H3 (alta) – evidencia combinada.** CAR-0046/0051/0056/0061 (escalera Z ala 65, 290 kg/m) se tratan como **valor adoptado por REV-020** (DER-001 en `datos/catalogo/cargas_derivadas.json`), con los dos registros originales separados: F-001, 1500 mm, 300 kg/m; F-004, sin luz, 290 kg/m. La decisión del usuario se conserva. Si el Excel cambia esos registros, la curación falla en forma explícita. Toda evaluación mecánica declara `esquema_ensayo_contrastado: false` (D-12).
- **H4 (media) – dimensiones nominales.** Si se usa ancho o ala nominal, el candidato queda como máximo en `PRESELECCION_CONDICIONADA`, con sus `condiciones`. `APTA_GEOMETRIA_Y_MECANICA` exige medidas útiles y CTA documentada.
- **H5 (media) – validación del catálogo.** Las medidas y cargas presentes deben ser finitas y > 0; texto, bool, 0, negativos, NaN e ±inf se rechazan. También se controlan ids duplicados, referencias a FAMILIAS, FUENTES y productos (`IDS_PRODUCTOS`) y valores de carga sin unidad. Se lanza `CatalogoInvalido` con la lista de problemas (hoja, fila, id, columna). La CLI emite JSON estricto (`allow_nan=False`).
- **H6 (media) – redacción.** `SAMET_ANALISIS.md` reescrito como modelos "compatibles con" las salidas: 24 tarjetas de 3 conjuntos de entradas, supuestos de ancho nominal y redondeo explícitos, significado del cero indeterminado. `DECISIONES.md` aclara que D-05 es una decisión de producto no aprobada ni normativa, y que D-03 sigue bloqueada.

### Cambios de contrato (consumidores del JSON)
| Antes (v0.1.0) | Ahora (v0.1.1) |
|---|---|
| Estado `APTA_GEOMETRIA_MECANICA_NO_VERIFICADA` | `PRESELECCION_CONDICIONADA` + `condiciones[]` |
| `APTA_GEOMETRIA_Y_MECANICA` con medidas nominales | Ya no ocurre: pasa a `PRESELECCION_CONDICIONADA` |
| Z ala 65: `VERIFICADA_CUMPLE` | `CUMPLE_CONDICIONADO`, `base_evidencia = adoptada_por_decision`, `registro.derivacion` |
| `mecanica` sin campo de evidencia | `base_evidencia`, `alcance`, `esquema_ensayo_contrastado` |
| `registro.estado_evidencia` | `registro.estado_evidencia_catalogo` (texto del Excel) + `registro.evidencia_motor` |
| `resumen_por_linea`: `estado_minimo_geometrico` | `minimo_sin_rechazo`, `estado_minimo_sin_rechazo`, `condiciones_minimo_sin_rechazo` |
| Candidato sin bandera intermedia | `minimo_sin_rechazo_de_linea` |
| `datos.cables` = `{dataset: {...}}` | `{datasets: {...}, sha256_contenido}` |
| `datos.catalogo` sin hash de contenido | `sha256_contenido`, `sha256_snapshot`, `importado_utc`, `derivaciones` |
| Snapshot formato 1 | Solo formato 2 (regenerar con el importador) |
| `D-06_evidencias_carga_aceptadas` con nombres del Excel | Nombres del motor: `documentada`, `validada_por_usuario`, `adoptada_por_decision` (decisiones `2026-11-05.2`) |
| `SesionSector.seleccionar` exigía geometría CUMPLE | Exige estado `APTA_GEOMETRIA_Y_MECANICA` o `PRESELECCION_CONDICIONADA`; la selección incluye `condiciones` |

### Suite
- 78 pruebas (56 originales adaptadas al contrato + 22 nuevas), todas aprobadas.
- La suite original de v0.1.0 corrida sin cambios contra v0.1.1: 46 de 56 aprobadas. Las 10 restantes reflejan los cambios de contrato listados arriba: 7 por el snapshot sintético en formato 1, 2 por los estados nuevos de H3/H4 y 1 porque `excluidos` ahora es una tupla.

### Sin cambios
Fórmulas de masa, disposición y reserva; D-01, D-02, D-03 (bloqueada), D-05 (valor por defecto); bloqueos por apilado, diámetros distintos y mando/señal; sin interpolación de cargas. Los resultados numéricos de los tres casos son idénticos a v0.1.0: 0,456 / 0,912 kg/m; 56,7 / 121,5 / 64,8 mm.

## v0.1.0 – 2026-11-05
Primera entrega.
