# Diseño: Derivación intermedia en un tramo recto

## Contexto

El usuario quiere ramificar un tramo recto existente en un punto arbitrario dentro de su longitud, no en sus extremos (puertos P1/P2).
En el catálogo existen 110 piezas tipo T y 47 tipo X. El motor los trata como piezas con 3 o 4 puertos.
No existe `tipo_pieza = "derivacion"` ni `tipo_conexion = "derivacion"` en el contrato (auditado 2026-11-05 — 0 entradas).

---

## El problema de dividir un tramo

Un tramo recto en el modelo del motor es una sola pieza con `P1` y `P2`.
Para insertar una T en el medio hay que:

1. Acortar el tramo existente (cambiar la posición de P2).
2. Insertar la T con sus propios P1/P2/P3.
3. Insertar un tramo nuevo que sale de P3.
4. Reconectar las conexiones que apuntaban al extremo original.

**Dependencias que se rompen si se divide ingenuamente:**

| Campo de TrayInput | Riesgo |
|---|---|
| `pe.conductores[n].recorrido` | lista de `instancia_id` ordenados; si un tramo se divide, el conductor tiene que pasar por las dos mitades en orden. |
| `soporte_bandeja[n].sobre` | apunta a `instancia_id`; si la pieza se elimina el motor da ENTRADA_INVALIDA. |
| `pe.conductores[n].inicio` / `fin` | apuntan a `punto_id` de suministro; los puntos de suministro no son piezas, no se mueven. |
| `tapas[n].sobre` | igual que soporte — apunta a instancia. |
| `conexiones` | la conexión original `{a: [tramo, P2], b: [siguiente, P1]}` apunta al `tramo` viejo; si se parte en dos hay que actualizar `b` para apuntar al segundo tramo. |

---

## Dos representaciones posibles en el contrato

### Opción A — División lógica (dos tramos + pieza T)

El tramo original `SEG-1` (P1 en x=0, P2 en x=5000) se parte en dos:
- `SEG-1a`: P1 en x=0, P2 en x=2000 (punto de derivación)
- `SEG-1b`: P1 en x=2000, P2 en x=5000
- `T-1`: inserta en x=2000, con P1→SEG-1a.P2, P2→SEG-1b.P1, P3→rama nueva

**Ventajas:** el motor ve piezas físicas reales con longitudes documentadas; el BOM incluye la T con su cómputo exacto.

**Desventajas:** los recorridos de conductores que pasaban por `SEG-1` tienen que actualizar a `[..., SEG-1a, T-1, SEG-1b, ...]`. Los soportes sobre SEG-1 pasan a estar sobre SEG-1a o SEG-1b según su posición; el sistema tiene que reubicarlos.

### Opción B — T sin dividir (T en el extremo del tramo acortado)

No se parte SEG-1; en cambio se acorta a P2 en x=2000, y el SEG-1b se convierte en el primer tramo de la derivación.
La T queda entre SEG-1(acortado), SEG-rama y SEG-continuación.
Idéntico en resultado a Opción A pero sin el concepto de "mitad del tramo".

**Desventajas:** si el tramo viene de una operación anterior y el usuario ya configuró conductores con `recorrido = [SEG-1, SEG-2]`, al acortar SEG-1 se pierde la conectividad lógica hasta SEG-2 sin insertar la T y el tramo de continuación en el recorrido.

---

## Recomendación: Opción A con asistencia de migración

Implementar como "dividir tramo + insertar T + crear rama".

**La UI debe:**

1. Mostrar el tramo seleccionado con un control deslizante sobre su longitud (distancia desde P1, en mm, editable con input numérico).
2. Vista previa de las tres piezas resultantes (SEG-1a, T-1, SEG-1b) con colores distintos.
3. Paso de confirmación que liste explícitamente: `n soportes a reubicar`, `m conductores a actualizar`.
4. No confirmar si hay conductores cuyo recorrido incluye el tramo y el sistema no puede resolverlos automáticamente (pedir al usuario que edite el recorrido primero).

**Lo que el sistema hace automáticamente:**
- Generar IDs únicos para SEG-1a, SEG-1b, T-1 (y la conexión nueva del ramal).
- Dividir el tramo en la proporción correcta preservando posiciones en mm.
- Actualizar `conexiones`: la conexión que apuntaba a `{SEG-1, P2}` pasa a apuntar a `{SEG-1b, P2}`.
- Reubicar soportes: si el soporte está a distancia d desde P1 de SEG-1 y d ≤ longitud_1a → pasa a SEG-1a; si d > longitud_1a → pasa a SEG-1b con offset relativo.
- Actualizar recorridos de conductores: sustituir `SEG-1` por `[SEG-1a, T-1, SEG-1b]` en cada recorrido que lo contenía.

**Lo que NO hace el sistema automáticamente (y lo informa):**
- Reubicar tapas (`tapas[n].sobre`): misma lógica que soportes, pero las tapas tienen su propia geometría que puede no cubrir la longitud dividida. Marcar como "revisar manualmente".
- Cambiar `pe.equipotencial.puntos` si el conductor PE pasaba por SEG-1 — el equipotencial referencia conductor IDs, no piezas, así que probablemente no se rompe.

---

## Distinción: accesorio comercial vs. derivación en obra

| | Accesorio comercial (T de catálogo) | Derivación en obra |
|---|---|---|
| tipo_pieza | "T" (110 productos en catálogo) | No existe en catálogo |
| Longitud | documentada en catálogo | no aplica |
| BOM | aparece en cómputo (Python) | no aparece |
| Conexión | port-level documentada en COMPATIBILIDADES | NO documentada |
| Implementación | Opción A/B (arriba) | Excepción (ver design-exceptional-product-choice.md) |

Una derivación "cortando el tramo con tijera" es siempre una excepción no documentada.
El sistema la permite solo con el flujo de elección excepcional, no con este flujo de T-piece.

---

## Prerequisitos antes de implementar

1. El flujo de elección excepcional (design-exceptional-product-choice.md) debe estar implementado, ya que las T sin compatibilidad documentada con la familia del tramo pasarían por ese flujo.
2. Los tests de integración deben incluir un caso de trazado con T: aparece el ejemplo `trazado_derivacion_pe.json` en el motor (usa `SAM_TS-300-065-18-Z`), que puede servir como base.
3. Definir los nuevos IDs generados con una convención que no colisione con `generateSegmentId` existente — propuesta: prefijo `DER-` para la T y mantener `SEG-` para los tramos hijos.

---

## Criterios de aceptación (para implementación futura)

1. El usuario puede hacer clic en un tramo y ver el control de punto de derivación.
2. La vista previa muestra SEG-1a + T + SEG-1b en colores distintos antes de confirmar.
3. El commit es atómico: las tres piezas nuevas y las dos conexiones nuevas se escriben en un solo `trayEdit()`.
4. Los conductores que recorrían el tramo original son actualizados automáticamente en el mismo commit.
5. El motor acepta la entrada sin ENTRADA_INVALIDA (verificado con test de integración real).
6. Los soportes sobre el tramo original son reubicados correctamente según su posición mm.
