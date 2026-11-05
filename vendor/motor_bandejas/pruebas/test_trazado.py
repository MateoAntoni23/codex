"""Pruebas del trazado (v0.2.0) con el catálogo real y geometría controlada.

El trazado base es el ejemplo `ejemplos/trazado_derivacion_pe.json`: SINTÉTICO en geometría, circuitos y soportes;
productos y datos del catálogo real. Los cables con radio publicado son objetos SINTÉTICOS construidos en la
prueba (prefijo EJ-), nunca cargados al registro real.
"""
import copy
import json
import unittest

from _comun import RAIZ

from motor_bandejas.datos_cables import Cable
from motor_bandejas.errores import ErrorEntrada
from motor_bandejas.motor import cargar_contexto_trazado
from motor_bandejas.trazado import SesionTrazado, calcular_trazado, resultado_trazado_vigente
from motor_bandejas.trazado_analisis import clasificar_curva, evaluar_curvatura

CAB, CAT, DEC = cargar_contexto_trazado()
BASE = json.loads((RAIZ / "ejemplos" / "trazado_derivacion_pe.json").read_text(encoding="utf-8"))


def dec(**k):
    d = copy.deepcopy(DEC)
    d.update(k)
    return d


DEC_PE = dec(**{"D-19_posicion_pe": "contacto_en_extremo_de_fila"})


def base():
    return copy.deepcopy(BASE)


def calc(e=None, d=None):
    return calcular_trazado(e or base(), CAB, CAT, d or DEC_PE)


def pieza(e, iid):
    return next(p for p in e["piezas"] if p["instancia_id"] == iid)


def punto(e, pid):
    return next(p for p in e["equipotencial"]["puntos"] if p["punto_id"] == pid)


def cable_sintetico(D=10.0, registros=()):
    return Cable(cable_id="EJ-SINT-CABLE", fabricante="FICTICIO", linea="SINTÉTICO", material="cobre", tipo="unipolar",
                 n_conductores=1, formacion="10", diametro_exterior_mm=D, masa_kg_km=100, masa_kg_m=0.1,
                 dataset_id="EJ-SINT", fuente={"documento": "sintético"}, radio_minimo=tuple(registros),
                 radio_minimo_estado="publicado" if registros else "no publicado")


class Compatibilidad(unittest.TestCase):
    def test_conexiones_del_ejemplo(self):
        c = calc()["conexiones"]
        self.assertEqual(c["C1"]["compatibilidad"]["estado"], "COMPATIBLE_DOCUMENTADA")       # recta P2 ↔ recta P1
        self.assertEqual(c["C1"]["compatibilidad"]["condiciones"], [])
        self.assertEqual(c["C2"]["compatibilidad"]["condiciones"], ["EQUIVALENCIA_EXTREMOS_RECTA_D-13"])
        self.assertEqual(c["C4"]["compatibilidad"]["registro"]["puerto_b_id"], "SAM_TS-300-065-18-Z-P3")

    def test_sin_d13_el_extremo_p2_queda_no_registrado(self):
        r = calc(d=dec(**{"D-19_posicion_pe": "contacto_en_extremo_de_fila", "D-13_equivalencia_extremos_recta": "no_aplicar"}))
        self.assertEqual(r["conexiones"]["C2"]["compatibilidad"]["estado"], "NO_REGISTRADA")

    def test_familias_incompatibles_g_z(self):
        e = base()
        pieza(e, "R2")["producto_id"] = "SAM_TRES-300-065-18-G"
        r = calc(e)
        comp = r["conexiones"]["C1"]["compatibilidad"]
        self.assertEqual(comp["estado"], "NO_COMPATIBLE")
        self.assertIn("conexiones no compatibles", r["resumen"]["incumplimientos"])

    def test_pieza_especial_con_pieza_especial_no_registrada(self):
        e = base()
        e["conexiones"] = [k for k in e["conexiones"] if k["conexion_id"] != "C5"]
        # conectar la curva directamente a la boca P3 de la T (sin tramo intermedio)
        e["conexiones"] = [k for k in e["conexiones"] if k["conexion_id"] != "C4"]
        e["conexiones"].append({"conexion_id": "CX", "a": ["T1", "P3"], "b": ["CS1", "P1"]})
        e["circuitos"][1]["recorrido"] = ["R1", "R2", "T1", "CS1", "R5"]
        e["pe"]["conductores"][1]["recorrido"] = [{"instancia": "T1", "longitud_mm": 300}, "CS1", "R5"]
        e["piezas"] = [p for p in e["piezas"] if p["instancia_id"] != "R4"]
        e["soportes"] = [s for s in e["soportes"] if s["instancia_id"] != "R4"]
        e["equipotencial"]["puntos"] = [p for p in e["equipotencial"]["puntos"] if p["punto_id"] != "B2"]
        comp = calc(e)["conexiones"]["CX"]["compatibilidad"]
        self.assertEqual(comp["estado"], "NO_REGISTRADA")
        self.assertIn("NO equivale", comp["detalle"])

    def test_tapa_compatible_y_no_registrada(self):
        r = calc()
        self.assertEqual(r["tapas"]["TP1"]["estado"], "COMPATIBLE_DOCUMENTADA")
        e = base()
        e["tapas"][0]["producto_id"] = "SAM_TTRS-300-18-G"
        self.assertEqual(calc(e)["tapas"]["TP1"]["estado"], "NO_REGISTRADA")


