/**
 * Tests — continuationCandidates
 *
 * Verifica la clasificación recommended / other y las razones explícitas
 * frente a:
 *   - compatibilidad catalográfica presente (recommended).
 *   - piece_kind no soportado hoy en el flujo interactivo (TPS/XPS/CUPS):
 *     aún con compat catálogo, se marca 'kind_pendiente_insercion'.
 *   - productos paramétricos SIN compat catálogo (other con razón
 *     'compat_no_documentada' + requiresException=true).
 *   - compartir ancho no equivale a compatibilidad (same width != compat).
 *   - priorización intra-grupo: mismo producto primero desde recto, recto
 *     primero desde curva.
 */
import { describe, it, expect } from 'vitest';
import { buildContinuationCandidates } from '../continuationCandidates';
import type { Product } from '../../tray/model';

const TRPS_300: Product = {
  producto_id: 'SAM_TRPS-300-22-Z',
  descripcion_original: 'TRPS-300-22-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  sku: 'TRPS-300-22-Z',
  ala_nominal_mm: 50,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CPS_300_90: Product = {
  producto_id: 'SAM_CPS-300-90-Z',
  descripcion_original: 'CPS-300-90-Z',
  tipo_pieza: 'curva horizontal',
  ancho_nominal_mm: 300,
  sku: 'CPS-300-90-Z',
  ala_nominal_mm: 50,
  radio_mm: 300,
  angulo_grados: 90,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CPS_300_45: Product = {
  producto_id: 'SAM_CPS-300-45-Z',
  descripcion_original: 'CPS-300-45-Z',
  tipo_pieza: 'curva horizontal',
  ancho_nominal_mm: 300,
  sku: 'CPS-300-45-Z',
  ala_nominal_mm: 50,
  radio_mm: 300,
  angulo_grados: 45,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const TPS_300: Product = {
  producto_id: 'SAM_TPS-300-Z',
  descripcion_original: 'TPS-300-Z',
  tipo_pieza: 'T',
  ancho_nominal_mm: 300,
  sku: 'TPS-300-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const XPS_300: Product = {
  producto_id: 'SAM_XPS-300-Z',
  descripcion_original: 'XPS-300-Z',
  tipo_pieza: 'X',
  ancho_nominal_mm: 300,
  sku: 'XPS-300-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CUPS_300_A: Product = {
  producto_id: 'SAM_CUPS-300-A-Z',
  descripcion_original: 'CUPS-300-A-Z',
  tipo_pieza: 'curva vertical exterior',
  ancho_nominal_mm: 300,
  sku: 'CUPS-300-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const TRPS_450: Product = {
  ...TRPS_300,
  producto_id: 'SAM_TRPS-450-22-Z',
  sku: 'TRPS-450-22-Z',
  ancho_nominal_mm: 450,
} as unknown as Product;

const CATALOG = [TRPS_300, CPS_300_45, CPS_300_90, TPS_300, XPS_300, CUPS_300_A, TRPS_450];

describe('buildContinuationCandidates', () => {
  it('desde un recto (TRPS.P2) con compat para TRPS y CPS: ambos en recommended, TRPS primero', () => {
    const compat = new Set(['SAM_TRPS-300-22-Z', 'SAM_CPS-300-90-Z', 'SAM_CPS-300-45-Z']);
    const res = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compat,
    });
    const recommended = res.filter((c) => c.category === 'recommended');
    expect(recommended.map((c) => c.product.producto_id)).toEqual([
      'SAM_TRPS-300-22-Z',
      'SAM_CPS-300-45-Z',
      'SAM_CPS-300-90-Z',
    ]);
    expect(recommended.every((c) => !c.requiresException)).toBe(true);
    expect(recommended.every((c) => c.insertionSupported)).toBe(true);
  });

  it('desde una curva (CPS-90.P2) con compat para TRPS y CPS: TRPS primero (recto desde accesorio)', () => {
    const compat = new Set(['SAM_TRPS-300-22-Z', 'SAM_CPS-300-45-Z', 'SAM_CPS-300-90-Z']);
    const res = buildContinuationCandidates({
      existingProduct: CPS_300_90,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compat,
    });
    const recommended = res.filter((c) => c.category === 'recommended');
    expect(recommended[0].product.producto_id).toBe('SAM_TRPS-300-22-Z');
  });

  it('TPS con compat catálogo + piece_kind habilitado: cae en recommended e insertable', () => {
    const compat = new Set(['SAM_TPS-300-Z']);
    const res = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compat,
    });
    const tps = res.find((c) => c.product.producto_id === 'SAM_TPS-300-Z');
    expect(tps).toBeDefined();
    expect(tps!.category).toBe('recommended');
    expect(tps!.insertionSupported).toBe(true);
  });

  it('control negativo: lo que no está entre los compatibles (regla física) NO se ofrece, ni con excepción', () => {
    // Antes se ofrecía como "compat. no documentada" con excepción. Con la regla física
    // como puerta (compatibilidadFisica.ts), lo que no la cumple no es una continuación.
    const compat = new Set<string>(['SAM_TRPS-300-22-Z']);
    const res = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compat,
    });
    expect(res.find((c) => c.product.producto_id === 'SAM_XPS-300-Z')).toBeUndefined();
    expect(res.every((c) => !c.requiresException)).toBe(true);
  });

  it('compartir ancho no basta: producto NO paramétrico y sin compat no aparece', () => {
    const compat = new Set<string>();
    const noModel: Product = {
      producto_id: 'OTRO-300-XX',
      descripcion_original: 'otro',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      sku: 'OTRO-300-XX',
      familia_id: 'OTRA-FAMILIA',
    } as unknown as Product;
    const res = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: [...CATALOG, noModel],
      compatibleIds: compat,
    });
    expect(res.find((c) => c.product.producto_id === 'OTRO-300-XX')).toBeUndefined();
  });

  it('producto paramétrico pero ancho distinto: no aparece en other', () => {
    const compat = new Set<string>();
    const res = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compat,
    });
    const trps450 = res.find((c) => c.product.producto_id === 'SAM_TRPS-450-22-Z');
    expect(trps450).toBeUndefined();
  });

  it('desde un recto (TRPS), el mismo producto va primero dentro de recommended', () => {
    const compat = new Set(['SAM_TRPS-300-22-Z', 'SAM_CPS-300-45-Z']);
    const res = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compat,
    });
    const recommended = res.filter((c) => c.category === 'recommended');
    expect(recommended[0].product.producto_id).toBe('SAM_TRPS-300-22-Z');
  });

  it('CUPS compatible + piece_kind habilitado: cae en recommended; sin compat NO se ofrece', () => {
    const compatWith = new Set(['SAM_CUPS-300-A-Z']);
    const resWith = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compatWith,
    });
    const cupsWith = resWith.find((c) => c.product.producto_id === 'SAM_CUPS-300-A-Z');
    expect(cupsWith!.category).toBe('recommended');
    expect(cupsWith!.insertionSupported).toBe(true);

    const compatWithout = new Set<string>();
    const resWithout = buildContinuationCandidates({
      existingProduct: TRPS_300,
      existingPortName: 'P2',
      catalogProducts: CATALOG,
      compatibleIds: compatWithout,
    });
    expect(resWithout.find((c) => c.product.producto_id === 'SAM_CUPS-300-A-Z')).toBeUndefined();
  });
});
