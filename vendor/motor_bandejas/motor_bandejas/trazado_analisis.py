"""Análisis del trazado: compatibilidad, encaje, orientación, recorridos, ocupación y curvatura.

Separación de responsabilidades:
- El grafo (piezas + conexiones) solo dice qué puertos se tocan.
- La compatibilidad sale del catálogo (COMPATIBILIDADES), por par de puertos.
- El encaje geométrico compara la geometría de puertos que entrega el CAD. Las dimensiones físicas de las
  piezas no están publicadas, así que el motor verifica la COHERENCIA del modelo del CAD, no la pieza real.
- Qué cables pasan por cada pieza lo dicen los recorridos explícitos de cada circuito. Nada se reparte
  automáticamente entre ramales.
"""
from __future__ import annotations

import math

from .calculos import disposicion_una_capa, evaluar_reserva
from .catalogo import Catalogo
from .errores import NoSoportado, PendienteDecision
from .unidades import EPS, redondear

# --------------------------------------------------------------------------------------------- vectores


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def _norm(a):
    return math.sqrt(_dot(a, a))


def _ang(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, _dot(a, b)))))


# --------------------------------------------------------------------------------------------- compatibilidad

_ESTADO_COMPAT = {
    ("confirmada", "documentada"): "COMPATIBLE_DOCUMENTADA",
    ("confirmada", "validada por usuario"): "COMPATIBLE_VALIDADA_USUARIO",
    ("no compatible", "no compatible"): "NO_COMPATIBLE",
}


class IndiceCompat:
    def __init__(self, cat: Catalogo):
        self.cat = cat
        self.por_puertos, self.no_compat_familias = {}, {}
        for c in cat.compatibilidades:
            if c.puerto_a_id and c.puerto_b_id:
                self.por_puertos.setdefault((c.puerto_a_id, c.puerto_b_id), []).append(c)
                self.por_puertos.setdefault((c.puerto_b_id, c.puerto_a_id), []).append(c)
            if c.estado_compatibilidad == "no compatible" and c.producto_b_id:
                fa = cat.piezas[c.producto_a_id].familia_id
                fb = cat.piezas[c.producto_b_id].familia_id
                if fa != fb:
                    self.no_compat_familias.setdefault(frozenset((fa, fb)), c)
        self.por_productos = {}
        for c in cat.compatibilidades:
            if c.producto_b_id:
                self.por_productos.setdefault((c.producto_a_id, c.producto_b_id), []).append(c)
                self.por_productos.setdefault((c.producto_b_id, c.producto_a_id), []).append(c)

    def _equivalentes(self, puerto_id):
        """D-13: puertos de un tramo recto con igual ancho, ala e interfaz se consideran equivalentes."""
        pu = self.cat.puertos_por_id[puerto_id]
        prod = self.cat.piezas[pu.producto_id]
        if prod.tipo_pieza != "recta":
            return [puerto_id]
        out = [puerto_id]
        for otro in self.cat.puertos.get(pu.producto_id, ()):
            if otro.puerto_id != puerto_id and (otro.ancho_nominal_mm, otro.ala_nominal_mm, otro.interfaz_conexion) == \
                    (pu.ancho_nominal_mm, pu.ala_nominal_mm, pu.interfaz_conexion):
                out.append(otro.puerto_id)
        return out

    def evaluar(self, puerto_a: str, puerto_b: str, aplicar_d13: bool) -> dict:
        pa, pb = self.cat.puertos_por_id[puerto_a], self.cat.puertos_por_id[puerto_b]
        dim = {"ancho_a_mm": pa.ancho_nominal_mm, "ancho_b_mm": pb.ancho_nominal_mm, "ala_a_mm": pa.ala_nominal_mm,
               "ala_b_mm": pb.ala_nominal_mm, "interfaz_a": pa.interfaz_conexion, "interfaz_b": pb.interfaz_conexion}
        condiciones = []
        regs = self.por_puertos.get((puerto_a, puerto_b))
        if not regs and aplicar_d13:
            for xa in self._equivalentes(puerto_a):
                for xb in self._equivalentes(puerto_b):
                    if (xa, xb) != (puerto_a, puerto_b) and self.por_puertos.get((xa, xb)):
                        regs = self.por_puertos[(xa, xb)]
                        condiciones.append("EQUIVALENCIA_EXTREMOS_RECTA_D-13")
                        break
                if regs:
                    break
        if regs:
            r = regs[0]
            estado = _ESTADO_COMPAT.get((r.estado_compatibilidad, r.estado_evidencia), "PENDIENTE")
            out = {"estado": estado, "registro": r.como_dict(), "condiciones": condiciones, "dimensiones": dim}
            if estado.startswith("COMPATIBLE") and (pa.ancho_nominal_mm != pb.ancho_nominal_mm
                                                     or pa.ala_nominal_mm != pb.ala_nominal_mm):
                out["advertencia"] = "Registro compatible pero los puertos difieren en ancho/ala: revisar el catálogo."
            return out
        fa = self.cat.piezas[pa.producto_id].familia_id
        fb = self.cat.piezas[pb.producto_id].familia_id
        regla = self.no_compat_familias.get(frozenset((fa, fb)))
        if regla is not None:
            return {"estado": "NO_COMPATIBLE", "registro": regla.como_dict(), "dimensiones": dim,
                    "condiciones": ["REGLA_DE_FAMILIA_REV-032"],
                    "detalle": f"Familias {fa} y {fb} declaradas no compatibles entre sí (regla del usuario REV-032)."}
        return {"estado": "NO_REGISTRADA", "registro": None, "condiciones": condiciones, "dimensiones": dim,
                "detalle": "Sin registro para este par de puertos. 'No registrada' NO equivale a 'no compatible'."}

    def accesorio(self, producto_acc: str, producto_base: str) -> dict:
        regs = [c for c in self.por_productos.get((producto_acc, producto_base), [])
                if c.tipo_conexion in ("tapa", "accesorio interior", "con kit")]
        if not regs:
            return {"estado": "NO_REGISTRADA", "registro": None}
        r = regs[0]
        return {"estado": _ESTADO_COMPAT.get((r.estado_compatibilidad, r.estado_evidencia), "PENDIENTE"),
                "registro": r.como_dict()}


