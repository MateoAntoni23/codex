"""Orquestador: valida la entrada de un sector, calcula y devuelve un resultado trazable.

Contrato de entrada (dict / JSON):
{
  "tipo_circuito": "potencia",                    # obligatorio. 'mando_senal' → BLOQUEADO (sin reglas)
  "vano_mm": 1500,                                # obligatorio, > 0, luz entre apoyos
  "reserva_solicitada_pct": 20,                   # obligatorio, [0, 100)
  "usos_cable": [                                 # obligatorio, ≥ 1
    {"cable_id": "PRY-SVALIO-CU-1x6", "cantidad": 4, "separado": true, "apilado": false}
  ],
  "familias": ["SAM-STE-Z", "SAM-STP-Z"],         # opcional: filtra familias del catálogo
  "criterio_reserva": "fraccion_libre_ancho_bandeja"  # opcional: reemplaza D-05 (queda registrado)
}
'apilado' es opcional (por defecto false). 'separado' es obligatorio: no se presume la disposición.
"""
from __future__ import annotations

import copy
from pathlib import Path

from . import __version__
from .calculos import (CRITERIOS_RESERVA, METODOS, disposicion_una_capa, evaluar_mecanica,
                       evaluar_reserva, masa_lineal)
from .catalogo import Catalogo, Producto
from .datos_cables import RegistroCables
from .errores import ErrorEntrada, ErrorMotor, NoSoportado, PendienteDecision
from .procedencia import huella
from .unidades import EPS, entero_positivo, pct_a_fraccion, positivo, redondear

CLAVES_ENTRADA = {"tipo_circuito", "vano_mm", "reserva_solicitada_pct", "usos_cable", "familias", "criterio_reserva"}
CLAVES_OBLIGATORIAS = {"tipo_circuito", "vano_mm", "reserva_solicitada_pct", "usos_cable"}
CLAVES_USO = {"cable_id", "cantidad", "separado", "apilado"}
TIPOS_CIRCUITO = {"potencia", "mando_senal"}

AVISO_ELECTRICO = (
    "Selección geométrica y mecánica únicamente. NO verifica intensidad admisible, factores de agrupamiento o "
    "temperatura, caída de tensión, cortocircuito ni compatibilidad entre circuitos. La instalación NO está "
    "verificada eléctricamente."
)

# ------------------------------------------------------------------------------------------- validación


