"""Servicio HTTP mínimo (biblioteca estándar) para el CAD.

    python3 -m motor_bandejas.servicio [--puerto 8765] [--origen-permitido http://localhost:5173]

POST /v1/calcular  → cuerpo: solicitud (ver contrato.py). Responde 200 con respuesta ok/error de dominio.
                      Errores de transporte (JSON estructurado, version_error "1"): 400 cuerpo no UTF-8/JSON o
                      Content-Length inválido, 403 Host/Origin no permitidos, 411 sin Content-Length, 413 tamaño,
                      415 Content-Type, 500 error interno.
GET  /v1/salud     → versiones de motor, contrato, datos y decisiones.

Escucha solo en 127.0.0.1. CORS desactivado salvo que se indique un origen explícito (ver crear_servidor).
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__
from .contrato import VERSION_CONTRATO, a_json, error_de_transporte, procesar
from .motor import cargar_contexto, cargar_contexto_trazado

MAX_BYTES = 5 * 1024 * 1024


def _err(codigo: str, mensaje: str) -> str:
    return a_json(error_de_transporte(codigo, mensaje))


def crear_servidor(puerto: int = 8765, origen_permitido: str | None = None) -> ThreadingHTTPServer:
    """Servicio privado del puesto de trabajo (v0.2.2, auditoría H6/H9).

    Controles: escucha solo en 127.0.0.1; `Host` debe ser 127.0.0.1:<puerto> o localhost:<puerto> (defensa contra
    DNS rebinding); si llega `Origin`, debe ser exactamente `origen_permitido` (sin comodines; sin origen configurado
    se rechaza todo `Origin`); POST solo con `Content-Type: application/json` (evita peticiones "simples" sin
    preflight); `Content-Length` obligatorio, entero y ≤ MAX_BYTES; cuerpo UTF-8 estricto. Toda respuesta es JSON
    estructurado, incluso ante un error interno (500, sin detalles internos).
    No hay autenticación: cualquier proceso local sin `Origin` puede llamar al servicio. Si la arquitectura elegida
    lo requiere, agregar un token (pendiente, lo decide el auditor de arquitectura).
    """
    ctx_sector = cargar_contexto()
    ctx_trazado = cargar_contexto_trazado()

    class Manejador(BaseHTTPRequestHandler):
        def _origen(self):
            return self.headers.get("Origin")

        def _responder(self, codigo, cuerpo: str, cors_extra=False):
            datos = cuerpo.encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(datos)))
            self.send_header("Vary", "Origin")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            if origen_permitido and self._origen() == origen_permitido:
                self.send_header("Access-Control-Allow-Origin", origen_permitido)
                if cors_extra:
                    self.send_header("Access-Control-Allow-Methods", "POST, GET")
                    self.send_header("Access-Control-Allow-Headers", "Content-Type")
                    self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()
            if datos:
                self.wfile.write(datos)

        def _control_de_acceso(self) -> bool:
            """True si la petición puede seguir; si no, ya respondió 403."""
            puerto_real = self.server.server_address[1]
            host = (self.headers.get("Host") or "").strip().lower()
            if host not in {f"127.0.0.1:{puerto_real}", f"localhost:{puerto_real}"}:
                self._responder(403, _err("HOST_NO_PERMITIDO", "Host no permitido para el servicio local."))
                return False
            o = self._origen()
            if o is not None and o != origen_permitido:
                self._responder(403, _err("ORIGEN_NO_PERMITIDO", "Origen no permitido."))
                return False
            return True

        def _manejar(self, fn):
            try:
                if self._control_de_acceso():
                    fn()
            except Exception:  # noqa: BLE001 – red de seguridad: nunca cerrar sin respuesta JSON
                try:
                    self._responder(500, _err("ERROR_INTERNO", "Error interno del motor."))
                except Exception:  # noqa: BLE001
                    pass

        def do_OPTIONS(self):  # noqa: N802
            def fn():
                if self._origen() is None:
                    return self._responder(400, _err("PREFLIGHT_SIN_ORIGEN", "OPTIONS sin Origin."))
                self._responder(204, "", cors_extra=True)
            self._manejar(fn)

        def do_GET(self):  # noqa: N802
            def fn():
                if self.path != "/v1/salud":
                    return self._responder(404, _err("RUTA_INEXISTENTE", "Ruta inexistente."))
                self._responder(200, a_json({
                    "estado": "ok", "version_motor": __version__, "version_contrato": VERSION_CONTRATO,
                    "datos_sector": {"cables": ctx_sector[0].version(), "catalogo": ctx_sector[1].version()},
                    "datos_trazado": {"cables": ctx_trazado[0].version(), "catalogo": ctx_trazado[1].version()},
                    "decisiones": ctx_trazado[2].get("version_decisiones")}))
            self._manejar(fn)

        def do_POST(self):  # noqa: N802
            def fn():
                if self.path != "/v1/calcular":
                    return self._responder(404, _err("RUTA_INEXISTENTE", "Ruta inexistente."))
                ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if ct != "application/json":
                    return self._responder(415, _err("CONTENT_TYPE_NO_SOPORTADO", "Se requiere application/json."))
                cl = self.headers.get("Content-Length")
                if cl is None:
                    return self._responder(411, _err("CONTENT_LENGTH_REQUERIDO", "Falta Content-Length."))
                if not cl.strip().isdigit():
                    self.close_connection = True
                    return self._responder(400, _err("CONTENT_LENGTH_INVALIDO", "Content-Length debe ser un entero ≥ 0."))
                n = int(cl)
                if n > MAX_BYTES:
                    self.close_connection = True
                    return self._responder(413, _err("SOLICITUD_DEMASIADO_GRANDE", f"Máximo {MAX_BYTES} bytes."))
                crudo = self.rfile.read(n)
                try:
                    texto = crudo.decode("utf-8")
                except UnicodeDecodeError:
                    return self._responder(400, _err("CODIFICACION_INVALIDA", "El cuerpo no es UTF-8 válido."))
                try:
                    sol = json.loads(texto or "null")
                except json.JSONDecodeError:
                    return self._responder(400, _err("JSON_INVALIDO", "El cuerpo no es JSON."))
                self._responder(200, a_json(procesar(sol, ctx_sector, ctx_trazado)))
            self._manejar(fn)

        def log_message(self, *a):
            pass

    return ThreadingHTTPServer(("127.0.0.1", puerto), Manejador)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--puerto", type=int, default=8765)
    ap.add_argument("--origen-permitido", default=None)
    a = ap.parse_args()
    srv = crear_servidor(a.puerto, a.origen_permitido)
    print(f"motor_bandejas {__version__} – contrato {VERSION_CONTRATO} – http://127.0.0.1:{a.puerto}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
