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
- **Ley:** la mitad izquierda de la planta (vértices 0–4) es idéntica en 50 y 300 (±0,001 mm), y la
  derecha (5–9) es la misma corrida exactamente 250 mm.
  - Con dos puntos esto supone que cada cota es lineal en el ancho: las que coinciden en 50 y 300 quedan
    constantes.
  - 100, 150 y 200 quedan dentro del rango medido. 450 y 600 lo extrapolan y se fabrican en chapa 0,89.
- **Pequeñas inclinaciones del modelo:** la pestaña inclina 0,09° (4,811 → 4,747 en 39,7 mm) y el cuello
  otro tanto.
- **Catálogo:** no hay contradicción. Las 7 filas DCPS declaran ancho de boca 50–600 y ala 50, el puerto
  P1 «boca derivación» y la observación «se fija al costado de un tramo principal de cualquier ancho».
  Lo medido coincide.
- **El modelo DCPS anterior no era una DCPS:** salía de otro STEP (7/11, ala 65) con la forma de la TPS, e
  incluía la sección del tronco. Se deja intacto para la TPS (`DCPS_OUTLINE_300`).
- **Consecuencia en B-3:** la boca DCPS mide nominal + 1,315 en 50 y en 300, un sobreancho fijo. La
  tolerancia de ancho pasó a desvío por boca = max(0,379 % del ancho; 1,32 mm). Sigue distinguiendo anchos
  vecinos: en el par más justo, 44 → 50, quedan 3,36 mm de separación contra 2,64 mm de tolerancia.

## Parte 4 — modelos
- `buildDCPSLateralRecipe` (`outlines.ts`): 50 y 300 son el contorno medido; 100, 150, 200, 450 y 600 se
  generan por la ley. La procedencia queda en las notas de la receta y en el maestro
  `master:perforada:derivacion_lateral` (regla `mitad-corrida`, procedencia `measured`). Una sola boca, P1.
- `dcpsLateral.test.ts`:
  - los 7 productos son colocables;
  - los 2 medidos coinciden con su STEP;
  - la ley aplicada desde la 300 reproduce el STEP de 50 (±0,002 mm);
  - los 5 generados siguen la ley;
  - cotas por ancho.
- PB1: las 7 huellas DCPS quedan declaradas. La auditoría de bocas queda sin huecos.

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
