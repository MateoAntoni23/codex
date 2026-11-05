"""PE y red equipotencial: recorrido físico y conexiones eléctricas como dos capas distintas.

- Que el PE pase por una bandeja NO demuestra una conexión eléctrica con ella.
- Una unión mecánica entre bandejas NO se considera continuidad eléctrica: el catálogo no la declara.
- No se exige un puente en cada unión: el requisito por pieza no está documentado (D-26). Se informa qué
  piezas tienen un vínculo previsto y cuáles no.
- La conectividad del modelo NO es continuidad medida ni verificación de impedancia.
"""
from __future__ import annotations

from .trazado_analisis import IndiceCompat, analizar_recorrido
from .trazado_entrada import TIPOS_CON_COBERTURA_PE
from .unidades import redondear


def _seccion_unipolar(cable):
    if cable.n_conductores != 1:
        return None
    try:
        return float(cable.formacion.replace(",", "."))
    except ValueError:
        return None


def evaluar_cable_pe(cable, seccion_req, color_req=None) -> dict:
    s = _seccion_unipolar(cable)
    obs = []
    if s is None:
        estado = "NO_APTO_NO_UNIPOLAR"
    elif abs(s - seccion_req) > 1e-9:
        estado = "NO_COINCIDE_CON_REQUISITO"
        obs.append(f"Sección {s} mm² ≠ requisito {seccion_req} mm².")
    else:
        estado = "COINCIDE_CON_REQUISITO"
    if cable.material != "cobre":
        obs.append(f"Material {cable.material}: compatibilidad con conectores no verificada.")
    tiene_va = any("verde/amarillo" in c for c in cable.colores)
    if color_req:
        estado_color = "CUMPLE" if tiene_va else "NO_CUMPLE_REQUISITO"
        if not tiene_va:
            obs.append(f"Requisito del usuario: aislación {color_req}; la ficha no la declara.")
    else:
        estado_color = "SIN_REQUISITO"
        if not tiene_va:
            obs.append("La ficha no declara aislación verde/amarillo: identificación como PE no documentada.")
    if not any("bandeja" in c for c in cable.condiciones_empleo):
        obs.append(f"Las condiciones de empleo de la ficha ({', '.join(cable.condiciones_empleo) or 'no declaradas'}) "
                   "no incluyen bandejas: admisibilidad en bandeja a verificar con la reglamentación.")
    if cable.radio_minimo_estado != "publicado":
        obs.append("Radio mínimo de curvatura no publicado en la ficha.")
    return {"cable_id": cable.cable_id, "seccion_mm2": s, "material": cable.material,
            "diametro_exterior_mm": cable.diametro_exterior_mm, "masa_kg_m": cable.masa_kg_m,
            "colores": list(cable.colores), "condiciones_empleo": list(cable.condiciones_empleo),
            "procedencia": cable.procedencia(), "estado_seccion": estado, "requisito_color": color_req,
            "estado_color": estado_color, "observaciones": obs,
            "estado_eleccion": "MODELO_A_CONFIRMAR (D-21: requisitos 16 mm² verde/amarillo aprobados)"}


