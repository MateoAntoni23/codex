"""Integridad de los datos de entrada del motor."""
import math
import unittest

from _comun import CABLES, CATALOGO


class TestDatasetCables(unittest.TestCase):
    def test_conteo_y_valores_ancla(self):
        # 17+8+16+16+9 cobre ; 12+6+13+13 aluminio
        self.assertEqual(len(CABLES.cables), 110)
        c = CABLES.obtener("PRY-SVALIO-CU-1x6")
        self.assertEqual((c.diametro_exterior_mm, c.masa_kg_km), (8.1, 114))
        self.assertAlmostEqual(c.masa_kg_m, 0.114, places=12)
        self.assertEqual(CABLES.obtener("PRY-SVALIO-CU-4x25/16").diametro_exterior_mm, 27)
        self.assertEqual(CABLES.obtener("PRY-SVALIO-CU-4x25-NI").diametro_exterior_mm, 28)
        self.assertEqual(CABLES.obtener("PRY-SVALIO-CU-2x1.5").masa_kg_km, 132)

    def test_todos_los_valores_positivos_y_finitos(self):
        for c in CABLES.cables.values():
            self.assertTrue(math.isfinite(c.diametro_exterior_mm) and c.diametro_exterior_mm > 0, c.cable_id)
            self.assertTrue(math.isfinite(c.masa_kg_km) and c.masa_kg_km > 0, c.cable_id)
            self.assertTrue(c.fuente["pagina"])

    def test_anomalias_no_monotonas_estan_declaradas(self):
        """Toda caída de D o masa al aumentar la sección debe figurar como anomalía de la fuente."""
        grupos = {}
        for c in CABLES.cables.values():
            grupos.setdefault((c.material, c.tipo), []).append(c)
        for (mat, tipo), cs in grupos.items():
            for a, b in zip(cs, cs[1:]):  # en orden de la tabla
                if b.diametro_exterior_mm < a.diametro_exterior_mm or b.masa_kg_km < a.masa_kg_km:
                    self.assertTrue(b.anomalia_fuente or a.anomalia_fuente, f"{a.cable_id} → {b.cable_id}")


class TestSnapshotCatalogo(unittest.TestCase):
    def test_origen_y_contenido(self):
        self.assertEqual(CATALOGO.origen["sha256"], "7be8b0f91666aa028a1b8f629d2cdd0ec68cf993ec2d504a0179358886a9894c")   # v0.2.1 (REV-043)
        self.assertEqual(len(CATALOGO.productos), 70)
        self.assertEqual(len(CATALOGO.excluidos), 0)

    def test_vacio_no_es_cero(self):
        p = next(p for p in CATALOGO.productos if p.producto_id == "SAM_TRES-150-065-18-Z")
        self.assertIsNone(p.ancho_util_mm)
        self.assertIsNone(p.alto_util_mm)
        vacios = [r for rs in CATALOGO.cargas.values() for r in rs if r.estado_evidencia == "no determinada"]
        self.assertTrue(vacios)
        self.assertTrue(all(r.carga_valor is None for r in vacios))

    def test_cta_transcritas(self):
        def cta(pid):
            return [(r.luz_entre_apoyos_mm, r.carga_valor) for r in CATALOGO.cargas_de(pid) if r.carga_valor]
        # v0.2.1 (REV-043): fila C adoptada, fila A F-001, fila B F-004 sin luz
        self.assertEqual(cta("SAM_TRES-150-065-18-Z"), [(1500.0, 290.0), (1500.0, 300.0), (None, 290.0)])
        self.assertEqual(cta("SAM_TRES-150-065-18-G"), [(1500.0, 310.0)])
        self.assertEqual(cta("SAM_TRES-150-115-18-Z"), [(None, 530.0)])
        self.assertEqual(cta("SAM_TRES-150-115-18-G"), [])
        self.assertEqual(cta("SAM_TRPS-100-22-Z"), [])


if __name__ == "__main__":
    unittest.main()
