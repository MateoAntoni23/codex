/**
 * Cada contorno de `escaleraOutlines.ts` es igual a su extracción del STEP.
 *
 * Ninguna herramienta genera `escaleraOutlines.ts`: los polígonos se copian a
 * mano desde `tools/step_parametric/report/escalera/<archivo>__outline.json`
 * (salida de `extract_outlines.py`). Hasta esta prueba nada contrastaba el
 * JSON con el TypeScript; por esa brecha pudo convivir un contorno con su
 * reporte sin que nadie verificara que eran lo mismo.
 *
 * Se exige, para cada contorno del índice `ESCALERA_OUTLINES_BY_SKU`:
 *   - que exista su `__outline.json` y nombre el mismo archivo STEP;
 *   - bbox local igual;
 *   - mismos vértices, en el mismo orden (y por lo tanto las mismas aristas);
 *   - cada boca declarada (`boundary_edges`) es una arista del polígono
 *     transcrito (a = polygon[i], b = polygon[i+1]) y coincide con la arista i
 *     del reporte: extremos, largo, punto medio y normal saliente.
 *
 * No se compara la etiqueta `boundary`: en el reporte es la detección
 * automática por bbox, y la elección de bocas es una decisión documentada en
 * el propio archivo (las bocas son las aristas del ancho de bandeja).
 *
 * Tolerancias = precisión de las fuentes, no holgura: el reporte redondea
 * coordenadas a 0,001 mm y algunas transcripciones a 0,01 mm (error máximo
 * 0,005 mm); las normales del reporte van a 3 decimales (error 0,0005).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESCALERA_OUTLINES_BY_SKU, type EscaleraOutline, type Vec2 } from '../escaleraOutlines';

const REPORT_DIR = resolve(__dirname, '../../../../tools/step_parametric/report/escalera');
const TOL_MM = 0.006;
const TOL_NORMAL = 0.0006;

interface ReportEdge {
  i: number;
  a: [number, number];
  b: [number, number];
  length_mm: number;
  midpoint: [number, number];
  outward_normal: [number, number];
}
interface OutlineReport {
  file: string;
  bbox_local: { x_max: number; z_max: number; y_height_mm: number };
  n_vertices: number;
  polygon_xz_mm: [number, number][];
  edges: ReportEdge[];
}

function reportFor(o: EscaleraOutline): { path: string; report: OutlineReport | null } {
  const stem = o.source_file.replace(/\.(step|stp)$/i, '');
  const path = resolve(REPORT_DIR, `${stem}__outline.json`);
  return { path, report: existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as OutlineReport) : null };
}

function expectClose2(actual: Vec2, expected: readonly [number, number], tol: number, what: string): void {
  const d = Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  expect(d, `${what}: ts [${actual.join(', ')}] vs reporte [${expected.join(', ')}]`).toBeLessThanOrEqual(tol);
}

const entries = Object.entries(ESCALERA_OUTLINES_BY_SKU) as [string, EscaleraOutline][];

describe('escaleraOutlines.ts = __outline.json extraído del STEP', () => {
  it('hay contornos para contrastar', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  describe.each(entries)('%s', (_sku, outline) => {
    const { path, report } = reportFor(outline);

    it('tiene su __outline.json y nombra el mismo STEP', () => {
      expect(report, `falta ${path}`).not.toBeNull();
      expect(report!.file).toBe(outline.source_file);
      expect(report!.n_vertices).toBe(report!.polygon_xz_mm.length);
    });

    it('bbox local igual', () => {
      const r = report!.bbox_local;
      expect(Math.abs(outline.bbox_local.x_max - r.x_max), 'x_max').toBeLessThanOrEqual(TOL_MM);
      expect(Math.abs(outline.bbox_local.z_max - r.z_max), 'z_max').toBeLessThanOrEqual(TOL_MM);
      expect(Math.abs(outline.bbox_local.y_height_mm - r.y_height_mm), 'y_height_mm').toBeLessThanOrEqual(TOL_MM);
    });

    it('mismos vértices en el mismo orden (mismas aristas)', () => {
      const rp = report!.polygon_xz_mm;
      expect(outline.polygon.length, 'cantidad de vértices').toBe(rp.length);
      outline.polygon.forEach((v, k) => expectClose2(v, rp[k], TOL_MM, `vértice ${k}`));
    });

    it('cada boca declarada es una arista del polígono y coincide con la del reporte', () => {
      const n = outline.polygon.length;
      expect(outline.boundary_edges.length, 'bocas declaradas').toBeGreaterThan(0);
      for (const e of outline.boundary_edges) {
        const tag = `boca i=${e.i}`;
        expect(Number.isInteger(e.i) && e.i >= 0 && e.i < n, `${tag}: índice válido`).toBe(true);
        // La arista existe en el polígono transcrito.
        expectClose2(e.a, outline.polygon[e.i], TOL_MM, `${tag}.a = polygon[${e.i}]`);
        expectClose2(e.b, outline.polygon[(e.i + 1) % n], TOL_MM, `${tag}.b = polygon[${(e.i + 1) % n}]`);
        // Y es la misma arista que midió el extractor.
        const r = report!.edges.find((x) => x.i === e.i);
        expect(r, `${tag}: el reporte no tiene la arista ${e.i}`).toBeDefined();
        expectClose2(e.a, r!.a, TOL_MM, `${tag}.a`);
        expectClose2(e.b, r!.b, TOL_MM, `${tag}.b`);
        expect(Math.abs(e.length_mm - r!.length_mm), `${tag}: largo ${e.length_mm} vs ${r!.length_mm}`).toBeLessThanOrEqual(TOL_MM * 2);
        expectClose2(e.midpoint, r!.midpoint, TOL_MM, `${tag}.midpoint`);
        expectClose2(e.outward_normal, r!.outward_normal, TOL_NORMAL, `${tag}.outward_normal`);
      }
    });
  });
});
