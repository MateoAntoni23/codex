"""Regresiones de la auditoría independiente de v0.2.1 (informe transcripto por el usuario, 2026-11-05).

Cada clase reproduce un hallazgo tal como lo describe el informe y fija el comportamiento esperado.
Se escribieron ANTES de corregir el motor; su resultado contra v0.2.1 está en CHANGELOG v0.2.2.
Hallazgo 7 (cliente TypeScript): integracion/ts/auditoria_v021.test.ts.
"""
import copy
import http.client
import json
import threading
import unittest

from _comun import RAIZ

from motor_bandejas.contrato import procesar
from motor_bandejas.errores import ErrorMotor
from motor_bandejas.motor import cargar_contexto
from motor_bandejas.servicio import crear_servidor
from motor_bandejas.soportes import contrastar_esquema
from test_trazado import CAB, CAT, DEC, base, calc, dec

CS = cargar_contexto()
CT = (CAB, CAT, DEC)
SECTOR = json.loads((RAIZ / "ejemplos" / "caso1_4_separados.json").read_text(encoding="utf-8"))


def pieza(e, iid):
    return next(p for p in e["piezas"] if p["instancia_id"] == iid)


def punto(e, pid):
    return next(q for q in e["equipotencial"]["puntos"] if q["punto_id"] == pid)


def corrida(r, cid):
    return next(x for x in r["corridas"] if x["corrida_id"] == cid)


def sobre(tipo, entrada, **k):
    s = {"version_contrato": "1.0", "tipo": tipo, "solicitud_id": "A-1", "clave": "K", "revision_entrada": 0,
         "entrada": entrada}
    s.update(k)
    return s


# ------------------------------------------------------------------------------------------------ H1
class H1_CoberturaParcialDelPE(unittest.TestCase):
    """Cada paso de PE1 y PE2 reemplazado por {"instancia": id, "longitud_mm": 1}."""

    def entrada(self):
        e = base()
        for k in e["pe"]["conductores"]:
            k["recorrido"] = [{"instancia": t if isinstance(t, str) else t["instancia"], "longitud_mm": 1}
                              for t in k["recorrido"]]
        return e

    def test_reproduccion_no_es_cobertura_completa(self):
        r = calc(self.entrada(), DEC)
        self.assertEqual(r["pe"]["longitud_total_geometrica_mm"], 8.0)
        self.assertNotEqual(r["pe"]["cobertura"]["estado"], "COMPLETA")
        self.assertEqual(r["equipotencial"]["estados"]["cobertura_fisica_pe"], r["pe"]["cobertura"]["estado"])
        self.assertIn("cobertura del PE incompleta", r["resumen"]["incumplimientos"])

    def test_piezas_parciales_identificadas(self):
        cob = calc(self.entrada(), DEC)["pe"]["cobertura"]
        self.assertEqual(cob["estado"], "INCOMPLETA")           # 1 mm de 3000 mm conocidos: no cubre la pieza
        self.assertEqual(cob["por_pieza"]["R1"]["estado"], "PARCIAL")
        self.assertIn("R1", cob["piezas_con_cobertura_parcial"])

    def test_tramo_parcial_intermedio_es_incoherente(self):
        """Para pasar de R1 a T1 el conductor tiene que recorrer R2 entero: un parcial intermedio no es físico."""
        r = calc(self.entrada(), DEC)
        pe1 = next(c for c in r["pe"]["conductores"] if c["conductor_id"] == "PE1")
        self.assertFalse(pe1["longitud_completa"])
        self.assertFalse(r["pe"]["longitudes_completas"])
        self.assertTrue(any("R2" in f and "intermedio" in f for f in pe1["faltantes"]))

    def test_parcial_en_extremo_mas_corto_que_la_pieza(self):
        e = base()
        e["pe"]["conductores"][1]["recorrido"][-1] = {"instancia": "R5", "longitud_mm": 1000}
        cob = calc(e, DEC)["pe"]["cobertura"]
        self.assertEqual(cob["por_pieza"]["R5"]["estado"], "PARCIAL")   # R5 es recto: su longitud (1500) es conocida
        self.assertEqual(cob["estado"], "INCOMPLETA")

    def test_sin_longitud_de_eje_y_solo_parciales_es_indeterminada(self):
        e = base()
        pieza(e, "T1").pop("longitud_eje_mm")
        e["pe"]["conductores"][0]["recorrido"] = ["R1", "R2", {"instancia": "T1", "longitud_mm": 300}]
        e["pe"]["conductores"].append({"conductor_id": "PE3", "recorrido": [{"instancia": "T1", "longitud_mm": 300}, "R3"],
                                       "inicio": None, "fin": None})
        r = calc(e, DEC)
        cob = r["pe"]["cobertura"]
        self.assertEqual(cob["por_pieza"]["T1"]["estado"], "INDETERMINADA")
        self.assertEqual(cob["estado"], "INDETERMINADA")
        self.assertNotIn("cobertura del PE incompleta", r["resumen"]["incumplimientos"])
        self.assertTrue(any("indeterminada" in x for x in r["resumen"]["verificaciones_bloqueadas"]))
        self.assertNotEqual(r["resumen"]["estado_trazado"], "PRESELECCION_CONDICIONADA")

    def test_control_ejemplo_original_sigue_completo(self):
        """PE2 recorre 300 mm de T1 desde la derivación, pero PE1 recorre T1 entero."""
        cob = calc(d=DEC)["pe"]["cobertura"]
        self.assertEqual(cob["estado"], "COMPLETA")
        self.assertEqual(cob["por_pieza"]["T1"]["estado"], "COMPLETA")


