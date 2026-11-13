# Traspaso — mezcla de acabados (rama `feat/mezcla-acabados`)

Base: `main` (`c61f6ca`). Los pendientes vigentes siguen en `traspaso-recorridos.md`.

## La decisión (operador, 2026-11-13)
Se **permite** unir piezas de acabados distintos dentro del mismo tipo de bandeja, porque ocurre en obra.
El sistema lo **marca** para que no pase desapercibido en el cómputo. Es un **aviso**, no una unión inválida:
las cuatro condiciones de B-3 siguen decidiendo la validez.

**Procedencia, textual:** «declarado por el operador, contradice REV-032 (fuente del catálogo)». Está en
`PROCEDENCIA_MEZCLA` (`src/workspace/mezclaAcabados.ts`) y aparece en cada marca. La decisión la toma el
operador por práctica de obra, **no SAMET**.

**Dato del propio catálogo, para no confundir:** REV-032 tampoco es de SAMET. Sus filas dicen «No compatible
entre familias **según el usuario** (F-005, REV-032)».
- En `RoutingPanel.tsx` había dos textos que se lo atribuían a SAMET («SAMET veda compatibilidad entre familias
  (REV-032)»). Se corrigieron.

## Qué es «mismo tipo de bandeja» (declarado, no deducido)
`GRUPOS_TIPO_BANDEJA`:
- **perforada Smarttray:** SAM-STP-Z (Z, zincada) y SAM-STP-ZN (color: ZN negro, ZB blanco).
- **escalera Smarttray:** SAM-STE-Z (Z, pregalvanizada) y SAM-STE-G (G, galvanizado en caliente).

**Fuera de los grupos:**
- **Escalera tradicional (SAM-ESC-TRL):** es otra línea, sin catálogo propio, así que no entra.
- **Perforada ↔ escalera:** sigue sin unir.

**Acabado de cada pieza:** sale del sufijo del SKU (Z, ZN, ZB, G) y, si el SKU no lo trae, del de su familia.
ZN ↔ ZB, de la misma familia, también es mezcla.

## Qué cambió
- **Regla física** (`compatibilidadFisica.ts`):
  - dentro de un grupo une aunque cambie la familia, si coinciden ancho y ala;
  - el resultado trae `mezcla` (los dos acabados nombrados y el texto con la procedencia);
  - de las 45 filas «no compatible» de la tabla, **las 38 de REV-032** entre acabados de un grupo
    (14 perforada Z↔ZN/ZB y 24 escalera G↔Z) dejan de bloquear esos pares. Las otras 7 siguen bloqueando.
- **Consecuencia:** desde una perforada color ahora se ofrecen la CUPS y la XPS zincadas del mismo ancho,
  marcadas.
- **La marca aparece, por el camino de los otros avisos, en:**
  - **la unión:** `checkConnection(entrada, c, productos)` la agrega a `JoinCheck.avisos`, donde está el aviso
    de ala. No cambia `ok`. La fila de la unión la muestra (`join-aviso-mezcla`, `data-join-mezcla="ZN|Z"`);
  - **«Unir extremos»:** se informa en la confirmación;
  - **la derivación:** sobre un tronco color se sigue ofreciendo y colocando la DCPS zincada, sin bloqueo. El
    enganche (tronco ↔ lo que sale del flanco) queda marcado en la fila de la derivación, en el mensaje al
    crearla y en las mezclas del trazado;
  - **la ficha de la pieza:** cada unión o derivación con mezcla en la que participa (`piece-mezcla`);
  - **Resultados:** la sección «Mezclas de acabados (n)» con cada unión y derivación, y una nota en el
    resultado.
- **Sin color:** la señal es el texto «⚠ MEZCLA DE ACABADOS», con los dos acabados y la procedencia
  (`stages/MarcaMezcla.tsx`). El encargo de interfaz va a dar un color por tipo de bandeja, y zincada y color
  van a compartir color.

## El motor (vendorizado, no se toca)
- **Qué hace:** el motor aplica REV-032 (`REGLA_DE_FAMILIA_REV-032` o la fila de la tabla) y declara
  `NO_COMPATIBLE` una unión Z↔ZN. Eso agrega el incumplimiento «conexiones no compatibles».
- **Cómo lo lee la app:** `summarizeResult` lo reclasifica como aviso, con el mismo patrón que «PE sin
  definir». Sólo lo hace si **todas** las conexiones `NO_COMPATIBLE` del resultado son por REV-032 y la app
  las marcó como mezcla. Si hay alguna por otro motivo, el incumplimiento se mantiene.
- **El estado que se muestra:** es el que el motor daría sin ese incumplimiento (con bloqueos o preselección
  condicionada).
- **El dato crudo:** el resultado del motor no se modifica.
- **Comprobado con el motor real** en la E2E.

## Pruebas
- `mezclaAcabados.test.ts` (10):
  - la procedencia textual, sin mención al fabricante;
  - los grupos;
  - **control negativo sobre todo el catálogo:** cada par que une con acabados distintos lleva la marca con
    los dos acabados, y los de igual acabado no;
  - la unión ZN → Z por el camino normal, válida y marcada;
  - ZN ↔ ZB;
  - la DCPS zincada sobre tronco color, colocada y marcada, y sobre tronco zincado sin marca;
  - Resultados: marcada pasa a aviso; la misma sin marca sigue como incumplimiento; con otra `NO_COMPATIBLE`
    se mantiene.
  - **Saboteando la marca** de las uniones con ZN fallan 5 de las 10 (verificado).
- `compatibilidadFisica.test.ts`: 38 superadas y 7 que siguen bloqueando; desde la CPS-300-45-Z se ofrece la
  color, marcada.
- `anchosOfrecibles.test.ts`: desde ZN 50/100 se ofrecen la CUPS y la XPS zincadas, marcadas ZN|Z.
- E2E `mezclaAcabados` (gestos reales y motor real):
  - **unión color → zincada:** válida y marcada en la unión, la ficha y Resultados; sin «conexiones no
    compatibles»; las dos piezas en el cómputo;
  - **derivación:** DCPS zincada sobre tronco color, marcada en la derivación, la ficha y Resultados.

## Relación con otros pendientes
- **«DCPS zincada sobre tronco color llega al cómputo»** (anotado en `traspaso-anchos-derivacion.md`): queda
  resuelto por esta decisión. Se permite y se marca.
- **Encargo de interfaz, «vacío silencioso de la familia color»:** cambia.
  - **Lo que ya no pasa:** desde una perforada color, la curva vertical, la X y la derivación ya se ofrecen
    (zincadas, marcadas).
  - **Lo que queda para ese encargo:** mostrar la marca **en el selector, antes de confirmar**. Hoy aparece
    recién en la unión.
  - **Donde sigue habiendo vacío:** cuando no existe la pieza en ningún acabado del tipo. Ahí sigue haciendo
    falta decir por qué.
