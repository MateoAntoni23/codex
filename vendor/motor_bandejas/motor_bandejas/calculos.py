"""Cálculos elementales: masa lineal, disposición en una capa, reserva y verificación mecánica.

Cada función es pura: recibe datos ya validados y devuelve un dict serializable con método, fórmula,
valores y procedencia. No hay estado ni dependencias de UI o geometría 3D.
"""
from __future__ import annotations

from .catalogo import Catalogo
from .errores import NoSoportado, PendienteDecision
from .unidades import EPS, redondear

METODOS = {
    "masa_lineal": "M-MASA-1",
    "disposicion": "M-DISP-1",
    "reserva": "M-RES-1",
    "mecanica": "M-MEC-1",
}

# --------------------------------------------------------------------------------------------- masa lineal


def masa_lineal(usos: list[dict]) -> dict:
    """q = Σ nᵢ · mᵢ  [kg/m], con mᵢ = masa aproximada de ficha [kg/km] / 1000.

    Solo masa propia de los cables. No incluye tapa, accesorios, hielo, viento ni cargas puntuales.
    """
    detalle = []
    total = 0.0
    for u in usos:
        c = u["cable"]
        sub = u["cantidad"] * c.masa_kg_m
        total += sub
        detalle.append({
            "cable_id": c.cable_id,
            "cantidad": u["cantidad"],
            "masa_unitaria_kg_km_fuente": c.masa_kg_km,
            "masa_unitaria_kg_m": redondear(c.masa_kg_m),
            "subtotal_kg_m": redondear(sub),
            "procedencia": c.procedencia(),
        })
    return {
        "metodo": METODOS["masa_lineal"],
        "formula": "q = Σ nᵢ·mᵢ ; mᵢ[kg/m] = mᵢ[kg/km] / 1000",
        "valor_kg_m": redondear(total),
        "alcance": "Masa propia de los cables. Excluye tapa, accesorios, sobrecargas y cargas puntuales.",
        "detalle": detalle,
    }


# --------------------------------------------------------------------------------------------- disposición


def disposicion_una_capa(usos: list[dict]) -> dict:
    """Ancho ocupado por los cables en una sola capa, sin márgenes laterales ni reserva.

    - Contacto (D-02):    W = Σ nᵢ·Dᵢ                      (huecos nulos; mezcla de diámetros admitida)
    - Separado (D-01):    W = n·D + (n−1)·g, con g = D  ⇒  W = (2n−1)·D   (todos los D iguales)
    - Separado con D distintos: PENDIENTE (D-03, regla propuesta, no implementada).
    - Mezcla de grupos separados y en contacto en la misma bandeja: PENDIENTE (D-07).
    - Apilado: NO SOPORTADO (D-09).
    D = diámetro exterior del cable completo (incluye aislación y envoltura).
    """
    if any(u["apilado"] for u in usos):
        raise NoSoportado(
            "Disposición apilada (más de una capa) sin regla acordada ni documentada. Ver D-09.",
            decision_id="D-09", campo="usos_cable[].apilado",
        )
    modos = {u["disposicion"] for u in usos}
    diametros = [u["cable"].diametro_exterior_mm for u in usos]
    d_max = max(diametros)
    n_total = sum(u["cantidad"] for u in usos)
    decisiones = sorted({u["decision_disposicion"] for u in usos})

    if modos == {"contacto"}:
        w = sum(u["cantidad"] * u["cable"].diametro_exterior_mm for u in usos)
        formula = "W = Σ nᵢ·Dᵢ (contacto, una capa, huecos nulos)"
        hueco = 0.0
    elif modos == {"separado"}:
        distintos = sorted(set(diametros))
        if len(distintos) > 1:
            raise PendienteDecision(
                "Cables separados con diámetros distintos %s mm: la regla del hueco entre pares no está "
                "acordada. Propuesta en docs/DECISIONES.md (D-03): g = max(Dᵢ, Dⱼ)." % distintos,
                decision_id="D-03", campo="usos_cable",
            )
        d = distintos[0]
        hueco = d
        w = (2 * n_total - 1) * d
        formula = "W = n·D + (n−1)·g ; g = D ⇒ W = (2n−1)·D (separado, una fila)"
    else:
        raise PendienteDecision(
            "Mezcla de grupos 'separado' y 'contacto' en la misma bandeja: no hay regla acordada para el hueco "
            "entre grupos. Ver D-07.", decision_id="D-07", campo="usos_cable",
        )
    return {
        "metodo": METODOS["disposicion"],
        "modo": modos.pop(),
        "capas": 1,
        "n_cables": n_total,
        "hueco_libre_entre_superficies_mm": redondear(hueco),
        "paso_entre_centros_mm": redondear(d_max + hueco) if len(set(diametros)) == 1 else None,
        "diametro_max_mm": redondear(d_max),
        "ancho_ocupado_mm": redondear(w),
        "formula": formula,
        "excluye": "márgenes laterales, separación a las alas, reserva",
        "decisiones": decisiones,
    }


