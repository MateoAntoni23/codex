/**
 * mappingDiff — regresión del comparador puro (hito 3).
 *
 * Qué defiende:
 *   - Identidad: si preview === confirmado, hasChanges === false y los diffs
 *     por boca y modelFrame están vacíos.
 *   - modelFrame: cambios en cualquier eje aparecen en deltas con los valores
 *     numéricos exactos; campos ausentes se tratan como 0.
 *   - Entries: se emparejan por recipePortName independientemente del orden;
 *     altas y bajas se categorizan como added/removed.
 *   - Geometry: vectores (centerMm/normal/uDir/vDir) usan tolerancia 1e-6;
 *     installRotationDeg es escalar.
 *   - String fields: catalogPortName/physicalLabel/justification aparecen
 *     como stringChanges cuando difieren.
 *   - cloneMapping: muta el clon y verifica que el original no cambia (no
 *     comparten referencias de vectores ni entries).
 */
import { describe, expect, it } from 'vitest';
import { cloneMapping, diffMappings } from '../mappingDiff';
import type { ProductPortMapping } from '../../workspace/catalogPortMapping';

function baseMapping(): ProductPortMapping {
  return {
    productId: 'SAM_TEST',
    source: 'override',
    entries: [
      {
        recipePortName: 'P1',
        catalogPortName: 'P1',
        physicalLabel: 'Boca x_min',
        justification: 'calibración pivot',
        geometry: {
          centerMm: [0, 32.5, -150],
          normal: [-1, 0, 0],
          uDir: [0, 0, 1],
          vDir: [0, 1, 0],
          installRotationDeg: 0,
        },
      },
      {
        recipePortName: 'P2',
        catalogPortName: 'P2',
        physicalLabel: 'Boca x_max',
        justification: 'calibración pivot',
      },
    ],
    modelFrame: { rx_deg: 0, ry_deg: 0, rz_deg: 15, tx_mm: 0, ty_mm: 0, tz_mm: 0 },
  };
}

