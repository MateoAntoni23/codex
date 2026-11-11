#!/usr/bin/env node
/**
 * Genera src/parametric/geometry/escaleraOutlines.ts desde:
 *   - tools/step_parametric/report/escalera/<outline>__outline.json
 *     (extraídos del STEP por extract_outlines.py: polígono, bbox, aristas);
 *   - tools/step_parametric/escalera_bocas.json
 *     (declaración a mano: qué aristas son bocas y cómo se llaman).
 *
 * Nada se transcribe a mano: los números salen del JSON tal cual. Las bocas se
 * declaran por índice de arista; sus extremos, largo, punto medio y normal se
 * derivan del polígono en `escaleraOutlineModel.ts`.
 *
 * Valida, y si algo no cumple NO escribe y sale con error (ningún fallo
 * silencioso):
 *   - cada contorno declarado tiene su __outline.json y nombra el mismo STEP;
 *   - cada boca es una arista existente, sin repetir, con nombre único;
 *   - regla: una boca mide el ancho de bandeja (ver `_regla_ancho` en el
 *     archivo declarativo);
 *   - baseAnchoMm coincide con una boca del ancho nominal mayor de la pieza.
 *
 * Uso:
 *   node tools/step_parametric/emit_escalera_outlines.mjs          escribe
 *   node tools/step_parametric/emit_escalera_outlines.mjs --check  falla si
 *        el archivo versionado no es exactamente lo que se generaría
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const DEFAULT_PATHS = {
  outlineDir: resolve(HERE, 'report/escalera'),
  bocasPath: resolve(HERE, 'escalera_bocas.json'),
  outPath: resolve(ROOT, 'src/parametric/geometry/escaleraOutlines.ts'),
};

const num = (x) => {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`número inválido: ${x}`);
  return Object.is(x, -0) ? '0' : String(x);
};
const pair = (p) => `[${num(p[0])}, ${num(p[1])}]`;
const str = (s) => JSON.stringify(s);

/**
 * Valida y genera. `leerOutline(nombre)` devuelve el __outline.json parseado o
 * null; se inyecta para poder probar con datos alterados en memoria.
 * Devuelve { ok: true, ts } o { ok: false, errores: string[] }.
 */
