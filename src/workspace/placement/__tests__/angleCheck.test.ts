/**
 * El giro que modela cada pieza debe ser el que declara (tolerancia 0,5°).
 *
 * Recorre TODAS las piezas del catálogo con modelo paramétrico y ángulo
 * declarado (`angulo_grados`) y mide el giro entre sus bocas sobre la
 * definición construida (sin la verificación, para poder medirla).
 *
 * Mientras el contorno de la curva escalera de 45° (CS-300-45-065-18-Z, que
 * gira 60°) siga como está, los casos CS-45 escalera FALLAN a propósito: es un
 * defecto real del modelo medido y tiene que verse. No marcar como `skip` ni
 * `fails`: se corrige el contorno con el STEP original, no la prueba.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { resolveRecipe } from '../../parametricBridge';
import { buildDefinition, resolveDefinition } from '../definitions';
import { angleMismatch, measuredTurnDeg, TOLERANCIA_ANGULO_DEG, turnDegFromNormals } from '../angleCheck';
import type { Product } from '../../../tray/model';

const snapshot = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8',
)) as { PRODUCTOS: Product[] };

/** Piezas con ángulo declarado y modelo paramétrico (las que se pueden medir). */
const angulares = snapshot.PRODUCTOS.filter((p) =>
  typeof (p as unknown as Record<string, unknown>).angulo_grados === 'number' && resolveRecipe(p) !== null);

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

describe('giro medido entre bocas = ángulo declarado (± 0,5°)', () => {
  it('hay piezas angulares con modelo para medir', () => {
    expect(angulares.length).toBeGreaterThan(0);
  });

  it.each(angulares.map((p) => [p.sku ?? p.producto_id, p] as const))('%s', (_sku, product) => {
    const d = buildDefinition(product);
    if (!d.ok) throw new Error(d.motivo);
    const declarado = (product as unknown as Record<string, number>).angulo_grados;
    const medido = measuredTurnDeg(d.def);
    expect(medido, 'pieza angular de dos bocas').not.toBeNull();
    expect(
      Math.abs(medido! - declarado),
      `${product.sku}: el contorno gira ${medido!.toFixed(2)}°, declara ${declarado}°`,
    ).toBeLessThanOrEqual(TOLERANCIA_ANGULO_DEG);
  });
});

describe('una pieza cuyo giro no coincide es un modelo no resuelto', () => {
  it.each(angulares.map((p) => [p.sku ?? p.producto_id, p] as const))('%s: resolveDefinition acepta sólo si coincide', (_sku, product) => {
    const built = buildDefinition(product);
    if (!built.ok) throw new Error(built.motivo);
    const bad = angleMismatch(built.def);
    const r = resolveDefinition(product);
    if (bad) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe(bad.motivo);
    } else {
      expect(r.ok).toBe(true);
    }
  });

  it('el motivo dice el giro medido y el declarado', () => {
    const def = {
      params: { angulo_deg: 45 },
      ports: [{ normal: [0, 0, 1] }, { normal: [0.866, 0, -0.5] }],
    } as unknown as Parameters<typeof angleMismatch>[0];
    const bad = angleMismatch(def)!;
    expect(bad.medidoDeg).toBeCloseTo(60, 2);
    expect(bad.motivo).toBe('modelo no resuelto: el contorno medido gira 60.00° entre bocas y la pieza declara 45° (tolerancia 0,5°)');
  });

  it('dentro de la tolerancia o sin ángulo declarado: no aplica', () => {
    const p = (n2: number[], angulo?: number) => ({
      params: angulo === undefined ? {} : { angulo_deg: angulo },
      ports: [{ normal: [-1, 0, 0] }, { normal: n2 }],
    }) as unknown as Parameters<typeof angleMismatch>[0];
    const r = (deg: number) => [Math.cos((deg * Math.PI) / 180), 0, Math.sin((deg * Math.PI) / 180)];
    expect(turnDegFromNormals([-1, 0, 0], r(45))).toBeCloseTo(45, 9);
    expect(angleMismatch(p(r(45.4), 45))).toBeNull();
    expect(angleMismatch(p(r(45.6), 45))).not.toBeNull();
    expect(angleMismatch(p(r(60)))).toBeNull();
  });
});
