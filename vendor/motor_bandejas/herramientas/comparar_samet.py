"""Compara el motor con los casos observados en Samet y escribe docs/COMPARACION_SAMET.md.

No ajusta nada para coincidir. Muestra lado a lado: valor Samet, valor del motor, y la explicación de la
diferencia según la hipótesis registrada (docs/SAMET_ANALISIS.md). Las columnas "inferido de Samet" son
cálculos inversos a partir de lo que Samet muestra (hipótesis H-S1 y H-S3), no datos acreditados.

Uso:  python3 herramientas/comparar_samet.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from motor_bandejas.motor import calcular_sector, cargar_contexto  # noqa: E402

CABLE = "PRY-SVALIO-CU-1x6"


def _fmt(x, d=1):
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.{d}f}".replace(".", ",")
    return str(x)


def comparar() -> str:
    cables, catalogo, decisiones = cargar_contexto()
    fixtures = json.loads((RAIZ / "pruebas" / "fixtures" / "samet_casos.json").read_text(encoding="utf-8"))
    por_sku = {p.sku: p for p in catalogo.productos}
    D = cables.obtener(CABLE).diametro_exterior_mm
    out = ["# Comparación con casos observados en Samet", "",
           "Generado por `herramientas/comparar_samet.py`. Samet es referencia de comportamiento, no autoridad.",
           "Columnas *inferidas*: cálculo inverso desde lo que Samet muestra (hipótesis, ver `SAMET_ANALISIS.md`).", ""]
    for caso in fixtures["casos"]:
        u = caso["uso"]
        entrada = {"tipo_circuito": "potencia", "vano_mm": 1500, "reserva_solicitada_pct": 20,
                   "usos_cable": [{"cable_id": CABLE, "cantidad": u["cantidad"], "separado": u["separado"],
                                   "apilado": False}]}
        res = calcular_sector(entrada, cables, catalogo, decisiones)
        alt = calcular_sector(dict(entrada, criterio_reserva="sobre_ancho_ocupado"), cables, catalogo, decisiones)
        cand = {c["sku"]: c for c in res["candidatos"]}
        cand_alt = {c["sku"]: c for c in alt["candidatos"]}
        q_m = res["masa_lineal"]["valor_kg_m"]
        q_s = caso["carga_requerida_samet_kg_m"]
        n = u["cantidad"]
        w_m = res["disposicion"]["ancho_ocupado_mm"]
        w_s_hip = n * D if not u["separado"] else 2 * n * D
        out += [f"## {caso['caso_id']} – {n} cables, separado={'sí' if u['separado'] else 'no'} ({caso['archivo']})", "",
                "| Magnitud | Samet | Motor | Nota |", "|---|---|---|---|",
                f"| Carga de cables [kg/m] | {_fmt(q_s, 2)} | {_fmt(q_m, 3)} | Samet ≈ {_fmt(100 * (q_s / q_m - 1), 2)} % ; "
                f"inferido Samet por cable = {_fmt(q_s / n, 4)} kg/m vs ficha {_fmt(q_m / n, 3)} (H-S2) |",
                f"| Ancho ocupado [mm] | {_fmt(w_s_hip)} (inferido, H-S3) | {_fmt(w_m)} | Motor: {res['disposicion']['formula']} |",
                "", "| SKU Samet | Factor Samet | CTA inferida Samet [kg/m] (H-S1) | CTA catálogo [kg/m] | Estado mecánico motor | "
                    "Reserva Samet | Sobrante/ocupado motor | Reserva libre motor (D-05) | Estado motor (D-05) | Estado con criterio 'sobre_ancho_ocupado' |",
                "|---|---|---|---|---|---|---|---|---|---|"]
        for h in caso["tray_hits"]:
            sku = h["sku"]
            cta_inf = h["factor_samet"] * q_s
            c = cand.get(sku)
            if c is None:
                nota = "no está en el catálogo del proyecto" if sku not in por_sku else "filtrado"
                out.append(f"| {sku} | {_fmt(h['factor_samet'])} | {_fmt(cta_inf, 1)} | — | {nota} | {h['reserva_real_samet_pct']} % | — | — | — | — |")
                continue
            geo = c["geometria"]
            r = geo.get("reserva", {})
            mec = c["mecanica"]
            out.append(
                f"| {sku} | {_fmt(h['factor_samet'])} | {_fmt(cta_inf, 1)} | {_fmt(mec.get('cta_kg_m'))} | {mec['estado']} | "
                f"{h['reserva_real_samet_pct']} % | {_fmt(r.get('sobrante_sobre_ocupado_pct'))} % | {_fmt(r.get('reserva_libre_pct'))} % | "
                f"{c['estado']} | {cand_alt[sku]['estado']} |")
        # mínimo geométrico de cada línea del motor que corresponde a las líneas mostradas por Samet
        out += ["", "Mínimo geométrico por línea según el motor (criterio D-05 / criterio alternativo):", ""]
        lineas_alt = {(l["familia_id"], l["ala_nominal_mm"], l["espesor_chapa_mm"]): l for l in alt["resumen_por_linea"]}
        for l in res["resumen_por_linea"]:
            if l["familia_id"] in ("SAM-STE-Z", "SAM-STE-G", "SAM-STP-Z") and l["espesor_chapa_mm"] in (1.24, 0.71):
                la = lineas_alt[(l["familia_id"], l["ala_nominal_mm"], l["espesor_chapa_mm"])]
                out.append(f"- {l['familia_id']} ala {_fmt(l['ala_nominal_mm'], 0)}: {l['minimo_geometrico']} "
                           f"({l['mecanica_minimo_geometrico']}) / alternativo: {la['minimo_geometrico']}")
        out.append("")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    md = comparar()
    destino = RAIZ / "docs" / "COMPARACION_SAMET.md"
    destino.write_text(md, encoding="utf-8")
    print(md)
