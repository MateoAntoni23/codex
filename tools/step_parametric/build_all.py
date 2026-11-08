"""Orquestador: analiza los STEP originales, construye reconstrucciones
paramétricas y variantes de otros anchos, y exporta todo a STEP + GLB.

Entradas
--------
- `--src <dir>`: carpeta con los STEP originales (read-only).
- `--analysis <dir>`: salida previa de `analyze_step.py` (JSON por SKU).
- `--out <dir>`: carpeta destino para `originals_glb/`, `reconstructions/`
  y `variants/`.

Salida
------
- GLB de cada original (convertido con cadquery → Assembly.save).
- STEP y GLB de cada reconstrucción paramétrica.
- STEP y GLB de una variante de ancho distinto por SKU.
- `fidelity.json` + `fidelity.md` con la comparación bbox/volumen vs el original.

No sobreescribe archivos originales. Si el destino existe, se regeneran los
derivados.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import cadquery as cq

from generators import (
    common,
    tramo_recto,
    curva_horizontal,
    curva_vertical,
    derivacion_lateral,
    cruz,
)


# --- Catálogo de SKUs reconstruibles ---------------------------------------
# mapea nombre de archivo original -> (generador, kwargs extra, param default,
# variante para probar el cambio paramétrico). No se declaran SKUs comerciales
# nuevos: la "variante" solo prueba la regla; se marca como experimental.
#
# Nota sobre ala_mm=65: estos valores reproducen la ENVOLVENTE medida en los
# STEP aportados (bbox Y = 65 mm). El catálogo SAMET para la familia SAM-STP-Z
# publica ala = 50 mm y es el valor que usa el editor operativo (ver
# `src/parametric/catalog.ts`). Este pipeline de reconstrucción comparativa
# conserva 65 para que las métricas de fidelidad vs el STEP de referencia sean
# significativas; no es un valor comercial.
RECIPES: dict[str, dict[str, Any]] = {
    "TRPS-300-22-Z.STEP": {
        "piece_kind": "tramo_recto",
        "default_params": dict(ancho_mm=300, ala_mm=65, longitud_mm=3000.0, espesor_mm=0.71),
        "variant_params": dict(ancho_mm=450, ala_mm=65, longitud_mm=3000.0, espesor_mm=0.71),
        "builder": lambda p, analysis: tramo_recto.build(p),
    },
    "CPS-300-45-Z.STEP": {
        "piece_kind": "curva_horizontal",
        "default_params": dict(ancho_mm=300, ala_mm=65, espesor_mm=0.71, angulo_deg=45.0),
        "variant_params": dict(ancho_mm=450, ala_mm=65, espesor_mm=0.71, angulo_deg=45.0),
        "builder": lambda p, analysis: curva_horizontal.build(
            p,
            step_bbox_span_mm=_global_span_x(analysis),
            step_bbox_z_mm=_global_span_z(analysis),
        ),
    },
    "CPS-300-90-Z.STEP": {
        "piece_kind": "curva_horizontal",
        "default_params": dict(ancho_mm=300, ala_mm=65, espesor_mm=0.71, angulo_deg=90.0),
        "variant_params": dict(ancho_mm=450, ala_mm=65, espesor_mm=0.71, angulo_deg=90.0),
        "builder": lambda p, analysis: curva_horizontal.build(
            p,
            step_bbox_span_mm=_global_span_x(analysis),
            step_bbox_z_mm=_global_span_z(analysis),
        ),
    },
    "CUPS-300-A-Z.STEP": {
        "piece_kind": "curva_vertical",
        "default_params": dict(ancho_mm=300, ala_mm=65, espesor_mm=0.71, angulo_vertical_deg=90.0),
        "variant_params": dict(ancho_mm=450, ala_mm=65, espesor_mm=0.71, angulo_vertical_deg=90.0),
        "builder": lambda p, analysis: curva_vertical.build(
            p, step_bbox_y_mm=_global_span_y(analysis), step_bbox_x_mm=_global_span_x(analysis)
        ),
    },
    "DCPS-300-Z.STEP": {
        # IDENTIFICACIÓN EN REVISIÓN: el polígono medido en este STEP es
        # simétrico en X (los chaflanes v1↔v6, v2↔v5 están especulares). Un
        # DCPS SAMET es asimétrico (derivación común); una T simétrica
        # corresponde a TPS. El archivo se nombra "DCPS-300-Z.STEP" pero la
        # forma observada es compatible con TPS. Mantenemos el piece_kind
        # 'derivacion_lateral' y la trayectoria del archivo original hasta
        # contrastar con el maestro oficial SAMET — no afectar BOM.
        "piece_kind": "derivacion_lateral",
        "default_params": dict(ancho_mm=300, ala_mm=65, espesor_mm=0.71),
        "variant_params": dict(ancho_mm=450, ala_mm=65, espesor_mm=0.71),
        "builder": lambda p, analysis: derivacion_lateral.build(
            p,
            step_bbox_x_mm=_global_span_x(analysis),
            # Overhang = bbox_z del original − ancho original (fijo, no depende
            # de la variante de ancho).
            overhang_z_mm=_global_span_z(analysis) - 300.0,
        ),
    },
    "XPS-300-Z.STEP": {
        "piece_kind": "cruz",
        "default_params": dict(ancho_mm=300, ala_mm=65, espesor_mm=0.71),
        "variant_params": dict(ancho_mm=450, ala_mm=65, espesor_mm=0.71),
        "builder": lambda p, analysis: cruz.build(
            p, step_bbox_xz_mm=_global_span_x(analysis)
        ),
    },
}


def _global_span_x(analysis: dict[str, Any]) -> float:
    bb = analysis["global_bbox"]
    return bb[3] - bb[0]


def _global_span_y(analysis: dict[str, Any]) -> float:
    bb = analysis["global_bbox"]
    return bb[4] - bb[1]


def _global_span_z(analysis: dict[str, Any]) -> float:
    bb = analysis["global_bbox"]
    return bb[5] - bb[2]


def _bbox_of_solid(sh: Any) -> list[float]:
    s = sh.val() if hasattr(sh, "val") else sh
    bb = s.BoundingBox()
    return [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]


def _vol_of_solid(sh: Any) -> float:
    s = sh.val() if hasattr(sh, "val") else sh
    return s.Volume()


def _compare_to_original(reconstruction: cq.Workplane, analysis: dict[str, Any]) -> dict[str, Any]:
    """Compara la reconstrucción contra el STEP original sobre bbox y volumen.

    Las bboxes del STEP están en coordenadas absolutas del archivo; las del
    generador están en coordenadas locales. Para comparar, usamos los SPANS
    (dimensiones), no las posiciones absolutas.
    """
    rbb = _bbox_of_solid(reconstruction)
    rvol = _vol_of_solid(reconstruction)
    r_dx, r_dy, r_dz = rbb[3] - rbb[0], rbb[4] - rbb[1], rbb[5] - rbb[2]

    o_bb = analysis["global_bbox"]
    o_dx = o_bb[3] - o_bb[0]
    o_dy = o_bb[4] - o_bb[1]
    o_dz = o_bb[5] - o_bb[2]
    o_vol = sum(s["volume_mm3"] for s in analysis["solids"])

    def pct(a: float, b: float) -> float:
        return 100.0 * (a - b) / b if b else float("nan")

    return {
        "span_original": {"dx": o_dx, "dy": o_dy, "dz": o_dz},
        "span_reconstruction": {"dx": r_dx, "dy": r_dy, "dz": r_dz},
        "span_delta_mm": {"dx": r_dx - o_dx, "dy": r_dy - o_dy, "dz": r_dz - o_dz},
        "span_delta_pct": {"dx": pct(r_dx, o_dx), "dy": pct(r_dy, o_dy), "dz": pct(r_dz, o_dz)},
        "volume_original_mm3": o_vol,
        "volume_reconstruction_mm3": rvol,
        "volume_delta_pct": pct(rvol, o_vol),
    }


def _export_step(path: Path, wp: cq.Workplane) -> None:
    cq.exporters.export(wp, str(path), exportType="STEP")


def _export_glb(path: Path, wp: cq.Workplane, name: str) -> None:
    """Exporta GLB usando Assembly.save (GLTF binario)."""
    assy = cq.Assembly(name=name + "_root")
    assy.add(wp, name=name)
    # Assembly.save con GLTF usa tolerancias para teselar; valores
    # finos => muchas caras; razonables para visualización web.
    assy.save(str(path), exportType="GLTF", tolerance=0.5, angularTolerance=0.2)


def _export_originals_glb(src_dir: Path, out_dir: Path) -> dict[str, dict[str, Any]]:
    """Convierte cada STEP original a GLB en `out_dir`. Devuelve metadata."""
    out_dir.mkdir(parents=True, exist_ok=True)
    seen: dict[str, Path] = {}
    for pat in ("*.STEP", "*.stp", "*.step"):
        for p in src_dir.glob(pat):
            seen[p.name.lower()] = p
    meta: dict[str, dict[str, Any]] = {}
    for key, path in sorted(seen.items()):
        print(f"[originals>glb] {path.name}", flush=True)
        wp = cq.importers.importStep(str(path))
        dest = out_dir / (path.stem + ".glb")
        _export_glb(dest, wp, path.stem)
        bb = _bbox_of_solid(wp)
        meta[path.name] = {
            "glb": str(dest.relative_to(out_dir.parent.parent)) if dest.is_absolute() else str(dest),
            "bbox": bb,
            "volume_mm3": _vol_of_solid(wp),
        }
    return meta


def _build_and_export(
    recipe_key: str,
    recipe: dict[str, Any],
    analysis: dict[str, Any],
    recon_dir: Path,
    var_dir: Path,
) -> dict[str, Any]:
    print(f"[build] {recipe_key} ...", flush=True)
    params_default = common.PieceParams(**recipe["default_params"])
    params_variant = common.PieceParams(**recipe["variant_params"])

    build_default = recipe["builder"](params_default, analysis)
    build_variant = recipe["builder"](params_variant, analysis)

    stem_default = recipe_key.replace(".STEP", "")
    stem_variant = stem_default.replace(
        "{:03d}".format(int(recipe["default_params"]["ancho_mm"])),
        "{:03d}".format(int(recipe["variant_params"]["ancho_mm"])),
    )
    # Si el reemplazo no sucedió (ej. XPS-300-Z con el 300 en lugar fijo), caer
    # a un sufijo explícito.
    if stem_variant == stem_default:
        stem_variant = (
            stem_default
            + "__VARIANTE_ancho{:d}".format(int(recipe["variant_params"]["ancho_mm"]))
        )

    recon_step = recon_dir / (stem_default + "__recon.step")
    recon_glb = recon_dir / (stem_default + "__recon.glb")
    var_step = var_dir / (stem_variant + "__variante.step")
    var_glb = var_dir / (stem_variant + "__variante.glb")

    _export_step(recon_step, build_default.workplane)
    _export_glb(recon_glb, build_default.workplane, stem_default + "__recon")
    _export_step(var_step, build_variant.workplane)
    _export_glb(var_glb, build_variant.workplane, stem_variant + "__variante")

    fidelity = _compare_to_original(build_default.workplane, analysis)

    return {
        "recipe": recipe_key,
        "piece_kind": recipe["piece_kind"],
        "params_default": recipe["default_params"],
        "params_variant": recipe["variant_params"],
        "ports_default": [asdict(p) for p in build_default.ports],
        "ports_variant": [asdict(p) for p in build_variant.ports],
        "sku_logico_default": build_default.sku_logico,
        "sku_logico_variant": build_variant.sku_logico,
        "notes_default": build_default.notes,
        "notes_variant": build_variant.notes,
        "exports": {
            "recon_step": str(recon_step),
            "recon_glb": str(recon_glb),
            "variant_step": str(var_step),
            "variant_glb": str(var_glb),
        },
        "fidelity": fidelity,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True)
    ap.add_argument("--analysis", required=True, help="Directorio con JSON de analyze_step.py")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src = Path(args.src)
    analysis_dir = Path(args.analysis)
    out = Path(args.out)
    originals_glb = out / "originals_glb"
    recon_dir = out / "reconstructions"
    var_dir = out / "variants"
    recon_dir.mkdir(parents=True, exist_ok=True)
    var_dir.mkdir(parents=True, exist_ok=True)

    # 1) Convertir originales a GLB para la vista piloto.
    originals_meta = _export_originals_glb(src, originals_glb)

    # 2) Reconstrucciones + variantes por SKU.
    results: list[dict[str, Any]] = []
    for key, recipe in RECIPES.items():
        analysis_path = analysis_dir / (key.replace(".STEP", ".json"))
        if not analysis_path.exists():
            print(f"[build] SALTEADO: no se encontró {analysis_path}", file=sys.stderr)
            continue
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        try:
            r = _build_and_export(key, recipe, analysis, recon_dir, var_dir)
            results.append(r)
        except Exception as exc:
            import traceback
            tb = traceback.format_exc()
            print(f"[build] ERROR en {key}: {exc}\n{tb}", file=sys.stderr)
            results.append({"recipe": key, "error": f"{exc}\n{tb}"})

    fidelity_path = out / "fidelity.json"
    fidelity_path.write_text(
        json.dumps(
            {"originals": originals_meta, "results": results},
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    md = _render_markdown(originals_meta, results)
    (out / "fidelity.md").write_text(md, encoding="utf-8")
    print(f"[build] escritos resultados en {out}")
    return 0


def _render_markdown(originals: dict[str, Any], results: list[dict[str, Any]]) -> str:
    lines = [
        "# Fidelidad reconstrucción paramétrica vs STEP original",
        "",
        "Tabla de dimensiones envolvente (SPAN) y volumen.",
        "",
        "| Archivo | dx (orig / recon / Δ%) | dy (orig / recon / Δ%) | dz (orig / recon / Δ%) | vol (orig / recon / Δ%) |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        if "error" in r:
            lines.append(f"| {r['recipe']} | ERROR | ERROR | ERROR | {r['error']} |")
            continue
        f = r["fidelity"]
        so = f["span_original"]
        sr = f["span_reconstruction"]
        sp = f["span_delta_pct"]
        vo = f["volume_original_mm3"]
        vr = f["volume_reconstruction_mm3"]
        vp = f["volume_delta_pct"]
        lines.append(
            "| {rec} | {ox:.1f} / {rx:.1f} / {px:+.2f}% | {oy:.1f} / {ry:.1f} / {py:+.2f}% | {oz:.1f} / {rz:.1f} / {pz:+.2f}% | {vo:.0f} / {vr:.0f} / {vp:+.2f}% |".format(
                rec=r["recipe"],
                ox=so["dx"], rx=sr["dx"], px=sp["dx"],
                oy=so["dy"], ry=sr["dy"], py=sp["dy"],
                oz=so["dz"], rz=sr["dz"], pz=sp["dz"],
                vo=vo, vr=vr, vp=vp,
            )
        )
    lines.append("")
    lines.append("## Notas de los generadores")
    for r in results:
        if "error" in r:
            continue
        lines.append(f"### {r['recipe']} ({r['piece_kind']})")
        for n in r["notes_default"]:
            lines.append(f"- {n}")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
