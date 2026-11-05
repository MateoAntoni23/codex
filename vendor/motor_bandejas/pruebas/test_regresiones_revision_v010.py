"""Regresiones de la revisión independiente de v0.1.0 (hallazgos 1–5).

Cada prueba reproduce el escenario descripto en la revisión, sobre copias en memoria: los archivos de datos
no se modifican.
"""
import copy
import json
import math
import unittest
from dataclasses import FrozenInstanceError

from _comun import (CABLES, CATALOGO, DECISIONES, decisiones, derivadas_reales, entrada, snapshot_real,
                    snapshot_sintetico)

from motor_bandejas.catalogo import Catalogo, CatalogoInvalido
from motor_bandejas.motor import calcular_sector, resultado_vigente
from motor_bandejas.sesion import SesionSector


def registro(snap, rid):
    return next(r for r in snap["TABLAS_CARGA"] if r["registro_carga_id"] == rid)


def producto(snap, pid):
    return next(p for p in snap["PRODUCTOS"] if p["producto_id"] == pid)


def cat(snap):
    return Catalogo.desde_dict(snap, derivadas_reales())


class H1_HuellaIncluyeContenidoDelCatalogo(unittest.TestCase):
    def test_cambio_de_cta_con_mismos_metadatos_cambia_huella_y_vigencia(self):
        snap = snapshot_real()
        registro(snap, "CAR-0001")["carga_valor"] = 0.1          # 310 → 0,1 kg/m; origen intacto
        alterado = cat(snap)
        self.assertEqual(alterado.origen["sha256"], CATALOGO.origen["sha256"])
        e = entrada()
        r0 = calcular_sector(e, CABLES, CATALOGO, DECISIONES)
        r1 = calcular_sector(e, CABLES, alterado, DECISIONES)
        g0 = next(c for c in r0["candidatos"] if c["sku"] == "TRES-150-065-18-G")
        g1 = next(c for c in r1["candidatos"] if c["sku"] == "TRES-150-065-18-G")
        self.assertEqual((g0["mecanica"]["estado"], g1["mecanica"]["estado"]), ("VERIFICADA_CUMPLE", "VERIFICADA_NO_CUMPLE"))
        self.assertNotEqual(r0["huella"], r1["huella"])
        self.assertFalse(resultado_vigente(r0, e, CABLES, alterado, DECISIONES))

    def test_cambios_de_medidas_y_evidencia_cambian_el_hash(self):
        base = CATALOGO.sha256_contenido()
        for mutar in (lambda s: producto(s, "SAM_TRES-150-065-18-Z").__setitem__("ancho_nominal_mm", 151),
                      lambda s: producto(s, "SAM_TRES-150-065-18-Z").__setitem__("ala_nominal_mm", 64),
                      lambda s: registro(s, "CAR-0066").__setitem__("estado_evidencia", "validada por usuario"),
                      lambda s: registro(s, "CAR-0066").__setitem__("luz_entre_apoyos_mm", 1750)):
            snap = snapshot_real()
            mutar(snap)
            with self.subTest():
                self.assertNotEqual(cat(snap).sha256_contenido(), base)

    def test_reimportar_mismo_contenido_no_cambia_huella(self):
        snap = snapshot_real()
        snap["origen"]["importado_utc"] = "2030-01-01T00:00:00+00:00"   # solo metadato de importación
        self.assertEqual(cat(snap).version(), CATALOGO.version())

    def test_datos_inmutables(self):
        with self.assertRaises(TypeError):
            CATALOGO.cargas["X"] = ()
        with self.assertRaises(TypeError):
            CATALOGO.familias["SAM-STE-Z"]["nombre_familia"] = "x"
        with self.assertRaises(FrozenInstanceError):
            CATALOGO.productos[0].ancho_nominal_mm = 1.0
        with self.assertRaises(FrozenInstanceError):
            CATALOGO.productos = ()
        with self.assertRaises(TypeError):
            CABLES.cables["PRY-SVALIO-CU-1x6"] = None

    def test_hash_de_contenido_de_cables_en_huella(self):
        v = CABLES.version()
        self.assertEqual(len(v["sha256_contenido"]), 64)
        self.assertIn("PRY-SINTENAX-VALIO-ED2020", v["datasets"])


