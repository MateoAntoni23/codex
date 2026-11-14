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
- Radio de giro = **PENDIENTE** (el encargo llegó con `<RADIO>` sin completar).
- Rango de ángulo ajustable = de **PENDIENTE**° a **PENDIENTE**° (llegó `<MIN>` / `<MAX>` sin completar).

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

## Notas de implementación (se completan al avanzar)