# --------------------------------------------------------------------------------------------- reserva

CRITERIOS_RESERVA = {
    "fraccion_libre_ancho_bandeja": {
        "condicion": "W_ocupado ≤ (1 − r)·W_ref",
        "denominador": "ancho de referencia de la bandeja (W_ref)",
    },
    "sobre_ancho_ocupado": {
        "condicion": "W_ref ≥ (1 + r)·W_ocupado",
        "denominador": "ancho ocupado por los cables (W_ocupado)",
    },
}


def evaluar_reserva(w_ocupado: float, w_ref: float, r: float, criterio: str) -> dict:
    """Evalúa la reserva de espacio en ancho.

    Métricas informadas (ambas, con su denominador):
    - reserva_libre_pct            = (W_ref − W_ocup) / W_ref · 100      (fracción libre del ancho de la bandeja)
    - sobrante_sobre_ocupado_pct   = (W_ref − W_ocup) / W_ocup · 100     (equivale a la 'reserva real' de Samet, H-S3)
    El criterio de aceptación es UNO, elegido explícitamente (D-05).
    """
    if criterio not in CRITERIOS_RESERVA:
        raise ValueError(f"Criterio de reserva desconocido: {criterio}")
    libre = w_ref - w_ocupado
    if criterio == "fraccion_libre_ancho_bandeja":
        ancho_max = (1.0 - r) * w_ref
        cumple = w_ocupado <= ancho_max + EPS
    else:
        ancho_max = w_ref / (1.0 + r)
        cumple = w_ref + EPS >= (1.0 + r) * w_ocupado
    return {
        "metodo": METODOS["reserva"],
        "criterio": criterio,
        "condicion": CRITERIOS_RESERVA[criterio]["condicion"],
        "denominador_criterio": CRITERIOS_RESERVA[criterio]["denominador"],
        "reserva_solicitada_pct": redondear(r * 100.0),
        "ancho_libre_mm": redondear(libre),
        "ancho_max_ocupable_mm": redondear(ancho_max),
        "reserva_libre_pct": redondear(100.0 * libre / w_ref, 3),
        "sobrante_sobre_ocupado_pct": redondear(100.0 * libre / w_ocupado, 3),
        "cabe": w_ocupado <= w_ref + EPS,
        "cumple": cumple and (w_ocupado <= w_ref + EPS),
    }


# --------------------------------------------------------------------------------------------- mecánica

ESTADOS_MECANICA = (
    "VERIFICADA_CUMPLE",             # CTA documentada por el fabricante para esa luz
    "VERIFICADA_NO_CUMPLE",
    "CUMPLE_CONDICIONADO",           # CTA adoptada por decisión o validada por usuario (no documentada)
    "NO_CUMPLE_CONDICIONADO",
    "NO_VERIFICABLE_SIN_REGISTRO",
    "NO_VERIFICABLE_REGISTRO_SIN_VALOR",
    "NO_VERIFICABLE_LUZ_NO_DECLARADA",
    "NO_VERIFICABLE_CONDICIONES",
)

ALCANCE_MECANICO = (
    "Compara solo la masa propia de los cables con la CTA publicada para la misma luz. El esquema del ensayo "
    "(número de tramos, posición de uniones, tipo de apoyo) NO se contrasta con la instalación (D-12)."
)


