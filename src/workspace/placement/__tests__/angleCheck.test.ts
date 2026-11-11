/**
 * El giro que modela cada pieza debe ser el que declara (tolerancia 0,5°).
 *
 * Recorre TODAS las piezas del catálogo con modelo paramétrico y ángulo
 * declarado (`angulo_grados`) y mide el giro entre sus bocas sobre la
 * definición construida (sin la verificación, para poder medirla).
 *
 * DEFECTO CONOCIDO — FALLO ESPERADO (`it.fails`), no skip:
 * el contorno medido de la curva escalera de 45° (CS-300-45-065-18-Z) gira
 * 60,00°, no 45°. Está confirmado contra la extracción del STEP
 * (tools/step_parametric/report/escalera/CS-300-45-065-18-Z__outline.json):
 * las aristas del ancho tienen normales a −30° y +90°. Afecta a las 40
 * variantes CS-*-45 escalera. Se corrige con el archivo STEP original, NO a
 * mano en el polígono ni relajando esta prueba.
 *
 * Esas 40 piezas siguen corriendo la MISMA aserción, marcada con `it.fails`:
 * la suite queda verde y el defecto queda a la vista en el reporte. El día que
 * se corrija el STEP la aserción va a pasar, `it.fails` va a fallar ("expected
 * to fail") y el control de forma del defecto también: hay que sacar la marca
 * (vaciar DEFECTO_CS45_ESCALERA) y borrar el control.
 *
 * El conjunto se elige por SKU, no por medición, para que la marca no se
 * adapte sola a lo que mida el contorno.
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

/**
 * Defecto conocido: curvas escalera de 45° cuyo contorno medido gira 60°.
 * Ver el encabezado. Al corregir el STEP, reemplazar por `/(?!)/` (no coincide
 * con nada) o quitarlo junto con el control de forma.
 */
const DEFECTO_CS45_ESCALERA = /^CS-\d+-45-/;
const MOTIVO_DEFECTO = 'contorno CS-*-45 escalera gira 60° (STEP original, en revisión por el operador)';
const skuDe = (p: Product) => p.sku ?? p.producto_id;
const conDefecto = angulares.filter((p) => DEFECTO_CS45_ESCALERA.test(String(skuDe(p))));
const sanas = angulares.filter((p) => !DEFECTO_CS45_ESCALERA.test(String(skuDe(p))));

function expectGiroDeclarado(product: Product): void {
  const d = buildDefinition(product);
  if (!d.ok) throw new Error(d.motivo);
  const declarado = (product as unknown as Record<string, number>).angulo_grados;
  const medido = measuredTurnDeg(d.def);
  expect(medido, 'pieza angular de dos bocas').not.toBeNull();
  expect(
    Math.abs(medido! - declarado),
    `${product.sku}: el contorno gira ${medido!.toFixed(2)}°, declara ${declarado}°`,
  ).toBeLessThanOrEqual(TOLERANCIA_ANGULO_DEG);
}

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

  it.each(sanas.map((p) => [skuDe(p), p] as const))('%s', (_sku, product) => {
    expectGiroDeclarado(product);
  });

  // FALLO ESPERADO — ver DEFECTO_CS45_ESCALERA. Si alguno de estos pasa, el
  // STEP ya se corrigió: sacar la marca.
  it.fails.each(conDefecto.map((p) => [skuDe(p), p] as const))(`%s [fallo esperado: ${MOTIVO_DEFECTO}]`, (_sku, product) => {
    expectGiroDeclarado(product);
  });

  // Control de la marca: `it.fails` también pasaría si la pieza fallara por
  // otra causa. Esto exige que el fallo sea el documentado (40 piezas, 60,00°).
  // Cuando se corrija el STEP, este control falla a propósito: borrarlo junto
  // con la marca.
  it(`la marca de fallo esperado cubre sólo el defecto documentado (${MOTIVO_DEFECTO})`, () => {
    expect(conDefecto.length, 'variantes CS-*-45 escalera marcadas').toBe(40);
    for (const product of conDefecto) {
      const d = buildDefinition(product);
      if (!d.ok) throw new Error(`${product.sku}: ${d.motivo}`);
      expect((product as unknown as Record<string, number>).angulo_grados, `${product.sku} declara`).toBe(45);
      const medido = measuredTurnDeg(d.def);
      expect(
        medido,
        `${product.sku}: el defecto documentado es un giro de 60,00°; si cambió, revisar el STEP y sacar la marca`,
      ).toBeCloseTo(60, 2);
    }
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
