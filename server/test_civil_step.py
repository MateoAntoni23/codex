"""Parte civil: conversión STEP → malla y su ruta HTTP (2026-11-15)."""
import base64
import json
import struct
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from civil_step import ErrorConversion, convertir_step, leer_unidades
from tray_service import create_server

FIX = Path(__file__).resolve().parents[1] / 'e2e' / 'fixtures' / 'civil'


def caja(r):
    return [round(b - a) for a, b in zip(r['caja_mm']['min'], r['caja_mm']['max'])]


class Conversion(unittest.TestCase):
    def test_columnas_pb_una_sola_malla_con_todos_los_solidos(self):
        r = convertir_step((FIX / 'PB-columnas.stp').read_bytes())
        self.assertEqual(r['solidos'], 15)
        self.assertEqual(caja(r), [24300, 12300, 6000])
        self.assertEqual(r['unidades']['codigo'], 'mm')
        pos = struct.unpack(f"<{r['vertices'] * 3}f", base64.b64decode(r['posiciones']))
        idx = struct.unpack(f"<{r['triangulos'] * 3}I", base64.b64decode(r['indices']))
        self.assertEqual(len(idx), r['triangulos'] * 3)
        self.assertLess(max(idx), r['vertices'])
        # 15 prismas de 12 triángulos: triangulación gruesa.
        self.assertEqual(r['triangulos'], 15 * 12)
        self.assertAlmostEqual(max(pos[2::3]), 6000, places=3)

    def test_exportado_con_y_vertical_queda_en_los_ejes_del_archivo(self):
        r = convertir_step((FIX / 'PB-columnas-yup.stp').read_bytes())
        # La altura (6000) en Y: no se gira nada; el eje vertical lo elige el operador en la app.
        self.assertEqual(caja(r), [24300, 6000, 12300])

    def test_no_es_step(self):
        with self.assertRaises(ErrorConversion) as c:
            convertir_step((FIX / 'no-es-step.stp').read_bytes())
        self.assertEqual(c.exception.codigo, 'NO_ES_STEP')
        with self.assertRaises(ErrorConversion) as c:
            convertir_step(b'')
        self.assertEqual(c.exception.codigo, 'STEP_VACIO')

    def test_unidades_del_encabezado(self):
        self.assertEqual(leer_unidades("#1=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );")['codigo'], 'mm')
        self.assertEqual(leer_unidades("#1=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );")['codigo'], 'm')
        pulg = leer_unidades("#5=( CONVERSION_BASED_UNIT('INCH',#6) LENGTH_UNIT() NAMED_UNIT(#7) );")
        self.assertEqual(pulg['codigo'], 'in')
        self.assertIn('pulgada', pulg['texto'])
        self.assertEqual(leer_unidades('sin unidades')['codigo'], 'desconocida')


class RutaHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def post(self, path, data, ct='application/octet-stream', headers=None):
        req = urllib.request.Request(self.url + path, data=data, headers={'Content-Type': ct, **(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_convierte(self):
        st, body = self.post('/v1/civil/convertir', (FIX / 'P1-losa.stp').read_bytes())
        self.assertEqual(st, 200)
        self.assertEqual(body['estado'], 'ok')
        self.assertEqual(caja(body['malla']), [24000, 12000, 200])

    def test_error_con_motivo(self):
        st, body = self.post('/v1/civil/convertir', b'hola')
        self.assertEqual(st, 422)
        self.assertEqual(body['error']['codigo'], 'NO_ES_STEP')

    def test_sin_octet_stream(self):
        st, body = self.post('/v1/civil/convertir', b'{}', ct='application/json')
        self.assertEqual(st, 415)

    def test_mismo_control_de_acceso_que_el_motor(self):
        st, body = self.post('/v1/civil/convertir', (FIX / 'P1-losa.stp').read_bytes(), headers={'Origin': 'https://ajeno.example'})
        self.assertEqual(st, 403)
        self.assertEqual(body['error']['codigo'], 'ORIGEN_NO_PERMITIDO')

    def test_el_motor_sigue_atendiendo_lo_suyo(self):
        st, body = self.post('/v1/calcular', b'null', ct='application/json')
        self.assertEqual(st, 200)
        self.assertNotEqual(body.get('estado'), None)


if __name__ == '__main__':
    unittest.main()
