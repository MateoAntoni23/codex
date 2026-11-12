# Compatibilidad — informe para revisión del operador (2026-11-12)

Fuente: `vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json`, `COMPATIBILIDADES`
(2514 filas). **Nada de esto se corrigió en el catálogo**: es para revisar a mano.

## Cambio en la app
La unión directa se decide por la **regla física del sistema** (`src/workspace/compatibilidadFisica.ts`):
- misma familia, mismo ancho y misma ala; el espesor no es criterio;
- excepción declarada: los accesorios de unión (SAM-SMT-ACC) se unen con cualquier familia;
- las 45 filas «no compatible» son un bloqueo explícito;
- la tabla enumerada es **confirmación**, no puerta.

Lo que no cumple la regla **no se ofrece**: ya no aparece «compat. no documentada» con excepción. Las
reducciones siguen siendo piezas, por su propio camino (`findReductionCandidates`).

## Pares que «difieren en ala»: no hay ninguno con dos alas distintas
De las filas con los dos productos presentes, **477** difieren en `ala_nominal_mm`. En **todas**, una de
las dos piezas **no declara ala** (`null`). No hay ningún par con dos alas declaradas distintas, así que
ninguno contradice la regla de ala ni la cuarta condición de B-3 en sentido estricto. Ninguna es de tipo
«directa»: son tapas (336), accesorios interiores (134) y «con kit» (7).

| Filas | Familia | Tipo de conexión | Pieza A | Pieza B | Alas (A ↔ B) | Ejemplo |
|---:|---|---|---|---|---|---|
| 84 | SAM-STE-G | tapa | tapa | curva horizontal | null ↔ 65/90/115/150 | CMP-01129 TCS-150-90-18-G ↔ CS-150-90-065-18-G |
| 56 | SAM-STE-G | accesorio interior | piso | recta | null ↔ 65/90/115/150 | CMP-01299 PPTRES-150-18-G ↔ TRES-150-065-18-G |
| 47 | SAM-SMT-ACC (excepción) | accesorio interior | abrazadera/grampa | recta | null ↔ 50…150 | CMP-02311 GFCE-B ↔ TRPS-050-22-Z |
| 36 | SAM-STE-Z | tapa | tapa | curva horizontal | null ↔ 65/90/115 | CMP-01844 TCS-150-90-22-Z ↔ CS-150-90-065-18-Z |
| 28 | SAM-STE-G | tapa | tapa | recta | null ↔ 65/90/115/150 | CMP-01101 TTRS-150-18-G ↔ TRES-150-065-18-G |
| 28 | SAM-STE-G | tapa | tapa | T | null ↔ 65/90/115/150 | CMP-01185 TTS-150-18-G ↔ TS-150-065-18-G |
| 28 | SAM-STE-G | tapa | tapa | X | null ↔ 65/90/115/150 | CMP-01213 TXS-150-18-G ↔ XS-150-065-18-G |
| 28 | SAM-STE-G | tapa | tapa | curva vertical articulada | null ↔ 65/90/115/150 | CMP-01271 TEPS-150-18-G ↔ CUS-150-5-065-18-G |
| 24 | SAM-STE-Z | accesorio interior | piso | recta | null ↔ 65/90/115 | CMP-01916 PPTRES-150-18-Z ↔ TRES-150-065-18-Z |
| 19 | SAM-STP-Z | tapa | tapa | recta | null ↔ 50/65/90/115 | CMP-01940 TTRS-150-22-Z ↔ TRES-150-065-18-Z (**ver abajo**) |
| 14 | SAM-STP-Z | tapa | tapa | curva horizontal | null ↔ 50 | CMP-02150 TCPS-050-90-Z ↔ CPS-050-90-Z |
| 12 | SAM-STE-Z | tapa | tapa | T | null ↔ 65/90/115 | CMP-01868 TTS-150-22-Z ↔ TS-150-065-18-Z |
| 12 | SAM-STE-Z | tapa | tapa | X | null ↔ 65/90/115 | CMP-01880 TXS-150-22-Z ↔ XS-150-065-18-Z |
| 12 | SAM-STE-Z | tapa | tapa | curva vertical articulada | null ↔ 65/90/115 | CMP-01904 TEPS-150-22-Z ↔ CUS-150-5-065-18-Z |
| 7 | SAM-STP-Z | con kit | T | recta | null ↔ 50 | CMP-02129 DUPS-Z ↔ TRPS-050-22-Z |
| 7 | SAM-SMT-ACC (excepción) | accesorio interior | separador | recta | null ↔ 50 | CMP-02130 BDS01Z ↔ TRPS-050-22-Z |
| 7 | SAM-STP-Z | tapa | tapa | T | null ↔ 50 | CMP-02164 TTPS-050-Z ↔ TPS-050-Z |
| 7 | SAM-STP-Z | tapa | tapa | X | null ↔ 50 | CMP-02171 TXPS-050-Z ↔ XPS-050-Z |
| 7 | SAM-STP-Z | tapa | tapa | curva vertical exterior | null ↔ 50 | CMP-02178 TCUPS-050-D-Z ↔ CUPS-050-D-Z |
| 7 | SAM-STP-Z | tapa | tapa | curva vertical interior | null ↔ 50 | CMP-02185 TCUPS-050-A-Z ↔ CUPS-050-A-Z |
| 7 | SAM-STP-Z | tapa | tapa | curva vertical articulada | null ↔ 50 | CMP-02192 TEPS-050-Z ↔ EPS-050-Z |
| **477** | | | | | | |

**Para revisar con atención:** **12 filas** «tapa» empareja una tapa de la familia **perforada**
(SAM-STP-Z, TTRS-…-22-Z) con **rectos de escalera** (SAM-STE-Z, TRES-…-065/090/115). Es la única parte de
la tabla que cruza familias fuera de los accesorios de unión y del bloqueo explícito. Ejemplos: CMP-01940,
CMP-01941, CMP-01942.

## Otras filas que cruzan familias
- 152 son SAM-SMT-ACC (accesorios de unión): correctas por definición.
- Las 45 «no compatible»: zincado Z contra zincado N/B (SAM-STP-Z ↔ SAM-STP-ZN, 14 rectas) y galvanizado
  G contra zincado Z (SAM-STE-G ↔ SAM-STE-Z, 24 rectas), entre otras. La regla ya las excluye por familia;
  quedan como bloqueo explícito.

## Filas con producto nulo (3) — no se borraron
| Id | Producto A | Producto B | Tipo | Estado | Observación del catálogo |
|---|---|---|---|---|---|
| CMP-01241 | SAM_TXS-750-18-G | null | tapa | pendiente | No hay pieza de destino publicada para ancho 750 en la línea G. |
| CMP-01242 | SAM_TXS-900-18-G | null | tapa | pendiente | No hay pieza de destino publicada para ancho 900 en la línea G. |
| CMP-01387 | SAM_CU-TRES-TRL-G | null | con kit | pendiente | Transición documentada a nivel de línea (escalera Smarttray ↔ tradicional) sin indicar a qué TRES. |

La app las ignora: no tienen par.

## Filas «directa» que la regla deja de usar
De las 1699 filas «directa», las únicas que no cumplen la regla son **180 entre rectos y reducciones**
(anchos distintos). Siguen disponibles por el flujo de reducción. 442 difieren solo en espesor y se siguen
ofreciendo.
