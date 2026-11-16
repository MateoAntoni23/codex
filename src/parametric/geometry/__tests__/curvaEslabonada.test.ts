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
import * as THREE from 'three';
import { buildCurvaEslabonadaRecipe, eslabonesPara, medidasEslabonada, ANGULO_ESLABONADA_POR_DEFECTO } from '../curvaEslabonada';
import { motivoAnguloEslabonada, planoDeGiro, radioEslabonadaDe, RADIO_INTERIOR_CUS_MM, RADIO_INTERIOR_EPS_MM } from '../../reglaEslabones';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../../workspace/catalogPortMapping';
import { definicionEfectiva, modeloDeProducto, outdatedPieces, piezasSinDefinicionVigente, withDefinition } from '../../../workspace/placement/definitions';
import { definitionFromRecipe, definitionHash, placeDefinition, puertosFromWorld } from '../../../workspace/placement/placementCore';
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
    expect(eslabonesPara(30)).toBe(3);
    expect(eslabonesPara(67.5)).toBe(4);
    expect(eslabonesPara(180)).toBe(9);
    expect(() => eslabonesPara(0)).toThrow();
  });

  it('N = 2 (θ ≤ 22,5°) se rechaza sin callejón, según el PLANO del giro: vertical → el catálogo no publica pieza; horizontal → CAS', () => {
    for (const a of [1, 10, 22.5]) {
      // Vertical (la eslabonada sube o baja; también por defecto): mínimo, porqué y que no hay pieza. Sin otra pieza sugerida.
      const v = motivoAnguloEslabonada(a);
      expect(v, `${a}°`).toBe(motivoAnguloEslabonada(a, 'vertical'));
      expect(v).toMatch(/más de 22,5°/);
      expect(v).toMatch(/3 eslabones/);
      expect(v).toMatch(/gráfico de radios del catálogo/);
      expect(v).toMatch(/Para un cambio de nivel menor, el catálogo no publica ninguna pieza\.$/);
      expect(v).not.toMatch(/CAS|ajustable|horizontal/);
      // Horizontal: la curva ajustable CAS, que gira en horizontal.
      const h = motivoAnguloEslabonada(a, 'horizontal');
      expect(h).toMatch(/más de 22,5°.*3 eslabones.*gráfico de radios del catálogo/);
      expect(h).toMatch(/Para un giro horizontal menor está la curva ajustable CAS \(más de 0° y hasta 90°\)\.$/);
      expect(h).not.toMatch(/cambio de nivel/);
      expect(() => eslabonesPara(a)).toThrow(/más de 22,5°/);
    }
    expect(motivoAnguloEslabonada(22.6)).toBeNull();
    expect(motivoAnguloEslabonada(180)).toBeNull();
    expect(motivoAnguloEslabonada(180.5)).toMatch(/hasta 180°/);
  });

  it('plano del giro por la geometría: eje de giro vertical → horizontal; si no, vertical', () => {
    expect(planoDeGiro([-1, 0, 0], [0, 1, 0])).toBe('horizontal'); // gira en planta
    expect(planoDeGiro([-1, 0, 0], [0, 0, 1])).toBe('vertical'); // sube
    expect(planoDeGiro([-1, 0, 0], [0, 0, -1])).toBe('vertical'); // baja
    expect(planoDeGiro([-1, 0, 0], [1, 0, 0])).toBeNull(); // sin giro
  });

  it('longitud de eje = N−1 cuerdas sobre el radio del EJE (interior + ala/2), no el arco', () => {
    // EPS: radio interior 260, ala 50 → eje 285.
    const m90 = medidasEslabonada({ radioInteriorMm: 260, alaMm: 50, anguloDeg: 90 });
    expect([m90.radioInteriorMm, m90.radioEjeMm]).toEqual([260, 285]);
    expect(m90.cuerdaMm).toBeCloseTo(2 * 285 * Math.sin(11.25 * RAD), 9);
    expect(m90.longitudEjeMm).toBeCloseTo(4 * 2 * 285 * Math.sin(11.25 * RAD), 9);
    expect(m90.longitudEjeMm).toBeLessThan(285 * Math.PI / 2); // el arco es más largo
    const m45 = medidasEslabonada({ radioInteriorMm: 260, alaMm: 50, anguloDeg: 45 });
    expect(m45.longitudEjeMm).toBeCloseTo(2 * 2 * 285 * Math.sin(11.25 * RAD), 9);
    // θ no múltiplo de 22,5°: se reparte en las N−1 articulaciones (cada una ≤ 22,5°).
    const m30 = medidasEslabonada({ radioInteriorMm: 260, alaMm: 50, anguloDeg: 30 });
    expect([m30.eslabones, m30.gradosPorArticulacion]).toEqual([3, 15]);
  });
});

