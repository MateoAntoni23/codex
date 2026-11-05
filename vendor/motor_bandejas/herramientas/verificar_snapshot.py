"""Verifica que el snapshot del catálogo coincida tabla por tabla con el Excel de origen.

    python3 herramientas/verificar_snapshot.py [ruta.xlsx]   (por defecto datos/catalogo/fuente/…_2.xlsx)

Compara el sha256 registrado y cada hoja exportada (filas completas, incluido `_fila_origen`). Sale con 1 ante
cualquier diferencia. Requiere openpyxl (solo esta herramienta; el motor no lo usa).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "herramientas"))

from importar_catalogo_xlsx import importar  # noqa: E402

XLSX_DEFECTO = RAIZ / "datos" / "catalogo" / "fuente" / "Catalogo_Bandejas_y_Accesorios_2.xlsx"
SNAPSHOT = RAIZ / "datos" / "catalogo" / "catalogo_bandejas_snapshot.json"


def verificar(ruta_xlsx: Path):
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    nuevo = json.loads(json.dumps(importar(str(ruta_xlsx)), ensure_ascii=False, sort_keys=True))
    dif = []
    if nuevo["origen"]["sha256"] != snap["origen"]["sha256"]:
        dif.append(f"sha256: Excel {nuevo['origen']['sha256']} ≠ snapshot {snap['origen']['sha256']}")
    tablas = sorted(k for k, v in nuevo.items() if isinstance(v, list))
    for t in tablas:
        if nuevo[t] != snap.get(t):
            n0, n1 = len(snap.get(t) or []), len(nuevo[t])
            dif.append(f"{t}: difiere (snapshot {n0} filas, Excel {n1} filas)")
    faltan = sorted(k for k, v in snap.items() if isinstance(v, list) and k not in nuevo)
    dif += [f"{t}: está en el snapshot y no en el Excel" for t in faltan]
    return dif, tablas


def main(argv):
    ruta = Path(argv[1]) if len(argv) > 1 else XLSX_DEFECTO
    dif, tablas = verificar(ruta)
    if dif:
        print("DIFERENCIAS:\n  " + "\n  ".join(dif))
        return 1
    print(f"Snapshot OK: {len(tablas)} tablas idénticas al Excel ({', '.join(tablas)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
