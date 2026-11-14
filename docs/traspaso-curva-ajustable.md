# Traspaso — curva ajustable CAS (rama `feat/curva-ajustable`)

Base: `feat/interfaz` (`118e047`). El PR #9 (interfaz) espera aprobación del operador: no tocarlo.

La CAS fue omitida en el encargo de curvas eslabonadas (`traspaso-curvas-eslabonadas.md`) y quedó anotada
como ignorada. Se retoma.

## La pieza
- **CAS-{ancho}-{ala}-{espesor}-{G|Z}**: 40 productos, sólo escalera. Anchos 150, 300, 450 y 600; alas 65,
  90, 115 y 150.
- `tipo_pieza` «curva horizontal»: el giro a izquierda o derecha visto desde arriba.
- El catálogo no declara ángulo ni radio («Ángulo ajustable: rango no declarado. Radio no declarado para
  esta pieza»).
- A diferencia de la CUS, el código NO lleva cantidad de eslabones: **una pieza por código**. No hay regla
  de eslabones.

## Reglas del operador (con esa procedencia)
El encargo llegó con `<RADIO>`, `<MIN>` y `<MAX>` sin completar; los valores se declararon después
(2026-11-14), respondiendo a la pregunta:

- **Radio interior = ancho de la bandeja.** El radio del eje es el interior más la mitad del ancho:
  **R_eje = 1,5 × ancho** (CAS-300 → interior 300 mm, eje 450 mm). Los centros de boca y la longitud de eje
  van sobre el eje.
- **Rango de ángulo: de 1° a 90°, PROVISIONAL**, declarado por el operador. El catálogo dice «Ángulo
  ajustable: rango no declarado».
  - Está elegido **corto a propósito**: rechazar un ángulo válido se ve en el momento; aceptar uno
    imposible recién se descubre en obra.
  - Si el operador necesita un ángulo mayor, el rango se amplía cambiando ese único valor (ver notas de
    implementación: dónde está).

## Qué se pide
1. Ángulo por instancia, igual que las eslabonadas. Por defecto 90°.
2. El ángulo se elige **al colocar**, en el panel de continuación, antes de confirmar (no sólo corregirlo
   después, como pasó con la eslabonada).
3. La vista previa se dibuja con el ángulo elegido.
4. Boca de salida = la de entrada girada ese ángulo alrededor del centro. Longitud de eje = el arco de ese
   radio y ese ángulo.
5. Un ángulo fuera del rango se rechaza con el motivo y el rango.
6. Dibujo esquemático, como las eslabonadas: una banda curva del ancho de la bandeja barriendo el ángulo.
7. Cómputo: 1 código por curva.
8. Aparece en el selector de tres pasos dentro del tipo «curva horizontal», como variante junto a las
   curvas fijas de 45° y 90°.
9. Al seleccionar una ya colocada se puede corregir el ángulo, como la eslabonada.

**Control negativo**: si el ángulo elegido no llega a la pieza colocada, o si uno fuera de rango se acepta,
las pruebas tienen que fallar.

**Cierre**: verify completo en 8 tandas, con vitest en 2 procesos (ya fijo en `vite.config.ts`).

## Notas de implementación

- **Regla** — `src/parametric/reglaCurvaAjustable.ts`: radios, longitud de eje, rango y procedencia. **El
  rango se amplía cambiando `ANGULO_AJUSTABLE_MAX`** (hoy 90, marcado PROVISIONAL).
- **Geometría** — `src/parametric/geometry/curvaAjustable.ts`: banda curva esquemática entre el radio
  interior (ancho) y el exterior (2 × ancho), alto = ala, en el marco de las CS (planta XZ, alto en Y).
  P1 sobre el eje a φ = 0; P2 = P1 girada θ alrededor del centro. La otra mano (giro al otro lado) es la
  definición espejada, como cualquier pieza asimétrica: el selector de lado de siempre.
- **Maestro** — `master:escalera:curva_ajustable` (prefijo `CAS-`). Las CS de 45° y 90° (mismo
  `tipo_pieza`) siguen con sus maestros.
