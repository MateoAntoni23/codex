/**
 * Cobertura de anchos en el camino de oferta, sobre el catálogo real.
 *
 * Para cada familia con modelo y cada tipo de pieza colocable, TODO ancho que el
 * catálogo declara para esa familia tiene que ser ofrecible: desde un tramo
 * recto de la MISMA familia y el mismo ancho, el selector de continuación
 * (regla física + clasificación de candidatos, lo mismo que usa RoutingPanel)
 * lo trae como "recomendado" y su definición efectiva se resuelve.
 *
 * Si mañana se cae un ancho de cualquier familia (receta que no resuelve,
 * filtro nuevo, regla que lo descarta), esta prueba falla nombrando el
 * producto. La DCPS no entra por la continuación (sólo con la herramienta
 * "Derivación en tramo"): se controla aparte con la búsqueda de esa herramienta.
 *
 * Lo que NO exige: que se ofrezca una pieza de OTRA familia. La familia color
 * (SAM-STP-ZN, ZN/ZB) sólo publica recto, curva plana y T; no tiene curva
 * vertical ni X, y no hay compatibilidad entre familias (REV-032). Esa
 * ausencia queda fijada en el último caso.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { definicionEfectiva, modeloDeProducto } from '../placement/definitions';
import { compatiblesDirectos } from '../compatibilidadFisica';
import { buildContinuationCandidates, esDerivacionLateral } from '../continuationCandidates';
import { dcpsParaAncho } from '../derivacion/enganche';
import type { CatalogCompatibility, Product } from '../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as {
  PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[];
};
const PS = snap.PRODUCTOS;
const fam = (p: Product) => (p as Record<string, unknown>).familia_id as string | undefined;
const colocable = (p: Product) => modeloDeProducto(p)?.colocable === true;

/** Familias de bandeja con al menos un tramo recto con modelo. */
const FAMILIAS = [...new Set(PS.filter((p) => p.tipo_pieza === 'recta' && colocable(p)).map((p) => fam(p)!))].sort();

/** Ofrecidos como "recomendados" desde la boca P2 del recto dado. */
function ofrecidosDesde(recto: Product): Set<string> {
  const ids = compatiblesDirectos(recto, PS, snap.COMPATIBILIDADES);
  return new Set(buildContinuationCandidates({ existingProduct: recto, existingPortName: 'P2', catalogProducts: PS, compatibleIds: ids })
    .filter((c) => c.category === 'recommended' && c.insertionSupported)
    .map((c) => c.product.producto_id));
}

describe('todos los anchos declarados del catálogo son ofrecibles, por familia', () => {
  it('hay familias paramétricas que cubrir (perforada Z, perforada color y escalera)', () => {
    expect(FAMILIAS).toEqual(expect.arrayContaining(['SAM-STP-Z', 'SAM-STP-ZN']));
    expect(FAMILIAS.some((f) => f.startsWith('SAM-STE'))).toBe(true);
  });

  for (const familia of FAMILIAS) {
    it(`${familia}: cada (tipo de pieza, ancho) colocable se ofrece desde un recto de su ancho`, () => {
      const deFamilia = PS.filter((p) => fam(p) === familia && typeof p.ancho_nominal_mm === 'number' && colocable(p) && !esDerivacionLateral(p));
      const rectos = new Map<number, Product[]>();
      for (const p of deFamilia.filter((x) => x.tipo_pieza === 'recta')) {
        (rectos.get(p.ancho_nominal_mm!) ?? rectos.set(p.ancho_nominal_mm!, []).get(p.ancho_nominal_mm!)!).push(p);
      }
      const faltan: string[] = [];
      for (const p of deFamilia) {
        const ancho = p.ancho_nominal_mm!;
        const desde = rectos.get(ancho) ?? [];
        if (desde.length === 0) { faltan.push(`${p.sku}: no hay recto de ${ancho} mm en ${familia} desde donde ofrecerlo`); continue; }
        // Ofrecible desde AL MENOS un recto de su familia y ancho (puede haber varias chapas/largos).
        if (!desde.some((r) => ofrecidosDesde(r).has(p.producto_id))) faltan.push(`${p.sku} (${p.tipo_pieza}, ${ancho} mm) no se ofrece desde ${desde.map((r) => r.sku).join(' / ')}`);
        const d = definicionEfectiva(p);
        if (!d.ok) faltan.push(`${p.sku}: la definición no resuelve`);
      }
      expect(faltan, faltan.join('\n')).toEqual([]);
    });

    it(`${familia}: ningún ancho del catálogo queda sin modelo en un tipo que sí lo tiene en otro ancho`, () => {
      // Si un tipo de pieza es colocable en algún ancho, tiene que serlo en todos los que el catálogo declara.
      const porTipo = new Map<string, Product[]>();
      for (const p of PS.filter((x) => fam(x) === familia && typeof x.ancho_nominal_mm === 'number')) {
        (porTipo.get(p.tipo_pieza) ?? porTipo.set(p.tipo_pieza, []).get(p.tipo_pieza)!).push(p);
      }
      const huecos: string[] = [];
      for (const [tipo, ps] of porTipo) {
        // Sólo los patrones con modelo: un tipo sin ningún ancho colocable es otra cosa (inserción pendiente).
        const patrones = new Set(ps.filter(colocable).map((p) => modeloDeProducto(p)!.patron));
        for (const p of ps) {
          const m = modeloDeProducto(p);
          if (patrones.size > 0 && m && patrones.has(m.patron) && !m.colocable) huecos.push(`${p.sku} (${tipo})`);
          if (patrones.size > 0 && !m && ps.some((q) => colocable(q) && q.sku.replace(/\d+/g, '#') === p.sku.replace(/\d+/g, '#'))) huecos.push(`${p.sku} (${tipo}): sin modelo, sus hermanos de otro ancho lo tienen`);
        }
      }
      expect(huecos, huecos.join('\n')).toEqual([]);
    });
  }

  it('DCPS: la herramienta "Derivación en tramo" encuentra la derivación de cada ancho que el catálogo declara', () => {
    const porId = new Map(PS.map((p) => [p.producto_id, p]));
    const dcps = PS.filter((p) => String(p.sku).startsWith('DCPS-'));
    expect(dcps.length).toBeGreaterThan(0);
    for (const p of dcps) {
      expect(dcpsParaAncho(porId, p.ancho_nominal_mm!)?.producto_id, p.sku).toBe(p.producto_id);
      expect(definicionEfectiva(p).ok, p.sku).toBe(true);
    }
  });

  it('familia color (SAM-STP-ZN): no publica curva vertical ni X, y no se ofrecen las de la familia Z (REV-032)', () => {
    const zn = PS.filter((p) => fam(p) === 'SAM-STP-ZN');
    expect(zn.some((p) => /curva vertical|^X$/.test(p.tipo_pieza))).toBe(false);
    for (const ancho of [50, 100]) {
      const recto = zn.find((p) => p.tipo_pieza === 'recta' && p.ancho_nominal_mm === ancho)!;
      const ofrecidos = ofrecidosDesde(recto);
      const w = String(ancho).padStart(3, '0');
      for (const id of [`SAM_CUPS-${w}-A-Z`, `SAM_CUPS-${w}-D-Z`, `SAM_XPS-${w}-Z`]) expect(ofrecidos.has(id), `${recto.sku} → ${id}`).toBe(false);
      // Lo que la familia color sí tiene, se ofrece.
      expect(ofrecidos.has(`SAM_TPS-${w}-ZN`)).toBe(true);
      expect(ofrecidos.has(`SAM_CPS-${w}-90-ZN`)).toBe(true);
    }
  });
});
