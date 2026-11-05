"""Unidades y conversiones explícitas.

Convenciones del motor (coinciden con el catálogo Excel: sufijos _mm, _kg y columna de unidad de carga):
- Longitudes geométricas (diámetros, anchos, alas, vanos): mm.
- Masa lineal de cables y carga de trabajo admisible (CTA): kg/m.
  La CTA del catálogo se publica en "kg/m" (kgf/m en la práctica); se compara contra la masa lineal de los
  cables expresada en la misma unidad, sin pasar por N/m.
- Las fichas de cables publican masa en kg/km: se convierte UNA vez, al cargar, con kg_km_a_kg_m().
- Porcentajes de entrada: valor en % (20 = 20 %). Internamente se usa la fracción.
"""
from __future__ import annotations

import math

from .errores import DatoFaltante, ErrorEntrada

# Tolerancia para comparaciones de igualdad en mm y kg/m (evita rechazar por ruido de coma flotante en un borde
# exacto; ej. 0,1 + 0,2). Es 6 órdenes de magnitud menor que la resolución de cualquier dato de fabricante.
EPS = 1e-9


def numero_finito(valor, *, campo: str, error=ErrorEntrada) -> float:
    """Devuelve float si `valor` es int/float finito (no bool). Rechaza None, bool, str, NaN, inf."""
    if valor is None:
        raise DatoFaltante(f"Falta el dato '{campo}'.", campo=campo)
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        raise error(f"'{campo}' debe ser numérico; se recibió {type(valor).__name__}: {valor!r}.", campo=campo)
    x = float(valor)
    if not math.isfinite(x):
        raise error(f"'{campo}' no es finito: {valor!r}.", campo=campo)
    return x


def positivo(valor, *, campo: str, error=ErrorEntrada) -> float:
    x = numero_finito(valor, campo=campo, error=error)
    if x <= 0:
        raise error(f"'{campo}' debe ser > 0; se recibió {valor!r}.", campo=campo)
    return x


def entero_positivo(valor, *, campo: str) -> int:
    """Cantidades: solo int > 0. Se rechazan bool, float (aunque sea 4.0) y str ('4')."""
    if isinstance(valor, bool) or not isinstance(valor, int):
        raise ErrorEntrada(
            f"'{campo}' debe ser un entero positivo; se recibió {type(valor).__name__}: {valor!r}.", campo=campo
        )
    if valor < 1:
        raise ErrorEntrada(f"'{campo}' debe ser ≥ 1; se recibió {valor}.", campo=campo)
    return valor


def kg_km_a_kg_m(masa_kg_km, *, campo: str = "masa_kg_km") -> float:
    """1 kg/km = 0,001 kg/m. Rechaza datos faltantes o no positivos (nunca devuelve 0 por defecto)."""
    return positivo(masa_kg_km, campo=campo, error=DatoFaltante) / 1000.0


def pct_a_fraccion(pct, *, campo: str) -> float:
    x = numero_finito(pct, campo=campo)
    if not (0.0 <= x < 100.0):
        raise ErrorEntrada(f"'{campo}' debe estar en [0, 100) %; se recibió {pct!r}.", campo=campo)
    return x / 100.0


def redondear(x: float, decimales: int = 6) -> float:
    """Solo para presentación/serialización: elimina ruido binario (56.699999999 → 56.7)."""
    return round(x + 0.0, decimales)
