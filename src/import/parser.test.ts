import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseWorkbook } from './parser';

const FIXTURE = resolve(__dirname, 'fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx');

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE);
  // Garantizar que entregamos un ArrayBuffer exacto (no Node Buffer).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

describe('parseWorkbook — libro de referencia Rev0', () => {
  it('abre el libro sin errores (A1/A4)', async () => {
    const r = await parseWorkbook(loadFixture(), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    const errors = r.issues.filter((i) => i.severity === 'ERROR');
    if (errors.length > 0) {
      // Mostrar los primeros para diagnosticar antes de fallar.
      console.error('Errores inesperados:', errors.slice(0, 5));
    }
    expect(errors).toHaveLength(0);
    expect(r.catalog).not.toBeNull();
  });

  it('conteos de la vista previa (A6)', async () => {
    const r = await parseWorkbook(loadFixture(), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    expect(r.catalog).not.toBeNull();
    const c = r.counts;
    // Contrato §12 A6.
    expect(c.equiposActivos).toBe(260);
    expect(c.equiposRetirados).toBe(16);
    expect(c.componentes).toBe(171);
    expect(c.atributos).toBe(2442);
    expect(c.conexiones).toBe(272);
    expect(c.conexionesPorServicio.POTENCIA).toBe(104);
    expect(c.conexionesPorServicio.CONTROL).toBe(67);
    expect(c.conexionesPorServicio.INSTRUMENTACION).toBe(50);
    expect(c.conexionesPorServicio.NEUMATICA).toBe(42);
    expect(c.conexionesPorServicio.COMUNICACION).toBe(7);
    expect(c.conexionesPorServicio.EQUIPOTENCIALIDAD).toBe(2);
    expect(c.tendidos).toBe(279);
    expect(c.tendidosPorNaturaleza.CABLE_MULTIPOLAR).toBe(215);
    expect(c.tendidosPorNaturaleza.TUBO).toBe(42);
    expect(c.tendidosPorNaturaleza.CONDUCTOR_UNIPOLAR).toBe(15);
    expect(c.tendidosPorNaturaleza.CABLE_DATOS).toBe(7);
    expect(c.alias).toBe(72);
    expect(c.pendientes).toBe(93);
    expect(c.pendientesPorSeveridad.ADVERTENCIA).toBe(77);
  });

  it('advertencias V-13 (CX-0010/0209/0210) + V-20 (CONFLICTO)', async () => {
    const r = await parseWorkbook(loadFixture(), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    const v13 = r.issues.filter((i) => i.code === 'V-13');
    // Según §8 hay 3 conexiones con extremo vacío documentado (algunas tienen ambos extremos faltantes).
    const idsV13 = new Set(v13.map((i) => i.recordId));
    expect(idsV13.has('CX-0010')).toBe(true);
    expect(idsV13.has('CX-0209')).toBe(true);
    expect(idsV13.has('CX-0210')).toBe(true);
    const v20 = r.issues.filter((i) => i.code === 'V-20');
    expect(v20.length).toBeGreaterThan(0);
  });

  it('S1-SOP101 (EQ-0026) tiene atributos vigentes y alternativas en CONFLICTO (A10)', async () => {
    const r = await parseWorkbook(loadFixture(), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    const cat = r.catalog!;
    const eq = cat.equipos.find((e) => e.equipoId === 'EQ-0026');
    expect(eq?.tag).toBe('S1-SOP101');
    const atts = cat.atributos.filter((a) => a.equipoId === 'EQ-0026');
    const potVigente = atts.find((a) => a.atributo === 'potencia_kw' && a.vigente === 'SI');
    expect(potVigente?.valorNumero).toBe(7.5);
    expect(potVigente?.origenValor).toBe('ESTIMADO');
    expect(potVigente?.estadoDato).toBe('A_RELEVAR');
    const altHp = atts.find((a) => a.atributo === 'potencia_hp' && a.vigente === 'NO');
    expect(altHp?.valorNumero).toBe(15);
    expect(altHp?.estadoDato).toBe('CONFLICTO');
  });

  it('hash reproducible del archivo (dedup §9.5)', async () => {
    const r1 = await parseWorkbook(loadFixture(), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    const r2 = await parseWorkbook(loadFixture(), 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
    expect(r1.catalog?.meta.fileHash).toBe(r2.catalog?.meta.fileHash);
    expect(r1.catalog?.meta.fileHash).toHaveLength(64);
  });
});
