/**
 * productFilters — regresión de la cascada compartida Configurador ↔ workspace.
 *
 * Qué defiende:
 *   - `matchesFilter` aplica todos los niveles combinando catálogo y familias.
 *   - `computeFilterOptions` deriva opciones sólo sobre el conjunto filtrado
 *     por los niveles anteriores (sistema → tipo → ancho → ala → acabado →
 *     espesor), no sobre su propio nivel ni sobre el texto libre.
 *   - "No declarado" para ala/ancho/espesor/acabado produce etiquetas
 *     estables y ordena al final.
 *   - `applyCascade` limpia los niveles posteriores pero preserva texto libre.
 */
import { describe, expect, it } from 'vitest';
import type { CatalogFamily, Product } from '../../tray/model';
import {
  ALA_NO_DECLARADA,
  ANCHO_NO_DECLARADO,
  ESPESOR_NO_DECLARADO,
  applyCascade,
  buildFamiliasById,
  computeFilterOptions,
  EMPTY_FILTERS,
  matchesFilter,
  type Filters,
} from '../productFilters';

type P = Product & { familia_id?: string; ala_nominal_mm?: number; espesor_chapa_mm?: number };

function makeProduct(partial: Partial<P> & { producto_id: string }): P {
  return {
    descripcion_original: '',
    tipo_pieza: 'recta',
    ancho_nominal_mm: 300,
    sku: partial.producto_id,
    ...partial,
  } as P;
}

function makeFamilia(id: string, acabado: string | null): CatalogFamily {
  return {
    familia_id: id,
    nombre_familia: id,
    acabado_normalizado: acabado,
    material: null,
    fabricante: null,
  };
}

const FAMILIAS: CatalogFamily[] = [
  makeFamilia('SAM-STP-Z', 'z'),         // perforada, acabado Z
  makeFamilia('SAM-STP-ZN', 'zn'),       // perforada, acabado ZN
  makeFamilia('SAM-STE-G', 'g'),         // escalera-g
];

const PRODUCTS: P[] = [
  makeProduct({ producto_id: 'A', familia_id: 'SAM-STP-Z', tipo_pieza: 'recta', ancho_nominal_mm: 300, ala_nominal_mm: 50, espesor_chapa_mm: 1.6 }),
  makeProduct({ producto_id: 'B', familia_id: 'SAM-STP-Z', tipo_pieza: 'recta', ancho_nominal_mm: 450, ala_nominal_mm: 50, espesor_chapa_mm: 1.6 }),
  makeProduct({ producto_id: 'C', familia_id: 'SAM-STP-ZN', tipo_pieza: 'recta', ancho_nominal_mm: 300, ala_nominal_mm: 50, espesor_chapa_mm: 2.0 }),
  makeProduct({ producto_id: 'D', familia_id: 'SAM-STE-G', tipo_pieza: 'recta', ancho_nominal_mm: 300, ala_nominal_mm: 65, espesor_chapa_mm: 2.5 }),
  makeProduct({ producto_id: 'E', familia_id: 'SAM-STP-Z', tipo_pieza: 'curva', ancho_nominal_mm: 300, ala_nominal_mm: 50, espesor_chapa_mm: 1.6 }),
  // Producto con ala no declarada: debería caer bajo la sentinela ALA_NO_DECLARADA.
  makeProduct({ producto_id: 'F', familia_id: 'SAM-STP-Z', tipo_pieza: 'recta', ancho_nominal_mm: 300, espesor_chapa_mm: 1.6 }),
];

const familiasById = buildFamiliasById(FAMILIAS);

describe('matchesFilter', () => {
  it('sin filtros, todo pasa', () => {
    for (const p of PRODUCTS) {
      expect(matchesFilter(p, EMPTY_FILTERS, familiasById)).toBe(true);
    }
  });

  it('filtro de sistema deja fuera productos de otra familia', () => {
    const f: Filters = { ...EMPTY_FILTERS, sistema: 'perforada' };
    expect(matchesFilter(PRODUCTS[0], f, familiasById)).toBe(true);   // SAM-STP-Z
    expect(matchesFilter(PRODUCTS[3], f, familiasById)).toBe(false);  // SAM-STE-G
  });

  it('filtro combinado tipo+ancho+ala descarta no-coincidencias', () => {
    const f: Filters = { ...EMPTY_FILTERS, tipoPieza: 'recta', ancho: '300', ala: '50' };
    expect(matchesFilter(PRODUCTS[0], f, familiasById)).toBe(true);
    expect(matchesFilter(PRODUCTS[1], f, familiasById)).toBe(false);  // ancho 450
    expect(matchesFilter(PRODUCTS[3], f, familiasById)).toBe(false);  // ala 65
    expect(matchesFilter(PRODUCTS[4], f, familiasById)).toBe(false);  // tipoPieza curva
  });

  it('ala no declarada se filtra por la sentinela', () => {
    const f: Filters = { ...EMPTY_FILTERS, ala: ALA_NO_DECLARADA };
    expect(matchesFilter(PRODUCTS[5], f, familiasById)).toBe(true);
    expect(matchesFilter(PRODUCTS[0], f, familiasById)).toBe(false);
  });

  it('texto libre busca en producto_id, sku y descripcion', () => {
    const custom = makeProduct({ producto_id: 'Z1', descripcion_original: 'Bandeja especial' });
    const f: Filters = { ...EMPTY_FILTERS, text: 'especial' };
    expect(matchesFilter(custom, f, familiasById)).toBe(true);
    expect(matchesFilter(PRODUCTS[0], f, familiasById)).toBe(false);
  });
});

