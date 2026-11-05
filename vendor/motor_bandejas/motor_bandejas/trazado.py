"""Cálculo de un trazado completo (contrato `trazado/1`).

El resultado nunca es una aprobación: el estado más favorable es `PRESELECCION_CONDICIONADA`.
"""
from __future__ import annotations

import copy

from . import __version__
from .computo import computar
from .equipotencial import evaluar_equipotencial, evaluar_pe
from .errores import ErrorMotor
from .procedencia import huella
from .soportes import corridas_rectas, evaluar_soporte, evaluar_vanos
from .trazado_analisis import (IndiceCompat, analizar_recorrido, encaje_conexion, evaluar_curvatura, geometria_pieza,
                               ocupacion_seccion, secciones_de_pieza, tipo_giro)
from .trazado_entrada import validar_trazado
from .unidades import redondear

AVISO = ("Resultado de preselección. No aprueba la instalación: no contrasta todas las condiciones de montaje y "
         "ensayo, ni verifica eléctricamente (intensidad, PE frente a la falla, continuidad medida).")


def _huella(norm, cables, cat, dec):
    return huella(entrada_normalizada=norm, version_cables=cables.version(), version_catalogo=cat.version(),
                  decisiones=dec, version_motor=__version__)


def calcular_trazado(entrada: dict, cables, cat, decisiones: dict) -> dict:
    norm = validar_trazado(entrada, cables, cat)
    dec = copy.deepcopy(decisiones)
    piezas = {p["instancia_id"]: p for p in norm["piezas"]}
    prod_de = {i: cat.piezas[p["producto_id"]] for i, p in piezas.items()}
    eje = norm["eje_vertical"]
    r = norm["reserva_solicitada_pct"] / 100.0
    criterio = dec["D-05_criterio_reserva"]

    conex_por_par = {}
    for k in norm["conexiones"]:
        (ia, pa), (ib, pb) = k["a"], k["b"]
        d = {"conexion_id": k["conexion_id"], ia: pa, ib: pb}
        conex_por_par[(ia, ib)] = d
        conex_por_par[(ib, ia)] = d
    idx = IndiceCompat(cat)

    # 1. Conexiones: compatibilidad y encaje (independientes entre sí)
    conexiones = {}
    for k in norm["conexiones"]:
        (ia, pa), (ib, pb) = k["a"], k["b"]
        comp = idx.evaluar(f"{piezas[ia]['producto_id']}-{pa}", f"{piezas[ib]['producto_id']}-{pb}",
                           aplicar_d13=dec["D-13_equivalencia_extremos_recta"] == "aplicar_con_condicion")
        enc = encaje_conexion(piezas[ia]["puertos"].get(pa), piezas[ib]["puertos"].get(pb), dec)
        conexiones[k["conexion_id"]] = {"a": k["a"], "b": k["b"], "compatibilidad": comp, "encaje": enc}

    # 2. Geometría interna de cada pieza
    geo_piezas = {i: geometria_pieza(p, prod_de[i], eje, dec) for i, p in piezas.items()}

    # 3. Recorridos de circuitos y curvatura de cada cable (el PE se trata aparte)
    def curvaturas(cable, rec):
        out = []
        for paso in rec["pasos"]:
            inst = paso["instancia"]
            prod = prod_de[inst]
            g = piezas[inst]["puertos"]
            anchos = [pu.ancho_nominal_mm for pu in cat.puertos.get(prod.producto_id, ())]
            ancho = min(a for a in anchos if a is not None) if any(a is not None for a in anchos) else None
            if tipo_giro(prod) == "no":
                continue
            if paso["puerto_entrada"] is None or paso["puerto_salida"] is None:
                out.append({"instancia": inst, "estado": "NO_EVALUADO_EXTREMO_DE_RECORRIDO",
                            "detalle": "El cable entra o sale de la bandeja en esta pieza; su trayectoria no está modelada."})
                continue
            gi, go = g.get(paso["puerto_entrada"]), g.get(paso["puerto_salida"])
            ev = evaluar_curvatura(cable, prod, ancho, tipo_giro(prod), gi["direccion"] if gi else None,
                                   go["direccion"] if go else None, dec)
            ev["instancia"] = inst
            out.append(ev)
        return out

    circuitos, cruces = {}, {}
    for k in norm["circuitos"]:
        cable = cables.obtener(k["cable_id"])
        rec = analizar_recorrido(k["recorrido"], conex_por_par)
        circuitos[k["circuito_id"]] = {"cable_id": k["cable_id"], "cantidad": k["cantidad"], "separado": k["separado"],
                                      "recorrido": rec, "curvatura": curvaturas(cable, rec)}

    # 4. PE (recorrido físico)
    pe_res = evaluar_pe(norm, cables, cat, conex_por_par, dec.get("D-21_identificacion_pe_requerida"),
                        dec.get("D-20_seccion_pe_mm2"), dec["D-14_tolerancia_posicion_mm"])
    pe_cable = cables.obtener(norm["pe"]["cable_id"]) if norm["pe"] else None
    if norm["pe"]:
        for c in pe_res["conductores"]:
            c["curvatura"] = curvaturas(pe_cable, c["recorrido"])

    # 5. Cables por pieza y por puerto (de los recorridos explícitos)
    def cruces_por_puerto(lista_rec):
        out = {}
        for ident, rec in lista_rec:
            for paso in rec["pasos"]:
                for pto in (paso["puerto_entrada"], paso["puerto_salida"]):
                    if pto:
                        out.setdefault((paso["instancia"], pto), []).append(ident)
        return out
    cir_rec = [(cid, c["recorrido"]) for cid, c in circuitos.items()]
    pe_rec = [(c["conductor_id"], c["recorrido"]) for c in pe_res["conductores"]]
    cir_pto, pe_pto = cruces_por_puerto(cir_rec), cruces_por_puerto(pe_rec)
    cir_pieza = {}
    for cid, c in circuitos.items():
        for paso in c["recorrido"]["pasos"]:
            cir_pieza.setdefault(paso["instancia"], []).append(cid)
    pe_pieza = pe_res.get("conductores_por_pieza", {})

    def usos(ids_cir):
        out = []
        for cid in ids_cir:
            k = circuitos[cid]
            sep = k["separado"]
            out.append({"cable": cables.obtener(k["cable_id"]), "cantidad": k["cantidad"],
                        "disposicion": "separado" if sep else dec["D-02_separado_desactivado_equivale_a"],
                        "apilado": False, "decision_disposicion": "D-01" if sep else "D-02"})
        return out

    ocupacion = {}
    for i, p in piezas.items():
        prod = prod_de[i]
        pts = cat.puertos.get(prod.producto_id, ())
        modo = secciones_de_pieza(prod, cat)
        secs = {}
        if modo == "pieza":
            pu = pts[0] if pts else None
            secs["pieza"] = ocupacion_seccion(usos(cir_pieza.get(i, [])), pe_cable, len(pe_pieza.get(i, [])),
                                              pu.ancho_nominal_mm if pu else prod.ancho_nominal_mm,
                                              pu.ala_nominal_mm if pu else prod.ala_nominal_mm, r, criterio, dec)
            secs["pieza"]["circuitos"] = cir_pieza.get(i, [])
        else:
            for pu in pts:
                nom = pu.puerto_id[len(prod.producto_id) + 1:]
                cs = cir_pto.get((i, nom), [])
                secs[nom] = ocupacion_seccion(usos(cs), pe_cable, len(pe_pto.get((i, nom), [])), pu.ancho_nominal_mm,
                                              pu.ala_nominal_mm, r, criterio, dec)
                secs[nom]["circuitos"] = cs
        ocupacion[i] = {"modo_seccion": modo, "secciones": secs}

    # 6. Cargas por pieza (masa lineal)
    tapas_por_pieza = {}
    for t in norm["tapas"]:
        tapas_por_pieza.setdefault(t["sobre"], []).append(t["tapa_id"])

    def cargas(extra=None):
        out = {}
        for i in piezas:
            q_cab = sum(circuitos[c]["cantidad"] * cables.obtener(circuitos[c]["cable_id"]).masa_kg_m for c in cir_pieza.get(i, []))
            n_pe = len(pe_pieza.get(i, []))
            q_pe = n_pe * pe_cable.masa_kg_m if pe_cable else 0.0
            q_x = sum(k["cantidad"] * cables.obtener(k["cable_id"]).masa_kg_m for k in (extra or []) if i in k["recorrido"])
            out[i] = {"q_kg_m": redondear(q_cab + q_pe + q_x), "cables_potencia_kg_m": redondear(q_cab),
                      "pe_kg_m": redondear(q_pe), "conductores_pe": n_pe, "escenario_kg_m": redondear(q_x),
                      "tapas": tapas_por_pieza.get(i, []),
                      "masa_tapa": "NO_PUBLICADA" if tapas_por_pieza.get(i) else None}
        return out
    cargas_act = cargas()

    # 7. Soportes y vanos
    corr = corridas_rectas(piezas, norm["conexiones"], cat)
    vanos = evaluar_vanos(corr, norm["soportes"], piezas, cargas_act, tapas_por_pieza, cat, dec)
    vanos_esc = None
    if norm["escenario_reserva"]:
        car_esc = cargas(norm["escenario_reserva"]["circuitos"])
        vanos_esc = evaluar_vanos(corr, norm["soportes"], piezas, car_esc, tapas_por_pieza, cat, dec, "reserva_ocupada")
    en_rectas = {t["instancia"] for c in corr for t in c["tramos"]}
    sop = []
    for s in norm["soportes"]:
        ev = evaluar_soporte(s, piezas, cat)
        if s["instancia_id"] not in en_rectas:
            ev["colocacion"] = {"estado": "SIN_REGLA_ACREDITADA",
                                "detalle": f"Soporte sobre pieza especial ({prod_de[s['instancia_id']].tipo_pieza}); "
                                           "no interviene en vanos lineales."}
        sop.append(ev)

    # 8. Tapas y accesorios
    tapas = {t["tapa_id"]: idx.accesorio(t["producto_id"], piezas[t["sobre"]]["producto_id"]) for t in norm["tapas"]}
    accesorios = {a["accesorio_id"]: idx.accesorio(a["producto_id"], piezas[a["sobre"]]["producto_id"])
                  for a in norm["accesorios"]}

    # 9. Equipotencial y cómputo
    eq = evaluar_equipotencial(norm, cat, pe_res)
    comp = computar(norm, cat, conexiones, tapas, accesorios, pe_res, eq)

    res = {
        "motor": {"nombre": "motor_bandejas", "version": __version__, "contrato": norm["version_contrato"]},
        "huella": _huella(norm, cables, cat, dec),
        "vigencia": "VIGENTE",
        "entrada": norm,
        "datos": {"cables": cables.version(), "catalogo": cat.procedencia()},
        "decisiones": {"version": dec.get("version_decisiones"), "valores": dec},
        "conexiones": conexiones, "geometria_piezas": geo_piezas, "circuitos": circuitos,
        "ocupacion": ocupacion, "cargas_por_pieza": cargas_act,
        "corridas": vanos, "corridas_escenario_reserva": vanos_esc if vanos_esc is not None else
        {"estado": "NO_DEFINIDO", "detalle": "La ocupación futura de la reserva es un escenario distinto: requiere declarar "
                                             "los circuitos previstos (escenario_reserva)."},
        "soportes": sop, "tapas": tapas, "accesorios": accesorios,
        "pe": pe_res, "equipotencial": eq, "computo": comp,
        "verificacion_electrica": {"estado": "NO_REALIZADA", "aviso": AVISO},
    }
    res["resumen"] = _resumen(res)
    return res


