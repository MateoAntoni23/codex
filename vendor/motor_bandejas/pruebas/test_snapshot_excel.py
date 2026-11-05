"""El snapshot del catálogo debe coincidir tabla por tabla con el Excel REV-043 incluido en datos/catalogo/fuente."""
import subprocess
import sys
import unittest

from _comun import RAIZ

XLSX = RAIZ / "datos" / "catalogo" / "fuente" / "Catalogo_Bandejas_y_Accesorios_2.xlsx"


def _hay_openpyxl():
    try:
        import openpyxl  # noqa: F401
        return True
    except ImportError:
        return False


@unittest.skipUnless(XLSX.exists() and _hay_openpyxl(), "Excel de origen u openpyxl no disponibles")
class SnapshotIgualAlExcel(unittest.TestCase):
    def test_once_tablas_identicas(self):
        p = subprocess.run([sys.executable, str(RAIZ / "herramientas" / "verificar_snapshot.py"), str(XLSX)],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("11 tablas idénticas", p.stdout)


if __name__ == "__main__":
    unittest.main()
