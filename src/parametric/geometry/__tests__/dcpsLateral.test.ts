/**
 * DCPS lateral — geometría medida (50 y 300) y anchos sin STEP propio
 * (100, 150, 200, 450, 600) generados con la planta de su medido más cercano.
 * NO hay ley de escala (operador, 2026-11-12): los anchos sin STEP son cotas no
 * confirmadas.
 *
 *   - Los 7 productos DCPS del catálogo tienen definición (son colocables).
 *   - Los 2 medidos coinciden con el contorno extraído de su STEP
 *     (report/perforada/derivacion/*__outline.json, llevado al marco declarado).
 *   - La 50 y la 300 son la misma planta trasladada (±0,002 mm): eso respalda
 *     trasladar la mitad derecha, no una ley para otros anchos.
 *   - Cada generado = planta de su medido más cercano; cotas: boca = ancho + 1,315; huella sobre
 *     el flanco = ancho + 179,323 (= boca + 178,008); profundidad apoyo→boca = 80,542; ala 50.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DCPS_LATERAL_MEDIDOS, dcpsLateralDesdeMedido, dcpsMedidoMasCercano } from '../outlines';
import { findMasterById } from '../../../configurator/masterModels';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../../workspace/catalogPortMapping';
import { definicionEfectiva } from '../../../workspace/placement/definitions';
import type { Product } from '../../../tray/model';
// @ts-expect-error — módulo .mjs del generador, sin tipos
import { contornoEnMarco } from '../../../../tools/step_parametric/emit_perforada_outlines.mjs';

const ROOT = resolve(__dirname, '../../../..');
const snapshot = JSON.parse(readFileSync(resolve(ROOT, 'vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const decl = JSON.parse(readFileSync(resolve(ROOT, 'tools/step_parametric/perforada_contornos.json'), 'utf8')) as { contornos: Array<{ outline: string }> };

beforeAll(async () => {
  clearPortMappingOverrides();
  await seedStaticCatalog();
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

type P2 = readonly (readonly [number, number])[];
const maxDif = (a: P2, b: P2) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

function delStep(n: 50 | 300): P2 {
  const c = decl.contornos.find((x) => x.outline === `derivacion/DCPS-${n}-Z`)!;
  const o = JSON.parse(readFileSync(resolve(ROOT, `tools/step_parametric/report/perforada/derivacion/DCPS-${n}-Z__outline.json`), 'utf8'));
  return contornoEnMarco(c, o) as P2;
}

function cotas(poly: P2) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  return {
    huella: Math.max(...xs) - Math.min(...xs),
    profundidad: Math.max(...zs) - Math.min(...zs),
    boca: poly[5][0] - poly[4][0],
  };
}

describe('DCPS lateral', () => {
  it('los 2 medidos coinciden con el contorno de su STEP', () => {
    expect(maxDif(DCPS_LATERAL_MEDIDOS[50], delStep(50))).toBe(0);
    expect(maxDif(DCPS_LATERAL_MEDIDOS[300], delStep(300))).toBe(0);
  });

  it('la 50 y la 300 son la misma planta: la 300 con la mitad derecha trasladada −250 reproduce el STEP de 50 (±0,002 mm)', () => {
    const desde300 = DCPS_LATERAL_MEDIDOS[300].map(([x, z], i) => [i >= 5 ? x - 250 : x, z] as const);
    expect(maxDif(desde300, delStep(50))).toBeLessThanOrEqual(0.002);
  });

  it('los anchos con planta medida y con sobreancho medido son los mismos datos (outlines ↔ maestro)', () => {
    const tabla = findMasterById('master:perforada:derivacion_lateral')!.sobreanchoBoca!.porModeloMedido;
    expect(Object.keys(tabla).map(Number)).toEqual(Object.keys(DCPS_LATERAL_MEDIDOS).map(Number));
  });

  it('cada ancho sin STEP toma la planta de su medido más cercano (no una fórmula)', () => {
    expect([100, 150, 200, 450, 600].map((n) => dcpsMedidoMasCercano(n))).toEqual([50, 50, 300, 300, 300]);
  });

  it('los 7 productos son colocables; medidos = su STEP, generados = planta del medido más cercano; cotas por ancho', () => {
    const dcps = snapshot.PRODUCTOS.filter((p) => String(p.sku).startsWith('DCPS-'));
    expect(dcps.map((p) => p.ancho_nominal_mm)).toEqual([50, 100, 150, 200, 300, 450, 600]);
    for (const p of dcps) {
      const N = p.ancho_nominal_mm!;
      const d = definicionEfectiva(p);
      expect(d.ok, `${p.producto_id}: ${d.ok ? '' : d.motivo}`).toBe(true);
      if (!d.ok) continue;
      expect(d.def.patron).toBe('master:perforada:derivacion_lateral');
      const poly = d.def.mesh.polygon;
      const esperado = N === 50 || N === 300 ? DCPS_LATERAL_MEDIDOS[N] : dcpsLateralDesdeMedido(N).polygon;
      expect(maxDif(poly, esperado), p.producto_id).toBe(0);
      const c = cotas(poly);
      expect(c.boca, `${p.producto_id} boca`).toBeCloseTo(N + 1.315, 2);
      expect(c.huella, `${p.producto_id} huella`).toBeCloseTo(N + 179.323, 2);
      expect(c.profundidad, `${p.producto_id} profundidad`).toBeCloseTo(80.542, 3);
      expect(d.def.mesh.height).toBe(50);
      // Una sola boca: el ramal, normal +Z, en z = 0.
      expect(d.def.ports.map((q) => q.name)).toEqual(['P1']);
      expect(d.def.ports[0].ancho_mm).toBeCloseTo(N + 1.315, 2);
      expect(d.def.ports[0].ala_mm).toBe(50);
    }
  });
});
