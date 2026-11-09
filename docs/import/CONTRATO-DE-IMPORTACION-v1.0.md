# CONTRATO DE IMPORTACIÓN — Equipos, conexiones y datos técnicos

**Formato:** `ELS-IMP-EQCX` · **Versión del formato:** `1.0` · **Libro de referencia:** `ELS-SYC_Importacion_Equipos_Conexiones_v1.0_Rev0.xlsx` (Rev0, 2026-11-09)
**Origen de los datos:** `ELS-SYC_Excel_General_Tecnico_RevC2_1.xlsx` (EGT RevC.2, 06/11/2026)
**Destinatario:** Claude Code. Debe implementar la lectura de este formato en el programa de diseño de instalaciones.

> Este documento define el **formato externo** del libro Excel. No describe ni supone tipos, clases ni contratos internos del programa, porque su autor no tuvo acceso al repositorio. La adaptación a las estructuras existentes es tarea de Claude Code (ver §13).

---

## 1. Objetivo y límites

**Qué hace el formato.** Describe qué equipos y qué conexiones existen o se requieren, sus datos técnicos consultables y su trazabilidad hasta el Excel de ingeniería. Sirve para:

1. Crear en el programa los equipos (sin ubicación 3D) y sus componentes internos.
2. Crear las conexiones funcionales requeridas y los cables, conductores o tubos que cada una necesita.
3. Mostrar en el inspector la ficha técnica de cada equipo al seleccionarlo, tenga o no un recorrido asignado.

**Qué no hace:**

- No contiene coordenadas, dimensiones de escena ni recorridos. Tampoco catálogos de bandejas ni modelos geométricos.
- No fija longitudes. Toda longitud del libro es una **referencia de ingeniería** (prefijo `ref_ing_`). La longitud definitiva sale del trazado en el programa.
- No contiene la "longitud efectiva de bajada", que se configura en el programa (ver §1.1).
- Los cálculos eléctricos incluidos (Ib, Iz, ΔV, selección de aparamenta) son **información de ingeniería importada**. No son validaciones del programa y no deben presentarse como tales.
- No contiene la asignación de E/S del PLC (canal, slot). Solo se incluyen el PLC asignado y la cantidad de señales por equipo, como atributos.

### 1.1 Longitudes: regla obligatoria

| Concepto | Dónde vive | Cómo se usa |
|---|---|---|
| Longitud de referencia del EGT | `CONEXIONES.ref_ing_longitud_m`, `ref_ing_long_herramienta_v53_m` | Solo se muestra o se compara. **No** es restricción ni valor inicial obligatorio del trazado. |
| Metraje de compra del EGT | `TENDIDOS.ref_ing_metraje_compra_m` | Referencia histórica de compra. **No** es longitud de recorrido. |
| Longitud geométrica del recorrido | Programa | Se calcula con el trazado. |
| Longitud efectiva de una bajada (p. ej. 1 m dibujado, 2 m computados) | Programa (configuración de diseño) | **Sustituye** a la geométrica de esa bajada; no se suma. Aplica solo a la bajada o conexión externa, no a accesorios. **No forma parte de este formato.** |

La columna de origen "Long. manual (m)" **no** se trasladó como orden de fijar longitudes. Su valor vigente quedó, como mucho, como `ref_ing_longitud_m`.

### 1.2 Definiciones

| Concepto | Hoja | Definición | Ejemplo real |
|---|---|---|---|
| **Equipo físico** | `EQUIPOS` | Objeto con TAG que el usuario ubica en la escena 3D: motor, instrumento, válvula, tablero, caja de derivación. | `S1-SOP101` (motor), `TAB-B` (tablero) |
| **Componente interno** | `COMPONENTES` | Elemento alojado dentro de un equipo o tablero. **No se ubica** como equipo de campo y puede no tener TAG. | Variador V20 de `EA-BBA001` dentro de `TAB-B`; electroválvula `EA-VM001-SV` dentro de `TAB-NA`; sondas PTC dentro del motor `S1-VEN101` |
| **Conexión funcional** | `CONEXIONES` | Vínculo requerido entre dos extremos (equipos). Es lo que recibe un recorrido en el programa. | `CX-0001`: TD-EX → TAB-A (alimentador F-TAB-A) |
| **Tendido** | `TENDIDOS` | Cable, conductor o tubo físico que materializa una conexión. Una conexión puede tener varios. | `CX-0001` tiene 3 tendidos: `CB-001` (6 unipolares 1×150 = 2 ternas), `CB-002` (neutro 1×35) y `CB-003` (PE 1×95) |

**Cantidades.** 272 conexiones no son 272 cables, y un tendido no es una unidad física. `TENDIDOS.cantidad_unidades` indica cuántas unidades físicas idénticas hay y `conductores_por_unidad` cuántos conductores tiene cada una. Ejemplo: `CB-001` = 6 unidades × 1 conductor (dos ternas de tres unipolares), que no equivale a 2 cables multipolares.

---

## 2. Versión e identificación del libro

- Hoja `LEEME`: tabla `clave | valor | descripcion`. El importador **debe** leer:
  - `formato_id` = `ELS-IMP-EQCX`. Si el valor es otro, se rechaza el libro.
  - `formato_version` = `MAYOR.MENOR`. El importador acepta su mismo `MAYOR`. Un `MENOR` superior puede traer columnas nuevas opcionales, que se ignoran con un aviso. Si el `MAYOR` es distinto, se rechaza.
  - `libro_revision`, `fecha_generacion`, `fuente_archivo`, `fuente_revision`: se guardan en el registro de importación.
- Propiedades del documento: `title` = `ELS-IMP-EQCX v1.0` y `keywords` = `formato_id=ELS-IMP-EQCX;formato_version=1.0`. Son redundantes y sirven como control secundario. Si contradicen a `LEEME`, prevalece `LEEME` y se emite un aviso.
- Nombre de archivo sugerido: `<proyecto>_Importacion_Equipos_Conexiones_v<formato>_Rev<n>.xlsx`. El nombre **no** se usa para identificar la versión.

---

## 3. Hojas obligatorias y opcionales

| Hoja | Obligatoria | Contenido | Se importa al modelo |
|---|---|---|---|
| `LEEME` | Sí | Metadatos y versión | Metadatos |
| `EQUIPOS` | Sí | Una fila por equipo físico | Sí |
| `CONEXIONES` | Sí | Una fila por conexión funcional | Sí |
| `TENDIDOS` | Sí | Una fila por cable, conductor o tubo (o grupo idéntico) | Sí |
| `LISTAS` | Sí | Valores permitidos | Validación |
| `CATALOGO_ATRIBUTOS` | Sí | Atributos técnicos admitidos (tipo, unidad, multivalor) | Validación y presentación |
| `COMPONENTES` | No | Componentes internos de equipos y tableros | Sí, si existe |
| `ATRIBUTOS_TECNICOS` | No | Ficha técnica de equipos y componentes (formato largo) | Sí, si existe |
| `ALIAS` | No | Nombres alternativos que resuelven a un equipo | Resolución de referencias |
| `PENDIENTES` | No | Problemas conocidos del libro | Se muestran en la vista previa |
| `TRAZABILIDAD` | No | Correspondencia con hojas y filas del Excel original | Se guarda como metadato o se muestra |

Reglas comunes a todas las hojas:

- Encabezados en la **fila 1**, datos desde la fila 2. Una sola tabla rectangular por hoja.
- Sin celdas combinadas, subtotales ni filas separadoras. Las filas totalmente vacías se ignoran.
- Las columnas se localizan **por nombre exacto de encabezado**, no por posición. Una columna obligatoria faltante es un ERROR de libro. Una columna desconocida genera una ADVERTENCIA y se ignora.
- El color, el formato visual y los desplegables no tienen significado. Los desplegables son solo ayuda para el usuario.
- El libro no contiene fórmulas. Si el importador encuentra una celda con fórmula, debe tratarla como ERROR de celda.

**Por qué hay hojas adicionales respecto de la propuesta inicial:** `COMPONENTES` es necesaria para representar variadores, electroválvulas y PTC sin convertirlos en equipos de campo. `ATRIBUTOS_TECNICOS` y `CATALOGO_ATRIBUTOS` guardan la ficha técnica sin generar una tabla de cientos de columnas. `ALIAS` hace explícitos los nombres alternativos. No hay hojas duplicadas: cada dato se guarda en un solo lugar.

---

## 4. Diccionario exacto de columnas

Tipos: `ID` = identificador de texto con patrón fijo · `REF` = texto que referencia un ID de otra tabla · `TEXTO` · `ENUM` = texto con valor de `LISTAS` · `ENTERO` · `DECIMAL` (número en la celda, nunca texto).
Obligatoriedad: `SI` · `NO` · `COND` = condicional (ver significado).
La unidad de cada número está en el nombre de la columna (`_m`, `_mm`, `_mm2`, `_v`, `_a`, `_pct`) o, en `ATRIBUTOS_TECNICOS`, en la columna `unidad`.

#### LEEME

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `clave` | Clave. | TEXTO | — | SI | — | `formato_id` |
| `valor` | Valor. | TEXTO | — | SI | — | `ELS-IMP-EQCX` |
| `descripcion` | Explicación. | TEXTO | — | NO | — | — |

