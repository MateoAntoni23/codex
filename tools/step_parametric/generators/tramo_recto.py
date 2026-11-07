"""Generador paramétrico: Tramo recto SAM-STP-Z (SKU referencia TRPS-300-22-Z).

Envolvente SolidWorks (medición del STEP original):
    bbox = 3000 (X) × 65 (Y) × 300 (Z)
    cuerpo con esquina en (0, 0, -300); 6 caras planares.

Reglas del generador
--------------------
    - `longitud_mm` controla el eje X (default 3000, comercial declarado).
    - `ala_mm`      controla el eje Y (default 65 observado en STEP).
    - `ancho_mm`    controla el ancho (|Z|) (default 300).
    - `espesor_mm`  NO se usa en la envolvente simplificada; se registra en
      parámetros efectivos para pipelines detallados futuros.

Bocas (en marco local):
    P1 en X=0, normal (-1, 0, 0), centro (0, ala/2, -ancho/2).
    P2 en X=long, normal (+1, 0, 0), centro (long, ala/2, -ancho/2).
"""
from __future__ import annotations

from .common import PieceBuild, PieceParams, PortSpec, box_body


def build(params: PieceParams) -> PieceBuild:
    long_mm = params.longitud_mm if params.longitud_mm is not None else 3000.0
    ala = params.ala_mm
    ancho = params.ancho_mm

    body = box_body(long_mm, ala, ancho)

    eff = PieceParams(
        ancho_mm=ancho,
        ala_mm=ala,
        espesor_mm=params.espesor_mm,
        longitud_mm=long_mm,
    )

    ports = [
        PortSpec(
            name="P1",
            center=(0.0, ala / 2.0, -ancho / 2.0),
            normal=(-1.0, 0.0, 0.0),
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="P2",
            center=(long_mm, ala / 2.0, -ancho / 2.0),
            normal=(1.0, 0.0, 0.0),
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
    ]

    return PieceBuild(
        sku_logico="TRPS-{ancho:03d}-22-Z".format(ancho=int(round(ancho))),
        piece_kind="tramo_recto",
        params_in=params,
        params_effective=eff,
        workplane=body,
        ports=ports,
        notes=[
            "Envolvente simplificada compatible con el STEP original (sin perfil Z ni perforaciones).",
        ],
    )
