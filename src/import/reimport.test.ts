import { describe, it, expect } from 'vitest';
import { diffCatalogs, summarizeDiff } from './reimport';
import type { ImportedCatalog, EquipoImportado } from './types';

function emptyCatalog(): ImportedCatalog {
  return {
    meta: {
      formatoId: 'ELS-IMP-EQCX',
      formatoVersion: '1.0',
      nombreArchivo: 'test.xlsx',
      fileHash: 'a'.repeat(64),
      importedAt: '2026-11-09T00:00:00.000Z',
    },
    equipos: [],
    componentes: [],
    atributos: [],
    conexiones: [],
    tendidos: [],
    alias: [],
    pendientes: [],
    trazabilidad: [],
    catalogoAtributos: [],
    listas: {},
  };
}

function eq(id: string, tag: string, extra: Partial<EquipoImportado> = {}): EquipoImportado {
  return {
    equipoId: id,
    tag,
    categoria: 'MOTOR',
    descripcion: 'Motor de prueba',
    proyecto: 'TEST',
    estadoAlcance: 'EXISTENTE',
    estadoAlcanceConfirmado: 'SI',
    fuenteHoja: 'manual',
    ...extra,
  };
}

describe('diffCatalogs — reimport', () => {
  it('primera importación: todo es nuevo', () => {
    const next = emptyCatalog();
    next.equipos.push(eq('EQ-0001', 'M-01'), eq('EQ-0002', 'M-02'));
    const d = diffCatalogs(null, next);
    expect(d.nuevos.length).toBe(2);
    expect(d.modificados.length).toBe(0);
    expect(d.huerfanos.length).toBe(0);
    expect(d.sinCambios).toBe(0);
    expect(d.mismoHash).toBe(false);
  });

  it('mismo hash → mismoHash=true, sin cambios', () => {
    const prev = emptyCatalog();
    const next = emptyCatalog();
    prev.equipos.push(eq('EQ-0001', 'M-01'));
    next.equipos.push(eq('EQ-0001', 'M-01'));
    const d = diffCatalogs(prev, next);
    expect(d.mismoHash).toBe(true);
    expect(d.sinCambios).toBe(1);
    expect(d.modificados.length).toBe(0);
  });

  it('modificado → lista campos cambiados y preserva ID', () => {
    const prev = emptyCatalog();
    const next = emptyCatalog();
    next.meta.fileHash = 'b'.repeat(64);
    prev.equipos.push(eq('EQ-0001', 'M-01', { descripcion: 'Antes' }));
    next.equipos.push(eq('EQ-0001', 'M-01', { descripcion: 'Después' }));
    const d = diffCatalogs(prev, next);
    expect(d.modificados).toHaveLength(1);
    expect(d.modificados[0].id).toBe('EQ-0001');
    const campos = d.modificados[0].campos.map((c) => c.campo);
    expect(campos).toContain('descripcion');
  });

  it('huérfano: ID en proyecto y ausente en nuevo libro', () => {
    const prev = emptyCatalog();
    const next = emptyCatalog();
    next.meta.fileHash = 'b'.repeat(64);
    prev.equipos.push(eq('EQ-0001', 'M-01'));
    const d = diffCatalogs(prev, next);
    expect(d.huerfanos).toHaveLength(1);
    expect(d.huerfanos[0].id).toBe('EQ-0001');
  });

  it('conciliación por TAG: equipo nuevo con TAG de un huérfano (distinto equipoId)', () => {
    const prev = emptyCatalog();
    const next = emptyCatalog();
    next.meta.fileHash = 'b'.repeat(64);
    prev.equipos.push(eq('EQ-0001', 'M-01'));
    next.equipos.push(eq('EQ-0099', 'M-01'));
    const d = diffCatalogs(prev, next);
    expect(d.huerfanos).toHaveLength(1);
    expect(d.nuevos.filter((n) => n.kind === 'equipo')).toHaveLength(1);
    expect(d.conciliacionesPorTag).toHaveLength(1);
    expect(d.conciliacionesPorTag[0]).toMatchObject({
      idNuevo: 'EQ-0099',
      tagNuevo: 'M-01',
      idHuerfano: 'EQ-0001',
    });
  });

  it('pasó a RETIRADO: estado cambia en el mismo ID', () => {
    const prev = emptyCatalog();
    const next = emptyCatalog();
    next.meta.fileHash = 'b'.repeat(64);
    prev.equipos.push(eq('EQ-0001', 'M-01', { estadoAlcance: 'EXISTENTE' }));
    next.equipos.push(eq('EQ-0001', 'M-01', { estadoAlcance: 'RETIRADO' }));
    const d = diffCatalogs(prev, next);
    expect(d.pasaronARetirado).toHaveLength(1);
    expect(d.pasaronARetirado[0].id).toBe('EQ-0001');
  });

  it('summarizeDiff produce texto legible', () => {
    const next = emptyCatalog();
    next.equipos.push(eq('EQ-0001', 'M-01'));
    const d = diffCatalogs(null, next);
    const s = summarizeDiff(d);
    expect(s).toContain('1 nuevos');
  });
});
