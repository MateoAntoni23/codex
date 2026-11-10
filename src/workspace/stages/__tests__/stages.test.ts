import { describe, expect, it } from 'vitest';
import { stageForSelection } from '../stageModel';
import { summarizeResult } from '../resultPresentation';
import { indexProducts, pieceLabel, pieceLabelById, portLabel, productLabel } from '../displayNames';
import type { Piece, Product } from '../../../tray/model';

describe('stageForSelection (decisión 3b: cambio automático de etapa)', () => {
  it('una pieza elegida desde Equipos lleva a Bandejas', () => {
    expect(stageForSelection('equipos', 'piece')).toBe('bandejas');
  });
  it('una pieza elegida en Resultados se queda en Resultados', () => {
    expect(stageForSelection('resultados', 'piece')).toBe('resultados');
  });
  it('un equipo elegido desde Bandejas lleva a Equipos; infraestructura a Planta', () => {
    expect(stageForSelection('bandejas', 'equipment')).toBe('equipos');
    expect(stageForSelection('equipos', 'infrastructure')).toBe('planta');
  });
  it('continuar trazado y unir extremos son de Bandejas', () => {
    expect(stageForSelection('conexiones', 'routing')).toBe('bandejas');
    expect(stageForSelection('resultados', 'join-tool')).toBe('bandejas');
  });
});

describe('summarizeResult (B6: PE sin definir)', () => {
  // Forma real devuelta por el motor 0.2.2 para un tramo sin bloque pe.
  const sinPe = {
    resumen: {
      estado_trazado: 'CON_INCUMPLIMIENTOS',
      incumplimientos: ['cobertura del PE incompleta', 'PE sin conexión al sistema de protección'],
    },
    pe: { estado_requisito: 'SIN_PE_DEFINIDO' },
  };
  it('sólo incumplimientos de PE y PE sin definir → "PE sin definir", tono neutro', () => {
    const v = summarizeResult(sinPe)!;
    expect(v.headline).toBe('PE sin definir');
    expect(v.tone).toBe('neutral');
    expect(v.designIssues).toEqual([]);
    expect(v.peNotes).toHaveLength(2);
  });
  it('otros incumplimientos siguen viéndose como incumplimientos del diseño', () => {
    const v = summarizeResult({
      ...sinPe,
      resumen: { ...sinPe.resumen, incumplimientos: [...sinPe.resumen.incumplimientos, 'ocupación excedida en R1'] },
    })!;
    expect(v.tone).toBe('warn');
    expect(v.designIssues).toEqual(['ocupación excedida en R1']);
    expect(v.headline).not.toBe('PE sin definir');
  });
  it('con PE definido, un incumplimiento de PE es del diseño', () => {
    const v = summarizeResult({ ...sinPe, pe: { estado_requisito: 'DEFINIDO' } })!;
    expect(v.tone).toBe('warn');
    expect(v.designIssues).toHaveLength(2);
  });
  it('sin resultado no hay resumen', () => {
    expect(summarizeResult(null)).toBeNull();
  });
});

describe('displayNames (decisión 3d)', () => {
  const trps = {
    producto_id: 'SAM_TRPS-300-22-Z', sku: 'TRPS-300-22-Z', descripcion_original: 'Tramo recto perforado 300',
    tipo_pieza: 'recta', ancho_nominal_mm: 300, ala_nominal_mm: 50, familia_id: 'SAM-STP-Z',
  } as unknown as Product;
  const idx = indexProducts([trps]);
  const piece = (id: string, producto = trps.producto_id): Piece => ({ instancia_id: id, producto_id: producto, puertos: {} });

  it('pieza: SKU con número de orden en vez del instancia_id', () => {
    expect(pieceLabel(piece('SEG-4'), 2, idx)).toBe('2. TRPS-300-22-Z');
    expect(pieceLabelById('B', [piece('A'), piece('B')], idx)).toBe('2. TRPS-300-22-Z');
  });
  it('sin producto legible se muestra el id (no se inventa)', () => {
    expect(pieceLabel(piece('X1', 'NO_EXISTE'), 1, idx)).toBe('X1');
    expect(productLabel('NO_EXISTE', idx)).toBe('NO_EXISTE');
  });
  it('boca: physicalLabel del maestro', () => {
    expect(portLabel(trps.producto_id, 'P1', idx)).toBe('Boca x_min');
    expect(portLabel(trps.producto_id, 'P9', idx)).toBe('P9');
  });
});
