"""Reglas elementales con valores documentados (ficha Prysmian) y con un catálogo sintético controlado."""
import unittest

from _comun import CABLES, CU6, decisiones, entrada, snapshot_sintetico

from motor_bandejas.calculos import disposicion_una_capa, evaluar_mecanica, evaluar_reserva, masa_lineal
from motor_bandejas.catalogo import Catalogo
from motor_bandejas.errores import NoSoportado, PendienteDecision
from motor_bandejas.motor import calcular_sector


def uso(cable_id=CU6, n=4, disp="separado", apilado=False):
    return {"cable": CABLES.obtener(cable_id), "cantidad": n, "disposicion": disp, "apilado": apilado,
            "decision_disposicion": "D-01" if disp == "separado" else "D-02"}


class TestMasaLineal(unittest.TestCase):
    """Ficha Sintenax Valio ed. 2020 p.3: Cu 1×6 → 114 kg/km."""

    def test_valores_documentados(self):
        self.assertAlmostEqual(masa_lineal([uso(n=4)])["valor_kg_m"], 0.456, places=9)
        self.assertAlmostEqual(masa_lineal([uso(n=8)])["valor_kg_m"], 0.912, places=9)

    def test_mezcla_y_procedencia(self):
        # 3×(1×6: 114) + 2×(1×10: 160) = 342 + 320 = 662 kg/km = 0,662 kg/m
        r = masa_lineal([uso(n=3), uso("PRY-SVALIO-CU-1x10", n=2)])
        self.assertAlmostEqual(r["valor_kg_m"], 0.662, places=9)
        self.assertEqual(r["detalle"][0]["procedencia"]["pagina"], "3")
        self.assertIn("Edición 2020", r["detalle"][0]["procedencia"]["edicion"])


class TestDisposicion(unittest.TestCase):
    """D = 8,1 mm (ficha p.3). g = D; ancho = (2n−1)·D (D-01)."""

    def test_separado_cables_iguales(self):
        self.assertAlmostEqual(disposicion_una_capa([uso(n=4)])["ancho_ocupado_mm"], 56.7, places=9)
        d8 = disposicion_una_capa([uso(n=8)])
        self.assertAlmostEqual(d8["ancho_ocupado_mm"], 121.5, places=9)
        self.assertAlmostEqual(d8["hueco_libre_entre_superficies_mm"], 8.1, places=9)
        self.assertAlmostEqual(d8["paso_entre_centros_mm"], 16.2, places=9)

    def test_un_solo_cable_separado_ocupa_D(self):
        self.assertAlmostEqual(disposicion_una_capa([uso(n=1)])["ancho_ocupado_mm"], 8.1, places=9)

    def test_contacto(self):
        self.assertAlmostEqual(disposicion_una_capa([uso(n=8, disp="contacto")])["ancho_ocupado_mm"], 64.8, places=9)
        # mezcla de diámetros en contacto: 2·8,1 + 3·9,1 = 43,5
        r = disposicion_una_capa([uso(n=2, disp="contacto"), uso("PRY-SVALIO-CU-1x10", n=3, disp="contacto")])
        self.assertAlmostEqual(r["ancho_ocupado_mm"], 43.5, places=9)

    def test_dos_usos_del_mismo_cable_separados_se_suman(self):
        r = disposicion_una_capa([uso(n=3), uso(n=5)])
        self.assertAlmostEqual(r["ancho_ocupado_mm"], 15 * 8.1, places=9)

    def test_separado_diametros_distintos_pendiente(self):
        with self.assertRaises(PendienteDecision) as cm:
            disposicion_una_capa([uso(n=2), uso("PRY-SVALIO-CU-1x10", n=2)])
        self.assertEqual(cm.exception.decision_id, "D-03")

    def test_mezcla_separado_contacto_pendiente(self):
        with self.assertRaises(PendienteDecision) as cm:
            disposicion_una_capa([uso(n=2), uso(n=2, disp="contacto")])
        self.assertEqual(cm.exception.decision_id, "D-07")

    def test_apilado_no_soportado(self):
        with self.assertRaises(NoSoportado):
            disposicion_una_capa([uso(n=2, apilado=True)])


