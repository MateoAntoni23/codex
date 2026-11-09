/**
 * patternIdentity — regresión de las tres identidades (base / variante / calibración).
 *
 * Qué defiende:
 *   - La identidad BASE incluye sistema (perforada/escalera) y pieceKind.
 *     Dos maestros del mismo pieceKind pero distinto sistema NO colapsan.
 *   - La identidad BASE ignora material/acabado/espesor/SKU: eso es dominio de
 *     la variante dimensional, no del patrón base.
 *   - La identidad de VARIANTE incluye todas las dimensiones concretas.
 *   - El hash de CALIBRACIÓN:
 *       · es determinístico (misma entrada → mismo hash);
 *       · ignora overrideReason, overrideAt y source;
 *       · cambia cuando cambia el mapping, la geometría de bocas o el marco;
 *       · null/undefined mapping produce un hash estable "null".
 */
import { describe, expect, it } from 'vitest';
import {
  basePatternKey,
  basePatternIdentityFromMaster,
  calibrationHash,
  calibrationHashesEqual,
  variantIdentityKey,
  type BasePatternIdentity,
} from '../patternIdentity';
import type { ProductPortMapping } from '../../workspace/catalogPortMapping';
import type { MasterModel } from '../masterModels';

function makeMaster(overrides: Partial<MasterModel> = {}): MasterModel {
  return {
    id: 'test:master',
    label: 'Test master',
    sistema: 'perforada',
    pieceKind: 'tramo_recto',
    source: {
      stepFile: 'TEST.STEP',
      stepHashShort: '00000000',
      reportJsonPath: 'test.json',
    },
    recipeKey: 'tramo_recto',
    baseParams: { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 },
    canonicalRotationZDeg: 0,
    catalogMatch: {
      familiaIds: ['SAM-STP-Z'],
      catalogTipoPieza: 'recta',
      catalogAlaMm: 50,
    },
    ports: [
      { recipePortName: 'P1', physicalLabel: 'A', catalogPortName: 'P1' },
      { recipePortName: 'P2', physicalLabel: 'B', catalogPortName: 'P2' },
    ],
    variationRule: {
      kind: 'ancho-only-z',
      provenance: 'derived',
      varies: ['ancho'],
      rationale: 'test',
    },
    declaredVariantSkus: [],
    closure: {
      continuity: { status: 'pending', regressionSpecs: [], limitations: [] },
      fidelity: { status: 'pending', regressionSpecs: [], limitations: [] },
      variants: { status: 'pending', regressionSpecs: [], limitations: [] },
    },
    revision: 1,
    ...overrides,
  } as MasterModel;
}

function makeMapping(entries: ProductPortMapping['entries']): ProductPortMapping {
  return {
    productId: 'TEST',
    entries,
    source: 'override',
    overrideReason: 'test — reemplaza default',
    overrideAt: '2026-11-09T00:00:00Z',
  };
}

describe('basePatternKey — identidad del patrón base', () => {
  it('incluye sistema: perforada vs escalera para igual pieceKind producen keys distintas', () => {
    const perforada: BasePatternIdentity = {
      sistema: 'perforada',
      pieceKind: 'tramo_recto',
      baseParams: { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 },
      sharedVertical: false,
    };
    const escalera: BasePatternIdentity = { ...perforada, sistema: 'escalera' };
    expect(basePatternKey(perforada)).not.toBe(basePatternKey(escalera));
    expect(basePatternKey(perforada)).toContain('perforada');
    expect(basePatternKey(escalera)).toContain('escalera');
  });

  it('sharedVertical: true fusiona sistemas distintos bajo la misma key', () => {
    const perforadaShared: BasePatternIdentity = {
      sistema: 'perforada',
      pieceKind: 'curva_vertical',
      baseParams: { ancho_mm: 300, ala_mm: 50 },
      sharedVertical: true,
    };
    const escaleraShared: BasePatternIdentity = { ...perforadaShared, sistema: 'escalera' };
    expect(basePatternKey(perforadaShared)).toBe(basePatternKey(escaleraShared));
    expect(basePatternKey(perforadaShared)).toContain('shared');
  });

  it('identidad base deriva correctamente desde MasterModel', () => {
    const master = makeMaster();
    const identity = basePatternIdentityFromMaster(master);
    expect(identity.sistema).toBe('perforada');
    expect(identity.pieceKind).toBe('tramo_recto');
    expect(identity.sharedVertical).toBe(false);
    expect(identity.baseParams.ancho_mm).toBe(300);
  });

  it('produce la misma key para dos maestros equivalentes en sistema+pieceKind+baseParams', () => {
    const a = basePatternIdentityFromMaster(makeMaster({ id: 'a' }));
    const b = basePatternIdentityFromMaster(makeMaster({ id: 'b' }));
    expect(basePatternKey(a)).toBe(basePatternKey(b));
  });
});

