# Análisis del calculador Smarttray (Samet)

Samet es referencia de comportamiento, **no** autoridad. No se tiene el código del servidor (`calculate_power` / `calculate_data`).

**Alcance de la evidencia.** Hay 24 tarjetas de resultado, pero salen de **solo tres conjuntos de entradas** (mismo cable, mismo vano, misma reserva; cambian cantidad y "separado"). No son 24 ensayos independientes. Los modelos que siguen *reproducen* esas salidas, pero **no identifican un algoritmo único**: otros modelos podrían dar los mismos números con estas entradas. Las pruebas de `pruebas/test_hipotesis_samet.py` verifican la consistencia de un modelo explicativo; no prueban cómo está implementado el servidor ni establecen una regla normativa.

## Hechos verificados en el HTML (código del cliente)

| Tema | Evidencia (línea de `samet.html`) |
|---|---|
| Los tres casos se enviaron en modo **potencia** | Botón activo = clase `btn-theme-color`; inactivo = `btn-theme-border-color`, con borde (l. 258–259, 947–957). En modo 2, "separado" se deshabilita y se destilda (l. 885–891), y en las capturas aparece tildado |
| Request | POST con `securityPercentage`, `hollow` (vano) y por cable `cable`, `quantity`, `piledUp`, `spaced` (l. 965–975). Respuesta: `requiredWeight`, `trayHits` |
| Catálogo de cables del cliente | 696 `cableModels.push` con `id`, `mode`, `brand`, `unipolar` y `description`. **No** incluyen diámetro ni masa |
| Vano | Única opción activa: 1,5 m (2 / 2,5 / 3 m comentadas, l. 268–270) |
| Apilado | `MAX_ALLOWED_PILED_UP = 4` (l. 1897); solo unipolares |

## Defectos de estado en la UI (código del cliente; no reproducir)

1. `selectedTray` se asigna al hacer clic (l. 1009) y no se resetea ni al recalcular, ni con LIMPIAR, ni al cambiar de modo. `isComplete()` (l. 1083) puede guardar una bandeja elegida para otra carga.
2. `setMode` no vacía `items`: pueden quedar cables de potencia en un cálculo de mando.
3. `quantity` se valida como texto: `"0"` pasa `!quantity` y los decimales no se rechazan.
4. La validación del modelo compara con `'MoDELO'` (l. 833), mientras que la opción por defecto es `MODELO`.
5. Los cambios de reserva, vano o lista no marcan el resultado mostrado como desactualizado.

## Modelos explicativos (hipótesis, no hechos)

Supuestos comunes: anchos = nominales de los SKU mostrados (no se conocen los útiles que usa Samet); Samet redondea la carga a 2 decimales, el factor a 1 y la reserva a un entero.

**H-S1 – El "factor de seguridad" es *compatible con* CTA ÷ carga mostrada (sin reserva).** Si se multiplica cada factor por la carga mostrada (0,44 / 0,88 kg/m) se obtienen valores redondos: 290 / 300 / 400 / 440 / 530 / 580 para escaleras y 50 / 60 para perforadas. Con esos valores los 24 factores se reproducen dentro de ±0,05. Esto **no prueba** que esas sean las CTA de la base de Samet, ni que la fórmula sea exactamente esa. Si lo fuera, el factor sería la inversa de la utilización y no un coeficiente de seguridad IEC 61537.

**H-S2 – Carga por cable *compatible con* ≈ 0,110 kg/m** (0,44/4 y 0,88/8; con el redondeo, intervalo ≈ 0,1094–0,1106). La ficha Prysmian publica 114 kg/km (ed. 2020 p.3; ed. 2026 por lectura web). Origen no identificado. **No se declara error.**

**H-S3 – La "reserva real" es *compatible con* W_nominal / W_ocupado − 1**, tomando W_ocupado = n·D (no separado) y 2n·D (separado), con D en ≈ (8,099; 8,134] mm, que incluye 8,1. Con ese modelo, "131 %" no sería un porcentaje libre del ancho total: para 150 mm y 64,8 mm ocupados, el libre sobre el total es 56,8 %.
  - Lo que sí se puede afirmar: el modelo (2n−1)·D **no reproduce** el 54 % del caso 1 con ancho nominal 100 (da 76 %). Para los casos separados, D-01 no es compatible con estas salidas *bajo el supuesto de ancho nominal*. Con anchos útiles desconocidos, otras combinaciones podrían reproducirlas.

**H-S4 – La selección es *compatible con* "el menor ancho de cada línea con W_nominal ≥ (1 + r)·W_ocupado"** (bajo H-S3). Los tres casos son consistentes con esta regla; no se probaron reservas distintas del 20 %.

**H-S5 – Significado del factor 0: indeterminado.** Puede ser una CTA faltante, un valor nulo cargado, un caso especial del alambre u otra cosa. Lo observado es que el alambre se ofrece con factor 0. El motor no interpreta ese cero: para el alambre FAMIQ informa `NO_VERIFICABLE_SIN_REGISTRO` porque *nuestro* catálogo no tiene CTA.

**H-S6 – Diferencias con el catálogo del proyecto.** Bajo H-S1, Samet usaría 300 kg/m para la escalera G ala 65; el catálogo tiene 310 (CAR-0001, F-001 PDF 10 / impr. 19). Para Z ala 65 usaría 290, que coincide con el valor adoptado por REV-020 (DER-001). Para G ala 115 (580) y perforadas (50/60) el catálogo no tiene valor. Todo esto es *inferido* y no reemplaza a las fuentes.

## Comparación (ver `COMPARACION_SAMET.md`)

- **Caso 3 (no separado):** el motor ocupa 64,8 mm. Su métrica "sobrante sobre ocupado" da 54,3 % y 131,5 %, que redondeados coinciden con lo que muestra Samet.
- **Casos 1 y 2 (separado):** el motor usa (2n−1)·D. Los anchos mínimos coinciden con Samet con el criterio D-05 por defecto; con `sobre_ancho_ocupado`, el caso 2 llevaría a 150 mm. La coincidencia de anchos **no prueba** equivalencia de método.
- **Carga:** 0,456 / 0,912 kg/m del motor contra 0,44 / 0,88 de Samet (H-S2).
