"""Validación y normalización de la entrada de un trazado (contrato `trazado/1`).

El trazado tiene cuatro capas independientes:
  1. Piezas y conexiones (grafo de bandejas). La geometría de los puertos la entrega el CAD.
  2. Circuitos: qué cables recorren qué piezas (asignación explícita; nada se reparte automáticamente).
  3. Soportes.
  4. PE y red equipotencial (recorrido físico y conexiones eléctricas, por separado).

Toda referencia se valida: ids únicos, piezas, puertos y productos existentes. Claves desconocidas se rechazan.

`meta` (opcional) es texto libre para el CAD (p. ej. marcar un ejemplo como sintético); no interviene en el
cálculo ni en la huella.
"""
from __future__ import annotations

import math

from .catalogo import Catalogo
from .datos_cables import RegistroCables
from .errores import ErrorEntrada
from .unidades import entero_positivo, numero_finito, pct_a_fraccion, positivo

VERSION_CONTRATO_TRAZADO = "trazado/1"

TIPOS_BANDEJA = ("recta", "curva horizontal", "curva vertical interior", "curva vertical exterior",
                 "curva vertical articulada", "T", "X", "reducción", "final de tramo", "adaptador")
TIPOS_CON_COBERTURA_PE = ("recta", "curva horizontal", "curva vertical interior", "curva vertical exterior",
                          "curva vertical articulada", "T", "X", "reducción")
TIPOS_PUNTO_EQUIPOTENCIAL = ("sistema_proteccion", "derivacion_pe", "conexion_bandeja", "puente")

_CLAVES = {"version_contrato", "tipo_circuito", "reserva_solicitada_pct", "eje_vertical", "piezas", "conexiones",
           "tapas", "accesorios", "circuitos", "soportes", "pe", "equipotencial", "escenario_reserva", "meta"}
_OBLIG = {"version_contrato", "tipo_circuito", "reserva_solicitada_pct", "piezas", "conexiones", "circuitos"}


def _dict(x, campo, claves_ok, oblig=()):
    if not isinstance(x, dict):
        raise ErrorEntrada(f"{campo} debe ser un objeto.", campo=campo)
    extra = set(x) - set(claves_ok)
    if extra:
        raise ErrorEntrada(f"{campo}: claves desconocidas {sorted(extra)}.", campo=campo)
    falta = [k for k in oblig if k not in x]
    if falta:
        raise ErrorEntrada(f"{campo}: faltan {falta}.", campo=campo)
    return x


def _lista(x, campo, vacia_ok=True):
    if not isinstance(x, list) or (not vacia_ok and not x):
        raise ErrorEntrada(f"{campo} debe ser una lista{'' if vacia_ok else ' no vacía'}.", campo=campo)
    return x


def _id(x, campo):
    if not isinstance(x, str) or not x.strip():
        raise ErrorEntrada(f"{campo} debe ser un identificador de texto no vacío.", campo=campo)
    return x


def _vector(v, campo, unitario=False):
    if not isinstance(v, list) or len(v) != 3:
        raise ErrorEntrada(f"{campo} debe ser [x, y, z].", campo=campo)
    xs = [numero_finito(c, campo=campo) for c in v]
    if unitario:
        n = math.sqrt(sum(c * c for c in xs))
        if abs(n - 1.0) > 1e-6:
            raise ErrorEntrada(f"{campo} debe ser unitario (norma {n:.6f}).", campo=campo)
    return xs


def _unicos(items, clave, campo):
    vistos = set()
    for i, it in enumerate(items):
        k = it[clave]
        if k in vistos:
            raise ErrorEntrada(f"{campo}[{i}].{clave} duplicado: {k}.", campo=f"{campo}[{i}].{clave}")
        vistos.add(k)


