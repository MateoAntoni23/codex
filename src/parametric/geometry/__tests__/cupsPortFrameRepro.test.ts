/**
 * CUPS port frame — convención unificada con TRPS/CPS/portOnEdgeXZ.
 *
 * Cadena: recto horizontal → CUPS → recto vertical.
 *
 * Invariantes operativas en cada junta:
 *   (I1) Continuidad posicional: los centros de los puertos conectados coinciden.
 *   (I2) Continuidad del marco transversal: las bocas comparten el mismo
 *        "arriba de sección" (v_dir), tienen u_dir opuestos (la salida apunta
 *        "para atrás" por la regla u×v=n) y normales opuestas (flush).
 *
 * El marco local de CUPS.P1_horizontal se unifica con TRPS.P1 (misma normal
 * −X): v=(0,+1,0), u=(0,0,+1). Antes de esta normalización CUPS exponía
 * v=(≈0,−1,0), u=(0,0,−1) — rotación de 180° alrededor de n, válida
 * algebraicamente (u×v=n se preservaba) pero equivalente a colocar el cuerpo
 * de CUPS invertido respecto al recto entrante.
 *
 * El marco local de CUPS.P2_vertical queda como estaba porque la ruta
 * frame-based del puente ya combina sectionUp propagado con la regla
 * u_W × v_W = n_W, y la heurística `routingRules.computePortSectionUp`
 * entrega sectionUp=+X coherente con el v_world actual. Unificar también
 * P2_vertical requiere mover la fuente de sectionUp al v_dir del puerto en
 * mundo (D7), tarea fuera del alcance del cierre de CUPS.
 *
 * Ver docs/pattern-models-reconciliation.md §D6 para el diagnóstico.
 */
import { describe, expect, it } from 'vitest';
import { buildCUPSRecipe, buildTRPSRecipe } from '../outlines';

type Vec3 = readonly [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

describe('CUPS port frame — convención unificada', () => {
  it('snapshot: marcos locales de TRPS.P1 y CUPS.P1_horizontal/P2_vertical', () => {
    const trps = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const cups = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });

    const trpsP1 = trps.ports.find((p) => p.name === 'P1')!;
    const cupsP1h = cups.ports.find((p) => p.name === 'P1_horizontal')!;
    const cupsP2v = cups.ports.find((p) => p.name === 'P2_vertical')!;

    expect(trpsP1.normal).toEqual([-1, 0, 0]);
    expect(trpsP1.u_dir).toEqual([0, 0, 1]);
    expect(trpsP1.v_dir).toEqual([0, 1, 0]);

    // CUPS.P1_horizontal: mismo marco local que TRPS.P1 (misma normal −X).
    expect(cupsP1h.normal).toEqual([-1, 0, 0]);
    expect(cupsP1h.u_dir).toEqual([0, 0, 1]);
    // v_dir numérico ≈ (0, +1, 0) (residuo de rotación +45°).
    expect(Math.abs(cupsP1h.v_dir[0])).toBeLessThan(1e-3);
    expect(cupsP1h.v_dir[1]).toBeGreaterThan(0.99);
    expect(cupsP1h.v_dir[2]).toBe(0);

    // CUPS.P2_vertical: marco heredado (compatibilidad con heurística sectionUp).
    expect(cupsP2v.normal).toEqual([0, -1, 0]);
    expect(cupsP2v.u_dir).toEqual([0, 0, -1]);
    expect(cupsP2v.v_dir[0]).toBeGreaterThan(0.99);
  });

  it('TRPS.P1 y CUPS.P1_horizontal comparten normal, u_dir y v_dir (marco local idéntico)', () => {
    const trps = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const cups = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });

    const trpsP1 = trps.ports.find((p) => p.name === 'P1')!;
    const cupsP1h = cups.ports.find((p) => p.name === 'P1_horizontal')!;

    expect(trpsP1.normal).toEqual(cupsP1h.normal);
    expect(dot(trpsP1.u_dir, cupsP1h.u_dir)).toBeGreaterThan(0.999);
    expect(dot(trpsP1.v_dir, cupsP1h.v_dir)).toBeGreaterThan(0.999);
  });

  it('CUPS tiene exactamente dos bocas operativas y cada una cumple u×v=n (orto-normalidad)', () => {
    const cups = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });
    const names = cups.ports.map((p) => p.name).sort();
    expect(names).toEqual(['P1_horizontal', 'P2_vertical']);
    for (const port of cups.ports) {
      expect(port.kind).toBe('operational');
      const n = port.normal as Vec3;
      const u = port.u_dir as Vec3;
      const v = port.v_dir as Vec3;
      const uv = cross(u, v);
      expect(uv[0]).toBeCloseTo(n[0], 3);
      expect(uv[1]).toBeCloseTo(n[1], 3);
      expect(uv[2]).toBeCloseTo(n[2], 3);
    }
  });
});
