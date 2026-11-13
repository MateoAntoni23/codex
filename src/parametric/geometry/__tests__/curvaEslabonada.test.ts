/**
 * Curvas eslabonadas (EPS, CUS) — regla declarada por el operador (2026-11-13).
 *
 * Control negativo: si la regla de eslabones devolviera un número fijo
 * (independiente del ángulo), fallan la regla, la geometría, el cambio de ángulo
 * y el cómputo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCurvaEslabonadaRecipe, eslabonesPara, medidasEslabonada, ANGULO_ESLABONADA_POR_DEFECTO } from '../curvaEslabonada';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../../workspace/catalogPortMapping';
import { definicionEfectiva, modeloDeProducto, withDefinition } from '../../../workspace/placement/definitions';
import { placeDefinition, puertosFromWorld } from '../../../workspace/placement/placementCore';
import { cambiarAnguloEslabonada } from '../../../workspace/placement/anguloEslabonada';
import { avisosDeModelo } from '../../../workspace/placement/joins';
import { compraEslabones, curvasEslabonadas, eslabonesPorCodigo, type CurvaEslabonada } from '../../../workspace/computoEslabonado';
import { findMasterForProduct } from '../../../configurator/masterModels';
import type { Product, TrayInput } from '../../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const productos = new Map(snap.PRODUCTOS.map((p) => [p.producto_id, p]));
const P = (id: string) => productos.get(id)!;
const RAD = Math.PI / 180;

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

describe('regla de eslabones (operador)', () => {
  it('N = techo(θ/22,5°) + 1: 90° → 5 y 45° → 3 (verificado por el operador); depende del ángulo', () => {
    expect(eslabonesPara(90)).toBe(5);
    expect(eslabonesPara(45)).toBe(3);
    expect(eslabonesPara(22.5)).toBe(2);
    expect(eslabonesPara(30)).toBe(3);
    expect(eslabonesPara(67.5)).toBe(4);
    expect(eslabonesPara(180)).toBe(9);
    expect(() => eslabonesPara(0)).toThrow();
  });

  it('longitud de eje = N−1 cuerdas sobre radio = ancho (no el arco)', () => {
    const m90 = medidasEslabonada(300, 90);
    expect(m90.radioMm).toBe(300);
    expect(m90.cuerdaMm).toBeCloseTo(2 * 300 * Math.sin(11.25 * RAD), 9);
    expect(m90.longitudEjeMm).toBeCloseTo(4 * 2 * 300 * Math.sin(11.25 * RAD), 9); // 468,18 mm
    expect(m90.longitudEjeMm).toBeLessThan(300 * Math.PI / 2); // el arco (471,24) es más largo
    const m45 = medidasEslabonada(300, 45);
    expect(m45.longitudEjeMm).toBeCloseTo(2 * 2 * 300 * Math.sin(11.25 * RAD), 9);
    // θ no múltiplo de 22,5°: se reparte en las N−1 articulaciones (cada una ≤ 22,5°).
    const m30 = medidasEslabonada(300, 30);
    expect([m30.eslabones, m30.gradosPorArticulacion]).toEqual([3, 15]);
  });
});

describe('geometría: la boca de salida es la de entrada girada θ alrededor del centro', () => {
  for (const angulo of [22.5, 45, 90, 135]) {
    for (const sentido of ['sube', 'baja'] as const) {
      it(`${angulo}° ${sentido}`, () => {
        const r = buildCurvaEslabonadaRecipe({ ancho_mm: 300, ala_mm: 65, angulo_deg: angulo, sentido });
        const [p1, p2] = r.ports;
        expect([p1.name, p2.name]).toEqual(['P1', 'P2']);
        // Centro del giro en (0, −R): P2 a distancia R, girada θ.
        expect(Math.hypot(p2.center[0], p2.center[1] + 300)).toBeCloseTo(300, 9);
        expect(p2.center[0]).toBeCloseTo(300 * Math.sin(angulo * RAD), 9);
        // Giro entre bocas = θ.
        const dot = p1.normal[0] * p2.normal[0] + p1.normal[1] * p2.normal[1];
        expect(180 - Math.acos(dot) / RAD).toBeCloseTo(angulo, 6);
        // Marcos derechos (u × v = normal) y ala del catálogo en las bocas.
        for (const p of r.ports) {
          const [u, v, n] = [p.u_dir, p.v_dir, p.normal];
          const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          x.forEach((c, i) => expect(c).toBeCloseTo(n[i], 9));
          expect(p.ala_mm).toBe(65);
        }
      });
    }
  }
});

describe('maestros: EPS y CUS (equivalencia con la CUPS retirada)', () => {
  it('las 7 EPS y las 40 CUS resuelven a su maestro eslabonado y son colocables', () => {
    const eps = snap.PRODUCTOS.filter((p) => String(p.sku).startsWith('EPS-'));
    const cus = snap.PRODUCTOS.filter((p) => String(p.sku).startsWith('CUS-'));
    expect([eps.length, cus.length]).toEqual([7, 40]);
    for (const p of eps) expect(findMasterForProduct(p as Record<string, unknown>)?.id, p.sku).toBe('master:perforada:curva_eslabonada');
    for (const p of cus) expect(findMasterForProduct(p as Record<string, unknown>)?.id, p.sku).toBe('master:escalera:curva_eslabonada');
    for (const p of [...eps, ...cus]) expect(modeloDeProducto(p)?.colocable, p.sku).toBe(true);
    // No hay CUS de 50 ni 100: en esos anchos sólo existe la perforada.
    expect(cus.some((p) => p.ancho_nominal_mm === 50 || p.ancho_nominal_mm === 100)).toBe(false);
    expect(eps.map((p) => p.ancho_nominal_mm).sort((a, b) => a! - b!)).toEqual([50, 100, 150, 200, 300, 450, 600]);
  });

  it('sin el perfil de la CUPS no queda el aviso de ala de 36,56 mm en ninguna CUS', () => {
    for (const p of snap.PRODUCTOS.filter((x) => String(x.sku).startsWith('CUS-'))) {
      const d = definicionEfectiva(p, { sentido_vertical: 'sube' });
      expect(d.ok, p.sku).toBe(true);
      if (!d.ok) continue;
      expect(d.def.ports.map((q) => q.ala_mm), p.sku).toEqual([p.ala_nominal_mm, p.ala_nominal_mm]);
      const avisos = avisosDeModelo({ piezas: [], conexiones: [] } as unknown as TrayInput, { instancia_id: 'x', producto_id: p.producto_id, puertos: {} } as never);
      expect(avisos).toEqual([]);
    }
  });

  it('el ángulo por defecto es 90° y entra en la definición (huella distinta por ángulo)', () => {
    const d90 = definicionEfectiva(P('SAM_EPS-300-Z'), { sentido_vertical: 'sube' });
    const d45 = definicionEfectiva(P('SAM_EPS-300-Z'), { sentido_vertical: 'sube', angulo_deg: 45 });
    expect(d90.ok && d90.def.params.angulo_deg).toBe(ANGULO_ESLABONADA_POR_DEFECTO);
    expect(d45.ok && d45.def.params.angulo_deg).toBe(45);
    expect(d90.ok && d45.ok && d90.huella !== d45.huella).toBe(true);
  });
});

/** Trazado con una curva eslabonada colocada entrando por P1 hacia +X, sección hacia +Z. */
function conCurva(productoId: string, angulo: number, sentido: 'sube' | 'baja'): TrayInput {
  const d = definicionEfectiva(P(productoId), { angulo_deg: angulo, sentido_vertical: sentido });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t = withDefinition({ version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {} } as unknown as TrayInput, d.huella, d.def);
  return { ...t, piezas: [{ instancia_id: 'C', producto_id: productoId, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never] };
}

describe('cambiar el ángulo de una curva colocada', () => {
  it('EPS-300 a 90° sube → 45°: P1 queda, P2 y la longitud se recalculan; 5 → 3 eslabones', () => {
    const t = conCurva('SAM_EPS-300-Z', 90, 'sube');
    const p2a = t.piezas[0].puertos.P2.posicion_mm;
    // Sube: con radio 300 la boca de salida queda a 300 mm adelante y 300 mm arriba, mirando hacia arriba.
    expect(p2a[0]).toBeCloseTo(300, 6);
    expect(p2a[2]).toBeCloseTo(300, 6);
    expect(t.piezas[0].puertos.P2.direccion[2]).toBeCloseTo(1, 9);
    expect(curvasEslabonadas(t, productos)[0].eslabones).toBe(5);

    const r = cambiarAnguloEslabonada(t, productos, 'C', 45);
    if (!r.ok) throw new Error(r.motivo);
    const c = r.entrada.piezas[0];
    expect(c.puertos.P1).toEqual(t.piezas[0].puertos.P1);
    expect(c.puertos.P2.posicion_mm[0]).toBeCloseTo(300 * Math.sin(45 * RAD), 6);
    expect(c.puertos.P2.posicion_mm[2]).toBeCloseTo(300 - 300 * Math.cos(45 * RAD), 6);
    expect(r.eslabones).toBe(3);
    expect(curvasEslabonadas(r.entrada, productos)[0]).toMatchObject({ anguloDeg: 45, eslabones: 3 });
    expect(c.longitud_eje_mm).toBeCloseTo(medidasEslabonada(300, 45).longitudEjeMm, 6);
  });

  it('fuera de rango o sobre otra pieza: no se cambia, con motivo', () => {
    const t = conCurva('SAM_EPS-300-Z', 90, 'baja');
    expect(cambiarAnguloEslabonada(t, productos, 'C', 0)).toMatchObject({ ok: false });
    expect(cambiarAnguloEslabonada(t, productos, 'X', 45)).toMatchObject({ ok: false });
  });
});

describe('cómputo por eslabones', () => {
  const curva = (pieza: string, sku: string, anguloDeg: number): CurvaEslabonada => ({
    pieza, producto_id: `SAM_${sku}`, sku, sistema: sku.startsWith('EPS') ? 'perforada' : 'escalera', anguloDeg, eslabones: eslabonesPara(anguloDeg), longitudEjeMm: 0,
  });

  it('eslabones por código: EPS 1 (se vende por eslabón), CUS el número del código (5)', () => {
    expect(eslabonesPorCodigo('EPS-300-Z')).toBe(1);
    expect(eslabonesPorCodigo('CUS-300-5-065-18-Z')).toBe(5);
  });

  it('perforada: una curva de 90° son 5 × EPS-300-Z; a 45°, 3', () => {
    expect(compraEslabones([curva('C1', 'EPS-300-Z', 90)])[0]).toMatchObject({ eslabones: 5, codigos: 5 });
    expect(compraEslabones([curva('C1', 'EPS-300-Z', 45)])[0]).toMatchObject({ eslabones: 3, codigos: 3 });
  });

  it('escalera: dos curvas de 45° = 3 + 3 = 6 eslabones → techo(6/5) = 2 códigos (aquí curva por curva también da 1 + 1 = 2)', () => {
    const l = compraEslabones([curva('C1', 'CUS-300-5-065-18-Z', 45), curva('C2', 'CUS-300-5-065-18-Z', 45)]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ eslabones: 6, eslabonesPorCodigo: 5, codigos: 2, curvas: ['C1', 'C2'] });
  });

  it('escalera: cuatro curvas de 45° = 12 eslabones → 3 códigos, NO 4 (redondear curva por curva sobrecompra)', () => {
    const cs = [1, 2, 3, 4].map((i) => curva(`C${i}`, 'CUS-300-5-065-18-Z', 45));
    const porCurva = cs.reduce((s, c) => s + Math.ceil(c.eslabones / 5), 0);
    expect(porCurva).toBe(4);
    expect(compraEslabones(cs)[0]).toMatchObject({ eslabones: 12, codigos: 3 });
  });

  it('se agrupa por código (ancho, ala, espesor, acabado): códigos distintos no se suman', () => {
    const l = compraEslabones([curva('C1', 'CUS-300-5-065-18-Z', 45), curva('C2', 'CUS-300-5-065-18-G', 45), curva('C3', 'CUS-300-5-090-18-Z', 45)]);
    expect(l.map((x) => [x.sku, x.eslabones, x.codigos])).toEqual([
      ['CUS-300-5-065-18-G', 3, 1], ['CUS-300-5-065-18-Z', 3, 1], ['CUS-300-5-090-18-Z', 3, 1],
    ]);
  });
});
