#!/usr/bin/env node
/**
 * Genera src/parametric/geometry/perforadaOutlines.ts desde
 * tools/step_parametric/report/perforada/<pieza>__outline.json (extraídos del
 * STEP) y tools/step_parametric/perforada_contornos.json (marco de cada pieza).
 *
 * Los números salen del JSON: sólo se trasladan al marco declarado y se
 * reordenan (sentido y vértice inicial). Si algo no cuadra, no escribe y sale
 * con error.
 *
 * Uso:
 *   node tools/step_parametric/emit_perforada_outlines.mjs          escribe
 *   node tools/step_parametric/emit_perforada_outlines.mjs --check  falla si
 *        el archivo versionado no es exactamente lo que se generaría
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerOutlineDesde, normEol } from './emit_escalera_outlines.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const DEFAULT_PATHS = {
  outlineDir: resolve(HERE, 'report/perforada'),
  declPath: resolve(HERE, 'perforada_contornos.json'),
  outPath: resolve(ROOT, 'src/parametric/geometry/perforadaOutlines.ts'),
};

/** El JSON trae 3 decimales; la traslación no agrega precisión. */
const r3 = (x) => {
  const v = Math.round(x * 1000) / 1000;
  return Object.is(v, -0) ? 0 : v;
};

/** Polígono en el marco declarado, o error. */
export function contornoEnMarco(c, o) {
  const P = o.polygon_xz_mm;
  const n = P.length;
  if (!Number.isInteger(c.inicio) || c.inicio < 0 || c.inicio >= n) throw new Error(`${c.outline}: inicio ${c.inicio} fuera de 0..${n - 1}`);
  const minX = Math.min(...P.map((p) => p[0]));
  const maxZ = Math.max(...P.map((p) => p[1]));
  const dx = c.marco.min_x_mm - minX;
  const dz = c.marco.max_z_mm - maxZ;
  const out = [];
  for (let k = 0; k < n; k++) {
    const j = c.invertir ? (c.inicio - k + n) % n : (c.inicio + k) % n;
    out.push([r3(P[j][0] + dx), r3(P[j][1] + dz)]);
  }
  return out;
}

export function generar(decl, leerOutline) {
  const errores = [];
  const bloques = [];
  for (const c of decl.contornos) {
    const o = leerOutline(c.outline);
    if (!o) { errores.push(`${c.outline}: falta ${c.outline}__outline.json`); continue; }
    if (o.error) { errores.push(`${c.outline}: el __outline.json trae error: ${o.error}`); continue; }
    if (o.file !== `${c.outline}.STEP`) { errores.push(`${c.outline}: el JSON nombra ${o.file}`); continue; }
    let poly;
    try { poly = contornoEnMarco(c, o); } catch (e) { errores.push(String(e.message ?? e)); continue; }
    bloques.push([
      `// ─── ${c.outline} — ${c.titulo} (${poly.length} vértices)`,
      `export const ${c.const}: readonly (readonly [number, number])[] = [`,
      ...poly.map((p) => `  [${p[0]}, ${p[1]}],`),
      '];',
    ].join('\n'));
  }
  if (errores.length) return { ok: false, errores };
  const ts = [
    '// ARCHIVO GENERADO — NO EDITAR A MANO.',
    '//',
    '// Generado por tools/step_parametric/emit_perforada_outlines.mjs desde',
    '//   tools/step_parametric/report/perforada/*__outline.json (extraídos del STEP)',
    '//   tools/step_parametric/perforada_contornos.json (marco de cada pieza)',
    '// Polígonos en XZ, en el marco y el sentido que usan las recetas de outlines.ts.',
    '// Regenerar: node tools/step_parametric/emit_perforada_outlines.mjs',
    '// perforadaOutlinesGenerated.test.ts falla si este archivo no está al día.',
    '',
    bloques.join('\n\n'),
    '',
  ].join('\n');
  return { ok: true, ts };
}

export function generarDesdeDisco(paths = DEFAULT_PATHS) {
  const decl = JSON.parse(readFileSync(paths.declPath, 'utf8'));
  return generar(decl, leerOutlineDesde(paths.outlineDir));
}

function main(argv) {
  const r = generarDesdeDisco();
  if (!r.ok) {
    for (const e of r.errores) console.error(`[emit_perforada_outlines] ERROR ${e}`);
    console.error('[emit_perforada_outlines] no se escribió nada.');
    return 1;
  }
  const out = DEFAULT_PATHS.outPath;
  const actual = existsSync(out) ? normEol(readFileSync(out, 'utf8')) : null;
  if (argv.includes('--check')) {
    if (actual === r.ts) { console.log('[emit_perforada_outlines] al día'); return 0; }
    console.error(`[emit_perforada_outlines] ${out} no coincide con lo generado: regenerar.`);
    return 1;
  }
  writeFileSync(out, r.ts, 'utf8');
  console.log(`[emit_perforada_outlines] escrito ${out}${actual === r.ts ? ' (sin cambios)' : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
