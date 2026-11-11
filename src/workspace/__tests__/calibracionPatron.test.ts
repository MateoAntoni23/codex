/**
 * B-2.5 — corrección de boca en sus propios ejes: aplicar y deducir son
 * inversas, y cada componente mueve lo que dice.
 *
 * Tolerancias: aritmética en doble precisión sobre valores de mm y grados de
 * magnitud ≤ 10³; el error de redondeo acumulado de unas pocas matrices 3×3 es
 * del orden de 1e-12. Se exige 1e-9 (mm y grados).
 */
import { describe, expect, it } from 'vitest';
import {
  aplicarCorreccion,
  calibracionPara,
  correccionEntre,
  diferenciaCorrecciones,
  marcoDeBoca,
  type CorreccionBoca,
} from '../calibracionPatron';

const TOL = 1e-9;
const nominal = marcoDeBoca([100, 25, -150], [-1, 0, 0], [0, 1, 0]);
const c = (l: number, v: number, a: number, gl: number, gv: number, ga: number): CorreccionBoca => ({
  desplazamiento_mm: { lateral: l, vertical: v, axial: a },
  giro_deg: { lateral: gl, vertical: gv, axial: ga },
});
const close = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

describe('corrección de boca', () => {
  it('el marco nominal es ortonormal y lateral = vertical × axial', () => {
    expect(nominal.axial).toEqual([-1, 0, 0]);
    expect(nominal.vertical).toEqual([0, 1, 0]);
    expect(close(nominal.lateral, [0, 0, 1])).toBeLessThan(TOL);
  });

  it('corrección nula deja el marco igual', () => {
    const m = aplicarCorreccion(nominal, c(0, 0, 0, 0, 0, 0));
    expect(close(m.centro, nominal.centro)).toBeLessThan(TOL);
    expect(close(m.axial, nominal.axial)).toBeLessThan(TOL);
  });

  it('el desplazamiento va sobre los ejes de la boca', () => {
    const m = aplicarCorreccion(nominal, c(2, 3, 5, 0, 0, 0));
    // lateral = +z, vertical = +y, axial = −x
    expect(close(m.centro, [100 - 5, 25 + 3, -150 + 2])).toBeLessThan(TOL);
  });

  it('el giro axial sólo cambia la orientación transversal', () => {
    const m = aplicarCorreccion(nominal, c(0, 0, 0, 0, 0, 90));
    expect(close(m.axial, nominal.axial)).toBeLessThan(TOL);
    // v = +y girado 90° alrededor del eje axial −x: (−x) × y = −z.
    expect(close(m.vertical, [0, 0, -1])).toBeLessThan(TOL);
  });

  it('aplicar y deducir son inversas (giros y desplazamientos combinados)', () => {
    for (const k of [c(1.5, -2, 0.25, 3, -7, 12), c(0, 0, 0, 0.4, 0, 0), c(-10, 4, 1, -20, 15, -170)]) {
      const m = aplicarCorreccion(nominal, k);
      const back = correccionEntre(nominal, m);
      const d = diferenciaCorrecciones(k, back);
      expect(d.mm).toBeLessThan(TOL);
      expect(d.deg).toBeLessThan(TOL);
    }
  });

  it('control negativo: una corrección distinta da un marco distinto', () => {
    const a = aplicarCorreccion(nominal, c(0, 0, 0, 0, 1, 0));
    const b = aplicarCorreccion(nominal, c(0, 0, 0, 0, 0, 0));
    expect(close(a.axial, b.axial)).toBeGreaterThan(1e-3);
  });
});

describe('calibración aplicable', () => {
  const bib = {
    version: 'codex:calibracion/2' as const,
    patrones: { 'master:x': { patron: 'master:x', bocas: { P1: c(1, 0, 0, 0, 0, 0) } } },
    excepciones: { SAM_X450: { productoId: 'SAM_X450', patron: 'master:x', bocas: { P1: c(2, 0, 0, 0, 0, 0) }, motivo: 'medido aparte' } },
  };
  it('variante medida: la del patrón, sin marca de heredada', () => {
    expect(calibracionPara('SAM_X300', 'master:x', true, bib)).toMatchObject({ origen: 'patron', heredada: false });
  });
  it('otra variante: la del patrón, marcada heredada', () => {
    expect(calibracionPara('SAM_X600', 'master:x', false, bib)).toMatchObject({ origen: 'patron', heredada: true });
  });
  it('excepción explícita por producto, con su motivo', () => {
    expect(calibracionPara('SAM_X450', 'master:x', false, bib)).toMatchObject({ origen: 'excepcion', motivo: 'medido aparte' });
  });
  it('sin calibración de patrón: ninguna (no se busca otro SKU)', () => {
    expect(calibracionPara('SAM_Y', 'master:y', false, bib)).toEqual({ origen: 'ninguna' });
  });
});
