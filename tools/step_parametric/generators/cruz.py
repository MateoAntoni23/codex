"""Generador paramétrico: Cruz horizontal SAM-STP-Z (SKU XPS-300-Z).

El STEP del fabricante tiene 18 caras planares, bbox 449.4 (X) × 65 (Y) × 449.4 (Z).
Pieza simétrica con 4 bocas (X±, Z±).

Regla paramétrica:
    - El largo total de cada brazo es `longitud_mm` (default = bbox_X del STEP
      ≈ 449.4 mm).
    - El ancho de cada boca es `ancho_mm`.
    - La parte central cuadrada ancho×ancho es compartida por los cuatro brazos.
"""
from __future__ import annotations

import cadquery as cq

from .common import PieceBuild, PieceParams, PortSpec


def build(
    params: PieceParams,
    *,
    step_bbox_xz_mm: float | None = None,
) -> PieceBuild:
    ala = params.ala_mm
    ancho = params.ancho_mm
    L = params.longitud_mm if params.longitud_mm is not None else (step_bbox_xz_mm or 449.4)

    # Brazo horizontal (dirección X): caja L × ala × ancho centrada en (L/2, ala/2, -ancho/2)
    brazo_x = (
        cq.Workplane("XY")
        .box(L, ala, ancho, centered=(False, False, False))
        .translate((0.0, 0.0, -ancho - (L - ancho) / 2.0))
    )
    # Brazo vertical (dirección Z): caja ancho × ala × L
    brazo_z = (
        cq.Workplane("XY")
        .box(ancho, ala, L, centered=(False, False, False))
        .translate(((L - ancho) / 2.0, 0.0, -L))
    )
    body = brazo_x.union(brazo_z)

    eff = PieceParams(
        ancho_mm=ancho,
        ala_mm=ala,
        espesor_mm=params.espesor_mm,
        longitud_mm=L,
    )

    center_sq = ((L - ancho) / 2.0, 0.0, -(L + ancho) / 2.0)  # centro geométrico del cuadrado central (XZ)
    cx = center_sq[0] + ancho / 2.0
    cz = center_sq[2] + ancho / 2.0

    ports = [
        PortSpec(
            name="P1_x_neg",
            center=(0.0, ala / 2.0, cz),
            normal=(-1.0, 0.0, 0.0),
            ancho_mm=ancho, ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0), v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="P2_x_pos",
            center=(L, ala / 2.0, cz),
            normal=(1.0, 0.0, 0.0),
            ancho_mm=ancho, ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0), v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="P3_z_neg",
            center=(cx, ala / 2.0, -L),
            normal=(0.0, 0.0, -1.0),
            ancho_mm=ancho, ala_mm=ala,
            u_dir=(1.0, 0.0, 0.0), v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="P4_z_pos",
            center=(cx, ala / 2.0, 0.0),
            normal=(0.0, 0.0, 1.0),
            ancho_mm=ancho, ala_mm=ala,
            u_dir=(1.0, 0.0, 0.0), v_dir=(0.0, 1.0, 0.0),
        ),
    ]

    return PieceBuild(
        sku_logico="XPS-{a:03d}-Z".format(a=int(round(ancho))),
        piece_kind="cruz",
        params_in=params,
        params_effective=eff,
        workplane=body,
        ports=ports,
        notes=[
            f"Cruz simétrica L={L:.1f} mm, ancho={ancho} mm, ala={ala} mm. Cuatro bocas.",
        ],
    )