def _cuenta(estados):
    out = {}
    for e in estados:
        out[e] = out.get(e, 0) + 1
    return dict(sorted(out.items()))


def _resumen(res) -> dict:
    comp = _cuenta(c["compatibilidad"]["estado"] for c in res["conexiones"].values())
    enc = _cuenta(c["encaje"]["estado"] for c in res["conexiones"].values())
    geo = _cuenta(g["estado"] for g in res["geometria_piezas"].values())
    rec = _cuenta(c["recorrido"]["estado"] for c in res["circuitos"].values())
    ocu = _cuenta(s["estado"] for o in res["ocupacion"].values() for s in o["secciones"].values())
    cur = _cuenta(x["estado"] for c in res["circuitos"].values() for x in c["curvatura"])
    van = _cuenta(v["estado"] for c in res["corridas"] for v in c["vanos"])
    corr = _cuenta(c["estado"] for c in res["corridas"])
    cur_pe = _cuenta(x["estado"] for c in res["pe"]["conductores"] for x in c.get("curvatura", []))
    sop = _cuenta(s["aplicabilidad"]["estado"] for s in res["soportes"])
    est = res["equipotencial"]["estados"]
    incumpl = []
    if comp.get("NO_COMPATIBLE"):
        incumpl.append("conexiones no compatibles")
    if enc.get("INCOHERENTE") or geo.get("INCOHERENTE"):
        incumpl.append("geometría del CAD incoherente")
    if rec.get("DISCONTINUO") or any(c["recorrido"]["estado"] != "CONTINUO" for c in res["pe"]["conductores"]):
        incumpl.append("recorridos discontinuos")
    if any(k.startswith("NO_CUMPLE") for k in ocu):
        incumpl.append("ocupación/reserva/altura")
    if cur.get("NO_CUMPLE") or cur_pe.get("NO_CUMPLE"):
        incumpl.append("radio de curvatura")
    if van.get("NO_CUMPLE"):
        incumpl.append("capacidad de bandeja en vanos")
    cab_pe = res["pe"].get("cable") or {}
    if cab_pe.get("estado_seccion") not in (None, "COINCIDE_CON_REQUISITO"):
        incumpl.append("sección del PE distinta del requisito")
    if cab_pe.get("estado_color") == "NO_CUMPLE_REQUISITO":
        incumpl.append("identificación del PE (color) no declarada")
    req = res["pe"].get("requisito") or {}
    if req.get("estado") == "ENTRADA_DISTINTA_DEL_REQUISITO_APROBADO":
        incumpl.append("requisito del PE redefinido en la entrada")
    if est["cobertura_fisica_pe"] == "INCOMPLETA":
        incumpl.append("cobertura del PE incompleta")
    if est["conexion_sistema_proteccion"] != "PRESENTE":
        incumpl.append("PE sin conexión al sistema de protección")
    if est.get("conductores_sin_vinculo_al_sistema_proteccion"):
        incumpl.append("conductores PE sin vínculo con el sistema de protección")
    if est.get("puntos_fisicamente_inconsistentes"):
        incumpl.append("puntos equipotenciales físicamente inconsistentes")
    sin_verificar = []
    if est["cobertura_fisica_pe"] == "INDETERMINADA":
        sin_verificar.append("cobertura del PE indeterminada (tramos parciales sin posición o sin longitud de eje)")
    if req.get("estado") == "SIN_REQUISITO_APROBADO_EN_DECISIONES":
        sin_verificar.append("requisito del PE no cargado en decisiones (D-20)")
    bloqueos = sorted({s["bloqueo"].get("decision_id") for o in res["ocupacion"].values() for s in o["secciones"].values()
                       if s["estado"] == "BLOQUEADO"} - {None})
    estado = "CON_INCUMPLIMIENTOS" if incumpl else (
        "CON_BLOQUEOS" if bloqueos or sin_verificar else "PRESELECCION_CONDICIONADA")
    return {"estado_trazado": estado, "incumplimientos": incumpl, "decisiones_que_bloquean": bloqueos,
            "verificaciones_bloqueadas": sin_verificar,
            "compatibilidad": comp, "encaje": enc, "geometria_piezas": geo, "recorridos": rec, "ocupacion": ocu,
            "curvatura": cur, "curvatura_pe": cur_pe, "vanos": van, "corridas": corr, "aplicabilidad_soportes": sop, "equipotencial": est, "lineas_computo_pendientes": res["computo"]["lineas_pendientes"],
            "aviso": AVISO}


