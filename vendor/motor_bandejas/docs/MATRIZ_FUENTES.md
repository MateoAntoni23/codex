# Matriz de fuentes – motor_bandejas v0.2.2

Fecha de relevamiento: 2026-11-05. Categorías según el pedido: **[FAB]** dato documentado de fabricante · **[NORM]** regla normativa · **[PROD]** decisión de producto · **[SAMET]** comportamiento observado · **[HIP]** hipótesis pendiente.

## 1. Recursos inventariados

| ID | Recurso | Edición / versión | SHA-256 | Categoría | Qué aporta al motor |
|---|---|---|---|---|---|
| S-01 | `attachment.txt` (pedido) | 2026-11-05 | 0565de88… | [PROD] | Decisión D-01 (g = D) y criterios de trabajo |
| S-02 | `PRY2020_Sintenax_Valio.pdf` (Prysmian) | "Edición 2020" impresa en cada página | 92a1f2a8… | [FAB] | D exterior aprox. [mm] y masa aprox. [kg/km], págs. 3–5 (Cu) y 8–9 (Al) |
| S-02b | `PRY2026_Sintenax Valio_v2.pdf` (web Prysmian) | "Edición 2026" | no descargado | [FAB] | Control: Cu 1×4/6/10/16 con iguales D y masa que 2020 (lectura por extracción web automática) |
| S-03 | `Catalogo_Bandejas_y_Accesorios_1.xlsx` (proyecto) | Etapa 2, 2026-11-05 | c627ff45… | [FAB]+[PROD] | Tramos rectos (ancho/ala nominales, espesor), CTA por luz (TABLAS_CARGA), fuentes F-001…F-010, decisiones REV-xxx |
| S-04 | `samet.html` (calculador Smarttray guardado) | sin versión | 5b4cd211… | [SAMET] | Lógica de la UI, 696 modelos de cable **sin D ni masa**, endpoints `calculate_power` / `calculate_data` |
| S-05 | `PRUEBA.pdf` | captura | 1c351a97… | [SAMET] | Caso 1: 4 × Cu 1×6, separado |
| S-06 | `PRUEBA_8_CONDUCTORES.pdf` | captura | 35abab5c… | [SAMET] | Caso 2: 8 × Cu 1×6, separado |
| S-07 | `PRUEB_3.pdf` | captura | a0c53f48… | [SAMET] | Caso 3: 8 × Cu 1×6, sin separar |

Fuentes del catálogo (S-03, hoja FUENTES) que llegan al motor a través de TABLAS_CARGA: **F-001** (catálogo escalera SAMET, sin edición impresa, metadatos 2021/2022), **F-004** (certificado IRAM DC-E-S147-002.3, IEC 61537:2006, 2022-05-24; *copia de tercero leída por extracción web, verificar contra original*).

## 2. Datos usados, unidades y conversiones

| Magnitud | Origen | Unidad origen | Unidad motor | Conversión |
|---|---|---|---|---|
| Diámetro exterior del cable D | S-02 tabla "Diámetro exterior aproximado" | mm | mm | ninguna |
| Masa del cable | S-02 tabla "Masa aproximada" | kg/km | kg/m | ÷ 1000, una sola vez al cargar (`unidades.kg_km_a_kg_m`) |
| Ancho y ala de bandeja | S-03 PRODUCTOS `ancho_nominal_mm`, `ala_nominal_mm` | mm | mm | ninguna; **no** se decodifica el SKU |
| CTA (carga de trabajo admisible) | S-03 TABLAS_CARGA `carga_valor` + `carga_unidad` | kg/m | kg/m | ninguna; solo registros con unidad `kg/m` |
| Luz entre apoyos | S-03 TABLAS_CARGA `luz_entre_apoyos_mm` | mm | mm | ninguna; comparación exacta con `vano_mm` |
| Reserva solicitada | entrada | % | fracción | ÷ 100 |

La CTA se publica en "kg/m" (kgf/m en la práctica) y se compara contra masa lineal en kg/m: misma convención del fabricante, sin pasar a N/m.

## 3. Reglas acreditadas vs. decisiones

