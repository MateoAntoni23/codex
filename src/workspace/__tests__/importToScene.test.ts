import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../useWorkspaceStore';
import type { EquipmentElement } from '../../types/domain-v2';
import { IDENTITY_QUATERNION } from '../../types/domain-v2';
import type { ImportedCatalog, EquipoImportado } from '../../import/types';
import { buildElementFromImported } from '../../import/placement';

beforeEach(() => useWorkspaceStore.getState().reset());

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

function catalog(equipos: EquipoImportado[], fileHash = 'a'.repeat(64)): ImportedCatalog {
  return {
    meta: {
      formatoId: 'ELS-IMP-EQCX',
      formatoVersion: '1.0',
      nombreArchivo: 'test.xlsx',
      fileHash,
      importedAt: '2026-11-09T00:00:00.000Z',
    },
    equipos,
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

describe('placeImportedEquipo', () => {
  it('coloca un equipo nuevo y devuelve su id', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    const id = useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 10, y: 20, z: 30 });
    expect(id).toBe('EQ-0001');
    const el = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001');
    expect(el).toBeDefined();
    expect(el?.placementStatus).toBe('placed');
    if (el?.placementStatus === 'placed') {
      expect(el.transform.positionMm).toEqual({ x: 10, y: 20, z: 30 });
    }
    expect(el?.importedRef).toEqual({ equipoId: 'EQ-0001', libroId: 'a'.repeat(64) });
  });

  it('devuelve el elemento existente si ya está vinculado — no duplica', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    const first = useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 0, y: 0, z: 0 });
    const countBefore = useWorkspaceStore.getState().elements.length;
    const second = useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 999, y: 0, z: 0 });
    expect(second).toBe(first);
    expect(useWorkspaceStore.getState().elements.length).toBe(countBefore);
  });

  it('devuelve null si el equipoId no está en el catálogo', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    const id = useWorkspaceStore.getState().placeImportedEquipo('NO-EXISTE', null);
    expect(id).toBeNull();
  });

  it('devuelve null si no hay catálogo', () => {
    const id = useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', null);
    expect(id).toBeNull();
  });
});

describe('linkImportedToElement', () => {
  it('setea importedRef sin crear duplicados', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    const existingEl = buildElementFromImported(
      eq({ equipoId: 'ANY-ID' }),
      { libroId: 'z'.repeat(64), positionMm: { x: 1, y: 2, z: 3 } },
    );
    const manualEl: EquipmentElement = { ...existingEl, id: 'manual-el', importedRef: null };
    s.addElement(manualEl);
    useWorkspaceStore.getState().linkImportedToElement('manual-el', 'EQ-0001');
    const el = useWorkspaceStore.getState().elements.find((e) => e.id === 'manual-el');
    expect(el?.importedRef).toEqual({ equipoId: 'EQ-0001', libroId: 'a'.repeat(64) });
    // Transform preservado
    if (el?.placementStatus === 'placed') {
      expect(el.transform.positionMm).toEqual({ x: 1, y: 2, z: 3 });
    }
  });

  it('transfiere el vínculo: si otro elemento ya estaba ligado, el anterior queda desvinculado', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 0, y: 0, z: 0 });
    const base = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001')!;
    const otherEl: EquipmentElement = { ...base, id: 'other-el', importedRef: null };
    useWorkspaceStore.getState().addElement(otherEl);
    useWorkspaceStore.getState().linkImportedToElement('other-el', 'EQ-0001');
    const anterior = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001');
    const nuevo = useWorkspaceStore.getState().elements.find((e) => e.id === 'other-el');
    expect(anterior?.importedRef).toBeNull();
    expect(nuevo?.importedRef).toEqual({ equipoId: 'EQ-0001', libroId: 'a'.repeat(64) });
  });

  it('no hace nada si el equipoId no está en el catálogo', () => {
    const s = useWorkspaceStore.getState();
    // El proyecto ya no arranca con equipos de demostración: se cargan explícitamente.
    s.loadDemoEquipment();
    s.setImportedCatalog(catalog([eq()]));
    const base = useWorkspaceStore.getState().elements[0];
    const before = { ...base };
    useWorkspaceStore.getState().linkImportedToElement(base.id, 'NO-EXISTE');
    const after = useWorkspaceStore.getState().elements.find((e) => e.id === base.id);
    expect(after?.importedRef).toEqual(before.importedRef ?? null);
  });
});

describe('unlinkElement', () => {
  it('limpia importedRef conservando posición y ficha', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 5, y: 5, z: 5 });
    useWorkspaceStore.getState().unlinkElement('EQ-0001');
    const el = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001');
    expect(el?.importedRef).toBeNull();
    if (el?.placementStatus === 'placed') {
      expect(el.transform.positionMm).toEqual({ x: 5, y: 5, z: 5 });
    }
  });
});

describe('setImportedCatalog — reconciliación', () => {
  it('reimportar actualiza tag y name pero NO toca transform', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq({ tag: 'M-01', descripcion: 'Motor viejo' })]));
    useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 100, y: 200, z: 300 });

    // Reimport con tag/desc modificados y hash distinto
    const next = catalog([eq({ tag: 'M-01-NEW', descripcion: 'Motor renombrado' })], 'b'.repeat(64));
    useWorkspaceStore.getState().setImportedCatalog(next);

    const el = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001');
    expect(el?.tag).toBe('M-01-NEW');
    expect(el?.name).toBe('Motor renombrado');
    expect(el?.importedRef?.libroId).toBe('b'.repeat(64));
    // Transform intacto (requisito A9 del contrato: reimport no toca ubicación)
    if (el?.placementStatus === 'placed') {
      expect(el.transform.positionMm).toEqual({ x: 100, y: 200, z: 300 });
      expect(el.transform.rotation).toEqual(IDENTITY_QUATERNION);
    } else {
      throw new Error('Expected placed element');
    }
  });

  it('reimport con el equipoId ausente → huérfano, elemento conservado intacto', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 10, y: 20, z: 30 });
    const before = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001');

    // Reimport sin el equipo
    useWorkspaceStore.getState().setImportedCatalog(catalog([eq({ equipoId: 'EQ-OTRO' })], 'b'.repeat(64)));
    const after = useWorkspaceStore.getState().elements.find((e) => e.id === 'EQ-0001');
    expect(after?.tag).toBe(before?.tag);
    expect(after?.name).toBe(before?.name);
    // importedRef conservado: sigue apuntando al libro anterior (para que la UI pueda
    // detectar el huérfano y ofrecer opciones al operador).
    expect(after?.importedRef).toEqual(before?.importedRef);
  });

  it('setImportedCatalog(null) limpia el catálogo pero no toca los elementos', () => {
    const s = useWorkspaceStore.getState();
    s.setImportedCatalog(catalog([eq()]));
    useWorkspaceStore.getState().placeImportedEquipo('EQ-0001', { x: 1, y: 1, z: 1 });
    const before = useWorkspaceStore.getState().elements.length;
    useWorkspaceStore.getState().setImportedCatalog(null);
    expect(useWorkspaceStore.getState().importedCatalog).toBeNull();
    expect(useWorkspaceStore.getState().elements.length).toBe(before);
  });
});