# --------------------------------------------------------------------------------------------- geometría


def encaje_conexion(ga, gb, dec) -> dict:
    tol_p, tol_a = dec["D-14_tolerancia_posicion_mm"], dec["D-14_tolerancia_angulo_grados"]
    if ga is None or gb is None:
        return {"estado": "NO_VERIFICABLE_SIN_GEOMETRIA",
                "detalle": "El CAD no informó posición y dirección de ambos puertos."}
    dist = _norm(_sub(ga["posicion_mm"], gb["posicion_mm"]))
    ang = _ang(ga["direccion"], [-x for x in gb["direccion"]])
    ok = dist <= tol_p + EPS and ang <= tol_a + EPS
    return {"estado": "COHERENTE" if ok else "INCOHERENTE", "separacion_mm": redondear(dist, 3),
            "desvio_angular_grados": redondear(ang, 3), "tolerancias": {"posicion_mm": tol_p, "angulo_grados": tol_a},
            "alcance": "Coherencia del modelo del CAD (puertos coincidentes y enfrentados). Las dimensiones físicas "
                       "de las piezas no están publicadas: no se verifica la pieza real (D-14)."}


def clasificar_curva(d1, d2, eje) -> dict:
    """Clasifica una pieza de 2 puertos a partir de las direcciones salientes d1, d2.
    Ángulo de giro = ángulo entre la dirección de entrada (-d1) y la de salida (d2).
    (d1 + d2)·eje > 0 → cóncava hacia arriba (vertical interior); < 0 → vertical exterior; ≈0 y ambas
    horizontales → horizontal."""
    giro = _ang([-x for x in d1], d2)
    s = [d1[i] + d2[i] for i in range(3)]
    vert = _dot(s, eje)
    horiz = abs(_dot(d1, eje)) < 1e-6 and abs(_dot(d2, eje)) < 1e-6
    if giro < 1e-6:
        clase = "recta"
    elif horiz:
        clase = "curva horizontal"
    elif vert > 1e-9:
        clase = "curva vertical interior"
    elif vert < -1e-9:
        clase = "curva vertical exterior"
    else:
        clase = "indeterminada"
    return {"giro_grados": redondear(giro, 3), "clase": clase}