#### EQUIPOS

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `equipo_id` | Identificador estable del equipo físico. Clave de todas las relaciones. | ID | — | SI | Patrón EQ-NNNN, único, no se reutiliza | `EQ-0029` |
| `tag` | TAG original del Excel de ingeniería, conservado sin modificar. | TEXTO | — | SI | Texto libre; único entre equipos no retirados | `S1-SOP101` |
| `categoria` | Clase normalizada del equipo. | ENUM | — | SI | LISTAS:categoria_equipo | `MOTOR` |
| `tipo_origen` | Tipo tal como figura en el origen (ELEMENTOS!B u hoja equivalente). | TEXTO | — | NO | — | `Motor (IEC)` |
| `descripcion` | Descripción o función del equipo. | TEXTO | — | SI | — | `Soplador ciclón` |
| `proyecto` | Proyecto comercial al que pertenece. | ENUM | — | SI | LISTAS:proyecto | `SEC` |
| `planta` | Planta física, solo cuando está documentada (prefijo de TAG o ubicación). | ENUM | — | NO | LISTAS:planta | `SECADO_1` |
| `sector` | Sector dentro de la planta (prefijo EA/EB/EV o ubicación documentada). | ENUM | — | NO | LISTAS:sector | `EVAPORADOR_A` |
| `subsector` | Subárea (p. ej. FM = filtro de manga, subárea de Secado). Solo si está demostrado. | ENUM | — | NO | LISTAS:subsector | `FM` |
| `ubicacion_descriptiva` | Ubicación textual conocida. Vacío = no documentada. No son coordenadas. | TEXTO | — | NO | — | `PB — Sala ventiladores` |
| `nivel` | Nivel extraído literalmente de la ubicación descriptiva. | ENUM | — | NO | LISTAS:nivel | `PB` |
| `ubicacion_ref_pendiente` | Código del pendiente de ingeniería que define la ubicación, cuando el origen dice 'A DEFINIR (RL-xx)'. | TEXTO | — | NO | — | `RL-05` |
| `tablero_origen_id` | Tablero desde el que se alimenta o comanda según el origen (informativo; no crea conexión). | REF | — | NO | EQUIPOS.equipo_id | `EQ-0012` |
| `contenedor_id` | Equipo físico que lo contiene, cuando corresponda. Los componentes internos van en COMPONENTES, no aquí. | REF | — | NO | EQUIPOS.equipo_id | — |
| `estado_alcance` | Existente, nuevo, reemplazo, reubicado, retirado o a definir. | ENUM | — | SI | LISTAS:estado_alcance | `EXISTENTE` |
| `estado_alcance_confirmado` | NO si el origen lo marca 'A CONFIRMAR' o es una propuesta por defecto. | ENUM | — | SI | LISTAS:si_no | `NO` |
| `fuente_hoja` | Hoja principal de origen. | TEXTO | — | SI | — | `ELEMENTOS` |
| `fuente_fila` | Fila de la hoja de origen (vacío si el registro sale de un texto de decisión). | ENTERO | — | COND | — | `33` |
| `observaciones` | Observaciones del origen y notas de traslado. | TEXTO | — | NO | — | — |

#### COMPONENTES

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `componente_id` | Identificador estable del componente interno. | ID | — | SI | Patrón CMP-NNNN, único | `CMP-0021` |
| `tag` | TAG original si el componente lo tiene (electroválvulas -SV, solenoides de toberas, PTC). | TEXTO | — | NO | — | `EA-VM001-SV` |
| `tipo_componente` | Clase del componente interno. | ENUM | — | SI | LISTAS:tipo_componente | `VARIADOR` |
| `descripcion` | Descripción. | TEXTO | — | SI | — | `SINAMICS V20 4 kW FSB, 8,8 A` |
| `contenedor_equipo_id` | Equipo o tablero que lo contiene físicamente. | REF | — | SI | EQUIPOS.equipo_id | `EQ-0105` |
| `equipo_asociado_id` | Equipo de campo al que sirve (p. ej. el motor del variador). | REF | — | NO | EQUIPOS.equipo_id | `EQ-0139` |
| `codigo_referencia` | Código de fabricante o clave de catálogo. | TEXTO | — | NO | — | `6SL3210-5BE24-0CV0` |
| `marca` | Marca, si está documentada. | TEXTO | — | NO | — | `Siemens` |
| `cantidad` | Unidades idénticas agrupadas en la fila (1 si es individual). | ENTERO | u | SI | >= 1 | `1` |
| `estado_alcance` | Estado de alcance del componente. | ENUM | — | SI | LISTAS:estado_alcance | `NUEVO` |
| `origen_seleccion` | Cómo se obtuvo la selección (CALCULADO = selección por cálculo de ingeniería, no adoptada). | ENUM | — | SI | LISTAS:origen_valor | `CALCULADO` |
| `estado_dato` | Grado de confirmación. | ENUM | — | SI | LISTAS:estado_dato | `A_CONFIRMAR` |
| `proyecto` | Proyecto comercial. | ENUM | — | NO | LISTAS:proyecto | `EVA` |
| `fuente_hoja` | Hoja de origen. | TEXTO | — | SI | — | `APARAMENTA` |
| `fuente_fila` | Fila de origen. | ENTERO | — | COND | — | `25` |
| `observaciones` | Notas. | TEXTO | — | NO | — | — |

#### ATRIBUTOS_TECNICOS

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `atributo_id` | Identificador estable de la fila de atributo. | ID | — | SI | Patrón AT-NNNNN, único | `AT-00001` |
| `equipo_id` | Equipo al que pertenece el dato (también cuando el dato es de un componente interno). | REF | — | SI | EQUIPOS.equipo_id | `EQ-0029` |
| `componente_id` | Si el dato es de un componente interno; su contenedor o equipo asociado debe ser equipo_id. | REF | — | NO | COMPONENTES.componente_id | — |
| `atributo` | Código del atributo. | ENUM | — | SI | CATALOGO_ATRIBUTOS.atributo | `potencia_kw` |
| `valor_numero` | Valor numérico. Obligatorio si el atributo es NUMERO y estado_dato ≠ PENDIENTE. | DECIMAL | según 'unidad' | COND | — | `7.5` |
| `valor_texto` | Valor de texto. Obligatorio si el atributo es TEXTO y estado_dato ≠ PENDIENTE. | TEXTO | — | COND | — | — |
| `unidad` | Unidad del valor numérico; debe coincidir con la unidad del catálogo. | TEXTO | — | COND | CATALOGO_ATRIBUTOS.unidad | `kW` |
| `origen_valor` | PLACA, HOJA_DATOS, DECLARADO, ESTIMADO o CALCULADO. | ENUM | — | SI | LISTAS:origen_valor | `ESTIMADO` |
| `estado_dato` | PENDIENTE = el dato debe definirse y no hay valor. | ENUM | — | SI | LISTAS:estado_dato | `A_RELEVAR` |
| `vigente` | SI = valor que se muestra por defecto. Las alternativas se conservan con NO; no se reemplazan en silencio. | ENUM | — | SI | LISTAS:si_no | `SI` |
| `fuente_hoja` | Hoja de origen. | TEXTO | — | SI | — | `CARGAS_S1` |
| `fuente_fila` | Fila de origen. | ENTERO | — | COND | — | `6` |
| `fuente_columna` | Encabezado de la columna de origen. | TEXTO | — | NO | — | `P adoptada (kW)` |
| `observaciones` | Notas. | TEXTO | — | NO | — | `Estimado PM 29/10` |

#### CONEXIONES

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `conexion_id` | Identificador estable de la conexión funcional requerida. | ID | — | SI | Patrón CX-NNNN, único | `CX-0001` |
| `circuito_tag` | Identificador de circuito del origen (columna 'Circuito / TAG'). | TEXTO | — | NO | — | `F-TAB-A` |
| `servicio` | Servicio normalizado. | ENUM | — | SI | LISTAS:servicio | `POTENCIA` |
| `grupo_origen` | Código de grupo de segregación del origen (P, P-VFD, PE, C, I, D) sin traducir. | ENUM | — | NO | LISTAS:grupo_origen | `P` |
| `descripcion` | Descripción o función. | TEXTO | — | SI | — | `Alimentador TAB-A Secado P1` |
| `origen_equipo_id` | Extremo origen. Vacío solo con un pendiente REFERENCIA_NO_RESUELTA. | REF | — | COND | EQUIPOS.equipo_id | `EQ-0016` |
| `origen_componente_id` | Componente interno del extremo origen, si está documentado (p. ej. el variador). | REF | — | NO | COMPONENTES.componente_id | — |
| `origen_texto_original` | Texto del origen sin modificar. | TEXTO | — | SI | — | `TD-EX` |
| `destino_equipo_id` | Extremo destino. Vacío solo con un pendiente REFERENCIA_NO_RESUELTA. | REF | — | COND | EQUIPOS.equipo_id | `EQ-0014` |
| `destino_componente_id` | Componente interno del extremo destino, si está documentado. | REF | — | NO | COMPONENTES.componente_id | — |
| `destino_texto_original` | Texto del origen sin modificar. | TEXTO | — | SI | — | `TAB-A` |
| `sistema` | Sistema eléctrico del origen (3F, 1F, 24 VDC, Señal, Datos, PE, N). | TEXTO | — | NO | — | `3F` |
| `tension_v` | Tensión nominal del circuito. | DECIMAL | V | NO | — | `380` |
| `proyecto` | Proyecto comercial. | ENUM | — | SI | LISTAS:proyecto | `SEC` |
| `alcance_comercial` | Texto comercial del origen. | TEXTO | — | NO | — | `COTIZADO v2.5` |
| `estado_alcance` | NUEVO, EXISTENTE, MODIFICADO, RETIRADO o A_DEFINIR. | ENUM | — | SI | LISTAS:estado_alcance | `MODIFICADO` |
| `ref_ing_corriente_diseno_a` | REFERENCIA DE INGENIERÍA: Ib de diseño calculada en el EGT. No es validación del programa. | DECIMAL | A | NO | — | `317.28` |
| `ref_ing_longitud_m` | REFERENCIA DE INGENIERÍA: longitud vigente en el EGT. No es longitud fija ni restricción del trazado. | DECIMAL | m | NO | — | `10` |
| `ref_ing_longitud_origen` | De dónde salió esa longitud de referencia. | TEXTO | — | NO | — | `PM 02/11 \| Listado Secado 1` |
| `ref_ing_long_herramienta_v53_m` | REFERENCIA DE INGENIERÍA: longitud de la herramienta HTML v5.3 anterior. | DECIMAL | m | NO | — | `9` |
| `observaciones` | Notas de traslado. | TEXTO | — | NO | — | — |

