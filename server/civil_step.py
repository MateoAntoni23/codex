"""Conversión de STEP 3D a una malla liviana para la parte civil de la planta.

Se usa UNA vez, al importar: la app guarda la malla y no vuelve a leer el STEP.
Triangulación gruesa (lo civil es contexto, no fabricación) y todos los sólidos
del archivo en una sola malla. No deduce nada de la geometría ni de los nombres
internos del STEP: el tipo y el nivel los declara el operador en la app.

Salida (JSON):
  - unidades: lo que declara el encabezado del STEP (la lectura de OpenCascade
    convierte siempre a milímetros, que es lo que devuelve la malla);
  - solidos, triangulos, vertices;
  - caja_mm: caja envolvente en los ejes DEL ARCHIVO (sin girar): min y max;
  - posiciones (float32 little-endian, base64) e indices (uint32 little-endian,
    base64): la malla en mm, en los ejes del archivo. El eje vertical lo elige el
    operador en la app.

CadQuery se importa recién al convertir (tarda unos segundos): el motor arranca
sin esperarlo y, si no está instalado, sólo esta ruta falla, con su motivo.
"""
from __future__ import annotations

import base64
import math
import os
import re
import struct
import tempfile

# Tolerancias de triangulación: gruesas a propósito. La lineal escala con el tamaño
# del modelo (0,5 % de la diagonal, mínimo 2 mm); la angular, 0,5 rad (~29°).
TOL_LINEAL_RELATIVA = 0.005
TOL_LINEAL_MIN_MM = 2.0
TOL_ANGULAR_RAD = 0.5

_UNIDADES_SI = {
    '$': ('m', 'metro'),
    '.MILLI.': ('mm', 'milímetro'),
    '.CENTI.': ('cm', 'centímetro'),
    '.DECI.': ('dm', 'decímetro'),
    '.KILO.': ('km', 'kilómetro'),
    '.MICRO.': ('um', 'micrómetro'),
}
_UNIDADES_CONVERTIDAS = {
    'INCH': ('in', 'pulgada'),
    'FOOT': ('ft', 'pie'),
    'MILLIMETRE': ('mm', 'milímetro'),
    'METRE': ('m', 'metro'),
}


class ErrorConversion(Exception):
    """Error con motivo para la persona (no es un error interno)."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


def leer_unidades(texto: str) -> dict:
    """Unidad de longitud que declara el STEP (sección DATA), sin convertir nada."""
    # Unidad convertida (pulgadas, pies…): CONVERSION_BASED_UNIT('INCH', …) junto a LENGTH_UNIT.
    for m in re.finditer(r"LENGTH_UNIT\s*\(\s*\)[^;]*?CONVERSION_BASED_UNIT\s*\(\s*'([^']+)'", texto, re.S | re.I):
        nombre = m.group(1).strip().upper()
        codigo, txt = _UNIDADES_CONVERTIDAS.get(nombre, ('desconocida', nombre.lower()))
        return {'codigo': codigo, 'texto': f"{txt} (CONVERSION_BASED_UNIT '{m.group(1)}')"}
    for m in re.finditer(r"CONVERSION_BASED_UNIT\s*\(\s*'([^']+)'[^;]*?LENGTH_UNIT", texto, re.S | re.I):
        nombre = m.group(1).strip().upper()
        codigo, txt = _UNIDADES_CONVERTIDAS.get(nombre, ('desconocida', nombre.lower()))
        return {'codigo': codigo, 'texto': f"{txt} (CONVERSION_BASED_UNIT '{m.group(1)}')"}
    # Unidad SI: (… LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) …)
    m = re.search(r"LENGTH_UNIT\s*\(\s*\)[^;]*?SI_UNIT\s*\(\s*(\$|\.\w+\.)\s*,\s*\.METRE\.\s*\)", texto, re.S | re.I)
    if not m:
        m = re.search(r"SI_UNIT\s*\(\s*(\$|\.\w+\.)\s*,\s*\.METRE\.\s*\)[^;]*?LENGTH_UNIT", texto, re.S | re.I)
    if m:
        pref = m.group(1).upper()
        codigo, txt = _UNIDADES_SI.get(pref, ('desconocida', pref))
        return {'codigo': codigo, 'texto': f"{txt} (SI_UNIT {pref} .METRE.)"}
    return {'codigo': 'desconocida', 'texto': 'el STEP no declara la unidad de longitud'}


def convertir_step(datos: bytes) -> dict:
    """Convierte el contenido de un archivo STEP a la malla liviana de la parte civil."""
    if not datos:
        raise ErrorConversion('STEP_VACIO', 'El archivo está vacío.')
    cabeza = datos[:200].lstrip()
    if not cabeza.upper().startswith(b'ISO-10303-21'):
        raise ErrorConversion('NO_ES_STEP', 'El archivo no es un STEP (no empieza con ISO-10303-21).')
    texto = datos.decode('latin-1', errors='replace')
    unidades = leer_unidades(texto)

    try:
        import cadquery as cq  # noqa: WPS433 — import diferido a propósito
    except Exception as e:  # noqa: BLE001
        raise ErrorConversion('CADQUERY_NO_DISPONIBLE', f'El servicio no puede convertir STEP: CadQuery no está disponible en su Python ({e}).') from e

    fd, ruta = tempfile.mkstemp(suffix='.step')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(datos)
        try:
            forma = cq.importers.importStep(ruta).val()
        except Exception as e:  # noqa: BLE001
            raise ErrorConversion('STEP_ILEGIBLE', f'No se pudo leer el STEP: {e}') from e
    finally:
        try:
            os.remove(ruta)
        except OSError:
            pass

    solidos = forma.Solids() if hasattr(forma, 'Solids') else []
    if not solidos:
        raise ErrorConversion('SIN_SOLIDOS', 'El STEP no tiene sólidos: no hay nada que mostrar (¿se exportaron sólo superficies o croquis?).')

    bb = forma.BoundingBox()
    diag = math.sqrt(bb.xlen ** 2 + bb.ylen ** 2 + bb.zlen ** 2)
    tol = max(TOL_LINEAL_MIN_MM, diag * TOL_LINEAL_RELATIVA)

    posiciones: list[float] = []
    indices: list[int] = []
    for s in solidos:
        verts, tris = s.tessellate(tol, TOL_ANGULAR_RAD)
        base = len(posiciones) // 3
        for v in verts:
            posiciones.extend((v.x, v.y, v.z))
        for t in tris:
            indices.extend((base + t[0], base + t[1], base + t[2]))
    if not indices:
        raise ErrorConversion('SIN_TRIANGULOS', 'La triangulación no produjo triángulos.')

    return {
        'version': 'codex:civilMalla/1',
        'unidades': unidades,
        'solidos': len(solidos),
        'vertices': len(posiciones) // 3,
        'triangulos': len(indices) // 3,
        'tolerancia_mm': round(tol, 3),
        'caja_mm': {'min': [bb.xmin, bb.ymin, bb.zmin], 'max': [bb.xmax, bb.ymax, bb.zmax]},
        'posiciones': base64.b64encode(struct.pack(f'<{len(posiciones)}f', *posiciones)).decode('ascii'),
        'indices': base64.b64encode(struct.pack(f'<{len(indices)}I', *indices)).decode('ascii'),
    }
