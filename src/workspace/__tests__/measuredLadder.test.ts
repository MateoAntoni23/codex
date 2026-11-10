import { describe, expect, it } from 'vitest';
import {
  TRES_300_065_18_Z,
  CS_300_90_065_18_Z,
  RIS_15_065_18_Z,
} from '../../parametric/geometry/escaleraOutlines';
import {
  alignOutlineToPorts,
  outlinePointToWorld,
  segmentRailsFromOutline,
  polylineLengthMm,
} from '../measuredLadder';

type Port = { posicion_mm: [number, number, number]; direccion: [number, number, number] };

describe('alignOutlineToPorts — recto TRES-300', () => {
  it('coloca P1 en el origen con dirección -X y verifica P2 a 3000 mm en +X', () => {
    // Un recto orientado con P1 mirando a -X y P2 a 3000 mm en +X.
    const P1: Port = { posicion_mm: [0, 0, 100], direccion: [-1, 0, 0] };
    const P2: Port = { posicion_mm: [3000, 0, 100], direccion: [1, 0, 0] };
    const placement = alignOutlineToPorts(TRES_300_065_18_Z, { P1, P2 });
    expect(placement).not.toBeNull();
    if (!placement) return;
    expect(placement.p2PosErrorMm ?? 0).toBeLessThan(2);
    expect(placement.p2DirErrorDeg ?? 0).toBeLessThan(1);
    // El origen (punto local 0,0) debe caer en el borde de la pieza, a mitad
    // de ala por debajo del puerto P1 (Y_local=0).
    expect(placement.originMm[2]).toBeCloseTo(100 - 65 / 2, 3);
  });
});

describe('alignOutlineToPorts — curva CS-300-90', () => {
  it('coloca el polígono mitreado con P1 y P2 ortogonales', () => {
    // CS-300-90: P1 en z_min (apunta -Z local), P2 en x_min (apunta -X local).
    // En mundo: P1 a 200,200,100 con dir -Y; P2 debe estar a 200-577.58, 200+577.58+... en dir -X.
    // Para construir un caso consistente derivamos P2 de la geometría medida.
    const P1: Port = { posicion_mm: [500, 500, 100], direccion: [-1, 0, 0] };
    // P1 outward normal local = (0,-1), queremos que mapee a (-1,0,0) en mundo.
    // P2 outward normal local = (-1,0), debería mapear a (0,-1,0) (90° a la derecha).
    // Derivamos la posición esperada de P2:
    // mid P1 local = (577.62, 0); mid P2 local = (0, 577.58)
    // Rotación lleva (577.62, 0) a offset en dirección perpendicular a P1-dir:
    //   P1-dir en mundo = -X; el eje polígono "a lo largo del tubo" (local +x) debería
    //   ser perpendicular al normal, es decir ±Y mundial.
    // Sin mirror: local (+x) → mundo (?). Lo más robusto: medir con el solver y confiar en p2PosErr<tol.
    const placement = alignOutlineToPorts(CS_300_90_065_18_Z, { P1 });
    expect(placement).not.toBeNull();
    if (!placement) return;
    // Probar un round-trip: outlinePointToWorld(P1.midpoint) ≈ P1.posicion en XY.
    const mid1 = CS_300_90_065_18_Z.boundary_edges[0].midpoint;
    const w = outlinePointToWorld(CS_300_90_065_18_Z, placement, mid1[0], mid1[1], 0);
    expect(Math.hypot(w[0] - P1.posicion_mm[0], w[1] - P1.posicion_mm[1])).toBeLessThan(0.1);
  });
});

describe('alignOutlineToPorts — reducción RIS-15', () => {
  it('alinea entrada de 150 mm y verifica salida de 300 mm (asimétrica)', () => {
    // RIS-15 es asimétrica: la boca estrecha (P1 en z_min) está offset 75 mm
    // respecto al centro de la boca ancha. P1 local mid x = 74.448;
    // P2 local mid x = 149.452. Si colocamos P1 en (0,0,50) con -Y mundo,
    // P2 debe quedar en (75, 450, 50) por la asimetría del reducer.
    const P1: Port = { posicion_mm: [0, 0, 50], direccion: [0, -1, 0] };
    const P2: Port = { posicion_mm: [75.004, 450, 50], direccion: [0, 1, 0] };
    const placement = alignOutlineToPorts(RIS_15_065_18_Z, { P1, P2 });
    expect(placement).not.toBeNull();
    if (!placement) return;
    expect(placement.p2PosErrorMm ?? 0).toBeLessThan(3);
    expect(placement.p2DirErrorDeg ?? 0).toBeLessThan(2);
  });

  it('rechaza una pose simétrica (P2 centrada sobre P1) por asimetría del reducer', () => {
    const P1: Port = { posicion_mm: [0, 0, 50], direccion: [0, -1, 0] };
    const P2bad: Port = { posicion_mm: [0, 450, 50], direccion: [0, 1, 0] };
    const placement = alignOutlineToPorts(RIS_15_065_18_Z, { P1, P2: P2bad });
    expect(placement).toBeNull();
  });
});

describe('segmentRailsFromOutline', () => {
  it('parte un recto en dos cadenas (edges 0 y 2 son rails)', () => {
    const chains = segmentRailsFromOutline(TRES_300_065_18_Z);
    // El TRES tiene 4 aristas: 2 puertos y 2 rails. Cada rail es una única arista.
    expect(chains.length).toBe(2);
    for (const c of chains) {
      expect(polylineLengthMm(c)).toBeGreaterThan(2900);
      expect(polylineLengthMm(c)).toBeLessThan(3100);
    }
  });

  it('parte una curva CS-300-90 en tres cadenas (bocas en polygon[1-2] y [5-6])', () => {
    // Tras fijar las bocas reales de CS-90 (extremos de cada brazo), el
    // polígono queda dividido en 3 cadenas de rail entre las dos bocas:
    //   - piso brazo horizontal (edge 0, ≈333 mm)
    //   - "codo" interior (edges 2+3+4, ≈209+333+209 ≈ 751 mm)
    //   - vuelta exterior (edges 6+7, ≈333+582 ≈ 914 mm, pared izq + diagonal)
    const chains = segmentRailsFromOutline(CS_300_90_065_18_Z);
    expect(chains.length).toBe(3);
    const lens = chains.map(polylineLengthMm).sort((a, b) => a - b);
    expect(lens[0]).toBeGreaterThan(300);
    expect(lens[0]).toBeLessThan(400);
    expect(lens[1]).toBeGreaterThan(700);
    expect(lens[1]).toBeLessThan(800);
    expect(lens[2]).toBeGreaterThan(900);
  });
});
