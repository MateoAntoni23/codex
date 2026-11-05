"""Estado de un sector para integrar con la UI/CAD sin arrastrar resultados viejos.

Reglas (v0.1.1):
- La vigencia se REVALIDA en cada acceso (`vigente()`, `resultado`, `seleccion`, `seleccionar()`) comparando la
  huella guardada con la que producen HOY la entrada, los cables, el catálogo, las decisiones y la versión del
  motor. No se confía en una etiqueta guardada.
- Si algo cambió (entrada, contenido de datos, decisiones —incluida una mutación del dict suministrado— o
  motor), el resultado pasa a DESACTUALIZADO y la selección se borra. No se puede seleccionar sobre él.
- `actualizar_contexto()` permite reemplazar datos o decisiones de forma explícita; también invalida.
(Samet conserva selección y resultados al cambiar entradas; aquí no.)
"""
from __future__ import annotations

import copy

from .errores import ErrorEntrada
from .motor import calcular_sector, resultado_vigente

SELECCIONABLES = ("APTA_GEOMETRIA_Y_MECANICA", "PRESELECCION_CONDICIONADA")


class SesionSector:
    def __init__(self, cables, catalogo, decisiones, entrada: dict | None = None):
        self._cables, self._catalogo, self._decisiones = cables, catalogo, decisiones
        self._entrada = copy.deepcopy(entrada) if entrada is not None else None
        self._resultado: dict | None = None
        self._seleccion: dict | None = None

    # ----------------------------------------------------------------- revalidación central
    def _revalidar(self) -> bool:
        if self._resultado is None:
            self._seleccion = None
            return False
        if self._resultado.get("vigencia") == "VIGENTE" and resultado_vigente(
                self._resultado, self._entrada, self._cables, self._catalogo, self._decisiones):
            return True
        self._resultado["vigencia"] = "DESACTUALIZADO"
        self._seleccion = None
        return False

    # ----------------------------------------------------------------- contexto y entrada
    def actualizar_contexto(self, *, cables=None, catalogo=None, decisiones=None) -> None:
        if cables is not None:
            self._cables = cables
        if catalogo is not None:
            self._catalogo = catalogo
        if decisiones is not None:
            self._decisiones = decisiones
        self._revalidar()

    @property
    def entrada(self) -> dict | None:
        return copy.deepcopy(self._entrada)

    def establecer_entrada(self, entrada: dict) -> None:
        self._entrada = copy.deepcopy(entrada)
        self._revalidar()

    def modificar(self, **cambios) -> None:
        nueva = copy.deepcopy(self._entrada or {})
        nueva.update(copy.deepcopy(cambios))
        self.establecer_entrada(nueva)

    def modificar_uso(self, indice: int, **cambios) -> None:
        nueva = copy.deepcopy(self._entrada)
        nueva["usos_cable"][indice].update(copy.deepcopy(cambios))
        self.establecer_entrada(nueva)

    # ----------------------------------------------------------------- cálculo
    def calcular(self) -> dict:
        if self._entrada is None:
            raise ErrorEntrada("Sin entrada: no hay nada que calcular.")
        self._seleccion = None
        self._resultado = None
        self._resultado = calcular_sector(self._entrada, self._cables, self._catalogo, self._decisiones)
        return copy.deepcopy(self._resultado)

    @property
    def resultado(self) -> dict | None:
        self._revalidar()
        return copy.deepcopy(self._resultado)

    def vigente(self) -> bool:
        return self._revalidar()

    # ----------------------------------------------------------------- selección
    def seleccionar(self, producto_id: str) -> dict:
        if not self._revalidar():
            raise ErrorEntrada("No hay resultado vigente: recalcular antes de seleccionar.", campo="seleccion")
        cand = next((c for c in self._resultado["candidatos"] if c["producto_id"] == producto_id), None)
        if cand is None:
            raise ErrorEntrada(f"{producto_id} no figura entre los candidatos del resultado vigente.", campo="seleccion")
        if cand["estado"] not in SELECCIONABLES:
            raise ErrorEntrada(f"{producto_id} no es seleccionable ({cand['estado']}).", campo="seleccion")
        self._seleccion = {"producto_id": producto_id, "estado": cand["estado"],
                           "condiciones": list(cand["condiciones"]), "huella": self._resultado["huella"]}
        return copy.deepcopy(self._seleccion)

    @property
    def seleccion(self) -> dict | None:
        self._revalidar()
        return copy.deepcopy(self._seleccion)
