/**
 * PB2 — los contornos generados están al día y el generador depende de sus
 * fuentes.
 *
 *   - escaleraOutlines.ts y perforadaOutlines.ts son exactamente lo que
 *     escriben los generadores a partir de los __outline.json versionados
 *     (regenerar sobre el repo limpio no produce cambios).
 *   - Alterar un __outline.json (en memoria) cambia lo generado.
 *   - Controles negativos de la regla de bocas: declarar una pared como boca,
 *     una arista inexistente o un JSON que falta hace fallar la generación con
 *     motivo, sin escribir nada.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — módulo .mjs de tools/ sin tipos
import * as esc from '../../../../tools/step_parametric/emit_escalera_outlines.mjs';
// @ts-expect-error — módulo .mjs de tools/ sin tipos
import * as perf from '../../../../tools/step_parametric/emit_perforada_outlines.mjs';

type Outline = { file: string; polygon_xz_mm: [number, number][]; [k: string]: unknown };
type Gen = { ok: true; ts: string } | { ok: false; errores: string[] };

const leer = (p: string) => esc.normEol(readFileSync(p, 'utf8')) as string;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('escaleraOutlines.ts generado', () => {
  const decl = JSON.parse(readFileSync(esc.DEFAULT_PATHS.bocasPath, 'utf8'));
  const leerOutline = esc.leerOutlineDesde(esc.DEFAULT_PATHS.outlineDir) as (n: string) => Outline | null;

  it('el archivo versionado es exactamente lo generado', () => {
    const r = esc.generarDesdeDisco() as Gen;
    expect(r.ok, r.ok ? '' : r.errores.join('\n')).toBe(true);
    if (r.ok) expect(leer(esc.DEFAULT_PATHS.outPath)).toBe(r.ts);
  });

  it('alterar un vértice de un __outline.json cambia lo generado', () => {
    const base = esc.generar(decl, leerOutline) as Gen;
    const alterado = (n: string) => {
      const o = leerOutline(n);
      if (!o || n !== 'XS-300-065-18-Z') return o;
      const c = clone(o);
      c.polygon_xz_mm[0][0] += 0.01;
      return c;
    };
    const r = esc.generar(decl, alterado) as Gen;
    expect(base.ok && r.ok).toBe(true);
    if (base.ok && r.ok) expect(r.ts).not.toBe(base.ts);
  });

  it('control negativo: una pared declarada como boca no se genera (regla del ancho)', () => {
    const d = clone(decl);
    d.contornos.find((c: { outline: string }) => c.outline === 'CS-300-90-065-18-Z').bocas[0].arista = 0; // pared exterior 333 mm
    const r = esc.generar(d, leerOutline) as Gen;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join('\n')).toMatch(/CS-300-90-065-18-Z boca P1: la arista 0 mide 333\.000 mm.*no es una boca/);
  });

  it('control negativo: boca angosta declarada con el ancho de la ancha', () => {
    const d = clone(decl);
    d.contornos.find((c: { outline: string }) => c.outline === 'RIS-15-065-18-Z').bocas[0].ancho_nominal_mm = 300;
    const r = esc.generar(d, leerOutline) as Gen;
    expect(r.ok).toBe(false);
  });

  it('control negativo: arista inexistente, nombre repetido y JSON faltante', () => {
    const d1 = clone(decl); d1.contornos[0].bocas[0].arista = 99;
    const d2 = clone(decl); d2.contornos[0].bocas[1].nombre = d2.contornos[0].bocas[0].nombre;
    expect((esc.generar(d1, leerOutline) as Gen).ok).toBe(false);
    expect((esc.generar(d2, leerOutline) as Gen).ok).toBe(false);
    const sinTs = (n: string) => (n === 'TS-300-065-18-Z' ? null : leerOutline(n));
    const r = esc.generar(decl, sinTs) as Gen;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join('\n')).toMatch(/TS-300-065-18-Z: falta/);
  });
});

describe('perforadaOutlines.ts generado', () => {
  const decl = JSON.parse(readFileSync(perf.DEFAULT_PATHS.declPath, 'utf8'));
  const leerOutline = esc.leerOutlineDesde(perf.DEFAULT_PATHS.outlineDir) as (n: string) => Outline | null;

  it('el archivo versionado es exactamente lo generado', () => {
    const r = perf.generarDesdeDisco() as Gen;
    expect(r.ok, r.ok ? '' : r.errores.join('\n')).toBe(true);
    if (r.ok) expect(leer(perf.DEFAULT_PATHS.outPath)).toBe(r.ts);
  });

  it('alterar un vértice de un __outline.json cambia lo generado', () => {
    const base = perf.generar(decl, leerOutline) as Gen;
    const alterado = (n: string) => {
      const o = leerOutline(n);
      if (!o || n !== 'CPS-300-90-Z') return o;
      const c = clone(o);
      c.polygon_xz_mm[3][1] += 0.01;
      return c;
    };
    const r = perf.generar(decl, alterado) as Gen;
    expect(base.ok && r.ok).toBe(true);
    if (base.ok && r.ok) expect(r.ts).not.toBe(base.ts);
  });

  it('control negativo: JSON faltante o inicio fuera de rango no se generan', () => {
    const d = clone(decl); d.contornos[0].inicio = 99;
    expect((perf.generar(d, leerOutline) as Gen).ok).toBe(false);
    expect((perf.generar(decl, (n: string) => (n === 'XPS-300-Z' ? null : leerOutline(n))) as Gen).ok).toBe(false);
  });
});

describe('fuentes de los generadores', () => {
  it('los STEP de origen siguen siendo los de los reportes de análisis', () => {
    // Cada __outline.json nombra el STEP cuyo análisis (con sha256) está versionado al lado.
    for (const [dir, nombres] of [
      ['tools/step_parametric/report/escalera', ['TRES-300-065-18-Z', 'CS-300-45-065-18-Z', 'CS-300-90-065-18-Z', 'TS-300-065-18-Z', 'XS-300-065-18-Z', 'RIS-15-065-18-Z']],
      ['tools/step_parametric/report', ['CPS-300-45-Z', 'CPS-300-90-Z', 'XPS-300-Z']],
    ] as const) {
      for (const n of nombres) {
        const a = JSON.parse(readFileSync(resolve(__dirname, '../../../..', dir, `${n}.json`), 'utf8'));
        expect(a.file, n).toBe(`${n}.STEP`);
        expect(a.sha256, n).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