describe('computeFilterOptions — cascada dependiente', () => {
  it('con sistema=perforada, tipos incluyen los de SAM-STP-Z / SAM-STP-ZN', () => {
    const opts = computeFilterOptions(
      PRODUCTS,
      { ...EMPTY_FILTERS, sistema: 'perforada' },
      familiasById,
    );
    expect([...opts.tiposPieza].sort()).toEqual(['curva', 'recta'].sort());
  });

  it('con tipoPieza=recta, los anchos no incluyen los de curvas', () => {
    const opts = computeFilterOptions(
      PRODUCTS,
      { ...EMPTY_FILTERS, tipoPieza: 'recta' },
      familiasById,
    );
    // 300 y 450 son los únicos anchos entre las rectas.
    expect([...opts.anchos].sort()).toEqual(['300', '450'].sort());
  });

  it('con ancho=300, las alas se derivan sólo del subconjunto ancho=300', () => {
    const opts = computeFilterOptions(
      PRODUCTS,
      { ...EMPTY_FILTERS, ancho: '300' },
      familiasById,
    );
    // 50 (A, C, E), 65 (D), y ALA_NO_DECLARADA (F).
    expect(opts.alas).toContain('50');
    expect(opts.alas).toContain('65');
    expect(opts.alas).toContain(ALA_NO_DECLARADA);
  });

  it('con ala=50 fijada, el acabado lista z y zn pero no g', () => {
    const opts = computeFilterOptions(
      PRODUCTS,
      { ...EMPTY_FILTERS, tipoPieza: 'recta', ala: '50' },
      familiasById,
    );
    expect(opts.acabados).toContain('z');
    expect(opts.acabados).toContain('zn');
    expect(opts.acabados).not.toContain('g');
  });

  it('con acabado=z, los espesores filtran a los de productos Z', () => {
    const opts = computeFilterOptions(
      PRODUCTS,
      { ...EMPTY_FILTERS, acabado: 'z' },
      familiasById,
    );
    // Productos con acabado=z: A, B, E, F (todos 1.6)
    expect(opts.espesores).toEqual(['1.6']);
  });

  it('las sentinelas se ordenan al final', () => {
    const opts = computeFilterOptions(
      PRODUCTS,
      { ...EMPTY_FILTERS, ancho: '300' },
      familiasById,
    );
    // ALA_NO_DECLARADA debe ser el último elemento de la lista ordenada.
    expect(opts.alas[opts.alas.length - 1]).toBe(ALA_NO_DECLARADA);
  });

  it('sin productos declarando espesor, la sentinela aparece', () => {
    const noEspesor = [makeProduct({ producto_id: 'X', espesor_chapa_mm: undefined, familia_id: 'SAM-STP-Z' })];
    const opts = computeFilterOptions(noEspesor, EMPTY_FILTERS, familiasById);
    expect(opts.espesores).toEqual([ESPESOR_NO_DECLARADO]);
  });

  it('sin productos declarando ancho, la sentinela aparece', () => {
    const noAncho = [
      // ancho_nominal_mm=null en tipos: el helper devuelve ANCHO_NO_DECLARADO.
      {
        producto_id: 'Y', descripcion_original: '', tipo_pieza: 'recta',
        ancho_nominal_mm: null, sku: 'Y', familia_id: 'SAM-STP-Z',
      } as Product,
    ];
    const opts = computeFilterOptions(noAncho, EMPTY_FILTERS, familiasById);
    expect(opts.anchos).toEqual([ANCHO_NO_DECLARADO]);
  });
});

describe('applyCascade — limpieza aguas abajo', () => {
  it('cambiar sistema limpia tipo/ancho/ala/acabado/espesor pero preserva texto', () => {
    const current: Filters = {
      text: 'xyz',
      sistema: 'escalera-g',
      tipoPieza: 'recta',
      ancho: '300',
      ala: '50',
      acabado: 'g',
      espesor: '2.5',
    };
    const next = applyCascade(current, 'sistema', 'perforada');
    expect(next.sistema).toBe('perforada');
    expect(next.tipoPieza).toBe('');
    expect(next.ancho).toBe('');
    expect(next.ala).toBe('');
    expect(next.acabado).toBe('');
    expect(next.espesor).toBe('');
    expect(next.text).toBe('xyz');
  });

  it('cambiar ancho limpia ala/acabado/espesor pero preserva sistema+tipo', () => {
    const current: Filters = { ...EMPTY_FILTERS, sistema: 'perforada', tipoPieza: 'recta', ancho: '300', ala: '50', acabado: 'z', espesor: '1.6' };
    const next = applyCascade(current, 'ancho', '450');
    expect(next.sistema).toBe('perforada');
    expect(next.tipoPieza).toBe('recta');
    expect(next.ancho).toBe('450');
    expect(next.ala).toBe('');
    expect(next.acabado).toBe('');
    expect(next.espesor).toBe('');
  });

  it('cambiar espesor (último nivel) no limpia nada', () => {
    const current: Filters = { ...EMPTY_FILTERS, sistema: 'perforada', tipoPieza: 'recta', ancho: '300', ala: '50', acabado: 'z', espesor: '1.6' };
    const next = applyCascade(current, 'espesor', '2.0');
    expect(next).toEqual({ ...current, espesor: '2.0' });
  });

  it('cambiar text no toca ningún otro nivel', () => {
    const current: Filters = { ...EMPTY_FILTERS, sistema: 'perforada', ancho: '300' };
    const next = applyCascade(current, 'text', 'abc');
    expect(next.text).toBe('abc');
    expect(next.sistema).toBe('perforada');
    expect(next.ancho).toBe('300');
  });
});