# ------------------------------------------------------------------------------------------------ H2
class H2_RequisitoNoRedefinible(unittest.TestCase):
    def test_reproduccion_10_mm2(self):
        e = base()
        e["pe"]["seccion_requerida_mm2"] = 10
        e["pe"]["cable_id"] = "PRY-SASTFLEX-CU-1x10"
        r = calc(e, DEC)
        self.assertEqual(r["pe"]["requisito"]["seccion_requerida_mm2"], 16)          # D-20 aprobado
        self.assertEqual(r["pe"]["requisito"]["estado"], "ENTRADA_DISTINTA_DEL_REQUISITO_APROBADO")
        self.assertEqual(r["pe"]["cable"]["estado_seccion"], "NO_COINCIDE_CON_REQUISITO")
        self.assertIn("sección del PE distinta del requisito", r["resumen"]["incumplimientos"])
        self.assertIn("requisito del PE redefinido en la entrada", r["resumen"]["incumplimientos"])

    def test_solo_cambia_la_seccion_declarada(self):
        e = base()
        e["pe"]["seccion_requerida_mm2"] = 25
        r = calc(e, DEC)
        self.assertEqual(r["pe"]["cable"]["estado_seccion"], "COINCIDE_CON_REQUISITO")   # cable 16 vs aprobado 16
        self.assertIn("requisito del PE redefinido en la entrada", r["resumen"]["incumplimientos"])

    def test_la_decision_esta_en_la_huella(self):
        d = dec(**{"D-20_seccion_pe_mm2": 25})
        self.assertNotEqual(calc(d=d)["huella"], calc(d=DEC)["huella"])

    def test_control_ejemplo(self):
        r = calc(d=DEC)
        self.assertEqual(r["pe"]["requisito"]["estado"], "COINCIDE_CON_REQUISITO_APROBADO")
        self.assertEqual(r["pe"]["cable"]["estado_seccion"], "COINCIDE_CON_REQUISITO")