def validar_entrada(entrada: dict, cables: RegistroCables, catalogo: Catalogo) -> dict:
    """Devuelve la entrada normalizada (tipos estrictos). Lanza ErrorEntrada/DatoFaltante ante cualquier defecto."""
    if not isinstance(entrada, dict):
        raise ErrorEntrada("La entrada debe ser un objeto JSON.")
    desconocidas = set(entrada) - CLAVES_ENTRADA
    if desconocidas:
        raise ErrorEntrada(f"Claves desconocidas en la entrada: {sorted(desconocidas)}.", campo=",".join(sorted(desconocidas)))
    faltan = CLAVES_OBLIGATORIAS - set(entrada)
    if faltan:
        raise ErrorEntrada(f"Faltan claves obligatorias: {sorted(faltan)}.", campo=",".join(sorted(faltan)))

    tipo = entrada["tipo_circuito"]
    if not isinstance(tipo, str) or tipo not in TIPOS_CIRCUITO:      # v0.2.2 (auditoría H6): [] no es hashable
        raise ErrorEntrada(f"tipo_circuito inválido: {tipo!r}. Valores: {sorted(TIPOS_CIRCUITO)}.", campo="tipo_circuito")

    vano = positivo(entrada["vano_mm"], campo="vano_mm")
    reserva_pct = entrada["reserva_solicitada_pct"]
    pct_a_fraccion(reserva_pct, campo="reserva_solicitada_pct")  # valida rango

    usos = entrada["usos_cable"]
    if not isinstance(usos, list) or not usos:
        raise ErrorEntrada("usos_cable debe ser una lista no vacía.", campo="usos_cable")
    usos_norm = []
    for i, u in enumerate(usos):
        campo = f"usos_cable[{i}]"
        if not isinstance(u, dict):
            raise ErrorEntrada(f"{campo} debe ser un objeto.", campo=campo)
        extra = set(u) - CLAVES_USO
        if extra:
            raise ErrorEntrada(f"{campo}: claves desconocidas {sorted(extra)}.", campo=campo)
        for k in ("cable_id", "cantidad", "separado"):
            if k not in u:
                raise ErrorEntrada(f"{campo}: falta '{k}'.", campo=f"{campo}.{k}")
        if not isinstance(u["cable_id"], str):
            raise ErrorEntrada(f"{campo}.cable_id debe ser texto.", campo=f"{campo}.cable_id")
        cables.obtener(u["cable_id"])  # existe y tiene datos completos (validado al cargar)
        cantidad = entero_positivo(u["cantidad"], campo=f"{campo}.cantidad")
        if not isinstance(u["separado"], bool):
            raise ErrorEntrada(f"{campo}.separado debe ser true/false.", campo=f"{campo}.separado")
        apilado = u.get("apilado", False)
        if not isinstance(apilado, bool):
            raise ErrorEntrada(f"{campo}.apilado debe ser true/false.", campo=f"{campo}.apilado")
        usos_norm.append({"cable_id": u["cable_id"], "cantidad": cantidad, "separado": u["separado"], "apilado": apilado})

    familias = entrada.get("familias")
    if familias is not None:
        if not isinstance(familias, list) or not familias or not all(isinstance(f, str) for f in familias):
            raise ErrorEntrada("familias debe ser una lista no vacía de familia_id.", campo="familias")
        desconocidas = sorted(set(familias) - set(catalogo.familias))
        if desconocidas:
            raise ErrorEntrada(f"familia_id desconocidas: {desconocidas}.", campo="familias")
        familias = sorted(set(familias))

    criterio = entrada.get("criterio_reserva")
    if criterio is not None and criterio not in CRITERIOS_RESERVA:
        raise ErrorEntrada(f"criterio_reserva inválido: {criterio!r}. Valores: {sorted(CRITERIOS_RESERVA)}.",
                           campo="criterio_reserva")

    norm = {
        "tipo_circuito": tipo,
        "vano_mm": vano,
        "reserva_solicitada_pct": float(reserva_pct),
        "usos_cable": usos_norm,
    }
    if familias is not None:
        norm["familias"] = familias
    if criterio is not None:
        norm["criterio_reserva"] = criterio
    return norm


# ------------------------------------------------------------------------------------------- geometría por producto


def _referencias(p: Producto, dec: dict) -> tuple:
    if p.ancho_util_mm is not None:
        w_ref, base_w = p.ancho_util_mm, "util"
    elif dec["D-04_ancho_referencia"] == "util_si_existe_sino_nominal" and p.ancho_nominal_mm is not None:
        w_ref, base_w = p.ancho_nominal_mm, "nominal"
    else:
        w_ref, base_w = None, None
    if p.alto_util_mm is not None:
        h_ref, base_h = p.alto_util_mm, "util"
    elif dec["D-08_altura_referencia"] == "util_si_existe_sino_ala_nominal" and p.ala_nominal_mm is not None:
        h_ref, base_h = p.ala_nominal_mm, "ala_nominal"
    else:
        h_ref, base_h = None, None
    return w_ref, base_w, h_ref, base_h


def _geometria(p: Producto, disp: dict, r: float, criterio: str, dec: dict) -> dict:
    w_ref, base_w, h_ref, base_h = _referencias(p, dec)
    g = {"ancho_referencia_mm": w_ref, "base_ancho": base_w, "altura_referencia_mm": h_ref, "base_altura": base_h,
         "advertencias": []}
    if w_ref is None:
        g["estado"] = "NO_VERIFICABLE_SIN_ANCHO"
        return g
    if base_w == "nominal":
        g["advertencias"].append("Ancho útil no publicado: se usa el ancho nominal del catálogo (D-04).")
    res = evaluar_reserva(disp["ancho_ocupado_mm"], w_ref, r, criterio)
    g["reserva"] = res
    if not res["cabe"]:
        g["estado"] = "NO_CUMPLE_ANCHO"
        return g
    if not res["cumple"]:
        g["estado"] = "NO_CUMPLE_RESERVA"
        return g
    if h_ref is None:
        g["estado"] = "NO_VERIFICABLE_SIN_ALTURA"
        return g
    if base_h == "ala_nominal":
        g["advertencias"].append("Alto útil no publicado: se compara el diámetro con el ala nominal (D-08).")
    if disp["diametro_max_mm"] > h_ref + EPS:
        g["estado"] = "NO_CUMPLE_ALTURA"
        return g
    g["estado"] = "CUMPLE"
    return g


