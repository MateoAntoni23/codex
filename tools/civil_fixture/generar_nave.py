"""Nave de ejemplo para la parte civil (fixture de pruebas), generada con CadQuery.

Uso:  python tools/civil_fixture/generar_nave.py [carpeta_salida]
      (por defecto e2e/fixtures/civil)

Un archivo por piso y por tipo, como los importa el operador. Todos en el MISMO
sistema de coordenadas (mm, Z vertical): ensamblan solos.

  Planta: 24 m × 12 m; grilla de columnas cada 6 m (5 × 3 = 15 columnas).
  PB (cota 0):     columnas 300×300, 0 → 6000; vigas 300×500 arriba (5500 → 6000);
                   muros perimetrales de 200 mm, 0 → 6000, con un portón de 4 m.
  P1 (cota 6000):  losa de 200 mm (6000 → 6200); columnas 300×300, 6200 → 10200;
                   vigas 300×500 (9700 → 10200).

Variantes para las pruebas:
  PB-columnas-yup.stp  las mismas columnas exportadas con el eje Y como vertical
                       (como suele exportar SolidWorks): la altura queda en Y.
  PB-columnas-v2.stp   segunda versión de las columnas: una fila más (y = 18000),
                       para probar REEMPLAZAR conservando tipo, nivel y posición.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cadquery as cq

LARGO = 24000  # x
ANCHO = 12000  # y
PASO = 6000
COL = 300
VIGA_B, VIGA_H = 300, 500
MURO = 200
H_PB = 6000
LOSA = 200
H_P1 = 4000


def caja(x0, y0, z0, dx, dy, dz) -> cq.Workplane:
    return cq.Workplane('XY').box(dx, dy, dz, centered=False).translate((x0, y0, z0))


def unir(partes: list[cq.Workplane]) -> cq.Assembly:
    """Sólidos separados (uno por elemento) en un mismo archivo, como un ensamble exportado."""
    a = cq.Assembly()
    for i, p in enumerate(partes):
        a.add(p, name=f'e{i}')
    return a


def grilla_columnas(z0: float, h: float, filas_y: list[float]) -> list[cq.Workplane]:
    return [caja(x - COL / 2, y - COL / 2, z0, COL, COL, h)
            for x in range(0, LARGO + 1, PASO) for y in filas_y]


def vigas(z_tope: float) -> list[cq.Workplane]:
    z0 = z_tope - VIGA_H
    out = [caja(0, y - VIGA_B / 2, z0, LARGO, VIGA_B, VIGA_H) for y in range(0, ANCHO + 1, PASO)]
    out += [caja(x - VIGA_B / 2, 0, z0, VIGA_B, ANCHO, VIGA_H) for x in range(0, LARGO + 1, PASO)]
    return out


def muros() -> list[cq.Workplane]:
    porton = 4000
    sur = [caja(0, -MURO, 0, (LARGO - porton) / 2, MURO, H_PB),
           caja((LARGO + porton) / 2, -MURO, 0, (LARGO - porton) / 2, MURO, H_PB)]
    return sur + [
        caja(0, ANCHO, 0, LARGO, MURO, H_PB),
        caja(-MURO, -MURO, 0, MURO, ANCHO + 2 * MURO, H_PB),
        caja(LARGO, -MURO, 0, MURO, ANCHO + 2 * MURO, H_PB),
    ]


def exportar(partes: list[cq.Workplane], ruta: Path, y_vertical: bool = False) -> None:
    a = unir(partes)
    if y_vertical:
        # Z del modelo → Y del archivo (rotación −90° alrededor de X): la altura queda en Y.
        a = cq.Assembly(a.toCompound().rotate((0, 0, 0), (1, 0, 0), -90))
    a.save(str(ruta), exportType='STEP')


def main(salida: Path) -> None:
    salida.mkdir(parents=True, exist_ok=True)
    filas = list(range(0, ANCHO + 1, PASO))
    exportar(grilla_columnas(0, H_PB, filas), salida / 'PB-columnas.stp')
    exportar(vigas(H_PB), salida / 'PB-vigas.stp')
    exportar(muros(), salida / 'PB-muros.stp')
    exportar([caja(0, 0, H_PB, LARGO, ANCHO, LOSA)], salida / 'P1-losa.stp')
    exportar(grilla_columnas(H_PB + LOSA, H_P1, filas), salida / 'P1-columnas.stp')
    exportar(vigas(H_PB + LOSA + H_P1), salida / 'P1-vigas.stp')
    exportar(grilla_columnas(0, H_PB, filas), salida / 'PB-columnas-yup.stp', y_vertical=True)
    exportar(grilla_columnas(0, H_PB, filas + [ANCHO + PASO]), salida / 'PB-columnas-v2.stp')
    (salida / 'no-es-step.stp').write_text('esto no es un STEP\n', encoding='utf-8')
    for f in sorted(salida.iterdir()):
        print(f'{f.name}: {f.stat().st_size} bytes')


if __name__ == '__main__':
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'e2e' / 'fixtures' / 'civil')