def geometria_pieza(p: dict, prod, eje, dec) -> dict:
    g = p["puertos"]
    tol_p, tol_a = dec["D-14_tolerancia_posicion_mm"], dec["D-14_tolerancia_angulo_grados"]
    t = prod.tipo_pieza
    if t in ("recta", "curva horizontal", "curva vertical interior", "curva vertical exterior", "curva vertical articulada"):
        if "P1" not in g or "P2" not in g:
            return {"estado": "NO_VERIFICABLE_SIN_GEOMETRIA"}
        c = clasificar_curva(g["P1"]["direccion"], g["P2"]["direccion"], eje)
        obs = []
        if t == "recta":
            dist = _norm(_sub(g["P1"]["posicion_mm"], g["P2"]["posicion_mm"]))
            c["distancia_puertos_mm"] = redondear(dist, 3)
            if abs(dist - p["longitud_mm"]) > tol_p + EPS:
                obs.append(f"Distancia entre puertos {dist:.1f} mm ≠ longitud declarada {p['longitud_mm']} mm.")
            if c["clase"] != "recta":
                obs.append(f"Los puertos no están enfrentados (giro {c['giro_grados']}°).")
            if dist > EPS:                # v0.2.2 (auditoría H5): las direcciones deben seguir el eje P1→P2
                eje_p = [x / dist for x in _sub(g["P2"]["posicion_mm"], g["P1"]["posicion_mm"])]   # unitario
                a2 = _ang(g["P2"]["direccion"], eje_p)
                a1 = _ang(g["P1"]["direccion"], [-x for x in eje_p])
                c["desvio_direcciones_eje_grados"] = [redondear(a1, 3), redondear(a2, 3)]
                if a1 > tol_a + EPS or a2 > tol_a + EPS:
                    obs.append(f"Las direcciones de los puertos no siguen el eje de la pieza P1→P2 "
                               f"(desvíos {a1:.1f}° / {a2:.1f}°; tolerancia {tol_a}°, D-14).")
        else:
            if t == "curva vertical articulada":
                if c["clase"] not in ("curva vertical interior", "curva vertical exterior"):
                    obs.append(f"Curva articulada colocada como '{c['clase']}'.")
            elif c["clase"] != t:
                obs.append(f"Orientación del CAD = '{c['clase']}', catálogo = '{t}'.")
            if prod.angulo_grados is not None and abs(c["giro_grados"] - prod.angulo_grados) > tol_a + EPS:
                obs.append(f"Giro {c['giro_grados']}° ≠ ángulo publicado {prod.angulo_grados}°.")
            if prod.angulo_grados is None:
                c["angulo_publicado"] = None
        c["estado"] = "COHERENTE" if not obs else "INCOHERENTE"
        c["observaciones"] = obs
        return c
    return {"estado": "SIN_REGLA_GEOMETRICA_INTERNA",
            "detalle": f"'{t}': la ubicación relativa de las bocas no está publicada; solo se verifica el encaje en conexiones."}


# --------------------------------------------------------------------------------------------- recorridos


def analizar_recorrido(ids: list[str], conex_por_par: dict) -> dict:
    """Valida que instancias consecutivas estén conectadas y devuelve puertos de entrada/salida por instancia."""
    pasos, faltan = [], []
    for i, inst in enumerate(ids):
        entrada = salida = None
        if i > 0:
            k = conex_por_par.get((ids[i - 1], inst))
            entrada = k[inst] if k else None
            if not k:
                faltan.append([ids[i - 1], inst])
        if i < len(ids) - 1:
            k = conex_por_par.get((inst, ids[i + 1]))
            salida = k[inst] if k else None
        pasos.append({"instancia": inst, "puerto_entrada": entrada, "puerto_salida": salida})
    cruces = []
    for i in range(len(ids) - 1):
        k = conex_por_par.get((ids[i], ids[i + 1]))
        if k:
            cruces.append(k["conexion_id"])
    return {"estado": "CONTINUO" if not faltan else "DISCONTINUO", "saltos_sin_conexion": faltan,
            "pasos": pasos, "conexiones_cruzadas": cruces}