def evaluar_pe(norm: dict, cables, cat, conex_por_par: dict, color_req=None, seccion_aprobada=None,
               tol_mm: float = 1.0) -> dict:
    """`seccion_aprobada` es el requisito D-20 de las decisiones: la entrada no puede redefinirlo (auditoría H2).
    Cobertura por pieza (auditoría H1): COMPLETA si algún conductor la recorre entera; PARCIAL si solo hay tramos
    parciales cuya suma no alcanza la longitud de eje; INDETERMINADA si la longitud de eje no se conoce o la suma
    alcanza pero el CAD no informa la posición de los tramos. Un tramo parcial solo es físico en los extremos del
    recorrido de un conductor (para pasar a la pieza siguiente hay que recorrer la pieza entera)."""
    pe = norm["pe"]
    piezas = {p["instancia_id"]: p for p in norm["piezas"]}
    requeridas = [i for i, p in piezas.items() if cat.piezas[p["producto_id"]].tipo_pieza in TIPOS_CON_COBERTURA_PE]
    if pe is None:
        return {"estado_requisito": "SIN_PE_DEFINIDO", "cable": None, "conductores": [],
                "cobertura": {"estado": "INCOMPLETA", "piezas_sin_pe": sorted(requeridas), "piezas_requeridas": len(requeridas),
                              "piezas_con_cobertura_parcial": [], "piezas_con_cobertura_indeterminada": [],
                              "por_pieza": {i: {"estado": "SIN_PE"} for i in sorted(requeridas)}},
                "requisito": _requisito(None, seccion_aprobada)}
    cable = cables.obtener(pe["cable_id"])
    conds, cubiertas, aportes = [], {}, {}
    for k in pe["conductores"]:
        ids = [t["instancia"] for t in k["recorrido"]]
        rec = analizar_recorrido(ids, conex_por_par)
        lon, falt, detalle = 0.0, [], []
        n = len(k["recorrido"])
        for j, t in enumerate(k["recorrido"]):
            p = piezas[t["instancia"]]
            l_pieza = p.get("longitud_eje_mm")
            parcial = t["longitud_mm"] is not None
            l = t["longitud_mm"] if parcial else l_pieza
            if parcial and l_pieza is not None and t["longitud_mm"] > l_pieza + 1e-9:
                falt.append(f"{t['instancia']}: tramo parcial {t['longitud_mm']} mm > longitud de eje {l_pieza} mm")
            intermedio = parcial and 0 < j < n - 1
            if intermedio:
                falt.append(f"{t['instancia']}: tramo parcial intermedio ({t['longitud_mm']} mm): para pasar a la pieza "
                            "siguiente el conductor debe recorrer la pieza entera")
            if l is None:
                falt.append(f"{t['instancia']}: longitud de eje no informada por el CAD")
            else:
                lon += l
            detalle.append({"instancia": t["instancia"], "longitud_mm": l, "parcial": parcial,
                            **({"parcial_intermedio_incoherente": True} if intermedio else {})})
            cubiertas.setdefault(t["instancia"], []).append(k["conductor_id"])
            entera = not parcial or (l_pieza is not None and t["longitud_mm"] >= l_pieza - tol_mm - 1e-9)
            aportes.setdefault(t["instancia"], []).append({"conductor_id": k["conductor_id"], "entera": entera,
                                                           "longitud_mm": t["longitud_mm"]})
        conds.append({"conductor_id": k["conductor_id"], "recorrido": rec, "tramos": detalle,
                      "longitud_geometrica_mm": redondear(lon), "longitud_completa": not falt, "faltantes": falt,
                      "holgura_mm": None, "holgura_regla": "sin regla explícita: no se aplica (D-27)",
                      "inicio": k["inicio"], "fin": k["fin"]})
    por_pieza = {}
    for i in sorted(requeridas):
        ap = aportes.get(i, [])
        l_ref = piezas[i].get("longitud_eje_mm")
        if not ap:
            est = {"estado": "SIN_PE"}
        elif any(x["entera"] for x in ap):
            est = {"estado": "COMPLETA", "conductores_que_la_recorren_entera": [x["conductor_id"] for x in ap if x["entera"]]}
        else:
            suma = sum(x["longitud_mm"] for x in ap)
            if l_ref is not None and suma < l_ref - tol_mm - 1e-9:
                est = {"estado": "PARCIAL", "longitud_cubierta_max_mm": redondear(suma), "longitud_eje_mm": l_ref}
            else:
                est = {"estado": "INDETERMINADA", "suma_parciales_mm": redondear(suma), "longitud_eje_mm": l_ref,
                       "detalle": "Longitud de eje no informada o tramos parciales sin posición: no se puede afirmar "
                                  "que cubran la pieza."}
        por_pieza[i] = est
    sin_pe = sorted(i for i, v in por_pieza.items() if v["estado"] == "SIN_PE")
    parciales = sorted(i for i, v in por_pieza.items() if v["estado"] == "PARCIAL")
    indet = sorted(i for i, v in por_pieza.items() if v["estado"] == "INDETERMINADA")
    estado_cob = "INCOMPLETA" if sin_pe or parciales else ("INDETERMINADA" if indet else "COMPLETA")
    compartidas = [{"instancia": i, "conductores": c, "longitud_eje_mm": piezas[i].get("longitud_eje_mm")}
                   for i, c in sorted(cubiertas.items()) if len(c) > 1]
    return {
        "requisito": _requisito(pe, seccion_aprobada),
        "cable": evaluar_cable_pe(cable, seccion_aprobada if seccion_aprobada is not None else pe["seccion_requerida_mm2"],
                                  color_req),
        "conductores": conds,
        "cobertura": {"estado": estado_cob, "piezas_requeridas": len(requeridas),
                      "piezas_sin_pe": sin_pe, "piezas_con_cobertura_parcial": parciales,
                      "piezas_con_cobertura_indeterminada": indet, "por_pieza": por_pieza,
                      "tolerancia_mm": tol_mm, "tipos_con_requisito": list(TIPOS_CON_COBERTURA_PE)},
        "segmentos_compartidos": compartidas,
        "longitud_total_geometrica_mm": redondear(sum(c["longitud_geometrica_mm"] for c in conds)),
        "longitudes_completas": all(c["longitud_completa"] for c in conds),
        "conductores_por_pieza": {i: c for i, c in sorted(cubiertas.items())},
    }