ESTADOS_CANDIDATO = (
    "APTA_GEOMETRIA_Y_MECANICA",   # medidas útiles publicadas + CTA documentada a la misma luz; sin condiciones
    "PRESELECCION_CONDICIONADA",   # no se detectó incumplimiento, pero hay condiciones (ver 'condiciones')
    "NO_APTA_MECANICA",
    "NO_VERIFICABLE_GEOMETRIA",
    "NO_APTA_GEOMETRIA",
)


def _estado_global(geo: dict, mec: dict) -> tuple[str, list[str]]:
    """Devuelve (estado, condiciones). APTA_GEOMETRIA_Y_MECANICA solo sin condiciones."""
    g = geo["estado"]
    if g != "CUMPLE":
        return ("NO_VERIFICABLE_GEOMETRIA" if g.startswith("NO_VERIFICABLE") else "NO_APTA_GEOMETRIA"), []
    m = mec["estado"]
    if m in ("VERIFICADA_NO_CUMPLE", "NO_CUMPLE_CONDICIONADO"):
        return "NO_APTA_MECANICA", ([f"CTA_{mec['base_evidencia'].upper()}"] if m == "NO_CUMPLE_CONDICIONADO" else [])
    condiciones = []
    if geo["base_ancho"] != "util":
        condiciones.append("ANCHO_NOMINAL_NO_UTIL")
    if geo["base_altura"] != "util":
        condiciones.append("ALTURA_ALA_NOMINAL_NO_UTIL")
    if m == "CUMPLE_CONDICIONADO":
        cond = f"CTA_{mec['base_evidencia'].upper()}"
        der = mec["registro"].get("derivacion")
        if der:
            cond += f":{der['derivacion_id']}"
        condiciones.append(cond)
    elif m != "VERIFICADA_CUMPLE":
        condiciones.append(f"MECANICA_{m}")
    return ("APTA_GEOMETRIA_Y_MECANICA" if not condiciones else "PRESELECCION_CONDICIONADA"), condiciones


# ------------------------------------------------------------------------------------------- cálculo principal