class EncajeYOrientacion(unittest.TestCase):
    def test_ejemplo_coherente(self):
        r = calc()
        self.assertEqual(r["resumen"]["encaje"], {"COHERENTE": 6})
        self.assertEqual(r["geometria_piezas"]["CS1"]["clase"], "curva horizontal")
        self.assertEqual(r["geometria_piezas"]["CS1"]["giro_grados"], 90.0)

    def test_puerto_desplazado(self):
        e = base()
        pieza(e, "R2")["puertos"]["P1"]["posicion_mm"] = [3002, 0, 3000]
        r = calc(e)
        self.assertEqual(r["conexiones"]["C1"]["encaje"]["estado"], "INCOHERENTE")
        self.assertEqual(r["geometria_piezas"]["R2"]["estado"], "INCOHERENTE")   # distancia ≠ longitud

    def test_curva_horizontal_colocada_vertical(self):
        e = base()
        pieza(e, "CS1")["puertos"]["P2"]["direccion"] = [0, 0, 1]
        g = calc(e)["geometria_piezas"]["CS1"]
        self.assertEqual(g["estado"], "INCOHERENTE")
        self.assertEqual(g["clase"], "curva vertical interior")

    def test_angulo_distinto_al_publicado(self):
        e = base()
        d = 2 ** -0.5
        pieza(e, "CS1")["puertos"]["P2"]["direccion"] = [d, d, 0]          # giro 45° en una curva de 90°
        g = calc(e)["geometria_piezas"]["CS1"]
        self.assertTrue(any("ángulo publicado" in o for o in g["observaciones"]))

    def test_clasificacion_vertical(self):
        up = [0, 0, 1]
        self.assertEqual(clasificar_curva([-1, 0, 0], [0, 0, 1], up)["clase"], "curva vertical interior")
        self.assertEqual(clasificar_curva([0, 0, 1], [-1, 0, 0], up)["clase"], "curva vertical interior")  # sentido inverso
        self.assertEqual(clasificar_curva([-1, 0, 0], [0, 0, -1], up)["clase"], "curva vertical exterior")
        self.assertEqual(clasificar_curva([-1, 0, 0], [0, 1, 0], up)["clase"], "curva horizontal")

    def test_sin_geometria(self):
        e = base()
        for p in e["piezas"]:
            p.pop("puertos", None)
        r = calc(e)
        self.assertEqual(r["resumen"]["encaje"], {"NO_VERIFICABLE_SIN_GEOMETRIA": 6})
        k2 = r["circuitos"]["K2"]["curvatura"]
        self.assertEqual(next(x for x in k2 if x["instancia"] == "T1")["estado"], "NO_VERIFICABLE_SIN_GEOMETRIA")


