"""Validación estricta de entradas y de datos físicos (nunca se sustituye un faltante por cero)."""
import json
import tempfile
import unittest

from _comun import CABLES, CATALOGO, CU6, DECISIONES, entrada

from motor_bandejas.datos_cables import RegistroCables
from motor_bandejas.errores import DatoFaltante, ErrorEntrada
from motor_bandejas.motor import RUTA_CABLES, calcular_sector
from motor_bandejas.unidades import kg_km_a_kg_m


def calc(e):
    return calcular_sector(e, CABLES, CATALOGO, DECISIONES)


class TestCantidades(unittest.TestCase):
    def test_rechaza_no_enteros_y_no_positivos(self):
        for malo in (0, -1, 1.5, 4.0, "4", True, None):
            e = entrada()
            e["usos_cable"][0]["cantidad"] = malo
            with self.subTest(cantidad=malo), self.assertRaises(ErrorEntrada):
                calc(e)

    def test_acepta_entero_positivo(self):
        self.assertEqual(calc(entrada(n=1))["estado_calculo"], "CALCULADO")


class TestEntradaGeneral(unittest.TestCase):
    def test_claves_obligatorias(self):
        for k in ("tipo_circuito", "vano_mm", "reserva_solicitada_pct", "usos_cable"):
            e = entrada()
            del e[k]
            with self.subTest(falta=k), self.assertRaises(ErrorEntrada):
                calc(e)

    def test_separado_es_obligatorio_y_booleano(self):
        e = entrada()
        del e["usos_cable"][0]["separado"]
        with self.assertRaises(ErrorEntrada):
            calc(e)
        e = entrada()
        e["usos_cable"][0]["separado"] = "si"
        with self.assertRaises(ErrorEntrada):
            calc(e)

    def test_clave_desconocida_no_se_ignora(self):
        with self.assertRaises(ErrorEntrada):
            calc(entrada(vano_m=1.5))
        e = entrada()
        e["usos_cable"][0]["separados"] = True  # errata típica
        with self.assertRaises(ErrorEntrada):
            calc(e)

    def test_vano_y_reserva(self):
        for v in (0, -1500, None, "1500", float("nan"), float("inf"), True):
            with self.subTest(vano=v), self.assertRaises((ErrorEntrada, DatoFaltante)):
                calc(entrada(vano=v))
        for r in (-1, 100, 150, "20", None):
            with self.subTest(reserva=r), self.assertRaises((ErrorEntrada, DatoFaltante)):
                calc(entrada(reserva=r))
        self.assertEqual(calc(entrada(reserva=0))["estado_calculo"], "CALCULADO")

    def test_cable_y_familia_desconocidos(self):
        e = entrada()
        e["usos_cable"][0]["cable_id"] = "PRY-SVALIO-CU-1x7"
        with self.assertRaises(ErrorEntrada):
            calc(e)
        with self.assertRaises(ErrorEntrada):
            calc(entrada(familias=["NO-EXISTE"]))

    def test_criterio_reserva_invalido(self):
        with self.assertRaises(ErrorEntrada):
            calc(entrada(criterio_reserva="samet"))


class TestDatosFisicosFaltantes(unittest.TestCase):
    def test_conversion_no_inventa_cero(self):
        self.assertAlmostEqual(kg_km_a_kg_m(114), 0.114, places=12)
        for malo in (None, 0, -5, "114"):
            with self.subTest(masa=malo), self.assertRaises((DatoFaltante, ErrorEntrada)):
                kg_km_a_kg_m(malo)

    def _dataset_con(self, d, m):
        with open(RUTA_CABLES, encoding="utf-8") as f:
            ds = json.load(f)
        ds["tablas"] = [ds["tablas"][0]]
        ds["tablas"][0]["filas"] = [["6", d, m]]
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(ds, f)
        f.close()
        return f.name

    def test_dataset_con_masa_o_diametro_faltante_se_rechaza(self):
        for d, m in ((8.1, None), (None, 114), (0, 114), (8.1, 0)):
            with self.subTest(d=d, m=m), self.assertRaises(DatoFaltante):
                RegistroCables.desde_archivos(self._dataset_con(d, m))


class TestCircuitoMando(unittest.TestCase):
    def test_mando_senal_queda_bloqueado_sin_reglas(self):
        r = calc(entrada(tipo_circuito="mando_senal"))
        self.assertEqual(r["estado_calculo"], "BLOQUEADO")
        self.assertEqual(r["bloqueo"]["decision_id"], "D-11")
        self.assertEqual(r["candidatos"], [])


if __name__ == "__main__":
    unittest.main()
