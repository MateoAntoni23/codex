"""Genera vectores de integración (solicitud → respuesta) desde el motor Python.

Uso: python3 herramientas/generar_vectores.py [--verificar]
Con --verificar no escribe: compara contra los archivos existentes y falla si difieren (prueba de paridad).
Un eventual port a TypeScript debe producir las mismas respuestas para estas solicitudes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from motor_bandejas.contrato import VERSION_CONTRATO, procesar  # noqa: E402
from motor_bandejas.motor import cargar_contexto, cargar_contexto_trazado  # noqa: E402

DIR = RAIZ / "integracion" / "vectores"


def solicitudes():
    caso1 = json.loads((RAIZ / "ejemplos" / "caso1_4_separados.json").read_text(encoding="utf-8"))
    traz = json.loads((RAIZ / "ejemplos" / "trazado_derivacion_pe.json").read_text(encoding="utf-8"))
    malo = json.loads(json.dumps(caso1))
    malo["usos_cable"][0]["cantidad"] = 0
    base = {"version_contrato": VERSION_CONTRATO}
    return {
        "sector_caso1": {**base, "tipo": "sector", "solicitud_id": "v-1", "clave": "SECTOR-1", "revision_entrada": 0, "entrada": caso1},
        "sector_error_cantidad": {**base, "tipo": "sector", "solicitud_id": "v-2", "clave": "SECTOR-1", "revision_entrada": 1, "entrada": malo},
        "trazado_ejemplo": {**base, "tipo": "trazado", "solicitud_id": "v-3", "clave": "TRAZADO-1", "revision_entrada": 0, "entrada": traz},
    }


def main(verificar: bool) -> int:
    cs, ct = cargar_contexto(), cargar_contexto_trazado()
    DIR.mkdir(parents=True, exist_ok=True)
    distintos = []
    for nombre, sol in solicitudes().items():
        vec = {"descripcion": f"Vector {nombre} (generado por herramientas/generar_vectores.py)",
               "solicitud": sol, "respuesta": procesar(sol, cs, ct)}
        txt = json.dumps(vec, ensure_ascii=False, allow_nan=False, indent=1, sort_keys=True)
        ruta = DIR / f"{nombre}.json"
        if verificar:
            if not ruta.exists() or ruta.read_text(encoding="utf-8") != txt:
                distintos.append(nombre)
        else:
            ruta.write_text(txt, encoding="utf-8")
    if distintos:
        print("Vectores desactualizados:", distintos)
        return 1
    print("Vectores OK" if verificar else f"Vectores escritos en {DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main("--verificar" in sys.argv))