def validar_trazado(e: dict, cables: RegistroCables, cat: Catalogo) -> dict:
    _dict(e, "entrada", _CLAVES, _OBLIG)
    if e["version_contrato"] != VERSION_CONTRATO_TRAZADO:
        raise ErrorEntrada(f"version_contrato debe ser '{VERSION_CONTRATO_TRAZADO}'.", campo="version_contrato")
    if e["tipo_circuito"] != "potencia":
        raise ErrorEntrada("Solo tipo_circuito 'potencia' (mando y señal sin reglas, D-11).", campo="tipo_circuito")
    pct_a_fraccion(e["reserva_solicitada_pct"], campo="reserva_solicitada_pct")
    eje = _vector(e.get("eje_vertical", [0, 0, 1]), "eje_vertical", unitario=True)

    # ------------------------------------------------------------------ piezas
    piezas = []
    for i, p in enumerate(_lista(e["piezas"], "piezas", vacia_ok=False)):
        c = f"piezas[{i}]"
        _dict(p, c, {"instancia_id", "producto_id", "longitud_mm", "longitud_eje_mm", "puertos"}, ("instancia_id", "producto_id"))
        iid = _id(p["instancia_id"], f"{c}.instancia_id")
        prod = cat.piezas.get(p["producto_id"])
        if prod is None:
            raise ErrorEntrada(f"{c}: producto inexistente {p['producto_id']!r}.", campo=f"{c}.producto_id")
        if prod.tipo_pieza not in TIPOS_BANDEJA:
            raise ErrorEntrada(f"{c}: {prod.producto_id} es '{prod.tipo_pieza}', no una pieza de bandeja.", campo=f"{c}.producto_id")
        norm = {"instancia_id": iid, "producto_id": prod.producto_id}
        if prod.tipo_pieza == "recta":
            if "longitud_mm" not in p:
                raise ErrorEntrada(f"{c}: los tramos rectos requieren longitud_mm.", campo=f"{c}.longitud_mm")
            lon = positivo(p["longitud_mm"], campo=f"{c}.longitud_mm")
            if prod.longitud_comercial_mm is not None and lon > prod.longitud_comercial_mm + 1e-9:
                raise ErrorEntrada(f"{c}: longitud {lon} mm > longitud comercial {prod.longitud_comercial_mm} mm; "
                                   "dividir en piezas con conexiones explícitas.", campo=f"{c}.longitud_mm")
            norm["longitud_mm"] = lon
            if "longitud_eje_mm" in p:
                raise ErrorEntrada(f"{c}: en tramos rectos la longitud de eje es longitud_mm.", campo=f"{c}.longitud_eje_mm")
            norm["longitud_eje_mm"] = lon
        else:
            if "longitud_mm" in p:
                raise ErrorEntrada(f"{c}: longitud_mm solo aplica a tramos rectos (usar longitud_eje_mm).", campo=f"{c}.longitud_mm")
            if "longitud_eje_mm" in p:
                norm["longitud_eje_mm"] = positivo(p["longitud_eje_mm"], campo=f"{c}.longitud_eje_mm")
        nombres = {pu.puerto_id[len(prod.producto_id) + 1:]: pu for pu in cat.puertos.get(prod.producto_id, ())}
        if not nombres:
            raise ErrorEntrada(f"{c}: {prod.producto_id} no tiene puertos en el catálogo.", campo=f"{c}.producto_id")
        geo = {}
        for nom, g in _dict(p.get("puertos", {}), f"{c}.puertos", set(nombres)).items():
            _dict(g, f"{c}.puertos.{nom}", {"posicion_mm", "direccion"}, ("posicion_mm", "direccion"))
            geo[nom] = {"posicion_mm": _vector(g["posicion_mm"], f"{c}.puertos.{nom}.posicion_mm"),
                        "direccion": _vector(g["direccion"], f"{c}.puertos.{nom}.direccion", unitario=True)}
        norm["puertos"] = geo
        norm["_puertos_catalogo"] = sorted(nombres)
        piezas.append(norm)
    _unicos(piezas, "instancia_id", "piezas")
    por_inst = {p["instancia_id"]: p for p in piezas}

    # ------------------------------------------------------------------ conexiones
    conexiones, usados = [], {}
    for i, k in enumerate(_lista(e["conexiones"], "conexiones")):
        c = f"conexiones[{i}]"
        _dict(k, c, {"conexion_id", "a", "b"}, ("conexion_id", "a", "b"))
        cid = _id(k["conexion_id"], f"{c}.conexion_id")
        extremos = []
        for lado in ("a", "b"):
            x = k[lado]
            if not (isinstance(x, list) and len(x) == 2 and all(isinstance(s, str) for s in x)):
                raise ErrorEntrada(f"{c}.{lado} debe ser [instancia_id, puerto].", campo=f"{c}.{lado}")
            inst, pto = x
            if inst not in por_inst:
                raise ErrorEntrada(f"{c}.{lado}: instancia inexistente {inst!r}.", campo=f"{c}.{lado}")
            if pto not in por_inst[inst]["_puertos_catalogo"]:
                raise ErrorEntrada(f"{c}.{lado}: {inst} no tiene puerto {pto!r} (catálogo: {por_inst[inst]['_puertos_catalogo']}).",
                                   campo=f"{c}.{lado}")
            if (inst, pto) in usados:
                raise ErrorEntrada(f"{c}.{lado}: puerto {inst}.{pto} ya usado por {usados[(inst, pto)]}.", campo=f"{c}.{lado}")
            usados[(inst, pto)] = cid
            extremos.append([inst, pto])
        if extremos[0][0] == extremos[1][0]:
            raise ErrorEntrada(f"{c}: conecta una pieza consigo misma.", campo=c)
        conexiones.append({"conexion_id": cid, "a": extremos[0], "b": extremos[1]})
    _unicos(conexiones, "conexion_id", "conexiones")

    # ------------------------------------------------------------------ tapas y accesorios
    tapas = []
    for i, t in enumerate(_lista(e.get("tapas", []), "tapas")):
        c = f"tapas[{i}]"
        _dict(t, c, {"tapa_id", "producto_id", "sobre"}, ("tapa_id", "producto_id", "sobre"))
        prod = cat.piezas.get(t["producto_id"])
        if prod is None or prod.tipo_pieza != "tapa":
            raise ErrorEntrada(f"{c}: {t['producto_id']!r} no es una tapa del catálogo.", campo=f"{c}.producto_id")
        if t["sobre"] not in por_inst:
            raise ErrorEntrada(f"{c}.sobre: instancia inexistente.", campo=f"{c}.sobre")
        tapas.append({"tapa_id": _id(t["tapa_id"], f"{c}.tapa_id"), "producto_id": prod.producto_id, "sobre": t["sobre"]})
    _unicos(tapas, "tapa_id", "tapas")
    accesorios = []
    for i, t in enumerate(_lista(e.get("accesorios", []), "accesorios")):
        c = f"accesorios[{i}]"
        _dict(t, c, {"accesorio_id", "producto_id", "sobre"}, ("accesorio_id", "producto_id", "sobre"))
        if t["producto_id"] not in cat.piezas:
            raise ErrorEntrada(f"{c}: producto inexistente.", campo=f"{c}.producto_id")
        if t["sobre"] not in por_inst:
            raise ErrorEntrada(f"{c}.sobre: instancia inexistente.", campo=f"{c}.sobre")
        accesorios.append({"accesorio_id": _id(t["accesorio_id"], f"{c}.accesorio_id"),
                           "producto_id": t["producto_id"], "sobre": t["sobre"]})
    _unicos(accesorios, "accesorio_id", "accesorios")

    # ------------------------------------------------------------------ circuitos
    pe_in = e.get("pe")
    circuitos = []
    for i, k in enumerate(_lista(e["circuitos"], "circuitos")):
        c = f"circuitos[{i}]"
        _dict(k, c, {"circuito_id", "funcion", "cable_id", "cantidad", "separado", "recorrido"},
              ("circuito_id", "funcion", "cable_id", "cantidad", "separado", "recorrido"))
        if k["funcion"] != "potencia":
            raise ErrorEntrada(f"{c}.funcion: solo 'potencia'. El PE se declara únicamente en la sección 'pe' "
                               "(evita contarlo dos veces).", campo=f"{c}.funcion")
        cables.obtener(k["cable_id"])
        if not isinstance(k["separado"], bool):
            raise ErrorEntrada(f"{c}.separado debe ser true/false.", campo=f"{c}.separado")
        rec = _recorrido(k["recorrido"], f"{c}.recorrido", por_inst)
        circuitos.append({"circuito_id": _id(k["circuito_id"], f"{c}.circuito_id"), "funcion": "potencia",
                          "cable_id": k["cable_id"], "cantidad": entero_positivo(k["cantidad"], campo=f"{c}.cantidad"),
                          "separado": k["separado"], "recorrido": rec})
    _unicos(circuitos, "circuito_id", "circuitos")

    # ------------------------------------------------------------------ soportes
    soportes = []
    for i, s in enumerate(_lista(e.get("soportes", []), "soportes")):
        c = f"soportes[{i}]"
        _dict(s, c, {"soporte_id", "sistema_soporte_id", "producto_id", "instancia_id", "distancia_desde_P1_mm"},
              ("soporte_id", "sistema_soporte_id", "producto_id", "instancia_id", "distancia_desde_P1_mm"))
        if s["sistema_soporte_id"] not in cat.sistemas_soporte:
            raise ErrorEntrada(f"{c}: sistema de soporte inexistente.", campo=f"{c}.sistema_soporte_id")
        if s["producto_id"] not in cat.piezas:
            raise ErrorEntrada(f"{c}: producto inexistente.", campo=f"{c}.producto_id")
        if s["instancia_id"] not in por_inst:
            raise ErrorEntrada(f"{c}: instancia inexistente.", campo=f"{c}.instancia_id")
        d = numero_finito(s["distancia_desde_P1_mm"], campo=f"{c}.distancia_desde_P1_mm")
        lon = por_inst[s["instancia_id"]].get("longitud_eje_mm")
        if d < 0 or (lon is not None and d > lon + 1e-9):
            raise ErrorEntrada(f"{c}: distancia fuera de la pieza (0…{lon} mm).", campo=f"{c}.distancia_desde_P1_mm")
        soportes.append({"soporte_id": _id(s["soporte_id"], f"{c}.soporte_id"), "sistema_soporte_id": s["sistema_soporte_id"],
                         "producto_id": s["producto_id"], "instancia_id": s["instancia_id"], "distancia_desde_P1_mm": d})
    _unicos(soportes, "soporte_id", "soportes")

    # ------------------------------------------------------------------ PE
    pe = None
    if pe_in is not None:
        _dict(pe_in, "pe", {"seccion_requerida_mm2", "cable_id", "conductores", "origen_requisito"},
              ("seccion_requerida_mm2", "cable_id", "conductores"))
        cables.obtener(pe_in["cable_id"])
        cond = []
        for i, k in enumerate(_lista(pe_in["conductores"], "pe.conductores", vacia_ok=False)):
            c = f"pe.conductores[{i}]"
            _dict(k, c, {"conductor_id", "recorrido", "inicio", "fin"}, ("conductor_id", "recorrido", "inicio", "fin"))
            cond.append({"conductor_id": _id(k["conductor_id"], f"{c}.conductor_id"),
                         "recorrido": _recorrido(k["recorrido"], f"{c}.recorrido", por_inst, tramos=True),
                         "inicio": k["inicio"], "fin": k["fin"]})
        _unicos(cond, "conductor_id", "pe.conductores")
        if any(k["cable_id"] == pe_in["cable_id"] for k in circuitos):
            raise ErrorEntrada("El cable del PE figura también como circuito de potencia: se contaría dos veces.",
                               campo="circuitos")
        pe = {"seccion_requerida_mm2": positivo(pe_in["seccion_requerida_mm2"], campo="pe.seccion_requerida_mm2"),
              "cable_id": pe_in["cable_id"], "origen_requisito": pe_in.get("origen_requisito"), "conductores": cond}

    # ------------------------------------------------------------------ equipotencial
    puntos = []
    eq = e.get("equipotencial", {"puntos": []})
    _dict(eq, "equipotencial", {"puntos"}, ("puntos",))
    ids_cond = {k["conductor_id"] for k in (pe["conductores"] if pe else [])}
    for i, q in enumerate(_lista(eq["puntos"], "equipotencial.puntos")):
        c = f"equipotencial.puntos[{i}]"
        _dict(q, c, {"punto_id", "tipo", "conductores", "instancias", "conector", "descripcion", "conductor_puente"},
              ("punto_id", "tipo"))
        if q["tipo"] not in TIPOS_PUNTO_EQUIPOTENCIAL:
            raise ErrorEntrada(f"{c}.tipo inválido; valores {TIPOS_PUNTO_EQUIPOTENCIAL}.", campo=f"{c}.tipo")
        conds = _lista(q.get("conductores", []), f"{c}.conductores")
        insts = _lista(q.get("instancias", []), f"{c}.instancias")
        for x in conds:
            if x not in ids_cond:
                raise ErrorEntrada(f"{c}: conductor PE inexistente {x!r}.", campo=f"{c}.conductores")
        for x in insts:
            if x not in por_inst:
                raise ErrorEntrada(f"{c}: instancia inexistente {x!r}.", campo=f"{c}.instancias")
        req = {"sistema_proteccion": (1, None, 0, 0), "derivacion_pe": (2, None, 0, 1),
               "conexion_bandeja": (1, 1, 1, 1), "puente": (0, 0, 2, 2)}[q["tipo"]]
        if not (req[0] <= len(conds) and (req[1] is None or len(conds) <= req[1]) and req[2] <= len(insts) <= req[3]):
            raise ErrorEntrada(f"{c}: cantidad de conductores/instancias inválida para '{q['tipo']}'.", campo=c)
        conector = q.get("conector")
        if conector is not None:
            _dict(conector, f"{c}.conector", {"producto_id", "descripcion"})
            if conector.get("producto_id") is not None and conector["producto_id"] not in cat.piezas:
                raise ErrorEntrada(f"{c}.conector: producto inexistente.", campo=f"{c}.conector")
        cp = q.get("conductor_puente")
        if cp is not None:
            if q["tipo"] != "puente":
                raise ErrorEntrada(f"{c}: conductor_puente solo en puntos tipo 'puente'.", campo=c)
            _dict(cp, f"{c}.conductor_puente", {"cable_id", "longitud_mm"}, ("cable_id",))
            cables.obtener(cp["cable_id"])
            if "longitud_mm" in cp:
                positivo(cp["longitud_mm"], campo=f"{c}.conductor_puente.longitud_mm")
        puntos.append({"punto_id": _id(q["punto_id"], f"{c}.punto_id"), "tipo": q["tipo"], "conductores": list(conds),
                       "instancias": list(insts), "conector": conector, "descripcion": q.get("descripcion"),
                       "conductor_puente": cp})
    _unicos(puntos, "punto_id", "equipotencial.puntos")
    ids_puntos = {q["punto_id"] for q in puntos}
    if pe:
        for k in pe["conductores"]:
            for ext in ("inicio", "fin"):
                v = k[ext]
                if v is not None and v not in ids_puntos:
                    raise ErrorEntrada(f"pe.conductores {k['conductor_id']}.{ext}: punto inexistente {v!r}.",
                                       campo=f"pe.conductores.{ext}")

    # ------------------------------------------------------------------ escenario de reserva (opcional)
    escenario = None
    if e.get("escenario_reserva") is not None:
        er = _dict(e["escenario_reserva"], "escenario_reserva", {"descripcion", "circuitos"}, ("circuitos",))
        adic = []
        for i, k in enumerate(_lista(er["circuitos"], "escenario_reserva.circuitos", vacia_ok=False)):
            c = f"escenario_reserva.circuitos[{i}]"
            _dict(k, c, {"circuito_id", "cable_id", "cantidad", "separado", "recorrido"},
                  ("circuito_id", "cable_id", "cantidad", "separado", "recorrido"))
            cables.obtener(k["cable_id"])
            adic.append({"circuito_id": _id(k["circuito_id"], f"{c}.circuito_id"), "cable_id": k["cable_id"],
                         "cantidad": entero_positivo(k["cantidad"], campo=f"{c}.cantidad"),
                         "separado": _bool(k["separado"], f"{c}.separado"),
                         "recorrido": _recorrido(k["recorrido"], f"{c}.recorrido", por_inst)})
        escenario = {"descripcion": er.get("descripcion"), "circuitos": adic}

    for p in piezas:
        p.pop("_puertos_catalogo")
    return {"version_contrato": VERSION_CONTRATO_TRAZADO, "tipo_circuito": "potencia",
            "reserva_solicitada_pct": float(e["reserva_solicitada_pct"]), "eje_vertical": eje,
            "piezas": piezas, "conexiones": conexiones, "tapas": tapas, "accesorios": accesorios,
            "circuitos": circuitos, "soportes": soportes, "pe": pe, "equipotencial": {"puntos": puntos},
            "escenario_reserva": escenario}