class RadioDeCurvatura(unittest.TestCase):
    CS = CAT.piezas["SAM_CS-300-90-065-18-Z"]   # radio 300, referencia 'interior' (F-001)

    def test_cable_real_sin_radio_publicado(self):
        ev = evaluar_curvatura(CAB.obtener("PRY-SVALIO-CU-1x35"), self.CS, 300, "si", None, None, DEC)
        self.assertEqual(ev["estado"], "NO_VERIFICABLE_RADIO_CABLE_NO_PUBLICADO")

    def test_radio_eje_cable_vs_borde_interior(self):
        c = cable_sintetico(10.0, [{"condicion": "instalado", "multiplo_D": 30, "referencia": "eje_cable"}])
        ev = evaluar_curvatura(c, self.CS, 300, "si", None, None, DEC)
        # requerido 300; disponible en el eje del cable contra el ala interior = 300 + 5 = 305
        self.assertEqual(ev["evaluaciones"][0]["radio_disponible_mm"], 305.0)
        self.assertEqual(ev["estado"], "CUMPLE")
        c = cable_sintetico(10.0, [{"condicion": "instalado", "multiplo_D": 31, "referencia": "eje_cable"}])
        self.assertEqual(evaluar_curvatura(c, self.CS, 300, "si", None, None, DEC)["estado"], "NO_CUMPLE")

    def test_referencia_no_especificada_es_conservadora(self):
        c = cable_sintetico(10.0, [{"condicion": "instalado", "valor_mm": 302, "referencia": "no especificada"}])
        ev = evaluar_curvatura(c, self.CS, 300, "si", None, None, DEC)
        self.assertEqual(ev["estado"], "NO_CUMPLE")                       # se compara contra 300, no 305
        self.assertIn("REFERENCIA_RADIO_CABLE_NO_ESPECIFICADA", ev["condiciones"])

    def test_referencias_de_pieza(self):
        import dataclasses
        c = cable_sintetico(10.0, [{"condicion": "instalado", "valor_mm": 100, "referencia": "intrados_cable"}])
        eje = dataclasses.replace(self.CS, referencia_radio="eje")
        self.assertEqual(evaluar_curvatura(c, eje, 300, "si", None, None, DEC)["radio_borde_interior_mm"], 150.0)
        ext = dataclasses.replace(self.CS, referencia_radio="exterior")
        self.assertEqual(evaluar_curvatura(c, ext, 300, "si", None, None, DEC)["radio_borde_interior_mm"], 0.0)
        ne = dataclasses.replace(self.CS, referencia_radio="no especificado")
        self.assertEqual(evaluar_curvatura(c, ne, 300, "si", None, None, DEC)["estado"],
                         "NO_VERIFICABLE_REFERENCIA_DE_RADIO_NO_UTILIZABLE")

    def test_curva_vertical_sin_referencia_definida(self):
        c = cable_sintetico(10.0, [{"condicion": "instalado", "valor_mm": 100, "referencia": "eje_cable"}])
        cus = CAT.piezas["SAM_CUS-300-5-065-18-Z"]
        self.assertEqual(evaluar_curvatura(c, cus, 300, "si", None, None, DEC)["estado"], "NO_VERIFICABLE_RADIO_VERTICAL")

    def test_t_de_paso_recto_no_curva(self):
        r = calc()
        k1 = r["circuitos"]["K1"]["curvatura"]
        self.assertEqual(k1, [{**k1[0], "estado": "SIN_CURVATURA"}])
        self.assertEqual(k1[0]["instancia"], "T1")


class AsignacionARamales(unittest.TestCase):
    def test_cables_por_boca_de_la_t(self):
        o = calc()["ocupacion"]["T1"]
        self.assertEqual(o["modo_seccion"], "puerto")
        self.assertEqual(sorted(o["secciones"]["P1"]["circuitos"]), ["K1", "K2"])
        self.assertEqual(o["secciones"]["P2"]["circuitos"], ["K1"])          # tronco
        self.assertEqual(o["secciones"]["P3"]["circuitos"], ["K2"])          # ramal: no se duplica K1

    def test_ramal_sin_circuitos_no_recibe_cables(self):
        e = base()
        e["circuitos"] = [e["circuitos"][0]]
        r = calc(e)
        self.assertEqual(r["ocupacion"]["R4"]["secciones"]["pieza"]["circuitos"], [])
        self.assertEqual(r["cargas_por_pieza"]["R4"]["cables_potencia_kg_m"], 0.0)

    def test_recorrido_discontinuo(self):
        e = base()
        e["circuitos"][0]["recorrido"] = ["R1", "T1", "R3"]                  # salta R2
        r = calc(e)
        self.assertEqual(r["circuitos"]["K1"]["recorrido"]["estado"], "DISCONTINUO")
        self.assertEqual(r["circuitos"]["K1"]["recorrido"]["saltos_sin_conexion"], [["R1", "T1"]])

    def test_ancho_ocupado_por_seccion(self):
        o = calc()["ocupacion"]
        # 6 × 1x35 separados (D 13,8) + PE 7,0 en contacto (D-19 propuesta) = 151,8 + 7 = 158,8
        self.assertEqual(o["R1"]["secciones"]["pieza"]["ancho_ocupado_mm"], 158.8)
        self.assertEqual(o["T1"]["secciones"]["P3"]["ancho_ocupado_mm"], 69.0 + 7.0)


