# Esquemas de datos internos

## Snapshot del catálogo – formato 3 (`datos/catalogo/catalogo_bandejas_snapshot.json`)

Lo genera `herramientas/importar_catalogo_xlsx.py` sin transformar valores. Cada fila conserva `_fila_origen`.

| Clave | Contenido | Validación al cargar (`Catalogo.desde_dict`) |
|---|---|---|
| `origen` | archivo, `sha256` del Excel, `importado_utc` | Metadato; la fecha queda fuera de la huella |
| `FUENTES`, `FAMILIAS` | Hojas completas | Ids únicos |
| `PRODUCTOS` | Todas las piezas (formato 3) | Medidas, ángulo, radio, longitud, envase y peso: si están presentes, finitos y > 0; ángulo ≤ 360; `referencia_radio` ∈ {interior, eje, exterior, no especificado}; radio sin referencia → error |
| `IDS_PRODUCTOS` | producto_id y tipo_pieza de todo el catálogo | Unicidad; referencias de cargas |
| `PUERTOS_PRODUCTO` | Bocas por pieza (ancho, ala, interfaz) | Pieza existente; ids únicos |
| `COMPATIBILIDADES` | Pares de puertos o productos con evidencia | Productos y puertos existentes |
| `COMPONENTES_UNION` | Artículos por compatibilidad | Compatibilidad y producto existentes; cantidad > 0 o vacía |
| `TABLAS_CARGA` | CTA por producto y luz | v0.1.1 + curación de valores derivados (`cargas_derivadas.json`) |
| `SISTEMAS_SOPORTE`, `COMPONENTES_SOPORTE`, `APLICACIONES_SOPORTE` | Sistemas, piezas y rangos de aplicación | Referencias; rango de ancho > 0 |

Cualquier problema genera `CatalogoInvalido` con hoja, fila, id y columna. Una celda vacía significa "desconocido", nunca 0.

## Dataset de cables (`datos/cables/*.json`)

```json
{"dataset_id": "...", "unidades": {"diametro_exterior": "mm", "masa": "kg/km"},
 "documento": {"titulo", "archivo", "sha256_archivo", "edicion", "url_publicada"},
 "transcripcion": {"metodo", "fecha", "estado"},
 "tablas": [{"material", "n_conductores", "tipo", "pagina", "titulo_tabla",
             "columnas": ["formacion", "diametro_exterior_mm", "masa_kg_km"], "filas": [[...]],
             "colores": [...], "condiciones_empleo": [...],
             "radio_minimo": {"estado": "no publicado" | "publicado",
                              "registros": [{"condicion": "...", "multiplo_D" | "valor_mm": x,
                                             "referencia": "eje_cable" | "intrados_cable" | "no especificada",
                                             "fuente": "..."}]},
             "anomalias_fuente": {"<formacion>": "..."}}]}
```

Los datos físicos faltantes se rechazan. El radio mínimo exige condición y referencia, y nunca se deduce de la sección.
