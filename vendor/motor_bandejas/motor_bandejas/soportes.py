"""Soportes: vanos reales, verificación de la bandeja por vano y diagnóstico de colocación.

Tres capacidades que NO se sustituyen entre sí:
  1. Bandeja: CTA publicada para la luz = vano real entre soportes consecutivos (D-22). Sin interpolar.
  2. Soporte: el catálogo publica valores para algunos soportes (p. ej. STS 379 kg) sin modo de aplicación ni
     modelo de reparto. La carga por apoyo exige un modelo estructural que no está documentado → NO_VERIFICABLE.
  3. Fijación/anclaje y sustrato: fuera de alcance (REV-016) → NO_VERIFICABLE.

Las reglas de colocación (vano máximo, voladizos, posición de uniones, apoyos en curvas/T/X/reducciones) no
están acreditadas en las fuentes disponibles: se informan como diagnóstico, sin aprobar ni rechazar (D-23).
No se usa ceil(L/vano)+1.
"""
from __future__ import annotations

from .calculos import evaluar_mecanica
from .errores import ErrorEntrada
from .unidades import EPS, redondear

TIPOS_SOPORTE_PRINCIPAL = ("trapecio/travesaño", "ménsula", "soporte", "kit de suspensión")
_RANGO_EVID = {"documentada": 0, "validada por usuario": 1, "propuesta": 2, "no determinada": 3}


def corridas_rectas(piezas: dict, conexiones: list, cat) -> list[dict]:
    """Cadenas de tramos rectos unidos entre sí (recta↔recta). Devuelve orden, orientación y extremos."""
    es_recta = {i: cat.piezas[p["producto_id"]].tipo_pieza == "recta" for i, p in piezas.items()}
    vecinos = {i: {} for i in piezas}                     # inst -> puerto -> (otra_inst, otro_puerto, conexion)
    for k in conexiones:
        (ia, pa), (ib, pb) = k["a"], k["b"]
        vecinos[ia][pa] = (ib, pb, k["conexion_id"])
        vecinos[ib][pb] = (ia, pa, k["conexion_id"])
    visitadas, corridas = set(), []
    rectas = [i for i in piezas if es_recta[i]]

    def recta_vecina(i, pto):
        v = vecinos[i].get(pto)
        return v if v and es_recta[v[0]] else None

    for ini in rectas:
        if ini in visitadas:
            continue
        # buscar un extremo de la cadena
        actual, puerto_entrada, guard = ini, "P1", 0
        while True:
            v = recta_vecina(actual, puerto_entrada)
            if v is None or v[0] == ini or guard > len(rectas):
                break
            actual, puerto_entrada = v[0], "P2" if v[1] == "P1" else "P1"
            guard += 1
        # ahora `actual` es extremo; recorrer hacia adelante
        orden, s, inst, entrada = [], 0.0, actual, puerto_entrada
        while inst is not None and inst not in visitadas:
            visitadas.add(inst)
            lon = piezas[inst]["longitud_mm"]
            salida = "P2" if entrada == "P1" else "P1"
            orden.append({"instancia": inst, "entra_por": entrada, "inicio_mm": s, "fin_mm": s + lon})
            s += lon
            v = recta_vecina(inst, salida)
            if v is None:
                break
            orden.append({"union": v[2], "posicion_mm": s})
            inst, entrada = v[0], v[1]
        tramos = [o for o in orden if "instancia" in o]
        uniones = [o for o in orden if "union" in o]

        def extremo(pieza, pto):
            v = vecinos[pieza].get(pto)
            if v is None:
                return {"tipo": "libre"}
            return {"tipo": "pieza_especial", "instancia": v[0], "tipo_pieza": cat.piezas[piezas[v[0]]["producto_id"]].tipo_pieza,
                    "conexion": v[2]}
        corridas.append({
            "corrida_id": f"CORR-{tramos[0]['instancia']}",
            "tramos": tramos, "uniones": uniones, "longitud_mm": s,
            "extremo_inicio": extremo(tramos[0]["instancia"], tramos[0]["entra_por"]),
            "extremo_fin": extremo(tramos[-1]["instancia"], "P2" if tramos[-1]["entra_por"] == "P1" else "P1"),
        })
    return corridas


