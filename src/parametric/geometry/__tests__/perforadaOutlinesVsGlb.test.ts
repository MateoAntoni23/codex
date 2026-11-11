/**
 * Los contornos de perforada CPS-45, CPS-90 y XPS = su GLB original.
 *
 * Desde B-1.3 se generan desde el STEP (perforadaOutlines.ts); antes eran
 * literales transcritos en `4236323` desde el GLB original, que es el STEP del usuario convertido por
 * CadQuery (`tools/step_parametric/build_all.py` → `_export_originals_glb`,
 * `public/parametric/originals_glb/`). Hasta esta prueba nada los contrastaba
 * con su origen.
 *
 * Referencia = la cara superior del GLB: la primitiva cuyos vértices están
 * todos en y = ymax (el GLB trae una primitiva por cara del STEP). Se exige:
 *   - misma cantidad de vértices que el polígono;
 *   - con UNA sola traslación (la que lleva el centro del bbox del GLB al
 *     centro del bbox del polígono, como dice el encabezado de outlines.ts),
 *     cada vértice del polígono cae sobre un vértice distinto de la cara
 *     (correspondencia uno a uno), a ≤ TOL_MM.
 *
 * TOL_MM es la cota de las fuentes, no un ajuste al resultado: los literales
 * están redondeados a 0,01 mm (hasta 0,0071 mm por vértice); la traslación se
 * deduce de los extremos, que tienen el mismo redondeo (hasta 0,0071 mm más);
 * el GLB es float32 (≈0,0003 mm a 4000 mm). Total ≤ 0,0145 → 0,015 mm.
 * Medido al escribirla: 0,0114 mm (CPS-45) y 0,0095 mm (CPS-90).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCPS45Recipe, buildCPS90Recipe, buildXPSRecipe } from '../outlines';

const TOL_MM = 0.015;
const GLB_DIR = resolve(__dirname, '../../../../public/parametric/originals_glb');

type P3 = [number, number, number];

/** Vértices POSITION de cada primitiva de la primera malla (coordenadas de malla). */
function readGlbPrimitives(path: string): P3[][] {
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0), 'magic glTF').toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16), 'chunk JSON').toBe(0x4e4f534a);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  expect(buf.readUInt32LE(20 + jsonLen + 4), 'chunk BIN').toBe(0x004e4942);
  return gltf.meshes[0].primitives.map((p: { attributes: { POSITION: number } }) => {
    const acc = gltf.accessors[p.attributes.POSITION];
    expect(acc.componentType, 'POSITION float32').toBe(5126);
    expect(acc.type).toBe('VEC3');
    const view = gltf.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const base = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const pts: P3[] = [];
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      pts.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
    }
    return pts;
  });
}

const casos = [
  { glb: 'CPS-300-45-Z.glb', polygon: buildCPS45Recipe({ ancho_mm: 300, ala_mm: 50 }).polygon },
  { glb: 'CPS-300-90-Z.glb', polygon: buildCPS90Recipe({ ancho_mm: 300, ala_mm: 50 }).polygon },
  { glb: 'XPS-300-Z.glb', polygon: buildXPSRecipe({ ancho_mm: 300, ala_mm: 50 }).polygon },
] as const;

describe('outlines.ts perforada = cara superior del GLB original', () => {
  describe.each(casos)('$glb', ({ glb, polygon }) => {
    const prims = readGlbPrimitives(resolve(GLB_DIR, glb));
    const all = prims.flat();
    const ymax = Math.max(...all.map((p) => p[1]));
    const tops = prims.filter((pts) => pts.every((p) => Math.abs(p[1] - ymax) < 1e-4));

    it('el GLB tiene una sola cara superior y con tantos vértices como el polígono', () => {
      expect(tops.length, 'primitivas en y = ymax').toBe(1);
      const unicos = new Set(tops[0].map((p) => `${p[0].toFixed(4)},${p[2].toFixed(4)}`));
      expect(unicos.size, 'vértices distintos de la cara superior').toBe(polygon.length);
    });

    it(`con una sola traslación, cada vértice cae sobre uno distinto de la cara (≤ ${TOL_MM} mm)`, () => {
      const top = tops[0];
      const ext = (xs: number[]) => (Math.min(...xs) + Math.max(...xs)) / 2;
      const dx = ext(polygon.map((v) => v[0])) - ext(all.map((p) => p[0]));
      const dz = ext(polygon.map((v) => v[1])) - ext(all.map((p) => p[2]));
      const usados = new Set<number>();
      polygon.forEach((v, k) => {
        let best = -1;
        let bestD = Infinity;
        top.forEach((p, i) => {
          const d = Math.hypot(p[0] + dx - v[0], p[2] + dz - v[1]);
          if (d < bestD) { bestD = d; best = i; }
        });
        expect(bestD, `vértice ${k} [${v.join(', ')}]: a ${bestD.toFixed(4)} mm del GLB`).toBeLessThanOrEqual(TOL_MM);
        usados.add(best);
      });
      expect(usados.size, 'correspondencia uno a uno').toBe(polygon.length);
    });
  });
});
