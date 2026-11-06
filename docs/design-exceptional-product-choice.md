# Diseño: Elección excepcional de producto ("Ver otros productos")

## Contexto

El flujo de recomendación automática filtra el selector de productos a continuaciones documentadas en COMPATIBILIDADES para el puerto de origen.
Este diseño cubre el caso en que el usuario quiere usar un producto que el catálogo no documenta como compatible
(ejemplo: continuar una escalera G con una escalera Z — 0 entradas directas G↔Z en las 4 373 de COMPATIBILIDADES, aunque en obra la combinación se usa con soportes validados por usuario, REV-032).

---

## Problema concreto

El motor rechazará una conexión directa recta-G → recta-Z porque no existe entrada en COMPATIBILIDADES.
El diagnóstico del motor es correcto: la compatibilidad no está documentada.
El usuario puede conocer que la conexión es viable en un proyecto específico (por ejemplo, con una pieza de transición que el catálogo aún no tiene cargada, o por acuerdo con el fabricante).
El sistema no debe ocultar esa decisión ni presentarla como si estuviera catalogada.

---

## Propuesta de UI

### Punto de entrada
En `StepConfiguringSegment`, debajo del selector compatible, un enlace:

```
Sin la continuación que necesitás? → Ver otros productos (elección excepcional)
```

Al hacer clic, el selector se expande para mostrar TODOS los rectos (no sólo compatibles), con los incompatibles marcados visualmente (color distinto, texto "⚠ sin compatibilidad documentada").

### Confirmación explícita
Al elegir un producto incompatible, aparece un modal de confirmación antes de que `handleConfirm` se ejecute:

```
Producto fuera de catálogo
──────────────────────────
{SKU seleccionado} no tiene compatibilidad documentada con {puerto de origen}.

Motivo (requerido):
[ campo de texto libre ]

□ Confirmo que esta conexión será responsabilidad del proyectista
                            [Cancelar]  [Confirmar de todas formas]
```

El campo "Motivo" bloquea la confirmación si está vacío.

---

## Representación en el modelo de datos

### Qué NO hacer
- No agregar un flag `conexion_excepcional: true` al objeto `Conexion` del contrato del motor — el motor versión 0.2.2 no acepta campos extra en conexiones (ENTRADA_INVALIDA).
- No inventar una entrada falsa en COMPATIBILIDADES.
- No omitir el motivo en texto libre sin estructura (no persistiría en export).

### Propuesta: campo lateral en el workspace
En `TrayInput` (workspace-side, no en el contrato del motor) agregar un mapa:

```typescript
// En TrayInput (src/tray/model.ts):
excepciones_conexion?: Record<string, {
  motivo: string;
  confirmado_por: string;   // "proyectista" por ahora; extender a email/nombre si se necesita
  fecha_iso: string;
}>;
```

La clave es `conexion_id`. Este campo es transparente al motor (no forma parte del payload de `Solicitud`) y se persiste en el archivo de proyecto (`.bdt`/JSON).

Al exportar, el campo acompañaa cada conexión excepcional.
Al importar, si la conexión sigue existiendo en CONEXIONES y el campo está presente, la UI puede mostrar el badge "⚠ Excepción: {motivo}".

### Qué muestra el diagnóstico del motor
El motor Python seguirá reportando la incompatibilidad en su respuesta.
La UI **muestra ese diagnóstico** junto al motivo del usuario — no lo suprime.
En la vista de resultados (`TrayResults`) se puede mostrar:

```
⚠ CON-007 — sin compatibilidad documentada
  Motivo registrado por proyectista: "Transición de familia aprobada por SAMSON REF-2026-04"
```

---

## Cambios de contrato necesarios

Ninguno en el contrato del motor (versión 0.2.2).
El campo `excepciones_conexion` vive en el modelo de workspace (`TrayInput`), no en `Solicitud`.
El esquema de archivo `.bdt` necesita actualización para incluir ese campo (es compatible hacia atrás: si falta, es vacío).

---

## Criterios de aceptación (para implementación futura)

1. El selector de productos nunca bloquea al usuario — siempre puede llegar a "todos los productos".
2. No se puede confirmar una conexión incompatible sin un motivo escrito.
3. El motor sigue recibiendo la misma entrada que hoy — sin cambios de contrato.
4. El motivo persiste en export/import. Al reimportar, la conexión muestra el badge de excepción.
5. Los tests unitarios de `commitDirect` verifican que si `compat.ok === false` y no hay excepción registrada, el commit se bloquea; si hay excepción con motivo, el commit pasa.

---

## Inconsistencias de catálogo relevantes (auditoría 2026-11-05)

| Problema | Detalle |
|---|---|
| SAM-STE-G ↔ SAM-STE-Z | 0 entradas directas en 4 373 COMPATIBILIDADES, misma `interfaz_conexion`. En obra combinadas con soportes (APL-002, APL-006, REV-032). |
| SAM-STP-ZN ↔ otras familias | 0 entradas directas. Misma geometría que SAM-STP-Z (REV-034). |
| Acabado en 3 familias | GEN-FERR, SAM-ESC-TRL, SAM-SMT-ACC tienen `acabado_normalizado = null`. |

Estos casos son candidatos naturales para el flujo de elección excepcional.
No se propone modificar el catálogo masivamente; cada caso debería documentarse con motivo antes de conectar en obra.