def _posicion_en_corrida(corrida, soporte):
    for t in corrida["tramos"]:
        if t["instancia"] == soporte["instancia_id"]:
            lon = t["fin_mm"] - t["inicio_mm"]
            d = soporte["distancia_desde_P1_mm"]
            return t["inicio_mm"] + (d if t["entra_por"] == "P1" else lon - d)
    return None


def evaluar_soporte(s: dict, piezas: dict, cat) -> dict:
    p = piezas[s["instancia_id"]]
    prod = cat.piezas[p["producto_id"]]
    anchos = {pu.ancho_nominal_mm for pu in cat.puertos.get(prod.producto_id, ())}
    ancho = anchos.pop() if len(anchos) == 1 else prod.ancho_nominal_mm
    sid = s["sistema_soporte_id"]
    apl = [a for a in cat.aplicaciones_soporte if a["sistema_soporte_id"] == sid and a.get("familia_bandeja_id") == prod.familia_id
           and a.get("ancho_min_mm") is not None and ancho is not None
           and a["ancho_min_mm"] - EPS <= ancho <= a["ancho_max_mm"] + EPS]
    apl.sort(key=lambda a: _RANGO_EVID.get(a.get("estado_evidencia"), 9))
    if apl:
        a = apl[0]
        aplic = {"estado": {"documentada": "APLICA_DOCUMENTADA", "validada por usuario": "APLICA_VALIDADA_USUARIO"}.get(
            a.get("estado_evidencia"), "APLICA_PENDIENTE"), "aplicacion_id": a.get("aplicacion_id"),
            "rango_ancho_mm": [a["ancho_min_mm"], a["ancho_max_mm"]], "fuente_id": a.get("fuente_id"),
            "pagina_fuente": a.get("pagina_fuente"), "tipo_fijacion_bandeja": a.get("tipo_fijacion_bandeja")}
    else:
        aplic = {"estado": "NO_REGISTRADA", "detalle": f"Sin aplicación de {sid} para {prod.familia_id} ancho {ancho} mm."}
    fila = next((c for c in cat.componentes_soporte.get(sid, ()) if c["producto_id"] == s["producto_id"]), None)
    prod_sop = cat.piezas[s["producto_id"]]
    if fila is None or prod_sop.tipo_pieza not in TIPOS_SOPORTE_PRINCIPAL:
        pertenencia = {"estado": "PRODUCTO_NO_ASOCIADO_AL_SISTEMA",
                       "detalle": f"{s['producto_id']} no figura como soporte principal de {sid} en COMPONENTES_SOPORTE."}
    else:
        pertenencia = {"estado": "ASOCIADO", "evidencia": fila.get("estado_evidencia"),
                       "condicion_de_uso_texto": fila.get("condicion_de_uso"),
                       "correspondencia_ancho": "TEXTO_NO_ESTRUCTURADO_NO_VERIFICADO"}
    cargas = [r for r in cat.cargas_de(s["producto_id"]) if r.carga_valor is not None]
    capacidad = {
        "estado": "NO_VERIFICABLE_SIN_MODELO_DE_REPARTO",
        "valores_publicados": [r.como_dict() for r in cargas],
        "detalle": ("La carga por apoyo requiere un modelo estructural (continuidad, posición de uniones, ramales) que "
                    "no está documentado. No se reparte la carga con un modelo supuesto."),
    }
    if not cargas:
        capacidad["estado"] = "NO_VERIFICABLE_SIN_CAPACIDAD_PUBLICADA"
    return {"soporte_id": s["soporte_id"], "sistema_soporte_id": sid, "producto_id": s["producto_id"],
            "instancia_id": s["instancia_id"], "tipo_pieza_soportada": prod.tipo_pieza,
            "aplicabilidad": aplic, "pertenencia": pertenencia, "capacidad_soporte": capacidad,
            "anclaje_y_sustrato": {"estado": "NO_VERIFICABLE_FUERA_DE_ALCANCE",
                                   "detalle": "Fijación al sustrato fuera del alcance (REV-016)."}}