describe('radio por PRODUCTO (gráfico del catálogo, 22,5° por articulación = fila de 5 eslabones)', () => {
  const todos = snap.PRODUCTOS as unknown as Array<Record<string, unknown>>;

  it('EPS 260 y CUS Z 294 al interior, iguales en todos los anchos (el eslabón es la misma pieza)', () => {
    expect([RADIO_INTERIOR_EPS_MM, RADIO_INTERIOR_CUS_MM]).toEqual([260, 294]);
    for (const p of snap.PRODUCTOS.filter((x) => String(x.sku).startsWith('EPS-'))) {
      expect(radioEslabonadaDe(p as Record<string, unknown>, todos), p.sku).toMatchObject({ ok: true, radioInteriorMm: 260 });
    }
    for (const p of snap.PRODUCTOS.filter((x) => /^CUS-.*-Z$/.test(String(x.sku)))) {
      expect(radioEslabonadaDe(p as Record<string, unknown>, todos), p.sku).toMatchObject({ ok: true, radioInteriorMm: 294 });
      // Coincide con el radio_mm cargado en el catálogo para las CUS Z.
      expect((p as Record<string, unknown>).radio_mm, p.sku).toBe(294);
    }
  });

  it('en 600 ya no da el doble: el mismo giro en 300 y en 600 con el mismo ala y ángulo', () => {
    const d300 = definicionEfectiva(P('SAM_CUS-300-5-065-18-Z'), { sentido_vertical: 'sube' });
    const d600 = definicionEfectiva(P('SAM_CUS-600-5-065-18-Z'), { sentido_vertical: 'sube' });
    if (!d300.ok || !d600.ok) throw new Error('sin definición');
    expect(d300.def.params.radio_interior_mm).toBe(294);
    expect(d600.def.params.radio_interior_mm).toBe(294);
    const cuerda = (d: { def: { ports: ReadonlyArray<{ center: readonly number[] }> } }) =>
      Math.hypot(d.def.ports[1].center[0] - d.def.ports[0].center[0], d.def.ports[1].center[1] - d.def.ports[0].center[1]);
    expect(cuerda(d600)).toBeCloseTo(cuerda(d300), 9);
    expect(cuerda(d300)).toBeCloseTo(2 * (294 + 32.5) * Math.sin(45 * RAD), 9);
  });

  it('CUS G: las 12 con una Z de igual ancho, ala y espesor toman su radio (equivalencia por acabado); las 16 sin Z equivalente, ninguno', () => {
    const cusZ = snap.PRODUCTOS.filter((x) => /^CUS-.*-Z$/.test(String(x.sku)));
    const cusG = snap.PRODUCTOS.filter((x) => /^CUS-.*-G$/.test(String(x.sku)));
    expect([cusZ.length, cusG.length]).toEqual([12, 28]);
    const clave = (p: Product) => { const r = p as Record<string, unknown>; return `${p.ancho_nominal_mm}|${r.ala_nominal_mm}|${r.espesor_chapa_mm}`; };
    const geomZ = new Set(cusZ.map(clave));
    // Las 12 combinaciones de la Z son un subconjunto exacto de la G.
    expect(cusZ.every((z) => cusG.some((g) => clave(g) === clave(z)))).toBe(true);
    let con = 0;
    let sin = 0;
    for (const g of cusG) {
      const r = radioEslabonadaDe(g as Record<string, unknown>, todos);
      const rr = g as Record<string, unknown>;
      if (geomZ.has(clave(g))) {
        con++;
        expect(r, g.sku).toMatchObject({ ok: true, radioInteriorMm: 294 });
        if (r.ok) expect(r.procedencia).toMatch(/equivalencia por acabado/);
        expect(rr.espesor_chapa_mm, g.sku).toBe(1.24);
        expect([65, 90, 115]).toContain(rr.ala_nominal_mm);
        expect(definicionEfectiva(g, { sentido_vertical: 'sube' }).ok, g.sku).toBe(true);
      } else {
        sin++;
        expect(r.ok, g.sku).toBe(false);
        expect(rr.espesor_chapa_mm === 2.1 || rr.ala_nominal_mm === 150, g.sku).toBe(true);
        const d = definicionEfectiva(g, { sentido_vertical: 'sube' });
        expect(d.ok, g.sku).toBe(false);
        if (!d.ok) expect(d.motivo).toMatch(/no publica radio.*no hay una CUS de la línea Z/);
      }
    }
    expect([con, sin]).toEqual([12, 16]);
  });
});

