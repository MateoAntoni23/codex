# motor_bandejas v0.2.2

Cambios: ver `CHANGELOG.md`. Desde v0.2.0 el motor también calcula **trazados completos**: piezas especiales, ramales, soportes, cómputo, PE y red equipotencial (`motor_bandejas/trazado.py`, contrato `trazado/1`). Hay además un servicio HTTP y un cliente TypeScript (ver `docs/CONTRATO_INTEGRACION.md`). El ejemplo completo está en `docs/EJEMPLO_TRAZADO.md`. Verificación del snapshot contra el Excel: `python3 herramientas/verificar_snapshot.py`.

Motor de cálculo independiente para bandejas portacables, pensado para integrarse a la aplicación CAD 3D. No tiene UI ni renderizado. La frontera de integración es un dict/JSON.

**Calcula**
1. Masa lineal de los cables [kg/m].
2. Disposición en una capa y ancho ocupado [mm]: contacto, o separado con g = D.
3. Reserva de espacio, con denominador explícito.
4. Preselección de tramos rectos del catálogo del proyecto por geometría y por capacidad mecánica registrada para la misma luz. Indica explícitamente qué está documentado y qué es condicional.

**No calcula:** intensidad admisible ni ninguna verificación eléctrica (`verificacion_electrica.estado = "NO_REALIZADA"` en todo resultado), accesorios ni soportes.

## Uso

```bash
python3 -m motor_bandejas calcular ejemplos/caso1_4_separados.json   # resultado JSON
python3 -m motor_bandejas cables CU-1x                               # ids de cable disponibles
cd pruebas && python3 -m unittest discover -p 'test_*.py'            # 135 pruebas (78 de v0.1.1 sin cambios)
node --experimental-strip-types --test integracion/ts/gestorSolicitudes.test.ts   # 7 pruebas del cliente TS
python3 -m motor_bandejas.servicio --puerto 8765                     # servicio local (contrato 1.0)
python3 herramientas/generar_vectores.py --verificar                 # paridad de vectores
python3 herramientas/resumen_ejemplo.py                              # regenera docs/EJEMPLO_TRAZADO.md
python3 herramientas/comparar_samet.py                               # regenera docs/COMPARACION_SAMET.md
python3 -I herramientas/importar_catalogo_xlsx.py <catalogo.xlsx> datos/catalogo/catalogo_bandejas_snapshot.json
```

Trazado (desde código):
```python
from motor_bandejas.motor import cargar_contexto_trazado
from motor_bandejas.trazado import calcular_trazado, SesionTrazado
cab, cat, dec = cargar_contexto_trazado()
r = calcular_trazado(json.load(open("ejemplos/trazado_derivacion_pe.json")), cab, cat, dec)
r["resumen"]["estado_trazado"]   # 'CON_BLOQUEOS' (D-19 pendiente) – nunca una aprobación
```

Se usa Python ≥ 3.10 con solo la biblioteca estándar. El importador del Excel necesita `openpyxl`.

Desde código:
```python
from motor_bandejas.motor import cargar_contexto, calcular_sector
from motor_bandejas.sesion import SesionSector
cables, catalogo, decisiones = cargar_contexto()
s = SesionSector(cables, catalogo, decisiones, entrada)
r = s.calcular(); s.seleccionar("SAM_TRES-150-065-18-Z")
s.modificar_uso(0, cantidad=8)   # → resultado DESACTUALIZADO y selección borrada
```

## Entrada

```json
{
  "tipo_circuito": "potencia",
  "vano_mm": 1500,
  "reserva_solicitada_pct": 20,
  "usos_cable": [{"cable_id": "PRY-SVALIO-CU-1x6", "cantidad": 4, "separado": true, "apilado": false}],
  "familias": ["SAM-STE-Z"],
  "criterio_reserva": "fraccion_libre_ancho_bandeja"
}
```
`familias` y `criterio_reserva` son opcionales. Las claves desconocidas, las cantidades no enteras o ≤ 0, `separado` faltante y cualquier dato físico faltante se **rechazan**. Nunca se completan con cero.

## Resultado (claves principales)