def _uniones_en(x0, x1, uniones, tol):
    return [u for u in uniones if x0 - tol <= u <= x1 + tol]


def _chequeo_central(k, vanos, uniones, tramos, t, tol, tol_luz, tol_lon):
    """Verificaciones de un vano como CENTRAL del ensayo: una unión al centro, no sobre apoyo, vecinos de igual luz
    a ambos lados y tramos de la longitud ensayada."""
    x0, x1 = vanos[k]
    luz = x1 - x0
    dentro = _uniones_en(x0, x1, uniones, tol)
    chk = [{"tema": "uniones en el vano", "valor": len(dentro), "ensayo": f"≤ {t['uniones_por_vano_max']}",
            "coincide": len(dentro) <= t["uniones_por_vano_max"]}]
    for u in dentro:
        sobre_apoyo = min(abs(u - x0), abs(u - x1)) <= tol
        chk.append({"tema": "unión sobre apoyo", "posicion_mm": redondear(u), "coincide": not sobre_apoyo,
                    "ensayo": "la unión no está sobre un apoyo"})
        if not sobre_apoyo:
            desv = abs(u - (x0 + luz / 2))
            chk.append({"tema": "unión al centro del vano", "desvio_mm": redondear(desv), "tolerancia_mm": tol,
                        "coincide": desv <= tol + EPS, "ensayo": "unión en el centro del vano central"})
    vec = [vanos[m] for m in (k - 1, k + 1) if 0 <= m < len(vanos)]
    luces_vec = [redondear(b - a) for a, b in vec]
    chk.append({"tema": "vanos vecinos de igual luz", "luces_vecinas_mm": luces_vec, "luz_mm": redondear(luz),
                "tolerancia_mm": tol_luz, "ensayo": "un vano de igual luz a cada lado del central",
                "coincide": len(vec) == 2 and all(abs((b - a) - luz) <= tol_luz + EPS for a, b in vec)})
    lon = [redondear(tr["fin_mm"] - tr["inicio_mm"]) for tr in tramos
           if tr["fin_mm"] > x0 + EPS and tr["inicio_mm"] < x1 - EPS]
    ens = t["longitud_tramos_mm"]
    chk.append({"tema": "longitud de los tramos del vano", "valor_mm": lon, "ensayo_mm": ens, "tolerancia_mm": tol_lon,
                "coincide": len(lon) == len(ens) and all(abs(a - b) <= tol_lon + EPS for a, b in zip(sorted(lon), sorted(ens)))})
    return all(c["coincide"] for c in chk) and len(dentro) == 1, chk


