"""Huella de un cálculo: identifica de forma unívoca entradas + datos + decisiones + versión del motor.

Si cualquiera de esas piezas cambia, cambia la huella y el resultado anterior debe tratarse como
DESACTUALIZADO (no se conservan selecciones viejas, a diferencia de lo observado en Samet).
"""
from __future__ import annotations

import hashlib
import json


def json_canonico(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def huella(*, entrada_normalizada: dict, version_cables: dict, version_catalogo: dict,
           decisiones: dict, version_motor: str) -> str:
    material = {
        "entrada": entrada_normalizada,
        "cables": version_cables,
        "catalogo": version_catalogo,
        "decisiones": decisiones,
        "motor": version_motor,
    }
    return hashlib.sha256(json_canonico(material).encode("utf-8")).hexdigest()