#### TENDIDOS

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `tendido_id` | Identificador del cable, conductor o tubo físico. Para cables es el ID CB del proyecto (etiquetado en obra). | ID | — | SI | CB-NNN (cables del EGT) o TUB-NNNN (tubos); único | `CB-001` |
| `conexion_id` | Conexión funcional a la que pertenece. | REF | — | SI | CONEXIONES.conexion_id | `CX-0001` |
| `naturaleza` | Cable multipolar, conductor unipolar, cable de datos o tubo. | ENUM | — | SI | LISTAS:naturaleza_tendido | `CONDUCTOR_UNIPOLAR` |
| `funcion` | Qué conductores lleva. | ENUM | — | SI | LISTAS:funcion_tendido | `FASES` |
| `composicion_origen` | Columna 'Conductores' del origen, sin traducir. | TEXTO | — | NO | — | `3F` |
| `cantidad_unidades` | Cantidad de cables, conductores unipolares o tubos físicos idénticos. | ENTERO | u | SI | >= 1 | `6` |
| `conductores_por_unidad` | Conductores internos por unidad. Vacío = desconocido o no aplica (tubos). | ENTERO | u | COND | >= 1 | `1` |
| `incluye_pe` | Si la unidad ya incluye el PE. No agregar PE si es SI o DESCONOCIDO. | ENUM | — | SI | LISTAS:incluye_pe | `NO` |
| `seccion_mm2` | Sección eléctrica por conductor. Vacío en datos y tubos. | DECIMAL | mm² | COND | > 0 | `150` |
| `seccion_pe_mm2` | Sección del PE incluido en la unidad, si incluye_pe = SI. | DECIMAL | mm² | NO | > 0 | — |
| `apantallado` | SI, NO o NO_INDICADO. | ENUM | — | SI | LISTAS:apantallado | `NO_INDICADO` |
| `diametro_exterior_mm` | Diámetro exterior demostrado (catálogo). Vacío si no está demostrado. | DECIMAL | mm | NO | > 0 | — |
| `diametro_interior_mm` | Diámetro interior demostrado (tubos). | DECIMAL | mm | NO | > 0 | — |
| `diametro_sin_tipificar_mm` | Diámetro citado en el origen sin indicar si es interior o exterior. No usar como exterior. | DECIMAL | mm | NO | > 0 | `6` |
| `designacion` | Designación técnica del origen. | TEXTO | — | NO | — | `2×(3×1×150)` |
| `tipo_designacion_compra` | Tipo de cable para compra según el origen. | TEXTO | — | NO | — | `1×150` |
| `marca_modelo` | Marca/modelo/referencia de catálogo solo si está documentada. | TEXTO | — | NO | — | — |
| `estado_alcance` | NUEVO, EXISTENTE, MODIFICADO (parte existente) o A_DEFINIR. | ENUM | — | SI | LISTAS:estado_alcance | `MODIFICADO` |
| `cantidad_unidades_existentes` | Unidades ya instaladas que se reutilizan, si el origen lo indica. Vacío = no indicado. | ENTERO | u | NO | >= 0 | `3` |
| `ref_ing_iz_a` | REFERENCIA DE INGENIERÍA: Iz corregida calculada en el EGT. | DECIMAL | A | NO | — | `501.5` |
| `ref_ing_caida_tension_pct` | REFERENCIA DE INGENIERÍA: caída de tensión calculada en el EGT (en %, no fracción). | DECIMAL | % | NO | — | `0.149` |
| `ref_ing_verificacion` | REFERENCIA DE INGENIERÍA: resultado de verificación del EGT. | TEXTO | — | NO | — | `✔ OK` |
| `ref_ing_metraje_compra_m` | REFERENCIA DE INGENIERÍA: metros de compra con reserva. NO es longitud de recorrido. | DECIMAL | m | NO | — | `33` |
| `fuente_hoja` | Hoja de origen. | TEXTO | — | SI | — | `CONDUCTORES` |
| `fuente_fila` | Fila de origen. | ENTERO | — | COND | — | `7` |
| `observaciones` | Observaciones del origen. | TEXTO | — | NO | — | — |

#### ALIAS

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `alias_id` | Identificador de la fila. | ID | — | SI | Patrón AL-NNNN, único | `AL-0001` |
| `alias` | Nombre alternativo que puede aparecer en referencias. | TEXTO | — | SI | Único; no puede coincidir con un TAG activo | `S1-SFM` |
| `equipo_id` | Equipo al que resuelve el alias. | REF | — | SI | EQUIPOS.equipo_id | `EQ-0002` |
| `tipo_alias` | Origen del alias. | ENUM | — | SI | LISTAS:tipo_alias | `ORDEN_ASOCIADA` |
| `fuente` | Evidencia. | TEXTO | — | SI | — | `ELEMENTOS fila 6` |

#### PENDIENTES

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `pendiente_id` | Identificador. | ID | — | SI | Patrón PD-NNNN, único | `PD-0001` |
| `severidad` | ERROR impide importar el registro; ADVERTENCIA permite continuar; INFO solo informa. | ENUM | — | SI | LISTAS:severidad | `ADVERTENCIA` |
| `tipo` | Clase de problema. | ENUM | — | SI | LISTAS:tipo_pendiente | `CONFLICTO_DATO` |
| `tabla` | Hoja afectada. | TEXTO | — | SI | Nombre de hoja | `EQUIPOS` |
| `registro_id` | ID del registro afectado (o ID de origen si no se trasladó). | TEXTO | — | SI | — | `EQ-0105` |
| `campo` | Columna afectada. | TEXTO | — | NO | — | `proyecto` |
| `descripcion` | Qué pasa y qué se hizo. | TEXTO | — | SI | — | — |
| `valor_origen` | Valor tal como figura en el origen. | TEXTO | — | NO | — | `EVA` |
| `fuente` | Evidencia (hoja!fila, decisión). | TEXTO | — | SI | — | `ELEMENTOS fila 106; DECISIONES D-07` |
| `accion_sugerida` | Qué hay que confirmar o decidir. | TEXTO | — | NO | — | — |
| `estado` | ABIERTO o RESUELTO. | ENUM | — | SI | LISTAS:estado_pendiente | `ABIERTO` |

#### TRAZABILIDAD

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `traza_id` | Identificador. | ID | — | SI | Patrón TR-NNNNN, único | `TR-00001` |
| `hoja_origen` | Hoja del Excel original. | TEXTO | — | SI | — | `CONDUCTORES` |
| `fila_origen` | Fila del Excel original (vacío si viene de un texto de decisión o de la lista de IDs borrados). | ENTERO | — | COND | — | `7` |
| `id_origen` | TAG, ID CB o clave del registro de origen. | TEXTO | — | NO | — | `CB-001` |
| `accion` | Qué se hizo con el registro. | ENUM | — | SI | LISTAS:accion_traza | `TRASLADADO` |
| `tabla_destino` | Hoja de este libro donde quedó. | TEXTO | — | NO | — | `TENDIDOS` |
| `id_destino` | ID en este libro. | TEXTO | — | NO | — | `CB-001` |
| `observacion` | Motivo. | TEXTO | — | NO | — | — |

#### LISTAS

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `lista` | Nombre de la lista. | TEXTO | — | SI | — | `servicio` |
| `valor` | Valor permitido (código). | TEXTO | — | SI | — | `POTENCIA` |
| `descripcion` | Significado / equivalencia documentada. | TEXTO | — | NO | — | — |

#### CATALOGO_ATRIBUTOS

| Columna | Significado | Tipo | Unidad | Oblig. | Valores permitidos | Ejemplo |
|---|---|---|---|---|---|---|
| `atributo` | Código del atributo. | TEXTO | — | SI | snake_case, único | `potencia_kw` |
| `nombre` | Nombre para mostrar en el inspector. | TEXTO | — | SI | — | `Potencia` |
| `tipo_dato` | Tipo de valor. | ENUM | — | SI | NUMERO \| TEXTO | `NUMERO` |
| `unidad` | Unidad canónica (obligatoria si NUMERO, salvo adimensional '-'). | TEXTO | — | COND | — | `kW` |
| `multivalor` | SI = puede haber varias filas vigentes del mismo atributo por equipo/componente. | ENUM | — | SI | LISTAS:si_no | `NO` |
| `grupo` | Agrupación en el inspector. | TEXTO | — | SI | — | `Eléctrico` |
| `descripcion` | Significado. | TEXTO | — | NO | — | — |


### 4.1 Listas de valores permitidos (`LISTAS`)

