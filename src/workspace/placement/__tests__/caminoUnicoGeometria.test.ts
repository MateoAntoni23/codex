/**
 * PB3 — camino único a la geometría.
 *
 * En el espacio de trabajo, el configurador y el adaptador del motor
 * (src/workspace, src/configurator, src/tray) la geometría de un producto se
 * obtiene SOLO por la definición efectiva (`definicionEfectiva`,
 * placement/definitions.ts). Esta prueba lee los imports de cada módulo (no de
 * las pruebas) y falla si alguno:
 *   1. importa como valor recetas, contornos o el catálogo paramétrico
 *      (src/parametric/catalog, src/parametric/geometry/* salvo buildPrism, que
 *      sólo triangula la malla de una definición para dibujarla); o
 *   2. importa una función del puente que construye o coloca geometría
 *      (resolveRecipe, buildRecipeFromProduct, placeRecipe, …).
 * Los imports `import type` no cuentan: no obtienen geometría.
 *
 * Excepciones, cada una con su razón: el motor interno de la definición
 * (parametricBridge, resolvedPortGeometry, definitions) y la migración (A-10),
 * que deduce la pose de un proyecto anterior con verifyGeometricFit.
 *
 * Control negativo: el analizador se prueba con módulos sintéticos que violan
 * cada regla.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SRC = resolve(__dirname, '../../..');
const ARBOLES = ['workspace', 'configurator', 'tray'];

/** Módulos de geometría que sólo puede importar como valor el motor interno. */
const MODULOS_GEOMETRIA = /(^|\/)parametric\/(catalog|geometry\/(?!buildPrism$)[A-Za-z]+)$/;
/** Funciones del puente que construyen o colocan geometría. */
const FUNCIONES_GEOMETRIA = new Set([
  'resolveRecipe', 'resolveParametricEntry', 'buildRecipeFromProduct', 'placeRecipe',
  'resolveRecipeForProduct', 'resolveRecipeWith', 'verifyGeometricFit', 'hasParametricRecipe',
  'isParametricInsertable', 'buildLocalMesh', 'buildRecipeFor', 'buildRecipeByKey', 'getEscaleraOutline',
]);

/** Excepciones por archivo (ruta relativa a src, con /), con lo que se les permite. */
const EXCEPCIONES: Record<string, { motivo: string; modulos?: boolean; funciones?: readonly string[] }> = {
  'workspace/parametricBridge.ts': { motivo: 'motor interno de la definición (recetas por maestro)', modulos: true, funciones: ['resolveRecipeForProduct'] },
  'workspace/resolvedPortGeometry.ts': { motivo: 'motor interno: aplica la calibración a la receta', modulos: true },
  'workspace/placement/definitions.ts': {
    motivo: 'la definición efectiva misma',
    funciones: ['resolveRecipe', 'resolveParametricEntry', 'buildRecipeFromProduct', 'resolveRecipeForProduct'],
  },
  'workspace/placement/migration.ts': { motivo: 'A-10: deduce la pose de un proyecto anterior', funciones: ['verifyGeometricFit'] },
};

interface ImportDecl { from: string; tipo: boolean; nombres: { nombre: string; tipo: boolean }[] }

/** Imports estáticos de un módulo (incluye los de varias líneas). */
export function leerImports(src: string): ImportDecl[] {
  const out: ImportDecl[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const tipo = !!m[1];
    const cl = m[2].trim();
    const nombres: ImportDecl['nombres'] = [];
    const llaves = cl.match(/\{([\s\S]*)\}/);
    if (llaves) {
      for (const parte of llaves[1].split(',')) {
        const t = parte.trim();
        if (!t) continue;
        const esTipo = /^type\s+/.test(t);
        const nombre = t.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        nombres.push({ nombre, tipo: esTipo });
      }
    }
    const resto = cl.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (resto) nombres.push({ nombre: resto, tipo: false }); // default o * as X
    out.push({ from: m[3], tipo, nombres });
  }
  return out;
}

