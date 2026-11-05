"""Cómputo de materiales con origen y regla de cada cantidad.

Reglas:
- Piezas: 1 por instancia del trazado (D-18). Un tramo recto más corto que la longitud comercial es un corte:
  se computa 1 pieza comercial, sin reaprovechar recortes.
- Uniones: 1 juego de componentes por CONEXIÓN (nunca por extremo: D-24). Cantidades de COMPONENTES_UNION;
  si el catálogo no publica la cantidad, la línea queda con cantidad nula y estado 'no_documentada'.
- Tapas, accesorios y soportes: los declara el CAD; se computa 1 por instancia y sus componentes
  documentados. Accesorios de soporte con evidencia 'propuesta' se marcan como tales.
- Suministro: 'incluido' solo si una fuente lo declara; si no, 'no_declarado'.
- Compra: envases = ceil(cantidad / cantidad_por_envase) solo si ambas cantidades existen.
"""
from __future__ import annotations

import math

from .soportes import TIPOS_SOPORTE_PRINCIPAL
from .unidades import redondear


def _linea(cat, producto_id, cantidad, unidad, origen, regla, estado_cantidad, evidencia=None, nota=None):
    p = cat.piezas.get(producto_id) if producto_id else None
    return {"producto_id": producto_id, "sku": p.sku if p else None,
            "descripcion": (p.descripcion_original if p else None), "cantidad": cantidad, "unidad": unidad,
            "origen": origen, "regla": regla, "estado_cantidad": estado_cantidad, "evidencia": evidencia,
            "suministro": "no_declarado",
            "incluye_declarado": ("bulonería (declarado en el catálogo)"
                                  if p and p.observaciones and "Incluye bulonería" in p.observaciones else None),
            "nota": nota}