| Lista | Valores (código — significado) |
|---|---|
| `si_no` | `SI` · `NO` |
| `proyecto` | `SEC` — Modernización Secado 1 · `EVA` — Modernización Evaporador A · `EVB` — Construcción Evaporador B · `FM` — Filtro de manga ELS-2026-003 (cotizado aparte) · `COMUN` — Infraestructura común (TD-EX) |
| `planta` | `SECADO_1` — Prefijo S1 / Secado Planta 1 · `EVAPORACION` — Prefijos EA, EB, EV · `LABORATORIO` — Prefijo LB |
| `sector` | `EVAPORADOR_A` — Prefijo EA · `EVAPORADOR_B` — Prefijo EB · `SERVICIOS_COMUNES_EVAPORACION` — Prefijo EV |
| `subsector` | `FM` — Filtro de manga — subárea de Secado (regla acordada) |
| `nivel` | `PB` — Planta baja · `PISO_1` — Piso 1 · `PISO_2` — Piso 2 · `ULTIMO_PISO` — Último piso (Evaporación) |
| `categoria_equipo` | `TABLERO` — Tablero eléctrico · `TABLERO_NEUMATICO` — Tablero neumático · `TABLERO_HMI` — Tablero con HMI · `CAJA_DERIVACION` — Caja de derivación · `RACK_RED` — Rack de red · `MOTOR` — Motor · `INSTRUMENTO_TRANSMISOR` — Transmisor analógico · `SENSOR_DISCRETO` — Sensor o interruptor discreto · `VALVULA_MODULANTE` — Válvula modulante · `VALVULA_ONOFF` — Válvula de corte on/off · `VALVULA_SOLENOIDE` — Válvula con solenoide propio · `VALVULA_PROCESO_NEUMATICA` — Válvula de proceso accionada desde tablero neumático (actuador sin TAG propio) · `SOLENOIDE_CAMPO` — Solenoide de campo (martillos) · `ACTUADOR` — Actuador sin válvula identificada · `PARADA_EMERGENCIA` — Parada de emergencia · `PROYECTOR` — Proyector de iluminación · `LUMINARIA_EMERGENCIA` — Luminaria / proyector de emergencia · `CAMARA` — Cámara de seguridad · `BOTONERA` — Botonera · `BALIZA` — Baliza · `EQUIPO_EXISTENTE_TERCEROS` — Equipo existente de terceros (solo señal) · `OTRO` — Otro |
| `tipo_componente` | `VARIADOR` · `ARRANQUE_SUAVE` · `GUARDAMOTOR` · `CONTACTOR` · `PROTECCION_VARIADOR` — Protección por variador (tipo a definir) · `TERMOMAGNETICA` · `SECCIONADORA_FUSIBLE` · `ELECTROVALVULA` — Electroválvula piloto dentro de tablero neumático · `SOLENOIDE` · `TERMISTOR_PTC` — Sondas PTC dentro del motor · `PLC_CPU` · `PLC_MODULO_ES` · `FUENTE_24VDC` · `RELE_INTERFAZ` · `BARRAS` · `MANDO_PUERTA` — Selectora / piloto |
| `estado_alcance` | `EXISTENTE` — Existe y se mantiene/reutiliza · `NUEVO` · `REEMPLAZO` — Nuevo que reemplaza a uno existente · `REUBICADO` — Existente trasladado · `MODIFICADO` — Parte existente + parte nueva · `RETIRADO` — Fuera del alcance; se conserva solo por trazabilidad · `A_DEFINIR` — El origen no lo define |
| `origen_valor` | `PLACA` — Relevado de la placa del equipo · `HOJA_DATOS` — Hoja de datos o catálogo del fabricante · `DECLARADO` — Informado por PM/cliente o fijado como criterio de proyecto · `ESTIMADO` — Estimación o supuesto de ingeniería · `CALCULADO` — Resultado de cálculo del EGT (no validado por el programa) |
| `estado_dato` | `CONFIRMADO` · `A_CONFIRMAR` · `A_RELEVAR` — Requiere relevamiento en obra · `CANDIDATO` — Opción propuesta, no elegida · `CONFLICTO` — Hay valores contradictorios en el origen · `PENDIENTE` — Dato requerido sin valor (no es 'no aplica') |
| `servicio` | `POTENCIA` — Grupos P y P-VFD; incluye N y PE que acompañan al circuito · `CONTROL` — Grupo C · `INSTRUMENTACION` — Grupo I · `COMUNICACION` — Grupo D · `EQUIPOTENCIALIDAD` — PE de equipotencialidad de bandejas (grupo PE con descripción explícita) · `PUESTA_A_TIERRA` — Sin registros en el origen actual · `NEUMATICA` — Tubing tablero neumático → válvula |
| `grupo_origen` | `P` — potencia general (CONDUCTORES fila 3) · `P-VFD` — salida de variadores (CONDUCTORES fila 3; ver D-22: sin pantalla) · `C` — maniobra 24 VDC (CONDUCTORES fila 3) · `I` — instrumentación 4–20 mA apantallada (CONDUCTORES fila 3) · `D` — datos (CONDUCTORES fila 3) · `PE` — no definido en la leyenda; se interpreta fila por fila por la descripción |
| `naturaleza_tendido` | `CABLE_MULTIPOLAR` · `CONDUCTOR_UNIPOLAR` · `CABLE_DATOS` · `TUBO` |
| `funcion_tendido` | `FASES` · `NEUTRO` · `PE` · `3F+PE` · `3F+N+PE` · `F+N+PE` · `SENAL_CONTROL` · `SENAL_INSTRUMENTACION` · `DATOS` · `EQUIPOTENCIAL` · `AIRE_COMPRIMIDO` |
| `incluye_pe` | `SI` · `NO` — El PE va en otro tendido o no corresponde a la función · `NO_APLICA` — Señal, datos, tubo o el tendido es el propio PE/N · `DESCONOCIDO` — No agregar PE sin confirmar |
| `apantallado` | `SI` · `NO` · `NO_INDICADO` — El origen no lo dice |
| `tipo_alias` | `TAG_ANTERIOR` · `NOMBRE_EN_ORIGEN` — Variante de nombre usada en otra hoja · `TAG_CIRCUITO` — TAG de circuito/carga que designa al equipo · `ORDEN_ASOCIADA` — TAG de orden/señal que llega al equipo |
| `severidad` | `ERROR` — Impide importar el registro · `ADVERTENCIA` — Se importa; requiere revisión · `INFO` — Solo informativo |
| `tipo_pendiente` | `CONFLICTO_DATO` · `REFERENCIA_NO_RESUELTA` · `REFERENCIA_RESUELTA_CON_EVIDENCIA` · `DATO_FALTANTE` · `AMBIGUEDAD_PE` · `CODIGO_SIN_TRADUCIR` · `CLASIFICACION_DUDOSA` · `INCONSISTENCIA_ORIGEN` |
| `estado_pendiente` | `ABIERTO` · `RESUELTO` |
| `accion_traza` | `TRASLADADO` · `FUSIONADO` — Duplicado de un registro ya trasladado · `CONVERTIDO_ATRIBUTO` · `CONVERTIDO_COMPONENTE` · `CONVERTIDO_ALIAS` · `EXCLUIDO_TITULO` — Fila de título, subtotal o control · `EXCLUIDO_SIMBOLICO` — Destino simbólico o circuito, no equipo · `EXCLUIDO_RETIRADO` — ID borrado del alcance; no se reutiliza · `EXCLUIDO_NO_INSTALA` — Ítem de contingencia o cantidad 0 · `DESCARTADO_AMBIGUO` — Dato no trasladado por ambiguo (ver observación) |

### 4.2 Catálogo de atributos técnicos (`CATALOGO_ATRIBUTOS`)

| atributo | Nombre | Tipo | Unidad | Multivalor | Grupo |
|---|---|---|---|---|---|
| `potencia_kw` | Potencia | NUMERO | kW | NO | Eléctrico |
| `potencia_hp` | Potencia (HP) | NUMERO | HP | NO | Eléctrico |
| `tension_v` | Tensión nominal | NUMERO | V | NO | Eléctrico |
| `fases` | Fases | NUMERO | - | NO | Eléctrico |
| `frecuencia_hz` | Frecuencia | NUMERO | Hz | NO | Eléctrico |
| `corriente_nominal_a` | Corriente nominal | NUMERO | A | NO | Eléctrico |
| `rendimiento` | Rendimiento | NUMERO | p.u. | NO | Eléctrico |
| `factor_potencia` | Factor de potencia | NUMERO | p.u. | NO | Eléctrico |
| `arranque` | Arranque / accionamiento | TEXTO | — | NO | Eléctrico |
| `tipo_carga` | Tipo de carga | TEXTO | — | NO | Eléctrico |
| `marca_modelo` | Marca / modelo | TEXTO | — | NO | Identificación |
| `plc_asignado` | PLC | TEXTO | — | NO | Control |
| `senales_plc_cantidad` | Señales de PLC | NUMERO | u | NO | Control |
| `tipo_instrumento` | Tipo de instrumento | TEXTO | — | NO | Instrumentación |
| `variable_medida` | Variable medida | TEXTO | — | NO | Instrumentación |
| `senal` | Señal | TEXTO | — | NO | Instrumentación |
| `tipo_es` | Tipo de E/S | TEXTO | — | NO | Instrumentación |
| `rango` | Rango | TEXTO | — | NO | Instrumentación |
| `conexion_proceso` | Conexión a proceso | TEXTO | — | NO | Instrumentación |
| `material_contacto` | Material en contacto | TEXTO | — | NO | Instrumentación |
| `accesorios` | Accesorios | TEXTO | — | NO | Instrumentación |
| `alimentacion` | Alimentación | TEXTO | — | NO | Eléctrico |
| `grado_ip` | Grado IP | TEXTO | — | NO | Envolvente |
| `funcion` | Función | TEXTO | — | NO | Proceso |
| `tipo_actuador` | Tipo de actuador | TEXTO | — | NO | Proceso |
| `accionamiento` | Accionamiento | TEXTO | — | NO | Proceso |
| `salida_plc_asociada` | Salida de PLC asociada | TEXTO | — | NO | Control |
| `presion_trabajo_bar` | Presión de trabajo | NUMERO | bar | NO | Proceso |
| `tipo_electrovalvula` | Tipo de electroválvula | TEXTO | — | NO | Proceso |
| `tension_bobina_v` | Tensión de bobina | NUMERO | V | NO | Eléctrico |
| `potencia_bobina_w` | Potencia de bobina | NUMERO | W | NO | Eléctrico |
| `ancho_mm` | Ancho | NUMERO | mm | NO | Dimensiones |
| `alto_mm` | Alto | NUMERO | mm | NO | Dimensiones |
| `profundidad_mm` | Profundidad | NUMERO | mm | NO | Dimensiones |
| `peso_kg` | Peso | NUMERO | kg | NO | Dimensiones |
| `disipacion_w` | Disipación | NUMERO | W | NO | Térmico |
| `disipacion_suma_componentes_w` | Disipación (Σ componentes con dato) | NUMERO | W | NO | Térmico |
| `montaje` | Montaje | TEXTO | — | NO | Dimensiones |
| `material_envolvente` | Material de envolvente | TEXTO | — | NO | Envolvente |
| `composicion_descriptiva` | Composición (texto de origen) | TEXTO | — | NO | General |
| `proteccion_aguas_arriba` | Protección aguas arriba | TEXTO | — | NO | Eléctrico |
| `corriente_total_cargas_a` | Σ In de cargas | NUMERO | A | NO | Eléctrico |
| `potencia_cargas_internas_kw` | Cargas internas del tablero | NUMERO | kW | NO | Eléctrico |
| `area_servida` | Área servida | TEXTO | — | SI | Ubicación |
| `capacidad_a` | Corriente asignada | NUMERO | A | NO | Eléctrico |
| `fusible_actual` | Fusible instalado hoy | TEXTO | — | NO | Eléctrico |
| `fusible_requerido` | Fusible requerido | TEXTO | — | NO | Eléctrico |
| `base_nh` | Base NH | TEXTO | — | NO | Eléctrico |
| `destino_final` | Destino final | TEXTO | — | NO | Eléctrico |
| `conectado_hoy` | Conectado hoy | TEXTO | — | NO | Eléctrico |
| `etapa` | Etapa / momento | TEXTO | — | NO | Gestión |
| `termistor` | Termistor | TEXTO | — | NO | Protección |

### 4.3 Equivalencia de códigos de servicio del origen

La leyenda de la hoja CONDUCTORES del EGT (fila 3) define: *P-VFD salida de variadores apantallada · P potencia general · C maniobra 24 VDC · I instrumentación 4–20 mA apantallada · D datos.*

| Código de origen (`grupo_origen`) | `servicio` | Evidencia | Observación |
|---|---|---|---|
| `P` | `POTENCIA` | Leyenda | |
| `P-VFD` | `POTENCIA` | Leyenda | La leyenda dice "apantallada", pero D-22 (Rev12) y DV-01 aceptan salidas **sin** pantalla. Se cargó `apantallado = NO` y se registró un pendiente. |
| `C` | `CONTROL` | Leyenda | Incluye contactos NC de paradas (sistema "Señal"). |
| `I` | `INSTRUMENTACION` | Leyenda | Incluye los PTC hacia el variador. |
| `D` | `COMUNICACION` | Leyenda | |
| `PE` | No traducido de forma global | No está en la leyenda | Se interpretó **fila por fila**: "Conductor de protección" con el mismo origen y destino que un alimentador es un tendido `PE` **dentro** de la conexión de potencia; "equipotencialidad" es una conexión con servicio `EQUIPOTENCIALIDAD`. |
| — | `PUESTA_A_TIERRA` | — | No hay registros de puesta a tierra en el origen. El valor existe para uso futuro. |
| — | `NEUMATICA` | Hoja NEUMATICA + D-01 (Rev12): "tubing a cada actuador" | Una conexión por válvula, del tablero neumático a la válvula. |

