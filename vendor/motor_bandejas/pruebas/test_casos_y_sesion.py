"""Casos reales con el catálogo del proyecto, procedencia, huella e invalidación de resultados."""
import unittest

from _comun import CABLES, CATALOGO, CU6, DECISIONES, decisiones, entrada

from motor_bandejas.errores import ErrorEntrada
from motor_bandejas.motor import calcular_sector, resultado_vigente
from motor_bandejas.sesion import SesionSector


def calc(e, dec=DECISIONES):
    return calcular_sector(e, CABLES, CATALOGO, dec)


def por_sku(r):
    return {c["sku"]: c for c in r["candidatos"]}


class TestCasosCatalogoProyecto(unittest.TestCase):
    """Valores esperados derivados de fuentes: D y masa (Prysmian p.3), anchos y CTA (catálogo del proyecto)."""

    def test_caso_4_separados(self):
        r = calc(entrada(n=4, separado=True))
        self.assertAlmostEqual(r["masa_lineal"]["valor_kg_m"], 0.456, places=9)
        self.assertAlmostEqual(r["disposicion"]["ancho_ocupado_mm"], 56.7, places=9)
        c = por_sku(r)
        # TRPS-050 (50 mm) no alcanza; TRPS-100 es el mínimo geométrico de la perforada Z 0,71
        self.assertEqual(c["TRPS-050-22-Z"]["geometria"]["estado"], "NO_CUMPLE_ANCHO")
        self.assertTrue(c["TRPS-100-22-Z"]["minimo_geometrico_de_linea"])
        # Perforada: el catálogo no tiene CTA → mecánica no verificada (no se presume apta)
        self.assertEqual(c["TRPS-100-22-Z"]["mecanica"]["estado"], "NO_VERIFICABLE_SIN_REGISTRO")
        self.assertEqual(c["TRPS-100-22-Z"]["estado"], "PRESELECCION_CONDICIONADA")
        self.assertIn("MECANICA_NO_VERIFICABLE_SIN_REGISTRO", c["TRPS-100-22-Z"]["condiciones"])
        # Escalera G ala 65 a 1,5 m: CTA 310 kg/m documentada (CAR-0001, F-001)
        g65 = c["TRES-150-065-18-G"]
        self.assertEqual(g65["mecanica"]["estado"], "VERIFICADA_CUMPLE")
        self.assertEqual(g65["mecanica"]["cta_kg_m"], 310.0)
        # Escalera Z ala 65: 290 kg/m de la fila C (CAR-0046, REV-020/REV-043, validada por usuario) → condicionado
        z65 = c["TRES-150-065-18-Z"]
        self.assertEqual(z65["mecanica"]["estado"], "CUMPLE_CONDICIONADO")
        self.assertEqual(z65["mecanica"]["cta_kg_m"], 290.0)
        self.assertEqual(z65["mecanica"]["registro"]["registro_carga_id"], "CAR-0046")
        # Medidas nominales: nunca aptitud completa
        self.assertEqual(g65["estado"], "PRESELECCION_CONDICIONADA")
        self.assertEqual(g65["condiciones"], ["ANCHO_NOMINAL_NO_UTIL", "ALTURA_ALA_NOMINAL_NO_UTIL"])
        # Escalera Z ala 115: CTA publicada sin luz → no verificable para 1,5 m
        self.assertEqual(c["TRES-150-115-18-Z"]["mecanica"]["estado"], "NO_VERIFICABLE_LUZ_NO_DECLARADA")
        # Espesor 2,10 mm: sin registro de carga
        self.assertEqual(c["TRES-150-065-14-G"]["mecanica"]["estado"], "NO_VERIFICABLE_SIN_REGISTRO")

    def test_caso_8_separados_cambia_ancho(self):
        r = calc(entrada(n=8, separado=True))
        self.assertAlmostEqual(r["disposicion"]["ancho_ocupado_mm"], 121.5, places=9)
        c = por_sku(r)
        self.assertEqual(c["TRES-150-065-18-Z"]["geometria"]["estado"], "NO_CUMPLE_RESERVA")  # libre 19 % < 20 %
        self.assertTrue(c["TRES-300-065-18-Z"]["minimo_geometrico_de_linea"])
        self.assertTrue(c["TRPS-200-22-Z"]["minimo_geometrico_de_linea"])

    def test_caso_8_contacto(self):
        r = calc(entrada(n=8, separado=False))
        self.assertAlmostEqual(r["disposicion"]["ancho_ocupado_mm"], 64.8, places=9)
        self.assertIn("D-02", r["disposicion"]["decisiones"])
        self.assertTrue(por_sku(r)["TRES-150-065-18-Z"]["minimo_geometrico_de_linea"])

    def test_criterio_reserva_alternativo_registrado(self):
        r = calc(entrada(n=8, separado=True, criterio_reserva="sobre_ancho_ocupado"))
        self.assertEqual(r["decisiones"]["criterio_reserva_aplicado"], "sobre_ancho_ocupado")
        self.assertEqual(r["decisiones"]["origen_criterio_reserva"], "entrada.criterio_reserva")
        self.assertTrue(por_sku(r)["TRES-150-065-18-Z"]["minimo_geometrico_de_linea"])

    def test_carga_que_supera_cta(self):
        # 1×630 Cu: 6581 kg/km. 45 cables en contacto = 296,145 kg/m: > 290 (Z65) y < 310 (G65).
        # Ancho 45·40,6 = 1827 mm → no cabe; el estado mecánico se informa igual, independiente del geométrico.
        e = entrada(n=45, separado=False)
        e["usos_cable"][0]["cable_id"] = "PRY-SVALIO-CU-1x630"
        c = por_sku(calc(e))
        self.assertEqual(c["TRES-600-065-18-Z"]["mecanica"]["estado"], "NO_CUMPLE_CONDICIONADO")
        self.assertEqual(c["TRES-600-065-18-G"]["mecanica"]["estado"], "VERIFICADA_CUMPLE")
        self.assertEqual(c["TRES-600-065-18-Z"]["geometria"]["estado"], "NO_CUMPLE_ANCHO")

    def test_no_decodifica_sku(self):
        # El ancho usado proviene de la columna ancho_nominal_mm, con fila de origen registrada.
        for cand in calc(entrada())["candidatos"]:
            self.assertIsNotNone(cand["procedencia"]["fila"])
            self.assertEqual(cand["geometria"]["ancho_referencia_mm"], cand["ancho_nominal_mm"])
            self.assertEqual(cand["geometria"]["base_ancho"], "nominal")

    def test_resultado_trazable(self):
        r = calc(entrada())
        for k in ("huella", "entrada", "datos", "decisiones", "motor", "verificacion_electrica"):
            self.assertIn(k, r)
        self.assertEqual(r["verificacion_electrica"]["estado"], "NO_REALIZADA")
        # v0.2.1: Excel _2 con la separación REV-043 aprobada por el usuario (antes c627ff4520ca…)
        self.assertEqual(r["datos"]["catalogo"]["sha256_origen"],
                         "7be8b0f91666aa028a1b8f629d2cdd0ec68cf993ec2d504a0179358886a9894c")
        self.assertEqual(len(r["huella"]), 64)

    def test_anomalia_de_ficha_se_advierte(self):
        e = entrada(n=1)
        e["usos_cable"][0]["cable_id"] = "PRY-SVALIO-CU-1x300"
        self.assertTrue(any("anomalía" in a for a in calc(e)["advertencias"]))