| Regla | Estado | Respaldo |
|---|---|---|
| Masa lineal q = Σ nᵢ·mᵢ | [FAB] dato + aritmética | S-02 p.3–5, 8–9 |
| Separación libre "un diámetro" entre unipolares | [FAB] descriptivo | S-02 p.4 nota: *reactancia calculada para tres unipolares en plano con separación libre de un diámetro*; S-02 p.6 Método G: *separados un diámetro como mínimo*. Ambos para cables iguales y con fin eléctrico, no de ocupación |
| g = D, W = (2n−1)·D | [PROD] D-01 acordada | S-01 |
| Contacto: W = Σ D | [PROD] D-02 | — |
| Verificación mecánica contra CTA a la misma luz | [FAB] dato + [PROD] D-06 | S-03 TABLAS_CARGA (F-001 PDF 7/10; F-004). Ensayo declarado: IEC 61537:2006 apartado 10.3 (no disponible en el entorno). Esquema de ensayo no contrastado (D-12) |
| CTA escalera Z ala 65 = 290 kg/m a 1500 mm | [PROD] REV-020 sobre dos [FAB] | **Combinación**: valor de F-004 (sin luz) + luz de F-001 (que publica 300). Valor adoptado (DER-001), no documentado como conjunto |
| Reserva del 20 % en ancho | [NORM] **no verificada** | Samet la rotula "RAEA 90364". Fuente secundaria web (servidos.ar) atribuye a AEA 90364-7-771, punto 771.12.3.9: ancho = Σ diámetros (+ espacio libre) × 1,20, una capa; y remite a 90364-5-52 cláusula 521.10 para instalaciones industriales. **Texto AEA no disponible: D-05 queda como decisión de producto.** |
| Métodos F/G y corrientes admisibles | [FAB] eléctrico — fuera de alcance | S-02 p.6 (tabla Cu desde 25 mm²). No se usa ni se extrapola a 6 mm² |

## 4. Datos faltantes (impiden verificar, no se sustituyen)

| # | Dato exacto | Efecto actual en el motor |
|---|---|---|
| F1 | CTA a 1500 mm de la perforada SAMET Z/ZN/ZB (F-002) | Perforadas: `NO_VERIFICABLE_SIN_REGISTRO` |
| F2 | CTA a 1500 mm de escalera G ala 115 (1,24 mm) | `NO_VERIFICABLE_SIN_REGISTRO` (Samet usa 580, origen desconocido) |
| F3 | Luz y esquema del 530 kg/m de escalera Z ala 115 (F-004) | `NO_VERIFICABLE_LUZ_NO_DECLARADA` |
| F4 | CTA de escaleras 2,10 mm (calibre 14) | `NO_VERIFICABLE_SIN_REGISTRO` |
| F5 | CTA FAMIQ alambre (REV-028) | `NO_VERIFICABLE_SIN_REGISTRO` |
| F6 | Ancho útil y alto útil (REV-024 quedó "ignorar") | Se usa ancho nominal y ala nominal con advertencia (D-04, D-08) |
| F7 | Texto AEA 90364-7-771 §771.12.3.9 y 90364-5-52 §521.10 | Denominador de reserva elegido como decisión de producto (D-05) |
| F8 | Confirmar G ala 65 = 310 kg/m en F-001 PDF 10 / impr. 19 | Motor usa 310 (catálogo); Samet aparenta 300 |
| F9 | D y masa de cables de otras marcas (IMSA, Marlew, Argenplas) | Solo está cargada Prysmian Sintenax Valio |

## 5. Anomalías detectadas en la ficha Prysmian (se conservan y se advierten)

- Cu unipolar 240 mm²: D 32,0 mm > 300 mm² (29,8 mm); diámetro de conductor 24,0 > 20,7.
- Cu tripolar 50 y 70 mm²: ambos D = 30 mm. Cu tetrapolar 50/25 y 70/35: ambos 31 mm.
- Al tripolar 70 mm²: masa 1110 kg/km < 50 mm² (1230).
- Al tetrapolar 70/35: D 31 mm y 1260 kg/km < 50/25 (32 mm; 1360).

No se corrigen: el motor emite una advertencia en el resultado cuando se usa uno de esos cables.

---

## 6. Fuentes y reglas agregadas en v0.2.0