class Computo(unittest.TestCase):
    def test_uniones_una_vez_por_conexion(self):
        r = calc()
        jb = next(x for x in r["computo"]["resumen_por_producto"] if x["producto_id"] == "SAM_JB-CC-3_8")
        self.assertEqual(jb["cantidad"], 4 * len(r["conexiones"]))
        lineas = [l for l in r["computo"]["lineas"] if l["producto_id"] == "SAM_JB-CC-3_8"]
        self.assertEqual(len({l["origen"]["conexion"] for l in lineas}), len(lineas))
        self.assertEqual(jb["envases"], 1)

    def test_piezas_y_cortes(self):
        r = calc()
        tres = next(x for x in r["computo"]["resumen_por_producto"] if x["producto_id"] == "SAM_TRES-300-065-18-Z")
        self.assertEqual(tres["cantidad"], 5)
        r5 = next(l for l in r["computo"]["lineas"] if l["origen"] == {"pieza": "R5"})
        self.assertIn("Corte", r5["nota"])

    def test_pendientes_sin_cantidad_inventada(self):
        r = calc()
        for l in r["computo"]["lineas"]:
            if l["estado_cantidad"] in ("pendiente", "no_documentada"):
                self.assertTrue(l["cantidad"] is None or l["estado_cantidad"] == "no_documentada")
        tapa_fij = next(l for l in r["computo"]["lineas"] if l["regla"] == "fijación de tapa")
        self.assertIsNone(tapa_fij["cantidad"])

    def test_conexion_no_compatible_bloquea_union(self):
        e = base()
        pieza(e, "R2")["producto_id"] = "SAM_TRES-300-065-18-G"
        l = next(l for l in calc(e)["computo"]["lineas"] if l["origen"] == {"conexion": "C1"})
        self.assertEqual(l["estado_cantidad"], "bloqueada")


class Soportes(unittest.TestCase):
    def test_vanos_con_cta_tabulada(self):
        r = calc()
        c = next(x for x in r["corridas"] if x["corrida_id"] == "CORR-R1")
        self.assertEqual([v["luz_mm"] for v in c["vanos"]], [1500.0] * 3)
        self.assertTrue(all(v["estado"] == "CUMPLE_CONDICIONADO" for v in c["vanos"]))  # Z65: CTA adoptada DER-001
        self.assertEqual(c["vanos"][0]["carga_kg_m"], 2.849)
        u = next(d for d in c["diagnosticos"] if d["tema"] == "posición de unión")
        self.assertEqual((u["fraccion_del_vano"], u["estado"]), (0.5, "SIN_REGLA_ACREDITADA"))

    def test_luz_sin_tabla_no_se_interpola(self):
        e = base()
        next(s for s in e["soportes"] if s["soporte_id"] == "S2")["distancia_desde_P1_mm"] = 2350
        c = next(x for x in calc(e)["corridas"] if x["corrida_id"] == "CORR-R1")
        self.assertEqual(c["vanos"][0]["estado"], "NO_VERIFICABLE")

    def test_tapa_sin_masa_bloquea_vano(self):
        c = next(x for x in calc()["corridas"] if x["corrida_id"] == "CORR-R3")
        self.assertEqual(c["vanos"][0]["estado"], "NO_VERIFICABLE_CARGA_TAPA_DESCONOCIDA")

    def test_sin_soportes_y_un_soporte(self):
        e = base()
        e["soportes"] = []
        self.assertTrue(all(c["estado"] == "NO_VERIFICABLE_SIN_SOPORTES" for c in calc(e)["corridas"]))
        c = next(x for x in calc()["corridas"] if x["corrida_id"] == "CORR-R5")
        self.assertEqual(c["estado"], "NO_VERIFICABLE_UN_SOLO_SOPORTE")

    def test_capacidades_separadas(self):
        s = calc()["soportes"][0]
        self.assertEqual(s["aplicabilidad"]["estado"], "APLICA_DOCUMENTADA")
        self.assertEqual(s["capacidad_soporte"]["estado"], "NO_VERIFICABLE_SIN_MODELO_DE_REPARTO")
        self.assertEqual(s["capacidad_soporte"]["valores_publicados"][0]["carga_unidad"], "kg")
        self.assertEqual(s["anclaje_y_sustrato"]["estado"], "NO_VERIFICABLE_FUERA_DE_ALCANCE")

    def test_soporte_fuera_de_rango_o_de_sistema(self):
        e = base()
        e["soportes"][0]["sistema_soporte_id"] = "SIS-005"           # soporte simple: perforada 50–100
        s = calc(e)["soportes"][0]
        self.assertEqual(s["aplicabilidad"]["estado"], "NO_REGISTRADA")
        self.assertEqual(s["pertenencia"]["estado"], "PRODUCTO_NO_ASOCIADO_AL_SISTEMA")

    def test_escenario_reserva_es_aparte(self):
        r = calc()
        act = next(x for x in r["corridas"] if x["corrida_id"] == "CORR-R1")["vanos"][0]["carga_kg_m"]
        esc = next(x for x in r["corridas_escenario_reserva"] if x["corrida_id"] == "CORR-R1")["vanos"][0]["carga_kg_m"]
        self.assertAlmostEqual(esc - act, 3 * 0.447, places=6)
        e = base()
        e.pop("escenario_reserva")
        self.assertEqual(calc(e)["corridas_escenario_reserva"]["estado"], "NO_DEFINIDO")