def _requisito(pe, seccion_aprobada=None):
    declarada = (pe or {}).get("seccion_requerida_mm2")
    if seccion_aprobada is None:
        estado = "SIN_REQUISITO_APROBADO_EN_DECISIONES"
    elif declarada is None:
        estado = "SIN_PE_DEFINIDO"
    elif abs(declarada - seccion_aprobada) > 1e-9:
        estado = "ENTRADA_DISTINTA_DEL_REQUISITO_APROBADO"
    else:
        estado = "COINCIDE_CON_REQUISITO_APROBADO"
    return {"descripcion": f"PE de {seccion_aprobada} mm² recorriendo todos los tramos de bandeja, incluidos los ramales.",
            "origen": "Requisito aprobado del usuario (D-20, decisiones de producto)",
            "origen_declarado_en_entrada": (pe or {}).get("origen_requisito"),
            "seccion_requerida_mm2": seccion_aprobada if seccion_aprobada is not None else declarada,
            "seccion_declarada_en_entrada_mm2": declarada,
            "estado": estado,
            "alcance": "Requisito del proyecto. No se declara suficiente por norma: dimensionamiento y montaje "
                       "requieren verificación independiente."}


def evaluar_equipotencial(norm: dict, cat, pe_res: dict) -> dict:
    piezas = {p["instancia_id"]: p for p in norm["piezas"]}
    idx = IndiceCompat(cat)
    puntos = norm["equipotencial"]["puntos"]
    pe_por_pieza = pe_res.get("conductores_por_pieza", {}) if pe_res else {}
    ady, evals = {}, []

    def unir(a, b, pid):
        ady.setdefault(a, set()).add((b, pid))
        ady.setdefault(b, set()).add((a, pid))

    extremos = {}                                  # punto_id -> [(conductor, "inicio"/"fin", pieza extrema)]
    for k in (norm["pe"]["conductores"] if norm["pe"] else []):
        rec = k["recorrido"]
        for ext, t in (("inicio", rec[0]), ("fin", rec[-1])):
            if k[ext] is not None:
                extremos.setdefault(k[ext], []).append((k["conductor_id"], ext, t["instancia"]))

    # v0.2.2 (auditoría H3): un punto que contradice el recorrido físico NO crea vínculo en el grafo.
    for q in puntos:
        con = q.get("conector") or {}
        ev = {"punto_id": q["punto_id"], "tipo": q["tipo"], "conector": con or None, "conductores": q["conductores"],
              "instancias": q["instancias"], "descripcion": q.get("descripcion"), "observaciones": [],
              "conductor_puente": q.get("conductor_puente")}
        if q["tipo"] == "sistema_proteccion":
            ev["estado_fisico"] = "NO_CONTRASTABLE"     # la ubicación del sistema de protección no se modela
            for c in q["conductores"]:
                unir(f"SP:{q['punto_id']}", f"PE:{c}", q["punto_id"])
        elif q["tipo"] == "derivacion_pe":
            cs = q["conductores"]
            for inst in q["instancias"]:
                fuera = [c for c in cs if c not in pe_por_pieza.get(inst, [])]
                if fuera:
                    ev["observaciones"].append(f"Derivación en {inst}, pero {fuera} no recorren esa pieza.")
            for c, ext, p_ext in extremos.get(q["punto_id"], []):
                if p_ext not in q["instancias"]:
                    ev["observaciones"].append(f"{c} declara su {ext} en {q['punto_id']}, pero su recorrido "
                                               f"{'empieza' if ext == 'inicio' else 'termina'} en {p_ext}.")
            if ev["observaciones"]:
                ev["estado_fisico"] = "FISICAMENTE_INCONSISTENTE"
            else:
                ev["estado_fisico"] = "COHERENTE_EN_EL_MODELO"
                for c in cs[1:]:
                    unir(f"PE:{cs[0]}", f"PE:{c}", q["punto_id"])
        elif q["tipo"] == "conexion_bandeja":
            c, inst = q["conductores"][0], q["instancias"][0]
            if c not in pe_por_pieza.get(inst, []):
                ev["observaciones"].append(f"El conductor {c} no recorre {inst}: conexión físicamente inconsistente.")
                ev["estado_fisico"] = "FISICAMENTE_INCONSISTENTE"
            else:
                ev["estado_fisico"] = "COHERENTE_EN_EL_MODELO"
                unir(f"PE:{c}", f"BAN:{inst}", q["punto_id"])
        elif q["tipo"] == "puente":
            ev["estado_fisico"] = "COHERENTE_EN_EL_MODELO"
            a, b = q["instancias"]
            unir(f"BAN:{a}", f"BAN:{b}", q["punto_id"])
        # conector
        pid = con.get("producto_id")
        if pid is None:
            ev["estado_conector"] = "CONECTOR_NO_DEFINIDO"
        else:
            detalle = {}
            if q["tipo"] == "conexion_bandeja":
                comp = idx.accesorio(pid, piezas[q["instancias"][0]]["producto_id"])
                detalle["alojamiento_en_bandeja"] = comp["estado"]
                detalle["registro"] = comp["registro"]
            detalle["seccion_y_material_del_conductor"] = "NO_DOCUMENTADA"
            ev["detalle_conector"] = detalle
            ev["estado_conector"] = "PENDIENTE_COMPATIBILIDAD_ELECTRICA"
        cp = q.get("conductor_puente")
        if q["tipo"] == "puente" and not cp:
            ev["observaciones"].append("Conductor del puente no definido.")
        evals.append(ev)

    sps = [f"SP:{q['punto_id']}" for q in puntos if q["tipo"] == "sistema_proteccion"]
    alcanzados = set(sps)
    pila = list(sps)
    while pila:
        n = pila.pop()
        for m, _ in ady.get(n, ()):
            if m not in alcanzados:
                alcanzados.add(m)
                pila.append(m)

    directas = {e["instancias"][0] for e in evals
                if e["tipo"] == "conexion_bandeja" and e["estado_fisico"] == "COHERENTE_EN_EL_MODELO"}
    inconsistentes = [e["punto_id"] for e in evals if e["estado_fisico"] == "FISICAMENTE_INCONSISTENTE"]
    bandejas = []
    for i, p in sorted(piezas.items()):
        prod = cat.piezas[p["producto_id"]]
        if prod.tipo_pieza not in TIPOS_CON_COBERTURA_PE:
            continue
        nodo = f"BAN:{i}"
        if i in directas:
            vinc = "DIRECTO"
        elif nodo in ady:
            vinc = "VIA_PUENTE"
        else:
            vinc = "SIN_VINCULO_PREVISTO"
        bandejas.append({"instancia": i, "vinculo_previsto": vinc,
                         "alcanzada_desde_sistema_proteccion_en_modelo": nodo in alcanzados,
                         "pe_pasa_por_la_pieza": i in pe_por_pieza})
    conductores = [k["conductor_id"] for k in (norm["pe"]["conductores"] if norm["pe"] else [])]
    cond_sin_sp = [c for c in conductores if f"PE:{c}" not in alcanzados]

    # discontinuidades: componentes del grafo mecánico de bandejas
    grafo = {i: set() for i in piezas}
    for k in norm["conexiones"]:
        grafo[k["a"][0]].add(k["b"][0])
        grafo[k["b"][0]].add(k["a"][0])
    comps, vistos = [], set()
    for i in sorted(piezas):
        if i in vistos:
            continue
        comp, pila = [], [i]
        vistos.add(i)
        while pila:
            n = pila.pop()
            comp.append(n)
            for m in grafo[n]:
                if m not in vistos:
                    vistos.add(m)
                    pila.append(m)
        comps.append({"piezas": sorted(comp),
                      "con_vinculo_previsto": any(b["vinculo_previsto"] != "SIN_VINCULO_PREVISTO" for b in bandejas
                                                  if b["instancia"] in comp)})

    sin_vinculo = [b["instancia"] for b in bandejas if b["vinculo_previsto"] == "SIN_VINCULO_PREVISTO"]
    conectores_pend = [e["punto_id"] for e in evals if e["estado_conector"] != "DOCUMENTADO"]
    return {
        "puntos": evals,
        "estados": {
            "cobertura_fisica_pe": pe_res["cobertura"]["estado"] if pe_res else "SIN_PE_DEFINIDO",
            "conexion_sistema_proteccion": "PRESENTE" if sps else "AUSENTE",
            "conductores_sin_vinculo_al_sistema_proteccion": cond_sin_sp,
            "puntos_fisicamente_inconsistentes": inconsistentes,
            "vinculos_bandeja": "TODAS_CON_VINCULO_PREVISTO" if not sin_vinculo else "PIEZAS_SIN_VINCULO_PREVISTO",
            "conexiones_previstas": "DOCUMENTADAS" if not conectores_pend and evals else "PENDIENTES",
            "verificacion_electrica_de_diseno": "PENDIENTE",
            "verificacion_por_inspeccion_o_medicion": "NO_REALIZADA",
        },
        "bandejas": bandejas,
        "piezas_sin_vinculo_previsto": sin_vinculo,
        "requisito_de_vinculo_por_pieza": "NO_DOCUMENTADO (D-26): se informa, no se exige",
        "continuidad_de_uniones": {"estado": "NO_DOCUMENTADA",
                                   "detalle": "El catálogo no declara continuidad eléctrica de las uniones (IEC 61537 la "
                                              "clasifica, pero no hay declaración del fabricante). Las uniones no se usan como vínculo."},
        "tapas_y_piezas_desmontables": [{"tapa_id": t["tapa_id"], "sobre": t["sobre"],
                                         "vinculo": "REQUISITO_NO_DOCUMENTADO (D-26)"} for t in norm["tapas"]],
        "componentes_de_bandeja": comps,
        "conectores_pendientes": conectores_pend,
        "alcance": "Conectividad del modelo informático. No es continuidad medida, ni resistencia, ni verificación "
                   "de la sección del PE frente a la falla.",
    }
