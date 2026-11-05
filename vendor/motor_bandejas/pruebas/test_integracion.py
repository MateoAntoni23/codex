"""Contrato versionado, servicio HTTP, vectores de paridad y esquemas JSON."""
import http.client
import json
import subprocess
import sys
import threading
import unittest

from _comun import RAIZ

from motor_bandejas import __version__
from motor_bandejas.contrato import procesar
from motor_bandejas.motor import cargar_contexto, cargar_contexto_trazado
from motor_bandejas.servicio import crear_servidor

CS, CT = cargar_contexto(), cargar_contexto_trazado()
VEC = {n: json.loads((RAIZ / "integracion" / "vectores" / f"{n}.json").read_text(encoding="utf-8"))
       for n in ("sector_caso1", "sector_error_cantidad", "trazado_ejemplo")}
ESQ = json.loads((RAIZ / "docs" / "esquemas" / "contrato-1.0.schema.json").read_text(encoding="utf-8"))


def sol(**k):
    s = dict(VEC["sector_caso1"]["solicitud"])
    s.update(k)
    return s


class Contrato(unittest.TestCase):
    def test_respuesta_ok_con_eco(self):
        r = procesar(sol(), CS, CT)
        self.assertEqual((r["estado"], r["clave"], r["revision_entrada"], r["version_motor"]), ("ok", "SECTOR-1", 0, __version__))
        self.assertEqual(r["huella"], r["resultado"]["huella"])

    def test_errores_versionados(self):
        casos = [(sol(version_contrato="0.9"), "VERSION_CONTRATO_NO_SOPORTADA"), (sol(extra=1), "CONTRATO_INVALIDO"),
                 (sol(revision_entrada=-1), "CONTRATO_INVALIDO"), (sol(revision_entrada=True), "CONTRATO_INVALIDO"),
                 (sol(tipo="otro"), "CONTRATO_INVALIDO"), (sol(clave=""), "CONTRATO_INVALIDO"), ([], "CONTRATO_INVALIDO")]
        for s, cod in casos:
            r = procesar(s, CS, CT)
            with self.subTest(cod=cod):
                self.assertEqual((r["estado"], r["error"]["codigo"], r["error"]["version_error"]), ("error", cod, "1"))

    def test_error_de_dominio_trazado(self):
        t = json.loads(json.dumps(VEC["trazado_ejemplo"]["solicitud"]))
        t["entrada"]["piezas"][0]["longitud_mm"] = 9000
        r = procesar(t, CS, CT)
        self.assertEqual(r["error"]["codigo"], "ENTRADA_INVALIDA")
        self.assertEqual(r["clave"], "TRAZADO-1")


class Paridad(unittest.TestCase):
    def test_vectores_al_dia(self):
        """Si el motor cambia una salida, hay que regenerar los vectores a propósito (y revisar el port TS si existiera)."""
        p = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "generar_vectores.py"), "--verificar"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_respuestas_reproducibles(self):
        for n, v in VEC.items():
            with self.subTest(n=n):
                self.assertEqual(procesar(v["solicitud"], CS, CT), v["respuesta"])


class Esquemas(unittest.TestCase):
    def setUp(self):
        try:
            import jsonschema
        except ImportError:  # pragma: no cover
            self.skipTest("jsonschema no instalado")
        self.js = jsonschema

    def validar(self, obj, defn):
        self.js.Draft202012Validator({**ESQ, "$ref": f"#/$defs/{defn}"}).validate(obj)

    def test_vectores_cumplen_esquema(self):
        for n, v in VEC.items():
            with self.subTest(n=n):
                self.validar(v["respuesta"], "Respuesta")
                if n == "sector_error_cantidad":     # solicitud inválida a propósito: el esquema también la rechaza
                    with self.assertRaises(self.js.ValidationError):
                        self.validar(v["solicitud"], "Solicitud")
                else:
                    self.validar(v["solicitud"], "Solicitud")

    def test_esquema_rechaza_forma_invalida(self):
        s = json.loads(json.dumps(VEC["trazado_ejemplo"]["solicitud"]))
        s["entrada"]["circuitos"][0]["funcion"] = "PE"
        with self.assertRaises(self.js.ValidationError):
            self.validar(s, "Solicitud")


class Servicio(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = crear_servidor(0)
        cls.puerto = cls.srv.server_address[1]
        cls.hilo = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.hilo.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def req(self, metodo, ruta, cuerpo=None):
        c = http.client.HTTPConnection("127.0.0.1", self.puerto, timeout=10)
        datos = cuerpo if isinstance(cuerpo, (bytes, type(None))) else json.dumps(cuerpo).encode()
        c.request(metodo, ruta, body=datos, headers={"Content-Type": "application/json"})
        r = c.getresponse()
        return r.status, json.loads(r.read() or b"null")

    def test_salud(self):
        st, b = self.req("GET", "/v1/salud")
        self.assertEqual((st, b["version_motor"], b["version_contrato"]), (200, __version__, "1.0"))

    def test_calcular_trazado(self):
        st, b = self.req("POST", "/v1/calcular", VEC["trazado_ejemplo"]["solicitud"])
        self.assertEqual((st, b["estado"]), (200, "ok"))
        self.assertEqual(b, VEC["trazado_ejemplo"]["respuesta"])

    def test_json_invalido(self):
        st, b = self.req("POST", "/v1/calcular", b"{no es json")
        self.assertEqual((st, b["error"]["codigo"]), (400, "JSON_INVALIDO"))


if __name__ == "__main__":
    unittest.main()
