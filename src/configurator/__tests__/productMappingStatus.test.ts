// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import type { Product } from '../../tray/model';
import {
  clearPortMappingOverrides,
  setPortMappingOverrides,
  type ProductPortMapping,
} from '../../workspace/catalogPortMapping';
import { classifyProductMapping } from '../productMappingStatus';

// Minimal factory: Product has a known shape (producto_id, sku, tipo_pieza, ancho_nominal_mm, descripcion_original)
// plus free-form extras like familia_id. The real Product is `Record<string, unknown> &` the required fields.
function makeProduct(partial: Partial<Product> & { producto_id: string; sku: string }): Product {
  return {
    descripcion_original: partial.descripcion_original ?? '',
    tipo_pieza: partial.tipo_pieza ?? 'recta',
    ancho_nominal_mm: partial.ancho_nominal_mm ?? 300,
    ...partial,
  } as Product;
}

describe('classifyProductMapping', () => {
  beforeEach(() => {
    clearPortMappingOverrides();
  });

  it('no-recipe: SKU que no existe en el catálogo paramétrico', () => {
    const p = makeProduct({ producto_id: 'SAM_INVENTADO-999', sku: 'INVENTADO-999' });
    const info = classifyProductMapping(p);
    expect(info.status).toBe('no-recipe');
    expect(info.insertable).toBe(false);
    expect(info.action).toContain('STEP');
  });

  it('recipe-default-identity: TRPS 2-boca (P1/P2) sin mapping declarado', () => {
    // TRPS-300-22-Z está en PARAMETRIC_CATALOG con piece_kind=tramo_recto.
    const p = makeProduct({ producto_id: 'SAM_TRPS-300-22-Z', sku: 'TRPS-300-22-Z' });
    const info = classifyProductMapping(p);
    expect(info.status).toBe('recipe-default-identity');
    expect(info.insertable).toBe(true);
  });

  it('recipe-default-mapping: TPS 3-boca con DEFAULT_MAPPINGS', () => {
    const p = makeProduct({ producto_id: 'SAM_TPS-300-Z', sku: 'TPS-300-Z' });
    const info = classifyProductMapping(p);
    expect(info.status).toBe('recipe-default-mapping');
    expect(info.insertable).toBe(true);
  });

  it('recipe-override: cuando el usuario grabó un override', () => {
    const productId = 'SAM_TPS-300-Z';
    const override: ProductPortMapping = {
      productId,
      source: 'override',
      overrideReason: 'test',
      overrideAt: '2026-11-08T00:00:00Z',
      entries: [
        { recipePortName: 'tronco_P1', catalogPortName: 'P1', physicalLabel: 'x', justification: 'y' },
        { recipePortName: 'tronco_P2', catalogPortName: 'P2', physicalLabel: 'x', justification: 'y' },
        { recipePortName: 'boca_derivacion', catalogPortName: 'P3', physicalLabel: 'x', justification: 'y' },
      ],
    };
    setPortMappingOverrides({ [productId]: override });
    const p = makeProduct({ producto_id: productId, sku: 'TPS-300-Z' });
    const info = classifyProductMapping(p);
    expect(info.status).toBe('recipe-override');
    expect(info.insertable).toBe(true);
  });
});