class TestReserva(unittest.TestCase):
    def test_denominadores(self):
        r = evaluar_reserva(64.8, 100.0, 0.20, "fraccion_libre_ancho_bandeja")
        self.assertAlmostEqual(r["reserva_libre_pct"], 35.2, places=6)          # (100−64,8)/100
        self.assertAlmostEqual(r["sobrante_sobre_ocupado_pct"], 54.321, places=3)  # (100−64,8)/64,8
        self.assertTrue(r["cumple"])

    def test_borde_exacto_se_acepta(self):
        self.assertTrue(evaluar_reserva(80.0, 100.0, 0.20, "fraccion_libre_ancho_bandeja")["cumple"])
        self.assertFalse(evaluar_reserva(80.001, 100.0, 0.20, "fraccion_libre_ancho_bandeja")["cumple"])
        self.assertTrue(evaluar_reserva(125.0, 150.0, 0.20, "sobre_ancho_ocupado")["cumple"])
        self.assertFalse(evaluar_reserva(125.001, 150.0, 0.20, "sobre_ancho_ocupado")["cumple"])

    def test_los_criterios_difieren(self):
        # 8 separados (121,5 mm) en 150 mm con 20 %: libre 19 % (no cumple D-05) ; sobrante 23,5 % (cumple alternativo)
        a = evaluar_reserva(121.5, 150.0, 0.20, "fraccion_libre_ancho_bandeja")
        b = evaluar_reserva(121.5, 150.0, 0.20, "sobre_ancho_ocupado")
        self.assertFalse(a["cumple"])
        self.assertTrue(b["cumple"])

    def test_no_cabe(self):
        r = evaluar_reserva(56.7, 50.0, 0.0, "fraccion_libre_ancho_bandeja")
        self.assertFalse(r["cabe"])
        self.assertFalse(r["cumple"])