# ------------------------------------------------------------------------------------------------ H3
class H3_DerivacionFisicamenteInconsistente(unittest.TestCase):
    def test_reproduccion_d1_en_r1(self):
        e = base()
        punto(e, "D1")["instancias"] = ["R1"]
        r = calc(e, DEC)
        eq = r["equipotencial"]
        d1 = next(p for p in eq["puntos"] if p["punto_id"] == "D1")
        self.assertEqual(d1["estado_fisico"], "FISICAMENTE_INCONSISTENTE")
        self.assertIn("PE2", eq["estados"]["conductores_sin_vinculo_al_sistema_proteccion"])
        self.assertIn("puntos equipotenciales físicamente inconsistentes", r["resumen"]["incumplimientos"])
        self.assertIn("conductores PE sin vínculo con el sistema de protección", r["resumen"]["incumplimientos"])
        b = {x["instancia"]: x for x in eq["bandejas"]}
        self.assertFalse(b["R4"]["alcanzada_desde_sistema_proteccion_en_modelo"])   # R4 cuelga de PE2

    def test_conexion_bandeja_inconsistente_no_crea_vinculo(self):
        e = base()
        punto(e, "B2")["conductores"] = ["PE1"]                     # PE1 no recorre R4
        b = {x["instancia"]: x for x in calc(e, DEC)["equipotencial"]["bandejas"]}
        self.assertEqual(b["R4"]["vinculo_previsto"], "SIN_VINCULO_PREVISTO")

    def test_inicio_del_conductor_en_otra_pieza(self):
        """PE2 declara inicio en D1; D1 debe estar en la primera pieza de PE2."""
        e = base()
        punto(e, "D1")["instancias"] = ["R3"]                       # PE1 sí recorre R3; PE2 no
        r = calc(e, DEC)
        d1 = next(p for p in r["equipotencial"]["puntos"] if p["punto_id"] == "D1")
        self.assertEqual(d1["estado_fisico"], "FISICAMENTE_INCONSISTENTE")

    def test_control_ejemplo(self):
        r = calc(d=DEC)
        self.assertEqual(r["equipotencial"]["estados"]["conductores_sin_vinculo_al_sistema_proteccion"], [])
        self.assertTrue(all(p["estado_fisico"] == "COHERENTE_EN_EL_MODELO" for p in r["equipotencial"]["puntos"]
                            if p["tipo"] in ("derivacion_pe", "conexion_bandeja")))


# ------------------------------------------------------------------------------------------------ H4
class H4_ApoyosCoincidentes(unittest.TestCase):
    def entrada(self):
        e = base()
        s2 = next(s for s in e["soportes"] if s["soporte_id"] == "S2")
        s3 = next(s for s in e["soportes"] if s["soporte_id"] == "S3")
        s2.update(instancia_id="R1", distancia_desde_P1_mm=3000)
        s3.update(instancia_id="R2", distancia_desde_P1_mm=0)
        return e

    def test_reproduccion_rechazo_de_dominio(self):
        with self.assertRaises(ErrorMotor) as cm:
            calc(self.entrada(), DEC)
        self.assertEqual(cm.exception.campo, "soportes")
        self.assertIn("S2", str(cm.exception))
        self.assertIn("S3", str(cm.exception))
        self.assertIn("coinciden", str(cm.exception))

    def test_coincidentes_dentro_de_una_misma_pieza(self):
        e = base()
        next(s for s in e["soportes"] if s["soporte_id"] == "S2")["distancia_desde_P1_mm"] = 750.5   # S1 en 750
        with self.assertRaises(ErrorMotor) as cm:
            calc(e, DEC)
        self.assertIn("coinciden", str(cm.exception))

    def test_reproduccion_por_contrato(self):
        r = procesar(sobre("trazado", self.entrada()), CS, CT)
        self.assertEqual(r["estado"], "error")
        self.assertEqual(r["error"]["codigo"], "ENTRADA_INVALIDA")

    def test_distintos_por_mas_de_la_tolerancia_no_se_rechazan(self):
        e = self.entrada()
        next(s for s in e["soportes"] if s["soporte_id"] == "S3")["distancia_desde_P1_mm"] = 5
        c = corrida(calc(e, DEC), "CORR-R1")
        self.assertTrue(any(v["luz_mm"] == 5.0 for v in c["vanos"]))


