# Contrato de integración con el CAD (motor_bandejas/1.0)

## Estado de partida

El editor CAD (React/TypeScript, Three.js, Zustand) **no estuvo disponible**: GitHub no está vinculado en esta sesión. La frontera se define sin ver el store ni los componentes. Al adaptar se debe revisar: cómo el editor identifica sectores y trazados, cómo nombra los puertos y qué sistema de coordenadas usa.

## Frontera propuesta: servicio Python con contrato JSON

> **Estado (v0.2.1):** propuesta para revisión. La arquitectura definitiva la decide el auditor/desarrollador de la arquitectura. Cualquier port (TS, Pyodide) debe pasar los vectores de `integracion/vectores/` con paridad exacta antes de reemplazar al motor Python.

```
CAD (navegador) ──POST /v1/calcular──► motor_bandejas.servicio (Python, 127.0.0.1)
       ▲                                   │ procesar(solicitud) → respuesta
       └──────── respuesta JSON ◄──────────┘
```

**Por qué servicio y no navegador (por ahora)**
- Es una sola implementación de fórmulas y decisiones, con las 142 pruebas existentes. No hay conversión entre lenguajes.
- El catálogo (snapshot de 3,9 MB) y los datasets de cables se cargan una vez, con su hash.
- El motor solo usa la biblioteca estándar.

**Alternativa evaluada: Pyodide (CPython en WebAssembly) dentro de un Web Worker.** No la probé: el entorno no tiene acceso al CDN ni al registro de npm.
- Ventajas: el mismo código Python corre en el navegador, sin servidor. `contrato.procesar` no depende de `http.server`.
- Costos: descarga del intérprete (del orden de 10 MB) y arranque de varios segundos, además del snapshot de 3,9 MB. La actualización del catálogo pasa a ser un asunto de despliegue del frontend.
- Requisito si se adopta: mismos vectores de `integracion/vectores/` y mismas pruebas.

**Port a TypeScript: no recomendado sin paridad.** Si se hace, debe reproducir byte a byte las respuestas de `integracion/vectores/` (`herramientas/generar_vectores.py --verificar`) antes de reemplazar al servicio. Hoy el cliente TS **no** contiene fórmulas.

## Solicitud

```json
{"version_contrato": "1.0", "tipo": "trazado", "solicitud_id": "cad-42", "clave": "TRAZADO-NAVE-2",
 "revision_entrada": 17, "entrada": { ... contrato trazado/1 ... }}
```

| Campo | Regla |
|---|---|
| `clave` | Id estable del sector o trazado en el CAD. Los resultados se relacionan con la clave, y dentro del resultado con `instancia_id`, `conexion_id`, `circuito_id`, `soporte_id`, `conductor_id` y `punto_id` |
| `revision_entrada` | Contador monotónico por clave. Se incrementa ante **cualquier** cambio: trazado, piezas, cables, soportes, tapas, PE o puntos equipotenciales |
| `solicitud_id` | Único por envío |

Esquema formal: `docs/esquemas/contrato-1.0.schema.json` (draft 2020-12). Definiciones: `Solicitud`, `Respuesta`, `Error`, `EntradaSector` y `EntradaTrazado`.

## Respuesta

- **ok:** eco (`version_contrato`, `version_motor`, `tipo`, `solicitud_id`, `clave`, `revision_entrada`) + `estado: "ok"` + `huella` + `resultado`.
- **error:** eco + `estado: "error"` + `error {codigo, mensaje, campo, decision_id?, problemas?, version_error: "1"}`. Códigos: `CONTRATO_INVALIDO`, `VERSION_CONTRATO_NO_SOPORTADA`, `ENTRADA_INVALIDA`, `DATO_FALTANTE`, `PENDIENTE_DECISION`, `NO_SOPORTADO`, `CATALOGO_INVALIDO`, `JSON_INVALIDO`.
- La salida es JSON estricto: nunca contiene NaN ni Infinity.

## Respuestas asíncronas y vigencia (`integracion/ts/gestorSolicitudes.ts`)