# --------------------------------------------------------------------------------------------- ocupación


def secciones_de_pieza(prod, cat) -> str:
    """'pieza' si la pieza tiene ≤ 2 bocas del mismo ancho; 'puerto' en otro caso (T, X, reducciones) — D-17."""
    pts = cat.puertos.get(prod.producto_id, ())
    anchos = {p.ancho_nominal_mm for p in pts}
    return "pieza" if len(pts) <= 2 and len(anchos) == 1 else "puerto"


def ocupacion_seccion(usos_pot: list[dict], pe_cable, n_pe: int, ancho_ref, ala_ref, r: float, criterio: str, dec) -> dict:
    """Ocupación de una sección: cables de potencia (reglas v0.1.x) + PE según D-19."""
    out = {"ancho_referencia_mm": ancho_ref, "base_ancho": "nominal", "altura_referencia_mm": ala_ref,
           "base_altura": "ala_nominal", "n_conductores_pe": n_pe, "condiciones": []}
    if not usos_pot and n_pe == 0:
        out["estado"] = "SIN_CABLES"
        return out
    d_pe = pe_cable.diametro_exterior_mm if (pe_cable and n_pe) else 0.0
    if usos_pot:
        try:
            disp = disposicion_una_capa(usos_pot)
        except (PendienteDecision, NoSoportado) as e:
            out["estado"] = "BLOQUEADO"
            out["bloqueo"] = e.como_dict()
            return out
        out["disposicion_potencia"] = disp
        w_pot, d_max = disp["ancho_ocupado_mm"], disp["diametro_max_mm"]
    else:
        w_pot, d_max = 0.0, 0.0
    if n_pe:
        d_max = max(d_max, d_pe)
        if usos_pot:
            modo = dec["D-19_posicion_pe"]
            if modo == "pendiente":
                out["estado"] = "BLOQUEADO"
                out["bloqueo"] = {"codigo": "PENDIENTE_DECISION", "decision_id": "D-19",
                                  "mensaje": "Posición del PE junto a la potencia no resuelta (la regla g=D no se aplica al PE)."}
                out["ancho_potencia_mm"] = redondear(w_pot)
                out["cota_inferior_con_pe_mm"] = redondear(w_pot + n_pe * d_pe)
                return out
            if modo == "contra_ala_en_contacto":
                # D-19 (usuario): PE contra una de las alas, en contacto. Ocupa D_PE del fondo; el hueco entre el PE y
                # el cable de potencia más cercano no está definido: se toma 0 (ancho mínimo).
                out["condiciones"].append("D-19_PE_CONTRA_ALA_HUECO_PE_POTENCIA_NO_DEFINIDO")
            elif modo == "contacto_en_extremo_de_fila":
                out["condiciones"].append("D-19_PROPUESTA_PE_EN_CONTACTO_EN_EXTREMO")
            else:
                raise ValueError(f"D-19 desconocida: {modo}")
        w = w_pot + n_pe * d_pe
    else:
        w = w_pot
    out["ancho_ocupado_mm"] = redondear(w)
    out["diametro_max_mm"] = redondear(d_max)
    if ancho_ref is None:
        out["estado"] = "NO_VERIFICABLE_SIN_ANCHO"
        return out
    res = evaluar_reserva(w, ancho_ref, r, criterio)
    out["reserva"] = res
    out["condiciones"] += ["ANCHO_NOMINAL_NO_UTIL", "ALTURA_ALA_NOMINAL_NO_UTIL"]
    if not res["cabe"]:
        out["estado"] = "NO_CUMPLE_ANCHO"
    elif not res["cumple"]:
        out["estado"] = "NO_CUMPLE_RESERVA"
    elif ala_ref is None:
        out["estado"] = "NO_VERIFICABLE_SIN_ALTURA"
    elif d_max > ala_ref + EPS:
        out["estado"] = "NO_CUMPLE_ALTURA"
    else:
        out["estado"] = "PRESELECCION_CONDICIONADA"
    return out


