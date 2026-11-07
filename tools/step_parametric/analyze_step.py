"""Analiza los STEP de la carpeta de referencia SAMET y extrae geometría clave.

Para cada archivo:
  - hash SHA-256 del contenido binario.
  - metadatos del encabezado STEP (schema, autor, cad).
  - resumen de sólidos: cantidad, volumen, bbox global.
  - caras por tipo (planar, cilíndrica, cónica, toroidal, ...).
  - candidatos a boca: caras planares en los extremos del bbox cuyo normal
    sea paralelo a un eje principal. Se reporta centro, normal y "ancho
    aparente" (span mayor del rectángulo envolvente de la cara).

El objetivo NO es cerrar la identificación de bocas, solo dar material para
las reglas de los generadores. La asociación SKU ↔ catálogo se hace por
nombre de archivo y se registra en el JSON final para revisión.

Uso:
    python tools/step_parametric/analyze_step.py --src "<ruta read-only>" \
        --out tools/step_parametric/report

Unidades: los STEP de SAMET vienen en milímetros; verificado en encabezado.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.GeomAbs import (
    GeomAbs_Cone,
    GeomAbs_Cylinder,
    GeomAbs_Plane,
    GeomAbs_Sphere,
    GeomAbs_Torus,
    GeomAbs_BSplineSurface,
    GeomAbs_BezierSurface,
    GeomAbs_SurfaceOfExtrusion,
    GeomAbs_SurfaceOfRevolution,
    GeomAbs_OtherSurface,
)
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

SURFACE_KIND = {
    GeomAbs_Plane: "plane",
    GeomAbs_Cylinder: "cylinder",
    GeomAbs_Cone: "cone",
    GeomAbs_Sphere: "sphere",
    GeomAbs_Torus: "torus",
    GeomAbs_BSplineSurface: "bspline",
    GeomAbs_BezierSurface: "bezier",
    GeomAbs_SurfaceOfExtrusion: "extrusion",
    GeomAbs_SurfaceOfRevolution: "revolution",
    GeomAbs_OtherSurface: "other",
}


@dataclass
class FaceSummary:
    kind: str
    area_mm2: float
    bbox: list[float]  # [xmin, ymin, zmin, xmax, ymax, zmax]
    normal: list[float] | None = None  # solo para planar, en centroide
    center: list[float] | None = None


@dataclass
class PortCandidate:
    """Cara planar cuyo normal es (casi) paralelo a +X/-X/+Y/-Y/+Z/-Z global
    y que roza alguno de los extremos del bbox global del cuerpo."""

    axis: str  # '+x','-x','+y','-y','+z','-z'
    center: list[float]
    normal: list[float]
    bbox: list[float]
    extent_u_mm: float  # span mayor del rectángulo envolvente en el plano
    extent_v_mm: float  # span menor
    area_mm2: float


@dataclass
class SolidSummary:
    volume_mm3: float
    bbox: list[float]
    n_faces: int
    faces_by_kind: dict[str, int]
    port_candidates: list[PortCandidate] = field(default_factory=list)


@dataclass
class StepAnalysis:
    file: str
    sha256: str
    size_bytes: int
    header: dict[str, Any]
    unit_hint: str
    solid_count: int
    global_bbox: list[float]
    solids: list[SolidSummary]


def parse_header(text: str) -> dict[str, Any]:
    """Extrae campos de HEADER con regex liviana. No requiere parser STEP."""
    head = text.split("ENDSEC;", 1)[0]
    h: dict[str, Any] = {}
    m = re.search(r"FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'", head)
    if m:
        h["file_name"] = m.group(1)
        h["timestamp"] = m.group(2)
    m = re.search(r"'([A-Za-z]+\s*\d+(?:\.\d+)?)'[^#]*?'([^']+)'\s*,\s*''\s*\)\s*;\s*FILE_SCHEMA", head)
    # intento best-effort — detalle: usar el último par
    m2 = re.findall(r"'([^']*)'", head)
    if m2:
        h["header_strings"] = [s for s in m2 if s]
    sch = re.search(r"FILE_SCHEMA\s*\(\(\s*'([^']+)'", head)
    if sch:
        h["schema"] = sch.group(1)
    return h


def detect_unit(text: str) -> str:
    """Detecta unidad por heurística: si hay SI_UNIT(.MILLI., .METRE.) devolver mm."""
    if re.search(r"SI_UNIT\s*\(\s*\.MILLI\.?\s*,\s*\.METRE\.", text):
        return "mm"
    if re.search(r"SI_UNIT\s*\(\s*\$?\s*,\s*\.METRE\.", text):
        return "m"
    if "CONVERSION_BASED_UNIT" in text and "INCH" in text.upper():
        return "inch"
    return "unknown"


def _safe_face_center_normal(face: Any) -> tuple[list[float], list[float]] | None:
    """Devuelve (centro, normal) de una cara planar en coordenadas globales.
    Falla silenciosa (None) si no es planar o si la evaluación da error.
    """
    try:
        surf = BRepAdaptor_Surface(face, True)
        if surf.GetType() != GeomAbs_Plane:
            return None
        u0, u1 = surf.FirstUParameter(), surf.LastUParameter()
        v0, v1 = surf.FirstVParameter(), surf.LastVParameter()
        um = 0.5 * (u0 + u1)
        vm = 0.5 * (v0 + v1)
        p = surf.Value(um, vm)
        # normal
        plane = surf.Plane()
        d = plane.Axis().Direction()
        return [p.X(), p.Y(), p.Z()], [d.X(), d.Y(), d.Z()]
    except Exception:
        return None


def _face_bbox(face: Any) -> list[float]:
    """Bounding box de una cara individual."""
    wrapped = cq.Face(face)
    bb = wrapped.BoundingBox()
    return [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]


def _face_area(face: Any) -> float:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return props.Mass()


def _face_kind(face: Any) -> str:
    try:
        surf = BRepAdaptor_Surface(face, True)
        return SURFACE_KIND.get(surf.GetType(), "unknown")
    except Exception:
        return "unknown"


def _solid_volume(solid: Any) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(solid, props)
    return props.Mass()


def _solid_bbox(solid: Any) -> list[float]:
    wrapped = cq.Solid(solid)
    bb = wrapped.BoundingBox()
    return [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]


def _axis_match(normal: list[float], tol: float = 1e-3) -> str | None:
    """Clasifica un vector como +x/-x/+y/-y/+z/-z si está muy cerca de uno."""
    nx, ny, nz = normal
    magnitude = math.sqrt(nx * nx + ny * ny + nz * nz)
    if magnitude < 1e-9:
        return None
    nx, ny, nz = nx / magnitude, ny / magnitude, nz / magnitude
    for axis, vec in [
        ("+x", (1, 0, 0)),
        ("-x", (-1, 0, 0)),
        ("+y", (0, 1, 0)),
        ("-y", (0, -1, 0)),
        ("+z", (0, 0, 1)),
        ("-z", (0, 0, -1)),
    ]:
        dot = nx * vec[0] + ny * vec[1] + nz * vec[2]
        if abs(dot - 1.0) < tol:
            return axis
    return None


def _port_candidates(faces_info: list[tuple[list[float], list[float], list[float], float, str]],
                     solid_bbox: list[float]) -> list[PortCandidate]:
    """De una lista de caras planares (centro, normal, bbox, area, kind), seleccionar
    las que su centro está en un extremo del bbox global en la dirección del normal."""
    xmin, ymin, zmin, xmax, ymax, zmax = solid_bbox
    cands: list[PortCandidate] = []
    extent_tol = 0.5  # mm — la cara debe estar a <= 0.5 mm del extremo
    for center, normal, bbox, area, kind in faces_info:
        if kind != "plane":
            continue
        axis = _axis_match(normal)
        if axis is None:
            continue
        cx, cy, cz = center
        hit = False
        if axis == "+x" and abs(cx - xmax) < extent_tol:
            hit = True
        elif axis == "-x" and abs(cx - xmin) < extent_tol:
            hit = True
        elif axis == "+y" and abs(cy - ymax) < extent_tol:
            hit = True
        elif axis == "-y" and abs(cy - ymin) < extent_tol:
            hit = True
        elif axis == "+z" and abs(cz - zmax) < extent_tol:
            hit = True
        elif axis == "-z" and abs(cz - zmin) < extent_tol:
            hit = True
        if not hit:
            continue
        # extent u/v: span mayor y menor del rectángulo envolvente
        dx, dy, dz = bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]
        spans = sorted([dx, dy, dz])
        extent_v = spans[1]
        extent_u = spans[2]
        cands.append(
            PortCandidate(
                axis=axis,
                center=center,
                normal=normal,
                bbox=bbox,
                extent_u_mm=extent_u,
                extent_v_mm=extent_v,
                area_mm2=area,
            )
        )
    return cands


def analyze_file(path: Path) -> StepAnalysis:
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    text = raw.decode("latin-1", errors="replace")
    header = parse_header(text)
    unit = detect_unit(text)

    # Cargar con cadquery.
    assy = cq.importers.importStep(str(path))
    # importStep devuelve un Workplane con los sólidos apilados.
    solids = assy.solids().vals()

    global_bb = [math.inf, math.inf, math.inf, -math.inf, -math.inf, -math.inf]
    summaries: list[SolidSummary] = []

    for sol in solids:
        shape = sol.wrapped if hasattr(sol, "wrapped") else sol
        bb = _solid_bbox(shape)
        global_bb = [
            min(global_bb[0], bb[0]), min(global_bb[1], bb[1]), min(global_bb[2], bb[2]),
            max(global_bb[3], bb[3]), max(global_bb[4], bb[4]), max(global_bb[5], bb[5]),
        ]

        faces_info: list[tuple[list[float], list[float], list[float], float, str]] = []
        kinds: dict[str, int] = {}
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        n_faces = 0
        while exp.More():
            f = TopoDS.Face_s(exp.Current())
            n_faces += 1
            kind = _face_kind(f)
            kinds[kind] = kinds.get(kind, 0) + 1
            cn = _safe_face_center_normal(f)
            area = _face_area(f)
            fbb = _face_bbox(f)
            center = cn[0] if cn else [math.nan, math.nan, math.nan]
            normal = cn[1] if cn else [math.nan, math.nan, math.nan]
            faces_info.append((center, normal, fbb, area, kind))
            exp.Next()

        ports = _port_candidates(faces_info, bb)
        summaries.append(
            SolidSummary(
                volume_mm3=_solid_volume(shape),
                bbox=bb,
                n_faces=n_faces,
                faces_by_kind=kinds,
                port_candidates=ports,
            )
        )

    return StepAnalysis(
        file=path.name,
        sha256=sha,
        size_bytes=len(raw),
        header=header,
        unit_hint=unit,
        solid_count=len(solids),
        global_bbox=global_bb,
        solids=summaries,
    )


def _as_dict(obj: Any) -> Any:
    if hasattr(obj, "__dataclass_fields__"):
        d = asdict(obj)
        return d
    return obj


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, help="Carpeta read-only con los STEP")
    parser.add_argument("--out", required=True, help="Directorio para el reporte JSON")
    args = parser.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    found: dict[str, Path] = {}
    for pat in ("*.STEP", "*.stp", "*.step"):
        for p in src.glob(pat):
            found[p.name.lower()] = p
    files = sorted(found.values(), key=lambda p: p.name.lower())
    if not files:
        print(f"[analyze_step] no se encontraron STEP en {src}", file=sys.stderr)
        return 2

    all_reports: list[dict[str, Any]] = []
    for p in files:
        print(f"[analyze_step] {p.name} ...", flush=True)
        rep = analyze_file(p)
        rep_d = _as_dict(rep)
        all_reports.append(rep_d)
        (out / f"{p.stem}.json").write_text(json.dumps(rep_d, indent=2, default=str), encoding="utf-8")

    (out / "inventory.json").write_text(json.dumps(all_reports, indent=2, default=str), encoding="utf-8")
    print(f"[analyze_step] escritos {len(all_reports)} análisis en {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
