// @vitest-environment node
/**
 * Invariantes de propagación maestro → variantes (#118 + #121).
 *
 * Objetivo: blindar dos invariantes que el usuario pidió explícitos:
 *
 *   1. (#121) La proyección de variantes NO copia desplazamientos absolutos
 *      del maestro. Para cada variante, el centro de la boca escala según la
 *      regla del maestro (anchoFactor / alaFactor / longFactor), no se queda
 *      pegado al valor del ancho base.
 *
 *   2. (#118) Las normales de las bocas proyectadas permanecen unitarias
 *      (|n|=1 ± 1e-6) y, cuando las aristas del maestro son ejes puros, las
 *      normales son axis-aligned. Esto asegura que la escala no uniforme no
 *      distorsiona los marcos de boca (ortonormalidad preservada).
 *
 * No ejercita UI: usa sólo `enumerateVariantsForMaster` + `resolveRecipeFor…`
 * para validar el contrato aritmético. Cubre:
 *   - TRPS 300 → 450 (perforada, ancho-only-z): Z escala, X/Y no.
 *   - CUPS 300 → 450 (perforada, depth-only): Z escala con ancho, X/Y no.
 *   - TRES 300-065 → 450-090 (escalera, ala-independent medida): X preservado
 *     por longitud, Z por ancho, Y por ala — cada eje independiente.
 *   - Normales en todos los anteriores: unitarias; axis-aligned cuando aplica.
 *   - resolveRecipeForProduct con modelFrame rotación pura: preserva
 *     ortonormalidad (u_dir · v_dir ≈ 0, |u|=|v|=|n|=1).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { findMasterById } from '../masterModels';
import { enumerateVariantsForMaster } from '../masterVariants';
import { buildRecipeFor } from '../../parametric/geometry/recipes';
import { resolveRecipeWith } from '../../workspace/resolvedPortGeometry';
import type { Product } from '../../tray/model';

function makeProduct(partial: Partial<Product> & { producto_id: string; sku: string }): Product {
  return {
    descripcion_original: '',
    tipo_pieza: 'recta',
    ancho_nominal_mm: 300,
    ...partial,
  } as Product;
}

const unit = (v: readonly [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

describe('#121 variante NO copia desplazamientos absolutos del maestro', () => {
  it('TRPS-450-22-Z: Z escala por 450/300, X/Y preservados por regla ancho-only-z', () => {
    const master = findMasterById('master:perforada:tramo_recto');
    expect(master).toBeTruthy();
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_TRPS-300-22-Z',
        sku: 'TRPS-300-22-Z',
        familia_id: 'SAM-STP-Z',
        tipo_pieza: 'recta',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 50,
        longitud_comercial_mm: 2200,
      } as any),
      makeProduct({
        producto_id: 'SAM_TRPS-450-22-Z',
        sku: 'TRPS-450-22-Z',
        familia_id: 'SAM-STP-Z',
        tipo_pieza: 'recta',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 50,
        longitud_comercial_mm: 2200,
      } as any),
    ];
    const vs = enumerateVariantsForMaster(master!, productos);
    const v450 = vs.find((v) => v.sku === 'TRPS-450-22-Z');
    expect(v450).toBeTruthy();
    expect(v450!.scale.z).toBeCloseTo(1.5, 3);
    expect(v450!.scale.y).toBeCloseTo(1, 3);
    // Los centros emitidos por buildRecipeFor están escalados por anchoFactor
    // en Z: al pasar de 300 a 450, |Z| debe pasar de 150 a 225 (±0.5mm).
    const cBase = vs.find((v) => v.sku === 'TRPS-300-22-Z')!;
    const absZ = Math.max(...cBase.ports.map((p) => Math.abs(p.centerMm?.[2] ?? 0)));
    const absZ450 = Math.max(...v450!.ports.map((p) => Math.abs(p.centerMm?.[2] ?? 0)));
    expect(absZ).toBeCloseTo(150, 0);
    expect(absZ450).toBeCloseTo(225, 0);
    // Y no copia absoluto: si la variante leyera el centro del maestro, |Z|
    // sería 150 también. Blindaje explícito contra regresión de absolute-copy.
    expect(Math.abs(absZ450 - 150)).toBeGreaterThan(50);
  });

  it('CUPS-450-Z: Z (profundidad) escala con ancho; perfil XY preservado', () => {
    const master = findMasterById('master:perforada:curva_vertical_interior');
    expect(master).toBeTruthy();
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_CUPS-300-Z',
        sku: 'CUPS-300-Z',
        familia_id: 'SAM-STP-Z',
        tipo_pieza: 'curva vertical interior',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 50,
      } as any),
      makeProduct({
        producto_id: 'SAM_CUPS-450-Z',
        sku: 'CUPS-450-Z',
        familia_id: 'SAM-STP-Z',
        tipo_pieza: 'curva vertical interior',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 50,
      } as any),
    ];
    const vs = enumerateVariantsForMaster(master!, productos);
    const v450 = vs.find((v) => v.sku === 'CUPS-450-Z');
    expect(v450).toBeTruthy();
    expect(v450!.scale.z).toBeCloseTo(1.5, 3);
    expect(v450!.scale.x).toBe(1);
    expect(v450!.scale.y).toBe(1);
  });

  it('TRES-450-090 (escalera): ala-independent — X por longitud, Z por ancho, Y por ala', () => {
    const master = findMasterById('master:escalera:tramo_recto');
    expect(master).toBeTruthy();
    expect(master!.variationRule.kind).toBe('ala-independent');
    // Regla 'derived' (no 'measured'): se extiende por construcción desde el
    // polígono rectangular medido en ancho=300 ala=65; no hay segundo STEP
    // validando 450/090 todavía.
    expect(master!.variationRule.provenance).toBe('derived');
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_TRES-300-065-18-Z',
        sku: 'TRES-300-065-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'recta',
        ancho_nominal_mm: 300,
        ala_nominal_mm: 65,
        longitud_comercial_mm: 3000,
      } as any),
      makeProduct({
        producto_id: 'SAM_TRES-450-090-18-Z',
        sku: 'TRES-450-090-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'recta',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 90,
        longitud_comercial_mm: 3000,
      } as any),
    ];
    const vs = enumerateVariantsForMaster(master!, productos);
    const v = vs.find((x) => x.sku === 'TRES-450-090-18-Z');
    expect(v).toBeTruthy();
    expect(v!.scale.x).toBeCloseTo(1, 3); // longitud = 3000 → factor 1
    expect(v!.scale.z).toBeCloseTo(1.5, 3); // ancho 450/300
    expect(v!.scale.y).toBeCloseTo(90 / 65, 3); // ala 90/65
    for (const p of v!.ports) {
      expect(p.centerMm).toBeTruthy();
      // Y debe ser ala/2 = 45 — cada eje proyectado independientemente.
      expect(p.centerMm![1]).toBeCloseTo(45, 1);
    }
  });
});

describe('#118 normales ortonormales bajo escala no uniforme', () => {
  it('TRPS-450: todas las normales unitarias y axis-aligned', () => {
    const master = findMasterById('master:perforada:tramo_recto')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_TRPS-450-22-Z',
        sku: 'TRPS-450-22-Z',
        familia_id: 'SAM-STP-Z',
        tipo_pieza: 'recta',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 50,
        longitud_comercial_mm: 2200,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    // TRPS polygon tiene bocas en X=0 (P1) y X=longitud (P2): normales en ±X.
    for (const p of v.ports) {
      expect(p.normal).toBeTruthy();
      expect(unit(p.normal!)).toBeCloseTo(1, 6);
      const [nx, ny, nz] = p.normal!;
      expect(Math.abs(ny) + Math.abs(nz)).toBeLessThan(1e-6);
      expect(Math.abs(nx)).toBeCloseTo(1, 6);
    }
  });

  it('TRES-450-090 (escalera ala-independent): normales unitarias y axis-aligned', () => {
    const master = findMasterById('master:escalera:tramo_recto')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_TRES-450-090-18-Z',
        sku: 'TRES-450-090-18-Z',
        familia_id: 'SAM-STE-Z',
        tipo_pieza: 'recta',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 90,
        longitud_comercial_mm: 3000,
      } as any),
    ];
    const v = enumerateVariantsForMaster(master, productos)[0];
    for (const p of v.ports) {
      expect(p.normal).toBeTruthy();
      expect(unit(p.normal!)).toBeCloseTo(1, 6);
      const [nx, ny, nz] = p.normal!;
      // Ladder outlines tienen normales (±1,0,0) o (0,0,±1) — Y siempre 0.
      expect(Math.abs(ny)).toBeLessThan(1e-9);
      expect(Math.abs(nx) + Math.abs(nz)).toBeCloseTo(1, 6);
    }
  });

  it('resolveRecipeWith(modelFrame rot. pura): preserva ortonormalidad del marco', () => {
    // modelFrame con rotación de 90° en Y — equivale a reorientar el STEP; no
    // escala. El marco (normal, u_dir, v_dir) debe permanecer ortonormal.
    const recipe = buildRecipeFor('tramo_recto', {
      ancho_mm: 450,
      ala_mm: 65,
      longitud_mm: 2200,
    });
    const resolved = resolveRecipeWith(
      recipe,
      { rx_deg: 0, ry_deg: 90, rz_deg: 0, tx_mm: 0, ty_mm: 0, tz_mm: 0 },
      {},
    );
    for (const p of resolved.recipe.ports) {
      const n = new THREE.Vector3(...p.normal);
      const u = new THREE.Vector3(...p.u_dir);
      const v = new THREE.Vector3(...p.v_dir);
      expect(n.length()).toBeCloseTo(1, 6);
      expect(u.length()).toBeCloseTo(1, 6);
      expect(v.length()).toBeCloseTo(1, 6);
      expect(Math.abs(u.dot(v))).toBeLessThan(1e-6);
      expect(Math.abs(u.dot(n))).toBeLessThan(1e-6);
      expect(Math.abs(v.dot(n))).toBeLessThan(1e-6);
    }
  });

  it('resolveRecipeWith(portGeometry override absoluto): no re-escala, pero mantiene unitarias las normales', () => {
    // Hipótesis: si el usuario pega una normal no-unitaria (p.ej. (2,0,0)),
    // el resolver debería ingerir tal cual (es el contrato actual — no
    // re-normaliza silenciosamente) PERO si es rotación pura (modelFrame=null)
    // y la normal viene ya unitaria desde la receta, debe seguir unitaria.
    const recipe = buildRecipeFor('tramo_recto', {
      ancho_mm: 300,
      ala_mm: 65,
      longitud_mm: 2200,
    });
    // Override centerMm absoluto (-185, 125, -150). El resolver lo ingiere
    // AS-IS para la pieza en su ancho (300). Esto es el contrato: no mezcla
    // frames entre variantes; cada producto_id maneja su propio override.
    const resolved = resolveRecipeWith(
      recipe,
      null,
      {
        [recipe.ports[0]!.name]: {
          centerMm: [-185, 125, -150] as const,
        },
      },
    );
    expect(resolved.recipe.ports[0]!.center).toEqual([-185, 125, -150]);
    // Normal no fue tocada por el override → sigue siendo la de la receta.
    expect(unit(resolved.recipe.ports[0]!.normal)).toBeCloseTo(1, 6);
  });
});
