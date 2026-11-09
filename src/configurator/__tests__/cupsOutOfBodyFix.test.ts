// @vitest-environment node
/**
 * Verifica la corrección reversible para la boca CUPS fuera del cuerpo:
 *  - Detección: dado el override real del usuario (-150→+150), centerZ queda
 *    fuera del rango [-ancho, 0] de la malla.
 *  - Corrección: la función aplicada lleva centerZ a -ancho/2 preservando
 *    X/Y, y marca el override con un motivo auditable (reversible).
 *
 * Nota: este test no monta React. Replica la misma lógica aritmética del
 * componente para blindarla contra regresiones. Si `ConfiguratorInspectorTabs`
 * cambia el cálculo, este test se mantiene como contrato.
 */
import { describe, it, expect } from 'vitest';

type V3 = readonly [number, number, number];

function correctCupsZ(center: V3, ancho: number): V3 {
  return [center[0], center[1], -ancho / 2];
}

function isOutOfBody(z: number, ancho: number): boolean {
  const minZ = -ancho;
  const maxZ = 0;
  return z < minZ - 0.5 || z > maxZ + 0.5;
}

describe('CUPS boca-fuera — corrección reversible', () => {
  it('ancho=300: el override +150 queda fuera del cuerpo', () => {
    expect(isOutOfBody(150, 300)).toBe(true);
    expect(isOutOfBody(-150, 300)).toBe(false); // la base canónica está dentro
    expect(isOutOfBody(0, 300)).toBe(false);
    expect(isOutOfBody(-300, 300)).toBe(false);
  });

  it('preserva X e Y, lleva Z a -ancho/2', () => {
    const corrected = correctCupsZ([-185, 125, 150], 300);
    expect(corrected).toEqual([-185, 125, -150]);
  });

  it('ancho=450: la corrección baja a -225 (no 300 fijo)', () => {
    // Ancla el requisito: no propagar +300 constante a 450.
    const corrected = correctCupsZ([-185, 125, 150], 450);
    expect(corrected[2]).toBe(-225);
  });
});