def _bool(x, campo):
    if not isinstance(x, bool):
        raise ErrorEntrada(f"{campo} debe ser true/false.", campo=campo)
    return x


def _recorrido(rec, campo, por_inst, tramos=False):
    """Lista ordenada de instancias. Con tramos=True admite {"instancia": id, "longitud_mm": x} (tramo parcial)."""
    _lista(rec, campo, vacia_ok=False)
    out = []
    for j, x in enumerate(rec):
        if isinstance(x, str):
            inst, lon = x, None
        elif tramos and isinstance(x, dict):
            _dict(x, f"{campo}[{j}]", {"instancia", "longitud_mm"}, ("instancia",))
            inst = x["instancia"]
            lon = positivo(x["longitud_mm"], campo=f"{campo}[{j}].longitud_mm") if "longitud_mm" in x else None
        else:
            raise ErrorEntrada(f"{campo}[{j}] debe ser un instancia_id.", campo=f"{campo}[{j}]")
        if inst not in por_inst:
            raise ErrorEntrada(f"{campo}[{j}]: instancia inexistente {inst!r}.", campo=f"{campo}[{j}]")
        out.append({"instancia": inst, "longitud_mm": lon} if tramos else inst)
    ids = [o["instancia"] if tramos else o for o in out]
    if len(set(ids)) != len(ids):
        raise ErrorEntrada(f"{campo}: una instancia aparece más de una vez.", campo=campo)
    return out