# ------------------------------------------------------------------------------------------------ H5
class H5_RectaIncoherente(unittest.TestCase):
    def test_reproduccion(self):
        e = base()
        pieza(e, "R3")["puertos"]["P2"]["posicion_mm"] = [6600, 3000, 3000]
        g = calc(e, DEC)["geometria_piezas"]["R3"]
        self.assertEqual(g["estado"], "INCOHERENTE")
        self.assertTrue(any("eje" in o for o in g["observaciones"]))

    def test_direcciones_invertidas(self):
        e = base()
        p = pieza(e, "R3")["puertos"]
        p["P1"]["direccion"], p["P2"]["direccion"] = [1, 0, 0], [-1, 0, 0]
        self.assertEqual(calc(e, DEC)["geometria_piezas"]["R3"]["estado"], "INCOHERENTE")

    def test_control(self):
        self.assertEqual(calc(d=DEC)["geometria_piezas"]["R3"]["estado"], "COHERENTE")

    def test_tolerancia_angular_d14(self):
        import math
        for desv, esperado in ((0.5, "COHERENTE"), (2.0, "INCOHERENTE")):
            e = base()
            dy = 3000 * math.sin(math.radians(desv))
            pieza(e, "R3")["puertos"]["P2"]["posicion_mm"] = [6600 + 3000 * math.cos(math.radians(desv)), dy, 3000]
            with self.subTest(desv=desv):
                self.assertEqual(calc(e, DEC)["geometria_piezas"]["R3"]["estado"], esperado)


# ------------------------------------------------------------------------------------------------ H6
VALORES_RAROS = ([], {}, None, "x", 1.5, True, -1, [1, 2], {"a": 1})


class H6_ContratoRobusto(unittest.TestCase):
    def test_reproduccion_tipo_circuito_lista(self):
        e = copy.deepcopy(SECTOR)
        e["tipo_circuito"] = []
        r = procesar(sobre("sector", e), CS, CT)
        self.assertEqual((r["estado"], r["error"]["codigo"]), ("error", "ENTRADA_INVALIDA"))

    def _sin_excepciones(self, tipo, ent):
        for clave in list(ent):
            for v in VALORES_RAROS:
                e = copy.deepcopy(ent)
                e[clave] = v
                with self.subTest(clave=clave, valor=v):
                    r = procesar(sobre(tipo, e), CS, CT)
                    self.assertIn(r["estado"], ("ok", "error"))
                    json.dumps(r, allow_nan=False)

    def test_sector_valores_raros_por_clave(self):
        self._sin_excepciones("sector", SECTOR)

    def test_trazado_valores_raros_por_clave(self):
        self._sin_excepciones("trazado", base())

    def test_trazado_valores_raros_anidados(self):
        def mutar(fn):
            e = base()
            fn(e)
            r = procesar(sobre("trazado", e), CS, CT)
            self.assertIn(r["estado"], ("ok", "error"))
        for v in VALORES_RAROS:
            with self.subTest(v=v):
                mutar(lambda e: e["piezas"][0].__setitem__("longitud_mm", v))
                mutar(lambda e: e["piezas"][0]["puertos"]["P1"].__setitem__("posicion_mm", v))
                mutar(lambda e: e["soportes"][0].__setitem__("distancia_desde_P1_mm", v))
                mutar(lambda e: e["pe"].__setitem__("seccion_requerida_mm2", v))
                mutar(lambda e: e["pe"]["conductores"][0].__setitem__("recorrido", v))
                mutar(lambda e: e["equipotencial"]["puntos"][1].__setitem__("instancias", v))
                mutar(lambda e: e["circuitos"][0].__setitem__("cantidad", v))