class H2_SesionRevalidaEnCadaAcceso(unittest.TestCase):
    def test_cambio_de_decisiones_en_el_dict_suministrado_invalida(self):
        dec = decisiones()
        s = SesionSector(CABLES, CATALOGO, dec, entrada(n=4))
        s.calcular()
        s.seleccionar("SAM_TRES-150-065-18-G")
        dec["D-05_criterio_reserva"] = "sobre_ancho_ocupado"       # mutación externa, sin avisar a la sesión
        self.assertFalse(s.vigente())
        self.assertIsNone(s.seleccion)
        self.assertEqual(s.resultado["vigencia"], "DESACTUALIZADO")
        with self.assertRaises(Exception):
            s.seleccionar("SAM_TRES-150-065-18-G")

    def test_consultar_seleccion_revalida_sin_llamar_vigente(self):
        dec = decisiones()
        s = SesionSector(CABLES, CATALOGO, dec, entrada(n=4))
        s.calcular()
        s.seleccionar("SAM_TRES-150-065-18-G")
        dec["D-04_ancho_referencia"] = "solo_util"
        self.assertIsNone(s.seleccion)

    def test_actualizar_contexto_con_catalogo_distinto_invalida(self):
        s = SesionSector(CABLES, CATALOGO, decisiones(), entrada(n=4))
        s.calcular()
        s.seleccionar("SAM_TRES-150-065-18-G")
        snap = snapshot_real()
        registro(snap, "CAR-0001")["carga_valor"] = 0.1
        s.actualizar_contexto(catalogo=cat(snap))
        self.assertFalse(s.vigente())
        self.assertIsNone(s.seleccion)
        s.calcular()
        self.assertTrue(s.vigente())

    def test_mismo_contexto_sigue_vigente(self):
        s = SesionSector(CABLES, CATALOGO, decisiones(), entrada(n=4))
        s.calcular()
        s.actualizar_contexto(catalogo=cat(snapshot_real()))     # contenido idéntico
        self.assertTrue(s.vigente())


class H3_CargaCombinadaNoEsDocumentada(unittest.TestCase):
    """v0.2.1: la combinación quedó separada en el Excel (REV-043, aprobado por el usuario). Se verifica que el
    valor de 290 kg/m siga sin presentarse como documentado y que el mecanismo de curación siga funcionando."""

    def test_z65_es_valor_adoptado_con_originales_separados(self):
        r = calcular_sector(entrada(n=4), CABLES, CATALOGO, DECISIONES)
        z = next(c for c in r["candidatos"] if c["sku"] == "TRES-150-065-18-Z")
        m = z["mecanica"]
        self.assertEqual(m["estado"], "CUMPLE_CONDICIONADO")
        self.assertEqual(m["base_evidencia"], "validada_por_usuario")
        self.assertEqual(m["registro"]["registro_carga_id"], "CAR-0046")
        self.assertIn("advertencia", m)                                   # A (300) y C (290) a la misma luz
        regs = {(r_.fuente_id, r_.luz_entre_apoyos_mm, r_.carga_valor, r_.estado_evidencia)
                for r_ in CATALOGO.cargas_de("SAM_TRES-150-065-18-Z") if r_.carga_valor}
        self.assertEqual(regs, {("F-005", 1500, 290, "validada por usuario"), ("F-001", 1500, 300, "documentada"),
                                ("F-004", None, 290, "documentada")})
        self.assertNotEqual(z["estado"], "APTA_GEOMETRIA_Y_MECANICA")
        self.assertIn("CTA_VALIDADA_POR_USUARIO", z["condiciones"])

    def test_curacion_desalineada_se_rechaza(self):
        """El mecanismo sigue: una curación que no coincide con el snapshot bloquea la carga."""
        der = {"version": "test", "derivaciones": [{
            "derivacion_id": "DER-TEST", "decision": "prueba", "regla": "prueba", "advertencia": "prueba",
            "registros": ["CAR-0046"], "registro_esperado": {"luz_entre_apoyos_mm": 1500, "carga_valor": 999,
                                                             "carga_unidad": "kg/m", "fuente_id": "F-005"},
            "registros_originales": []}]}
        with self.assertRaises(CatalogoInvalido) as cm:
            Catalogo.desde_dict(snapshot_real(), der)
        self.assertIn("DER-TEST", cm.exception.mensaje)
        der["derivaciones"][0]["registro_esperado"]["carga_valor"] = 290
        c = Catalogo.desde_dict(snapshot_real(), der)
        self.assertEqual(c.cargas_de("SAM_TRES-150-065-18-Z")[0].evidencia_motor, "adoptada_por_decision")

    def test_alcance_del_ensayo_declarado(self):
        r = calcular_sector(entrada(n=4), CABLES, CATALOGO, DECISIONES)
        for c in r["candidatos"]:
            self.assertFalse(c["mecanica"]["esquema_ensayo_contrastado"])


class H4_DimensionesNominalesNoDanAptitudCompleta(unittest.TestCase):
    def test_catalogo_real_sin_aptitud_completa(self):
        for e in (entrada(n=4), entrada(n=8), entrada(n=8, separado=False)):
            r = calcular_sector(e, CABLES, CATALOGO, DECISIONES)
            self.assertFalse(any(c["estado"] == "APTA_GEOMETRIA_Y_MECANICA" for c in r["candidatos"]))
            self.assertTrue(all(l["minimo_apto_completo"] is None for l in r["resumen_por_linea"]))
            g = next(c for c in r["candidatos"] if c["sku"] == "TRES-150-065-18-G")
            if g["geometria"]["estado"] == "CUMPLE":
                self.assertEqual(g["estado"], "PRESELECCION_CONDICIONADA")
                self.assertTrue(g["minimo_sin_rechazo_de_linea"])

    def test_aptitud_completa_requiere_medidas_utiles_y_cta_documentada(self):
        snap = snapshot_sintetico(
            [{"producto_id": "EJ-OK", "sku": "EJ-OK", "ancho_nominal_mm": 150, "ancho_util_mm": 140,
              "ala_nominal_mm": 65, "alto_util_mm": 55}],
            [{"producto_o_sistema_id": "EJ-OK", "luz_entre_apoyos_mm": 1500, "carga_valor": 100}])
        r = calcular_sector(entrada(n=4), CABLES, Catalogo.desde_dict(snap), DECISIONES)
        c = r["candidatos"][0]
        self.assertEqual((c["estado"], c["condiciones"]), ("APTA_GEOMETRIA_Y_MECANICA", []))
        self.assertTrue(c["minimo_apto_completo_de_linea"])


