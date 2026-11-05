"""Read-only CAD endpoints; engine service and its access controls remain intact."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1] / 'vendor' / 'motor_bandejas'
sys.path.insert(0, str(ROOT))
from motor_bandejas.servicio import crear_servidor
from motor_bandejas.contrato import a_json
from motor_bandejas.motor import cargar_contexto_trazado


def create_server(port=8765, origin='http://localhost:5173'):
    server = crear_servidor(port, origin)
    Base = server.RequestHandlerClass
    context = cargar_contexto_trazado()
    decisions_hash = hashlib.sha256((ROOT / "datos/decisiones_producto.json").read_bytes()).hexdigest()
    catalog = json.loads((ROOT / "datos/catalogo/catalogo_bandejas_snapshot.json").read_text(encoding='utf-8'))
    datasets = [json.loads(p.read_text(encoding='utf-8')) for p in sorted((ROOT / "datos/cables").glob("*.json"))]

    class Handler(Base):
        def do_GET(self):
            def handle():
                if self.path == '/v1/catalogos':
                    self._responder(200, a_json({'version_api': 'cad/1', 'catalogo': catalog, 'datasets_cables': datasets, 'cable_ids': sorted(context[0].cables), 'decisiones_sha256': decisions_hash}))
                elif self.path == '/v1/ejemplos':
                    names = ['caso1_4_separados', 'caso2_8_separados', 'caso3_8_contacto', 'trazado_derivacion_pe']
                    self._responder(200, a_json({'version_api': 'cad/1', 'ejemplos': {
                        n: json.loads((ROOT / 'ejemplos' / (n + '.json')).read_text(encoding='utf-8')) for n in names}}))
                else:
                    self._responder(404, a_json({'estado': 'error', 'error': {'codigo': 'RUTA_INEXISTENTE', 'mensaje': 'Ruta inexistente', 'version_error': '1'}}))
            if self.path in ['/v1/salud']:
                return super().do_GET()
            self._manejar(handle)
    server.RequestHandlerClass = Handler
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--origin', default='http://localhost:5173')
    args = parser.parse_args()
    srv = create_server(args.port, args.origin)
    print(f'Motor privado en 127.0.0.1:{args.port}; origen permitido: {args.origin}', flush=True)
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
