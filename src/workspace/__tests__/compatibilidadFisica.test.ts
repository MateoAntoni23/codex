/**
 * Regla física de unión directa sobre el catálogo real.
 * Control negativo: ofrecer una escalera como continuación de una perforada falla.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bloqueoExplicito, compatibilidadDirecta, compatiblesDirectos, FAMILIA_ACCESORIOS_UNION } from '../compatibilidadFisica';
import { esBloqueoREV032Superado } from '../mezclaAcabados';
import type { CatalogCompatibility, Product } from '../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as {
  PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[];
};
const P = new Map(snap.PRODUCTOS.map((p) => [p.producto_id, p]));
const C = snap.COMPATIBILIDADES;
const fam = (p: Product) => (p as Record<string, unknown>).familia_id as string;
const ala = (p: Product) => (p as Record<string, unknown>).ala_nominal_mm;

describe('compatibilidad por la regla física', () => {
  it('desde la CPS-300-45-Z (perforada zincada) sólo se ofrece perforada de 300 y ala 50 (zincada o color, ésta con mezcla de acabados), o accesorios de unión — NUNCA escalera', () => {
    const cps = P.get('SAM_CPS-300-45-Z')!;
    const ids = compatiblesDirectos(cps, snap.PRODUCTOS, C);
    expect(ids.has('SAM_CS-300-45-065-14-G'), 'la escalera galvanizada del defecto').toBe(false);
    for (const id of ids) {
      const p = P.get(id)!;
      expect(fam(p).startsWith('SAM-STE'), `escalera ofrecida desde perforada: ${id}`).toBe(false);
      if (fam(p) === FAMILIA_ACCESORIOS_UNION) continue;
      expect(['SAM-STP-Z', 'SAM-STP-ZN'], id).toContain(fam(p));
      expect([p.ancho_nominal_mm, ala(p)], id).toEqual([300, 50]);
      // Color desde zincada: se ofrece, marcada como mezcla de acabados.
      const r = compatibilidadDirecta(cps, p, C);
      expect(r.ok && r.mezcla !== null, `${id}: mezcla`).toBe(fam(p) === 'SAM-STP-ZN');
    }
    expect(ids.has('SAM_TRPS-300-22-ZN')).toBe(true);
    expect(ids.has('SAM_TRPS-300-22-Z')).toBe(true);
    expect(ids.has('SAM_TPS-300-Z')).toBe(true);
  });

  it('control negativo sobre todo el catálogo: ninguna pieza perforada tiene una escalera entre sus compatibles directos', () => {
    const perf = snap.PRODUCTOS.filter((p) => fam(p)?.startsWith('SAM-STP'));
    for (const p of perf) {
      for (const id of compatiblesDirectos(p, snap.PRODUCTOS, C)) {
        expect(fam(P.get(id)!).startsWith('SAM-STE'), `${p.producto_id} → ${id}`).toBe(false);
      }
    }
  });

  it('el espesor no es criterio: misma familia, ancho y ala con distinta chapa es compatible', () => {
    const par = snap.PRODUCTOS.flatMap((a) => snap.PRODUCTOS.filter((b) =>
      fam(a) === fam(b) && a.ancho_nominal_mm === b.ancho_nominal_mm && ala(a) != null && ala(a) === ala(b)
      && (a as Record<string, unknown>).espesor_chapa_mm !== (b as Record<string, unknown>).espesor_chapa_mm
      && fam(a) !== FAMILIA_ACCESORIOS_UNION).map((b) => [a, b] as const))[0];
    expect(par, 'hay al menos un par así en el catálogo').toBeDefined();
    expect(compatibilidadDirecta(par[0], par[1], C).ok).toBe(true);
  });

  it('de los 45 pares "no compatible": los 38 de REV-032 entre acabados del mismo tipo de bandeja unen con marca de mezcla; los otros 7 siguen bloqueando', () => {
    const nc = C.filter((c) => c.estado_compatibilidad === 'no compatible');
    expect(nc).toHaveLength(45);
    let superados = 0;
    for (const c of nc) {
      const a = P.get(c.producto_a_id)!;
      const b = P.get(c.producto_b_id)!;
      expect(bloqueoExplicito(C, b, a)?.compatibilidad_id).toBe(c.compatibilidad_id);
      const r = compatibilidadDirecta(a, b, C);
      if (esBloqueoREV032Superado(c, a, b)) {
        superados++;
        expect(r, c.compatibilidad_id).toMatchObject({ ok: true, regla: 'mismo tipo de bandeja, ancho y ala (mezcla de acabados)' });
        expect(r.ok && r.mezcla?.texto, c.compatibilidad_id).toContain('declarado por el operador, contradice REV-032 (fuente del catálogo)');
      } else {
        expect(r, c.compatibilidad_id).toMatchObject({ ok: false, bloqueo: c.compatibilidad_id });
      }
    }
    expect(superados).toBe(38);
  });

  it('excepción declarada: los accesorios de unión (SAM-SMT-ACC) se unen con cualquier familia', () => {
    const acc = snap.PRODUCTOS.find((p) => fam(p) === FAMILIA_ACCESORIOS_UNION)!;
    expect(compatibilidadDirecta(acc, P.get('SAM_TRES-300-065-18-Z')!, C)).toMatchObject({ ok: true, regla: 'accesorio de unión (SAM-SMT-ACC)' });
    expect(compatibilidadDirecta(P.get('SAM_TRPS-300-22-Z')!, acc, C)).toMatchObject({ ok: true, regla: 'accesorio de unión (SAM-SMT-ACC)' });
  });

  it('las reducciones no son unión directa: una reducción contra un recto de otro ancho no pasa la regla (sigue por findReductionCandidates)', () => {
    const red = snap.PRODUCTOS.find((p) => p.tipo_pieza === 'reducción' && fam(p) === 'SAM-STE-G')!;
    const recto = snap.PRODUCTOS.find((p) => p.tipo_pieza === 'recta' && fam(p) === 'SAM-STE-G' && p.ancho_nominal_mm !== red.ancho_nominal_mm && ala(p) === ala(red))!;
    expect(compatibilidadDirecta(red, recto, C).ok).toBe(false);
  });
});