class H6_H9_Servicio(unittest.TestCase):
    ORIGEN = "http://localhost:5173"

    @classmethod
    def setUpClass(cls):
        cls.srv = crear_servidor(0, cls.ORIGEN)
        cls.puerto = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def crudo(self, metodo, ruta, cuerpo=b"", cabeceras=None):
        c = http.client.HTTPConnection("127.0.0.1", self.puerto, timeout=10)
        c.putrequest(metodo, ruta, skip_host=True, skip_accept_encoding=True)
        cab = {"Host": f"127.0.0.1:{self.puerto}", "Content-Type": "application/json",
               "Content-Length": str(len(cuerpo))}
        cab.update(cabeceras or {})
        for k, v in cab.items():
            if v is not None:
                c.putheader(k, v)
        c.endheaders()
        if cuerpo:
            c.send(cuerpo)
        r = c.getresponse()
        datos = r.read()
        c.close()
        return r.status, dict(r.getheaders()), json.loads(datos) if datos else None

    def sol(self):
        return json.dumps(sobre("sector", SECTOR)).encode()

    # H6
    def test_utf8_invalido(self):
        st, _, j = self.crudo("POST", "/v1/calcular", b'{"a": "\xff\xfe"}')
        self.assertEqual((st, j["estado"], j["error"]["codigo"]), (400, "error", "CODIFICACION_INVALIDA"))

    def test_content_length_no_numerico(self):
        st, _, j = self.crudo("POST", "/v1/calcular", b"", {"Content-Length": "abc"})
        self.assertEqual((st, j["error"]["codigo"]), (400, "CONTENT_LENGTH_INVALIDO"))

    def test_content_length_negativo(self):
        st, _, j = self.crudo("POST", "/v1/calcular", b"", {"Content-Length": "-5"})
        self.assertEqual((st, j["error"]["codigo"]), (400, "CONTENT_LENGTH_INVALIDO"))

    def test_tipo_circuito_lista_por_http(self):
        e = copy.deepcopy(SECTOR)
        e["tipo_circuito"] = []
        st, _, j = self.crudo("POST", "/v1/calcular", json.dumps(sobre("sector", e)).encode())
        self.assertEqual((st, j["estado"], j["error"]["codigo"]), (200, "error", "ENTRADA_INVALIDA"))

    def test_control_ok(self):
        st, _, j = self.crudo("POST", "/v1/calcular", self.sol())
        self.assertEqual((st, j["estado"]), (200, "ok"))

    # H9
    def test_host_ajeno_rechazado(self):
        st, _, j = self.crudo("POST", "/v1/calcular", self.sol(), {"Host": "atacante.example:80"})
        self.assertEqual((st, j["error"]["codigo"]), (403, "HOST_NO_PERMITIDO"))
        st, _, j = self.crudo("GET", "/v1/salud", b"", {"Host": f"evil.test:{self.puerto}", "Content-Length": None})
        self.assertEqual(st, 403)

    def test_host_ausente_rechazado(self):
        st, _, j = self.crudo("POST", "/v1/calcular", self.sol(), {"Host": None})
        self.assertEqual(st, 403)

    def test_host_localhost_admitido(self):
        st, _, j = self.crudo("POST", "/v1/calcular", self.sol(), {"Host": f"localhost:{self.puerto}"})
        self.assertEqual(st, 200)

    def test_origen_ajeno_rechazado(self):
        st, cab, j = self.crudo("POST", "/v1/calcular", self.sol(), {"Origin": "https://evil.example"})
        self.assertEqual((st, j["error"]["codigo"]), (403, "ORIGEN_NO_PERMITIDO"))
        self.assertNotIn("Access-Control-Allow-Origin", cab)

    def test_origen_permitido(self):
        st, cab, j = self.crudo("POST", "/v1/calcular", self.sol(), {"Origin": self.ORIGEN})
        self.assertEqual(st, 200)
        self.assertEqual(cab.get("Access-Control-Allow-Origin"), self.ORIGEN)

    def test_preflight_ajeno_rechazado(self):
        st, cab, _ = self.crudo("OPTIONS", "/v1/calcular", b"", {"Origin": "https://evil.example",
                                                                 "Access-Control-Request-Method": "POST"})
        self.assertEqual(st, 403)
        self.assertNotIn("Access-Control-Allow-Origin", cab)

    def test_content_type_no_json_rechazado(self):
        st, _, j = self.crudo("POST", "/v1/calcular", self.sol(), {"Content-Type": "text/plain"})
        self.assertEqual((st, j["error"]["codigo"]), (415, "CONTENT_TYPE_NO_SOPORTADO"))


class H9_ServicioSinOrigenConfigurado(unittest.TestCase):
    def test_sin_origen_configurado_todo_origin_se_rechaza(self):
        srv = crear_servidor(0, None)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
            c.request("GET", "/v1/salud", headers={"Origin": "http://localhost:5173"})
            self.assertEqual(c.getresponse().status, 403)
            c.close()
            c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
            c.request("GET", "/v1/salud")                       # cliente sin Origin (proceso local): admitido
            self.assertEqual(c.getresponse().status, 200)
            c.close()
        finally:
            srv.shutdown()
            srv.server_close()