class PE(unittest.TestCase):
    def test_cobertura_completa_y_compartidos(self):
        r = calc()
        self.assertEqual(r["pe"]["cobertura"]["estado"], "COMPLETA")
        self.assertEqual(r["pe"]["segmentos_compartidos"][0]["instancia"], "T1")
        L = {c["conductor_id"]: c["longitud_geometrica_mm"] for c in r["pe"]["conductores"]}
        self.assertEqual(L, {"PE1": 9600.0, "PE2": 300 + 3000 + 707 + 1500})
        self.assertIsNone(r["pe"]["conductores"][0]["holgura_mm"])

    def test_ramal_sin_pe(self):
        e = base()
        e["pe"]["conductores"] = e["pe"]["conductores"][:1]
        punto(e, "D1")["conductores"] = ["PE1", "PE1"]
        e["equipotencial"]["puntos"] = [p for p in e["equipotencial"]["puntos"] if p["punto_id"] not in ("D1", "B2")]
        r = calc(e)
        self.assertEqual(r["pe"]["cobertura"]["estado"], "INCOMPLETA")
        self.assertEqual(r["pe"]["cobertura"]["piezas_sin_pe"], ["CS1", "R4", "R5"])
        self.assertIn("cobertura del PE incompleta", r["resumen"]["incumplimientos"])

    def test_conexion_equipotencial_faltante(self):
        e = base()
        e["equipotencial"]["puntos"] = [p for p in e["equipotencial"]["puntos"] if p["punto_id"] != "B2"]
        b = {x["instancia"]: x for x in calc(e)["equipotencial"]["bandejas"]}
        self.assertEqual(b["R4"]["vinculo_previsto"], "SIN_VINCULO_PREVISTO")
        self.assertTrue(b["R4"]["pe_pasa_por_la_pieza"])     # el PE pasa, pero eso no es conexión

    def test_sin_sistema_de_proteccion(self):
        e = base()
        e["equipotencial"]["puntos"] = [p for p in e["equipotencial"]["puntos"] if p["punto_id"] != "SP1"]
        e["pe"]["conductores"][0]["inicio"] = None
        r = calc(e)
        self.assertEqual(r["equipotencial"]["estados"]["conexion_sistema_proteccion"], "AUSENTE")
        self.assertEqual(r["equipotencial"]["estados"]["conductores_sin_vinculo_al_sistema_proteccion"], ["PE1", "PE2"])
        self.assertIn("PE sin conexión al sistema de protección", r["resumen"]["incumplimientos"])

    def test_pe_contado_una_sola_vez(self):
        r = calc()
        q = r["cargas_por_pieza"]["R1"]
        self.assertEqual((q["conductores_pe"], q["pe_kg_m"]), (1, 0.167))
        self.assertAlmostEqual(q["q_kg_m"], 6 * 0.447 + 0.167, places=9)
        self.assertEqual(r["cargas_por_pieza"]["T1"]["conductores_pe"], 2)    # dos conductores físicos en la T
        e = base()
        e["circuitos"].append({"circuito_id": "KPE", "funcion": "potencia", "cable_id": "PRY-SASTFLEX-CU-1x16",
                               "cantidad": 1, "separado": False, "recorrido": ["R1"]})
        with self.assertRaises(ErrorEntrada):
            calc(e)
        e = base()
        e["circuitos"][0]["funcion"] = "PE"
        with self.assertRaises(ErrorEntrada):
            calc(e)

    def test_estados_electricos_nunca_completos(self):
        est = calc()["equipotencial"]["estados"]
        self.assertEqual(est["verificacion_electrica_de_diseno"], "PENDIENTE")
        self.assertEqual(est["verificacion_por_inspeccion_o_medicion"], "NO_REALIZADA")
        self.assertEqual(est["conexiones_previstas"], "PENDIENTES")

    def test_cable_pe_observaciones_de_ficha(self):
        c = calc()["pe"]["cable"]
        self.assertEqual(c["estado_seccion"], "COINCIDE_CON_REQUISITO")
        self.assertTrue(any("no incluyen bandejas" in o for o in c["observaciones"]))
        e = base()
        e["pe"]["cable_id"] = "PRY-SVALIO-CU-1x16"
        e["equipotencial"]["puntos"][-1]["conductor_puente"]["cable_id"] = "PRY-SVALIO-CU-1x16"
        c = calc(e)["pe"]["cable"]
        self.assertTrue(any("verde/amarillo" in o for o in c["observaciones"]))
        e["pe"]["cable_id"] = "PRY-SVALIO-CU-1x10"
        self.assertEqual(calc(e)["pe"]["cable"]["estado_seccion"], "NO_COINCIDE_CON_REQUISITO")

    def test_derivacion_fuera_de_recorrido(self):
        e = base()
        punto(e, "D1")["instancias"] = ["R3"]
        d1 = next(p for p in calc(e)["equipotencial"]["puntos"] if p["punto_id"] == "D1")
        self.assertTrue(d1["observaciones"])


