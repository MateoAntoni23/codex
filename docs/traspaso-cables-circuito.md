# Traspaso — etapa 2: el cable del circuito (rama `feat/cables-circuito`)

Completa el dato que el motor exige por circuito (`trazado_entrada.py`: `circuito_id`, `funcion`, `cable_id`,
`cantidad`, `separado`, `recorrido`). **No se manda al motor**: eso es la etapa 3. El motor no se tocó.

## Qué hace `separado` en el motor (averiguado, 2026-11-13)
- Decide la **disposición de los cables en la bandeja**, y con ella el **ancho que ocupan** (`calculos.py`,
  `disposicion_una_capa`; `motor.py` y `trazado.py` lo traducen a «separado» o «contacto»):
  - `true` → **separados (D-01, acordada):** queda libre un diámetro de cable entre cada uno (hueco g = D).
    Ancho ocupado W = (2n−1)·D. Sólo con todos los cables de esa bandeja del **mismo diámetro**; con diámetros
    distintos el motor responde «pendiente de decisión» (D-03, regla propuesta g = max(Dᵢ, Dⱼ), no implementada);
  - `false` → **en contacto (D-02, convención del producto):** juntos, sin hueco. W = Σ Dᵢ. La documentación
    aclara que «separado desactivado» no prueba una disposición física: es una convención.
- Siempre **una sola capa**: apilados no se calcula (D-09).
- **Mezclar** en una misma bandeja grupos separados y en contacto: sin regla, «pendiente» (D-07). Lo va a
  encontrar la etapa 3 cuando dos circuitos con distinta elección compartan una bandeja.
- El motor exige el campo explícito: «'separado' es obligatorio: no se presume la disposición» (`motor.py`).
  Por eso **la app no le pone valor por defecto**: el operador elige «Separados: un diámetro de cable libre
  entre cada uno» o «Juntos: tocándose, uno al lado del otro». Mientras no elija, el circuito queda incompleto.

## Selector en cascada (`workspace/cables/catalogoCables.ts`)
- **Línea → tipo → formación**, armado desde los datasets de `vendor/motor_bandejas/datos/cables/` (los 113
  cables: 110 Sintenax Valio, 3 Superastic Flex). «Tipo» lleva el material, porque en una misma línea hay
  tripolares de cobre y de aluminio. Listas: 2 líneas; hasta 9 tipos; hasta 17 formaciones.
- **El id es el del motor:** una única copia de la regla en el frontend (`idDeCable`). La usan la cascada y el
  catálogo estático (`deriveCableIds`). Contrastes:
  - prueba unitaria contra los ids que da `RegistroCables` del motor en Python
    (`__tests__/fixtures/cable_ids_motor.json`): coinciden uno a uno;
  - con el motor conectado, los ids empaquetados entran en la huella que se compara con la del motor; si
    difieren, el motor queda «incompatible».
  Si el catálogo no coincide, la cascada no se ofrece y se dice por qué.

## El dato en el circuito (`recorridos/circuitosGuardados.ts`)
- `cable?: { cable_id, cantidad, separado, funcion }`, guardado con el circuito (`circuitos_ws`), que
  sobrevive a cerrar y abrir:
  - `cantidad` es entero positivo, por defecto 1 en el formulario;
  - `separado` puede ser `true`, `false` o `null` (sin elegir);
  - `funcion` es siempre `"potencia"`: el motor no acepta otra en los circuitos, y el PE se declara aparte,
    en su propia sección, para no contarlo dos veces. En pantalla aparece fija, con esa explicación.
- **Sin cable no es un error:** el circuito queda **incompleto** y se dice qué le falta («le falta el cable
  para poder calcular»; «falta indicar si los cables van separados o juntos»; un cable que ya no está en el
  catálogo). Incompleto no es desactualizado: son dos estados independientes. **No hay cable por defecto.**
- El cable se elige al guardar el circuito (Conexiones) o después («Elegir cable» / «Cambiar cable» en
  Resultados). Recalcular el recorrido conserva el cable.
- Un archivo con un cable de datos inválidos (cantidad no entera positiva, función distinta de potencia) se
  rechaza al abrir.

## Resultados
- Columnas **Cable** (p. ej. «Sintenax Valio · Tripolar · cobre · 3 × 50 mm²») y **Cantidad**, también en
  «Copiar tabla». Lo incompleto se dice en la fila y en la columna Estado.

## Pendientes y observaciones
- Con 10 columnas, la tabla de circuitos queda apretada en el panel lateral (tiene desplazamiento horizontal).
  Queda para el encargo de interfaz.
- Etapa 3: mandar el circuito al motor (con `separado` y la sección PE), mostrar ocupación, reserva, radio de
  curvatura y masa. Tener en cuenta D-03 y D-07 (arriba).

## Pruebas
- Unitarias:
  - `cables/__tests__/catalogoCables.test.ts`: 113 cables, ids iguales a los del motor, listas de la cascada,
    contraste fallido;
  - `circuitosGuardados.test.ts` (cable): sin cable queda incompleto; guardar o asignar y abrir de nuevo;
    validaciones; `separado` sin elegir; recalcular conserva el cable; archivo inválido.
- E2E `cablesCircuito` (gestos reales):
  - circuito entre dos equipos con Sintenax Valio · Tripolar · cobre · 3 × 50 mm², cantidad 2, juntos;
  - otro sin cable, incompleto con el motivo;
  - cable y cantidad en Resultados y en «Copiar tabla»;
  - sobrevive a recargar;
  - elegir el cable después desde Resultados lo completa.
- Verify completo por tandas al cerrar.