def contrastar_esquema(registro: dict | None, x0, x1, uniones, n_vanos, dec, contexto: dict | None = None) -> dict:
    """Contrasta un vano real con el esquema de ensayo del registro de CTA usado (D-12, validado por el usuario).

    v0.2.2 (auditoría H8, regla PROPUESTA D-31): el ensayo es una ventana de tres vanos — lateral, central (unión al
    centro) y lateral — sobre dos tramos de la longitud ensayada. Un vano coincide solo si reproduce un papel de esa
    ventana con el contexto real de la corrida:
      - central: una unión al centro (D-30), no sobre apoyo, vecinos de igual luz (D-22) a ambos lados y los dos tramos
        del vano de la longitud ensayada;
      - lateral: sin unión, dentro de un único tramo de la longitud ensayada y contiguo a un vano central que coincide,
        con igual luz.
    No se exige unión en todos los vanos. Sin contexto de corrida (`contexto` None) no se puede afirmar coincidencia.
    Lo que queda fuera de la ventana (más vanos, voladizos, tipo de apoyo) no se contrasta y se lista."""
    esquemas = [e for e in dec.get("esquemas_ensayo", [])
                if registro and registro.get("fuente_id") in e["aplica_a"]["fuente_id"]]
    if not esquemas:
        return {"estado": "NO_DECLARADO", "esquema_id": None,
                "detalle": f"Sin esquema de ensayo asociado a la fuente {registro.get('fuente_id') if registro else None}."}
    e = esquemas[0]
    base = {"esquema_id": e["esquema_id"], "fuente_esquema": e["fuente"], "regla_contraste": "D-31 (propuesta)",
            "no_contrastado": list(e["no_contrastado"]) + [
                "vanos de la corrida fuera de la ventana de tres vanos del ensayo",
                "luces de los vanos laterales en el ensayo de 2,25 y 2,5 m: en la imagen, 3 vanos de esa luz no caben "
                "en 6 m; se toma la rotulación (igual luz) sin leer cotas"]}
    if contexto is None:
        return {**base, "estado": "SIN_CONTEXTO_DE_CORRIDA", "rol_en_ensayo": None, "verificaciones": [],
                "detalle": "Sin vanos vecinos ni tramos de la corrida no se puede afirmar coincidencia con el ensayo."}
    t = e["topologia"]
    tol = dec["D-30_tolerancia_union_centro_mm"]
    tol_luz = dec["D-22_tolerancia_luz_mm"]
    tol_lon = dec["D-14_tolerancia_posicion_mm"]
    vanos, k, tramos = contexto["vanos"], contexto["indice"], contexto["tramos"]
    dentro = _uniones_en(x0, x1, uniones, tol)
    if dentro:
        ok, chk = _chequeo_central(k, vanos, uniones, tramos, t, tol, tol_luz, tol_lon)
        return {**base, "estado": "COINCIDE_EN_LO_CONTRASTADO" if ok else "DISTINTO", "rol_en_ensayo": "central",
                "verificaciones": chk}
    luz = x1 - x0
    chk = [{"tema": "uniones en el vano", "valor": 0, "ensayo": "0 en un vano lateral", "coincide": True}]
    lon = [tr["fin_mm"] - tr["inicio_mm"] for tr in tramos if tr["fin_mm"] > x0 + EPS and tr["inicio_mm"] < x1 - EPS]
    chk.append({"tema": "longitud de los tramos del vano", "valor_mm": [redondear(x) for x in lon],
                "ensayo_mm": "un tramo de " + " o ".join(str(x) for x in sorted(set(t["longitud_tramos_mm"]))),
                "tolerancia_mm": tol_lon,
                "coincide": len(lon) == 1 and any(abs(lon[0] - x) <= tol_lon + EPS for x in t["longitud_tramos_mm"])})
    centrales = []
    for m in (k - 1, k + 1):
        if 0 <= m < len(vanos) and _uniones_en(*vanos[m], uniones, tol):
            ok_m, _ = _chequeo_central(m, vanos, uniones, tramos, t, tol, tol_luz, tol_lon)
            igual = abs((vanos[m][1] - vanos[m][0]) - luz) <= tol_luz + EPS
            centrales.append({"vano": [redondear(vanos[m][0]), redondear(vanos[m][1])], "coincide_como_central": ok_m,
                              "igual_luz": igual})
    chk.append({"tema": "contiguo a un vano central coincidente de igual luz", "vecinos_centrales": centrales,
                "ensayo": "vano lateral junto al vano central del ensayo",
                "coincide": any(c["coincide_como_central"] and c["igual_luz"] for c in centrales)})
    ok = all(c["coincide"] for c in chk)
    return {**base, "estado": "COINCIDE_EN_LO_CONTRASTADO" if ok else "DISTINTO",
            "rol_en_ensayo": "lateral" if ok else "fuera_de_la_ventana_del_ensayo", "verificaciones": chk}