class DatosFaltantesYCondiciones(unittest.TestCase):
    def test_d19_pendiente_bloquea(self):
        # v0.2.1: el valor por defecto pasó a 'contra_ala_en_contacto'; 'pendiente' sigue bloqueando
        r = calc(d=dec(**{"D-19_posicion_pe": "pendiente"}))
        self.assertEqual(r["resumen"]["estado_trazado"], "CON_BLOQUEOS")
        s = r["ocupacion"]["R1"]["secciones"]["pieza"]
        self.assertEqual((s["estado"], s["bloqueo"]["decision_id"]), ("BLOQUEADO", "D-19"))
        self.assertEqual(s["cota_inferior_con_pe_mm"], 158.8)

    def test_preseleccion_condicionada_nunca_aprobada(self):
        r = calc()
        self.assertEqual(r["resumen"]["estado_trazado"], "PRESELECCION_CONDICIONADA")
        self.assertIn("ANCHO_NOMINAL_NO_UTIL", r["ocupacion"]["R1"]["secciones"]["pieza"]["condiciones"])
        self.assertEqual(r["verificacion_electrica"]["estado"], "NO_REALIZADA")
        self.assertNotIn("APROB", json.dumps(r["resumen"]))

    def test_longitud_de_eje_faltante(self):
        e = base()
        pieza(e, "CS1").pop("longitud_eje_mm")
        pe2 = next(c for c in calc(e)["pe"]["conductores"] if c["conductor_id"] == "PE2")
        self.assertFalse(pe2["longitud_completa"])
        self.assertTrue(pe2["faltantes"])

    def test_json_estricto(self):
        json.dumps(calc(), allow_nan=False)
        json.dumps(calc(d=DEC), allow_nan=False)