describe('diffMappings', () => {
  it('idéntico: hasChanges false y listas vacías', () => {
    const a = baseMapping();
    const b = baseMapping();
    const d = diffMappings(a, b);
    expect(d.hasChanges).toBe(false);
    expect(d.modelFrame.changed).toBe(false);
    expect(d.ports.every((p) => p.kind === 'unchanged')).toBe(true);
  });

  it('modelFrame distinto: aparece delta exacto y marca changed', () => {
    const a = baseMapping();
    const b = { ...baseMapping(), modelFrame: { ...baseMapping().modelFrame!, rz_deg: 45 } };
    const d = diffMappings(a, b);
    expect(d.modelFrame.changed).toBe(true);
    const rz = d.modelFrame.deltas.find((x) => x.field === 'rz_deg');
    expect(rz?.preview).toBe(15);
    expect(rz?.confirmado).toBe(45);
  });

  it('modelFrame ausente vs presente: ausente se trata como 0', () => {
    const a = { ...baseMapping(), modelFrame: undefined };
    const b = { ...baseMapping(), modelFrame: { rz_deg: 10 } };
    const d = diffMappings(a, b);
    expect(d.modelFrame.changed).toBe(true);
    const rz = d.modelFrame.deltas.find((x) => x.field === 'rz_deg');
    expect(rz?.preview).toBe(0);
    expect(rz?.confirmado).toBe(10);
  });

  it('geometry.centerMm distinto: aparece en vectorChanges', () => {
    // a = preview editado, b = confirmado-baseline (sin tocar).
    const aEntries = baseMapping().entries.map((e) =>
      e.recipePortName === 'P1'
        ? { ...e, geometry: { ...e.geometry!, centerMm: [10, 32.5, -150] as [number, number, number] } }
        : e,
    );
    const a = { ...baseMapping(), entries: aEntries };
    const b = baseMapping();
    const d = diffMappings(a, b);
    expect(d.hasChanges).toBe(true);
    const p1 = d.ports.find((p) => p.recipePortName === 'P1');
    expect(p1?.kind).toBe('changed');
    const center = p1?.vectorChanges.find((v) => v.field === 'centerMm');
    expect(center?.preview).toEqual([10, 32.5, -150]);
    expect(center?.confirmado).toEqual([0, 32.5, -150]);
  });

  it('installRotationDeg distinto: aparece en scalarChanges', () => {
    const aEntries = baseMapping().entries.map((e) =>
      e.recipePortName === 'P1'
        ? { ...e, geometry: { ...e.geometry!, installRotationDeg: 30 } }
        : e,
    );
    const a = { ...baseMapping(), entries: aEntries };
    const b = baseMapping();
    const d = diffMappings(a, b);
    const p1 = d.ports.find((p) => p.recipePortName === 'P1');
    const rot = p1?.scalarChanges.find((s) => s.field === 'installRotationDeg');
    expect(rot?.preview).toBe(30);
    expect(rot?.confirmado).toBe(0);
  });

  it('physicalLabel distinto: aparece en stringChanges', () => {
    const aEntries = baseMapping().entries.map((e) =>
      e.recipePortName === 'P1' ? { ...e, physicalLabel: 'Boca renombrada' } : e,
    );
    const a = { ...baseMapping(), entries: aEntries };
    const b = baseMapping();
    const d = diffMappings(a, b);
    const p1 = d.ports.find((p) => p.recipePortName === 'P1');
    const lbl = p1?.stringChanges.find((s) => s.field === 'physicalLabel');
    expect(lbl?.preview).toBe('Boca renombrada');
    expect(lbl?.confirmado).toBe('Boca x_min');
  });

  it('boca nueva en preview: aparece como added', () => {
    const a = {
      ...baseMapping(),
      entries: [
        ...baseMapping().entries,
        { recipePortName: 'P3', catalogPortName: 'P3', physicalLabel: 'Nueva', justification: 'test' },
      ],
    };
    const b = baseMapping();
    const d = diffMappings(a, b);
    const p3 = d.ports.find((p) => p.recipePortName === 'P3');
    expect(p3?.kind).toBe('added');
  });

  it('boca removida en preview: aparece como removed', () => {
    const a = { ...baseMapping(), entries: baseMapping().entries.slice(0, 1) };
    const b = baseMapping();
    const d = diffMappings(a, b);
    const p2 = d.ports.find((p) => p.recipePortName === 'P2');
    expect(p2?.kind).toBe('removed');
  });

  it('orden de entries invertido no genera falsos positivos', () => {
    const a = baseMapping();
    const b = { ...baseMapping(), entries: [...baseMapping().entries].reverse() };
    const d = diffMappings(a, b);
    expect(d.hasChanges).toBe(false);
  });

  it('tolerancia numérica: diferencia por debajo de 1e-6 se considera igual', () => {
    const a = baseMapping();
    const bEntries = baseMapping().entries.map((e) =>
      e.recipePortName === 'P1'
        ? { ...e, geometry: { ...e.geometry!, centerMm: [1e-9, 32.5, -150] as [number, number, number] } }
        : e,
    );
    const b = { ...baseMapping(), entries: bEntries };
    const d = diffMappings(a, b);
    expect(d.hasChanges).toBe(false);
  });

  it('null vs mapping: todas las entries del otro lado aparecen como removed', () => {
    const d = diffMappings(null, baseMapping());
    expect(d.hasChanges).toBe(true);
    expect(d.ports.length).toBe(2);
    expect(d.ports.every((p) => p.kind === 'removed')).toBe(true);
  });
});

describe('cloneMapping', () => {
  it('muta el clon sin afectar el original', () => {
    const original = baseMapping();
    const copy = cloneMapping(original);
    // Mutaciones sobre el clon: vectores, modelFrame, entries.
    (copy.entries[0].geometry!.centerMm as unknown as number[])[0] = 999;
    (copy.modelFrame as unknown as { rz_deg: number }).rz_deg = 90;
    expect(original.entries[0].geometry?.centerMm?.[0]).toBe(0);
    expect(original.modelFrame?.rz_deg).toBe(15);
  });

  it('preserva campos opcionales: inheritedFromProductId, overrideReason', () => {
    const extended: ProductPortMapping = {
      ...baseMapping(),
      inheritedFromProductId: 'SAM_OTHER',
      overrideReason: 'medición 2026',
      overrideAt: '2026-11-09T00:00:00Z',
    };
    const copy = cloneMapping(extended);
    expect(copy.inheritedFromProductId).toBe('SAM_OTHER');
    expect(copy.overrideReason).toBe('medición 2026');
    expect(copy.overrideAt).toBe('2026-11-09T00:00:00Z');
  });
});