describe('geometría: la boca de salida es la de entrada girada θ alrededor del centro, a radio de eje', () => {
  for (const angulo of [30, 45, 90, 135]) {
    for (const sentido of ['sube', 'baja'] as const) {
      it(`${angulo}° ${sentido}`, () => {
        const r = buildCurvaEslabonadaRecipe({ ancho_mm: 300, ala_mm: 65, angulo_deg: angulo, sentido, radio_interior_mm: 294 });
        const [p1, p2] = r.ports;
        const re = 294 + 65 / 2;
        expect([p1.name, p2.name]).toEqual(['P1', 'P2']);
        // Centro del giro en (0, −R_eje): P2 a distancia R_eje, girada θ.
        expect(Math.hypot(p2.center[0], p2.center[1] + re)).toBeCloseTo(re, 9);
        expect(p2.center[0]).toBeCloseTo(re * Math.sin(angulo * RAD), 9);
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
  it('las 7 EPS y las 40 CUS resuelven a su maestro eslabonado', () => {
    const eps = snap.PRODUCTOS.filter((p) => String(p.sku).startsWith('EPS-'));
    const cus = snap.PRODUCTOS.filter((p) => String(p.sku).startsWith('CUS-'));
    expect([eps.length, cus.length]).toEqual([7, 40]);
    for (const p of eps) expect(findMasterForProduct(p as Record<string, unknown>)?.id, p.sku).toBe('master:perforada:curva_eslabonada');
    for (const p of cus) expect(findMasterForProduct(p as Record<string, unknown>)?.id, p.sku).toBe('master:escalera:curva_eslabonada');
    // Con definición y colocables: las 7 EPS, las 12 CUS Z y las 12 CUS G con Z equivalente.
    // Las otras 16 CUS G no tienen radio (ver «radio por producto»): no se colocan.
    const conDef = [...eps, ...cus].filter((p) => definicionEfectiva(p, { sentido_vertical: 'sube' }).ok);
    expect(conDef).toHaveLength(7 + 12 + 12);
    for (const p of conDef) expect(modeloDeProducto(p)?.colocable, p.sku).toBe(true);
    // No hay CUS de 50 ni 100: en esos anchos sólo existe la perforada.
    expect(cus.some((p) => p.ancho_nominal_mm === 50 || p.ancho_nominal_mm === 100)).toBe(false);
    expect(eps.map((p) => p.ancho_nominal_mm).sort((a, b) => a! - b!)).toEqual([50, 100, 150, 200, 300, 450, 600]);
  });

  it('sin el perfil de la CUPS no queda el aviso de ala de 36,56 mm en ninguna CUS', () => {
    for (const p of snap.PRODUCTOS.filter((x) => String(x.sku).startsWith('CUS-'))) {
      const d = definicionEfectiva(p, { sentido_vertical: 'sube' });
      if (!d.ok) continue; // CUS G sin Z equivalente: sin radio (ver «radio por producto»)
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
    // Sube: radio de eje 285 (interior 260 + ala 50/2): la boca de salida queda 285 mm adelante y 285 arriba.
    expect(p2a[0]).toBeCloseTo(285, 6);
    expect(p2a[2]).toBeCloseTo(285, 6);
    expect(t.piezas[0].puertos.P2.direccion[2]).toBeCloseTo(1, 9);
    expect(curvasEslabonadas(t, productos)[0].eslabones).toBe(5);

    const r = cambiarAnguloEslabonada(t, productos, 'C', 45);
    if (!r.ok) throw new Error(r.motivo);
    const c = r.entrada.piezas[0];
    expect(c.puertos.P1).toEqual(t.piezas[0].puertos.P1);
    expect(c.puertos.P2.posicion_mm[0]).toBeCloseTo(285 * Math.sin(45 * RAD), 6);
    expect(c.puertos.P2.posicion_mm[2]).toBeCloseTo(285 - 285 * Math.cos(45 * RAD), 6);
    expect(r.eslabones).toBe(3);
    expect(curvasEslabonadas(r.entrada, productos)[0]).toMatchObject({ anguloDeg: 45, eslabones: 3 });
    expect(c.longitud_eje_mm).toBeCloseTo(medidasEslabonada({ radioInteriorMm: 260, alaMm: 50, anguloDeg: 45 }).longitudEjeMm, 6);
  });

  it('fuera de rango o sobre otra pieza: no se cambia, con motivo', () => {
    const t = conCurva('SAM_EPS-300-Z', 90, 'baja');
    expect(cambiarAnguloEslabonada(t, productos, 'C', 0)).toMatchObject({ ok: false });
    // Esta pieza baja (giro VERTICAL): no hay pieza para un cambio de nivel menor; no se sugiere la CAS.
    const n2 = cambiarAnguloEslabonada(t, productos, 'C', 20);
    expect(n2.ok).toBe(false);
    if (!n2.ok) {
      expect(n2.motivo).toMatch(/más de 22,5°.*el catálogo no publica ninguna pieza/);
      expect(n2.motivo).not.toMatch(/CAS/);
    }
    expect(cambiarAnguloEslabonada(t, productos, 'X', 45)).toMatchObject({ ok: false });
  });

  it('una eslabonada colocada girando en HORIZONTAL (sección acostada): el rechazo sugiere la CAS', () => {
    const d = definicionEfectiva(P('SAM_EPS-300-Z'), { angulo_deg: 90, sentido_vertical: 'sube' });
    if (!d.ok) throw new Error(d.motivo);
    // "Arriba" de sección hacia +Y del mundo: la curva gira en planta.
    const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 1, 0] });
    const base = withDefinition({ version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {} } as unknown as TrayInput, d.huella, d.def);
    const t = { ...base, piezas: [{ instancia_id: 'H', producto_id: 'SAM_EPS-300-Z', puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never] };
    const bocas = puertosFromWorld(pl.ports);
    expect(planoDeGiro(bocas.P1.direccion, bocas.P2.direccion)).toBe('horizontal');
    const r = cambiarAnguloEslabonada(t, productos, 'H', 20);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/Para un giro horizontal menor está la curva ajustable CAS \(más de 0° y hasta 90°\)/);
      expect(r.motivo).not.toMatch(/cambio de nivel/);
    }
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

describe('piezas colocadas con la regla anterior (radio = ancho)', () => {
  /** Definición como la guardaba la regla anterior: radio de eje = ancho (EPS-300: 300 mm), sin radio_interior_mm. */
  function trazadoConReglaAnterior(angulo: number, anguloGuardado = angulo): TrayInput {
    // Misma receta con radio interior 300 − ala/2 → radio de eje 300, el de la regla anterior.
    const raw = buildCurvaEslabonadaRecipe({ ancho_mm: 300, ala_mm: 50, angulo_deg: angulo, sentido: 'sube', radio_interior_mm: 300 - 25 });
    const def = definitionFromRecipe({
      patron: 'master:perforada:curva_eslabonada', revision: '1',
      params: { ancho_mm: 300, ala_mm: 50, angulo_deg: anguloGuardado, sentido_vertical: 1 },
      raw, resolved: raw, preTransform: new THREE.Matrix4(),
    });
    const huella = definitionHash(def);
    const pl = placeDefinition({ def, huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    const t = withDefinition({ version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {} } as unknown as TrayInput, huella, def);
    return { ...t, piezas: [{ instancia_id: 'C', producto_id: 'SAM_EPS-300-Z', puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never] };
  }

  it('quedan desactualizadas, con el motivo de la regla (antes y ahora) y lo que cambia', () => {
    const t = trazadoConReglaAnterior(90);
    const o = outdatedPieces(t, productos);
    expect(o.map((x) => x.id)).toEqual(['C']);
    expect(o[0].motivo).toMatch(/cambió la regla de radio de las curvas eslabonadas/);
    expect(o[0].motivo).toMatch(/radio = ancho \(300 mm/);
    expect(o[0].motivo).toMatch(/radio interior 260 mm/);
    expect(o[0].motivo).toMatch(/longitud de eje/);
    expect(piezasSinDefinicionVigente(t, productos)).toEqual([]);
  });

  it('una guardada a 20° (hoy se rechaza) no se puede actualizar: queda listada con el motivo', () => {
    const t = trazadoConReglaAnterior(45, 20);
    expect(outdatedPieces(t, productos)).toEqual([]);
    const s = piezasSinDefinicionVigente(t, productos);
    expect(s.map((x) => x.id)).toEqual(['C']);
    expect(s[0].motivo).toMatch(/más de 22,5°/);
    // Sube: giro vertical → sin sugerir piezas de otro plano.
    expect(s[0].motivo).toMatch(/el catálogo no publica ninguna pieza/);
    expect(s[0].motivo).not.toMatch(/CAS/);
    // Se sigue computando como está (2 eslabones), sin romper Resultados.
    expect(curvasEslabonadas(t, productos)[0]).toMatchObject({ anguloDeg: 20, eslabones: 2 });
  });
});