1. Cada cambio de entrada → `invalidar(clave)` o un nuevo `calcular(...)`. Ambos incrementan la revisión.
2. Una respuesta se aplica solo si su `solicitud_id` y su `revision_entrada` son los últimos emitidos para esa clave. Las demás se descartan (`revision_antigua`, `solicitud_reemplazada`, `clave_invalidada`).
3. Se rechazan las respuestas con otra versión de contrato o con eco inconsistente, por ejemplo si la huella del sobre no coincide con la del resultado.
4. (v0.2.2) Toda respuesta se valida **en tiempo de ejecución** (`validarSobre`) antes de usarla: `estado` ∈ {ok, error}; eco con `tipo`, `clave`, `solicitud_id` y `revision_entrada` entera ≥ 0; si es ok, `huella` y `resultado` objeto; si es error, objeto `error` con `codigo`, `mensaje` y `version_error`. Lo que no cumple se rechaza como `respuesta_malformada`, sin lanzar excepciones.
5. (v0.2.2) El `tipo` del eco debe ser el de la solicitud vigente: una respuesta `sector` nunca se aplica a una solicitud `trazado` (`eco_inconsistente`).

## Controles del servicio local (v0.2.2)

Pensados para un servicio privado del puesto de trabajo. La arquitectura definitiva la decide el auditor.

| Control | Respuesta si falla |
|---|---|
| Escucha solo en `127.0.0.1` | — |
| `Host` = `127.0.0.1:<puerto>` o `localhost:<puerto>` (defensa contra DNS rebinding) | 403 `HOST_NO_PERMITIDO` |
| `Origin`, si viene, igual a `--origen-permitido` (sin comodines). Sin origen configurado se rechaza todo `Origin` | 403 `ORIGEN_NO_PERMITIDO` |
| CORS solo para ese origen (`Vary: Origin`); preflight solo para ese origen | 403 |
| POST con `Content-Type: application/json` (bloquea peticiones "simples" sin preflight) | 415 `CONTENT_TYPE_NO_SOPORTADO` |
| `Content-Length` presente, entero ≥ 0 y ≤ 5 MiB | 411 / 400 `CONTENT_LENGTH_INVALIDO` / 413 |
| Cuerpo UTF-8 estricto y JSON | 400 `CODIFICACION_INVALIDA` / `JSON_INVALIDO` |
| Cualquier excepción no prevista | 500 `ERROR_INTERNO` (JSON, sin detalles internos) |

Todas las respuestas de error tienen el mismo formato versionado (`estado: "error"`, `error.codigo`, `version_error: "1"`). **Sin autenticación:** un proceso local que no envía `Origin` puede llamar al servicio. Si el despliegue lo requiere (máquina compartida), agregar un token por sesión: pendiente de la decisión de arquitectura.
4. En el store: al invalidar, marcar el resultado como `DESACTUALIZADO` y **borrar la selección** asociada.

## Longitudes y vanos (no confundir)

| Magnitud | Origen |
|---|---|
| `vano_mm` (sector) | Luz entre apoyos con la que se busca la CTA |
| Vanos del trazado | Distancias entre soportes consecutivos de cada corrida recta, calculadas por el motor |
| `longitud_mm` | Largo de cada tramo recto (≤ longitud comercial) |
| `longitud_eje_mm` | Largo de eje de piezas especiales, calculado por el CAD. Solo se usa para la longitud del PE |
| Longitud del recorrido de un cable | No se usa como vano |

## Presentación (`integracion/ts/presentacion.ts`)

- `esAprobacion` es siempre `false`. Ningún estado se rotula como "aprobado".
- `PRESELECCION_CONDICIONADA` se muestra con sus `condiciones`. `CON_BLOQUEOS` muestra las decisiones que bloquean.
- No se permite seleccionar con `vigencia ≠ VIGENTE`.
- `verificacion_electrica.estado` es siempre `NO_REALIZADA`. Los estados equipotenciales de diseño y de campo se muestran tal cual, sin resumirlos en un "cumple".

## Ejecución

```bash
python3 -m motor_bandejas.servicio --puerto 8765 --origen-permitido http://localhost:5173
node --experimental-strip-types --test integracion/ts/gestorSolicitudes.test.ts integracion/ts/auditoria_v021.test.ts
cd integracion/ts && npm install && npm run verificar-tipos     # requiere acceso a npm
```
