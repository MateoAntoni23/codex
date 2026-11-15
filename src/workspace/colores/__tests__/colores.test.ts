// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLORES_POR_DEFECTO, COLORES_STORAGE_KEY, FONDO_ESCENA, LEYENDA_STORAGE_KEY, TIPOS_COLOR, tipoColorDe, useColoresStore,
} from '../coloresTipo';
import { contraste, deltaE2000, evaluarPaleta, hexToRgb, MIN_CONTRASTE_FONDO, MIN_DELTA_E, simular } from '../distincion';
import type { CatalogFamily, Product } from '../../../tray/model';

const FAMILIAS = [
  ['SAM-STP-Z', 'perforada'], ['SAM-STP-ZN', 'perforada'], ['SAM-STE-Z', 'escalera'], ['SAM-STE-G', 'escalera'],
  ['SAM-ESC-TRL', 'escalera'], ['FAMIQ-ALAMBRE-INOX', 'alambre'], ['SAM-SMT-ACC', 'otro'], ['GEN-FERR', 'otro'],
].map(([familia_id, tipo_constructivo]) => ({ familia_id, tipo_constructivo, nombre_familia: familia_id, acabado_normalizado: null, material: null, fabricante: null })) as CatalogFamily[];
const prod = (familia_id: string, tipo_pieza: string, sku = 'X') => ({ producto_id: `SAM_${sku}`, sku, familia_id, tipo_pieza } as unknown as Product);

describe('distinción de colores (B6)', () => {
  it('CIEDE2000 coincide con los datos de prueba de Sharma, Wu y Dalal (2005)', () => {
    // Pares 1, 7, 13, 17 y 25 de la tabla publicada.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(deltaE2000([50, 2.5, 0], [50, 3.1736, 0.5854])).toBeCloseTo(1.0, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(deltaE2000([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 4);
  });

  it('contraste WCAG: blanco/negro 21:1; la simulación deja grises sin cambio', () => {
    expect(contraste(hexToRgb('#ffffff'), hexToRgb('#000000'))).toBeCloseTo(21, 6);
    const gris = hexToRgb('#808080');
    for (const v of ['protan', 'deutan'] as const) simular(gris, v).forEach((c, i) => expect(c).toBeCloseTo(gris[i], 2));
  });

  it('la paleta por defecto se distingue entre sí y contra el fondo, también con protanopía y deuteranopía', () => {
    const inf = evaluarPaleta(COLORES_POR_DEFECTO, FONDO_ESCENA);
    expect(inf.peorPar.deltaE, `peor par ${inf.peorPar.a}/${inf.peorPar.b} (${inf.peorPar.vision})`).toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(inf.peorFondo.contraste, `peor contra el fondo ${inf.peorFondo.clave} (${inf.peorFondo.vision})`).toBeGreaterThanOrEqual(MIN_CONTRASTE_FONDO);
    expect(inf.ok).toBe(true);
    // 4 tipos → 6 pares × 3 visiones; 4 × 3 contra el fondo.
    expect(inf.pares).toHaveLength(18);
    expect(inf.fondo).toHaveLength(12);
  });

  it('la paleta anterior (todo celeste, selección amarilla) no pasa: ámbar y amarillo de selección se confunden', () => {
    const inf = evaluarPaleta({ alambre: COLORES_POR_DEFECTO.alambre, seleccion: '#ffcf33' }, FONDO_ESCENA);
    expect(inf.ok).toBe(false);
    expect(inf.peorPar.deltaE).toBeLessThan(MIN_DELTA_E);
  });
});

describe('color por tipo de bandeja (B1)', () => {
  it('por TIPO, no por acabado: perforada zincada y perforada color son del mismo tipo', () => {
    expect(tipoColorDe(prod('SAM-STP-Z', 'recta', 'TRPS-300-22-Z'), FAMILIAS)).toBe('perforada');
    expect(tipoColorDe(prod('SAM-STP-ZN', 'recta', 'TRPS-300-22-ZN'), FAMILIAS)).toBe('perforada');
    expect(tipoColorDe(prod('SAM-STE-Z', 'curva horizontal'), FAMILIAS)).toBe('escalera');
    expect(tipoColorDe(prod('SAM-STE-G', 'T'), FAMILIAS)).toBe('escalera');
    expect(tipoColorDe(prod('SAM-STP-Z', 'curva vertical articulada', 'EPS-300-Z'), FAMILIAS)).toBe('perforada');
    expect(tipoColorDe(prod('FAMIQ-ALAMBRE-INOX', 'recta'), FAMILIAS)).toBe('alambre');
  });

  it('herrajes, soportes y accesorios de unión: gris neutro, aunque sean de una familia de bandeja', () => {
    expect(tipoColorDe(prod('FAMIQ-ALAMBRE-INOX', 'ménsula'), FAMILIAS)).toBe('herraje');
    expect(tipoColorDe(prod('FAMIQ-ALAMBRE-INOX', 'unión'), FAMILIAS)).toBe('herraje');
    expect(tipoColorDe(prod('SAM-SMT-ACC', 'separador', 'BDS090Z'), FAMILIAS)).toBe('herraje');
    expect(tipoColorDe(prod('GEN-FERR', 'varilla roscada'), FAMILIAS)).toBe('herraje');
    expect(tipoColorDe(undefined, FAMILIAS)).toBe('herraje');
  });

  it('sin tabla de familias, por el código de familia publicado', () => {
    expect(tipoColorDe(prod('SAM-STE-Z', 'recta'), undefined)).toBe('escalera');
    expect(tipoColorDe(prod('SAM-STP-ZN', 'recta'), undefined)).toBe('perforada');
  });
});

describe('preferencia de pantalla (B2)', () => {
  beforeEach(() => { localStorage.clear(); useColoresStore.getState().restablecer(); useColoresStore.getState().setLeyendaVisible(true); });

  it('se guarda en localStorage, como el tema; restablecer vuelve a los valores por defecto', () => {
    useColoresStore.getState().setColor('escalera', '#AA2222');
    expect(useColoresStore.getState().colores.escalera).toBe('#aa2222');
    expect(JSON.parse(localStorage.getItem(COLORES_STORAGE_KEY)!).escalera).toBe('#aa2222');
    useColoresStore.getState().restablecer();
    expect(useColoresStore.getState().colores).toEqual(COLORES_POR_DEFECTO);
    expect(localStorage.getItem(COLORES_STORAGE_KEY)).toBeNull();
  });

  it('un valor inválido no se guarda; la leyenda oculta se recuerda', () => {
    useColoresStore.getState().setColor('perforada', 'rojo');
    expect(useColoresStore.getState().colores.perforada).toBe(COLORES_POR_DEFECTO.perforada);
    useColoresStore.getState().setLeyendaVisible(false);
    expect(localStorage.getItem(LEYENDA_STORAGE_KEY)).toBe('oculta');
  });

  it('cubre los cuatro tipos', () => {
    expect(Object.keys(COLORES_POR_DEFECTO).sort()).toEqual([...TIPOS_COLOR].sort());
  });
});
