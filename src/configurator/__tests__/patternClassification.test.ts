// @vitest-environment node
/**
 * patternClassification — pruebas de la clasificación patrón/variante.
 *
 * Qué defiende:
 *   - Producto con `origin='base'` y primer SKU alfabético → kind='pattern'.
 *   - Producto con `origin='base'` pero NO primer alfabético (mismo maestro) →
 *     kind='commercial-associate' y canonicalPatternProductId apunta al primer.
 *   - Producto con `origin ∈ declared/derived/estimated` → kind='variant' con
 *     canonicalPatternProductId del patrón.
 *   - Producto fuera del catalogMatch (familia_id no coincide) → kind='orphan'.
 *   - classifyAll clasifica todo el snapshot de una pasada y produce el mismo
 *     resultado que classifyProduct iterado.
 *   - listCommercialAssociates devuelve productos hermanos de base, NO al propio
 *     patrón.
 *   - computeCanonicalPatternIdsByMaster es determinístico sobre reordenes del
 *     snapshot — depende sólo del orden alfabético de producto_id.
 */
import { describe, expect, it } from 'vitest';
import type { Product } from '../../tray/model';
import {
  classifyAll,
  classifyProduct,
  computeCanonicalPatternIdsByMaster,
  listCommercialAssociates,
} from '../patternClassification';

function makeProduct(partial: Partial<Product> & { producto_id: string; sku: string }): Product {
  return {
    descripcion_original: '',
    tipo_pieza: 'recta',
    ancho_nominal_mm: 300,
    ...partial,
  } as Product;
}

// Snapshot mínimo: maestro TRPS (ancho=300, ala=50) con dos base (acabado Z y
// ZN → associates), una variante 450 declared, y un huérfano sin familia.
function snapshotMixed(): Product[] {
  return [
    makeProduct({
      producto_id: 'SAM_TRPS-300-22-Z',
      sku: 'TRPS-300-22-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 2200,
    } as unknown as Partial<Product> & { producto_id: string; sku: string }),
    makeProduct({
      producto_id: 'SAM_TRPS-300-22-ZN',
      sku: 'TRPS-300-22-ZN',
      familia_id: 'SAM-STP-ZN',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 2200,
    } as unknown as Partial<Product> & { producto_id: string; sku: string }),
    makeProduct({
      producto_id: 'SAM_TRPS-450-22-Z',
      sku: 'TRPS-450-22-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 2200,
    } as unknown as Partial<Product> & { producto_id: string; sku: string }),
    makeProduct({
      producto_id: 'SAM_UNMAPPED',
      sku: 'UNMAPPED',
      familia_id: 'FAMILIA-DESCONOCIDA',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
    } as unknown as Partial<Product> & { producto_id: string; sku: string }),
  ];
}

describe('classifyProduct', () => {
  it('primer base alfabético del maestro → pattern', () => {
    const snap = snapshotMixed();
    const trps = snap.find((p) => p.producto_id === 'SAM_TRPS-300-22-Z')!;
    const c = classifyProduct(trps, snap);
    expect(c.kind).toBe('pattern');
    expect(c.master?.id).toBe('master:perforada:tramo_recto');
    expect(c.canonicalPatternProductId).toBe('SAM_TRPS-300-22-Z');
  });

  it('segundo base del mismo maestro → commercial-associate', () => {
    const snap = snapshotMixed();
    const trpsZN = snap.find((p) => p.producto_id === 'SAM_TRPS-300-22-ZN')!;
    const c = classifyProduct(trpsZN, snap);
    expect(c.kind).toBe('commercial-associate');
    expect(c.canonicalPatternProductId).toBe('SAM_TRPS-300-22-Z');
  });

  it('variante dimensional (ancho distinto) → variant', () => {
    const snap = snapshotMixed();
    const trps450 = snap.find((p) => p.producto_id === 'SAM_TRPS-450-22-Z')!;
    const c = classifyProduct(trps450, snap);
    expect(c.kind).toBe('variant');
    // Cualquier origen de variación aplica (declared/derived/measured/estimated).
    expect(['declared', 'derived', 'measured', 'estimated']).toContain(c.variant?.origin);
    expect(c.canonicalPatternProductId).toBe('SAM_TRPS-300-22-Z');
  });

  it('producto sin familia conocida → orphan', () => {
    const snap = snapshotMixed();
    const orphan = snap.find((p) => p.producto_id === 'SAM_UNMAPPED')!;
    const c = classifyProduct(orphan, snap);
    expect(c.kind).toBe('orphan');
    expect(c.master).toBeNull();
    expect(c.canonicalPatternProductId).toBeNull();
  });
});

describe('classifyAll', () => {
  it('reproduce classifyProduct para cada producto del snapshot', () => {
    const snap = snapshotMixed();
    const all = classifyAll(snap);
    for (const p of snap) {
      const single = classifyProduct(p, snap);
      const bulk = all.get(p.producto_id)!;
      expect(bulk.kind).toBe(single.kind);
      expect(bulk.canonicalPatternProductId).toBe(single.canonicalPatternProductId);
      expect(bulk.master?.id ?? null).toBe(single.master?.id ?? null);
    }
  });
});

describe('computeCanonicalPatternIdsByMaster', () => {
  it('es estable frente a reordenes del snapshot', () => {
    const a = snapshotMixed();
    const b = [...a].reverse();
    const mapA = computeCanonicalPatternIdsByMaster(a);
    const mapB = computeCanonicalPatternIdsByMaster(b);
    expect(mapA.get('master:perforada:tramo_recto')).toBe(
      mapB.get('master:perforada:tramo_recto'),
    );
    expect(mapA.get('master:perforada:tramo_recto')).toBe('SAM_TRPS-300-22-Z');
  });
});

describe('listCommercialAssociates', () => {
  it('excluye al propio patrón y lista sólo otros base del mismo maestro', () => {
    const snap = snapshotMixed();
    const trps = snap.find((p) => p.producto_id === 'SAM_TRPS-300-22-Z')!;
    const assoc = listCommercialAssociates(trps, snap);
    expect(assoc.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-ZN']);
  });

  it('variante declarada NO aparece como associate (deltaAncho≠0)', () => {
    const snap = snapshotMixed();
    const trps = snap.find((p) => p.producto_id === 'SAM_TRPS-300-22-Z')!;
    const assoc = listCommercialAssociates(trps, snap);
    expect(assoc.find((p) => p.producto_id === 'SAM_TRPS-450-22-Z')).toBeUndefined();
  });
});
