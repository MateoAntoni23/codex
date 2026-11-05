# Comparación con casos observados en Samet

Generado por `herramientas/comparar_samet.py`. Samet es referencia de comportamiento, no autoridad.
Columnas *inferidas*: cálculo inverso desde lo que Samet muestra (hipótesis, ver `SAMET_ANALISIS.md`).

## SAMET-C1 – 4 cables, separado=sí (PRUEBA.pdf)

| Magnitud | Samet | Motor | Nota |
|---|---|---|---|
| Carga de cables [kg/m] | 0,44 | 0,456 | Samet ≈ -3,51 % ; inferido Samet por cable = 0,1100 kg/m vs ficha 0,114 (H-S2) |
| Ancho ocupado [mm] | 64,8 (inferido, H-S3) | 56,7 | Motor: W = n·D + (n−1)·g ; g = D ⇒ W = (2n−1)·D (separado, una fila) |

| SKU Samet | Factor Samet | CTA inferida Samet [kg/m] (H-S1) | CTA catálogo [kg/m] | Estado mecánico motor | Reserva Samet | Sobrante/ocupado motor | Reserva libre motor (D-05) | Estado motor (D-05) | Estado con criterio 'sobre_ancho_ocupado' |
|---|---|---|---|---|---|---|---|---|---|
| TRPS-100-22-Z | 113,6 | 50,0 | — | NO_VERIFICABLE_SIN_REGISTRO | 54 % | 76,4 % | 43,3 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-065-18-Z | 659,1 | 290,0 | 290,0 | CUMPLE_CONDICIONADO | 131 % | 164,6 % | 62,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-065-18-G | 681,8 | 300,0 | 310,0 | VERIFICADA_CUMPLE | 131 % | 164,6 % | 62,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-090-18-Z | 909,1 | 400,0 | 400,0 | VERIFICADA_CUMPLE | 131 % | 164,6 % | 62,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-090-18-G | 1000 | 440,0 | 440,0 | VERIFICADA_CUMPLE | 131 % | 164,6 % | 62,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-115-18-Z | 1204,5 | 530,0 | — | NO_VERIFICABLE_LUZ_NO_DECLARADA | 131 % | 164,6 % | 62,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-115-18-G | 1318,2 | 580,0 | — | NO_VERIFICABLE_SIN_REGISTRO | 131 % | 164,6 % | 62,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRA-100 | 0 | 0,0 | — | no está en el catálogo del proyecto | 54 % | — | — | — | — |

Mínimo geométrico por línea según el motor (criterio D-05 / criterio alternativo):