export function generar(bocasDecl, leerOutline) {
  const errores = [];
  const hol = bocasDecl.holgura_modelo_mm;
  const eps = bocasDecl.precision_mm;
  if (typeof hol !== 'number' || typeof eps !== 'number') {
    return { ok: false, errores: ['escalera_bocas.json: faltan holgura_modelo_mm o precision_mm'] };
  }
  const bloques = [];
  const indice = [];
  const consts = new Set();
  const skus = new Set();

  for (const c of bocasDecl.contornos) {
    const tag = c.outline;
    const o = leerOutline(c.outline);
    if (!o) { errores.push(`${tag}: falta ${c.outline}__outline.json`); continue; }
    if (o.error) { errores.push(`${tag}: el __outline.json trae error: ${o.error}`); continue; }
    if (o.file !== `${c.outline}.STEP`) errores.push(`${tag}: el JSON nombra ${o.file}, no ${c.outline}.STEP`);
    if (consts.has(c.const)) errores.push(`${tag}: const repetida ${c.const}`);
    if (skus.has(c.sku)) errores.push(`${tag}: sku repetido ${c.sku}`);
    consts.add(c.const); skus.add(c.sku);

    const n = o.polygon_xz_mm.length;
    if (o.n_vertices !== n) errores.push(`${tag}: n_vertices ${o.n_vertices} ≠ ${n} vértices`);
    if (!Array.isArray(o.edges) || o.edges.length !== n) errores.push(`${tag}: el JSON tiene ${o.edges?.length} aristas para ${n} vértices`);

    const nombres = new Set();
    const aristas = new Set();
    const anchoMax = Math.max(...c.bocas.map((b) => b.ancho_nominal_mm));
    let baseOk = false;
    for (const b of c.bocas) {
      const bt = `${tag} boca ${b.nombre}`;
      if (!/^P\d+(_\w+)?$/.test(b.nombre)) errores.push(`${bt}: nombre inválido`);
      if (nombres.has(b.nombre)) errores.push(`${bt}: nombre repetido`);
      nombres.add(b.nombre);
      if (!Number.isInteger(b.arista) || b.arista < 0 || b.arista >= n) { errores.push(`${bt}: arista ${b.arista} fuera de 0..${n - 1}`); continue; }
      if (aristas.has(b.arista)) errores.push(`${bt}: arista ${b.arista} declarada dos veces`);
      aristas.add(b.arista);
      const a = o.polygon_xz_mm[b.arista];
      const z = o.polygon_xz_mm[(b.arista + 1) % n];
      const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
      const N = b.ancho_nominal_mm;
      const lo = N - hol - eps;
      const hi = N + eps;
      if (!(L >= lo && L <= hi)) {
        errores.push(`${bt}: la arista ${b.arista} mide ${L.toFixed(3)} mm; una boca de ancho ${N} debe medir entre ${lo.toFixed(3)} y ${hi.toFixed(3)} (no es una boca)`);
      }
      if (N === anchoMax && Math.abs(L - c.baseAnchoMm) <= eps) baseOk = true;
    }
    if (!baseOk) errores.push(`${tag}: baseAnchoMm ${c.baseAnchoMm} no coincide (±${eps}) con ninguna boca de ancho ${anchoMax}`);

    const edgeBoundary = o.edges.map((e) => (e.boundary ? str(e.boundary) : 'null'));
    const bl = [];
    bl.push(`// ─── ${c.outline} — ${c.titulo}`);
    if (c.nota) bl.push(`// ${c.nota}`);
    bl.push(`export const ${c.const}: EscaleraOutline = defineEscaleraOutline({`);
    bl.push(`  source_file: ${str(o.file)},`);
    bl.push(`  bbox_local: { x_max: ${num(o.bbox_local.x_max)}, z_max: ${num(o.bbox_local.z_max)}, y_height_mm: ${num(o.bbox_local.y_height_mm)} },`);
    bl.push(`  baseAnchoMm: ${num(c.baseAnchoMm)},`);
    bl.push(`  polygon: [`);
    for (const p of o.polygon_xz_mm) bl.push(`    ${pair(p)},`);
    bl.push(`  ],`);
    bl.push(`  edge_boundary: [${edgeBoundary.join(', ')}],`);
    bl.push(`  bocas: [`);
    for (const b of c.bocas) bl.push(`    { nombre: ${str(b.nombre)}, arista: ${b.arista}, ancho_nominal_mm: ${num(b.ancho_nominal_mm)} }, // ${b.nota ?? ''}`.trimEnd());
    bl.push(`  ],`);
    bl.push(`});`);
    bloques.push(bl.join('\n'));
    indice.push(`  ${str(c.sku)}: ${c.const},`);
  }
  if (errores.length) return { ok: false, errores };

  const ts = [
    '// ARCHIVO GENERADO — NO EDITAR A MANO.',
    '//',
    '// Generado por tools/step_parametric/emit_escalera_outlines.mjs desde',
    '//   tools/step_parametric/report/escalera/*__outline.json (extraídos del STEP)',
    '//   tools/step_parametric/escalera_bocas.json (qué aristas son bocas)',
    '// Para cambiar un contorno: volver a extraer el STEP. Para cambiar una boca:',
    '// editar escalera_bocas.json. Después: node tools/step_parametric/emit_escalera_outlines.mjs',
    '// escaleraOutlinesGenerated.test.ts falla si este archivo no está al día.',
    '',
    "import { defineEscaleraOutline, type EscaleraOutline } from './escaleraOutlineModel';",
    '',
    "export type { EscaleraOutline, MeasuredEdge, BocaDeclarada, Vec2 } from './escaleraOutlineModel';",
    '',
    bloques.join('\n\n'),
    '',
    'export const ESCALERA_OUTLINES_BY_SKU = {',
    ...indice,
    '} as const;',
    '',
    'export type EscaleraSku = keyof typeof ESCALERA_OUTLINES_BY_SKU;',
    '',
    'export function getEscaleraOutline(sku: string | null | undefined): EscaleraOutline | null {',
    '  if (!sku) return null;',
    '  return (ESCALERA_OUTLINES_BY_SKU as Record<string, EscaleraOutline>)[sku] ?? null;',
    '}',
    '',
  ].join('\n');
  return { ok: true, ts };
}

export function leerOutlineDesde(outlineDir) {
  return (nombre) => {
    const p = resolve(outlineDir, `${nombre}__outline.json`);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  };
}

export function generarDesdeDisco(paths = DEFAULT_PATHS) {
  const decl = JSON.parse(readFileSync(paths.bocasPath, 'utf8'));
  return generar(decl, leerOutlineDesde(paths.outlineDir));
}

/** Normaliza fin de línea para comparar (git puede convertir a CRLF en Windows). */
export const normEol = (s) => s.replace(/\r\n/g, '\n');

function main(argv) {
  const check = argv.includes('--check');
  const r = generarDesdeDisco();
  if (!r.ok) {
    for (const e of r.errores) console.error(`[emit_escalera_outlines] ERROR ${e}`);
    console.error('[emit_escalera_outlines] no se escribió nada.');
    return 1;
  }
  const out = DEFAULT_PATHS.outPath;
  const actual = existsSync(out) ? normEol(readFileSync(out, 'utf8')) : null;
  if (check) {
    if (actual === r.ts) { console.log('[emit_escalera_outlines] al día'); return 0; }
    console.error(`[emit_escalera_outlines] ${out} no coincide con lo generado: regenerar.`);
    return 1;
  }
  writeFileSync(out, r.ts, 'utf8');
  console.log(`[emit_escalera_outlines] escrito ${out}${actual === r.ts ? ' (sin cambios)' : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
