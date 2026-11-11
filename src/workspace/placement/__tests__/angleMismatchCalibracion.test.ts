/**
 * Modelo no resuelto por ángulo, con un caso que puede ocurrir hoy.
 *
 * Hasta el 2026-11-11 el caso real era la curva escalera de 45° (su STEP era
 * un codo de 60°). Con el STEP corregido, las 247 piezas del catálogo giran lo
 * que declaran y la rama de rechazo de `angleCheck.test.ts` no se ejecuta con
 * ninguna. Esta prueba la cubre con un dato que el operador sí puede cargar:
 * una calibración de boca que gira la boca P2 de una curva de 90°. La
 * geometría base es la del catálogo; el desajuste lo produce la calibración
 * del patrón (B-2.5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStaticCatalog, seedStaticCatalog } from '../../../catalog/staticCatalog';
import {
  clearCatalogPortIndex,
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  setMasterResolver,
} from '../../catalogPortMapping';
import { buildDefinition, resolveDefinition } from '../definitions';
import { clearBibliotecaCalibracion, setBibliotecaCalibracion } from '../../calibracionPatron';
import { measuredTurnDeg } from '../angleCheck';
import { migrateTray } from '../migration';
import type { Product, TrayInput } from '../../../tray/model';

const SKU = 'CPS-300-90-Z';
const GIRO_CALIBRACION_DEG = 15;
let product: Product;
let products: Map<string, Product>;

/**
 * Calibración del patrón de la CPS-90 (B-2.5): la boca P2 girada
 * GIRO_CALIBRACION_DEG alrededor de su eje vertical, que cambia el giro entre
 * bocas de la curva.
 */
function calibrarP2Girada(): void {
  const base = buildDefinition(product);
  if (!base.ok) throw new Error(base.motivo);
  const patron = base.def.patron;
  setBibliotecaCalibracion({
    version: 'codex:calibracion/2',
    patrones: {
      [patron]: {
        patron,
        motivo: `prueba: boca P2 calibrada girada ${GIRO_CALIBRACION_DEG}°`,
        bocas: { P2: { desplazamiento_mm: { lateral: 0, vertical: 0, axial: 0 }, giro_deg: { lateral: 0, vertical: GIRO_CALIBRACION_DEG, axial: 0 } } },
      },
    },
    excepciones: {},
  });
}

beforeAll(async () => {
  clearPortMappingOverrides();
  const cat = await loadStaticCatalog();
  await seedStaticCatalog();
  products = new Map(cat.productos.map((p) => [p.producto_id, p]));
  const found = cat.productos.find((p) => p.sku === SKU);
  if (!found) throw new Error(`${SKU} no está en el catálogo`);
  product = found;
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

describe('calibración que cambia el giro de una curva → modelo no resuelto', () => {
  it('sin calibración, la curva se resuelve', () => {
    clearBibliotecaCalibracion();
    expect(resolveDefinition(product).ok).toBe(true);
  });

  it('con la boca P2 girada, resolveDefinition la rechaza con el giro medido y el declarado', () => {
    calibrarP2Girada();
    const built = buildDefinition(product);
    if (!built.ok) throw new Error(built.motivo);
    const medido = measuredTurnDeg(built.def)!;
    // 90,25° del contorno ± los 15° de la calibración.
    expect(Math.abs(Math.abs(medido - 90) - GIRO_CALIBRACION_DEG)).toBeLessThan(0.5);
    const r = resolveDefinition(product);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe(
        `modelo no resuelto: el contorno medido gira ${medido.toFixed(2)}° entre bocas y la pieza declara 90° (tolerancia 0,5°)`,
      );
    }
    clearBibliotecaCalibracion();
  });

  it('la migración deja la pieza sin resolver con ese motivo y conserva sus bocas', () => {
    calibrarP2Girada();
    const r = resolveDefinition(product);
    expect(r.ok).toBe(false);
    const puertos = {
      P1: { posicion_mm: [0, 0, 0] as [number, number, number], direccion: [-1, 0, 0] as [number, number, number] },
      P2: { posicion_mm: [600, 600, 0] as [number, number, number], direccion: [0, 1, 0] as [number, number, number] },
    };
    const entrada = {
      version_contrato: 'trazado/1',
      piezas: [{ instancia_id: 'C90', producto_id: product.producto_id, puertos }],
      conexiones: [], circuitos: [], soportes: [],
    } as unknown as TrayInput;
    const { entrada: out, report } = migrateTray(entrada, products);
    expect(report.sinResolver).toEqual([{ id: 'C90', producto_id: product.producto_id, motivo: (r as { motivo: string }).motivo }]);
    expect(out.piezas[0].colocacion).toEqual({ version: 1, estado: 'sin_resolver', motivo: (r as { motivo: string }).motivo });
    expect(out.piezas[0].puertos).toEqual(puertos);
    clearBibliotecaCalibracion();
  });
});