def resultado_trazado_vigente(resultado, entrada, cables, cat, decisiones) -> bool:
    if resultado is None or entrada is None:
        return False
    try:
        norm = validar_trazado(entrada, cables, cat)
    except ErrorMotor:
        return False
    return resultado.get("huella") == _huella(norm, cables, cat, decisiones)


class SesionTrazado:
    """Igual criterio que SesionSector: revalida la huella en cada acceso; cualquier cambio de trazado, cables,
    piezas, soportes, conexiones, datos o decisiones deja el resultado DESACTUALIZADO."""

    def __init__(self, cables, cat, decisiones, entrada=None):
        self._cables, self._cat, self._dec = cables, cat, decisiones
        self._entrada = copy.deepcopy(entrada)
        self._resultado = None

    def _revalidar(self) -> bool:
        if self._resultado is None:
            return False
        if self._resultado["vigencia"] == "VIGENTE" and resultado_trazado_vigente(
                self._resultado, self._entrada, self._cables, self._cat, self._dec):
            return True
        self._resultado["vigencia"] = "DESACTUALIZADO"
        return False

    def establecer_entrada(self, entrada):
        self._entrada = copy.deepcopy(entrada)
        self._revalidar()

    def actualizar_contexto(self, *, cables=None, catalogo=None, decisiones=None):
        self._cables = cables or self._cables
        self._cat = catalogo or self._cat
        self._dec = decisiones if decisiones is not None else self._dec
        self._revalidar()

    @property
    def entrada(self):
        return copy.deepcopy(self._entrada)

    def calcular(self):
        self._resultado = None
        self._resultado = calcular_trazado(self._entrada, self._cables, self._cat, self._dec)
        return copy.deepcopy(self._resultado)

    def vigente(self) -> bool:
        return self._revalidar()

    @property
    def resultado(self):
        self._revalidar()
        return copy.deepcopy(self._resultado)