class H5_NumerosDelCatalogoValidados(unittest.TestCase):
    def assertInvalido(self, snap, columna=None):
        with self.assertRaises(CatalogoInvalido) as cm:
            Catalogo.desde_dict(snap)
        p = cm.exception.problemas[0]
        self.assertIn("hoja", p)
        self.assertIn("fila", p)
        if columna:
            self.assertEqual(p["columna"], columna)
        return cm.exception

    def base(self, **campos):
        prod = {"producto_id": "EJ-1", "sku": "EJ-1", "ancho_nominal_mm": 150, "ala_nominal_mm": 65}
        prod.update(campos)
        return snapshot_sintetico([prod], [])

    def test_medidas_no_validas(self):
        for v in (math.inf, -math.inf, math.nan, 0, -5, "150", True):
            with self.subTest(ancho=v):
                self.assertInvalido(self.base(ancho_nominal_mm=v), "ancho_nominal_mm")
        for col in ("ala_nominal_mm", "ancho_util_mm", "alto_util_mm", "espesor_chapa_mm", "diametro_alambre_mm"):
            with self.subTest(col=col):
                self.assertInvalido(self.base(**{col: 0}), col)

    def test_cargas_no_validas(self):
        for col, v in (("carga_valor", 0), ("carga_valor", math.inf), ("luz_entre_apoyos_mm", -1500),
                       ("carga_valor", "310")):
            snap = snapshot_sintetico([{"producto_id": "EJ-1", "ancho_nominal_mm": 150, "ala_nominal_mm": 65}],
                                      [{"producto_o_sistema_id": "EJ-1", "luz_entre_apoyos_mm": 1500, col: v}])
            with self.subTest(col=col, v=v):
                self.assertInvalido(snap, col)
        snap = snapshot_sintetico([{"producto_id": "EJ-1", "ancho_nominal_mm": 150}],
                                  [{"producto_o_sistema_id": "EJ-1", "carga_valor": 100, "carga_unidad": None}])
        self.assertInvalido(snap, "carga_unidad")

    def test_duplicados_y_referencias(self):
        snap = snapshot_sintetico([{"producto_id": "EJ-1", "ancho_nominal_mm": 150},
                                   {"producto_id": "EJ-1", "ancho_nominal_mm": 300}], [])
        self.assertInvalido(snap)
        snap = self.base(familia_id="NO-EXISTE")
        self.assertInvalido(snap, "familia_id")
        snap = self.base(fuente_id="F-999")
        self.assertInvalido(snap, "fuente_id")
        snap = snapshot_sintetico([{"producto_id": "EJ-1", "ancho_nominal_mm": 150}],
                                  [{"producto_o_sistema_id": "EJ-FANTASMA", "carga_valor": 1, "luz_entre_apoyos_mm": 1}])
        self.assertInvalido(snap, "producto_o_sistema_id")
        snap = snapshot_sintetico([{"producto_id": "EJ-1", "ancho_nominal_mm": 150}],
                                  [{"producto_o_sistema_id": "EJ-1", "carga_valor": 1}, {"producto_o_sistema_id": "EJ-1"}])
        snap["TABLAS_CARGA"][1]["registro_carga_id"] = snap["TABLAS_CARGA"][0]["registro_carga_id"]
        self.assertInvalido(snap, "registro_carga_id")

    def test_formato_antiguo_rechazado(self):
        snap = self.base()
        snap["version_formato"] = "1"
        self.assertInvalido(snap, "version_formato")

    def test_vacio_sigue_siendo_desconocido(self):
        c = Catalogo.desde_dict(self.base(ala_nominal_mm=None))
        self.assertIsNone(c.productos[0].ala_nominal_mm)

    def test_infinito_ya_no_llega_a_apta(self):
        snap = snapshot_real()
        producto(snap, "SAM_TRES-150-065-18-G")["ancho_nominal_mm"] = math.inf
        with self.assertRaises(CatalogoInvalido):
            cat(snap)

    def test_salida_json_estricta(self):
        for e in (entrada(n=4), entrada(n=8), entrada(n=8, separado=False), entrada(tipo_circuito="mando_senal")):
            json.dumps(calcular_sector(e, CABLES, CATALOGO, DECISIONES), allow_nan=False)


if __name__ == "__main__":
    unittest.main()