---

## 5. Identificadores y relaciones

```
EQUIPOS (equipo_id) ─┬─< COMPONENTES.contenedor_equipo_id      (lo contiene físicamente)
                     ├─< COMPONENTES.equipo_asociado_id        (equipo al que sirve; opcional)
                     ├─< ATRIBUTOS_TECNICOS.equipo_id          (ficha técnica)
                     ├─< CONEXIONES.origen_equipo_id / destino_equipo_id
                     ├─< EQUIPOS.tablero_origen_id / contenedor_id
                     └─< ALIAS.equipo_id
COMPONENTES (componente_id) ─┬─< ATRIBUTOS_TECNICOS.componente_id
                             └─< CONEXIONES.origen_componente_id / destino_componente_id
CONEXIONES (conexion_id) ──< TENDIDOS.conexion_id   (1 conexión : N tendidos; mínimo 1)
```

- **Estabilidad.** `equipo_id`, `componente_id`, `conexion_id`, `atributo_id` y `tendido_id` son **la identidad** del registro entre importaciones. Un ID nunca se reutiliza, ni siquiera después de retirar el registro.
- `tendido_id` de cables = ID `CB-NNN` del proyecto, el mismo que se etiqueta en obra (D-46). Los tubos usan `TUB-NNNN`.
- **TAG ≠ ID.** El TAG original se conserva tal cual (incluidos nombres no normalizados como `Tablero quemador` o `Caja S1-PREM1`). Debe ser único entre los equipos no retirados. Un cambio de TAG con el mismo ID es un **renombre**, no un equipo nuevo.
- **Componentes en los extremos de una conexión.** Son opcionales y deben estar contenidos en el equipo del extremo (`COMPONENTES.contenedor_equipo_id` = `*_equipo_id`). El recorrido se asigna siempre al equipo; el componente es un detalle de borne.
- **Atributo de un componente.** `equipo_id` debe ser el contenedor o el equipo asociado del componente. Así, al seleccionar un motor, el inspector puede mostrar también los datos de su variador.
- **IDs nuevos.** Las filas que se agreguen en el Excel deben usar el siguiente número libre del patrón. Para lo creado dentro del programa, ver §13 (espacio de nombres a definir).
- **IDs retirados no reutilizables:** `TRAZABILIDAD` con `accion = EXCLUIDO_RETIRADO` (25 IDs CB). El importador debe rechazar un `tendido_id` nuevo que coincida con uno de ellos.

---

## 6. Reglas de validación y mensajes

Severidades: **ERROR** impide importar el registro, o el libro entero si es de nivel libro. **ADVERTENCIA** permite importar y queda marcada. **INFO** solo informa.

| Código | Nivel | Regla | Severidad | Mensaje sugerido |
|---|---|---|---|---|
| V-01 | Libro | Falta una hoja obligatoria | ERROR | "Falta la hoja {hoja}. El archivo no es un libro ELS-IMP-EQCX completo." |
| V-02 | Libro | `formato_id` distinto o `formato_version` con otro MAYOR | ERROR | "Formato {id} v{ver} no compatible con este importador (espera ELS-IMP-EQCX v1.x)." |
| V-03 | Libro | Falta una columna obligatoria | ERROR | "La hoja {hoja} no tiene la columna {col}." |
| V-04 | Libro | Columna desconocida | ADVERTENCIA | "Columna {col} de {hoja} no reconocida: se ignora." |
| V-05 | Registro | ID vacío, con patrón inválido o duplicado | ERROR | "{hoja} fila {n}: identificador {id} inválido o repetido." |
| V-06 | Registro | Obligatorio vacío | ERROR | "{hoja} {id}: falta {col}." |
| V-07 | Registro | Valor fuera de `LISTAS` | ERROR | "{hoja} {id}: '{valor}' no es un valor permitido para {col}." |
| V-08 | Registro | Texto en una columna numérica | ERROR | "{hoja} {id}: {col} debe ser un número (se leyó '{valor}')." |
| V-09 | Registro | REF a un ID inexistente | ERROR | "{hoja} {id}: {col} apunta a {ref}, que no existe." |
| V-10 | Registro | TAG repetido entre equipos no retirados | ERROR | "TAG {tag} repetido en {id1} y {id2}." |
| V-11 | Registro | Conexión sin tendidos | ERROR | "La conexión {id} no tiene tendidos." |
| V-12 | Registro | Extremo de conexión vacío **sin** pendiente `REFERENCIA_NO_RESUELTA` | ERROR | "La conexión {id} no tiene {origen/destino} y no hay un pendiente que lo explique." |
| V-13 | Registro | Extremo vacío **con** pendiente | ADVERTENCIA | "La conexión {id} se importa sin {extremo}; no se podrá trazar hasta resolverlo ({pendiente})." |
| V-14 | Registro | Componente de extremo no contenido en el equipo del extremo | ERROR | "{id}: el componente {cmp} no pertenece a {equipo}." |
| V-15 | Registro | Conexión activa con un extremo `RETIRADO` | ERROR | "La conexión {id} usa el equipo retirado {tag}." |
| V-16 | Atributo | `atributo` fuera del catálogo | ERROR | "Atributo {atr} desconocido." |
| V-17 | Atributo | NUMERO sin `valor_numero`, con unidad distinta del catálogo o con texto | ERROR | "{atr} de {tag}: valor/unidad inválidos (esperado número en {unidad})." |
| V-18 | Atributo | `estado_dato = PENDIENTE` con algún valor cargado | ERROR | "{atr} de {tag}: un dato PENDIENTE no debe tener valor." |
| V-19 | Atributo | Más de un `vigente = SI` para (equipo, componente, atributo) no multivalor | ERROR | "{tag}: hay más de un valor vigente para {atr}." |
| V-20 | Atributo | `estado_dato = CONFLICTO` | ADVERTENCIA | "{tag}: {atr} tiene valores contradictorios en el origen." |
| V-21 | Tendido | `incluye_pe = SI` con una función sin PE, o `TUBO` con sección | ERROR | "{id}: combinación incoherente ({detalle})." |
| V-22 | Tendido | `cantidad_unidades < 1` o `conductores_por_unidad < 1` | ERROR | "{id}: cantidad inválida." |
| V-23 | Tendido | `tendido_id` coincide con un ID retirado | ERROR | "{id} fue retirado del alcance y no puede reutilizarse." |
| V-24 | Alias | Alias igual a un TAG activo o que resuelve a dos equipos | ERROR | "Alias {alias} ambiguo." |
| V-25 | Libro | Hay filas en `PENDIENTES` con severidad ERROR | ERROR para el registro indicado | "{registro}: {descripcion}" |
| V-26 | Libro | Celda con fórmula en una hoja de datos | ERROR | "{hoja}!{celda} contiene una fórmula: se esperan valores." |

Los mensajes deben nombrar **hoja, ID y TAG**, nunca solo un número de fila. El libro entregado no tiene errores (§12).

---

## 7. Vacíos, desconocidos y no aplicables

| Situación | Representación | El importador debe… |
|---|---|---|
| Dato desconocido (numérico) | Celda **vacía** | Guardar "sin dato". **Nunca** convertirlo en 0. |
| Dato que no aplica | Celda vacía en columnas opcionales; en `incluye_pe`, `NO_APLICA` | Mostrar "—" o "no aplica". |
| Dato requerido y pendiente de definir | `ATRIBUTOS_TECNICOS` con `estado_dato = PENDIENTE` y sin valor | Mostrarlo en el inspector como "Pendiente" (es distinto de "no aplica"). |
| Estado de alcance no documentado | `estado_alcance = A_DEFINIR` | Importar sin inferir otro estado. |
| PE desconocido | `incluye_pe = DESCONOCIDO` | **No** agregar un PE automáticamente. |
| Apantallamiento no indicado | `apantallado = NO_INDICADO` | No asumir SI ni NO. |
| Diámetro sin tipificar | `diametro_sin_tipificar_mm` | **No** usarlo como diámetro exterior para ocupación. |
| Ubicación no documentada | `ubicacion_descriptiva` vacía; `ubicacion_ref_pendiente` = código (p. ej. `RL-05`) | Importar sin ubicación 3D. |
| Cero real | Número 0 | Solo cuando el origen afirma cero (p. ej. `cantidad_unidades_existentes = 0`). El libro actual no usa ceros como sustituto. |

---

## 8. Duplicados, alias y referencias sin resolver

- **Equipos repetidos en varias hojas del origen** (ELEMENTOS, TABLEROS, CARGAS, INSTRUMENTACION…) se fusionaron en un solo registro. Los datos de cada hoja quedaron como atributos con su `fuente_hoja` y `fuente_fila`. `TRAZABILIDAD` muestra las fusiones (`FUSIONADO`, `CONVERTIDO_ATRIBUTO`).
- **Alias** (`ALIAS`): resuelven nombres alternativos en referencias de reimportaciones futuras o de otras fuentes. Tipos: `TAG_ANTERIOR`, `NOMBRE_EN_ORIGEN`, `TAG_CIRCUITO` y `ORDEN_ASOCIADA`. Reglas:
  1. Para resolver una referencia, primero se busca el `equipo_id`, después el TAG activo exacto y por último el alias exacto.
  2. Un alias nunca puede coincidir con un TAG activo. Los TAG anteriores que se cruzan con TAG vigentes (renumeraciones EB-V108↔V119 de la hoja TAGS) **no** se importaron como alias.
  3. Si el alias no es único, la referencia queda sin resolver y no se adivina.
- **Referencias sin resolver:** el extremo queda vacío, el texto original se conserva en `*_texto_original` y hay una fila en `PENDIENTES` (`REFERENCIA_NO_RESUELTA`). Casos actuales:
  - `CX-0010` (CB-018, troncal de la guirnalda UPS de Secado): el destino es "Recorrido Secado".
  - `CX-0209` y `CX-0210` (CB-239/240, PE de equipotencialidad): el "destino" es el sistema de bandejas. Ver §13.
- **Referencias resueltas con evidencia** (`REFERENCIA_RESUELTA_CON_EVIDENCIA`): cada una cita su prueba (p. ej. CB-092 → `S1-PEM1`). Se importan con una advertencia para que alguien las revise.

---

## 9. Política de reimportación

Objetivo: actualizar datos de ingeniería **sin sobrescribir en silencio el diseño 3D** (ubicaciones, recorridos, bandejas, longitudes calculadas, longitudes efectivas de bajada).

