"""Catálogo de bandejas (solo lectura) a partir del snapshot JSON generado desde el Excel del proyecto.

Reglas:
- No se decodifican medidas a partir del SKU. Ancho, ala y espesor salen de las columnas del catálogo.
- Celda vacía = desconocido (None). Nunca se convierte a 0.
- Toda medida o carga presente debe ser numérica, finita y > 0. Texto, bool, 0, negativos, NaN o ±inf
  invalidan el catálogo completo (CatalogoInvalido con hoja, fila, id y columna de cada problema).
- Ids únicos; referencias a FAMILIAS, FUENTES y a productos existentes (IDS_PRODUCTOS) verificadas.
- Un tramo sin ancho publicado queda excluido de la selección con el motivo registrado.
- El objeto es inmutable (tuplas y mappingproxy). `version()` calcula un SHA-256 canónico del contenido
  efectivo en cada llamada: cualquier diferencia de datos cambia la huella de los resultados.
- Registros que combinan fuentes por decisión del usuario (cargas_derivadas.json) se marcan como
  'adoptada_por_decision' y conservan los registros originales separados.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from dataclasses import dataclass, fields
from pathlib import Path
from types import MappingProxyType

from .errores import ErrorMotor

VERSIONES_FORMATO_ADMITIDAS = ("2", "3")
TIPOS_SELECCIONABLES = ("recta",)
_COLS_PRODUCTO = ("ancho_nominal_mm", "ala_nominal_mm", "ancho_util_mm", "alto_util_mm",
                  "espesor_chapa_mm", "diametro_alambre_mm")
_COLS_PIEZA_EXTRA = ("angulo_grados", "radio_mm", "longitud_comercial_mm", "cantidad_por_envase",
                     "peso_kg_por_unidad_compra")
REFERENCIAS_RADIO = (None, "interior", "eje", "exterior", "no especificado")
_COLS_CARGA = ("luz_entre_apoyos_mm", "carga_valor")
EVIDENCIA_MOTOR = {"documentada": "documentada", "validada por usuario": "validada_por_usuario"}


class CatalogoInvalido(ErrorMotor):
    codigo = "CATALOGO_INVALIDO"

    def __init__(self, problemas: list[dict]):
        resumen = "; ".join(f"{p['hoja']} fila {p['fila']} ({p.get('id')}) {p.get('columna') or ''}: {p['motivo']}"
                            for p in problemas[:10])
        mas = f" … y {len(problemas) - 10} más" if len(problemas) > 10 else ""
        super().__init__(f"Catálogo inválido ({len(problemas)} problema/s): {resumen}{mas}")
        self.problemas = problemas

    def como_dict(self) -> dict:
        d = super().como_dict()
        d["problemas"] = self.problemas
        return d


def _congelar(obj):
    if isinstance(obj, dict):
        return MappingProxyType({k: _congelar(v) for k, v in obj.items()})
    if isinstance(obj, (list, tuple)):
        return tuple(_congelar(v) for v in obj)
    return obj


def _descongelar(obj):
    if isinstance(obj, MappingProxyType) or isinstance(obj, dict):
        return {k: _descongelar(v) for k, v in obj.items()}
    if isinstance(obj, tuple):
        return [_descongelar(v) for v in obj]
    return obj


@dataclass(frozen=True)
class Producto:
    producto_id: str
    sku: str | None
    familia_id: str
    nombre_familia: str | None
    tipo_constructivo: str | None
    acabado_normalizado: str | None
    ancho_nominal_mm: float | None
    ala_nominal_mm: float | None
    ancho_util_mm: float | None
    alto_util_mm: float | None
    espesor_chapa_mm: float | None
    diametro_alambre_mm: float | None
    fuente_id: str | None
    pagina_fuente: str | None
    estado_dato: str | None
    fila_origen: int
    tipo_pieza: str | None = None
    descripcion_original: str | None = None
    angulo_grados: float | None = None
    radio_mm: float | None = None
    referencia_radio: str | None = None
    longitud_comercial_mm: float | None = None
    unidad_compra: str | None = None
    cantidad_por_envase: float | None = None
    peso_kg_por_unidad_compra: float | None = None
    observaciones: str | None = None

    def procedencia(self) -> dict:
        return {"hoja": "PRODUCTOS", "fila": self.fila_origen, "fuente_id": self.fuente_id,
                "pagina_fuente": self.pagina_fuente, "estado_dato": self.estado_dato}


@dataclass(frozen=True)
class Puerto:
    puerto_id: str
    producto_id: str
    nombre_puerto: str | None
    ancho_nominal_mm: float | None
    ala_nominal_mm: float | None
    interfaz_conexion: str | None
    fuente_id: str | None
    pagina_fuente: str | None
    fila_origen: int


@dataclass(frozen=True)
class Compatibilidad:
    compatibilidad_id: str
    producto_a_id: str
    puerto_a_id: str | None
    producto_b_id: str | None
    puerto_b_id: str | None
    tipo_conexion: str | None
    estado_compatibilidad: str | None
    estado_evidencia: str | None
    fuente_id: str | None
    pagina_fuente: str | None
    observaciones: str | None
    fila_origen: int

    def como_dict(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)}


@dataclass(frozen=True)
class ComponenteUnion:
    compatibilidad_id: str
    producto_requerido_id: str
    cantidad: float | None
    observaciones: str | None
    fuente_id: str | None
    pagina_fuente: str | None
    estado_evidencia: str | None
    fila_origen: int


@dataclass(frozen=True)
class RegistroCarga:
    registro_carga_id: str
    producto_o_sistema_id: str
    tipo_entidad: str | None
    luz_entre_apoyos_mm: float | None
    carga_valor: float | None
    carga_unidad: str | None
    distribucion_carga: str | None
    condiciones_ensayo: str | None
    criterio_o_norma_declarada: str | None
    fuente_id: str | None
    pagina_fuente: str | None
    estado_evidencia: str | None
    observaciones: str | None
    fila_origen: int
    evidencia_motor: str | None = None      # documentada | validada_por_usuario | adoptada_por_decision | None
    derivacion: MappingProxyType | None = None

    def como_dict(self) -> dict:
        d = {
            "registro_carga_id": self.registro_carga_id,
            "luz_entre_apoyos_mm": self.luz_entre_apoyos_mm,
            "carga_valor": self.carga_valor,
            "carga_unidad": self.carga_unidad,
            "distribucion_carga": self.distribucion_carga,
            "condiciones_ensayo": self.condiciones_ensayo,
            "criterio_o_norma_declarada": self.criterio_o_norma_declarada,
            "fuente_id": self.fuente_id,
            "pagina_fuente": self.pagina_fuente,
            "estado_evidencia_catalogo": self.estado_evidencia,
            "evidencia_motor": self.evidencia_motor,
            "hoja": "TABLAS_CARGA",
            "fila": self.fila_origen,
        }
        if self.derivacion is not None:
            d["derivacion"] = _descongelar(self.derivacion)
        return d


class _Validador:
    def __init__(self):
        self.problemas: list[dict] = []

    def problema(self, hoja, fila, id_, columna, valor, motivo):
        self.problemas.append({"hoja": hoja, "fila": fila, "id": id_, "columna": columna,
                               "valor": repr(valor), "motivo": motivo})

    def medida(self, hoja, r, columna, id_):
        v = r.get(columna)
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            self.problema(hoja, r.get("_fila_origen"), id_, columna, v, "valor no numérico en columna numérica")
            return None
        x = float(v)
        if not math.isfinite(x):
            self.problema(hoja, r.get("_fila_origen"), id_, columna, v, "valor no finito")
            return None
        if x <= 0:
            self.problema(hoja, r.get("_fila_origen"), id_, columna, v, "valor ≤ 0 (vacío = desconocido; 0 no es válido)")
            return None
        return x

    def texto_obligatorio(self, hoja, r, columna, id_):
        v = r.get(columna)
        if not isinstance(v, str) or not v.strip():
            self.problema(hoja, r.get("_fila_origen"), id_, columna, v, "identificador obligatorio vacío o no textual")
            return None
        return v


@dataclass(frozen=True)
class Catalogo:
    productos: tuple
    excluidos: tuple
    cargas: MappingProxyType
    familias: MappingProxyType
    fuentes: MappingProxyType
    origen: MappingProxyType
    version_formato: str
    derivaciones: MappingProxyType
    piezas: MappingProxyType = MappingProxyType({})
    puertos: MappingProxyType = MappingProxyType({})          # producto_id -> tuple[Puerto]
    puertos_por_id: MappingProxyType = MappingProxyType({})
    compatibilidades: tuple = ()
    componentes_union: MappingProxyType = MappingProxyType({})  # compatibilidad_id -> tuple[ComponenteUnion]
    sistemas_soporte: MappingProxyType = MappingProxyType({})
    componentes_soporte: MappingProxyType = MappingProxyType({})  # sistema_id -> tuple[dict]
    aplicaciones_soporte: tuple = ()

    # ------------------------------------------------------------------ carga
    @classmethod
    def desde_snapshot(cls, ruta: str | Path, ruta_derivadas: str | Path | None = None) -> "Catalogo":
        crudo = Path(ruta).read_bytes()
        snap = json.loads(crudo)
        der = json.loads(Path(ruta_derivadas).read_text(encoding="utf-8")) if ruta_derivadas else None
        return cls.desde_dict(snap, der, sha256_snapshot=hashlib.sha256(crudo).hexdigest())

    @classmethod
    def desde_dict(cls, snap: dict, derivadas: dict | None = None, *, sha256_snapshot: str | None = None) -> "Catalogo":
        if snap.get("tipo") != "snapshot_catalogo_bandejas":
            raise CatalogoInvalido([{"hoja": "-", "fila": None, "id": None, "columna": "tipo",
                                     "valor": repr(snap.get("tipo")), "motivo": "no es un snapshot de catálogo"}])
        if snap.get("version_formato") not in VERSIONES_FORMATO_ADMITIDAS:
            raise CatalogoInvalido([{"hoja": "-", "fila": None, "id": None, "columna": "version_formato",
                                     "valor": repr(snap.get("version_formato")),
                                     "motivo": f"formato no admitido; regenerar con el importador (admitidos {VERSIONES_FORMATO_ADMITIDAS})"}])
        snap = copy.deepcopy(snap)
        val = _Validador()

        # FUENTES y FAMILIAS: ids únicos
        fuentes, familias = {}, {}
        for hoja, destino, clave in (("FUENTES", fuentes, "fuente_id"), ("FAMILIAS", familias, "familia_id")):
            for r in snap.get(hoja, []):
                id_ = val.texto_obligatorio(hoja, r, clave, None)
                if id_ is None:
                    continue
                if id_ in destino:
                    val.problema(hoja, r.get("_fila_origen"), id_, clave, id_, "identificador duplicado")
                destino[id_] = {k: v for k, v in r.items()}

        ids_todos = {}
        for r in snap.get("IDS_PRODUCTOS", []):
            id_ = val.texto_obligatorio("IDS_PRODUCTOS", r, "producto_id", None)
            if id_ is None:
                continue
            if id_ in ids_todos:
                val.problema("PRODUCTOS", r.get("_fila_origen"), id_, "producto_id", id_, "identificador duplicado")
            ids_todos[id_] = r

        productos, excluidos, vistos, piezas = [], [], set(), {}
        for r in snap.get("PRODUCTOS", []):
            pid = val.texto_obligatorio("PRODUCTOS", r, "producto_id", None)
            if pid is None:
                continue
            if pid in vistos:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "producto_id", pid, "producto duplicado")
                continue
            vistos.add(pid)
            if pid not in ids_todos:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "producto_id", pid, "falta en IDS_PRODUCTOS")
            fam_id = val.texto_obligatorio("PRODUCTOS", r, "familia_id", pid)
            if fam_id is not None and fam_id not in familias:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "familia_id", fam_id, "familia inexistente")
            if r.get("fuente_id") is not None and r.get("fuente_id") not in fuentes:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "fuente_id", r.get("fuente_id"), "fuente inexistente")
            nums = {c: val.medida("PRODUCTOS", r, c, pid) for c in _COLS_PRODUCTO}
            extra = {c: val.medida("PRODUCTOS", r, c, pid) for c in _COLS_PIEZA_EXTRA if c in r}
            if extra.get("angulo_grados") is not None and extra["angulo_grados"] > 360:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "angulo_grados", r.get("angulo_grados"), "ángulo > 360°")
            if r.get("referencia_radio") not in REFERENCIAS_RADIO:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "referencia_radio", r.get("referencia_radio"),
                             "referencia de radio desconocida")
            if r.get("radio_mm") is not None and r.get("referencia_radio") is None:
                val.problema("PRODUCTOS", r.get("_fila_origen"), pid, "referencia_radio", None,
                             "radio publicado sin referencia (interior/eje/exterior/no especificado)")
            fam = familias.get(fam_id, {})
            p = Producto(
                producto_id=pid, sku=r.get("sku"), familia_id=fam_id,
                nombre_familia=fam.get("nombre_familia"), tipo_constructivo=fam.get("tipo_constructivo"),
                acabado_normalizado=fam.get("acabado_normalizado"),
                fuente_id=r.get("fuente_id"), pagina_fuente=r.get("pagina_fuente"), estado_dato=r.get("estado_dato"),
                fila_origen=r.get("_fila_origen", -1),
                tipo_pieza=r.get("tipo_pieza"), descripcion_original=r.get("descripcion_original"),
                referencia_radio=r.get("referencia_radio"), unidad_compra=r.get("unidad_compra"),
                observaciones=r.get("observaciones"), **nums, **extra,
            )
            piezas[pid] = p
            if p.tipo_pieza not in TIPOS_SELECCIONABLES:
                continue
            if p.ancho_nominal_mm is None and p.ancho_util_mm is None:
                excluidos.append({"producto_id": pid, "fila": p.fila_origen, "motivo": "sin ancho publicado"})
                continue
            productos.append(p)

        # Derivaciones (valores adoptados por decisión)
        mapa_der = {}
        for d in (derivadas or {}).get("derivaciones", []):
            for rid in d["registros"]:
                if rid in mapa_der:
                    val.problema("cargas_derivadas", None, rid, "registros", rid, "registro en más de una derivación")
                mapa_der[rid] = d

        cargas, vistos_c = {}, set()
        for r in snap.get("TABLAS_CARGA", []):
            rid = val.texto_obligatorio("TABLAS_CARGA", r, "registro_carga_id", None)
            if rid is None:
                continue
            if rid in vistos_c:
                val.problema("TABLAS_CARGA", r.get("_fila_origen"), rid, "registro_carga_id", rid, "registro duplicado")
                continue
            vistos_c.add(rid)
            ref = val.texto_obligatorio("TABLAS_CARGA", r, "producto_o_sistema_id", rid)
            if ref is not None and r.get("tipo_entidad") == "producto" and ref not in ids_todos:
                val.problema("TABLAS_CARGA", r.get("_fila_origen"), rid, "producto_o_sistema_id", ref, "producto inexistente")
            if r.get("fuente_id") is not None and r.get("fuente_id") not in fuentes:
                val.problema("TABLAS_CARGA", r.get("_fila_origen"), rid, "fuente_id", r.get("fuente_id"), "fuente inexistente")
            nums = {c: val.medida("TABLAS_CARGA", r, c, rid) for c in _COLS_CARGA}
            if nums["carga_valor"] is not None and not r.get("carga_unidad"):
                val.problema("TABLAS_CARGA", r.get("_fila_origen"), rid, "carga_unidad", None, "valor de carga sin unidad")
            evid = EVIDENCIA_MOTOR.get(r.get("estado_evidencia"))
            der = None
            if rid in mapa_der:
                d = mapa_der[rid]
                esp = d["registro_esperado"]
                if (nums["luz_entre_apoyos_mm"] != esp["luz_entre_apoyos_mm"] or nums["carga_valor"] != esp["carga_valor"]
                        or r.get("carga_unidad") != esp["carga_unidad"] or r.get("fuente_id") != esp["fuente_id"]):
                    val.problema("TABLAS_CARGA", r.get("_fila_origen"), rid, "-", None,
                                 f"no coincide con la curación {d['derivacion_id']}: revisar cargas_derivadas.json")
                evid = "adoptada_por_decision"
                der = _congelar({k: d[k] for k in ("derivacion_id", "decision", "regla", "advertencia", "registros_originales")})
            rc = RegistroCarga(
                registro_carga_id=rid, producto_o_sistema_id=ref, tipo_entidad=r.get("tipo_entidad"),
                carga_unidad=r.get("carga_unidad"), distribucion_carga=r.get("distribucion_carga"),
                condiciones_ensayo=r.get("condiciones_ensayo"), criterio_o_norma_declarada=r.get("criterio_o_norma_declarada"),
                fuente_id=r.get("fuente_id"), pagina_fuente=r.get("pagina_fuente"), estado_evidencia=r.get("estado_evidencia"),
                observaciones=r.get("observaciones"), fila_origen=r.get("_fila_origen", -1),
                evidencia_motor=evid, derivacion=der, **nums,
            )
            cargas.setdefault(ref, []).append(rc)
        faltan_der = sorted(set(mapa_der) - vistos_c)
        for rid in faltan_der:
            val.problema("cargas_derivadas", None, rid, "registros", rid, "registro curado inexistente en el snapshot")

        puertos, puertos_por_id = {}, {}
        for r in snap.get("PUERTOS_PRODUCTO", []):
            pid = val.texto_obligatorio("PUERTOS_PRODUCTO", r, "puerto_id", None)
            prod = val.texto_obligatorio("PUERTOS_PRODUCTO", r, "producto_id", pid)
            if pid is None or prod is None:
                continue
            if pid in puertos_por_id:
                val.problema("PUERTOS_PRODUCTO", r.get("_fila_origen"), pid, "puerto_id", pid, "puerto duplicado")
                continue
            if prod not in piezas:
                val.problema("PUERTOS_PRODUCTO", r.get("_fila_origen"), pid, "producto_id", prod, "producto inexistente")
            pu = Puerto(puerto_id=pid, producto_id=prod, nombre_puerto=r.get("nombre_puerto"),
                        ancho_nominal_mm=val.medida("PUERTOS_PRODUCTO", r, "ancho_nominal_mm", pid),
                        ala_nominal_mm=val.medida("PUERTOS_PRODUCTO", r, "ala_nominal_mm", pid),
                        interfaz_conexion=r.get("interfaz_conexion"), fuente_id=r.get("fuente_id"),
                        pagina_fuente=r.get("pagina_fuente"), fila_origen=r.get("_fila_origen", -1))
            puertos_por_id[pid] = pu
            puertos.setdefault(prod, []).append(pu)

        compat, vistos_cmp = [], set()
        for r in snap.get("COMPATIBILIDADES", []):
            cid = val.texto_obligatorio("COMPATIBILIDADES", r, "compatibilidad_id", None)
            if cid is None:
                continue
            if cid in vistos_cmp:
                val.problema("COMPATIBILIDADES", r.get("_fila_origen"), cid, "compatibilidad_id", cid, "duplicado")
                continue
            vistos_cmp.add(cid)
            for col in ("producto_a_id", "producto_b_id"):
                if r.get(col) is not None and r.get(col) not in piezas:
                    val.problema("COMPATIBILIDADES", r.get("_fila_origen"), cid, col, r.get(col), "producto inexistente")
            for col in ("puerto_a_id", "puerto_b_id"):
                if r.get(col) is not None and r.get(col) not in puertos_por_id:
                    val.problema("COMPATIBILIDADES", r.get("_fila_origen"), cid, col, r.get(col), "puerto inexistente")
            compat.append(Compatibilidad(
                compatibilidad_id=cid, producto_a_id=r.get("producto_a_id"), puerto_a_id=r.get("puerto_a_id"),
                producto_b_id=r.get("producto_b_id"), puerto_b_id=r.get("puerto_b_id"),
                tipo_conexion=r.get("tipo_conexion"), estado_compatibilidad=r.get("estado_compatibilidad"),
                estado_evidencia=r.get("estado_evidencia"), fuente_id=r.get("fuente_id"),
                pagina_fuente=r.get("pagina_fuente"), observaciones=r.get("observaciones"),
                fila_origen=r.get("_fila_origen", -1)))

        comp_union = {}
        for r in snap.get("COMPONENTES_UNION", []):
            cid, req = r.get("compatibilidad_id"), r.get("producto_requerido_id")
            if cid not in vistos_cmp:
                val.problema("COMPONENTES_UNION", r.get("_fila_origen"), cid, "compatibilidad_id", cid, "compatibilidad inexistente")
            if req not in piezas:
                val.problema("COMPONENTES_UNION", r.get("_fila_origen"), cid, "producto_requerido_id", req, "producto inexistente")
            comp_union.setdefault(cid, []).append(ComponenteUnion(
                compatibilidad_id=cid, producto_requerido_id=req,
                cantidad=val.medida("COMPONENTES_UNION", r, "cantidad", cid), observaciones=r.get("observaciones"),
                fuente_id=r.get("fuente_id"), pagina_fuente=r.get("pagina_fuente"),
                estado_evidencia=r.get("estado_evidencia"), fila_origen=r.get("_fila_origen", -1)))

        sistemas = {}
        for r in snap.get("SISTEMAS_SOPORTE", []):
            sid = val.texto_obligatorio("SISTEMAS_SOPORTE", r, "sistema_soporte_id", None)
            if sid is not None:
                if sid in sistemas:
                    val.problema("SISTEMAS_SOPORTE", r.get("_fila_origen"), sid, "sistema_soporte_id", sid, "duplicado")
                sistemas[sid] = r
        comp_sop = {}
        for r in snap.get("COMPONENTES_SOPORTE", []):
            sid = r.get("sistema_soporte_id")
            if sid not in sistemas:
                val.problema("COMPONENTES_SOPORTE", r.get("_fila_origen"), sid, "sistema_soporte_id", sid, "sistema inexistente")
            if r.get("producto_id") not in piezas:
                val.problema("COMPONENTES_SOPORTE", r.get("_fila_origen"), sid, "producto_id", r.get("producto_id"), "producto inexistente")
            d = dict(r)
            d["cantidad"] = val.medida("COMPONENTES_SOPORTE", r, "cantidad", sid)
            comp_sop.setdefault(sid, []).append(d)
        aplic = []
        for r in snap.get("APLICACIONES_SOPORTE", []):
            if r.get("sistema_soporte_id") not in sistemas:
                val.problema("APLICACIONES_SOPORTE", r.get("_fila_origen"), r.get("aplicacion_id"), "sistema_soporte_id",
                             r.get("sistema_soporte_id"), "sistema inexistente")
            d = dict(r)
            for col in ("ancho_min_mm", "ancho_max_mm"):
                d[col] = val.medida("APLICACIONES_SOPORTE", r, col, r.get("aplicacion_id"))
            aplic.append(d)

        if val.problemas:
            raise CatalogoInvalido(val.problemas)

        origen = dict(snap.get("origen", {}))
        origen["sha256_snapshot"] = sha256_snapshot
        return cls(
            productos=tuple(productos), excluidos=_congelar(excluidos),
            cargas=MappingProxyType({k: tuple(v) for k, v in cargas.items()}),
            familias=_congelar(familias), fuentes=_congelar(fuentes), origen=_congelar(origen),
            version_formato=snap["version_formato"],
            derivaciones=_congelar({"version": (derivadas or {}).get("version"),
                                    "ids": sorted(mapa_der)}),
            piezas=MappingProxyType(piezas),
            puertos=MappingProxyType({k: tuple(v) for k, v in puertos.items()}),
            puertos_por_id=MappingProxyType(puertos_por_id),
            compatibilidades=tuple(compat),
            componentes_union=MappingProxyType({k: tuple(v) for k, v in comp_union.items()}),
            sistemas_soporte=_congelar(sistemas),
            componentes_soporte=_congelar(comp_sop),
            aplicaciones_soporte=_congelar(aplic),
        )._con_hash()

    def _con_hash(self) -> "Catalogo":
        """Calcula el SHA-256 del contenido una sola vez. Es válido porque el objeto es inmutable
        (dataclass congelada, tuplas y mappingproxy); `verificar_hash()` lo recalcula para auditoría."""
        object.__setattr__(self, "_sha256", self._calcular_sha256())
        return self

    # ------------------------------------------------------------------ consulta
    def cargas_de(self, producto_id: str) -> tuple:
        return self.cargas.get(producto_id, ())

    def contenido_canonico(self) -> dict:
        """Datos efectivos que usa el motor (sin metadatos de importación)."""
        def reg(x):
            return {f.name: _descongelar(getattr(x, f.name)) for f in fields(x)}
        return {
            "productos": [reg(p) for p in self.productos],
            "excluidos": _descongelar(self.excluidos),
            "cargas": {k: [reg(r) for r in v] for k, v in sorted(self.cargas.items())},
            "familias": _descongelar(self.familias),
            "fuentes": _descongelar(self.fuentes),
            "piezas": [reg(p) for _, p in sorted(self.piezas.items())],
            "puertos": [reg(p) for _, p in sorted(self.puertos_por_id.items())],
            "compatibilidades": [reg(c) for c in self.compatibilidades],
            "componentes_union": {k: [reg(c) for c in v] for k, v in sorted(self.componentes_union.items())},
            "sistemas_soporte": _descongelar(self.sistemas_soporte),
            "componentes_soporte": _descongelar(self.componentes_soporte),
            "aplicaciones_soporte": _descongelar(self.aplicaciones_soporte),
        }

    def sha256_contenido(self) -> str:
        return self.__dict__.get("_sha256") or self._calcular_sha256()

    def verificar_hash(self) -> bool:
        return self.sha256_contenido() == self._calcular_sha256()

    def _calcular_sha256(self) -> str:
        txt = json.dumps(self.contenido_canonico(), sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                         allow_nan=False)
        return hashlib.sha256(txt.encode("utf-8")).hexdigest()

    def version(self) -> dict:
        """Identidad de los datos para la huella: contenido efectivo + Excel de origen + formato.
        No incluye el SHA del archivo snapshot (cambia con la fecha de importación aunque los datos no cambien)."""
        return {"archivo_origen": self.origen.get("archivo"), "sha256_origen": self.origen.get("sha256"),
                "sha256_contenido": self.sha256_contenido(),
                "version_formato_snapshot": self.version_formato,
                "derivaciones": _descongelar(self.derivaciones)}

    def procedencia(self) -> dict:
        d = self.version()
        d["sha256_snapshot"] = self.origen.get("sha256_snapshot")
        d["importado_utc"] = self.origen.get("importado_utc")
        return d
