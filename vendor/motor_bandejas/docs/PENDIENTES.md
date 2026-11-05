# Pendientes – motor_bandejas v0.2.2

## Decisiones que necesito del usuario

| # | Decisión | Qué desbloquea |
|---|---|---|
| **P-D19b** | Interpretación de "sobre una de las alas haciendo contacto": aplicado como PE apoyado en el fondo contra la cara interior del ala (ocupa D_PE del ancho). Si va montado sobre el borde del ala, fuera del fondo, no ocupa ancho útil | Ocupación exacta de las secciones con PE |
| **P-D19c** | Hueco entre el PE y el último cable de potencia (hoy 0) | Quitar la condición `D-19_PE_CONTRA_ALA_HUECO_PE_POTENCIA_NO_DEFINIDO` |
| **P-D21** | Modelo concreto del PE verde/amarillo 16 mm² (Superastic Flex 16 V/A: su ficha no declara uso en bandeja) | Que el PE deje de ser `MODELO_A_CONFIRMAR` |
| P-REV043 | Certificado IRAM original del valor 290 kg/m (F-004 es copia de tercero) | Pasar la fila C de "validada por usuario" a documentada |
| P-ARQ | Arquitectura de integración (incluye si el servicio local necesita token) | Lo define el auditor/desarrollador de la arquitectura |
| P-D31 | Aprobar o corregir la regla de contraste de contexto con el ensayo (D-31, propuesta en v0.2.2) | Que deje de ser propuesta |
| P-ESQ | Luces de los vanos laterales en el ensayo de 2,25 y 2,5 m: la imagen rotula vanos laterales de igual luz, pero tres vanos de 2,25 o 2,5 m no caben en 6 m | Contraste de vanos de esas luces |
| P-D13 | Confirmar la equivalencia de los extremos P1/P2 de los tramos rectos (D-13) | Quitar la condición en conexiones por P2 |
| P-D23/D-26 | Reglas de colocación de soportes y requisito de vínculo equipotencial por pieza/tapa (o la fuente donde buscarlas) | Pasar de diagnóstico a verificación |

## Datos faltantes (exactos)

| # | Dato | Fuente sugerida | Desbloquea |
|---|---|---|---|
| F1–F9 | Los de v0.1.1: CTA de perforadas, G115, Z115 con luz, 2,10 mm, FAMIQ, anchos y altos útiles, texto AEA de reserva, G65 300/310, cables de otras marcas | Ver `MATRIZ_FUENTES.md` §4 | Ídem |
| F10 | Radio mínimo de curvatura de cada cable, **con su condición** (tendido o instalado) y **referencia** (eje o intradós) | Fichas Prysmian u otra documentación técnica del fabricante | Toda verificación de curvatura (hoy `NO_VERIFICABLE_RADIO_CABLE_NO_PUBLICADO`) |
| F11 | Referencia del radio de curvas verticales (294 mm "no especificado"; tabla de eslabones solo en la sección Z) | F-001 PDF 5 / impr. 8 | Curvatura en curvas verticales |
| F12 | Dimensiones físicas de piezas especiales (posición de bocas, largo de eje) | Planos SAMET | Encaje real; hoy solo la coherencia del modelo del CAD |
| F13 | Masa de tapas, pisos, separadores y soportes | SAMET | Vanos con tapa (hoy `NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA`) |
| F14 | Luz máxima, voladizos y posición de uniones respecto de soportes; apoyos en curvas, T, X y reducciones | Manual de montaje SAMET o norma aplicable | Colocación de soportes |
| F15 | Modo de aplicación de la capacidad de soportes (STS 379 kg) y modelo de reparto | SAMET / IRAM original | Capacidad del soporte |
| F16 | Fijaciones y anclajes al sustrato (fuera de alcance por REV-016) | Fabricante del anclaje | Anclajes |
| F17 | Continuidad eléctrica declarada de las uniones SAMET (clasificación IEC 61537) | SAMET | Usar uniones como vínculo |
| F18 | Rango de sección y material del conductor que admite GFCE-B; conectores de derivación PE-PE y terminales de puente | SAMET / fabricante de conectores | Conexiones equipotenciales `DOCUMENTADAS` |
| F19 | Cantidad de JB-TRUTS-M6 por tapa | SAMET | Fijación de tapas en el cómputo |
| F20 | Tramos rectos en las hojas COMPATIBILIDADES con P2 explícito (o confirmación D-13) | Catálogo | Quitar la condición D-13 |
| F21 | Texto reglamentario sobre el PE en bandejas (tipo de conductor admitido, sección, vínculo de bandejas y tapas) | AEA 90364 (Partes 5-54 y 7-771 vigentes) | D-21, D-26 |

## Verificaciones no realizadas (no se presentan como cumplidas)

- **Eléctrica:** intensidad admisible, agrupamiento, caída de tensión, cortocircuito, adecuación de los 16 mm² frente a la falla, impedancia del lazo.
- **Continuidad o resistencia medida** de la red equipotencial; inspección en obra.
- **Encaje físico real** de piezas especiales: solo se verifica la coherencia del modelo del CAD.
- **Capacidad de soportes, anclajes y sustrato.**
- **Carga en vanos** con luces no tabuladas, vanos que atraviesan piezas especiales y vanos con tapa.
- **Radios de curvatura** de todos los cables (faltan datos de ficha).
- **Esquema del ensayo de carga:** se contrasta topológicamente (D-12); no se contrastan posición exacta de apoyos externos, voladizos, tipo de apoyo ni flecha (lista `no_contrastado`).

## Integración

- Inspeccionar el editor (repositorio no accesible) y mapear sus ids, puertos y coordenadas al contrato `trazado/1`.
- Elección servicio local / port TS / Pyodide: a cargo del auditor de arquitectura.
- `npm install` del cliente TS: el registro de npm no fue accesible en esta sesión; los tipos se verificaron con un `@types/node` preinstalado.
