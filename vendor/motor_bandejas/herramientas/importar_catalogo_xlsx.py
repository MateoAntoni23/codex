"""Importa el catálogo Excel de bandejas a un snapshot JSON de solo lectura para el motor.

Uso:
    python3 -I herramientas/importar_catalogo_xlsx.py <catalogo.xlsx> <salida.json>

Qué hace y qué no hace:
- Copia, sin transformar valores, las hojas FUENTES, FAMILIAS, TABLAS_CARGA y las filas de PRODUCTOS
  con tipo_pieza = 'recta' (las únicas que usa el motor en esta etapa).
- Formato 3 (v0.2.0): PRODUCTOS completo y hojas de puertos, compatibilidades, componentes de unión y soportes.
- Exporta además IDS_PRODUCTOS: producto_id y tipo_pieza de TODOS los productos, para que el motor valide
  que cada registro de carga referencia un producto existente (formato 2).
- Conserva el número de fila de origen de cada registro para trazabilidad.
- No completa celdas vacías: una celda vacía se exporta como null (= desconocido), nunca como 0.
- Registra el SHA-256 del archivo de origen. Si el Excel cambia, cambia el snapshot y cambia la huella
  de todo resultado calculado con él (ver motor_bandejas.procedencia).

Requiere openpyxl (solo esta herramienta; el motor no tiene dependencias externas).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import sys

HOJAS_COMPLETAS = ("FUENTES", "FAMILIAS", "TABLAS_CARGA", "PUERTOS_PRODUCTO", "COMPATIBILIDADES", "COMPONENTES_UNION",
                   "SISTEMAS_SOPORTE", "COMPONENTES_SOPORTE", "APLICACIONES_SOPORTE")
TIPOS_PIEZA_EXPORTADOS = ("recta",)


def _sha256(ruta: str) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def _filas(ws):
    encabezado = None
    for n_fila, fila in enumerate(ws.iter_rows(values_only=True), start=1):
        if encabezado is None:
            if fila and fila[0] is not None:
                encabezado = [str(c) if c is not None else None for c in fila]
            continue
        if all(c is None for c in fila):
            continue
        registro = {}
        for clave, valor in zip(encabezado, fila):
            if clave is None:
                continue
            if isinstance(valor, str):
                valor = valor.strip()
                if valor == "":
                    valor = None
            registro[clave] = valor
        registro["_fila_origen"] = n_fila
        yield registro


def importar(ruta_xlsx: str) -> dict:
    import openpyxl  # importación diferida: el motor no depende de openpyxl

    wb = openpyxl.load_workbook(ruta_xlsx, read_only=True, data_only=True)
    snapshot = {
        "tipo": "snapshot_catalogo_bandejas",
        "version_formato": "3",
        "origen": {
            "archivo": ruta_xlsx.rsplit("/", 1)[-1],
            "sha256": _sha256(ruta_xlsx),
            "importado_utc": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
            "hojas_exportadas": list(HOJAS_COMPLETAS) + ["PRODUCTOS", "IDS_PRODUCTOS"],
        },
    }
    for hoja in HOJAS_COMPLETAS:
        snapshot[hoja] = list(_filas(wb[hoja]))
    todos = list(_filas(wb["PRODUCTOS"]))
    snapshot["PRODUCTOS"] = todos  # formato 3: todas las piezas (el motor filtra las seleccionables)
    snapshot["IDS_PRODUCTOS"] = [
        {"producto_id": r.get("producto_id"), "tipo_pieza": r.get("tipo_pieza"), "_fila_origen": r["_fila_origen"]}
        for r in todos
    ]
    wb.close()
    return snapshot


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    snap = importar(argv[1])
    with open(argv[2], "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(
        "Snapshot escrito: %s | %s | sha256 origen=%s"
        % (argv[2], " ".join(f"{k}={len(v)}" for k, v in snap.items() if isinstance(v, list)), snap["origen"]["sha256"])
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