class TestHuellaEInvalidacion(unittest.TestCase):
    def test_huella_cambia_con_cada_entrada(self):
        base = calc(entrada())["huella"]
        variantes = [entrada(n=5), entrada(separado=False), entrada(reserva=30), entrada(vano=2000),
                     entrada(familias=["SAM-STE-Z"]), entrada(criterio_reserva="sobre_ancho_ocupado")]
        for v in variantes:
            with self.subTest(v=v):
                self.assertNotEqual(calc(v)["huella"], base)
        self.assertEqual(calc(entrada())["huella"], base)  # determinista

    def test_huella_cambia_con_decisiones(self):
        a = calc(entrada())["huella"]
        b = calc(entrada(), decisiones(**{"D-05_criterio_reserva": "sobre_ancho_ocupado"}))["huella"]
        self.assertNotEqual(a, b)

    def test_resultado_vigente(self):
        e = entrada()
        r = calc(e)
        self.assertTrue(resultado_vigente(r, e, CABLES, CATALOGO, DECISIONES))
        self.assertFalse(resultado_vigente(r, entrada(n=5), CABLES, CATALOGO, DECISIONES))
        self.assertFalse(resultado_vigente(r, {"basura": 1}, CABLES, CATALOGO, DECISIONES))

    def test_sesion_invalida_resultado_y_seleccion(self):
        s = SesionSector(CABLES, CATALOGO, DECISIONES, entrada(n=4))
        s.calcular()
        sel = s.seleccionar("SAM_TRES-150-065-18-Z")
        self.assertIsNotNone(s.seleccion)
        self.assertIn("CTA_VALIDADA_POR_USUARIO", sel["condiciones"])   # v0.2.1: fila C (REV-043)
        s.modificar_uso(0, cantidad=8)                 # cambio de entrada (como en Samet)
        self.assertFalse(s.vigente())
        self.assertEqual(s.resultado["vigencia"], "DESACTUALIZADO")
        self.assertIsNone(s.seleccion)                 # no se conserva la selección vieja
        with self.assertRaises(ErrorEntrada):
            s.seleccionar("SAM_TRES-150-065-18-Z")     # no se puede seleccionar sobre resultado viejo
        s.calcular()
        self.assertTrue(s.vigente())

    def test_cambio_sin_efecto_no_invalida(self):
        s = SesionSector(CABLES, CATALOGO, DECISIONES, entrada(n=4))
        s.calcular()
        s.modificar_uso(0, cantidad=4)
        self.assertTrue(s.vigente())

    def test_no_se_selecciona_lo_no_apto(self):
        s = SesionSector(CABLES, CATALOGO, DECISIONES, entrada(n=8))
        s.calcular()
        with self.assertRaises(ErrorEntrada):
            s.seleccionar("SAM_TRES-150-065-18-Z")  # NO_CUMPLE_RESERVA


if __name__ == "__main__":
    unittest.main()
