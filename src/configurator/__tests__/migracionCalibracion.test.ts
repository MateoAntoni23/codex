/**
 * B-2.6 / PB5 — la biblioteca por SKU migra a calibración por patrón y produce
 * las mismas bocas, o la diferencia queda listada pieza por pieza.
 *
 * Escenarios (bibliotecas armadas aquí: ningún fixture del repo trae una):
 *   S1 TPS-300: modelFrame rz 90° + giro de instalación en tronco_P1 + centro y
 *      normal absolutos en boca_derivacion → calibración del patrón TPS. TPS-300
 *      se reproduce; las otras variantes (antes heredaban por búsqueda, sin el
 *      centro) quedan listadas.
 *   S2 CPS-90: dos SKU con giros distintos en P2 → no se elige: excepciones.
 *   S3 XPS-300 sólo con modelFrame rígido → ninguna corrección; mismas bocas.
 *   S4 override de un producto que no existe → pendiente, sin aplicarse.
 *   S5 override sólo de nombres de boca → se conserva tal cual.
 *
 * "Mismas bocas": ≤ 1e-6 mm / 1e-6° (TOL_IGUALDAD, ver el módulo).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadStaticCatalog, seedStaticCatalog } from '../../catalog/staticCatalog';
import {
  clearCatalogPortIndex,
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  getEffectiveMapping,
  setMasterResolver,
  type ProductPortMapping,
} from '../../workspace/catalogPortMapping';
import { clearBibliotecaCalibracion } from '../../workspace/calibracionPatron';
import { buildDefinition } from '../../workspace/placement/definitions';
import { diferenciasDeBocas, migrarBibliotecaPorSku, TOL_IGUALDAD, type ResultadoMigracion } from '../migracionCalibracion';
import type { Product } from '../../tray/model';

let productos: Product[];
const byId = (id: string) => productos.find((p) => p.producto_id === id)!;

/** Entradas de mapping del producto: las vigentes o, si no hay, identidad sobre sus bocas. */
function entradas(id: string) {
  const vig = getEffectiveMapping(id)?.entries ?? [];
  if (vig.length) return vig.map((e) => ({ ...e }));
  const d = buildDefinition(byId(id));
  if (!d.ok) throw new Error(d.motivo);
  return d.def.ports.map((p) => ({ recipePortName: p.name, catalogPortName: p.name, physicalLabel: p.name, justification: 'identidad' }));
}

