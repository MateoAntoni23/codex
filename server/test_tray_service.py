import json
import threading
import unittest
import urllib.request
import urllib.error
from tray_service import create_server

class AdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=create_server(0)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_address[1]}'
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def get(self,path):
        with urllib.request.urlopen(self.url+path) as r:return json.load(r)
    def test_catalogues(self):
        data=self.get('/v1/catalogos');self.assertIn('PRY-SVALIO-CU-1x35',data['cable_ids']);self.assertGreater(len(data['catalogo']['PRODUCTOS']),100)
    def test_examples_through_http(self):
        examples=self.get('/v1/ejemplos')['ejemplos']
        for key,entry in examples.items():
            req={'version_contrato':'1.0','tipo':'trazado' if key.startswith('trazado') else 'sector','clave':key,'solicitud_id':key,'revision_entrada':0,'entrada':entry}
            r=urllib.request.Request(self.url+'/v1/calcular',data=json.dumps(req).encode(),headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(r) as response: result=json.load(response)
            self.assertEqual(result['estado'],'ok',key)
            self.assertEqual(result['resultado']['verificacion_electrica']['estado'],'NO_REALIZADA')
    def test_access_control_on_new_endpoints(self):
        req=urllib.request.Request(self.url+'/v1/catalogos',headers={'Origin':'https://invalid.example'})
        with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
        self.assertEqual(error.exception.code,403)
    def test_catalog_descriptions_have_accented_chars(self):
        # Verifica que los JSON se leen con encoding='utf-8': las descripciones
        # del catálogo contienen tildes (ó, é, á, í, ú, ñ) que cp1252 no puede
        # decodificar correctamente desde los archivos fuente.
        data=self.get('/v1/catalogos')
        text=json.dumps(data,ensure_ascii=False)
        accented=set('áéíóúÁÉÍÓÚüÜñÑ')
        self.assertTrue(any(c in accented for c in text),'El catálogo no contiene caracteres con tilde; posible error de encoding')
