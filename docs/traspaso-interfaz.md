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
| B — color por tipo de bandeja | Hecha | ver PR |
| C — cierre (E2E, verify por tandas, PR) | Hecha | ver PR |

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

## Notas de implementación — parte B

- **Tipo**: `src/workspace/colores/coloresTipo.ts`. Sale del `tipo_constructivo` de la familia del
  catálogo (`SAM-STP-Z` y `SAM-STP-ZN` → perforada; `SAM-STE-*`, `SAM-ESC-TRL` → escalera;
  `FAMIQ-ALAMBRE-INOX` → alambre). Dentro de esas familias, lo que no es recorrido (ménsula, unión,
  soporte, separador…) y las familias «otro» (accesorios, ferretería, perfilería) → herraje.
- **Preferencia**: `localStorage` `codex:ui:colores-tipo` (colores) y `codex:ui:leyenda-colores`
  (leyenda visible u oculta). Nunca en el archivo de proyecto (E2E B2 descarga la copia y lo verifica).
- **Leyenda** (`LeyendaColores.tsx`): abajo a la izquierda de la escena; sólo los tipos presentes;
  cada muestra es el selector de color; «Restablecer colores» sólo si hay cambios; avisa con el par y
  el número si la paleta elegida no se distingue. Oculta, queda un botón «Colores».
- **Selección**: contorno blanco (`Edges`, 2,5 px) + realce emisivo; el relleno no cambia. En las
  piezas dibujadas como línea (esquema), halo blanco detrás de la línea.
- **Estados (B4)**: ninguna pieza cambia de relleno por estado. La escalera «pendiente» y los esquemas
  pasan del naranja/gris al color de su tipo; el estado queda en su etiqueta de texto. Los
  marcadores «Sin resolver» / «Geometría nominal» / «Modelo no resuelto» tienen el octaedro en blanco
  neutro (antes rojo y ámbar, confundibles con escalera y alambre).
- **Cómo se dibuja el color**: con los materiales anteriores lo dibujado no era lo elegido (opacidad
  0,75–0,85 sobre fondo oscuro, luz ≈0,7 y el tone mapping ACES de la escena, que lavaba el ámbar:
  `#ffd54f` se veía `#c6b55d`). Las piezas confirmadas se dibujan opacas, `toneMapped={false}` y con
  base emisiva 0,3 de su color (selección 0,6). La vista previa sigue translúcida (0,35). Equipos y
  resto de la escena sin cambios.

### B6 — distinción medida

Umbrales: ΔE2000 ≥ 20 entre tipos y contraste ≥ 3:1 contra el fondo (WCAG 1.4.11), en visión normal,
protanopía y deuteranopía (Machado 2009, severidad 1). CIEDE2000 verificado contra la tabla de Sharma
(2005). Fondo de la escena `#111120`.

Ajustes de tono: el pedido era celeste / rojo / ámbar. Quedaron **perforada `#4cb4f0`, escalera
`#ee4638`, alambre `#ffd84f`, herrajes `#6e737c`**. El rojo pasó de un rojo puro a uno algo anaranjado
(con protanopía un rojo puro queda oscuro contra el fondo) y el ámbar se aclaró (con deuteranopía rojo
y ámbar sólo se separan por luminosidad). El gris se oscureció para separarse del celeste.

Nominal (peor caso de cada medida): par escalera/alambre con deuteranopía ΔE 21,8; contra el fondo,
escalera con protanopía 3,53:1; herraje 3,9:1.

Dibujado (píxeles de la escena a 1366×768, vista cenital, E2E B6; perforada `#46a4da`, escalera
`#d84135`, alambre `#e8c449`):

| Par | normal | protanopía | deuteranopía |
|---|---|---|---|
| perforada / escalera | 53,1 | 46,5 | 49,0 |
| perforada / alambre | 54,9 | 51,1 | 54,7 |
| escalera / alambre | 45,7 | 34,2 | **21,7** |

| Contra el fondo (contraste) | normal | protanopía | deuteranopía |
|---|---|---|---|
| perforada | 6,74 | 7,43 | 6,30 |
| escalera | 4,20 | **3,07** | 4,95 |
| alambre | 11,04 | 10,28 | 11,51 |

Margen chico: escalera contra el fondo con protanopía (3,07 dibujado) y escalera/alambre con
deuteranopía (21,7). Son los dos límites que se tiran entre sí (un rojo más claro se ve mejor contra el
fondo pero se acerca al ámbar). El rojo carmín separaba mejor del ámbar pero se confundía con el gris
de herrajes con protanopía (ΔE 12,9): descartado.