def evaluar_vanos(corridas, soportes, piezas, cargas_por_pieza: dict, tapas_por_pieza: dict, cat, dec,
                  etiqueta_escenario="actual") -> list[dict]:
    out = []
    ev = dec["D-06_evidencias_carga_aceptadas"]
    for c in corridas:
        pos = []
        for s in soportes:
            x = _posicion_en_corrida(c, s)
            if x is not None:
                pos.append((x, s["soporte_id"]))
        pos.sort()
        tol = dec["D-14_tolerancia_posicion_mm"]
        for (xa, sa), (xb, sb) in zip(pos, pos[1:]):
            if xb - xa <= tol + EPS:      # v0.2.2 (auditoría H4): dos soportes en el mismo punto de la corrida
                raise ErrorEntrada(
                    f"Soportes {sa} y {sb} coinciden en la corrida {c['corrida_id']} (posición {redondear(xa)} mm, "
                    f"separación {redondear(xb - xa)} mm ≤ {tol} mm, D-14). Declarar un solo soporte por punto de apoyo.",
                    campo="soportes")
        r = {"corrida_id": c["corrida_id"], "escenario": etiqueta_escenario, "longitud_mm": redondear(c["longitud_mm"]),
             "soportes": [{"soporte_id": sid, "posicion_mm": redondear(x)} for x, sid in pos],
             "extremo_inicio": c["extremo_inicio"], "extremo_fin": c["extremo_fin"], "vanos": [], "diagnosticos": []}
        if not pos:
            r["estado"] = "NO_VERIFICABLE_SIN_SOPORTES"
            out.append(r)
            continue
        vanos_xy = [(xa, xb) for (xa, _), (xb, _) in zip(pos, pos[1:])]
        for k_vano, ((x0, s0), (x1, s1)) in enumerate(zip(pos, pos[1:])):
            luz = x1 - x0
            tramos = [t for t in c["tramos"] if t["fin_mm"] > x0 + EPS and t["inicio_mm"] < x1 - EPS]
            if not tramos:                # no debería ocurrir tras el control anterior; nunca un ValueError
                raise ErrorEntrada(f"Vano {s0}–{s1} sin tramos en la corrida {c['corrida_id']}.", campo="soportes")
            q = max(cargas_por_pieza[t["instancia"]]["q_kg_m"] for t in tramos)
            tapas = [tp for t in tramos for tp in tapas_por_pieza.get(t["instancia"], [])]
            v = {"entre": [s0, s1], "luz_mm": redondear(luz), "piezas": [t["instancia"] for t in tramos],
                 "carga_kg_m": redondear(q), "cargas_incluidas": ["cables de potencia asignados", "PE"],
                 "criterio_carga": "máxima carga distribuida entre las piezas del vano (sin modelo de reparto)"}
            if tapas:
                v["estado"] = "NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA"
                v["detalle"] = f"Tapas {tapas}: masa no publicada; omitirla subestimaría la carga."
            else:
                evals = []
                for t in tramos:
                    prod = piezas[t["instancia"]]["producto_id"]
                    m = evaluar_mecanica(prod, q, luz, cat, ev)
                    esq = contrastar_esquema(m.get("registro"), x0, x1, [u["posicion_mm"] for u in c["uniones"]],
                                             len(pos) - 1, dec, {"vanos": vanos_xy, "indice": k_vano,
                                                                 "tramos": c["tramos"]}) if m.get("registro") else None
                    est_m = m["estado"]
                    if est_m == "VERIFICADA_CUMPLE" and esq and esq["estado"] != "COINCIDE_EN_LO_CONTRASTADO":
                        est_m = "CUMPLE_CONDICIONADO"     # D-12: instalación distinta del ensayo o esquema no declarado
                    evals.append({"instancia": t["instancia"], "estado": est_m, "estado_mecanico_registro": m["estado"],
                                  **{k: m.get(k) for k in ("cta_kg_m", "base_evidencia", "utilizacion_pct")},
                                  "registro_carga_id": (m.get("registro") or {}).get("registro_carga_id"),
                                  "esquema_ensayo": esq})
                v["evaluaciones"] = evals
                v["esquema_ensayo_contrastado"] = bool(evals) and all(
                    (e["esquema_ensayo"] or {}).get("estado") == "COINCIDE_EN_LO_CONTRASTADO" for e in evals)
                est = [e["estado"] for e in evals]
                if any(e in ("VERIFICADA_NO_CUMPLE", "NO_CUMPLE_CONDICIONADO") for e in est):
                    v["estado"] = "NO_CUMPLE"
                elif all(e == "VERIFICADA_CUMPLE" for e in est):
                    v["estado"] = "VERIFICADA_CUMPLE"
                elif all(e in ("VERIFICADA_CUMPLE", "CUMPLE_CONDICIONADO") for e in est):
                    v["estado"] = "CUMPLE_CONDICIONADO"
                else:
                    v["estado"] = "NO_VERIFICABLE"
                    v["detalle"] = ("Sin CTA publicada para esta luz exacta en alguna pieza del vano "
                                    f"(tolerancia de luz {dec['D-22_tolerancia_luz_mm']} mm; sin interpolación).")
            r["vanos"].append(v)
        # diagnósticos de colocación (sin regla acreditada)
        for nombre, x_ext, ext in (("inicio", 0.0, c["extremo_inicio"]), ("fin", c["longitud_mm"], c["extremo_fin"])):
            d = abs(pos[0][0] - x_ext) if nombre == "inicio" else abs(c["longitud_mm"] - pos[-1][0])
            r["diagnosticos"].append({"tema": f"distancia extremo {nombre} → soporte más cercano", "valor_mm": redondear(d),
                                      "extremo": ext, "estado": "SIN_REGLA_ACREDITADA"})
            if ext["tipo"] == "pieza_especial":
                r["diagnosticos"].append({"tema": f"tramo hacia {ext['tipo_pieza']} {ext['instancia']}",
                                          "estado": "NO_VERIFICABLE_VANO_A_TRAVES_DE_PIEZA_ESPECIAL",
                                          "detalle": "No hay modelo documentado para vanos que incluyen curvas, T, X o reducciones."})
        for u in c["uniones"]:
            x = u["posicion_mm"]
            dmin = min(abs(x - p) for p, _ in pos)
            vano = next(((a, b) for (a, _), (b, _) in zip(pos, pos[1:]) if a - EPS <= x <= b + EPS), None)
            r["diagnosticos"].append({"tema": "posición de unión", "conexion": u["union"], "posicion_mm": redondear(x),
                                      "distancia_a_soporte_mm": redondear(dmin),
                                      "fraccion_del_vano": redondear((x - vano[0]) / (vano[1] - vano[0]), 3) if vano and vano[1] > vano[0] else None,
                                      "estado": "SIN_REGLA_ACREDITADA"})
        est = [v["estado"] for v in r["vanos"]]
        if not est:
            r["estado"] = "NO_VERIFICABLE_UN_SOLO_SOPORTE"
        elif "NO_CUMPLE" in est:
            r["estado"] = "NO_CUMPLE"
        elif all(e == "VERIFICADA_CUMPLE" for e in est):
            r["estado"] = "VANOS_VERIFICADOS_COLOCACION_SIN_REGLA"
        elif all(e in ("VERIFICADA_CUMPLE", "CUMPLE_CONDICIONADO") for e in est):
            r["estado"] = "VANOS_CONDICIONADOS_COLOCACION_SIN_REGLA"
        else:
            r["estado"] = "NO_VERIFICABLE"
        out.append(r)
    return out
