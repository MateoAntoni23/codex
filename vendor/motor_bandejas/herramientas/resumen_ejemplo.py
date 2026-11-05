"""Genera docs/EJEMPLO_TRAZADO.md a partir del resultado REAL del motor para ejemplos/trazado_derivacion_pe.json.

Corre el ejemplo dos veces: con las decisiones vigentes (v0.2.1: D-19 'contra_ala_en_contacto', aprobada por el
usuario) y con D-19 'pendiente', para mostrar qué bloquea sin esa decisión. Uso: python3 herramientas/resumen_ejemplo.py
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from motor_bandejas.motor import cargar_contexto_trazado  # noqa: E402
from motor_bandejas.trazado import calcular_trazado  # noqa: E402


def f(x, d=1):
    return "—" if x is None else (f"{x:.{d}f}".replace(".", ",") if isinstance(x, float) else str(x))


def main():
    cab, cat, dec = cargar_contexto_trazado()
    e = json.loads((RAIZ / "ejemplos" / "trazado_derivacion_pe.json").read_text(encoding="utf-8"))
    r = calcular_trazado(e, cab, cat, dec)
    d0 = copy.deepcopy(dec)
    d0["D-19_posicion_pe"] = "pendiente"
    r0 = calcular_trazado(e, cab, cat, d0)
    L = ["# Ejemplo completo: trazado con derivación y cobertura del PE", "",
         "> **EJEMPLO SINTÉTICO.** Productos y datos: catálogo real del proyecto y fichas Prysmian. Posiciones, longitudes "
         "de eje de piezas especiales, circuitos, soportes y puntos equipotenciales: inventados para mostrar el contrato. "
         "Generado por `herramientas/resumen_ejemplo.py` desde `ejemplos/trazado_derivacion_pe.json`.", "",
         "## Trazado", "",
         "Tronco R1–R2–T1–R3 (escalera Z 300 / ala 65 / 1,24 mm). Ramal desde la boca de derivación de T1: R4–CS1 (curva "
         "horizontal 90°, radio interior 300 mm publicado)–R5 (corte de 1500 mm). Tapa sobre R3. Nueve trapecios STS-300-Z (SIS-001).", "",
         "| Circuito | Cable | Cant. | Recorrido |", "|---|---|---|---|"]
    for k in e["circuitos"]:
        L.append(f"| {k['circuito_id']} | {k['cable_id']} | {k['cantidad']} | {' → '.join(k['recorrido'])} |")
    L += ["", "PE: `PRY-SASTFLEX-CU-1x16` (candidato, D-21). PE1 recorre el tronco desde la barra PE (SP1); PE2 nace en la "
          "derivación D1 dentro de T1 y recorre el ramal.", "",
          "## Variante sin decisión de posición del PE (D-19 = pendiente)", "",
          f"- Estado del trazado: **{r0['resumen']['estado_trazado']}** — bloquea {r0['resumen']['decisiones_que_bloquean']} "
          "(posición del PE junto a la potencia).",
          f"- Ejemplo de cota: R1 potencia {f(r0['ocupacion']['R1']['secciones']['pieza']['ancho_potencia_mm'])} mm; "
          f"con PE al menos {f(r0['ocupacion']['R1']['secciones']['pieza']['cota_inferior_con_pe_mm'])} mm.", "",
          "## Resultado con las decisiones vigentes (D-19: PE contra un ala, en contacto; aprobada por el usuario)", "",
          f"Estado del trazado: **{r['resumen']['estado_trazado']}** (nunca aprobación).", "",
          "### Conexiones", "", "| Conexión | Compatibilidad | Condiciones | Encaje (geometría del CAD) |", "|---|---|---|---|"]
    for cid, c in r["conexiones"].items():
        L.append(f"| {cid} | {c['compatibilidad']['estado']} | {', '.join(c['compatibilidad']['condiciones']) or '—'} | {c['encaje']['estado']} |")
    L += ["", "### Ocupación por sección", "", "| Pieza | Sección | Circuitos | Ancho ocupado [mm] | Reserva libre [%] | Estado |", "|---|---|---|---|---|---|"]
    for i, o in r["ocupacion"].items():
        for s, v in o["secciones"].items():
            L.append(f"| {i} | {s} | {', '.join(v['circuitos']) or '—'} + PE×{v['n_conductores_pe']} | {f(v.get('ancho_ocupado_mm'))} | "
                     f"{f(v.get('reserva', {}).get('reserva_libre_pct'))} | {v['estado']} |")
    L += ["", "Condiciones comunes: `ANCHO_NOMINAL_NO_UTIL`, `ALTURA_ALA_NOMINAL_NO_UTIL`, `D-19_PE_CONTRA_ALA_HUECO_PE_POTENCIA_NO_DEFINIDO` "
          "(se toma hueco PE–potencia = 0; el ancho del PE se suma al de la fila de potencia).", "",
          "### Curvatura", ""]
    for cid, c in r["circuitos"].items():
        L.append(f"- {cid}: " + "; ".join(f"{x['instancia']} {x['estado']}" for x in c["curvatura"]))
    for c in r["pe"]["conductores"]:
        L.append(f"- {c['conductor_id']}: " + "; ".join(f"{x['instancia']} {x['estado']}" for x in c["curvatura"]))
    L += ["", "### Vanos (cargas: cables de potencia asignados + PE)", "", "| Corrida | Luz [mm] | Carga [kg/m] | Registro | Esquema de ensayo | Estado |", "|---|---|---|---|---|---|"]
    for c in r["corridas"]:
        if not c["vanos"]:
            L.append(f"| {c['corrida_id']} | — | — | — | — | {c['estado']} |")
        for v in c["vanos"]:
            evs = v.get("evaluaciones", [])
            reg = ", ".join(sorted({x["registro_carga_id"] or "—" for x in evs})) or "—"
            esq = ", ".join(sorted({(x["esquema_ensayo"] or {}).get("estado", "—") for x in evs})) or "—"
            L.append(f"| {c['corrida_id']} | {f(v['luz_mm'],0)} | {f(v['carga_kg_m'],3)} | {reg} | {esq} | {v['estado']} |")
    L += ["", "Z 300/65/1,24: el registro aplicable es la fila C (CTA 290 kg/m, F-005 'validada por usuario', REV-020/REV-043), "
          "sin esquema de ensayo declarado → `NO_DECLARADO` y el vano queda `CUMPLE_CONDICIONADO`. Con la misma geometría en "
          "escalera G (registro F-001) los vanos del tronco dan `COINCIDE_EN_LO_CONTRASTADO` y `VERIFICADA_CUMPLE`; los de "
          "corridas de un solo vano, `DISTINTO` (sin vanos vecinos)."]
    L += ["", "Escenario de reserva ocupada (circuito K3 adicional en el tronco), evaluado aparte:", ""]
    for c in r["corridas_escenario_reserva"]:
        for v in c["vanos"]:
            L.append(f"- {c['corrida_id']} luz {f(v['luz_mm'],0)} mm: {f(v['carga_kg_m'],3)} kg/m → {v['estado']}")
    s = r["soportes"][0]
    L += ["", f"Soporte {s['soporte_id']}: aplicabilidad {s['aplicabilidad']['estado']}; capacidad del soporte "
          f"{s['capacidad_soporte']['estado']}; anclaje {s['anclaje_y_sustrato']['estado']}. Colocación de uniones y voladizos: "
          "SIN_REGLA_ACREDITADA (diagnóstico).", "", "### PE y equipotencialidad", ""]
    pe = r["pe"]
    L += [f"- Cobertura física: **{pe['cobertura']['estado']}** ({pe['cobertura']['piezas_requeridas']} piezas).",
          "- Longitudes geométricas (sobre eje de bandeja, sin holgura): " +
          ", ".join(f"{c['conductor_id']} {f(c['longitud_geometrica_mm'],0)} mm" for c in pe["conductores"]) +
          f"; total {f(pe['longitud_total_geometrica_mm'],0)} mm.",
          f"- Segmentos compartidos: {[x['instancia'] for x in pe['segmentos_compartidos']]}.",
          f"- Cable: sección {pe['cable']['estado_seccion']}; color {pe['cable'].get('estado_color')}; "
          f"elección {pe['cable'].get('estado_eleccion')}; observaciones: " + " / ".join(pe["cable"]["observaciones"])]
    for k, v in r["equipotencial"]["estados"].items():
        L.append(f"- {k}: **{v}**")
    L += ["", "| Pieza | Vínculo previsto | PE pasa | Alcanzada en el modelo |", "|---|---|---|---|"]
    for b in r["equipotencial"]["bandejas"]:
        L.append(f"| {b['instancia']} | {b['vinculo_previsto']} | {b['pe_pasa_por_la_pieza']} | {b['alcanzada_desde_sistema_proteccion_en_modelo']} |")
    L += ["", "### Cómputo (resumen por producto)", "", "| Producto | Cantidad | Unidad | Estado de la cantidad | Envases |", "|---|---|---|---|---|"]
    for x in r["computo"]["resumen_por_producto"]:
        L.append(f"| {x['sku'] or x['producto_id']} | {f(x['cantidad'],0) if isinstance(x['cantidad'], float) else x['cantidad']} | "
                 f"{x['unidad']} | {x['estado_cantidad']} | {x.get('envases', '—')} |")
    for c in r["computo"]["resumen_cables"]:
        L.append(f"| {c['cable_id']} | {f(c['longitud_mm'],0)} | mm | geométrica (sin holgura) | — |")
    L += ["", f"Líneas pendientes sin cantidad técnica: {r['computo']['lineas_pendientes']} (fijación de tapa, conectores, "
          "terminales y componentes de soporte con evidencia 'propuesta').", "", f"> {r['resumen']['aviso']}", ""]
    (RAIZ / "docs" / "EJEMPLO_TRAZADO.md").write_text("\n".join(L), encoding="utf-8")
    print("docs/EJEMPLO_TRAZADO.md escrito")


if __name__ == "__main__":
    main()
