import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseWorkbook } from './parser';
import {
  exportWorkspace,
  importWorkspace,
  DEFAULT_PROJECT_META,
} from '../workspace/workspaceFile';
import type { TrayInput } from '../tray/model';

const FIXTURE = 'src/import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx';

const TRAY_INPUT: TrayInput = {
  version_contrato: 'trazado/1',
  piezas: [],
  conexiones: [],
  circuitos: [],
  soportes: [],
  pe: {
    seccion_requerida_mm2: 0,
    cable_id: '',
    origen_requisito: 'test',
    conductores: [],
  },
};

describe('A11 — round-trip save/load with importedCatalog', () => {
  it('preserva íntegramente el catálogo importado', async () => {
    const buf = await readFile(FIXTURE);
    const r = await parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    expect(r.catalog).not.toBeNull();
    const catalog = r.catalog!;

    const json = exportWorkspace(
      [], [], DEFAULT_PROJECT_META, TRAY_INPUT,
      undefined, catalog,
    );
    const roundtripped = importWorkspace(json);

    expect(roundtripped.importedCatalog).toBeDefined();
    const back = roundtripped.importedCatalog!.catalog;
    expect(back.equipos.length).toBe(catalog.equipos.length);
    expect(back.atributos.length).toBe(catalog.atributos.length);
    expect(back.conexiones.length).toBe(catalog.conexiones.length);
    expect(back.tendidos.length).toBe(catalog.tendidos.length);
    expect(back.pendientes.length).toBe(catalog.pendientes.length);
    expect(back.meta.fileHash).toBe(catalog.meta.fileHash);
    // CONFLICTO alternatives survive (A14 invariant)
    const conflictos = back.atributos.filter((a) => a.vigente === 'NO');
    expect(conflictos.length).toBe(catalog.atributos.filter((a) => a.vigente === 'NO').length);
    expect(conflictos.length).toBeGreaterThan(0);
  });

  it('exporta sin bloque importedCatalog cuando no hay catálogo', () => {
    const json = exportWorkspace(
      [], [], DEFAULT_PROJECT_META, TRAY_INPUT,
      undefined, null,
    );
    const parsed = JSON.parse(json);
    expect(parsed.importedCatalog).toBeUndefined();
    const roundtripped = importWorkspace(json);
    expect(roundtripped.importedCatalog).toBeUndefined();
  });
});