def calcular_sector(entrada: dict, cables: RegistroCables, catalogo: Catalogo, decisiones: dict) -> dict:
    norm = validar_entrada(entrada, cables, catalogo)
    dec = copy.deepcopy(decisiones)
    criterio = norm.get("criterio_reserva", dec["D-05_criterio_reserva"])
    origen_criterio = "entrada.criterio_reserva" if "criterio_reserva" in norm else "D-05 (valor por defecto)"

    resultado = {
        "motor": {"nombre": "motor_bandejas", "version": __version__, "metodos": METODOS},
        "huella": huella(entrada_normalizada=norm, version_cables=cables.version(),
                         version_catalogo=catalogo.version(), decisiones=dec, version_motor=__version__),
        "vigencia": "VIGENTE",
        "entrada": norm,
        "datos": {"cables": cables.version(), "catalogo": catalogo.procedencia()},
        "decisiones": {"version": dec.get("version_decisiones"), "valores": dec,
                       "criterio_reserva_aplicado": criterio, "origen_criterio_reserva": origen_criterio},
        "verificacion_electrica": {"estado": "NO_REALIZADA", "aviso": AVISO_ELECTRICO},
        "advertencias": [],
    }

    usos = []
    for u in norm["usos_cable"]:
        c = cables.obtener(u["cable_id"])
        if c.anomalia_fuente:
            resultado["advertencias"].append(f"{c.cable_id}: anomalía en la ficha de origen – {c.anomalia_fuente}")
        if u["separado"]:
            disp, dd = "separado", "D-01"
        else:
            disp, dd = dec["D-02_separado_desactivado_equivale_a"], "D-02"
        usos.append({"cable": c, "cantidad": u["cantidad"], "disposicion": disp, "apilado": u["apilado"],
                     "decision_disposicion": dd})

    resultado["masa_lineal"] = masa_lineal(usos)

    try:
        if norm["tipo_circuito"] != "potencia":
            raise NoSoportado("Circuitos de mando y señal: sin reglas de disposición/ocupación acordadas (D-11).",
                              decision_id="D-11", campo="tipo_circuito")
        disp = disposicion_una_capa(usos)
    except (PendienteDecision, NoSoportado) as e:
        resultado["estado_calculo"] = "BLOQUEADO"
        resultado["bloqueo"] = e.como_dict()
        resultado["candidatos"] = []
        resultado["resumen_por_linea"] = []
        return resultado

    resultado["disposicion"] = disp
    r = norm["reserva_solicitada_pct"] / 100.0
    q = resultado["masa_lineal"]["valor_kg_m"]

    familias = set(norm.get("familias") or [p.familia_id for p in catalogo.productos])
    candidatos = []
    for p in catalogo.productos:
        if p.familia_id not in familias:
            continue
        geo = _geometria(p, disp, r, criterio, dec)
        mec = evaluar_mecanica(p.producto_id, q, norm["vano_mm"], catalogo, dec["D-06_evidencias_carga_aceptadas"])
        candidatos.append({
            "producto_id": p.producto_id,
            "sku": p.sku,
            "familia_id": p.familia_id,
            "nombre_familia": p.nombre_familia,
            "tipo_constructivo": p.tipo_constructivo,
            "acabado_normalizado": p.acabado_normalizado,
            "ancho_nominal_mm": p.ancho_nominal_mm,
            "ala_nominal_mm": p.ala_nominal_mm,
            "espesor_chapa_mm": p.espesor_chapa_mm,
            "diametro_alambre_mm": p.diametro_alambre_mm,
            "procedencia": p.procedencia(),
            "geometria": geo,
            "mecanica": mec,
            "estado": None,
            "condiciones": [],
            "minimo_geometrico_de_linea": False,
            "minimo_sin_rechazo_de_linea": False,
            "minimo_apto_completo_de_linea": False,
        })
        candidatos[-1]["estado"], candidatos[-1]["condiciones"] = _estado_global(geo, mec)

    # Ancho mínimo por línea (familia + ala + espesor/alambre), sin decodificar códigos.
    lineas: dict[tuple, list[dict]] = {}
    for c in candidatos:
        clave = (c["familia_id"], c["ala_nominal_mm"], c["espesor_chapa_mm"], c["diametro_alambre_mm"])
        lineas.setdefault(clave, []).append(c)
    resumen = []
    for clave, cs in sorted(lineas.items(), key=lambda kv: tuple("" if x is None else str(x) for x in kv[0])):
        cs.sort(key=lambda c: c["geometria"]["ancho_referencia_mm"] or float("inf"))
        geo_ok = [c for c in cs if c["geometria"]["estado"] == "CUMPLE"]
        sin_rechazo = [c for c in geo_ok if c["estado"] in ("APTA_GEOMETRIA_Y_MECANICA", "PRESELECCION_CONDICIONADA")]
        completo = [c for c in geo_ok if c["estado"] == "APTA_GEOMETRIA_Y_MECANICA"]
        for lista, bandera in ((geo_ok, "minimo_geometrico_de_linea"), (sin_rechazo, "minimo_sin_rechazo_de_linea"),
                               (completo, "minimo_apto_completo_de_linea")):
            if lista:
                lista[0][bandera] = True
        resumen.append({
            "familia_id": clave[0], "ala_nominal_mm": clave[1], "espesor_chapa_mm": clave[2],
            "diametro_alambre_mm": clave[3],
            "minimo_geometrico": geo_ok[0]["producto_id"] if geo_ok else None,
            "mecanica_minimo_geometrico": geo_ok[0]["mecanica"]["estado"] if geo_ok else None,
            "minimo_sin_rechazo": sin_rechazo[0]["producto_id"] if sin_rechazo else None,
            "estado_minimo_sin_rechazo": sin_rechazo[0]["estado"] if sin_rechazo else None,
            "condiciones_minimo_sin_rechazo": sin_rechazo[0]["condiciones"] if sin_rechazo else None,
            "minimo_apto_completo": completo[0]["producto_id"] if completo else None,
        })

    orden = {e: i for i, e in enumerate(ESTADOS_CANDIDATO)}
    candidatos.sort(key=lambda c: (orden[c["estado"]], c["familia_id"], c["ala_nominal_mm"] or 0,
                                   c["espesor_chapa_mm"] or 0, c["geometria"]["ancho_referencia_mm"] or 0))
    resultado["estado_calculo"] = "CALCULADO"
    resultado["candidatos"] = candidatos
    resultado["resumen_por_linea"] = resumen
    return resultado


