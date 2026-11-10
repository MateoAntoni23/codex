/**
 * Toda boca de toda receta (perforada y escalera) tiene su normal hacia AFUERA
 * del contorno: el centro desplazado 1 mm según la normal queda fuera del
 * polígono, y desplazado 1 mm en sentido contrario queda dentro.
 *
 * Hito 2: las recetas escalera tenían la normal invertida; la colocación desde
 * la definición ponía un recto escalera "hacia atrás" (P2 a −3000 mm).
 */
import { describe, expect, it } from 'vitest';
import { MASTER_MODELS } from '../../../configurator/masterModels';
import { buildRecipeByKey } from '../recipes';

function inside(poly: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

describe('normales de boca exteriores', () => {
  for (const m of MASTER_MODELS) {
    it(m.id, () => {
      const params: Record<string, number> = { ancho_mm: m.baseParams.ancho_mm, ala_mm: m.baseParams.ala_mm };
      if (m.baseParams.longitud_mm !== undefined) params.longitud_mm = m.baseParams.longitud_mm;
      if (m.baseParams.angulo_deg !== undefined) params.angulo_deg = m.baseParams.angulo_deg;
      const r = buildRecipeByKey(m.recipeKey, params as never);
      if (!r.extrudeAlongY) return; // contorno en XY (curvas verticales): bocas en caras de extrusión
      for (const p of r.ports) {
        if (Math.abs(p.normal[1]) > 1e-6) continue; // boca en tapa (normal ±Y)
        const [cx, , cz] = p.center.map((v, i) => v - r.translate[i]);
        const out = inside(r.polygon, cx + p.normal[0], cz + p.normal[2]);
        const inn = inside(r.polygon, cx - p.normal[0], cz - p.normal[2]);
        expect(out, `${m.id} ${p.name}: +normal debería quedar FUERA`).toBe(false);
        expect(inn, `${m.id} ${p.name}: −normal debería quedar DENTRO`).toBe(true);
      }
    });
  }
});