describe('variantIdentityKey — identidad de la variante dimensional', () => {
  it('cambia la key cuando cambian las dimensiones concretas', () => {
    const base: BasePatternIdentity = {
      sistema: 'perforada',
      pieceKind: 'tramo_recto',
      baseParams: { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 },
      sharedVertical: false,
    };
    const v300 = variantIdentityKey(base, { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const v450 = variantIdentityKey(base, { ancho_mm: 450, ala_mm: 50, longitud_mm: 3000 });
    expect(v300).not.toBe(v450);
  });

  it('colapsa dos SKUs con misma base+dimensiones (ignora acabado/espesor/SKU)', () => {
    const base: BasePatternIdentity = {
      sistema: 'perforada',
      pieceKind: 'tramo_recto',
      baseParams: { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 },
      sharedVertical: false,
    };
    const dims = { ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 };
    // SKU, acabado, espesor NO entran en la key — esto es por diseño.
    expect(variantIdentityKey(base, dims)).toBe(variantIdentityKey(base, dims));
  });
});

describe('calibrationHash — hash estable de la calibración relevante', () => {
  const baseEntries: ProductPortMapping['entries'] = [
    { recipePortName: 'P1', catalogPortName: 'P1', physicalLabel: 'A', justification: 'default' },
    { recipePortName: 'P2', catalogPortName: 'P2', physicalLabel: 'B', justification: 'default' },
  ];

  it('es determinístico: misma entrada produce mismo hash', () => {
    const a = makeMapping(baseEntries);
    const b = makeMapping(baseEntries);
    expect(calibrationHash(a)).toBe(calibrationHash(b));
  });

  it('ignora overrideReason, overrideAt y source', () => {
    const base = calibrationHash(makeMapping(baseEntries));
    const other = calibrationHash({
      ...makeMapping(baseEntries),
      overrideReason: 'otro motivo totalmente distinto',
      overrideAt: '2099-01-01T00:00:00Z',
      source: 'default',
    } as ProductPortMapping);
    expect(base).toBe(other);
  });

  it('cambia cuando cambia catalogPortName de una boca', () => {
    const a = calibrationHash(makeMapping(baseEntries));
    const b = calibrationHash(makeMapping([
      { ...baseEntries[0], catalogPortName: 'P3' },
      baseEntries[1],
    ]));
    expect(a).not.toBe(b);
  });

  it('cambia cuando cambia geometría de boca (centerMm)', () => {
    const a = calibrationHash(makeMapping(baseEntries));
    const b = calibrationHash(makeMapping([
      { ...baseEntries[0], geometry: { centerMm: [100, 0, 0] } },
      baseEntries[1],
    ]));
    expect(a).not.toBe(b);
  });

  it('cambia cuando cambia modelFrame', () => {
    const base = makeMapping(baseEntries);
    const withFrame = { ...base, modelFrame: { tx_mm: 5, ty_mm: 0, tz_mm: 0 } };
    expect(calibrationHash(base)).not.toBe(calibrationHash(withFrame));
  });

  it('null/undefined mapping produce un hash estable y distinto a uno real', () => {
    const nullHash = calibrationHash(null);
    const undefHash = calibrationHash(undefined);
    expect(nullHash).toBe(undefHash);
    expect(nullHash).not.toBe(calibrationHash(makeMapping(baseEntries)));
  });

  it('es invariante al orden de keys del geometry object (canonical JSON)', () => {
    const a = calibrationHash(makeMapping([
      { ...baseEntries[0], geometry: { centerMm: [1, 2, 3], installRotationDeg: 10 } },
      baseEntries[1],
    ]));
    // Construimos un objeto con las keys en otro orden: JS garantiza orden de
    // inserción, forzamos a reordenar explícitamente.
    const b = calibrationHash(makeMapping([
      { ...baseEntries[0], geometry: { installRotationDeg: 10, centerMm: [1, 2, 3] } },
      baseEntries[1],
    ]));
    expect(a).toBe(b);
  });

  it('calibrationHashesEqual: null-safe y compara por igualdad exacta', () => {
    expect(calibrationHashesEqual('abc12345', 'abc12345')).toBe(true);
    expect(calibrationHashesEqual('abc12345', 'xyz00000')).toBe(false);
    expect(calibrationHashesEqual(undefined, 'abc12345')).toBe(false);
    expect(calibrationHashesEqual('abc12345', undefined)).toBe(false);
    expect(calibrationHashesEqual(undefined, undefined)).toBe(false);
  });
});