# ------------------------------------------------------------------------------------------- utilidades de carga

RAIZ = Path(__file__).resolve().parent.parent
RUTA_CABLES = RAIZ / "datos" / "cables" / "prysmian_sintenax_valio_2020.json"
RUTAS_CABLES_TODAS = (RUTA_CABLES, RAIZ / "datos" / "cables" / "prysmian_superastic_flex_2026.json")
RUTA_CATALOGO = RAIZ / "datos" / "catalogo" / "catalogo_bandejas_snapshot.json"
RUTA_DERIVADAS = RAIZ / "datos" / "catalogo" / "cargas_derivadas.json"
RUTA_DECISIONES = RAIZ / "datos" / "decisiones_producto.json"
RUTA_ESQUEMAS_ENSAYO = RAIZ / "datos" / "esquemas_ensayo.json"


def cargar_contexto(ruta_cables=RUTA_CABLES, ruta_catalogo=RUTA_CATALOGO, ruta_decisiones=RUTA_DECISIONES,
                    ruta_derivadas=RUTA_DERIVADAS):
    import json
    cables = RegistroCables.desde_archivos(ruta_cables)
    catalogo = Catalogo.desde_snapshot(ruta_catalogo, ruta_derivadas)
    decisiones = json.loads(Path(ruta_decisiones).read_text(encoding="utf-8"))
    return cables, catalogo, decisiones


def cargar_contexto_trazado(ruta_catalogo=RUTA_CATALOGO, ruta_decisiones=RUTA_DECISIONES,
                            ruta_derivadas=RUTA_DERIVADAS, rutas_cables=RUTAS_CABLES_TODAS,
                            ruta_esquemas=RUTA_ESQUEMAS_ENSAYO):
    """Contexto para trazados: todos los datasets de cables (incluye candidatos a PE) y los esquemas de ensayo.
    Los esquemas se agregan a las decisiones bajo 'esquemas_ensayo', de modo que forman parte de la huella."""
    import json
    cables = RegistroCables.desde_archivos(*rutas_cables)
    catalogo = Catalogo.desde_snapshot(ruta_catalogo, ruta_derivadas)
    decisiones = json.loads(Path(ruta_decisiones).read_text(encoding="utf-8"))
    decisiones["esquemas_ensayo"] = json.loads(Path(ruta_esquemas).read_text(encoding="utf-8"))["esquemas"]
    return cables, catalogo, decisiones


def resultado_vigente(resultado: dict, entrada: dict, cables: RegistroCables, catalogo: Catalogo,
                      decisiones: dict) -> bool:
    """True solo si el resultado fue calculado con exactamente estas entradas, datos, decisiones y motor."""
    if resultado is None or entrada is None:
        return False
    try:
        norm = validar_entrada(entrada, cables, catalogo)
    except ErrorMotor:
        return False
    return resultado.get("huella") == huella(
        entrada_normalizada=norm, version_cables=cables.version(), version_catalogo=catalogo.version(),
        decisiones=decisiones, version_motor=__version__)
