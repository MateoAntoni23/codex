import copy
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from motor_bandejas.motor import cargar_contexto  # noqa: E402

CABLES, CATALOGO, DECISIONES = cargar_contexto()
CU6 = "PRY-SVALIO-CU-1x6"


def entrada(n=4, separado=True, reserva=20, vano=1500, **extra):
    e = {"tipo_circuito": "potencia", "vano_mm": vano, "reserva_solicitada_pct": reserva,
         "usos_cable": [{"cable_id": CU6, "cantidad": n, "separado": separado, "apilado": False}]}
    e.update(extra)
    return e


def snapshot_sintetico(productos, cargas):
    """Catálogo mínimo en memoria para probar reglas con valores controlados (fabricante ficticio)."""
    fam = {"familia_id": "EJ-FAM", "nombre_familia": "Ficticia", "tipo_constructivo": "escalera",
           "acabado_normalizado": None, "_fila_origen": 2}
    prods = []
    for i, p in enumerate(productos):
        base = {"producto_id": None, "sku": None, "familia_id": "EJ-FAM", "tipo_pieza": "recta",
                "ancho_nominal_mm": None, "ala_nominal_mm": None, "ancho_util_mm": None, "alto_util_mm": None,
                "espesor_chapa_mm": 1.0, "diametro_alambre_mm": None, "fuente_id": "EJ-F", "pagina_fuente": "1",
                "estado_dato": "transcrito", "_fila_origen": i + 2}
        base.update(p)
        prods.append(base)
    regs = []
    for i, c in enumerate(cargas):
        base = {"registro_carga_id": f"EJ-CAR-{i}", "producto_o_sistema_id": None, "tipo_entidad": "producto",
                "luz_entre_apoyos_mm": None, "carga_valor": None, "carga_unidad": "kg/m",
                "distribucion_carga": "uniformemente distribuida", "condiciones_ensayo": None,
                "criterio_o_norma_declarada": None, "fuente_id": "EJ-F", "pagina_fuente": "1",
                "estado_evidencia": "documentada", "observaciones": None, "_fila_origen": i + 2}
        base.update(c)
        regs.append(base)
    return {"tipo": "snapshot_catalogo_bandejas", "version_formato": "2",
            "origen": {"archivo": "sintetico", "sha256": "0" * 64},
            "FAMILIAS": [fam], "FUENTES": [{"fuente_id": "EJ-F", "_fila_origen": 2}], "PRODUCTOS": prods,
            "IDS_PRODUCTOS": [{"producto_id": p["producto_id"], "tipo_pieza": "recta", "_fila_origen": p["_fila_origen"]}
                              for p in prods],
            "TABLAS_CARGA": regs}


def snapshot_real():
    """Copia profunda del snapshot real como dict (para alterarlo en memoria sin tocar el archivo)."""
    import json
    from motor_bandejas.motor import RUTA_CATALOGO
    return json.loads(RUTA_CATALOGO.read_text(encoding="utf-8"))


def derivadas_reales():
    import json
    from motor_bandejas.motor import RUTA_DERIVADAS
    return json.loads(RUTA_DERIVADAS.read_text(encoding="utf-8"))


def decisiones(**cambios):
    d = copy.deepcopy(DECISIONES)
    d.update(cambios)
    return d
