"""Extrae el polígono de la cara superior (+Y a y=max) de cada STEP de escalera.

Aporta: outline 2D (XZ) ordenado, trasladado al origen local (minX=0, minZ=0),
y la lista de aristas candidatas a boca (las que caen en los bordes del
bbox local y son colineales con un eje principal).

Uso:
    python tools/step_parametric/extract_outlines.py --src <dir> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Line, GeomAbs_Plane
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_WIRE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS


def _face_plane_normal(face):
    try:
        surf = BRepAdaptor_Surface(face, True)
        if surf.GetType() != GeomAbs_Plane:
            return None
        pl = surf.Plane()
        d = pl.Axis().Direction()
        return [d.X(), d.Y(), d.Z()]
    except Exception:
        return None


def _face_vertices(face):
    """Devuelve (lista de vértices únicos, origen, lista de aristas como (i0,i1))."""
    outer = BRepTools.OuterWire_s(face)
    exp = TopExp_Explorer(outer, TopAbs_EDGE)
    pts = []
    edges = []
    seen = {}

    def key(p):
        return (round(p[0], 3), round(p[1], 3), round(p[2], 3))

    while exp.More():
        edge = TopoDS.Edge_s(exp.Current())
        crv = BRepAdaptor_Curve(edge)
        if crv.GetType() != GeomAbs_Line:
            # discard: curved edge (cannot linearize simply)
            exp.Next()
            continue
        p1 = crv.Value(crv.FirstParameter())
        p2 = crv.Value(crv.LastParameter())
        a = [p1.X(), p1.Y(), p1.Z()]
        b = [p2.X(), p2.Y(), p2.Z()]
        ka, kb = key(a), key(b)
        if ka not in seen:
            seen[ka] = len(pts)
            pts.append(a)
        if kb not in seen:
            seen[kb] = len(pts)
            pts.append(b)
        edges.append((seen[ka], seen[kb]))
        exp.Next()
    return pts, edges


def _order_polygon(pts, edges):
    """Reconstruye un ciclo de vértices siguiendo las aristas."""
    adj = {}
    for a, b in edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    # start from the vertex with minimum (x,z)
    def score(i):
        return (pts[i][0], pts[i][2])
    start = min(adj.keys(), key=score)
    order = [start]
    visited = {start}
    prev = None
    while True:
        nexts = [n for n in adj[order[-1]] if n != prev and n not in visited]
        if not nexts:
            nexts = [n for n in adj[order[-1]] if n != prev]
        if not nexts:
            break
        # pick the neighbor forming the convex-ccw cycle; for rectangles with
        # two choices, both work — prefer the smaller-angle turn.
        choice = nexts[0]
        prev = order[-1]
        order.append(choice)
        if choice == start:
            order.pop()  # remove duplicate start
            break
        visited.add(choice)
        if len(order) > len(pts) + 1:
            break
    return order


def _polygon_signed_area(poly):
    """Área firmada en XZ (ignora Y)."""
    s = 0.0
    n = len(poly)
    for i in range(n):
        x1, _, z1 = poly[i]
        x2, _, z2 = poly[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return 0.5 * s


def extract_top_outline(path: Path):
    assy = cq.importers.importStep(str(path))
    solids = assy.solids().vals()
    if not solids:
        return None
    sol = solids[0]
    shape = sol.wrapped if hasattr(sol, "wrapped") else sol

    # bbox
    bb = cq.Solid(shape).BoundingBox()
    ymax = bb.ymax

    exp = TopExp_Explorer(shape, TopAbs_FACE)
    best = None
    best_area = -1
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        normal = _face_plane_normal(f)
        if normal is None:
            exp.Next()
            continue
        fy = normal[1]
        if abs(fy - 1.0) < 1e-3:  # +Y
            # must lie at y ≈ ymax
            fbb = cq.Face(f).BoundingBox()
            if abs(fbb.ymax - ymax) < 1e-3 and abs(fbb.ymin - ymax) < 1e-3:
                area = cq.Face(f).Area()
                if area > best_area:
                    best_area = area
                    best = f
        exp.Next()
    if best is None:
        return None

    pts, edges = _face_vertices(best)
    if not pts:
        return None

    order = _order_polygon(pts, edges)
    polygon_global = [pts[i] for i in order]

    # orient CCW in XZ plane
    if _polygon_signed_area(polygon_global) < 0:
        polygon_global = list(reversed(polygon_global))

    # local polygon: minX=0, minZ=0
    minx = min(p[0] for p in polygon_global)
    minz = min(p[2] for p in polygon_global)
    local = [[round(p[0] - minx, 3), round(p[2] - minz, 3)] for p in polygon_global]

    bbox_local = {
        "x_max": round(max(p[0] for p in local), 3),
        "z_max": round(max(p[1] for p in local), 3),
        "y_height_mm": round(bb.ymax - bb.ymin, 3),
    }

    # port edges: edges of local polygon that lie flat on bbox extremes
    edges_summary = []
    n = len(local)
    for i in range(n):
        a = local[i]
        b = local[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        if length < 1e-6:
            continue
        nx, nz = dz / length, -dx / length  # outward normal for CCW
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        boundary = None
        if abs(a[0]) < 0.5 and abs(b[0]) < 0.5:
            boundary = "x_min"
        elif abs(a[0] - bbox_local["x_max"]) < 0.5 and abs(b[0] - bbox_local["x_max"]) < 0.5:
            boundary = "x_max"
        elif abs(a[1]) < 0.5 and abs(b[1]) < 0.5:
            boundary = "z_min"
        elif abs(a[1] - bbox_local["z_max"]) < 0.5 and abs(b[1] - bbox_local["z_max"]) < 0.5:
            boundary = "z_max"
        axis_aligned = abs(dx) < 1e-3 or abs(dz) < 1e-3
        edges_summary.append({
            "i": i,
            "a": a,
            "b": b,
            "length_mm": round(length, 3),
            "midpoint": [round(mx, 3), round(mz, 3)],
            "outward_normal": [round(nx, 3), round(nz, 3)],
            "boundary": boundary,
            "axis_aligned": axis_aligned,
        })

    return {
        "file": path.name,
        "bbox_local": bbox_local,
        "n_vertices": len(local),
        "polygon_xz_mm": local,
        "edges": edges_summary,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    files = sorted(list(src.glob("*.STEP")) + list(src.glob("*.step")) + list(src.glob("*.stp")), key=lambda p: p.name.lower())
    results = []
    for p in files:
        print(f"[extract] {p.name} ...", flush=True)
        try:
            r = extract_top_outline(p)
        except Exception as e:
            r = {"file": p.name, "error": str(e)}
        if r:
            results.append(r)
            (out / f"{p.stem}__outline.json").write_text(
                json.dumps(r, indent=2), encoding="utf-8"
            )
    (out / "outlines.inventory.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"[extract] {len(results)} outlines → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