class Validacion(unittest.TestCase):
    def assertRechaza(self, e):
        with self.assertRaises(ErrorEntrada):
            calcular_trazado(e, CAB, CAT, DEC_PE)

    def test_rechazos(self):
        e = base(); e["extra"] = 1; self.assertRechaza(e)
        e = base(); pieza(e, "R1")["longitud_mm"] = 3001; self.assertRechaza(e)          # > longitud comercial
        e = base(); pieza(e, "R1")["longitud_mm"] = 0; self.assertRechaza(e)
        e = base(); e["conexiones"].append({"conexion_id": "CZ", "a": ["R1", "P2"], "b": ["R3", "P2"]}); self.assertRechaza(e)
        e = base(); e["conexiones"][0]["b"] = ["R2", "P9"]; self.assertRechaza(e)
        e = base(); e["conexiones"][0]["b"] = ["R1", "P1"]; self.assertRechaza(e)
        e = base(); e["circuitos"][0]["cantidad"] = 1.5; self.assertRechaza(e)
        e = base(); pieza(e, "CS1")["longitud_mm"] = 700; self.assertRechaza(e)
        e = base(); pieza(e, "R1")["puertos"]["P1"]["direccion"] = [2, 0, 0]; self.assertRechaza(e)
        e = base(); e["pe"]["conductores"][0]["inicio"] = "NO-EXISTE"; self.assertRechaza(e)
        e = base(); e["soportes"][0]["distancia_desde_P1_mm"] = 3500; self.assertRechaza(e)
        e = base(); e["tapas"][0]["producto_id"] = "SAM_TRES-300-065-18-Z"; self.assertRechaza(e)
        e = base(); e["piezas"].append(copy.deepcopy(pieza(e, "R1"))); self.assertRechaza(e)
        e = base(); e["circuitos"][0]["recorrido"] = ["R1", "R1"]; self.assertRechaza(e)
        e = base(); e["escenario_reserva"]["circuitos"][0]["separado"] = "si"; self.assertRechaza(e)


class Invalidacion(unittest.TestCase):
    def test_huella_cambia_con_cada_capa(self):
        h0 = calc()["huella"]
        cambios = [
            lambda e: pieza(e, "R5").__setitem__("longitud_mm", 1400),                      # trazado
            lambda e: e["circuitos"][0].__setitem__("cantidad", 4),                          # cables
            lambda e: e["tapas"].clear(),                                                    # piezas/accesorios
            lambda e: e["soportes"][0].__setitem__("distancia_desde_P1_mm", 700),           # soportes
            lambda e: e["equipotencial"]["puntos"].pop(),                                    # conexiones eq.
            lambda e: e["pe"].__setitem__("cable_id", "PRY-SVALIO-CU-1x16"),                 # PE
        ]
        for f in cambios:
            e = base()
            f(e)
            if e["pe"]["cable_id"] == "PRY-SVALIO-CU-1x16":
                e["equipotencial"]["puntos"][-1]["conductor_puente"]["cable_id"] = "PRY-SVALIO-CU-1x16"
            with self.subTest(f=f):
                self.assertNotEqual(calc(e)["huella"], h0)
        e = base()
        e["meta"]["descripcion"] = "otro texto"
        self.assertEqual(calc(e)["huella"], h0)                                             # meta no interviene

    def test_sesion_trazado(self):
        d = copy.deepcopy(DEC_PE)
        s = SesionTrazado(CAB, CAT, d, base())
        r = s.calcular()
        self.assertTrue(s.vigente())
        self.assertTrue(resultado_trazado_vigente(r, base(), CAB, CAT, d))
        e = base()
        e["conexiones"].pop()
        s.establecer_entrada(e)
        self.assertFalse(s.vigente())
        self.assertEqual(s.resultado["vigencia"], "DESACTUALIZADO")
        s.establecer_entrada(base())
        s.calcular()
        d["D-14_tolerancia_posicion_mm"] = 5.0                      # mutación externa de decisiones
        self.assertFalse(s.vigente())


