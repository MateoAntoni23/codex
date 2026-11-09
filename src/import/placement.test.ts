import { describe, it, expect } from 'vitest';
import { buildElementFromImported, mapImportCategoria } from './placement';
import type { EquipoImportado } from './types';

function eq(partial: Partial<EquipoImportado> = {}): EquipoImportado {
  return {
    equipoId: 'EQ-0001',
    tag: 'M-01',
    categoria: 'MOTOR',
    descripcion: 'Motor de prueba',
    proyecto: 'TEST',
    estadoAlcance: 'EXISTENTE',
    estadoAlcanceConfirmado: 'SI',
    fuenteHoja: 'EQUIPOS',
    ...partial,
  };
}

describe('mapImportCategoria', () => {
  it('mapea las 22 categorías del contrato a dominio v2', () => {
    expect(mapImportCategoria('MOTOR')).toBe('motor');
    expect(mapImportCategoria('TABLERO')).toBe('electrical_panel');
    expect(mapImportCategoria('TABLERO_NEUMATICO')).toBe('pneumatic_panel');
    expect(mapImportCategoria('TABLERO_HMI')).toBe('electrical_panel');
    expect(mapImportCategoria('INSTRUMENTO_TRANSMISOR')).toBe('sensor');
    expect(mapImportCategoria('SENSOR_DISCRETO')).toBe('sensor');
    expect(mapImportCategoria('VALVULA_MODULANTE')).toBe('process_valve');
    expect(mapImportCategoria('VALVULA_ONOFF')).toBe('process_valve');
    expect(mapImportCategoria('VALVULA_SOLENOIDE')).toBe('solenoid_valve');
    expect(mapImportCategoria('VALVULA_PROCESO_NEUMATICA')).toBe('process_valve');
    expect(mapImportCategoria('SOLENOIDE_CAMPO')).toBe('solenoid_valve');
    expect(mapImportCategoria('ACTUADOR')).toBe('actuator');
    expect(mapImportCategoria('PARADA_EMERGENCIA')).toBe('pushbutton');
    expect(mapImportCategoria('BOTONERA')).toBe('pushbutton');
    expect(mapImportCategoria('PROYECTOR')).toBe('luminaire');
    expect(mapImportCategoria('BALIZA')).toBe('luminaire');
    expect(mapImportCategoria('CAJA_DERIVACION')).toBe('electrical_panel');
    expect(mapImportCategoria('RACK_RED')).toBe('electrical_panel');
    expect(mapImportCategoria('LUMINARIA_EMERGENCIA')).toBe('luminaire');
    expect(mapImportCategoria('CAMARA')).toBe('sensor');
    expect(mapImportCategoria('EQUIPO_EXISTENTE_TERCEROS')).toBe('infrastructure');
    expect(mapImportCategoria('OTRO')).toBe('infrastructure');
  });

  it('valor desconocido cae a infrastructure (visible para edición, nunca silenciado)', () => {
    expect(mapImportCategoria('NO_EXISTE')).toBe('infrastructure');
    expect(mapImportCategoria('')).toBe('infrastructure');
  });
});

describe('buildElementFromImported', () => {
  const libroId = 'abc123';

  it('usa equipoId como element.id y setea importedRef', () => {
    const el = buildElementFromImported(eq(), { libroId });
    expect(el.id).toBe('EQ-0001');
    expect(el.importedRef).toEqual({ equipoId: 'EQ-0001', libroId });
  });

  it('con positionMm null → unplaced', () => {
    const el = buildElementFromImported(eq(), { libroId });
    expect(el.placementStatus).toBe('unplaced');
    expect(el.transform).toBeNull();
  });

  it('con positionMm → placed con rotación identidad', () => {
    const el = buildElementFromImported(eq(), { libroId, positionMm: { x: 100, y: 200, z: 300 } });
    expect(el.placementStatus).toBe('placed');
    if (el.placementStatus === 'placed') {
      expect(el.transform.positionMm).toEqual({ x: 100, y: 200, z: 300 });
      expect(el.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    }
  });

  it('name: usa descripción si existe, cae a tag si no', () => {
    expect(buildElementFromImported(eq({ descripcion: 'Motor A' }), { libroId }).name).toBe('Motor A');
    expect(buildElementFromImported(eq({ descripcion: '  ', tag: 'M-02' }), { libroId }).name).toBe('M-02');
  });

  it('EstadoAlcance: NUEVO → condition=new, RETIRADO → lifecycle=retired', () => {
    const nuevo = buildElementFromImported(eq({ estadoAlcance: 'NUEVO' }), { libroId });
    expect(nuevo.condition).toBe('new');
    expect(nuevo.lifecycle).toBe('active');

    const retirado = buildElementFromImported(eq({ estadoAlcance: 'RETIRADO' }), { libroId });
    expect(retirado.lifecycle).toBe('retired');
  });

  it('geometría por defecto según categoría — motor es cilindro', () => {
    const el = buildElementFromImported(eq({ categoria: 'MOTOR' }), { libroId });
    expect(el.geometry).toMatchObject({ kind: 'cylinder' });
    expect(el.category).toBe('motor');
  });

  it('geometría por defecto — sensor es caja pequeña', () => {
    const el = buildElementFromImported(eq({ categoria: 'INSTRUMENTO_TRANSMISOR' }), { libroId });
    expect(el.geometry).toMatchObject({ kind: 'box' });
    expect(el.category).toBe('sensor');
  });

  it('ficha técnica con datums unknown (para que el inspector no muestre valores inventados)', () => {
    const el = buildElementFromImported(eq({ categoria: 'MOTOR' }), { libroId });
    if (el.category !== 'motor') throw new Error('expected motor');
    expect(el.technical.power.status).toBe('unknown');
    expect(el.technical.power.value).toBeNull();
  });
});