/** Violaciones de un módulo, dado su path relativo a src. */
export function violaciones(rel: string, src: string): string[] {
  const exc = EXCEPCIONES[rel];
  const dir = rel.split('/').slice(0, -1).join('/');
  const out: string[] = [];
  for (const imp of leerImports(src)) {
    if (imp.tipo) continue;
    const valores = imp.nombres.filter((n) => !n.tipo);
    if (!valores.length && imp.nombres.length) continue;
    const destino = imp.from.startsWith('.') ? join(dir, imp.from).split(sep).join('/') : imp.from;
    if (MODULOS_GEOMETRIA.test(destino) && !exc?.modulos) {
      out.push(`${rel}: importa ${valores.map((v) => v.nombre).join(', ') || '(módulo)'} de ${imp.from}`);
    }
    for (const v of valores) {
      if (FUNCIONES_GEOMETRIA.has(v.nombre) && !(exc?.funciones ?? []).includes(v.nombre) && !(exc?.modulos && MODULOS_GEOMETRIA.test(destino))) {
        out.push(`${rel}: importa ${v.nombre} de ${imp.from}`);
      }
    }
  }
  return out;
}

function modulos(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if (e === '__tests__') continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
    }
  };
  for (const a of ARBOLES) walk(join(SRC, a));
  return out;
}

describe('PB3 — la geometría sólo se obtiene por la definición efectiva', () => {
  it('ningún módulo de workspace, configurator o tray la obtiene por otro camino', () => {
    const todas: string[] = [];
    for (const p of modulos()) {
      const rel = relative(SRC, p).split(sep).join('/');
      todas.push(...violaciones(rel, readFileSync(p, 'utf8')));
    }
    expect(todas, `módulos que obtienen geometría fuera de definicionEfectiva:\n${todas.join('\n')}`).toEqual([]);
  });

  it('las excepciones existen y cada una tiene motivo', () => {
    for (const [rel, e] of Object.entries(EXCEPCIONES)) {
      expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
      expect(e.motivo.length, rel).toBeGreaterThan(5);
    }
  });
});

describe('control negativo del analizador', () => {
  it('detecta un import de receta como valor', () => {
    expect(violaciones('workspace/x.ts', "import { buildCPS90Recipe } from '../parametric/geometry/outlines';")).toHaveLength(1);
    expect(violaciones('workspace/a/b.tsx', "import {\n  buildRecipeByKey,\n  type RawParams,\n} from '../../parametric/geometry/recipes';")).not.toHaveLength(0);
    expect(violaciones('configurator/x.ts', "import { PARAMETRIC_CATALOG } from '../parametric/catalog';")).toHaveLength(1);
  });

  it('detecta una función del puente que construye o coloca geometría', () => {
    expect(violaciones('workspace/x.ts', "import { placeRecipe, chiralityForTurn } from './parametricBridge';")).toEqual([
      'workspace/x.ts: importa placeRecipe de ./parametricBridge',
    ]);
    expect(violaciones('tray/x.ts', "import { resolveRecipe as r } from '../workspace/parametricBridge';")).toHaveLength(1);
  });

  it('no cuenta los imports de tipo ni buildPrism, y respeta las excepciones', () => {
    expect(violaciones('workspace/x.ts', "import type { PieceKind } from '../parametric/geometry/recipes';")).toEqual([]);
    expect(violaciones('workspace/x.ts', "import { type GeometryRecipe } from '../parametric/geometry/outlines';")).toEqual([]);
    expect(violaciones('workspace/placement/x.ts', "import { buildPrism } from '../../parametric/geometry/buildPrism';")).toEqual([]);
    expect(violaciones('workspace/placement/migration.ts', "import { verifyGeometricFit } from '../parametricBridge';")).toEqual([]);
    expect(violaciones('workspace/placement/migration.ts', "import { placeRecipe } from '../parametricBridge';")).toHaveLength(1);
  });
});
