/**
 * PB1 — huella de la definición de cada producto del catálogo, contra la base.
 *
 * `fixtures/huellas-base.json` guarda, para cada producto con modelo
 * paramétrico, la huella de su definición tal como la calculaba la base de la
 * fase B (commit en el campo `base`), sin calibraciones de biblioteca. Esta
 * prueba exige que la huella actual sea la misma, o que el cambio esté
 * declarado en `fixtures/huellas-cambios.json` con su motivo.
 *
 * Una huella distinta deja como "desactualizadas" (A-6) las piezas ya colocadas
 * con esa definición: por eso todo cambio se declara y se lista.
 *
 * Regenerar el fixture de base (sólo sobre la base): CODEX_UPDATE_HUELLAS=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { resolveRecipe } from '../../parametricBridge';
import { buildDefinition } from '../definitions';
import type { Product } from '../../../tray/model';

const FIX = resolve(__dirname, 'fixtures');
const BASE_PATH = resolve(FIX, 'huellas-base.json');
const CAMBIOS_PATH = resolve(FIX, 'huellas-cambios.json');

interface HuellasBase { base: string; huellas: Record<string, string> }
interface Cambio { antes: string; despues: string; motivo: string }

const snapshot = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8',
)) as { PRODUCTOS: Product[] };

function huellasActuales(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of snapshot.PRODUCTOS) {
    if (!resolveRecipe(p)) continue;
    const d = buildDefinition(p);
    out[p.producto_id] = d.ok ? d.huella : `ERROR: ${d.motivo}`;
  }
  return out;
}

beforeAll(async () => {
  clearPortMappingOverrides();
  await seedStaticCatalog();
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

describe('PB1 — huellas de definición contra la base', () => {
  it('cada producto con modelo conserva su huella o el cambio está declarado', () => {
    const actual = huellasActuales();
    if (process.env.CODEX_UPDATE_HUELLAS === '1') {
      const base = execSync('git rev-parse --short HEAD').toString().trim();
      writeFileSync(BASE_PATH, `${JSON.stringify({ base, huellas: actual }, null, 2)}\n`);
    }
    const { huellas: base } = JSON.parse(readFileSync(BASE_PATH, 'utf8')) as HuellasBase;
    const cambios: Record<string, Cambio> = existsSync(CAMBIOS_PATH) ? JSON.parse(readFileSync(CAMBIOS_PATH, 'utf8')).cambios : {};

    const sinDeclarar: string[] = [];
    const declaradosObsoletos: string[] = [];
    for (const id of new Set([...Object.keys(base), ...Object.keys(actual)])) {
      const a = base[id] ?? '(sin modelo)';
      const b = actual[id] ?? '(sin modelo)';
      const c = cambios[id];
      if (a === b) {
        if (c) declaradosObsoletos.push(`${id}: declarado como cambio pero no cambió`);
        continue;
      }
      if (!c || c.antes !== a || c.despues !== b) sinDeclarar.push(`${id}: ${a} → ${b}`);
    }
    expect(sinDeclarar, `huellas cambiadas sin declarar en huellas-cambios.json:\n${sinDeclarar.join('\n')}`).toEqual([]);
    expect(declaradosObsoletos).toEqual([]);
  });

  it('ninguna definición del catálogo con modelo falla al construirse', () => {
    const errores = Object.entries(huellasActuales()).filter(([, h]) => h.startsWith('ERROR'));
    expect(errores).toEqual([]);
  });
});
