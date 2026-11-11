/**
 * Escalera dibujada desde la definición (B-2): las aristas que no se dibujan
 * como larguero son exactamente las bocas declaradas en
 * tools/step_parametric/escalera_bocas.json, para la pieza base y para una
 * variante de otro ancho (la definición escala el polígono).
 *
 * Control negativo: si se invierte la normal de una boca, su arista deja de
 * reconocerse como boca (se dibuja larguero de más, nunca de menos).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva } from '../definitions';
import { aristasDeBoca, buildLadderDefinitionGeometry } from '../ladderDefinitionGeometry';
import type { StoredDefinition } from '../placementCore';
import type { Product } from '../../../tray/model';

const ROOT = resolve(__dirname, '../../../..');
const snapshot = JSON.parse(readFileSync(resolve(ROOT, 'vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const bocasDecl = JSON.parse(readFileSync(resolve(ROOT, 'tools/step_parametric/escalera_bocas.json'), 'utf8')) as {
  contornos: { outline: string; bocas: { arista: number }[] }[];
};
const bySku = (sku: string) => snapshot.PRODUCTOS.find((p) => p.sku === sku)!;
const esperadas = (outline: string) => new Set(bocasDecl.contornos.find((c) => c.outline === outline)!.bocas.map((b) => b.arista));

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

describe('escalera desde la definición: bocas sin larguero', () => {
  for (const [sku, outline] of [
    ['TRES-300-065-18-Z', 'TRES-300-065-18-Z'],
    ['CS-300-45-065-18-Z', 'CS-300-45-065-18-Z'],
    ['CS-300-90-065-18-Z', 'CS-300-90-065-18-Z'],
    ['TS-300-065-18-Z', 'TS-300-065-18-Z'],
    ['XS-300-065-18-Z', 'XS-300-065-18-Z'],
    ['CS-450-90-090-18-Z', 'CS-300-90-065-18-Z'],
  ] as const) {
    it(`${sku}: aristas de boca = las declaradas para ${outline}`, () => {
      const d = definicionEfectiva(bySku(sku));
      expect(d.ok, sku).toBe(true);
      if (!d.ok) return;
      expect([...aristasDeBoca(d.def)].sort()).toEqual([...esperadas(outline)].sort());
      const g = buildLadderDefinitionGeometry(d.def, 'nativa');
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
    });
  }

  it('control negativo: con la normal de una boca invertida, esa arista no se reconoce', () => {
    const d = definicionEfectiva(bySku('TRES-300-065-18-Z'));
    if (!d.ok) throw new Error(d.motivo);
    const ports = d.def.ports.map((p, i) => (i === 0 ? { ...p, normal: [-p.normal[0], -p.normal[1], -p.normal[2]] as typeof p.normal } : p));
    const alterada = { ...d.def, ports } as StoredDefinition;
    expect(aristasDeBoca(alterada).size).toBe(1);
  });
});
