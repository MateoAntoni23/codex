"""Generador paramétrico: Curva horizontal SAM-STP-Z (SKUs CPS-300-45-Z, CPS-300-90-Z).

Ambas variantes del catálogo (45° y 90°) se construyen con la misma regla
paramétrica: barrido del perfil transversal (una sección rectangular ala×ancho)
a lo largo de un arco horizontal.

Datos medidos del STEP de referencia aportado al proyecto (procedencia como
original del fabricante en verificación; envolvente solamente, sin radio
publicado para STP-Z):
    CPS-300-90-Z: bbox 744.1 × 65 × 744.0 → R_out ≈ 744 (coincide con chord 90°).
    CPS-300-45-Z: bbox 346   × 65 × 322
Nota: el ala observada en estos STEP es 65 mm. El catálogo SAMET para la
familia SAM-STP-Z publica ala = 50 mm y el editor operativo usa ese valor.

Regla de radio
--------------
No se dispone de radio publicado para STP-Z. Dejamos el radio como parámetro y
reconstruimos el STEP de referencia con el valor derivado del bbox (R_out = span X).
Para generar una variante de ancho distinto, la REGLA PROVISIONAL es mantener
el R_interior constante y adaptar R_exterior = R_interior + ancho. El usuario
puede sobrescribir el radio por completo.

Convención de orientación (coincide con el STEP de referencia de CPS-300-90-Z):
    - El centro de la curva está en (x_min, 0, z_max) local; es decir, el arco
      "se abre" hacia +X y -Z.
    - Boca P1 en el borde +X (ángulo 0°), normal +X.
    - Boca P2 rotada `angulo_deg` en sentido horario visto desde +Y, normal
      resultante tras la rotación.

Bocas
-----
Centro de la boca: punto medio del arco de perfil (ala/2 en Y, radio_central
en el plano horizontal). El ancho de cada boca es el `ancho_mm` paramétrico.
"""
from __future__ import annotations

import math

import cadquery as cq

from .common import PieceBuild, PieceParams, PortSpec


def _derive_radio_outer(
    ancho: float,
    angulo_deg: float,
    step_span_x: float | None,
    step_span_z: float | None = None,
) -> tuple[float, str]:
    """Deriva R_out a partir del bbox medido del STEP.

    Fórmula general para una curva que arranca tangente a +X con centro en
    (0,0,0), angulo total `ang`:
        X_max = R_out
        Z_min = -R_out * sin(ang)        (si ang <= 90°)
        X_min = R_in * cos(ang)          (si ang <= 90°)
        => dz = R_out * sin(ang)
        => dx = R_out - R_in * cos(ang) = R_out * (1 - cos(ang)) + ancho * cos(ang) ...
           pero más robusto: dz es independiente de R_in:
               R_out = dz / sin(ang)

    Para ángulos > 90° no aplica directamente; este catálogo no los tiene en
    la familia STP-Z de 300.
    """
    rad = math.radians(angulo_deg)
    # Prioridad 1: span Z del STEP (siempre dz = R_out * sin(ang) para ang<=90)
    if step_span_z is not None and 10.0 < angulo_deg <= 90.0:
        s = math.sin(rad)
        if s > 1e-6:
            return step_span_z / s, "derivado del bbox Z del STEP (R_out = dz / sin ang)"
    # Prioridad 2: span X del STEP para 90°
    if step_span_x is not None and 80.0 < angulo_deg < 100.0:
        return step_span_x, "derivado del bbox X del STEP (span X = R_out para 90°)"
    # Fallback: R_interior = ancho (regla provisional).
    return ancho + ancho, "PROVISIONAL: R_in = ancho (sin dato oficial del fabricante)"


