"""Registro de cables con procedencia. Lee datasets JSON con tablas transcriptas de fichas de fabricante.

Identificador: <PREFIJO>-<CU|AL>-<n_conductores>x<formación>[-NI]
    PRY-SVALIO-CU-1x6        Sintenax Valio cobre unipolar 6 mm²
    PRY-SVALIO-CU-4x25/16    tetrapolar con neutro reducido
    PRY-SVALIO-CU-4x25-NI    tetrapolar con neutro de sección igual a las fases
La coma decimal de la ficha se escribe con punto en el id (1,5 → 1.5).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from types import MappingProxyType

from .errores import DatoFaltante, ErrorEntrada
from .unidades import kg_km_a_kg_m, positivo

PREFIJOS_DATASET = {"PRY-SINTENAX-VALIO-ED2020": "PRY-SVALIO", "PRY-SUPERASTIC-ED2026": "PRY-SASTFLEX"}
ESTADOS_RADIO = ("no publicado", "publicado")
REFERENCIAS_RADIO_CABLE = ("eje_cable", "intrados_cable", "no especificada")
_MATERIAL = {"cobre": "CU", "aluminio": "AL"}


@dataclass(frozen=True)
class Cable:
    cable_id: str
    fabricante: str
    linea: str
    material: str
    tipo: str
    n_conductores: int
    formacion: str
    diametro_exterior_mm: float
    masa_kg_km: float
    masa_kg_m: float
    dataset_id: str
    fuente: dict
    anomalia_fuente: str | None = None
    colores: tuple = ()
    condiciones_empleo: tuple = ()
    radio_minimo: tuple = ()          # registros {condicion, multiplo_D | valor_mm, referencia, fuente}
    radio_minimo_estado: str = "no publicado"

    def procedencia(self) -> dict:
        d = dict(self.fuente)
        d["dataset_id"] = self.dataset_id
        d["estado_evidencia"] = "documentada (ficha de fabricante, valor aproximado)"
        if self.anomalia_fuente:
            d["anomalia_fuente"] = self.anomalia_fuente
        return d


class RegistroCables:
    """Registro de solo lectura hacia afuera (`cables` y `datasets` son mappingproxy).

    `version()` incluye un SHA-256 canónico del contenido efectivo, recalculado en cada llamada.
    """

    def __init__(self):
        self._cables: dict[str, Cable] = {}
        self._datasets: dict[str, dict] = {}

    @property
    def cables(self) -> MappingProxyType:
        return MappingProxyType(self._cables)

    @property
    def datasets(self) -> MappingProxyType:
        return MappingProxyType(self._datasets)

    @classmethod
    def desde_archivos(cls, *rutas: str | Path) -> "RegistroCables":
        reg = cls()
        for ruta in rutas:
            reg.cargar(ruta)
        return reg

    def cargar(self, ruta: str | Path) -> None:
        crudo = Path(ruta).read_bytes()
        ds = json.loads(crudo)
        ds_id = ds["dataset_id"]
        if ds_id in self._datasets:
            raise ErrorEntrada(f"Dataset duplicado: {ds_id}")
        prefijo = PREFIJOS_DATASET.get(ds_id)
        if prefijo is None:
            raise ErrorEntrada(f"Dataset sin prefijo de id registrado: {ds_id}")
        if ds.get("unidades") != {"diametro_exterior": "mm", "masa": "kg/km"}:
            raise ErrorEntrada(f"Unidades no reconocidas en {ds_id}: {ds.get('unidades')}")
        doc = ds["documento"]
        self._datasets[ds_id] = {
            "dataset_id": ds_id,
            "version_dataset": ds["version_dataset"],
            "sha256_dataset": hashlib.sha256(crudo).hexdigest(),
            "documento": doc["titulo"],
            "edicion": doc["edicion"],
            "sha256_documento": doc.get("sha256_archivo"),
            "estado_transcripcion": ds["transcripcion"]["estado"],
        }
        for tabla in ds["tablas"]:
            if tabla["columnas"] != ["formacion", "diametro_exterior_mm", "masa_kg_km"]:
                raise ErrorEntrada(f"Columnas inesperadas en {ds_id} p.{tabla['pagina']}")
            sufijo = "-NI" if tabla["tipo"] == "tetrapolar_neutro_igual" else ""
            rad = tabla.get("radio_minimo") or {"estado": "no publicado"}
            if rad.get("estado") not in ESTADOS_RADIO:
                raise ErrorEntrada(f"radio_minimo.estado inválido en {ds_id} p.{tabla['pagina']}")
            registros_radio = []
            for rr in rad.get("registros", []):
                if rr.get("referencia") not in REFERENCIAS_RADIO_CABLE:
                    raise ErrorEntrada(f"Referencia de radio de cable inválida en {ds_id}: {rr.get('referencia')}")
                if ("multiplo_D" in rr) == ("valor_mm" in rr):
                    raise ErrorEntrada(f"Radio mínimo en {ds_id}: indicar multiplo_D o valor_mm (uno solo)")
                k = "multiplo_D" if "multiplo_D" in rr else "valor_mm"
                positivo(rr[k], campo=f"{ds_id}.radio_minimo.{k}", error=DatoFaltante)
                if not rr.get("condicion"):
                    raise ErrorEntrada(f"Radio mínimo en {ds_id} sin condición de instalación")
                registros_radio.append(dict(rr))
            if rad["estado"] == "publicado" and not registros_radio:
                raise ErrorEntrada(f"{ds_id}: radio declarado 'publicado' sin registros")
            anomalias = tabla.get("anomalias_fuente", {})
            for formacion, d_mm, masa in tabla["filas"]:
                cable_id = f"{prefijo}-{_MATERIAL[tabla['material']]}-{tabla['n_conductores']}x{formacion.replace(',', '.')}{sufijo}"
                if cable_id in self._cables:
                    raise ErrorEntrada(f"Id de cable duplicado: {cable_id}")
                campo = f"{cable_id}.diametro_exterior_mm"
                d = positivo(d_mm, campo=campo, error=DatoFaltante)
                m_km = positivo(masa, campo=f"{cable_id}.masa_kg_km", error=DatoFaltante)
                self._cables[cable_id] = Cable(
                    cable_id=cable_id,
                    fabricante=ds["fabricante"],
                    linea=ds["linea"],
                    material=tabla["material"],
                    tipo=tabla["tipo"],
                    n_conductores=tabla["n_conductores"],
                    formacion=formacion,
                    diametro_exterior_mm=d,
                    masa_kg_km=m_km,
                    masa_kg_m=kg_km_a_kg_m(m_km, campo=f"{cable_id}.masa_kg_km"),
                    dataset_id=ds_id,
                    fuente={
                        "documento": doc["titulo"],
                        "archivo": doc["archivo"],
                        "edicion": doc["edicion"],
                        "pagina": tabla["pagina"],
                        "tabla": tabla["titulo_tabla"],
                        "fila": formacion,
                    },
                    anomalia_fuente=anomalias.get(formacion),
                    colores=tuple(tabla.get("colores", ())),
                    condiciones_empleo=tuple(tabla.get("condiciones_empleo", ())),
                    radio_minimo=tuple(registros_radio),
                    radio_minimo_estado=rad["estado"],
                )

    def obtener(self, cable_id: str) -> Cable:
        try:
            return self._cables[cable_id]
        except KeyError:
            raise ErrorEntrada(f"Cable desconocido: {cable_id!r}.", campo="cable_id") from None

    def sha256_contenido(self) -> str:
        datos = [asdict(c) for _, c in sorted(self._cables.items())]
        txt = json.dumps(datos, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        return hashlib.sha256(txt.encode("utf-8")).hexdigest()

    def version(self) -> dict:
        return {
            "datasets": {k: {"version_dataset": v["version_dataset"], "sha256_dataset": v["sha256_dataset"]}
                         for k, v in sorted(self._datasets.items())},
            "sha256_contenido": self.sha256_contenido(),
        }