| ID | Recurso | Edición | Categoría | Uso |
|---|---|---|---|---|
| S-08 | Superastic Jet/Flex (Prysmian AR) – PRY2026_Superastic Jet_v2.pdf | Edición 2026 (coincide con 2020) | [FAB] | Candidato PE: D 7,0 mm, 167 kg/km, verde/amarillo, condiciones de empleo. Lectura por extracción web; sin copia local |
| S-03b | Catálogo Excel: PRODUCTOS completo, PUERTOS_PRODUCTO, COMPATIBILIDADES, COMPONENTES_UNION, SISTEMAS/COMPONENTES/APLICACIONES_SOPORTE | Etapa 2 (sha c627ff45…) | [FAB]+[PROD] | Piezas especiales, puertos, compatibilidad, tornillería por unión, soportes. Snapshot formato 3 |
| S-09 | Voltimum / Pemsa / AISCAN (fuentes secundarias web) | — | secundaria | Contexto: IEC 61537 clasifica sistemas "con continuidad eléctrica" (≤ 5 mΩ/m; unión ≤ 50 mΩ). **No** es declaración de SAMET y el motor no la usa |

| Regla v0.2.0 | Categoría | Respaldo |
|---|---|---|
| Compatibilidad entre puertos | [FAB] / [PROD] según el registro | COMPATIBILIDADES (`estado_evidencia` por fila); D-13, D-13b |
| Tornillería por unión: 4 juegos 3/8" (escalera), 2 M6 (perforada) | [FAB] | F-001 PDF 3 / impr. 4; F-002 PDF 3 / impr. 4 (declaración de sistema) |
| Radio de curvas horizontales, T y X: 300 mm "interior" | [FAB] | F-001 PDF 9 / impr. 16–17 ("impreso bajo la tabla") |
| Radio de curvas verticales articuladas: 294 mm, referencia no especificada | [FAB] incompleto | F-001 sección Z; no usable para verificar (D-16) |
| Grampa equipotencial GFCE-B: alojamiento en escalera y perforada; incluye bulonería | [FAB] | F-002 PDF 7 / impr. 12; F-001/F-002 PDF 3 / impr. 4–5 |
| Rango de sección/material del conductor que admite GFCE-B | **faltante** | — |
| Continuidad eléctrica de las uniones SAMET | **faltante** | — |
| Aplicación de sistemas de soporte por familia y rango de ancho | [FAB] / validada por usuario | APLICACIONES_SOPORTE |
| Luz máxima, voladizos, posición de uniones, apoyos en piezas especiales | **faltante** | REV-023 (diseño a cargo del usuario) |
| Capacidad de soportes (STS 379 kg, GSS 186 kg) | [FAB] sin condiciones | F-004 (copia de tercero) |
| Masa de piezas, tapas y accesorios | **faltante** | `peso_kg_por_unidad_compra` vacío en todo el catálogo |
| Radio mínimo de curvatura de los cables | **faltante** | Las fichas Sintenax Valio 2020 y Superastic 2020/2026 no lo publican |
| PE 16 mm² en todo el recorrido | [PROD] aprobada (D-20) | Requisito del usuario; no normativo |
| Admisibilidad del PE aislado sin envoltura en bandeja | [NORM] **no verificada** | AEA 90364 no disponible |

## 7. Fuentes y reglas agregadas en v0.2.1

| ID | Recurso | Categoría | Uso |
|---|---|---|---|
| S-10 | Imagen del esquema de ensayo SAMET aportada por el usuario (`docs/fuentes/esquema_ensayo_samet.png`, sha256 0ef556b7…) | [FAB] vía usuario, "validada por usuario" | ESQ-SAMET-TABLA-ENSAYO (D-12). Se transcribe solo la topología; no se leen cotas de la imagen |
| S-03c | Catálogo Excel `_2` con REV-043 (sha 7be8b0f9…) | [FAB]+[PROD] | Filas A/B/C de Z65 separadas; C validada por usuario |

| Regla v0.2.1 | Categoría | Respaldo |
|---|---|---|
| Contraste vano ↔ esquema de ensayo | [PROD] sobre dato [FAB] | D-12 (usuario) + imagen S-10; tolerancia D-30 sin fuente |
| PE contra el ala, hueco 0 | [PROD] aprobada / hueco no definido | D-19 (usuario) |
| PE verde/amarillo | [PROD] aprobada | D-21 (usuario). Identificación normativa no verificada (AEA no disponible) |
