/**
 * C3 — Auditoría de bocas sobre TODO el catálogo con maestro.
 *
 * Falla si un producto con maestro tiene una boca (según su receta paramétrica,
 * o según el maestro si no hay receta) que no resuelve mapping, o que produce un
 * puerto_id inexistente en el catálogo. Debe fallar sólo cuando entre un patrón
 * nuevo sin calibrar.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { loadStaticCatalog, seedStaticCatalog, type StaticCatalog } from '../../catalog/staticCatalog';
import { findMasterForProduct, MASTER_MODELS } from '../../configurator/masterModels';
import { buildRecipeFromProduct, resolveRecipe } from '../parametricBridge';
import {
  clearCatalogPortIndex,
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  resolveCatalogPort,
  setMasterResolver,
} from '../catalogPortMapping';
import { auditPortMappings, type AuditInput } from '../portMappingAudit';
import type { Product } from '../../tray/model';

let cat: StaticCatalog;

/**
 * Huecos CONOCIDOS, declarados por patrón (no se arreglan en m1c; ver informe).
 * La prueba falla si aparece un patrón nuevo sin calibrar o si este cambia.
 *
 * Ninguno hoy. (Hasta el hito de derivación en un tramo, las 7 DCPS figuraban acá:
 * el maestro viejo declaraba 3 bocas y el catálogo publica sólo P1, "boca
 * derivación". La DCPS lateral medida declara exactamente esa boca.)
 */
const KNOWN_UNCALIBRATED_MASTERS: Record<string, number> = {};

function recipePorts(p: Product): string[] | null {
  const entry = resolveRecipe(p);
  if (!entry) return null;
  try {
    return buildRecipeFromProduct(p, entry).ports.map((x) => x.name);
  } catch {
    return null;
  }
}

function baseInput(): AuditInput {
  return {
    productos: cat.productos,
    puertos: cat.puertos,
    masterFor: (p) => findMasterForProduct(p as Record<string, unknown>),
    recipePortsFor: recipePorts,
    resolve: resolveCatalogPort,
  };
}

beforeAll(async () => {
  clearPortMappingOverrides();
  cat = await loadStaticCatalog();
  await seedStaticCatalog();
});
afterAll(() => {
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

describe('auditoría de bocas (C3)', () => {
  it('todo producto con maestro resuelve cada boca a un puerto publicado', () => {
    const report = auditPortMappings(baseInput());
    // Fuerza que la auditoría realmente recorra el catálogo.
    expect(report.withMaster).toBeGreaterThan(100);
    expect(report.checkedPorts).toBeGreaterThan(report.withMaster);
    const byMaster: Record<string, Set<string>> = {};
    for (const i of report.issues) (byMaster[i.master] ??= new Set()).add(i.producto_id);
    const counts = Object.fromEntries(Object.entries(byMaster).map(([m, ids]) => [m, ids.size]));
    const unexpected = report.issues.filter((i) => !(i.master in KNOWN_UNCALIBRATED_MASTERS));
    expect(unexpected, JSON.stringify(unexpected.slice(0, 10), null, 2)).toEqual([]);
    expect(counts).toEqual(KNOWN_UNCALIBRATED_MASTERS);
  });

  it('la auditoría FALLA si a un maestro de varias bocas le falta una entrada de mapping', () => {
    const cups = MASTER_MODELS.find((m) => m.id === 'master:perforada:curva_vertical_exterior')!;
    const sinBocaVertical = { ...cups, ports: cups.ports.filter((x) => x.recipePortName !== 'P2_vertical') };
    // Resolvedor sembrado con el maestro mutilado → la boca P2_vertical de CUPS-D queda sin calibrar.
    setMasterResolver((p) => {
      const m = findMasterForProduct(p as Record<string, unknown>);
      return m?.id === cups.id ? sinBocaVertical : m;
    });
    try {
      const report = auditPortMappings(baseInput());
      expect(report.unresolvedProducts).toContain('SAM_CUPS-300-D-Z');
      expect(report.issues.some((i) => i.producto_id === 'SAM_CUPS-300-D-Z' && i.boca === 'P2_vertical' && i.kind === 'uncalibrated')).toBe(true);
    } finally {
      setMasterResolver((p) => findMasterForProduct(p as Record<string, unknown>));
    }
  });

  it('la auditoría FALLA si una boca resuelve a un puerto que el catálogo no publica', () => {
    const report = auditPortMappings({
      ...baseInput(),
      resolve: (pid, boca) =>
        pid === 'SAM_TPS-300-Z' && boca === 'boca_derivacion'
          ? { status: 'mapped', catalogPortName: 'P9', source: 'master' }
          : resolveCatalogPort(pid, boca),
    });
    expect(report.issues.filter((i) => i.producto_id === 'SAM_TPS-300-Z')).toEqual([
      expect.objectContaining({ producto_id: 'SAM_TPS-300-Z', boca: 'boca_derivacion', kind: 'missing-catalog-port' }),
    ]);
  });
});
