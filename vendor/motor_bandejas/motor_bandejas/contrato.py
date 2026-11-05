"""Sobre de integración versionado (contrato `motor_bandejas/1.0`).

Solicitud:
  {"version_contrato": "1.0", "tipo": "sector" | "trazado", "solicitud_id": str, "clave": str,
   "revision_entrada": int >= 0, "entrada": {...}}
  - `clave` identifica el sector o trazado del CAD; `revision_entrada` es el contador de revisiones de esa clave.
    El cliente descarta toda respuesta cuya revisión no sea la última que pidió para esa clave.
Respuesta (siempre JSON estricto, sin NaN/Infinity):
  ok:    {..eco.., "estado": "ok", "huella": str, "resultado": {...}}
  error: {..eco.., "estado": "error", "error": {"codigo", "mensaje", "campo", "decision_id"?, "version_error": "1"}}

`vano_mm` (sector) es la luz entre apoyos; NO es la longitud del recorrido. En trazados, los vanos salen de las
posiciones de los soportes y la longitud del PE de las longitudes de eje.
"""
from __future__ import annotations

import json

from . import __version__
from .errores import ErrorMotor
from .motor import calcular_sector
from .trazado import calcular_trazado

VERSION_CONTRATO = "1.0"
VERSION_ERROR = "1"
TIPOS = ("sector", "trazado")


def _eco(sol: dict) -> dict:
    return {"version_contrato": VERSION_CONTRATO, "version_motor": __version__,
            **{k: sol.get(k) for k in ("tipo", "solicitud_id", "clave", "revision_entrada")}}


def _error(sol, codigo, mensaje, campo=None, extra=None) -> dict:
    err = {"codigo": codigo, "mensaje": mensaje, "campo": campo, "version_error": VERSION_ERROR}
    err.update(extra or {})
    return {**_eco(sol if isinstance(sol, dict) else {}), "estado": "error", "error": err}


def error_de_transporte(codigo: str, mensaje: str) -> dict:
    """Error previo a leer la solicitud (HTTP): sin eco, mismo formato de error versionado."""
    return _error({}, codigo, mensaje)


def procesar(sol, contexto_sector, contexto_trazado) -> dict:
    if not isinstance(sol, dict):
        return _error({}, "CONTRATO_INVALIDO", "La solicitud debe ser un objeto JSON.")
    if sol.get("version_contrato") != VERSION_CONTRATO:
        return _error(sol, "VERSION_CONTRATO_NO_SOPORTADA",
                      f"Se esperaba version_contrato '{VERSION_CONTRATO}'.", "version_contrato")
    extra = set(sol) - {"version_contrato", "tipo", "solicitud_id", "clave", "revision_entrada", "entrada"}
    if extra:
        return _error(sol, "CONTRATO_INVALIDO", f"Claves desconocidas: {sorted(extra)}.")
    if sol.get("tipo") not in TIPOS:
        return _error(sol, "CONTRATO_INVALIDO", f"tipo debe ser uno de {TIPOS}.", "tipo")
    for k in ("solicitud_id", "clave"):
        if not isinstance(sol.get(k), str) or not sol[k]:
            return _error(sol, "CONTRATO_INVALIDO", f"{k} debe ser texto no vacío.", k)
    rev = sol.get("revision_entrada")
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 0:
        return _error(sol, "CONTRATO_INVALIDO", "revision_entrada debe ser un entero ≥ 0.", "revision_entrada")
    if not isinstance(sol.get("entrada"), dict):
        return _error(sol, "CONTRATO_INVALIDO", "entrada debe ser un objeto.", "entrada")
    try:
        if sol["tipo"] == "sector":
            res = calcular_sector(sol["entrada"], *contexto_sector)
        else:
            res = calcular_trazado(sol["entrada"], *contexto_trazado)
    except ErrorMotor as e:
        d = e.como_dict()
        return _error(sol, d.pop("codigo"), d.pop("mensaje"), d.pop("campo", None), d)
    return {**_eco(sol), "estado": "ok", "huella": res["huella"], "resultado": res}


def a_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, allow_nan=False)