# --------------------------------------------------------------------------------------------- curvatura


def radio_borde_interior(prod, ancho_mm):
    """Radio del borde interior disponible según la referencia publicada (D-16). None si no se puede saber."""
    if prod.radio_mm is None:
        return None, "SIN_RADIO_PUBLICADO"
    ref = prod.referencia_radio
    if ref == "interior":
        return prod.radio_mm, None
    if ref == "eje" and ancho_mm is not None:
        return prod.radio_mm - ancho_mm / 2.0, None
    if ref == "exterior" and ancho_mm is not None:
        return prod.radio_mm - ancho_mm, None
    return None, "REFERENCIA_DE_RADIO_NO_UTILIZABLE"


def evaluar_curvatura(cable, prod, ancho_mm, giro: str, dir_in, dir_out, dec) -> dict:
    """Curvatura de un cable al atravesar una pieza.
    giro: 'si' (curvas), 'segun_geometria' (T/X), 'no' (rectas), 'transicion' (reducciones)."""
    out = {"pieza_tipo": prod.tipo_pieza, "radio_publicado_mm": prod.radio_mm, "referencia_radio": prod.referencia_radio}
    if giro == "no":
        out["estado"] = "SIN_CURVATURA"
        return out
    if giro == "transicion":
        out["estado"] = "NO_VERIFICABLE_TRANSICION_SIN_RADIO"
        return out
    if giro == "segun_geometria":
        if dir_in is None or dir_out is None:
            out["estado"] = "NO_VERIFICABLE_SIN_GEOMETRIA"
            return out
        if _ang([-x for x in dir_in], dir_out) <= dec["D-14_tolerancia_angulo_grados"] + EPS:
            out["estado"] = "SIN_CURVATURA"
            out["detalle"] = "Atraviesa la pieza de boca a boca opuesta."
            return out
    if prod.tipo_pieza not in ("curva horizontal", "T", "X"):
        out["estado"] = "NO_VERIFICABLE_RADIO_VERTICAL"
        out["detalle"] = "La referencia del radio en curvas verticales no está definida en el catálogo."
        return out
    r_borde, motivo = radio_borde_interior(prod, ancho_mm)
    out["radio_borde_interior_mm"] = r_borde
    out["supuesto"] = "Peor caso: cable contra el ala interior (no se supone que siga el eje) — D-16."
    if r_borde is None:
        out["estado"] = f"NO_VERIFICABLE_{motivo}"
        return out
    if cable.radio_minimo_estado != "publicado":
        out["estado"] = "NO_VERIFICABLE_RADIO_CABLE_NO_PUBLICADO"
        out["detalle"] = f"La ficha de {cable.cable_id} no publica radio mínimo de curvatura."
        return out
    D = cable.diametro_exterior_mm
    evals = []
    for rr in cable.radio_minimo:
        req = rr["multiplo_D"] * D if "multiplo_D" in rr else rr["valor_mm"]
        disp = r_borde + D / 2.0 if rr["referencia"] == "eje_cable" else r_borde
        evals.append({"condicion": rr["condicion"], "referencia": rr["referencia"], "radio_requerido_mm": redondear(req, 3),
                      "radio_disponible_mm": redondear(disp, 3), "cumple": req <= disp + EPS,
                      "fuente": rr.get("fuente")})
    out["evaluaciones"] = evals
    out["estado"] = "CUMPLE" if all(x["cumple"] for x in evals) else "NO_CUMPLE"
    if any(x["referencia"] == "no especificada" for x in evals):
        out["condiciones"] = ["REFERENCIA_RADIO_CABLE_NO_ESPECIFICADA"]
    return out


def tipo_giro(prod) -> str:
    t = prod.tipo_pieza
    if t == "recta":
        return "no"
    if t.startswith("curva"):
        return "si"
    if t in ("T", "X"):
        return "segun_geometria"
    return "transicion"
