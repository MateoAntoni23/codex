# Traspaso — componentes de unión de las mezclas (rama `feat/mezcla-componentes-union`)

Base: `891b7e4` (mezcla de acabados, ya fusionada en `main` por el PR #2). PR contra `main`.

## El problema
Cuando una conexión da NO_COMPATIBLE o NO_REGISTRADA, el motor no calcula sus componentes de unión
(`computo.py`, D-24): emite una línea «bloqueada» y sigue. Con las mezclas permitidas, toda unión mezclada
quedaba sin bulonería en el cómputo, y eso llega al presupuesto.

## Lo que hace la app (el motor no se toca y su resultado no se modifica)
`src/workspace/componentesUnionMezcla.ts` **agrega** líneas, identificadas como de la app:
- **Alcance:** sólo las conexiones que la app marcó como mezcla de acabados. Una NO_COMPATIBLE o
  NO_REGISTRADA por otro motivo queda bloqueada como antes.
- **De dónde salen:** se copian tal cual de COMPONENTES_UNION de una fila de compatibilidad entre piezas del
  **mismo acabado**, del mismo tipo de bandeja, ancho y ala.
  - Si hay varias, se prefiere la del mismo par de tipos de pieza que la conexión, y después la de menor id.
  - No hay regla de selección de acabado: en el catálogo todas las uniones de escalera llevan JB-CC-3/8
    (4 juegos documentados) y todas las de perforada JB-CC-M6 (2 juegos). La prueba lo verifica.
- **Si ninguna fila del mismo acabado documenta componentes:** la conexión queda bloqueada y visible. No se
  inventa una pieza.
- **Marca de cada línea:** `agregada_por_app: true` y la procedencia «unión entre acabados distintos,
  componentes tomados de la unión del mismo acabado; declarado por el operador», además de la fila de origen.
- **En Resultados:**
  - la sección «Componentes de unión agregados por la app», separada de lo que calculó el motor
    (`computo-linea-app`, con «[AGREGADA POR LA APP]» y la procedencia);
  - en la lista cruda del cómputo, la línea bloqueada del motor dice «completada por la app» y las agregadas
    van aparte, con su marca;
  - la línea agrupada «N conexiones sin componentes de unión determinables» para las que no se pudieron
    completar. **Es nueva:** antes no existía agrupada; el motor sólo emitía una línea por conexión.

## Pruebas
- `componentesUnionMezcla.test.ts` (6):
  - **verificación sobre el catálogo:** cada combinación mezclada que la app completa trae JB-CC-M6 en
    perforada y JB-CC-3/8 en escalera. Saboteando el juego, falla con 868 líneas equivocadas (verificado);
  - Z↔ZN: JB-CC-M6 × 2, tal cual, de una fila del mismo acabado;
  - G↔Z: JB-CC-3/8;
  - **controles negativos:**
    - perforada↔escalera, que no es mezcla, no se completa;
    - una línea sobre una conexión no marcada falla;
    - una línea sin su marca de procedencia falla;
  - un proyecto sin mezclas no tiene líneas agregadas.
- E2E `mezclaComponentesUnion` (gestos reales, motor real):
  - **ZN → Z:** el motor deja la unión bloqueada sin JB-CC-M6, y la app agrega JB-CC-M6 × 2 marcado;
  - **Z → Z:** ninguna línea agregada.
