/**
 * Catálogo de cables en cascada (etapa 2). Los ids se contrastan con los del
 * motor: `fixtures/cable_ids_motor.json` es la salida de `RegistroCables` del
 * motor vendorizado (Python) sobre los mismos datasets.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { construirCatalogoCables, formacionesDe, lineaCorta, lineas, textoCable, tiposDe } from '../catalogoCables';

const DIR = resolve(__dirname, '../../../../vendor/motor_bandejas/datos/cables');
const datasets = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')));
const idsMotor = (JSON.parse(readFileSync(resolve(__dirname, 'fixtures/cable_ids_motor.json'), 'utf8')) as { cable_ids: string[] }).cable_ids;

describe('catálogo de cables', () => {
  it('arma los 113 cables con los mismos ids que el motor, uno a uno', () => {
    const r = construirCatalogoCables(datasets, idsMotor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cables).toHaveLength(113);
    expect(idsMotor).toHaveLength(113);
    expect(r.cables.map((c) => c.cable_id).sort()).toEqual([...idsMotor].sort());
    const c = r.cables.find((x) => x.cable_id === 'PRY-SVALIO-CU-3x50')!;
    expect(c).toMatchObject({ tipo: 'tripolar', material: 'cobre', n_conductores: 3, formacion: '50', diametro_exterior_mm: 30 });
    expect(textoCable(c)).toBe('Sintenax Valio · Tripolar · cobre · 3 × 50 mm²');
    expect(r.cables.some((x) => x.cable_id === 'PRY-SVALIO-CU-4x25-NI')).toBe(true);
    expect(r.cables.some((x) => x.cable_id === 'PRY-SVALIO-CU-2x1.5')).toBe(true);
  });

  it('en cascada son tres listas cortas: línea → tipo (con material) → formación', () => {
    const r = construirCatalogoCables(datasets, idsMotor);
    if (!r.ok) throw new Error(r.motivo);
    const ls = lineas(r.cables);
    expect(ls.map(lineaCorta)).toEqual(['Sintenax Valio', 'Superastic Flex']);
    const tipos = tiposDe(r.cables, ls[0]);
    expect(tipos.map((t) => t.texto)).toEqual([
      'Unipolar · cobre', 'Bipolar · cobre', 'Tripolar · cobre', 'Tetrapolar · cobre', 'Tetrapolar, neutro igual a las fases · cobre',
      'Unipolar · aluminio', 'Bipolar · aluminio', 'Tripolar · aluminio', 'Tetrapolar · aluminio',
    ]);
    const tri = formacionesDe(r.cables, ls[0], 'tripolar|cobre');
    expect(tri).toHaveLength(16);
    expect(tri[0].cable_id).toBe('PRY-SVALIO-CU-3x1.5');
    expect(Math.max(...tipos.map((t) => formacionesDe(r.cables, ls[0], t.clave).length))).toBeLessThanOrEqual(17);
    expect(tiposDe(r.cables, ls[1]).map((t) => t.texto)).toEqual(['Unipolar sin envoltura · cobre']);
  });

  it('si no coincide con el motor, no se ofrece y dice por qué', () => {
    const r = construirCatalogoCables(datasets, [...idsMotor.slice(1), 'OTRO-ID']);
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/^el catálogo de cables no coincide con el del motor \(sobran 1, faltan 1: /) });
    expect(construirCatalogoCables(undefined, idsMotor)).toEqual({ ok: false, motivo: 'el servicio no mandó los datasets de cables' });
  });
});
