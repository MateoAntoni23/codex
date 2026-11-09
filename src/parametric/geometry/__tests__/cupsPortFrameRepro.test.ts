/**
 * Repro numérico del desfase CUPS reportado por el usuario.
 *
 * Cadena: recto horizontal → CUPS → recto vertical.
 *
 * Dos invariantes operativas que deberían cumplirse en cada junta:
 *   (I1) Continuidad posicional: los centros de los puertos conectados coinciden.
 *   (I2) Continuidad del marco transversal: la orientación transversal (u_dir
 *        del ancho, v_dir del ala) de ambas bocas coincide en el mundo, sólo
 *        difieren en que las normales son opuestas (flush).
 *
 * El test deja constancia del estado ACTUAL (incluyendo el desfase) para
 * documentar la regresión y fundar el cierre del caso CUPS en el siguiente
 * commit.
 *
 * Ver docs/pattern-models-reconciliation.md §3 (D6) para el diagnóstico.
 */
import { describe, expect, it } from 'vitest';
import { buildCUPSRecipe, buildTRPSRecipe } from '../outlines';

type Vec3 = readonly [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe('CUPS port frame — repro del desfase recto H → CUPS → recto V', () => {
  it('snapshot: marcos locales de TRPS.P1 y CUPS.P1_horizontal/P2_vertical', () => {
    const trps = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const cups = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });

    const trpsP1 = trps.ports.find((p) => p.name === 'P1')!;
    const cupsP1h = cups.ports.find((p) => p.name === 'P1_horizontal')!;
    const cupsP2v = cups.ports.find((p) => p.name === 'P2_vertical')!;

    // Dump legible — sirve de evidencia para la reconciliación.
    // eslint-disable-next-line no-console
    console.log('[repro] TRPS.P1       normal', trpsP1.normal, 'u', trpsP1.u_dir, 'v', trpsP1.v_dir);
    // eslint-disable-next-line no-console
    console.log('[repro] CUPS.P1_horiz normal', cupsP1h.normal, 'u', cupsP1h.u_dir, 'v', cupsP1h.v_dir);
    // eslint-disable-next-line no-console
    console.log('[repro] CUPS.P2_vert  normal', cupsP2v.normal, 'u', cupsP2v.u_dir, 'v', cupsP2v.v_dir);

    expect(trpsP1.normal).toEqual([-1, 0, 0]);
    expect(trpsP1.u_dir).toEqual([0, 0, 1]);
    expect(trpsP1.v_dir).toEqual([0, 1, 0]);

    expect(cupsP1h.normal).toEqual([-1, 0, 0]);
    expect(cupsP1h.u_dir).toEqual([0, 0, -1]);

    expect(cupsP2v.normal).toEqual([0, -1, 0]);
    expect(cupsP2v.u_dir).toEqual([0, 0, -1]);
  });

  it('TRPS.P1 y CUPS.P1_horizontal: u·u (u_trps·u_cups) y v·v apuntan a lados opuestos (desfase 180° alrededor de n)', () => {
    const trps = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const cups = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });

    const trpsP1 = trps.ports.find((p) => p.name === 'P1')!;
    const cupsP1h = cups.ports.find((p) => p.name === 'P1_horizontal')!;

    // Las normales son iguales (n_local coincide) — se usarán opuestas en
    // mundo porque TRPS entra por P2 (normal=+X) contra CUPS.P1 (normal=-X).
    expect(trpsP1.normal).toEqual(cupsP1h.normal);

    // El desfase es 180° alrededor del eje normal: u ↔ -u y v ↔ -v.
    const uDot = dot(trpsP1.u_dir, cupsP1h.u_dir);
    const vDot = dot(trpsP1.v_dir, cupsP1h.v_dir);
    // eslint-disable-next-line no-console
    console.log('[repro] u_trps · u_cups =', uDot.toFixed(3), '  v_trps · v_cups =', vDot.toFixed(3));
    expect(uDot).toBeLessThan(0);
    expect(vDot).toBeLessThan(0);
  });

  it('CUPS tiene exactamente dos bocas operativas (P1_horizontal y P2_vertical)', () => {
    const cups = buildCUPSRecipe({ ancho_mm: 300, ala_mm: 50 });
    const names = cups.ports.map((p) => p.name).sort();
    expect(names).toEqual(['P1_horizontal', 'P2_vertical']);
    for (const port of cups.ports) {
      expect(port.kind).toBe('operational');
    }
  });
});
