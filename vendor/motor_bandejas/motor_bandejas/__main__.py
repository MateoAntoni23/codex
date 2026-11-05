"""CLI mínima (frontera de integración por JSON).

    python3 -m motor_bandejas calcular <entrada.json>     → resultado JSON por stdout (exit 0)
    python3 -m motor_bandejas cables [filtro]             → lista de cable_id disponibles

Errores de entrada o de datos (catálogo inválido) → JSON {"error": {...}} por stdout y exit 1.
La salida es JSON estricto: nunca contiene NaN ni Infinity (json.dumps con allow_nan=False).
"""
from __future__ import annotations

import json
import sys

from .errores import ErrorMotor
from .motor import calcular_sector, cargar_contexto


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1, allow_nan=False)


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in ("calcular", "cables"):
        print(__doc__)
        return 2
    try:
        cables, catalogo, decisiones = cargar_contexto()
    except ErrorMotor as e:
        print(_json({"error": e.como_dict()}))
        return 1
    if argv[1] == "cables":
        filtro = argv[2] if len(argv) > 2 else ""
        for cid, c in sorted(cables.cables.items()):
            if filtro in cid:
                print(f"{cid}\tD={c.diametro_exterior_mm} mm\tm={c.masa_kg_km} kg/km\tp.{c.fuente['pagina']}")
        return 0
    if len(argv) != 3:
        print(__doc__)
        return 2
    with open(argv[2], encoding="utf-8") as f:
        entrada = json.load(f)
    try:
        res = calcular_sector(entrada, cables, catalogo, decisiones)
    except ErrorMotor as e:
        print(_json({"error": e.como_dict()}))
        return 1
    print(_json(res))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