class V021_EsquemaDeEnsayo(unittest.TestCase):
    """D-12 resuelta por el usuario: los ensayos siguen el esquema de la imagen (dos tramos de 3 m, unión al centro)."""

    def g65(self):
        e = base()
        for p in e["piezas"]:
            p["producto_id"] = p["producto_id"].replace("-Z", "-G")     # escalera G: CTA documentada F-001
        e["tapas"] = []                                                 # sin tapa (masa no publicada)
        return e

    def corrida(self, r, cid):
        return next(x for x in r["corridas"] if x["corrida_id"] == cid)

    def test_vano_igual_al_ensayo_queda_verificado(self):
        c = self.corrida(calc(self.g65(), DEC), "CORR-R1")
        for v in c["vanos"]:
            self.assertEqual(v["estado"], "VERIFICADA_CUMPLE")
            self.assertTrue(v["esquema_ensayo_contrastado"])
        medio = c["vanos"][1]["evaluaciones"][0]["esquema_ensayo"]
        self.assertEqual(medio["estado"], "COINCIDE_EN_LO_CONTRASTADO")
        self.assertTrue(any(x["tema"] == "unión al centro del vano" and x["coincide"] for x in medio["verificaciones"]))
        self.assertTrue(medio["no_contrastado"])                      # lo no contrastado se declara

    def test_union_fuera_del_centro_condiciona(self):
        e = self.g65()
        for s in e["soportes"]:
            if s["instancia_id"] in ("R1", "R2"):
                s["distancia_desde_P1_mm"] -= 200                     # la unión queda a 200 mm del centro del vano
        v = self.corrida(calc(e, DEC), "CORR-R1")["vanos"][1]
        self.assertEqual(v["evaluaciones"][0]["estado_mecanico_registro"], "VERIFICADA_CUMPLE")
        self.assertEqual(v["evaluaciones"][0]["esquema_ensayo"]["estado"], "DISTINTO")
        self.assertEqual(v["estado"], "CUMPLE_CONDICIONADO")

    def test_union_sobre_apoyo(self):
        e = self.g65()
        pos = {"S1": 0, "S2": 1500, "S3": 0, "S4": 1500}           # apoyos cada 1500 mm, uno en la unión (x = 3000)
        for s in e["soportes"]:
            if s["soporte_id"] in pos:
                s["distancia_desde_P1_mm"] = pos[s["soporte_id"]]
        v = self.corrida(calc(e, DEC), "CORR-R1")["vanos"][1]
        self.assertEqual(v["luz_mm"], 1500.0)
        self.assertTrue(any(x["tema"] == "unión sobre apoyo" and not x["coincide"]
                            for x in v["evaluaciones"][0]["esquema_ensayo"]["verificaciones"]))
        self.assertEqual(v["estado"], "CUMPLE_CONDICIONADO")

    def test_vano_aislado_es_distinto(self):
        v = self.corrida(calc(self.g65(), DEC), "CORR-R4")["vanos"][0]          # corrida con un solo vano
        self.assertEqual(v["evaluaciones"][0]["esquema_ensayo"]["estado"], "DISTINTO")
        self.assertEqual(v["estado"], "CUMPLE_CONDICIONADO")

    def test_valor_adoptado_sin_esquema_declarado(self):
        v = self.corrida(calc(d=DEC), "CORR-R1")["vanos"][1]              # Z65: fila C (F-005)
        self.assertEqual(v["evaluaciones"][0]["registro_carga_id"], "CAR-0051")
        self.assertEqual(v["evaluaciones"][0]["esquema_ensayo"]["estado"], "NO_DECLARADO")
        self.assertFalse(v["esquema_ensayo_contrastado"])

    def test_esquema_en_la_huella(self):
        d = dec()
        d["esquemas_ensayo"] = copy.deepcopy(d["esquemas_ensayo"])
        d["esquemas_ensayo"][0]["topologia"]["uniones_por_vano_max"] = 2
        self.assertNotEqual(calc(d=d)["huella"], calc(d=DEC)["huella"])


class V021_PE(unittest.TestCase):
    def test_d19_por_defecto_contra_ala(self):
        s = calc(d=DEC)["ocupacion"]["R1"]["secciones"]["pieza"]
        self.assertEqual(s["estado"], "PRESELECCION_CONDICIONADA")
        self.assertIn("D-19_PE_CONTRA_ALA_HUECO_PE_POTENCIA_NO_DEFINIDO", s["condiciones"])

    def test_color_verde_amarillo_requerido(self):
        self.assertEqual(calc(d=DEC)["pe"]["cable"]["estado_color"], "CUMPLE")
        e = base()
        e["pe"]["cable_id"] = "PRY-SVALIO-CU-1x16"
        r = calc(e, DEC)
        self.assertEqual(r["pe"]["cable"]["estado_color"], "NO_CUMPLE_REQUISITO")
        self.assertIn("identificación del PE (color) no declarada", r["resumen"]["incumplimientos"])

    def test_contacto_con_el_ala_no_es_vinculo_electrico(self):
        e = base()
        e["equipotencial"]["puntos"] = [q for q in e["equipotencial"]["puntos"]
                                        if q["tipo"] not in ("conexion_bandeja", "puente")]
        b = {x["instancia"]: x for x in calc(e, DEC)["equipotencial"]["bandejas"]}
        self.assertTrue(b["R1"]["pe_pasa_por_la_pieza"])          # el PE recorre la pieza apoyado contra el ala…
        self.assertEqual(b["R1"]["vinculo_previsto"], "SIN_VINCULO_PREVISTO")   # …pero el contacto no es conexión


if __name__ == "__main__":
    unittest.main()