1. **Propiedad de los datos.**
   - Son del Excel todas las columnas de este formato.
   - Son del programa la ubicación y orientación 3D, el recorrido asignado, la longitud calculada, la longitud efectiva de bajada y todo lo que no figure en este formato.
   - Una reimportación **nunca** modifica datos del programa. Como mucho, los marca "a revisar".
2. **Correspondencia de registros:** por ID estable (`equipo_id`, `componente_id`, `conexion_id`, `tendido_id`, `atributo_id`).
   - Un ID presente en el Excel y en el proyecto se compara campo por campo.
   - Un ID presente solo en el Excel es **nuevo**.
   - Un ID presente solo en el proyecto es **huérfano**: nunca se borra automáticamente. Se ofrece mantener, retirar o borrar.
   - **Renombre probable:** si un equipo nuevo tiene un TAG igual al TAG de un huérfano, o resuelve por `ALIAS` a un huérfano, se propone "renombrar conservando la ubicación" y el usuario decide.
3. **Clasificación de cambios en la vista previa:** sin cambios / nuevos / modificados (mostrando campo, valor anterior y valor nuevo) / huérfanos / renombres probables / pasaron a `RETIRADO`.
4. **Efectos sobre el diseño:**
   - Cambio de `origen_equipo_id` o `destino_equipo_id` en una conexión con recorrido: el recorrido se conserva marcado "extremo cambiado — revisar". No se recalcula ni se borra solo.
   - Cambio en tendidos (cantidad, sección, conductores, diámetro): se recalculan ocupación y listas de materiales, y se marcan los tramos afectados. El recorrido no cambia.
   - Equipo que pasa a `RETIRADO` y ya está ubicado o tiene conexiones: se oculta del conjunto activo, pero su modelo y sus recorridos se conservan hasta que el usuario confirme.
   - Cambio de atributos técnicos: se aplica directamente, porque no afecta la geometría.
   - Cambio en `ref_ing_*`: solo se actualiza la referencia. Nunca cambia la longitud calculada.
5. **Control de versión:** se guarda en el proyecto el `formato_version`, `libro_revision`, `fecha_generacion` y un hash del archivo importado. Reimportar el mismo hash no hace nada.
6. **Respaldo y registro:** antes de aplicar se guarda una copia del proyecto. Después se registra un historial de importación (fecha, archivo, resumen de cambios y decisiones del usuario).
7. **Atributos:** cada atributo se identifica por `atributo_id`. Si en una revisión cambia un valor, el valor anterior no se pierde: el Excel debe agregar una fila nueva y poner la anterior con `vigente = NO`. El programa conserva lo que recibe.

---

## 10. Mapeo desde el Excel original (EGT RevC.2)

### 10.1 Fuentes y hojas derivadas

| Hoja del EGT | Rol | Destino |
|---|---|---|
| ELEMENTOS | Fuente principal de equipos | EQUIPOS (y COMPONENTES/ALIAS en 7 casos) |
| TABLEROS | Fuente de tableros (se fusiona) | EQUIPOS + ATRIBUTOS |
| CARGAS_S1 / CARGAS_EA / CARGAS_EB | Datos eléctricos de cargas | ATRIBUTOS |
| INSTRUMENTACION | Hoja de datos de instrumentos | ATRIBUTOS |
| NEUMATICA | Válvulas, electroválvulas y tubing | EQUIPOS, COMPONENTES, CONEXIONES, TENDIDOS, ATRIBUTOS |
| CONDUCTORES | Fuente de cables (un CB por fila) | CONEXIONES + TENDIDOS |
| APARAMENTA | Aparamenta por carga | COMPONENTES |
| ALIMENTACIONES | Seccionadoras del TD-EX | COMPONENTES + ATRIBUTOS |
| LDM_POR_TABLERO | PLC, fuentes, relés, barras, mandos y gabinetes | COMPONENTES; dimensiones de gabinete como ATRIBUTOS |
| DATOS_COMPONENTES | Dimensiones, peso y disipación por código | ATRIBUTOS de componentes |
| RESUMEN_TABLEROS | Σ disipación por tablero | ATRIBUTOS |
| DECISIONES, CAMBIOS_EGT, TAGS, LEEME, LEEME_Rev12, SUPUESTOS, DESVIOS | Evidencia | Citadas en fuente, observaciones y pendientes |
| LISTA_IO*, SEÑALES_*, RACKS_PLC, KITS_PLC | Derivadas o E/S del PLC | No se migran (fuera de alcance) |
| ASIG_SEC, ASIG_EVA, REVISION_LONGITUDES | Rutas y longitudes de la herramienta anterior | No se migran; la longitud vigente queda como `ref_ing_` |
| BANDEJAS, BANDEJAS_COMPRA, CONFIG_BAND, TRAMOS | Bandejas | No se migran (fuera de alcance) |
| LDM, METRAJE, SOLICITUD_MATERIALES, COMPRADO*, COTIZACION, GESTION | Gestión y compras | No se migran |

### 10.2 Columnas

**ELEMENTOS → EQUIPOS / ATRIBUTOS**

| Columna de origen | Destino | Regla |
|---|---|---|
| TAG | `EQUIPOS.tag` | Literal. "Recorrido Secado", "Recorrido paradas de emergencia" y "S1-UPS-G" se excluyen (son destinos simbólicos o circuitos). S1-TB1…4 y los -PTC pasan a COMPONENTES. S1-QMR-SEÑ pasa a ALIAS. |
| Tipo | `tipo_origen` + `categoria` | Tabla de mapeo fija (`CAT_MAP` en el generador). Algunos TAG se fuerzan (TAB-N, TAB-NA, Tablero neumático FM → `TABLERO_NEUMATICO`; RACK-RED → `RACK_RED`). |
| Proyecto | `proyecto` | Con correcciones documentadas en PENDIENTES (D-07, D-38, CB-059, D-34, TABLEROS "común"). |
| Tablero / origen | `tablero_origen_id` | Solo si resuelve a un TAG de equipo. |
| PLC | atributo `plc_asignado` | |
| Señales E/S (LISTA_IO) | atributo `senales_plc_cantidad` (CALCULADO) | Solo si es > 0. |
| Conductores / Cant. conductores | — | Derivado: se reconstruye desde CONEXIONES. |
| Bandeja de llegada | — | Diseño de la herramienta anterior; no se migra. |
| Existente / nuevo / reemplaza | `estado_alcance` + `estado_alcance_confirmado` | "A CONFIRMAR" → confirmado = NO. Conflictos con TABLEROS o DECISIONES en PENDIENTES. |
| Ubicación | `ubicacion_descriptiva`, `nivel`, `ubicacion_ref_pendiente` | "A DEFINIR (RL-xx)" → vacío + código. Si ELEMENTOS no la define, se usa la ubicación de TABLEROS. |
| P (kW), In (A), Arranque | atributos | Solo si la carga no está en CARGAS (evita duplicar). |
| Datos técnicos / señal | `descripcion` | |
| Marca / modelo / código | atributo `marca_modelo` | Salvo "A DEFINIR". |
| Estado del dato | — | Se refleja en `estado_dato` de cada atributo. |
| Observaciones | `observaciones` | |

**TABLEROS → EQUIPOS (fusión) / ATRIBUTOS:** Ubicación → `ubicacion_descriptiva` (si falta); Existente/nuevo → `estado_alcance` (llena un A_DEFINIR o se registra el conflicto); Protección aguas arriba → `proteccion_aguas_arriba`; Σ In cargas → `corriente_total_cargas_a` (CALCULADO, solo > 0); E/S (PLC) → `senales_plc_cantidad`; Gabinete → `composicion_descriptiva` o `material_envolvente`; IP "A DEFINIR" → `grado_ip` PENDIENTE; Observaciones → `observaciones`. "Conductores que salen/llegan" y "Elementos alimentados" son derivados y no se migran.

**CARGAS_* → ATRIBUTOS**

| Columna | Atributo | origen_valor / vigente |
|---|---|---|
| P adoptada (kW) | `potencia_kw` | Según "Origen dato": "Hoja de datos" → HOJA_DATOS · "Estimado/Supuesto" → ESTIMADO · PM → DECLARADO. En CARGAS_EA sin kW cargado → CALCULADO (conversión de HP). Vigente = SI. |
| P listado 25/26 (kW) | `potencia_kw` | DECLARADO, `CONFLICTO`, vigente = NO (solo si difiere del adoptado). |
| P otras fuentes (HP) / P (HP) | `potencia_hp` | DECLARADO. Si no concuerda con el kW adoptado (±6 %): `CONFLICTO`, vigente = NO y pendiente. |
| U (V), Fases | `tension_v`, `fases` | DECLARADO (criterio de proyecto). No se trasladan para las cámaras (fila de carga sin dato real). |
| — | `frecuencia_hz` = 50 | Motores; criterio de LEEME_Rev12 "380 V 3F 50 Hz (motores)". |
| η, cosφ | `rendimiento`, `factor_potencia` | ESTIMADO / A_RELEVAR (hoja SUPUESTOS). En S1-VEN101 prevalece la hoja de datos citada en Observaciones. |
| In placa (A) | `corriente_nominal_a` | HOJA_DATOS, vigente. |
| In estimada (A) | `corriente_nominal_a` | CALCULADO / A_RELEVAR; vigente solo si no hay valor de placa. |
| In diseño (A) | — | Duplica una de las dos anteriores. |
| Arranque, Tipo carga | `arranque`, `tipo_carga` | |
| TAG anterior | `ALIAS` (TAG_ANTERIOR) | Solo si es el TAG sin prefijo de área (p. ej. SOP101 → S1-SOP101). El resto se descarta por ambiguo. |
| Long. listado (m) | — | La longitud es de la conexión; ya está como referencia en CONEXIONES. |
| Estado | `estado_dato` | "A RELEVAR placa" → A_RELEVAR · "[SUP]/ESTIMADO/A CONFIRMAR" → A_CONFIRMAR · "CONFIRMADO" → CONFIRMADO. |
| TAB-B-AUX1/AUX2 | `potencia_cargas_internas_kw` = 1,5 en TAB-B | D-50. |

**INSTRUMENTACION → ATRIBUTOS:** Tipo → `tipo_instrumento` (y `variable_medida` derivada literalmente del texto); Señal → `senal`; Tipo E/S → `tipo_es`; Rango, Conexión a proceso, Material, IP y Accesorios → atributos homónimos (si dicen "A DEFINIR", quedan como PENDIENTE y el requisito entre paréntesis va a observaciones); Marca/modelo → `marca_modelo` (CANDIDATO si dice "candidato" o "doble cotización"); caudalímetros → `alimentacion` (D-40). Cable (ID) y Existente/nuevo no se migran: son derivados o ya están en EQUIPOS.

