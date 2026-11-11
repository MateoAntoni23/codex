// @vitest-environment jsdom
/**
 * PB4 — calibrar un patrón en el configurador se refleja en TODAS sus variantes
 * al colocar piezas nuevas, y en NINGUNA ya colocada.
 *
 * Se calibra por la acción del configurador (`setCorreccionPatron`): la boca de
 * derivación de la T perforada (TPS) 5 mm hacia afuera (eje axial).
 *   - Cada variante (050…600) coloca su boca de derivación exactamente 5 mm más
 *     afuera que sin calibrar, en la dirección de su normal (no se escala).
 *   - La variante medida (300) no lleva marca; las demás llevan "calibración
 *     heredada, sin verificar en este ancho".
 *   - Una pieza colocada antes conserva su definición, huella y bocas; queda
 *     como desactualizada (A-6).
 * Control negativo: otro patrón (CPS-90) no cambia.
 *
 * Tolerancia 1e-9 mm: la corrección se suma en doble precisión sobre valores
 * de magnitud ≤ 10³ mm.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStaticCatalog, seedStaticCatalog } from '../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../workspace/catalogPortMapping';
import { clearBibliotecaCalibracion, MARCA_HEREDADA } from '../../workspace/calibracionPatron';
import { definicionEfectiva, outdatedPieces, placedOf, withDefinition } from '../../workspace/placement/definitions';
import { placeDefinition, puertosFromWorld, worldPorts } from '../../workspace/placement/placementCore';
import { useCatalogConfigStore } from '../catalogConfigStore';
import type { Product, TrayInput } from '../../tray/model';

let productos: Product[];
const byId = (id: string) => productos.find((p) => p.producto_id === id)!;
const TPS = ['SAM_TPS-050-Z', 'SAM_TPS-100-Z', 'SAM_TPS-150-Z', 'SAM_TPS-200-Z', 'SAM_TPS-300-Z', 'SAM_TPS-450-Z', 'SAM_TPS-600-Z'];

function derivacion(p: Product) {
  const d = definicionEfectiva(p);
  if (!d.ok) throw new Error(`${p.sku}: ${d.motivo}`);
  return { d, port: d.def.ports.find((q) => q.name === 'boca_derivacion')! };
}

beforeAll(async () => {
  localStorage.clear();
  clearPortMappingOverrides();
  clearBibliotecaCalibracion();
  productos = [...(await loadStaticCatalog()).productos];
  await seedStaticCatalog();
});
afterAll(() => {
  clearBibliotecaCalibracion();
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
  localStorage.clear();
});

describe('PB4 — calibración de patrón', () => {
  it('se refleja en todas las variantes nuevas y en ninguna colocada', () => {
    const antes = new Map(TPS.map((id) => [id, derivacion(byId(id))]));
    const cps = definicionEfectiva(byId('SAM_CPS-450-90-Z'));

    // Pieza ya colocada (TPS-450) antes de calibrar.
    const a450 = antes.get('SAM_TPS-450-Z')!.d;
    const placed = placeDefinition({ def: a450.def, huella: a450.huella, mano: 'nativa', entryPortName: 'tronco_P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    let tray: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [{ instancia_id: 'T', producto_id: 'SAM_TPS-450-Z', puertos: puertosFromWorld(placed.ports), colocacion: placed.colocacion }],
      conexiones: [], circuitos: [], soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
    };
    tray = withDefinition(tray, a450.huella, a450.def);
    const puertosColocada = JSON.stringify(tray.piezas[0].puertos);

    // El operador calibra el PATRÓN desde el configurador.
    useCatalogConfigStore.getState().setCorreccionPatron(
      a450.def.patron,
      'boca_derivacion',
      { desplazamiento_mm: { lateral: 0, vertical: 0, axial: 5 }, giro_deg: { lateral: 0, vertical: 0, axial: 0 } },
      'prueba PB4: boca de derivación 5 mm afuera',
    );

    for (const id of TPS) {
      const { port: p0 } = antes.get(id)!;
      const { d, port: p1 } = derivacion(byId(id));
      const dx = p1.center.map((v, k) => v - p0.center[k]);
      const esperado = p0.normal.map((n) => 5 * n);
      expect(Math.max(...dx.map((v, k) => Math.abs(v - esperado[k]))), `${id}: 5 mm sobre su normal`).toBeLessThan(1e-9);
      expect(d.def.calibracion?.origen, id).toBe('patron');
      if (id === 'SAM_TPS-300-Z') expect(d.def.calibracion?.heredada, id).toBe(false);
      else {
        expect(d.def.calibracion?.heredada, id).toBe(true);
        expect(d.def.calibracion?.nota).toBe(MARCA_HEREDADA);
      }
    }

    // La pieza ya colocada no cambia (se dibuja desde su definición guardada)…
    const pz = placedOf(tray, tray.piezas[0])!;
    expect(pz.colocacion.definicion.huella).toBe(a450.huella);
    expect(JSON.stringify(puertosFromWorld(worldPorts(pz.def, pz.colocacion.mano, pz.colocacion.pose)))).toBe(puertosColocada);
    // …pero se informa que difiere de la vigente.
    expect(outdatedPieces(tray, new Map(productos.map((p) => [p.producto_id, p]))).map((o) => o.id)).toEqual(['T']);

    // Control negativo: otro patrón no cambia.
    const cpsDespues = definicionEfectiva(byId('SAM_CPS-450-90-Z'));
    expect(cps.ok && cpsDespues.ok && cpsDespues.huella).toBe(cps.ok ? cps.huella : null);
  });
});