- **Ángulo por instancia** — `src/parametric/anguloInstancia.ts` junta las eslabonadas y la CAS: el
  ángulo entra en la definición y en la huella; cada receta con su valor por defecto y su rango. Fuera del
  rango, `definicionEfectiva` no da definición (motivo con el rango): no hay vista previa, ni
  confirmación, ni corrección.
- **Al colocar** — `anguloInstancia` en el estado de la continuación → `routingPlacementFromState` →
  `computeRoutingPlacement` (el mismo cálculo para la vista previa y para confirmar). Campo «Ángulo de la
  curva (°)» en el panel de continuación, sólo para la CAS. `planAddCurve` toma el ángulo de la
  colocación cuando el catálogo no lo declara (antes cortaba con «angulo_grados must be > 0»).
- **Longitud de eje** — `longitudesEje.ts`, regla `arco_curva_ajustable`: R_eje · θ, verificando que las
  bocas guardadas estén sobre ese giro.
- **Corregir después** — ficha «Curva ajustable» (`AnguloAjustableField.tsx`, `cambiarAnguloAjustable`):
  la boca de entrada no se mueve; las uniones de la boca de salida que dejan de cumplir quedan en Uniones
  con su motivo y la ficha avisa cuántas.
- **Selector** — variante «CAS · ala 65 · ángulo ajustable» dentro de «Curva plana», junto a «CS · ala 65
  · 45°» y «CS · ala 65 · 90°».
- **Cómputo** — el motor cuenta 1 pieza por instancia (D-18): 1 código por curva. Verificado con el motor
  real en la E2E (2 CAS → 2 × CAS-300-065-18-Z). El motor recibe la CAS con `radio_mm` nulo (el catálogo
  no lo declara) y calcula igual.
- **Dos arreglos de pantalla de paso**:
  - el panel de continuación decía «La pieza no se puede colocar desde este puerto: el catálogo no
    declara angulo_grados» para la CAS, aunque se colocaba. Ahora usa el ángulo de la definición y se
    rotula «regla del operador (sin STEP)»;
  - los campos de coordenadas de la ficha mostraban el ruido de coma flotante como «-6.3948846» (era
    −6,39e−14). Se muestran redondeados a 0,001 mm; el dato no cambia si no se edita.

## Pruebas

- `src/parametric/geometry/__tests__/curvaAjustable.test.ts` (34): regla y rango (extremos 1° y 90°
  aceptados; 0, 0,5, 90,5, 91, 120, 180, −45 y NaN rechazados con el rango); geometría en 4 anchos × 4
  ángulos; las 40 CAS resuelven a su maestro; el ángulo en la huella; colocar con 30/45/75/90° (el ángulo
  llega a la pieza: bocas, giro, definición); las dos manos; `planAddCurve`; corrección; longitud de
  eje; selector.
- E2E `e2e/curvaAjustable.visual.spec.ts` (gestos reales, 1366×768): selector; 90° por defecto; 30° en la
  vista previa y en la pieza confirmada (bocas, giro horizontal, eje = arco); 120° rechazado con el rango,
  sin vista previa ni pieza; corrección 30° → 95° rechazada → 60° aplicada (boca de entrada fija, unión
  siguiente «no cumple»); cómputo del motor real: 1 código por curva.
- **Controles negativos, verificados**:
  - el ángulo elegido no llega a la colocación (`computeRoutingPlacement` ignora `anguloDeg`): fallan 5
    unitarias y la E2E («vista previa 90°, esperado 30°»);
  - un ángulo fuera de rango se acepta (`motivoAnguloAjustable` devuelve siempre null): fallan 6
    unitarias y la E2E (no aparece el rechazo a 120°).
- **Pruebas que cambian a propósito** (no se aflojaron):
  - `sinValoresPorDefecto` y `geometriaNominal` afirmaban «CAS sin definición, con el motivo del montaje».
    Ahora verifican lo mismo que protegían (el catálogo no aporta el ángulo): el ángulo viene de la regla
    del operador, con esa procedencia en el maestro, y fuera de rango no hay definición;
  - `masterModels`: inventario 16 → 17 maestros (escalera 7 → 8). La regla «variantes = parcial» es para
    polígonos medidos escalados por hipótesis: la CAS queda fuera, como la CUS (es regla del operador);
  - `huellas-cambios.json`: las 40 CAS pasan de «sin modelo» a su huella nueva, con el motivo.