**NEUMATICA → EQUIPOS / COMPONENTES / CONEXIONES / TENDIDOS / ATRIBUTOS:**

- TAG válvula → equipo `VALVULA_PROCESO_NEUMATICA`.
- TAG electroválvula → componente `ELECTROVALVULA` dentro del tablero (`TAB-N` o `TAB-NA`). Válvula, actuador y electroválvula **no** se fusionan. El actuador no tiene TAG propio en el origen, así que se registra como atributo `tipo_actuador` de la válvula.
- Función, Tipo actuador y DO asociada → atributos de la válvula.
- Electroválvula → `tipo_electrovalvula` del componente. Marca/código → `marca_modelo` CANDIDATO.
- Ø tubo → `diametro_sin_tipificar_mm`.
- Long. tubing estimada → `ref_ing_longitud_m`.
- Racores, codos y silenciador → observaciones del tendido (accesorios de montaje).

**CONDUCTORES → CONEXIONES / TENDIDOS**

| Columna | Destino | Regla |
|---|---|---|
| ID | `tendido_id` | Literal. |
| (agrupación) | `conexion_id` | Un CB = una conexión, salvo N y PE con el mismo origen y destino que su alimentador: CB-002/003 → CB-001; CB-005/006 → CB-004; CB-009 → CB-007; CB-062 → CB-061; CB-064 → CB-063. |
| Grupo | `grupo_origen` + `servicio` | §4.3. |
| Circuito / TAG | `circuito_tag` | |
| Descripción | `descripcion` | |
| Origen, Destino | `*_equipo_id`, `*_componente_id`, `*_texto_original` | Resolución: ID → TAG exacto → alias → "TAG + detalle" (p. ej. "TAB-B (V20)" → TAB-B y su variador asociado). Los casos especiales están en PENDIENTES. |
| Construcción | `naturaleza` | "Unipolar…" → CONDUCTOR_UNIPOLAR · "Datos" → CABLE_DATOS · resto → CABLE_MULTIPOLAR. |
| Conductores | `composicion_origen` + `funcion` | |
| Designación | `designacion`, `cantidad_unidades`, `conductores_por_unidad`, `incluye_pe` | "n×(3×1×S)" → 3n unipolares · "n × k×S" → n cables de k conductores · "k×S+PE" → 1 cable de k+1 conductores con PE. |
| SECCIÓN (mm²) | `seccion_mm2` | Vacío si es 0 (datos). |
| PE (mm²) | `seccion_pe_mm2` | Solo si el PE está incluido en la unidad ("incl. (= fase)" → igual a la sección). |
| Sistema, U (V) | `sistema`, `tension_v` | |
| Ib (A) | `ref_ing_corriente_diseno_a` | |
| LONGITUD (m) | `ref_ing_longitud_m` | Referencia, no restricción. |
| Fuente longitud EGT + Origen longitud | `ref_ing_longitud_origen` | |
| Long. herramienta (m) | `ref_ing_long_herramienta_v53_m` | |
| Long. ref. listado, Long. Rev12, Long. manual, Bajada, Ruta, Ternas (forzar), S ampacidad/ΔV/mín/calculada/forzar, cosφ, Margen, kG, I req, Lím. ΔV | — | Datos intermedios de cálculo o de diseño anterior: no se migran. |
| Iz corr. total, ΔV (%), Estado | `ref_ing_iz_a`, `ref_ing_caida_tension_pct`, `ref_ing_verificacion` | Información de ingeniería, no validación. |
| Tipo de cable (compra) | `tipo_designacion_compra` | |
| Metros (c/ reserva) | `ref_ing_metraje_compra_m` | Metraje de compra, **no** longitud de recorrido. |
| Proyecto, Alcance comercial | `proyecto`, `alcance_comercial` | |
| Observaciones | `TENDIDOS.observaciones` | |
| (estado) | `estado_alcance` | EXISTENTE con evidencia (CB-008; CB-055/059/249/250 por D-43) · MODIFICADO para CB-001 (1 terna existente + 1 nueva) · A_DEFINIR si el metraje de compra es 0 (cables FM) · NUEVO en el resto. |

---

## 11. Ejemplos

### 11.1 Ejemplos reales (trazables al libro y al origen)

**Equipo (EQUIPOS)** — origen: ELEMENTOS fila 33, CARGAS_S1 fila 6.

| `equipo_id` | `tag` | `categoria` | `descripcion` | `proyecto` | `planta` | `ubicacion_descriptiva` | `nivel` | `tablero_origen_id` | `estado_alcance` | `estado_alcance_confirmado` |
|---|---|---|---|---|---|---|---|---|---|---|
| EQ-0026 | S1-SOP101 | MOTOR | Soplador ciclón | SEC | SECADO_1 | PB — Sala ventiladores | PB | EQ-0009 | EXISTENTE | NO |

**Ficha técnica (ATRIBUTOS_TECNICOS) del mismo equipo, incluidos sus componentes**

| `atributo_id` | `componente_id` | `atributo` | `valor_numero` | `valor_texto` | `unidad` | `origen_valor` | `estado_dato` | `vigente` | `fuente_hoja` | `fuente_fila` |
|---|---|---|---|---|---|---|---|---|---|---|
| AT-00001 |  | potencia_kw | 7.5 |  | kW | ESTIMADO | A_RELEVAR | SI | CARGAS_S1 | 6 |
| AT-00002 |  | potencia_hp | 15 |  | HP | DECLARADO | CONFLICTO | NO | CARGAS_S1 | 6 |
| AT-00003 |  | potencia_kw | 9.3 |  | kW | DECLARADO | CONFLICTO | NO | CARGAS_S1 | 6 |
| AT-00004 |  | tension_v | 380 |  | V | DECLARADO | CONFIRMADO | SI | CARGAS_S1 | 6 |
| AT-00005 |  | fases | 3 |  | - | DECLARADO | CONFIRMADO | SI | CARGAS_S1 | 6 |
| AT-00006 |  | frecuencia_hz | 50 |  | Hz | DECLARADO | CONFIRMADO | SI | LEEME_Rev12 |  |
| AT-00007 |  | rendimiento | 0.904 |  | p.u. | ESTIMADO | A_RELEVAR | SI | CARGAS_S1 | 6 |
| AT-00008 |  | factor_potencia | 0.83 |  | p.u. | ESTIMADO | A_RELEVAR | SI | CARGAS_S1 | 6 |
| AT-00009 |  | corriente_nominal_a | 15.1869 |  | A | CALCULADO | A_RELEVAR | SI | CARGAS_S1 | 6 |
| AT-00010 |  | arranque |  | DOL |  | DECLARADO | CONFIRMADO | SI | CARGAS_S1 | 6 |
| AT-00011 |  | tipo_carga |  | Motor |  | DECLARADO | CONFIRMADO | SI | CARGAS_S1 | 6 |
| AT-00677 |  | plc_asignado |  | S1 |  | DECLARADO | CONFIRMADO | SI | ELEMENTOS | 33 |
| AT-00678 |  | senales_plc_cantidad | 2 |  | u | CALCULADO | CONFIRMADO | SI | ELEMENTOS | 33 |
| AT-02111 | CMP-0049 | ancho_mm | 45 |  | mm | HOJA_DATOS | A_CONFIRMAR | SI | DATOS_COMPONENTES | 13 |

**Conexión con varios tendidos** — CONDUCTORES filas 7–9 (alimentador F-TAB-A: 1 terna existente + 1 nueva, neutro reducido y PE).

| `conexion_id` | `circuito_tag` | `servicio` | `grupo_origen` | `origen_equipo_id` | `destino_equipo_id` | `proyecto` | `estado_alcance` | `ref_ing_longitud_m` | `ref_ing_longitud_origen` |
|---|---|---|---|---|---|---|---|---|---|
| CX-0001 | F-TAB-A | POTENCIA | P | EQ-0011 | EQ-0009 | SEC | MODIFICADO | 10 | PM 02/11 \| Listado Secado 1 |

| `tendido_id` | `naturaleza` | `funcion` | `cantidad_unidades` | `conductores_por_unidad` | `incluye_pe` | `seccion_mm2` | `designacion` | `estado_alcance` | `cantidad_unidades_existentes` | `ref_ing_metraje_compra_m` |
|---|---|---|---|---|---|---|---|---|---|---|
| CB-001 | CONDUCTOR_UNIPOLAR | FASES | 6 | 1 | NO | 150 | 2×(3×1×150) | MODIFICADO | 3 | 33 |
| CB-002 | CONDUCTOR_UNIPOLAR | NEUTRO | 1 | 1 | NO_APLICA | 35 | 1×35 N | NUEVO |  | 11 |
| CB-003 | CONDUCTOR_UNIPOLAR | PE | 1 | 1 | NO_APLICA | 95 | 1×95 V/A | NUEVO |  | 11 |

**Salida de variador con componente en el extremo** — CONDUCTORES CB-078 (EA-BBA001, V20 dentro de TAB-B).

| `conexion_id` | `servicio` | `grupo_origen` | `origen_equipo_id` | `origen_componente_id` | `origen_texto_original` | `destino_equipo_id` |
|---|---|---|---|---|---|---|
| CX-0072 | POTENCIA | P-VFD | EQ-0094 | CMP-0086 | TAB-B (V20) | EQ-0128 |

El componente `CMP-0086` es: SINAMICS V20 4 kW FSB, 8,8 A (6SL3210-5BE24-0CV0), contenedor `EQ-0094` = TAB-B, asociado a `EQ-0128` = EA-BBA001.

**Neumática: válvula, electroválvula y tubo separados** — NEUMATICA fila 27 (EA-VM001).

| `conexion_id` | `servicio` | `origen_equipo_id` | `origen_componente_id` | `destino_equipo_id` | `ref_ing_longitud_m` | `ref_ing_longitud_origen` |
|---|---|---|---|---|---|---|
| CX-0253 | NEUMATICA | EQ-0147 | CMP-0029 | EQ-0241 | 15 | Supuesto PM-chat 15 m por válvula (NEUMATICA!U2, RL-43) |

| `tendido_id` | `naturaleza` | `funcion` | `cantidad_unidades` | `diametro_exterior_mm` | `diametro_sin_tipificar_mm` | `designacion` |
|---|---|---|---|---|---|---|
| TUB-0023 | TUBO | AIRE_COMPRIMIDO | 1 |  | 6 | Tubing Ø 6 mm |