- SAM-STE-G ala 115: SAM_TRES-150-115-18-G (NO_VERIFICABLE_SIN_REGISTRO) / alternativo: SAM_TRES-150-115-18-G
- SAM-STE-G ala 65: SAM_TRES-150-065-18-G (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-065-18-G
- SAM-STE-G ala 90: SAM_TRES-150-090-18-G (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-090-18-G
- SAM-STE-Z ala 115: SAM_TRES-150-115-18-Z (NO_VERIFICABLE_LUZ_NO_DECLARADA) / alternativo: SAM_TRES-150-115-18-Z
- SAM-STE-Z ala 65: SAM_TRES-150-065-18-Z (CUMPLE_CONDICIONADO) / alternativo: SAM_TRES-150-065-18-Z
- SAM-STE-Z ala 90: SAM_TRES-150-090-18-Z (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-090-18-Z
- SAM-STP-Z ala 50: SAM_TRPS-100-22-Z (NO_VERIFICABLE_SIN_REGISTRO) / alternativo: SAM_TRPS-100-22-Z

## SAMET-C2 – 8 cables, separado=sí (PRUEBA_8_CONDUCTORES.pdf)

| Magnitud | Samet | Motor | Nota |
|---|---|---|---|
| Carga de cables [kg/m] | 0,88 | 0,912 | Samet ≈ -3,51 % ; inferido Samet por cable = 0,1100 kg/m vs ficha 0,114 (H-S2) |
| Ancho ocupado [mm] | 129,6 (inferido, H-S3) | 121,5 | Motor: W = n·D + (n−1)·g ; g = D ⇒ W = (2n−1)·D (separado, una fila) |

| SKU Samet | Factor Samet | CTA inferida Samet [kg/m] (H-S1) | CTA catálogo [kg/m] | Estado mecánico motor | Reserva Samet | Sobrante/ocupado motor | Reserva libre motor (D-05) | Estado motor (D-05) | Estado con criterio 'sobre_ancho_ocupado' |
|---|---|---|---|---|---|---|---|---|---|
| TRPS-200-22-Z | 68,2 | 60,0 | — | NO_VERIFICABLE_SIN_REGISTRO | 54 % | 64,6 % | 39,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-300-065-18-Z | 329,5 | 290,0 | 290,0 | CUMPLE_CONDICIONADO | 131 % | 146,9 % | 59,5 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-300-065-18-G | 340,9 | 300,0 | 310,0 | VERIFICADA_CUMPLE | 131 % | 146,9 % | 59,5 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-300-090-18-Z | 454,5 | 400,0 | 400,0 | VERIFICADA_CUMPLE | 131 % | 146,9 % | 59,5 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-300-090-18-G | 500 | 440,0 | 440,0 | VERIFICADA_CUMPLE | 131 % | 146,9 % | 59,5 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-300-115-18-Z | 602,3 | 530,0 | — | NO_VERIFICABLE_LUZ_NO_DECLARADA | 131 % | 146,9 % | 59,5 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-300-115-18-G | 659,1 | 580,0 | — | NO_VERIFICABLE_SIN_REGISTRO | 131 % | 146,9 % | 59,5 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRA-200 | 0 | 0,0 | — | no está en el catálogo del proyecto | 54 % | — | — | — | — |

Mínimo geométrico por línea según el motor (criterio D-05 / criterio alternativo):

- SAM-STE-G ala 115: SAM_TRES-300-115-18-G (NO_VERIFICABLE_SIN_REGISTRO) / alternativo: SAM_TRES-150-115-18-G
- SAM-STE-G ala 65: SAM_TRES-300-065-18-G (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-065-18-G
- SAM-STE-G ala 90: SAM_TRES-300-090-18-G (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-090-18-G
- SAM-STE-Z ala 115: SAM_TRES-300-115-18-Z (NO_VERIFICABLE_LUZ_NO_DECLARADA) / alternativo: SAM_TRES-150-115-18-Z
- SAM-STE-Z ala 65: SAM_TRES-300-065-18-Z (CUMPLE_CONDICIONADO) / alternativo: SAM_TRES-150-065-18-Z
- SAM-STE-Z ala 90: SAM_TRES-300-090-18-Z (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-090-18-Z
- SAM-STP-Z ala 50: SAM_TRPS-200-22-Z (NO_VERIFICABLE_SIN_REGISTRO) / alternativo: SAM_TRPS-150-22-Z

## SAMET-C3 – 8 cables, separado=no (PRUEB_3.pdf)

| Magnitud | Samet | Motor | Nota |
|---|---|---|---|
| Carga de cables [kg/m] | 0,88 | 0,912 | Samet ≈ -3,51 % ; inferido Samet por cable = 0,1100 kg/m vs ficha 0,114 (H-S2) |
| Ancho ocupado [mm] | 64,8 (inferido, H-S3) | 64,8 | Motor: W = Σ nᵢ·Dᵢ (contacto, una capa, huecos nulos) |

| SKU Samet | Factor Samet | CTA inferida Samet [kg/m] (H-S1) | CTA catálogo [kg/m] | Estado mecánico motor | Reserva Samet | Sobrante/ocupado motor | Reserva libre motor (D-05) | Estado motor (D-05) | Estado con criterio 'sobre_ancho_ocupado' |
|---|---|---|---|---|---|---|---|---|---|
| TRPS-100-22-Z | 56,8 | 50,0 | — | NO_VERIFICABLE_SIN_REGISTRO | 54 % | 54,3 % | 35,2 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-065-18-Z | 329,5 | 290,0 | 290,0 | CUMPLE_CONDICIONADO | 131 % | 131,5 % | 56,8 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-065-18-G | 340,9 | 300,0 | 310,0 | VERIFICADA_CUMPLE | 131 % | 131,5 % | 56,8 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-090-18-Z | 454,5 | 400,0 | 400,0 | VERIFICADA_CUMPLE | 131 % | 131,5 % | 56,8 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-090-18-G | 500 | 440,0 | 440,0 | VERIFICADA_CUMPLE | 131 % | 131,5 % | 56,8 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-115-18-Z | 602,3 | 530,0 | — | NO_VERIFICABLE_LUZ_NO_DECLARADA | 131 % | 131,5 % | 56,8 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRES-150-115-18-G | 659,1 | 580,0 | — | NO_VERIFICABLE_SIN_REGISTRO | 131 % | 131,5 % | 56,8 % | PRESELECCION_CONDICIONADA | PRESELECCION_CONDICIONADA |
| TRA-100 | 0 | 0,0 | — | no está en el catálogo del proyecto | 54 % | — | — | — | — |

Mínimo geométrico por línea según el motor (criterio D-05 / criterio alternativo):

- SAM-STE-G ala 115: SAM_TRES-150-115-18-G (NO_VERIFICABLE_SIN_REGISTRO) / alternativo: SAM_TRES-150-115-18-G
- SAM-STE-G ala 65: SAM_TRES-150-065-18-G (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-065-18-G
- SAM-STE-G ala 90: SAM_TRES-150-090-18-G (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-090-18-G
- SAM-STE-Z ala 115: SAM_TRES-150-115-18-Z (NO_VERIFICABLE_LUZ_NO_DECLARADA) / alternativo: SAM_TRES-150-115-18-Z
- SAM-STE-Z ala 65: SAM_TRES-150-065-18-Z (CUMPLE_CONDICIONADO) / alternativo: SAM_TRES-150-065-18-Z
- SAM-STE-Z ala 90: SAM_TRES-150-090-18-Z (VERIFICADA_CUMPLE) / alternativo: SAM_TRES-150-090-18-Z
- SAM-STP-Z ala 50: SAM_TRPS-100-22-Z (NO_VERIFICABLE_SIN_REGISTRO) / alternativo: SAM_TRPS-100-22-Z