| Clave | Contenido |
|---|---|
| `huella` | SHA-256 de entrada normalizada + **hash del contenido efectivo** de cables y catálogo (incluye derivaciones) + Excel de origen + decisiones + versión del motor |
| `vigencia` | `VIGENTE` / `DESACTUALIZADO`. `SesionSector` la revalida contra la huella en cada acceso y selección |
| `estado_calculo` | `CALCULADO` o `BLOQUEADO` (con `bloqueo.decision_id`) |
| `masa_lineal` | q [kg/m], detalle por cable con documento, edición, página y fila |
| `disposicion` | modo, ancho ocupado, hueco, paso entre centros y fórmula |
| `candidatos[]` | por tramo recto: `geometria` (reserva con ambas métricas, base útil/nominal), `mecanica` (estado, `base_evidencia`, CTA, registro con `derivacion` si aplica, `esquema_ensayo_contrastado`), `estado`, `condiciones[]` y banderas de mínimo por línea |
| `resumen_por_linea[]` | por familia + ala + espesor: mínimo geométrico, mínimo sin rechazo (con sus condiciones) y mínimo apto completo |
| `datos`, `decisiones` | hashes de origen y decisiones aplicadas |
| `verificacion_electrica` | siempre `NO_REALIZADA` |

Estados de candidato:
- `APTA_GEOMETRIA_Y_MECANICA`: ancho y alto **útiles** publicados, reserva cumplida y CTA **documentada** a la misma luz que cubre la carga. Sin condiciones.
- `PRESELECCION_CONDICIONADA`: no se detectó incumplimiento, pero hay `condiciones` (`ANCHO_NOMINAL_NO_UTIL`, `ALTURA_ALA_NOMINAL_NO_UTIL`, `CTA_ADOPTADA_POR_DECISION:<id>`, `CTA_VALIDADA_POR_USUARIO`, `MECANICA_NO_VERIFICABLE_*`).
- `NO_APTA_MECANICA`, `NO_APTA_GEOMETRIA`, `NO_VERIFICABLE_GEOMETRIA`.

Con el catálogo actual (sin medidas útiles) ningún tramo llega a `APTA_GEOMETRIA_Y_MECANICA`. Es el resultado esperado, no un error.

Estados mecánicos: `VERIFICADA_CUMPLE` / `VERIFICADA_NO_CUMPLE` (CTA documentada), `CUMPLE_CONDICIONADO` / `NO_CUMPLE_CONDICIONADO` (CTA adoptada o validada por usuario) y `NO_VERIFICABLE_*`.

## Datos de entrada del motor

- `datos/catalogo/catalogo_bandejas_snapshot.json`: exportación del Excel con el importador (formato 2, incluye `IDS_PRODUCTOS`). Al cargarlo se valida que las medidas y cargas presentes sean finitas y > 0, que no haya ids duplicados y que las referencias a familias, fuentes y productos existan. Ante cualquier problema se lanza `CatalogoInvalido` con hoja, fila, id y columna. Una celda vacía sigue significando "desconocido".
- `datos/catalogo/cargas_derivadas.json`: registros de carga que combinan fuentes por decisión del usuario (DER-001 / REV-020). Si el snapshot deja de coincidir con lo esperado, la carga del catálogo falla.
- Los objetos de datos son inmutables. La salida JSON es estricta (sin NaN ni Infinity).

## Estructura

```
motor_bandejas/   calculos.py (reglas) · motor.py (validación y orquestación) · sesion.py (invalidación)
                  datos_cables.py · catalogo.py · unidades.py · procedencia.py · errores.py
datos/            cables/ (Prysmian, transcripto con página) · catalogo/ (snapshot del Excel) · decisiones_producto.json
docs/             MATRIZ_FUENTES · DECISIONES · SAMET_ANALISIS · COMPARACION_SAMET · PENDIENTES · CONTRATO_INTEGRACION · EJEMPLO_TRAZADO · esquemas/
                  trazado_entrada.py · trazado_analisis.py · trazado.py · soportes.py · computo.py · equipotencial.py
                  contrato.py · servicio.py
integracion/      ts/ (cliente TypeScript, sin fórmulas) · vectores/ (solicitud→respuesta para paridad)
pruebas/          v0.1.1 (78, sin cambios) · test_trazado (47) · test_integracion (10)
ejemplos/         los tres casos observados en Samet como entradas
```
