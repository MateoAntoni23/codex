"""Generador paramétrico: Curva vertical rígida SAM-STP-Z (SKU CUPS-300-A-Z).

Observaciones del STEP de referencia aportado al proyecto (procedencia como
original del fabricante en verificación; envolvente poligonal):
    bbox = 54.6 (X) x 233 (Y) x 300 (Z)
    volumen ≈ 2.37e6 mm³ (no coincide con un bloque sólido 54.6*233*300 =
    3.82e6; el modelo tiene un recorte interno y una pestaña delgada).

El STEP aportado para esta pieza es un bloque macizo reducido más una
pestaña: no contiene arco paramétrico ni perfil Z. Como no se dispone de
radio/ángulo verticales publicados para STP-Z, el generador reproduce la
envolvente del STEP como una CAJA del tamaño de su bbox y marca la
geometría interna como "no reconstruible desde STEP simplificado".

Reglas
------
- `ancho_mm`:  controla el eje Z (default 300).
- `ala_mm`:    controla la dimensión más corta "longitudinal" del codo.
  Default = 65 (bbox observado en el STEP) pero NO se puede variar sin
  dato adicional del fabricante. El catálogo SAMET para la familia
  SAM-STP-Z publica ala = 50 mm; el editor operativo usa ese valor.
- `radio_interior_mm`: si el usuario lo provee, se construye un codo curvo
  de 90° en lugar de la envolvente; se marca explícitamente como regla
  provisional.

Si se opta por el codo curvo paramétrico (presencia de radio_interior_mm),
la envolvente esperada será r_in + ala horizontal y r_in + ala vertical.

Bocas:
    P1: boca horizontal inferior — plano Y = 0, normal (0, -1, 0).
        centro ≈ (-bbox_x/2, 0, -ancho/2).
    P2: boca vertical lateral  — plano X = -bbox_x, normal (-1, 0, 0).
        centro ≈ (-bbox_x, bbox_y/2, -ancho/2).
"""
from __future__ import annotations

import math

import cadquery as cq

from .common import PieceBuild, PieceParams, PortSpec


def build(
    params: PieceParams,
    *,
    step_bbox_y_mm: float | None = None,
    step_bbox_x_mm: float | None = None,
) -> PieceBuild:
    ala = params.ala_mm
    ancho = params.ancho_mm
    ang = params.angulo_vertical_deg if params.angulo_vertical_deg is not None else 90.0

    if params.radio_interior_mm is not None:
        # Modo codo curvo paramétrico.
        return _build_codo_curvo(params, ala, ancho, ang)

    # Modo envolvente: reproducir el bbox del STEP original.
    dim_y = step_bbox_y_mm if step_bbox_y_mm is not None else (ala * 3.58)  # fallback 233 cuando ala=65
    dim_x = step_bbox_x_mm if step_bbox_x_mm is not None else 54.6

    # Cuerpo: caja dim_x × dim_y × ancho con una esquina en (0,0,-ancho).
    # Luego trasladamos a X<=0 para que la boca inferior quede en el extremo
    # -X como la del STEP.
    body = (
        cq.Workplane("XY")
        .box(dim_x, dim_y, ancho, centered=(False, False, False))
        .translate((-dim_x, 0.0, -ancho))
    )

    eff = PieceParams(
        ancho_mm=ancho,
        ala_mm=ala,
        espesor_mm=params.espesor_mm,
        angulo_vertical_deg=ang,
        radio_interior_mm=None,
    )

    ports = [
        PortSpec(
            name="P1_horizontal",
            center=(-dim_x / 2.0, 0.0, -ancho / 2.0),
            normal=(0.0, -1.0, 0.0),
            ancho_mm=ancho,
            ala_mm=dim_x,  # la "ala aparente" en este plano
            u_dir=(1.0, 0.0, 0.0),
            v_dir=(0.0, 0.0, -1.0),
        ),
        PortSpec(
            name="P2_vertical",
            center=(-dim_x, dim_y / 2.0, -ancho / 2.0),
            normal=(-1.0, 0.0, 0.0),
            ancho_mm=ancho,
            ala_mm=dim_y,
            u_dir=(0.0, 0.0, -1.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
    ]

    return PieceBuild(
        sku_logico="CUPS-{a:03d}-A-Z".format(a=int(round(ancho))),
        piece_kind="curva_vertical",
        params_in=params,
        params_effective=eff,
        workplane=body,
        ports=ports,
        notes=[
            "Modo ENVOLVENTE: reproduce bbox del STEP simplificado "
            f"({dim_x:.1f} x {dim_y:.1f} x {ancho:.0f}).",
            "No se dispone de radio ni ángulo verticales publicados para "
            "STP-Z: para generar codo curvo pasar `radio_interior_mm` "
            "explícito.",
        ],
    )


def _build_codo_curvo(
    params: PieceParams,
    ala: float,
    ancho: float,
    ang: float,
) -> PieceBuild:
    r_in = float(params.radio_interior_mm)
    r_out = r_in + ala
    rad = math.radians(ang)

    theta_start = math.pi
    theta_end = math.pi - rad

    xa, ya = r_out * math.cos(theta_start), r_out * math.sin(theta_start)
    xb, yb = r_in * math.cos(theta_start), r_in * math.sin(theta_start)
    xbp, ybp = r_in * math.cos(theta_end), r_in * math.sin(theta_end)
    xcp, ycp = r_out * math.cos(theta_end), r_out * math.sin(theta_end)

    sector = (
        cq.Workplane("XY")
        .moveTo(xa, ya)
        .lineTo(xb, yb)
        .threePointArc(
            (r_in * math.cos((theta_start + theta_end) / 2.0),
             r_in * math.sin((theta_start + theta_end) / 2.0)),
            (xbp, ybp),
        )
        .lineTo(xcp, ycp)
        .threePointArc(
            (r_out * math.cos((theta_start + theta_end) / 2.0),
             r_out * math.sin((theta_start + theta_end) / 2.0)),
            (xa, ya),
        )
        .close()
    )
    body = sector.extrude(ancho).translate((0.0, 0.0, -ancho))

    eff = PieceParams(
        ancho_mm=ancho,
        ala_mm=ala,
        espesor_mm=params.espesor_mm,
        angulo_vertical_deg=ang,
        radio_interior_mm=r_in,
        radio_referencia="interior",
    )

    p1_center = ((xa + xb) / 2.0, 0.0, -ancho / 2.0)
    p1_normal = (0.0, -1.0, 0.0)
    tangent_out = (math.sin(theta_end), -math.cos(theta_end), 0.0)
    p2_center = (
        (r_in + r_out) / 2.0 * math.cos(theta_end),
        (r_in + r_out) / 2.0 * math.sin(theta_end),
        -ancho / 2.0,
    )
    ports = [
        PortSpec(
            name="P1_horizontal",
            center=p1_center,
            normal=p1_normal,
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(1.0, 0.0, 0.0),
        ),
        PortSpec(
            name="P2_angular",
            center=p2_center,
            normal=tangent_out,
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(-tangent_out[1], tangent_out[0], 0.0),
        ),
    ]

    return PieceBuild(
        sku_logico="CUPS-{a:03d}-A-Z".format(a=int(round(ancho))),
        piece_kind="curva_vertical",
        params_in=params,
        params_effective=eff,
        workplane=body,
        ports=ports,
        notes=[
            f"Modo CODO CURVO PROVISIONAL (radio_interior={r_in:.1f}, ala={ala:.1f}, ang={ang:.0f}°).",
            "Sin dato oficial del fabricante para STP-Z vertical; parámetros bajo responsabilidad del usuario.",
        ],
    )
