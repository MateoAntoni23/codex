# Traspaso — derivación en un tramo (rama `feat/derivacion-tramo`)

Base: `d183cab`. Los pendientes vigentes siguen en `traspaso-recorridos.md` ("Pendientes (los únicos)").

## Parte 1 — medición de los dos STEP (DCPS-50-Z y DCPS-300-Z, operador, 2026-11-12)
Extraídos con `analyze_step.py` y `extract_outlines.py`, sin que ninguno quedara salteado. Están en
`tools/step_parametric/report/perforada/derivacion/`. Cada uno es un sólido de 12 caras planas: una planta
de 10 vértices extruida 50 mm (ala 50).

| Cota | DCPS-50 | DCPS-300 | ¿Escala? |
|---|---|---|---|
| Boca del ramal: ancho × ala | 51,315 × 50 | 301,315 × 50 | ancho + 1,315 (sobreancho fijo) |
| Huella sobre el flanco (cara de apoyo) | 229,323 | 479,323 | ancho + 179,323 |
| Profundidad, del plano de apoyo a la boca | 80,542 | 80,542 | no |
| Pestaña junto al apoyo (alto × largo) | 4,811 × 39,71 | 4,811 × 39,71 | no |
| Chaflanes a 45° (Δx × Δz) | 49,24 × 49,09 | 49,24 × 49,09 | no |
| Cuello recto hasta la boca | 26,709 | 26,709 | no |
| Dimensiones generales (planta × alto) | 229,3 × 80,5 × 50 | 479,3 × 80,5 × 50 | solo el largo |

- **Geometría de la cara que apoya contra el tronco:** un rectángulo plano de huella × 50, sobre el plano
  z = 0, con normal hacia el tronco.
- **La 50 y la 300 son la misma planta:** la mitad izquierda (vértices 0–4) es idéntica (±0,001 mm) y la
  derecha (5–9) es la misma, trasladada 250 mm.
- **Pequeñas inclinaciones del modelo:** la pestaña inclina 0,09° (4,811 → 4,747 en 39,7 mm) y el cuello
  otro tanto.
- **Catálogo:** no hay contradicción. Las 7 filas DCPS declaran ancho de boca 50–600 y ala 50, el puerto
  P1 «boca derivación» y la observación «se fija al costado de un tramo principal de cualquier ancho».
- **El modelo DCPS anterior no era una DCPS:** salía de otro STEP (7/11, ala 65) con la forma de la TPS, e
  incluía la sección del tronco. Se deja intacto para la TPS (`DCPS_OUTLINE_300`).

### DCPS-450 (STEP del operador, 2026-11-12, chapa 0,89) — medida y NO incorporada
- **Boca medida: 451,584** (sobreancho 1,584). No coincidió con ninguna predicción: constante 451,315,
  sigue a la chapa 451,648, dos espesores 451,780.
- **Ala:** venía extruida con **ala 65**, un error del operador. La perforada se fabrica en un solo ala
  (50) y la fila del catálogo está bien. **La reexportación quedó IGNORADA por decisión del operador
  (2026-11-13):** no se mide nada más de ese archivo y la 450 sigue sin STEP propio.
- **Es un dibujo distinto, no la misma planta escalada:** todas sus cotas se corren una o dos décimas
  (profundidad 80,654; escalón de pestaña 5,001; huella N + 179,426) y ninguna corrida es múltiplo del
  cambio de chapa.
- **Decisión del operador: no hay ley.** El sobreancho se declara por modelo medido, como dato, no por
  fórmula.

## Parte 4 — modelos (sin ley)
- `buildDCPSLateralRecipe` (`outlines.ts`):
  - **con STEP propio** (`DCPS_LATERAL_MEDIDOS`: 50 y 300): la planta medida;
  - **sin STEP** (100, 150, 200, 450, 600): la planta del medido **más cercano** con la mitad derecha
    trasladada. 100 y 150 salen de la 50; 200, 450 y 600 de la 300. Es una cota **no confirmada**.
- El maestro `master:perforada:derivacion_lateral` declara la regla `mitad-corrida` con procedencia
  `derived`. Una sola boca, P1.
- **Sobreancho de boca, por modelo medido** (`sobreanchoBoca.porModeloMedido` en el maestro: 50 → 1,315 y
  300 → 1,315, cada uno con su STEP). Un ancho sin STEP toma el de su medido más cercano. No hay fórmula por
  ancho ni por espesor; más STEP se agregan como datos.
- **Aviso al colocar:** una DCPS sin STEP propio deja en el enganche, a la vista en el mensaje de creación
  y en la fila de la derivación: «cota de boca NO CONFIRMADA — no hay STEP propio de este ancho; se generó
  con la planta y el sobreancho (1.315 mm) de la DCPS-N medida».
