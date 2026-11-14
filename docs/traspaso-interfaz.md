# Traspaso — encargo de interfaz (rama `feat/interfaz`)

Encargo del operador, completo, para que no se pierda si se corta la sesión.
Pantalla del operador: **1366×768**. Tema oscuro por defecto. El encargo **no
cambia geometría, uniones, cómputo ni cálculo**: sólo cómo se ve.

Regla de trabajo: no hacer preguntas de decisión salvo que algo sea imposible o
se pierdan datos del operador. Si se duda entre dos disposiciones, elegir la que
muestre menos cosas a la vez.

## Estado

| Parte | Estado | Commit |
|---|---|---|
| A — cada cosa en su lugar | Hecha y aprobada por el operador | `b1ca484` |
| Defecto bloqueante: inspector sin desplazamiento + barra en dos líneas + «Sin resolver» tapando la escena | Hecho | `7baf6c3` |
| B — color por tipo de bandeja | En curso | — |
| C — cierre (E2E, verify por tandas, PR) | Pendiente | — |

## Parte A (hecha, `b1ca484`)

Cada cosa en su lugar: izquierda = lo que existe (listas, filtros); formularios en
el inspector; selector de pieza en tres pasos (tipo → ancho → variante, espesor y
acabado dentro); lista de piezas agrupada por tipo, plegable y con filtro; panel
inferior desplegable con pestañas (circuitos, cómputo, cálculo del motor, avisos).

## Defecto bloqueante (hecho, `7baf6c3`)

El inspector no se podía desplazar (`stages.css`: `.stage-inspector { height: 100% }`
sin regla de overflow); con una continuación de curva eslabonada el botón de
confirmar quedaba fuera de alcance.

- El inspector se desplaza cuando su contenido no entra (`min-height: 0` en los
  hijos de flex/grid). Lo mismo en los paneles izquierdos.
- Cabecera del inspector (título y Cancelar) y pie con el botón de confirmar siempre
  visibles; lo que se desplaza es el medio.
- **La prueba**: las E2E pasaban a 1366×768 con el defecto porque Playwright desplaza
  el contenedor por programa (incluso con `overflow: hidden`). Las E2E de interfaz
  comprueban que el botón de confirmar está DENTRO del área visible del panel sin
  desplazamiento programático, y que el medio se recorre con la rueda del mouse
  (`e2e/interfazAlcance.visual.spec.ts`, ayudantes en `e2e/helpers/interfaz.ts`).
- Control negativo verificado: sin la regla de overflow, o con el CSS de `b1ca484`,
  la prueba falla.
- Arreglos sumados: los carteles «Sin resolver» tapaban la escena (ahora etiqueta
  corta; el motivo al seleccionar); la barra de proyecto se partía en dos líneas a 1366.

## Parte B — color por tipo de bandeja

Hoy todas las bandejas se dibujan del mismo celeste (`#50b8de` en `TrayObjects.tsx`),
la seleccionada en amarillo (`#ffcf33`) y la vista previa en naranja (`#ff9900` en
`RoutingObjects.tsx`). No se distingue perforada de escalera mirando la escena.

- B1. Color de representación por **TIPO** de bandeja, no por familia ni acabado. Una
  perforada zincada y una perforada color son del mismo color (mismo tipo). Valores
  por defecto pedidos por el operador: **perforada celeste, escalera rojo, alambre
  ámbar**. Herrajes, soportes y accesorios de unión en **gris neutro**.
- B2. Configurable por el operador desde la interfaz. Es preferencia de pantalla: se
  guarda como el tema, en `localStorage`, fuera del archivo de proyecto.
- B3. El amarillo de selección choca con el ámbar del alambre: la selección pasa a ser
  **contorno y realce**, sin cambiar el color de relleno de la pieza. La vista previa
  sigue translúcida, pero con el **color de su tipo** en vez del naranja fijo.
- B4. Inválido, desactualizado y mezcla de acabados **no** se señalan con color de
  relleno: usan distintivo y texto, como ya hace la marca de mezcla.
- B5. Leyenda de colores visible en la escena, que se pueda ocultar.
- B6. Verificar y reportar **con números** que los tres colores se distinguen entre sí
  y contra el fondo de la escena, también con visión reducida del color (rojo-verde).
  Si alguno no pasa, ajustar el tono e informar cuál quedó.

## Parte C — cierre

- Las E2E existentes cambian de selectores, no de lo que verifican. Si una deja de
  poder verificar lo mismo, informarlo; no aflojarla.
- Una E2E nueva por cada punto de la B.
- Verify completo por tandas, sobre el código final. En la sesión anterior 116 pruebas
  no entraron en 4 tandas y hubo que usar 8: **usar 8 desde el principio**.
- Abrir el PR contra `main`.

## Fuera de alcance

Editar dimensiones de la nave y del piso, cargar planos, y cualquier cambio de
geometría, reglas de unión, cómputo o cálculo.

## Notas de implementación (se completan al avanzar)

