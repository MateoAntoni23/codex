"""Generador paramétrico: Derivación lateral SAM-STP-Z (SKU DCPS-300-Z).

Esta pieza se fija al costado de un tramo principal y abre una derivación.
El STEP del fabricante tiene 12 caras planares y bbox:
    449.5 (X) × 65 (Y) × 375.1 (Z, en el intervalo [-375, 0] aprox)

Para MVP el generador reproduce la envolvente como un cuerpo en forma de L
(dos cajas intersectadas) definido por:
    - `longitud_tronco_x`: dimensión X del tramo paralelo al tronco principal.
    - `ancho_derivacion_z`: dimensión Z del ramal perpendicular.
    - `ala_mm`: altura del perfil.
    - `ancho_tronco_z`: parte del ramal que se traslapa con el tronco (fijación).

Valores derivados por defecto (coinciden con la envolvente del STEP original):
    longitud_tronco_x = 449.5
    ancho_derivacion_z = 300 (ancho_mm del parámetro)
    ancho_tronco_z = 75  (bbox_z − ancho_mm = 375 − 300)
"""
from __future__ import annotations

import cadquery as cq

from .common import PieceBuild, PieceParams, PortSpec


def build(
    params: PieceParams,
    *,
    step_bbox_x_mm: float | None = None,
    overhang_z_mm: float | None = None,
) -> PieceBuild:
    """`overhang_z_mm` es la franja de fijación al tronco; se mantiene constante
    al cambiar `ancho_mm` (es una propiedad del formato de pieza, no del ancho)."""
    ala = params.ala_mm
    ancho = params.ancho_mm

    long_tronco = step_bbox_x_mm if step_bbox_x_mm is not None else 449.5
    overhang = overhang_z_mm if overhang_z_mm is not None else 75.0
    ancho_total_z = ancho + overhang

    # Cuerpo en forma de L (planta): un rectángulo tronco_x × overhang pegado
    # al tronco (Z en [-overhang, 0]), y un ramal derivación_z × subset_x que
    # se extiende en -Z con ancho igual al ancho nominal.
    tronco = (
        cq.Workplane("XY")
        .box(long_tronco, ala, overhang, centered=(False, False, False))
        .translate((0.0, 0.0, -overhang))
    )
    # El ramal arranca al centro del tronco, con un ancho X igual al ancho
    # nominal (la "boca" de salida del ramal es un cuadrado ancho × ala).
    ramal_x_start = (long_tronco - ancho) / 2.0
    ramal = (
        cq.Workplane("XY")
        .box(ancho, ala, ancho, centered=(False, False, False))
        .translate((ramal_x_start, 0.0, -ancho_total_z))
    )
    body = tronco.union(ramal)

    eff = PieceParams(
        ancho_mm=ancho,
        ala_mm=ala,
        espesor_mm=params.espesor_mm,
        longitud_mm=long_tronco,
    )

    # Bocas:
    # La pieza tiene UNA boca útil según el catálogo ("boca derivación"); el
    # tronco X extremos también podrían considerarse continuación del tramo
    # pero el fabricante los declara como fijación. Dejamos los tres marcados
    # con roles.
    ports = [
        PortSpec(
            name="boca_derivacion",
            center=(ramal_x_start + ancho / 2.0, ala / 2.0, -ancho_total_z),
            normal=(0.0, 0.0, -1.0),
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(1.0, 0.0, 0.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="tronco_P1",
            center=(0.0, ala / 2.0, -overhang / 2.0),
            normal=(-1.0, 0.0, 0.0),
            ancho_mm=overhang,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="tronco_P2",
            center=(long_tronco, ala / 2.0, -overhang / 2.0),
            normal=(1.0, 0.0, 0.0),
            ancho_mm=overhang,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
    ]

    return PieceBuild(
        sku_logico="DCPS-{a:03d}-Z".format(a=int(round(ancho))),
        piece_kind="derivacion_lateral",
        params_in=params,
        params_effective=eff,
        workplane=body,
        ports=ports,
        notes=[
            "Envolvente en L: tronco_x={:.1f}, overhang_z={:.1f}, ramal ancho×ala={:.0f}×{:.0f}.".format(
                long_tronco, overhang, ancho, ala
            ),
            "El fabricante declara solo 'boca_derivacion' como puerto operativo; las dos del tronco son zonas de fijación.",
        ],
    )