beforeAll(async () => {
  clearPortMappingOverrides();
  clearBibliotecaCalibracion();
  productos = [...(await loadStaticCatalog()).productos];
  await seedStaticCatalog();
});
afterAll(() => {
  clearPortMappingOverrides();
  clearBibliotecaCalibracion();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

function bibliotecaVieja(): Record<string, ProductPortMapping> {
  // Bocas crudas de TPS-300 (sin calibración) para armar un centro absoluto real.
  const d = buildDefinition(byId('SAM_TPS-300-Z'));
  if (!d.ok) throw new Error(d.motivo);
  const rz = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const deriv = d.def.ports.find((p) => p.name === 'boca_derivacion')!;
  const c = new THREE.Vector3(...deriv.center).applyMatrix4(rz).add(new THREE.Vector3(3, 0, 0));
  const n = new THREE.Vector3(...deriv.normal).applyMatrix4(rz).applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.02);
  const tps = entradas('SAM_TPS-300-Z').map((e) =>
    e.recipePortName === 'tronco_P1' ? { ...e, geometry: { installRotationDeg: 10 } }
      : e.recipePortName === 'boca_derivacion' ? { ...e, geometry: { centerMm: [c.x, c.y, c.z] as const, normal: [n.x, n.y, n.z] as const } }
        : e);
  const giroP2 = (deg: number) => entradas('SAM_CPS-300-90-Z').map((e) => (e.recipePortName === 'P2' ? { ...e, geometry: { installRotationDeg: deg } } : e));
  return {
    'SAM_TPS-300-Z': { productId: 'SAM_TPS-300-Z', source: 'override', entries: tps, modelFrame: { tx_mm: 0, ty_mm: 0, tz_mm: 0, rx_deg: 0, ry_deg: 0, rz_deg: 90 } },
    'SAM_CPS-300-90-Z': { productId: 'SAM_CPS-300-90-Z', source: 'override', entries: giroP2(5) },
    'SAM_CPS-450-90-Z': { productId: 'SAM_CPS-450-90-Z', source: 'override', entries: entradas('SAM_CPS-450-90-Z').map((e) => (e.recipePortName === 'P2' ? { ...e, geometry: { installRotationDeg: 7 } } : e)) },
    'SAM_XPS-300-Z': { productId: 'SAM_XPS-300-Z', source: 'override', entries: entradas('SAM_XPS-300-Z'), modelFrame: { tx_mm: 10, ty_mm: 0, tz_mm: 0, rx_deg: 0, ry_deg: 0, rz_deg: 30 } },
    'SAM_NO-EXISTE': { productId: 'SAM_NO-EXISTE', source: 'override', entries: [{ recipePortName: 'P1', catalogPortName: 'P1', physicalLabel: '', justification: '', geometry: { installRotationDeg: 3 } }] },
    'SAM_TRPS-300-22-Z': { productId: 'SAM_TRPS-300-22-Z', source: 'override', overrideReason: 'sólo nombres', entries: entradas('SAM_TRPS-300-22-Z') },
  };
}

describe('migración de la biblioteca por SKU', () => {
  let viejos: Record<string, ProductPortMapping>;
  let m: ResultadoMigracion;
  beforeAll(() => {
    viejos = bibliotecaVieja();
    m = migrarBibliotecaPorSku(viejos, productos, '2026-11-11T00:00:00Z');
  });

  it('S1: la calibración de TPS-300 pasa a ser la del patrón TPS', () => {
    const patron = buildDefinition(byId('SAM_TPS-300-Z'));
    if (!patron.ok) throw new Error(patron.motivo);
    const cal = m.biblioteca.patrones[patron.def.patron];
    expect(cal, 'calibración del patrón TPS').toBeDefined();
    expect(Object.keys(cal.bocas).sort()).toEqual(['boca_derivacion', 'tronco_P1']);
    expect(cal.bocas.tronco_P1.giro_deg.axial).toBeCloseTo(10, 9);
    expect(m.informe.modelFramesDescartados.map((x) => x.productoId)).toContain('SAM_TPS-300-Z');
  });

  it('S2: dos SKU de CPS-90 con correcciones distintas → excepciones, sin elegir', () => {
    expect(m.informe.conflictos.map((c) => c.productos)).toContainEqual(['SAM_CPS-300-90-Z', 'SAM_CPS-450-90-Z']);
    expect(m.biblioteca.excepciones['SAM_CPS-300-90-Z'].bocas.P2.giro_deg.axial).toBeCloseTo(5, 9);
    expect(m.biblioteca.excepciones['SAM_CPS-450-90-Z'].bocas.P2.giro_deg.axial).toBeCloseTo(7, 9);
    expect(m.biblioteca.excepciones['SAM_CPS-450-90-Z'].motivo).toMatch(/no coincidían/);
  });

  it('S3: sólo modelFrame rígido → ninguna corrección (se informa como descartado)', () => {
    const xps = buildDefinition(byId('SAM_XPS-300-Z'));
    if (!xps.ok) throw new Error(xps.motivo);
    expect(m.biblioteca.patrones[xps.def.patron]).toBeUndefined();
    expect(m.informe.modelFramesDescartados.map((x) => x.productoId)).toContain('SAM_XPS-300-Z');
  });

  it('S4: producto inexistente → pendiente con el original intacto', () => {
    expect(m.biblioteca.pendientes['SAM_NO-EXISTE'].original).toEqual(viejos['SAM_NO-EXISTE']);
  });

  it('S5: override sólo de nombres → se conserva tal cual; los demás quedan sin geometría', () => {
    expect(m.overridesNombres['SAM_TRPS-300-22-Z']).toEqual(viejos['SAM_TRPS-300-22-Z']);
    expect(m.overridesNombres['SAM_TPS-300-Z'].entries.every((e) => !e.geometry)).toBe(true);
    expect(m.overridesNombres['SAM_TPS-300-Z'].modelFrame).toBeUndefined();
    // Nada se perdió: cada override original está en overridesNombres (nombres) y, con su geometría, en patrón, excepción o pendientes.
    expect(Object.keys(m.overridesNombres).sort()).toEqual(Object.keys(viejos).sort());
  });

  it('PB5: los productos con calibración propia conservan sus bocas; el resto queda listado', () => {
    const dif = diferenciasDeBocas(viejos, m, productos);
    const de = (id: string) => dif.find((d) => d.productoId === id)!;
    for (const id of ['SAM_TPS-300-Z', 'SAM_CPS-300-90-Z', 'SAM_CPS-450-90-Z', 'SAM_XPS-300-Z']) {
      expect(de(id), id).toBeDefined();
      expect(de(id).maxMm, `${id} mm`).toBeLessThanOrEqual(TOL_IGUALDAD);
      expect(de(id).maxDeg, `${id} °`).toBeLessThanOrEqual(TOL_IGUALDAD);
      expect(de(id).nota).toBeNull();
    }
    // Las variantes que antes heredaban por búsqueda y ahora aplican la corrección del patrón quedan listadas.
    const listadas = dif.filter((d) => d.nota !== null);
    expect(listadas.length).toBeGreaterThan(0);
    for (const d of listadas) expect(d.nota).toMatch(/heredaba por búsqueda/);
    // TPS (patrón con calibración): las otras variantes ahora aplican la del patrón.
    expect(de('SAM_TPS-450-Z').nota).toMatch(/aplica la corrección del patrón/);
    // CPS-90 (conflicto): las variantes sin excepción quedan sin calibración, y se dice.
    expect(de('SAM_CPS-600-90-Z').nota).toMatch(/queda sin calibración/);
    // Se informa en la salida de la prueba, pieza por pieza.
    console.log(['PB5 — diferencias de bocas tras migrar:', ...dif.map((d) => `  ${d.productoId} (${d.patron}): ${d.maxMm.toExponential(2)} mm, ${d.maxDeg.toExponential(2)}° ${d.nota ?? 'iguales'}`)].join('\n'));
  });

  it('control negativo: si la migración se equivocara en una corrección, PB5 lo detecta', () => {
    const tps = buildDefinition(byId('SAM_TPS-300-Z'));
    if (!tps.ok) throw new Error(tps.motivo);
    const p = m.biblioteca.patrones[tps.def.patron];
    const roto: ResultadoMigracion = {
      ...m,
      biblioteca: {
        ...m.biblioteca,
        patrones: {
          ...m.biblioteca.patrones,
          [tps.def.patron]: { ...p, bocas: { ...p.bocas, tronco_P1: { ...p.bocas.tronco_P1, giro_deg: { ...p.bocas.tronco_P1.giro_deg, axial: 11 } } } },
        },
      },
    };
    const dif = diferenciasDeBocas(viejos, roto, productos).find((d) => d.productoId === 'SAM_TPS-300-Z')!;
    expect(dif.maxDeg).toBeGreaterThan(0.5);
    expect(dif.nota).toMatch(/no se reproduce/);
  });
});
