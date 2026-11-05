"""Pruebas de CONSISTENCIA de un modelo explicativo del comportamiento de Samet (no del motor).

Verifican que los modelos H-S1..H-S4 de docs/SAMET_ANALISIS.md reproducen las 24 tarjetas observadas, que
provienen de solo TRES conjuntos de entradas. Que pasen no prueba la implementación del servidor de Samet ni
una regla normativa: otras fórmulas podrían reproducir las mismas salidas. Las constantes (CTA, anchos) son
inferidas o supuestas (anchos nominales). Si una captura nueva contradice un modelo, falla esta prueba y se
revisa la hipótesis; el motor no se toca para "coincidir".
"""
import json
import unittest

from _comun import RAIZ

FIX = json.loads((RAIZ / "pruebas" / "fixtures" / "samet_casos.json").read_text(encoding="utf-8"))
# CTA que Samet aparenta usar (inferidas por H-S1). Clave = segmento de familia del SKU observado.
CTA_SAMET = {"TRPS-100": 50, "TRPS-200": 60, "065-18-Z": 290, "065-18-G": 300, "090-18-Z": 400,
             "090-18-G": 440, "115-18-Z": 530, "115-18-G": 580, "TRA": 0}
ANCHO_SAMET = {"TRPS-100": 100, "TRPS-200": 200, "TRES-150": 150, "TRES-300": 300, "TRA-100": 100, "TRA-200": 200}
D_PRYSMIAN = 8.1


def cta_de(sku):
    for k, v in CTA_SAMET.items():
        if k in sku:
            return v
    raise KeyError(sku)


def ancho_de(sku):
    for k, v in ANCHO_SAMET.items():
        if sku.startswith(k):
            return v
    raise KeyError(sku)


class TestHipotesisSamet(unittest.TestCase):
    def test_HS1_factor_es_cta_sobre_carga_sin_reserva(self):
        n = 0
        for caso in FIX["casos"]:
            q = caso["carga_requerida_samet_kg_m"]
            for h in caso["tray_hits"]:
                esperado = round(cta_de(h["sku"]) / q, 1)
                self.assertAlmostEqual(h["factor_samet"], esperado, delta=0.051, msg=h["sku"])
                n += 1
        self.assertEqual(n, 24)

    def test_HS2_masa_por_cable_samet_0110(self):
        for caso in FIX["casos"]:
            self.assertAlmostEqual(caso["carga_requerida_samet_kg_m"] / caso["uso"]["cantidad"], 0.110, places=6)

    def test_HS3_reserva_real_denominador_ancho_ocupado(self):
        for caso in FIX["casos"]:
            n = caso["uso"]["cantidad"]
            w_ocup = (2 * n if caso["uso"]["separado"] else n) * D_PRYSMIAN
            for h in caso["tray_hits"]:
                reserva = round(100 * (ancho_de(h["sku"]) / w_ocup - 1))
                self.assertEqual(reserva, h["reserva_real_samet_pct"], msg=f"{caso['caso_id']} {h['sku']}")

    def test_HS3_descarta_regla_2n_menos_1(self):
        # Con (2n−1)·D la reserva de 4 separados en 100 mm sería 76 %, no 54 %: Samet no usa la regla D-01.
        self.assertNotEqual(round(100 * (100 / (7 * D_PRYSMIAN) - 1)), 54)

    def test_HS4_ancho_minimo_con_reserva_sobre_ocupado(self):
        # Anchos publicados del catálogo (perforada Z 0,71: 50/100/150/200/300; escalera 1,24: 150/300/450/600)
        perforada, escalera = [50, 100, 150, 200, 300], [150, 300, 450, 600]
        for caso in FIX["casos"]:
            n = caso["uso"]["cantidad"]
            w_req = 1.20 * (2 * n if caso["uso"]["separado"] else n) * D_PRYSMIAN
            perf_min = min(w for w in perforada if w >= w_req)
            esc_min = min(w for w in escalera if w >= w_req)
            skus = [h["sku"] for h in caso["tray_hits"]]
            self.assertIn(f"TRPS-{perf_min:03d}-22-Z", skus)
            self.assertTrue(all(ancho_de(s) == esc_min for s in skus if s.startswith("TRES")))


if __name__ == "__main__":
    unittest.main()
