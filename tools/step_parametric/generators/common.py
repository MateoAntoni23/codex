"""Primitivas y convenciones comunes a los generadores SAM-STP-Z.

Marco local del generador (coincide con el de los STEP del fabricante):
    X_local = eje longitudinal principal (o uno de los dos para piezas simétricas).
    Y_local = altura de perfil (ala), positiva hacia arriba.
    Z_local = ancho transversal, positivo "hacia afuera" visto desde una boca.

Los STEP del fabricante colocan el perfil con Z negativo (cuerpo en -Z). Para
no romper la comparación, los generadores también construyen el cuerpo en -Z.

Tipos de datos de salida:
    PortSpec: una boca — centro, normal saliente, ancho de boca, ala.
    PieceBuild: resultado del generador — Workplane cadquery + lista de bocas
    + parámetros efectivos + marcos de origen.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any

import cadquery as cq


Vec3 = tuple[float, float, float]


@dataclass
class PortSpec:
    """Una boca de la pieza, en coordenadas locales (mm)."""

    name: str
    center: Vec3
    normal: Vec3  # saliente, unitaria
    ancho_mm: float
    ala_mm: float
    # marco de sección: ejes "u" (ancho) y "v" (altura) tangentes al plano de la boca.
    u_dir: Vec3 = (0.0, 0.0, 1.0)
    v_dir: Vec3 = (0.0, 1.0, 0.0)


@dataclass
class PieceParams:
    """Parámetros del generador. No todos se usan en todos los generadores;
    cada uno documenta qué consume."""

    ancho_mm: float = 300.0
    # Default 65 corresponde al bbox Y del STEP aportado. El catálogo SAMET
    # para la familia SAM-STP-Z publica ala 50 mm; los callers del editor usan
    # ese valor (no este default). Este default se conserva para generar
    # geometrías comparables con el STEP sin alterar la fuente original.
    ala_mm: float = 65.0
    espesor_mm: float = 0.71  # valor observado para STP-Z (procedencia en verificación)
    longitud_mm: float | None = None  # tramos rectos
    angulo_deg: float | None = None  # curvas horizontales
    radio_interior_mm: float | None = None  # curvas; None => derivado
    radio_referencia: str = "interior"  # 'interior' | 'central' | 'exterior'
    angulo_vertical_deg: float | None = None  # curva vertical
    longitud_ramal_mm: float | None = None  # DCPS / EMTS
    nota_derivacion: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PieceBuild:
    sku_logico: str  # el SKU al que apunta esta construcción (p.ej. 'TRPS-300-22-Z')
    piece_kind: str
    params_in: PieceParams
    params_effective: PieceParams
    workplane: Any  # cq.Workplane
    ports: list[PortSpec] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def bbox_of(wp: cq.Workplane) -> tuple[Vec3, Vec3]:
    """(min, max) del Workplane en coordenadas locales."""
    bb = wp.val().BoundingBox()
    return (bb.xmin, bb.ymin, bb.zmin), (bb.xmax, bb.ymax, bb.zmax)


def volume_of(wp: cq.Workplane) -> float:
    return wp.val().Volume()


def box_body(long_x: float, ala_y: float, ancho_z: float) -> cq.Workplane:
    """Caja alineada a los ejes con una esquina en (0,0,-ancho).

    Esta geometría reproduce la envolvente de un tramo recto STP-Z tal como
    viene en el STEP de referencia: cuerpo en el cuadrante X>=0, Y>=0, Z<=0.
    """
    body = (
        cq.Workplane("XY")
        .box(long_x, ala_y, ancho_z, centered=(False, False, False))
        # box() con centered=(False,False,False) posiciona la caja en X>=0,
        # Y>=0, Z>=0. Trasladamos para dejar el cuerpo en Z<=0.
        .translate((0.0, 0.0, -ancho_z))
    )
    return body


def normalize(v: Vec3) -> Vec3:
    import math

    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if n < 1e-12:
        return v
    return (v[0] / n, v[1] / n, v[2] / n)