class TestMecanica(unittest.TestCase):
    def cat(self, cargas):
        return Catalogo.desde_dict(snapshot_sintetico(
            [{"producto_id": "EJ-1", "sku": "EJ-1", "ancho_nominal_mm": 150, "ala_nominal_mm": 65}], cargas))

    ACEPT = ["documentada", "validada_por_usuario", "adoptada_por_decision"]

    def test_luz_exacta(self):
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 100}])
        r = evaluar_mecanica("EJ-1", 0.456, 1500, c, self.ACEPT)
        self.assertEqual(r["estado"], "VERIFICADA_CUMPLE")
        self.assertAlmostEqual(r["utilizacion_pct"], 0.456, places=6)
        self.assertAlmostEqual(r["cociente_cta_carga"], 219.30, places=2)

    def test_no_interpola_ni_extrapola(self):
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 100}])
        self.assertEqual(evaluar_mecanica("EJ-1", 0.4, 2000, c, self.ACEPT)["estado"], "NO_VERIFICABLE_SIN_REGISTRO")
        self.assertEqual(evaluar_mecanica("EJ-1", 0.4, 1000, c, self.ACEPT)["estado"], "NO_VERIFICABLE_SIN_REGISTRO")

    def test_carga_excede(self):
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 0.5}])
        self.assertEqual(evaluar_mecanica("EJ-1", 0.9, 1500, c, self.ACEPT)["estado"], "VERIFICADA_NO_CUMPLE")
        self.assertEqual(evaluar_mecanica("EJ-1", 0.5, 1500, c, self.ACEPT)["estado"], "VERIFICADA_CUMPLE")

    def test_registro_sin_valor_luz_no_declarada_y_condiciones(self):
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": None,
                       "estado_evidencia": "no determinada"}])
        self.assertEqual(evaluar_mecanica("EJ-1", 0.4, 1500, c, self.ACEPT)["estado"], "NO_VERIFICABLE_REGISTRO_SIN_VALOR")
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": None, "carga_valor": 530}])
        self.assertEqual(evaluar_mecanica("EJ-1", 0.4, 1500, c, self.ACEPT)["estado"], "NO_VERIFICABLE_LUZ_NO_DECLARADA")
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 100, "carga_unidad": "kg"}])
        self.assertEqual(evaluar_mecanica("EJ-1", 0.4, 1500, c, self.ACEPT)["estado"], "NO_VERIFICABLE_CONDICIONES")
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 100,
                       "estado_evidencia": "propuesta"}])
        self.assertEqual(evaluar_mecanica("EJ-1", 0.4, 1500, c, self.ACEPT)["estado"], "NO_VERIFICABLE_CONDICIONES")

    def test_validada_por_usuario_es_condicionada(self):
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 100,
                       "estado_evidencia": "validada por usuario"}])
        r = evaluar_mecanica("EJ-1", 0.4, 1500, c, self.ACEPT)
        self.assertEqual(r["estado"], "CUMPLE_CONDICIONADO")
        self.assertEqual(r["base_evidencia"], "validada_por_usuario")
        self.assertFalse(r["esquema_ensayo_contrastado"])

    def test_registros_multiples_usa_el_menor(self):
        c = self.cat([{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 300},
                      {"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, "carga_valor": 290}])
        r = evaluar_mecanica("EJ-1", 0.4, 1500, c, self.ACEPT)
        self.assertEqual(r["cta_kg_m"], 290)
        self.assertIn("advertencia", r)


class TestGeometriaPorProducto(unittest.TestCase):
    def test_altura_y_ancho_util(self):
        snap = snapshot_sintetico([
            {"producto_id": "EJ-BAJA", "sku": "EJ-BAJA", "ancho_nominal_mm": 300, "ala_nominal_mm": 8},
            {"producto_id": "EJ-UTIL", "sku": "EJ-UTIL", "ancho_nominal_mm": 100, "ancho_util_mm": 70, "ala_nominal_mm": 50},
            {"producto_id": "EJ-SINALA", "sku": "EJ-SINALA", "ancho_nominal_mm": 300, "ala_nominal_mm": None},
        ], [])
        cat = Catalogo.desde_dict(snap)
        r = calcular_sector(entrada(n=4), CABLES, cat, decisiones())
        est = {c["producto_id"]: c for c in r["candidatos"]}
        self.assertEqual(est["EJ-BAJA"]["geometria"]["estado"], "NO_CUMPLE_ALTURA")      # D 8,1 > ala 8
        self.assertEqual(est["EJ-UTIL"]["geometria"]["base_ancho"], "util")               # usa útil si existe
        self.assertEqual(est["EJ-UTIL"]["geometria"]["estado"], "NO_CUMPLE_RESERVA")      # 56,7 > 0,8·70 = 56
        self.assertEqual(est["EJ-SINALA"]["geometria"]["estado"], "NO_VERIFICABLE_SIN_ALTURA")
        self.assertEqual(est["EJ-SINALA"]["estado"], "NO_VERIFICABLE_GEOMETRIA")

    def test_politica_solo_util_no_usa_nominal(self):
        snap = snapshot_sintetico([{"producto_id": "EJ-N", "sku": "EJ-N", "ancho_nominal_mm": 300, "ala_nominal_mm": 50}], [])
        r = calcular_sector(entrada(n=4), CABLES, Catalogo.desde_dict(snap), decisiones(**{"D-04_ancho_referencia": "solo_util"}))
        self.assertEqual(r["candidatos"][0]["geometria"]["estado"], "NO_VERIFICABLE_SIN_ANCHO")


if __name__ == "__main__":
    unittest.main()
