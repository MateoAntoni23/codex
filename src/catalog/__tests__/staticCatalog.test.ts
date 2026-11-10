import { describe, expect, it } from 'vitest';
import golden from './fixtures/cable_ids.motor.json';
import {
  buildStaticCatalog,
  catalogFingerprint,
  deriveCableIds,
  loadStaticCatalog,
  seedStaticCatalog,
  staticContext,
} from '../staticCatalog';
import {
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  getModelFrameOverride,
  setMasterResolver,
  setPortMappingOverrides,
  type ProductPortMapping,
} from '../../workspace/catalogPortMapping';

describe('catálogo estático (sin motor)', () => {
  it('lee productos, puertos, compatibilidades, uniones y familias de los archivos del motor', async () => {
    const c = await loadStaticCatalog();
    expect(c.productos).toHaveLength(896);
    expect(c.puertos).toHaveLength(1437);
    expect(c.compatibilidades).toHaveLength(2514);
    expect(c.componentesUnion).toHaveLength(1859);
    expect(c.familias).toHaveLength(9);
    expect(c.productos.every((p) => typeof p.producto_id === 'string' && typeof p.tipo_pieza === 'string')).toBe(true);
  });

  it('los ids de cable derivados de los datasets == los que publica el motor (fixture generado con el motor)', async () => {
    const c = await loadStaticCatalog();
    expect(c.cables).toEqual(golden);
    expect(golden).toHaveLength(113);
  });

  it('deriveCableIds reproduce la regla PREFIJO-MATERIAL-NxFORMACION[-NI] con coma → punto', () => {
    const ids = deriveCableIds([
      {
        dataset_id: 'PRY-SINTENAX-VALIO-ED2020',
        tablas: [
          { material: 'cobre', n_conductores: 1, tipo: 'unipolar', filas: [['1,5', 1, 1]] },
          { material: 'aluminio', n_conductores: 4, tipo: 'tetrapolar_neutro_igual', filas: [['25', 1, 1]] },
        ],
      },
    ]);
    expect(ids).toEqual(['PRY-SVALIO-AL-4x25-NI', 'PRY-SVALIO-CU-1x1.5']);
  });

  it('la huella no depende del orden y cambia si cambia el contenido', async () => {
    const c = await loadStaticCatalog();
    const base = { PRODUCTOS: [{ producto_id: 'A' }, { producto_id: 'B' }], PUERTOS_PRODUCTO: [], COMPATIBILIDADES: [], COMPONENTES_UNION: [], FAMILIAS: [] };
    const swapped = { ...base, PRODUCTOS: [{ producto_id: 'B' }, { producto_id: 'A' }] };
    const other = { ...base, PRODUCTOS: [{ producto_id: 'A' }, { producto_id: 'C' }] };
    expect(catalogFingerprint(base, [])).toBe(catalogFingerprint(swapped, []));
    expect(catalogFingerprint(base, [])).not.toBe(catalogFingerprint(other, []));
    expect(typeof c.fingerprint).toBe('string');
    expect(c.decisionesSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza un snapshot sin PRODUCTOS válidos', () => {
    expect(() =>
      buildStaticCatalog({ catalogoJson: '{"PRODUCTOS":[{"x":1}]}', cablesJson: [], ejemplosJson: {}, decisionesSha256: 'x' }),
    ).toThrow(/CATALOGO_ESTATICO_INVALIDO/);
  });

  it('seedStaticCatalog siembra índice + resolvedor de maestros: una variante hereda la calibración del maestro', async () => {
    clearPortMappingOverrides();
    clearProductCatalogIndex();
    setMasterResolver(null);
    // Sin sembrar, la herencia maestro → variante no existe.
    const mapping: ProductPortMapping = {
      productId: 'SAM_TRPS-300-22-Z',
      source: 'override',
      entries: [],
      modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 90, tx_mm: 0, ty_mm: 0, tz_mm: 0 },
    };
    setPortMappingOverrides({ 'SAM_TRPS-300-22-Z': mapping });
    expect(getModelFrameOverride('SAM_TRPS-450-20-Z')).toBeNull();

    const c = await seedStaticCatalog();
    expect(getModelFrameOverride('SAM_TRPS-450-20-Z')?.rz_deg).toBe(90);

    const ctx = staticContext(c);
    expect(ctx.productos).toBe(c.productos);
    expect(ctx.ejemplos.trazado_derivacion_pe).toBeDefined();
    expect(ctx.versions.startsWith('static:')).toBe(true);
    clearPortMappingOverrides();
  });
});