def build(
    params: PieceParams,
    *,
    step_bbox_span_mm: float | None = None,
    step_bbox_z_mm: float | None = None,
) -> PieceBuild:
    ala = params.ala_mm
    ancho = params.ancho_mm
    angulo = params.angulo_deg if params.angulo_deg is not None else 90.0

    if params.radio_interior_mm is not None:
        r_in = params.radio_interior_mm
        r_out = r_in + ancho
        radio_fuente = "paramétrico (usuario)"
    else:
        r_out, radio_fuente = _derive_radio_outer(
            ancho, angulo, step_bbox_span_mm, step_bbox_z_mm
        )
        r_in = r_out - ancho

    if r_in <= 0:
        raise ValueError(f"radio interior inválido: r_in={r_in} con ancho={ancho}")

    # Construimos el arco en el plano XZ con eje vertical Y.
    # Centro del arco en (0, 0, 0), pero queremos que el bbox empiece en
    # X=0 cuando la pieza esté orientada como el STEP: trasladamos al final.
    #
    # Cuerpo: anillo circular de perfil rectangular, cortado al ángulo.
    rad = math.radians(angulo)

    # Perfil de la sección transversal — rectángulo de ala × ancho parado en Y.
    # En la boca P1 (ángulo 0°), el perfil ocupa X=[r_in, r_out], Y=[0, ala].
    # Para el barrido en cadquery usamos revolve en el plano XY con eje Y:
    #    revolve angleDegrees=angulo alrededor del eje Y pasando por el origen.
    # Antes del revolve, el perfil debe estar en el plano XY (Z=0), a la
    # distancia radial correcta y con la altura "ala" en Y.
    profile = (
        cq.Workplane("XY")
        .moveTo(r_in, 0.0)
        .lineTo(r_out, 0.0)
        .lineTo(r_out, ala)
        .lineTo(r_in, ala)
        .close()
    )
    # Revolve alrededor del eje Y (línea de origen en dirección Y).
    solid = profile.revolve(
        angleDegrees=angulo,
        axisStart=(0.0, 0.0, 0.0),
        axisEnd=(0.0, 1.0, 0.0),
    )
    # Tras revolve, el sólido ocupa el sector angular [0, angulo] en el plano
    # XZ. Queremos que se abra entre X>=0 y Z>=0 (como el STEP original de 90°
    # con centro en (xmin, 0, zmax)).

    # Posicionar como el STEP: trasladar para que el bbox coincida en X>=0 y
    # Z<=0 con el centro de curva en (0, 0, 0). El STEP original de CPS-90
    # tiene bbox X 3182..3926 y Z -2387..-1643, lo que indica un offset global
    # del archivo. Para la comparación de envolvente trabajamos en el marco
    # local del generador (centro de curva en origen).
    #
    # El sólido tras revolve ocupa:
    #   si 0 <= ángulo <= 90°: X en [0, r_out], Z en [-r_out, 0] (con Z = -r sin θ).
    # Actualmente, por convención de cadquery.revolve en el eje Y+, el barrido
    # va de 0 a `angulo` en sentido antihorario visto desde +Y: el punto inicial
    # (r_in,0,0) se mueve hacia (r_in cos θ, 0, -r_in sin θ). Buen comportamiento.

    eff = PieceParams(
        ancho_mm=ancho,
        ala_mm=ala,
        espesor_mm=params.espesor_mm,
        angulo_deg=angulo,
        radio_interior_mm=r_in,
        radio_referencia="interior",
    )

    # Bocas:
    # P1 en el ángulo 0 (plano Z=0, mirando +X): normal saliente = (+1, 0, 0),
    #   centro en ((r_in + r_out)/2, ala/2, 0).
    # P2 en el ángulo `angulo` rotado: centro = (r_c cos θ, ala/2, -r_c sin θ),
    #   normal saliente = (+cos θ, 0, -sin θ) * perpendicular a la cara del perfil
    #   Realmente la normal de la boca P2 es tangente al barrido en ese extremo,
    #   es decir (-sin θ, 0, -cos θ) ... pero DEBE ser saliente. Al barrer en
    #   sentido antihorario desde +Y, la "cara de salida" tiene normal tangente
    #   +sentido del movimiento = (cos(θ+90°), 0, -sin(θ+90°)) = (-sin θ, 0, -cos θ).
    r_c = 0.5 * (r_in + r_out)
    p1_center = (r_c, ala / 2.0, 0.0)
    p1_normal = (1.0, 0.0, 0.0)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)
    p2_center = (r_c * cos_a, ala / 2.0, -r_c * sin_a)
    p2_normal = (-sin_a, 0.0, -cos_a)

    ports = [
        PortSpec(
            name="P1",
            center=p1_center,
            normal=p1_normal,
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(0.0, 0.0, 1.0),
            v_dir=(0.0, 1.0, 0.0),
        ),
        PortSpec(
            name="P2",
            center=p2_center,
            normal=p2_normal,
            ancho_mm=ancho,
            ala_mm=ala,
            u_dir=(cos_a, 0.0, -sin_a),
            v_dir=(0.0, 1.0, 0.0),
        ),
    ]

    return PieceBuild(
        sku_logico="CPS-{a:03d}-{g:02d}-Z".format(a=int(round(ancho)), g=int(round(angulo))),
        piece_kind="curva_horizontal",
        params_in=params,
        params_effective=eff,
        workplane=solid,
        ports=ports,
        notes=[
            f"Radio (fuente): {radio_fuente}. R_in={r_in:.2f} mm, R_out={r_out:.2f} mm.",
            "Envolvente simplificada: perfil rectangular barrido (no refleja perforaciones ni ala real del Z).",
        ],
    )