def evaluar_mecanica(producto_id: str, q_kg_m: float, vano_mm: float, catalogo: Catalogo,
                     evidencias_aceptadas: list[str]) -> dict:
    """Compara la masa lineal de cables con la CTA registrada para ESA luz (D-06).

    Acepta solo registros con: tipo_entidad = producto, luz = vano (exacta), unidad kg/m, carga uniformemente
    distribuida, valor > 0 y `evidencia_motor` en `evidencias_aceptadas`. No interpola ni extrapola.
    - evidencia 'documentada'            → VERIFICADA_CUMPLE / VERIFICADA_NO_CUMPLE
    - 'adoptada_por_decision' / 'validada_por_usuario' → CUMPLE_CONDICIONADO / NO_CUMPLE_CONDICIONADO
    'cociente_cta_carga' = CTA / q se informa porque es compatible con lo que Samet rotula 'factor de seguridad'
    (H-S1); NO es un coeficiente de seguridad normativo.
    """
    regs = [r for r in catalogo.cargas_de(producto_id) if r.tipo_entidad == "producto"]
    base = {"metodo": METODOS["mecanica"], "vano_mm": redondear(vano_mm), "carga_cables_kg_m": redondear(q_kg_m),
            "alcance": ALCANCE_MECANICO, "esquema_ensayo_contrastado": False}

    def _ok_cond(r):
        return (r.carga_unidad == "kg/m" and r.distribucion_carga == "uniformemente distribuida"
                and r.evidencia_motor in evidencias_aceptadas)

    misma_luz = [r for r in regs if r.luz_entre_apoyos_mm is not None and abs(r.luz_entre_apoyos_mm - vano_mm) <= EPS]
    validos = [r for r in misma_luz if r.carga_valor is not None and _ok_cond(r)]
    if validos:
        cta_reg = min(validos, key=lambda r: r.carga_valor)
        cta = cta_reg.carga_valor
        cumple = q_kg_m <= cta + EPS
        documentada = cta_reg.evidencia_motor == "documentada"
        if documentada:
            estado = "VERIFICADA_CUMPLE" if cumple else "VERIFICADA_NO_CUMPLE"
        else:
            estado = "CUMPLE_CONDICIONADO" if cumple else "NO_CUMPLE_CONDICIONADO"
        out = dict(base)
        out.update({
            "estado": estado,
            "base_evidencia": cta_reg.evidencia_motor,
            "cta_kg_m": redondear(cta),
            "utilizacion_pct": redondear(100.0 * q_kg_m / cta, 4),
            "cociente_cta_carga": redondear(cta / q_kg_m, 2) if q_kg_m > 0 else None,
            "nota_cociente": "CTA/q: compatible con el 'factor de seguridad' mostrado por Samet (H-S1). No es un coeficiente normativo.",
            "registro": cta_reg.como_dict(),
        })
        if len({r.carga_valor for r in validos}) > 1:
            out["advertencia"] = "Registros de carga múltiples para la misma luz con valores distintos; se usó el menor."
        return out

    out = dict(base)
    out["cta_kg_m"] = None
    out["base_evidencia"] = None
    if misma_luz and all(r.carga_valor is None for r in misma_luz):
        out["estado"] = "NO_VERIFICABLE_REGISTRO_SIN_VALOR"
        out["detalle"] = "El catálogo registra la luz pero sin valor publicado."
        out["registros_considerados"] = [r.como_dict() for r in misma_luz]
    elif misma_luz:
        out["estado"] = "NO_VERIFICABLE_CONDICIONES"
        out["detalle"] = "Hay registro para la luz pero con unidad, distribución o evidencia no aceptadas."
        out["registros_considerados"] = [r.como_dict() for r in misma_luz]
    elif any(r.luz_entre_apoyos_mm is None and r.carga_valor is not None for r in regs):
        out["estado"] = "NO_VERIFICABLE_LUZ_NO_DECLARADA"
        out["detalle"] = ("Existe una CTA publicada sin luz entre apoyos declarada: no se asume que corresponda "
                          "al vano solicitado. Valor solo informativo.")
        out["registros_considerados"] = [r.como_dict() for r in regs if r.luz_entre_apoyos_mm is None]
    else:
        out["estado"] = "NO_VERIFICABLE_SIN_REGISTRO"
        out["detalle"] = "El catálogo no tiene carga de trabajo admisible para este producto y vano."
    return out