**Equipo retirado (fuera del conjunto activo)**

| `equipo_id` | `tag` | `categoria` | `descripcion` | `proyecto` | `estado_alcance` | `observaciones` |
|---|---|---|---|---|---|---|
| EQ-0261 | EB-GVA102 | MOTOR | Bomba de vacío 2, 11 kW DOL | EVB | RETIRADO | Retirado: DECISIONES D-05; CAMBIOS_EGT fila 181 |

**Pendiente de conflicto (no se reemplaza en silencio)**

| `pendiente_id` | `severidad` | `tipo` | `tabla` | `registro_id` | `campo` | `valor_origen` | `fuente` |
|---|---|---|---|---|---|---|---|
| PD-0001 | ADVERTENCIA | CONFLICTO_DATO | EQUIPOS | EQ-0094 | proyecto | EVA | ELEMENTOS fila 106; TABLEROS; DECISIONES D-07 (06/11) |

### 11.2 Ejemplos sintéticos (NO están en el libro, solo ilustran reglas)

> **SINTÉTICO.** Los TAG `ZZ-…` no existen en el proyecto.

- **Atributo pendiente vs. no aplica:** `ZZ-TT900` tiene `rango` con `estado_dato = PENDIENTE` y valores vacíos → el inspector muestra "Rango: pendiente". `ZZ-MOT900` no tiene fila `rango` → el inspector no muestra el campo.
- **Renombre en una reimportación:** el proyecto tiene `EQ-0500` con TAG `ZZ-P1` ubicado en la escena. El Excel nuevo trae `EQ-0500` con TAG `ZZ-P1A`. Resultado: "modificado (tag)"; la ubicación se conserva.
- **Huérfano:** el proyecto tiene `CX-0900` con recorrido y el Excel nuevo no lo trae. Resultado: "huérfano"; no se borra; el usuario elige mantener, retirar o borrar.
- **Extremo cambiado:** `CX-0901` pasa de `destino_equipo_id = EQ-0501` a `EQ-0502`. Resultado: el recorrido existente queda marcado "extremo cambiado — revisar".
- **Valor alternativo:** el Excel nuevo agrega `potencia_kw = 5,5 (PLACA, vigente SI)` y pone en `vigente = NO` la fila ESTIMADO anterior → el inspector muestra 5,5 kW (placa) y ofrece ver el historial.

---

## 12. Criterios de aceptación del importador

Flujo obligatorio: **leer → validar → mostrar vista previa → confirmar incorporación**. No se modifica nada del proyecto antes de la confirmación.

**Leer**

- A1. Abre el libro de referencia sin errores de lectura. Localiza las hojas y columnas por nombre exacto.
- A2. Lee los IDs y TAG como texto (por ejemplo, `CB-001` no se transforma en número ni se modifica).
- A3. Lee los números como números. Vacío = sin dato, distinto de 0.

**Validar**

- A4. Con el libro de referencia: **0 errores**, 77 advertencias e 16 avisos INFO provenientes de `PENDIENTES`, más las advertencias propias de V-13/V-20.
- A5. Cada regla de §6 tiene una prueba con un libro alterado (columna faltante, ID duplicado, REF rota, texto en columna numérica, valor fuera de lista, PENDIENTE con valor, dos vigentes, conexión sin tendidos, alias ambiguo, ID retirado reutilizado). Cada prueba produce el mensaje correspondiente con hoja, ID y TAG.

**Vista previa**

- A6. Muestra conteos. Con el libro de referencia deben coincidir con:
  - **260 equipos activos** y **16 retirados**, que quedan fuera del conjunto activo por defecto;
  - **171 componentes** y **2442 atributos**;
  - **272 conexiones** (POTENCIA 104, CONTROL 67, INSTRUMENTACION 50, NEUMATICA 42, COMUNICACION 7, EQUIPOTENCIALIDAD 2);
  - **279 tendidos** (CABLE_MULTIPOLAR 215, TUBO 42, CONDUCTOR_UNIPOLAR 15, CABLE_DATOS 7);
  - **72 alias**.
- A7. Lista las conexiones con un extremo vacío (CX-0010, CX-0209, CX-0210) y todas las filas de `PENDIENTES`, filtrables por severidad.
- A8. En una reimportación, clasifica los cambios según §9.3 y no aplica ninguno antes de la confirmación.

**Confirmar e incorporar**

- A9. Crea los equipos sin ubicación 3D. Todos quedan disponibles para ubicar.
- A10. Al seleccionar cualquier equipo, aunque no tenga ubicación ni recorrido, el inspector muestra:
  - los atributos vigentes con valor y unidad, `origen_valor`, `estado_dato` y fuente;
  - los atributos de sus componentes internos;
  - un acceso a los valores no vigentes.
  Caso de prueba: **S1-SOP101 (EQ-0026)** muestra 7,5 kW (ESTIMADO, A_RELEVAR) como vigente; 15 HP y 9,3 kW como alternativas en CONFLICTO; y su guardamotor y contactor con dimensiones.
- A11. Los atributos se conservan al guardar, exportar e importar el proyecto (ida y vuelta sin pérdidas, incluidos `vigente = NO` y `PENDIENTE`).
- A12. No se crea ninguna longitud fija ni restricción a partir de `ref_ing_*`. La longitud de un tendido se calcula solo con el trazado (y la longitud efectiva de bajada, si el usuario la configura).
- A13. No se agrega ningún PE automático cuando `incluye_pe` es `SI` o `DESCONOCIDO`.
- A14. Las conexiones de equipos retirados no se crean como activas. Los retirados no aparecen en la escena ni en las listas de materiales por defecto.
- A15. Se guarda el registro de importación (versión, revisión, hash, resumen y decisiones).

---

## 13. Decisiones pendientes para Claude Code (contrastar con el repositorio)

1. **Modelo de datos existente.** Mapear EQUIPOS, COMPONENTES, CONEXIONES y TENDIDOS a las entidades que ya tenga el programa, reutilizando las existentes. Documentar qué columna va a qué campo y qué queda como metadato.
2. **Almacenamiento de la ficha técnica.** Decidir si `ATRIBUTOS_TECNICOS` se guarda como colección genérica (clave, valor, unidad, origen, estado, vigente, fuente) asociada al equipo, que es lo recomendado, o si algunos atributos se elevan a campos tipados. En cualquier caso debe cumplir A10 y A11.
3. **Componentes internos.** Definir si se modelan como hijos del equipo sin geometría propia y cómo se muestran en el inspector del tablero o del equipo asociado.
4. **Conexiones con extremo vacío.** Confirmar que el programa admite una conexión "incompleta" (no trazable) o, si no, mantenerla en una lista de pendientes fuera del modelo.
5. **Conductor de equipotencialidad que recorre bandejas** (CB-239/240). No tiene un destino puntual; requiere una representación propia (p. ej. "acompaña a la bandeja") a definir en el modelo de bandejas.
6. **Guirnaldas** (UPS y paradas de emergencia): se importan como conexiones en cadena tramo a tramo. Verificar que el modelo de recorridos admite cadenas sin forzar una topología radial.
7. **Espacio de IDs.** Definir cómo genera IDs el programa para lo creado dentro de él, de modo que no colisionen con los del Excel (p. ej. otro prefijo o un rango reservado) y no se reutilicen IDs retirados.
8. **Unidades y presentación.** Los números se importan en las unidades del catálogo. Definir el formato de presentación (decimales, coma decimal) en el inspector.
9. **Diámetros.** El libro no trae diámetros exteriores (D-51: los define la herramienta nueva). Definir la fuente de diámetros para la ocupación, sin usar `diametro_sin_tipificar_mm` como exterior.
10. **Persistencia de trazabilidad.** Decidir si `TRAZABILIDAD` y `PENDIENTES` se guardan en el proyecto o solo se muestran durante la importación.
11. **Alias.** Integrar la resolución por alias con el mecanismo de renombres del programa, si existe.
12. **Retirados.** Definir cómo se ocultan o filtran en escena, listas y exportaciones.

---

## Anexo — Resumen del traslado (libro Rev0)

| Hoja de origen | Acción | Registros |
|---|---|---|
| ALIMENTACIONES | CONVERTIDO_COMPONENTE | 4 |
| APARAMENTA | CONVERTIDO_COMPONENTE | 49 |
| APARAMENTA | EXCLUIDO_NO_INSTALA | 22 |
| APARAMENTA | EXCLUIDO_TITULO | 70 |
| CARGAS_EA | CONVERTIDO_ATRIBUTO | 31 |
| CARGAS_EA | EXCLUIDO_SIMBOLICO | 1 |
| CARGAS_EA | EXCLUIDO_TITULO | 8 |
| CARGAS_EB | CONVERTIDO_ATRIBUTO | 12 |
| CARGAS_EB | EXCLUIDO_TITULO | 5 |
| CARGAS_S1 | CONVERTIDO_ATRIBUTO | 51 |
| CARGAS_S1 | DESCARTADO_AMBIGUO | 11 |
| CARGAS_S1 | EXCLUIDO_SIMBOLICO | 1 |
| CARGAS_S1 | EXCLUIDO_TITULO | 7 |
| CONDUCTORES | EXCLUIDO_TITULO | 16 |
| CONDUCTORES | TRASLADADO | 237 |
| DECISIONES | EXCLUIDO_RETIRADO | 3 |
| DECISIONES | TRASLADADO | 7 |
| ELEMENTOS | CONVERTIDO_ALIAS | 1 |
| ELEMENTOS | CONVERTIDO_COMPONENTE | 6 |
| ELEMENTOS | EXCLUIDO_SIMBOLICO | 3 |
| ELEMENTOS | TRASLADADO | 218 |
| INSTRUMENTACION | CONVERTIDO_ATRIBUTO | 67 |
| LDM_POR_TABLERO | CONVERTIDO_COMPONENTE | 25 |
| LDM_POR_TABLERO | EXCLUIDO_NO_INSTALA | 6 |
| LDM_POR_TABLERO | FUSIONADO | 39 |
| LEEME | EXCLUIDO_RETIRADO | 22 |
| LEEME_Rev12 | TRASLADADO | 7 |
| NEUMATICA | CONVERTIDO_COMPONENTE | 42 |
| NEUMATICA | EXCLUIDO_TITULO | 30 |
| NEUMATICA | TRASLADADO | 42 |
| TABLEROS | FUSIONADO | 28 |
| TAGS | TRASLADADO | 2 |