# ------------------------------------------------------------------------------------------------ H8
class H8_ContextoDelEsquemaDeEnsayo(unittest.TestCase):
    """El ensayo (imagen) son 3 vanos iguales: lateral – central (unión al centro) – lateral, sobre dos tramos de
    3000 mm. Un vano sin unión coincide solo como LATERAL junto a un vano central coincidente de igual luz."""

    def g65(self):
        e = base()
        for p in e["piezas"]:
            p["producto_id"] = p["producto_id"].replace("-Z", "-G")
        e["tapas"] = []
        return e

    def test_reproduccion_funcion_vano_sin_union_con_dos_vanos(self):
        """Llamada directa equivalente a la del informe: sin unión, n_vanos = 2, sin contexto de corrida."""
        reg = {"fuente_id": "F-001"}
        r = contrastar_esquema(reg, 0, 1500, [], 2, DEC)
        self.assertNotEqual(r["estado"], "COINCIDE_EN_LO_CONTRASTADO")

    def test_reproduccion_en_trazado(self):
        e = self.g65()
        pos = {"S1": ("R1", 100), "S2": ("R1", 1600), "S3": ("R2", 100), "S4": ("R2", 1600)}
        for s in e["soportes"]:
            if s["soporte_id"] in pos:
                s["instancia_id"], s["distancia_desde_P1_mm"] = pos[s["soporte_id"]]
        c = corrida(calc(e, DEC), "CORR-R1")
        v0 = c["vanos"][0]                          # [100, 1600]: sin unión; el vecino [1600, 3100] no es central
        self.assertEqual(v0["evaluaciones"][0]["esquema_ensayo"]["estado"], "DISTINTO")
        self.assertEqual(v0["estado"], "CUMPLE_CONDICIONADO")

    def test_longitud_de_pieza_distinta_del_ensayo(self):
        e = self.g65()
        r1 = pieza(e, "R1")
        r1["longitud_mm"] = 2500
        r1["puertos"]["P1"]["posicion_mm"] = [500, 0, 3000]
        for s in e["soportes"]:
            if s["instancia_id"] == "R1":
                s["distancia_desde_P1_mm"] -= 500
        c = corrida(calc(e, DEC), "CORR-R1")
        central = c["vanos"][1]["evaluaciones"][0]["esquema_ensayo"]
        self.assertEqual(central["estado"], "DISTINTO")
        self.assertTrue(any(x["tema"] == "longitud de los tramos del vano" and not x["coincide"]
                            for x in central["verificaciones"]))

    def test_vecinos_con_otra_luz(self):
        e = self.g65()
        next(s for s in e["soportes"] if s["soporte_id"] == "S4")["distancia_desde_P1_mm"] = 2000   # vano [3750,5000]
        c = corrida(calc(e, DEC), "CORR-R1")
        central = c["vanos"][1]["evaluaciones"][0]["esquema_ensayo"]
        self.assertEqual(central["estado"], "DISTINTO")
        self.assertTrue(any(x["tema"] == "vanos vecinos de igual luz" and not x["coincide"]
                            for x in central["verificaciones"]))

    def test_control_ventana_del_ensayo_coincide(self):
        c = corrida(calc(self.g65(), DEC), "CORR-R1")
        self.assertEqual([v["estado"] for v in c["vanos"]], ["VERIFICADA_CUMPLE"] * 3)
        roles = [v["evaluaciones"][0]["esquema_ensayo"]["rol_en_ensayo"] for v in c["vanos"]]
        self.assertEqual(roles, ["lateral", "central", "lateral"])

    def test_no_exige_union_en_todos_los_vanos(self):
        c = corrida(calc(self.g65(), DEC), "CORR-R1")
        lat = c["vanos"][0]["evaluaciones"][0]["esquema_ensayo"]
        self.assertEqual(lat["estado"], "COINCIDE_EN_LO_CONTRASTADO")
        self.assertFalse(any(x["tema"] == "uniones en el vano" and x["valor"] == 0 and not x["coincide"]
                             for x in lat["verificaciones"]))


if __name__ == "__main__":
    unittest.main()