def computar(norm: dict, cat, conexiones_eval: dict, tapas_eval: dict, accesorios_eval: dict, pe_res: dict | None,
             eq_res: dict | None) -> dict:
    lineas = []
    for p in norm["piezas"]:
        prod = cat.piezas[p["producto_id"]]
        nota = None
        if prod.tipo_pieza == "recta" and prod.longitud_comercial_mm and p["longitud_mm"] < prod.longitud_comercial_mm - 1e-9:
            nota = (f"Corte: {p['longitud_mm']} mm de {prod.longitud_comercial_mm} mm; recorte "
                    f"{redondear(prod.longitud_comercial_mm - p['longitud_mm'])} mm no reaprovechado.")
        lineas.append(_linea(cat, prod.producto_id, 1, "pieza", {"pieza": p["instancia_id"]},
                             "D-18: 1 pieza comercial por instancia", "regla_producto", nota=nota))
    for k in norm["conexiones"]:
        ev = conexiones_eval[k["conexion_id"]]["compatibilidad"]
        reg = ev.get("registro")
        comps = cat.componentes_union.get(reg["compatibilidad_id"], ()) if reg else ()
        if not reg or ev["estado"] in ("NO_COMPATIBLE", "NO_REGISTRADA"):
            lineas.append(_linea(cat, None, None, None, {"conexion": k["conexion_id"]},
                                 "D-24: componentes de unión por conexión", "bloqueada",
                                 nota=f"Compatibilidad {ev['estado']}: componentes de unión no determinables."))
            continue
        if not comps:
            lineas.append(_linea(cat, None, None, None, {"conexion": k["conexion_id"], "compatibilidad": reg["compatibilidad_id"]},
                                 "D-24: componentes de unión por conexión", "no_documentada",
                                 nota="El catálogo no asocia componentes de unión a esta compatibilidad."))
        for cu in comps:
            lineas.append(_linea(cat, cu.producto_requerido_id, cu.cantidad, "juego" if cu.cantidad else None,
                                 {"conexion": k["conexion_id"], "compatibilidad": reg["compatibilidad_id"]},
                                 "D-24: COMPONENTES_UNION por conexión (no por extremo)",
                                 "documentada" if cu.cantidad is not None and cu.estado_evidencia == "documentada" else
                                 ("propuesta" if cu.estado_evidencia == "propuesta" else "no_documentada"),
                                 evidencia={"fuente_id": cu.fuente_id, "pagina_fuente": cu.pagina_fuente,
                                            "estado_evidencia": cu.estado_evidencia, "fila": cu.fila_origen}))
    for t in norm["tapas"]:
        ev = tapas_eval[t["tapa_id"]]
        lineas.append(_linea(cat, t["producto_id"], 1, "pieza", {"tapa": t["tapa_id"], "sobre": t["sobre"]},
                             "1 por tapa declarada por el CAD", "declarada_en_trazado",
                             evidencia={"compatibilidad": ev["estado"]}))
        lineas.append(_linea(cat, None, None, None, {"tapa": t["tapa_id"]}, "fijación de tapa", "no_documentada",
                             nota="Cantidad y artículo de fijación de tapas no estructurados en el catálogo "
                                  "(las observaciones citan JB-TRUTS-M6 sin cantidad)."))
    for a in norm["accesorios"]:
        ev = accesorios_eval[a["accesorio_id"]]
        lineas.append(_linea(cat, a["producto_id"], 1, "pieza", {"accesorio": a["accesorio_id"], "sobre": a["sobre"]},
                             "1 por accesorio declarado por el CAD", "declarada_en_trazado", evidencia={"compatibilidad": ev["estado"]}))
        reg = ev.get("registro")
        for cu in (cat.componentes_union.get(reg["compatibilidad_id"], ()) if reg else ()):
            lineas.append(_linea(cat, cu.producto_requerido_id, cu.cantidad, "juego" if cu.cantidad else None,
                                 {"accesorio": a["accesorio_id"]}, "COMPONENTES_UNION del accesorio",
                                 "documentada" if cu.cantidad is not None else "no_documentada",
                                 evidencia={"fuente_id": cu.fuente_id, "pagina_fuente": cu.pagina_fuente,
                                            "estado_evidencia": cu.estado_evidencia}))
    for s in norm["soportes"]:
        lineas.append(_linea(cat, s["producto_id"], 1, "pieza", {"soporte": s["soporte_id"]},
                             "1 soporte principal por punto de apoyo declarado por el CAD", "declarada_en_trazado"))
        for c in cat.componentes_soporte.get(s["sistema_soporte_id"], ()):
            if cat.piezas[c["producto_id"]].tipo_pieza in TIPOS_SOPORTE_PRINCIPAL:
                continue
            ev = c.get("estado_evidencia")
            lineas.append(_linea(cat, c["producto_id"], c.get("cantidad"), c.get("unidad"),
                                 {"soporte": s["soporte_id"], "sistema": s["sistema_soporte_id"]},
                                 f"COMPONENTES_SOPORTE: {c.get('condicion_de_uso')}",
                                 {"documentada": "documentada", "validada por usuario": "validada_usuario"}.get(ev, "propuesta"),
                                 evidencia={"estado_evidencia": ev, "fuente_id": c.get("fuente_id"), "pagina_fuente": c.get("pagina_fuente")}))
    if pe_res and pe_res.get("cable"):
        for k in pe_res["conductores"]:
            lineas.append(_linea(cat, None, k["longitud_geometrica_mm"], "mm", {"conductor_pe": k["conductor_id"]},
                                 "D-27: suma de longitudes de eje informadas por el CAD; sin holgura (sin regla)",
                                 "geometrica" if k["longitud_completa"] else "incompleta",
                                 nota=f"Cable {pe_res['cable']['cable_id']}"))
    if eq_res:
        for q in eq_res["puntos"]:
            con = q.get("conector") or {}
            pid = con.get("producto_id")
            lineas.append(_linea(cat, pid, 1 if pid else None, "pieza" if pid else None, {"punto_equipotencial": q["punto_id"]},
                                 f"1 conector por punto '{q['tipo']}' modelado", "declarada_en_trazado" if pid else "pendiente",
                                 nota=None if pid else "Conector/terminal no definido: sin cantidad técnica."))
            if q["tipo"] == "puente":
                cp = q.get("conductor_puente") or {}
                lineas.append(_linea(cat, None, cp.get("longitud_mm"), "mm" if cp.get("longitud_mm") else None,
                                     {"puente": q["punto_id"]}, "conductor del puente declarado por el CAD",
                                     "declarada_en_trazado" if cp.get("longitud_mm") else "pendiente",
                                     nota=f"Cable {cp.get('cable_id')}" if cp else "Conductor del puente no definido."))
                lineas.append(_linea(cat, None, None, None, {"puente": q["punto_id"]}, "terminales del puente", "pendiente",
                                     nota="Terminales no documentados: sin cantidad técnica."))
    # resumen por producto (solo cantidades numéricas); lo pendiente queda listado aparte
    resumen = {}
    for l in lineas:
        if l["producto_id"] and isinstance(l["cantidad"], (int, float)):
            r = resumen.setdefault((l["producto_id"], l["unidad"], l["estado_cantidad"]),
                                   {"producto_id": l["producto_id"], "sku": l["sku"], "unidad": l["unidad"],
                                    "estado_cantidad": l["estado_cantidad"], "cantidad": 0, "lineas": 0})
            r["cantidad"] += l["cantidad"]
            r["lineas"] += 1
    for r in resumen.values():
        p = cat.piezas[r["producto_id"]]
        if p.cantidad_por_envase and p.unidad_compra == "envase":
            r["envases"] = math.ceil(r["cantidad"] / p.cantidad_por_envase - 1e-9)
            r["cantidad_por_envase"] = p.cantidad_por_envase
    resumen_cables = {}
    for l in lineas:
        cab = (l.get("nota") or "").removeprefix("Cable ") if l["unidad"] == "mm" else None
        if cab and isinstance(l["cantidad"], (int, float)):
            rc = resumen_cables.setdefault(cab, {"cable_id": cab, "longitud_mm": 0.0, "origenes": []})
            rc["longitud_mm"] = redondear(rc["longitud_mm"] + l["cantidad"])
            rc["origenes"].append(l["origen"])
    pendientes = [l for l in lineas if l["estado_cantidad"] in ("pendiente", "no_documentada", "bloqueada", "incompleta")]
    return {"lineas": lineas, "resumen_cables": list(resumen_cables.values()), "resumen_por_producto": sorted(resumen.values(), key=lambda r: (r["producto_id"], r["estado_cantidad"])),
            "lineas_pendientes": len(pendientes),
            "advertencia": "Las líneas 'propuesta', 'regla_producto' y 'declarada_en_trazado' no son cantidades documentadas por el fabricante."}
