/**
 * Decisión 3 (B-2): desactualización por GEOMETRÍA, no por huella.
 *
 *   - Una definición con otra huella pero la misma geometría (otra revisión,
 *     vértices movidos menos que la precisión de las fuentes) NO deja la pieza
 *     desactualizada.
 *   - Control negativo: un cambio real (vértice 0,02 mm, por encima de la
 *     tolerancia de 0,01 mm a ancho 300) SÍ la deja desactualizada.
 *   - La tolerancia escala con el ancho (0,01 mm × ancho/300).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, outdatedPieces, withDefinition } from '../definitions';
import { compararDefiniciones, tolGeomMm } from '../geometriaEquivalente';
import { definitionHash, placeDefinition, puertosFromWorld, type StoredDefinition } from '../placementCore';
import type { Product, TrayInput } from '../../../tray/model';

const snapshot = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const productos = new Map(snapshot.PRODUCTOS.map((p) => [p.producto_id, p]));

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

function vigente(id: string) {
  const d = definicionEfectiva(productos.get(id)!);
  if (!d.ok) throw new Error(d.motivo);
  return d;
}

/** Copia de la definición con el vértice 0 movido `dx` mm (y otra revisión). */
function variar(def: StoredDefinition, dx: number): StoredDefinition {
  const polygon = def.mesh.polygon.map((v, i) => (i === 0 ? [v[0] + dx, v[1]] as const : v));
  return { ...def, revision: `${def.revision}-x`, mesh: { ...def.mesh, polygon } };
}

/** Trazado con una pieza colocada con `def` (la definición guardada). */
function trazadoCon(id: string, def: StoredDefinition): TrayInput {
  const huella = definitionHash(def);
  const pl = placeDefinition({ def, huella, mano: 'nativa', entryPortName: def.ports[0].name, startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t: TrayInput = {
    version_contrato: 'trazado/1',
    piezas: [{ instancia_id: 'X', producto_id: id, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion }],
    conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  };
  return withDefinition(t, huella, def);
}

describe('desactualización por geometría', () => {
  it('otra huella con la misma geometría (dentro de la precisión de las fuentes): no se pide actualizar', () => {
    const d = vigente('SAM_CPS-300-90-Z');
    const guardada = variar(d.def, 0.004);
    expect(definitionHash(guardada)).not.toBe(d.huella);
    expect(outdatedPieces(trazadoCon('SAM_CPS-300-90-Z', guardada), productos)).toEqual([]);
  });

  it('control negativo: un cambio real (0,02 mm) sí la deja desactualizada, con motivo', () => {
    const d = vigente('SAM_CPS-300-90-Z');
    const out = outdatedPieces(trazadoCon('SAM_CPS-300-90-Z', variar(d.def, 0.02)), productos);
    expect(out.map((o) => o.id)).toEqual(['X']);
    expect(out[0].motivo).toMatch(/la geometría cambió 0\.02\d mm/);
  });

  it('la tolerancia escala con el ancho (redondeo del modelo de 300 escalado)', () => {
    expect(tolGeomMm(vigente('SAM_CPS-300-90-Z').def)).toBeCloseTo(0.01, 12);
    expect(tolGeomMm(vigente('SAM_CPS-600-90-Z').def)).toBeCloseTo(0.02, 12);
    expect(tolGeomMm(vigente('SAM_CPS-050-90-Z').def)).toBeCloseTo(0.01, 12);
  });

  it('compararDefiniciones: misma definición → equivalente con 0 mm', () => {
    const d = vigente('SAM_TS-300-065-18-Z');
    const c = compararDefiniciones(d.def, d.def);
    expect(c.equivalente).toBe(true);
    expect(c.maxMm).toBeLessThan(1e-9);
  });
});