- `dcpsLateral.test.ts`:
  - los 7 productos son colocables;
  - los 2 medidos coinciden con su STEP;
  - la 50 y la 300 son la misma planta;
  - cada generado tiene la planta de su medido más cercano;
  - las dos tablas de anchos medidos (planta y sobreancho) coinciden;
  - cotas por ancho.
- PB1: las 7 huellas DCPS quedan declaradas. La auditoría de bocas queda sin huecos.

## Tolerancia de ancho (B-3)
La regla general vuelve a ser **sólo** `DESVIO_ANCHO_RELATIVO` (2 × 0,379 % × ancho), idéntica a la de
antes del hito; el piso absoluto de 1,32 mm se quitó.
- **Sobreancho de familia:** una familia cuyas bocas miden sistemáticamente más que el nominal lo declara
  en su maestro. La comparación descuenta ese corrimiento antes de aplicar la regla general.
- **Hoy solo lo declara la DCPS lateral.**
- **Control:** sin descontarlo, la DCPS-50 (51,315) no uniría con su tramo de 50, cuya tolerancia es
  0,39 mm.

## DCPS huérfana (bloqueada)
- **No se ofrece como continuación:** no figura en la continuación de un recorrido (`esDerivacionLateral`
  en `continuationCandidates.ts` y `RoutingPanel.tsx`). Solo se coloca con la herramienta «Derivación en
  tramo».
- **Proyectos anteriores:** una DCPS sin enganche se marca inválida, con motivo, en «Derivaciones en
  tramo» (`dcpsHuerfanas`).
- **Controles negativos:** en `enganche.test.ts` y en la E2E `mappingBocas` C4.

## Partes 2 y 3 — la unión y el accesorio (`workspace/derivacion/enganche.ts`)
- **Enganche** (clave workspace-only `enganches_ws`, que no viaja al motor):
  - qué se elige: tronco recto, boca de referencia, distancia hasta el centro del enganche, lado (mirando
    desde esa boca hacia el tramo) y ramal;
  - el tronco no se corta ni cambia su largo;
  - el ramal sale perpendicular al flanco;
  - guarda la foto del tronco.
- **Familia:**
  - **perforada:** coloca la DCPS del ancho del ramal con la cara de apoyo contra el flanco. Es una pieza
    del trazado, así que el motor la computa. El ramal se une a su boca P1 (unión normal, se aplica B-3).
    Si no hay DCPS de ese ancho, no se crea y se dice por qué.
  - **escalera:** `accesorio: { tipo: 'sin_accesorio_por_familia', motivo: 'escalera: la derivación no
    consume accesorio; se arma cortando en obra' }`. El ramal se engancha al flanco. La huella es el ancho
    del ramal.
- **Tiene que caber:** la huella no puede pasarse de los extremos («se pasa N mm del extremo P1») y no
  puede superponerse con otro enganche del mismo lado («se superpone N mm con ENG-k»).
- **Entre tronco y ramal no se aplica B-3:** no hay una `conexion` entre ellos.
- **Desactualizado con motivo, sin recalcular:** cuando el tronco se mueve o rota, cambia de largo o se
  borra, o cuando falta la DCPS o el ramal. Un enganche desactualizado no se atraviesa.
- **Control negativo** (`validarEnganche`): perforada sin DCPS resuelta, o escalera con accesorio
  asignado, falla.
- **Recorrido** (`caminoEntreBocas`, extensión):
  - el tronco tiene una pseudo-boca `enganche:<id>` y la DCPS, la pseudo-boca `apoyo`;
  - longitud por perforada = distancia guardada + profundidad guardada de la DCPS + ramal;
  - longitud por escalera = distancia guardada + ramal.
- **Circuitos** (extensión de `circuitosGuardados.ts`): guardan los enganches que atraviesan con su
  firma. Quedan desactualizados si el enganche cambia, se borra o queda desactualizado.
- **UI** (Bandejas):
  - herramienta «Derivación en tramo»;
  - sección «Derivaciones en tramo», con el accesorio («DCPS-100-Z (se computa)» o «sin accesorio por
    familia») y el estado;
  - la boca del ramal enganchada no figura como extremo libre.

## Pruebas
- `enganche.test.ts` (11): las dos familias, que la huella entre, los controles negativos, el
  desactualizado, los recorridos y el circuito por un enganche.
- E2E `derivacionTramo` (gestos reales):
  - **perforada:** tronco 300 de 3000 mm, enganche a 1500, ramal 100. Unión válida, el motor computa
    1 DCPS-100-Z, recorrido completo de 2.580,5 mm y el tronco intacto;
  - **escalera:** tronco 300, ramal 150. Sin accesorio, ninguna DCPS ni T en el cómputo, recorrido
    completo de 2.500,0 mm.
- E2E `mappingBocas` C4 reescrita: la DCPS ya no es el ejemplo de producto sin calibración, porque no
  queda ninguno.
