/**
 * Curva ajustable de escalera (CAS) — regla declarada por el operador (2026-11-14):
 * radio interior = ancho, eje = 1,5 × ancho, ángulo por instancia (90° por
 * defecto), rango 1°–90° provisional. Una pieza por código.
 *
 * Controles negativos (verificados a mano al cerrar, ver el traspaso):
 *   - si el ángulo elegido no llega a la pieza colocada (la colocación ignora
 *     `anguloDeg`), fallan «el ángulo elegido al colocar llega a la pieza» y la E2E;
 *   - si un ángulo fuera de rango se acepta (sin validación), fallan las de rango.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCurvaAjustableRecipe } from '../curvaAjustable';
import {
  ANGULO_AJUSTABLE_MAX, ANGULO_AJUSTABLE_MIN, ANGULO_AJUSTABLE_POR_DEFECTO, medidasCurvaAjustable, motivoAnguloAjustable,
  PATRON_CURVA_AJUSTABLE,
} from '../../reglaCurvaAjustable';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../../workspace/catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../../workspace/placement/definitions';
import { placeDefinition, puertosFromWorld } from '../../../workspace/placement/placementCore';
import { computeRoutingPlacement } from '../../../workspace/placement/routingPlacement';
import { cambiarAnguloAjustable } from '../../../workspace/placement/anguloEslabonada';
import { longitudesDeEje } from '../../../workspace/placement/longitudesEje';
import { planAddCurve } from '../../../workspace/workspaceOperation';
import { agruparCandidatos } from '../../../workspace/routing/opcionesPieza';
import { findMasterForProduct } from '../../../configurator/masterModels';
import type { Product, TrayInput } from '../../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };
const productos = new Map(snap.PRODUCTOS.map((p) => [p.producto_id, p]));
const P = (id: string) => productos.get(id)!;
const CAS = 'SAM_CAS-300-065-18-Z';
const RAD = Math.PI / 180;
type V3 = [number, number, number];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Giro entre la dirección de entrada (−normal de P1) y la de salida (normal de P2), en grados. */
const giro = (n1: readonly number[], n2: readonly number[]) => Math.acos(Math.max(-1, Math.min(1, dot([-n1[0], -n1[1], -n1[2]], n2)))) / RAD;

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

/** Arranque: boca libre en el origen mirando hacia +X, sección hacia +Z. */
const ARRANQUE = { pieceId: 'R1', portName: 'P2', pos: [0, 0, 0] as V3, dir: [1, 0, 0] as V3, sectionUp: [0, 0, 1] as V3 };

describe('regla del operador', () => {
  it('radio interior = ancho; eje = interior + ancho/2; longitud de eje = arco', () => {
    const m = medidasCurvaAjustable(300, 90);
    expect([m.radioInteriorMm, m.radioEjeMm, m.radioExteriorMm]).toEqual([300, 450, 600]);
    expect(m.longitudEjeMm).toBeCloseTo((450 * Math.PI) / 2, 9);
    expect(medidasCurvaAjustable(600, 30).longitudEjeMm).toBeCloseTo(900 * 30 * RAD, 9);
    expect(ANGULO_AJUSTABLE_POR_DEFECTO).toBe(90);
  });

  it('rango 1°–90° (provisional): los extremos se aceptan; afuera, motivo con el rango', () => {
    expect([ANGULO_AJUSTABLE_MIN, ANGULO_AJUSTABLE_MAX]).toEqual([1, 90]);
    for (const a of [1, 22.5, 45, 89.5, 90]) expect(motivoAnguloAjustable(a), `${a}°`).toBeNull();
    for (const a of [0, 0.5, 90.5, 91, 120, 180, -45, Number.NaN]) {
      const m = motivoAnguloAjustable(a);
      expect(m, `${a}°`).not.toBeNull();
      expect(m).toMatch(/de 1° a 90°/);
      expect(m).toMatch(/provisional/);
    }
    expect(() => medidasCurvaAjustable(300, 120)).toThrow(/fuera de rango/);
  });
});

describe('geometría (banda curva esquemática)', () => {
  for (const ancho of [150, 300, 450, 600]) {
    for (const ang of [1, 30, 45, 90]) {
      it(`ancho ${ancho}, ${ang}°: P2 = P1 girada ${ang}° alrededor del centro, sobre el eje; giro medido = ${ang}°`, () => {
        const r = buildCurvaAjustableRecipe({ ancho_mm: ancho, ala_mm: 65, angulo_deg: ang });
        const [p1, p2] = r.ports;
        const re = 1.5 * ancho;
        // Los dos centros a R_eje del centro del giro (origen en planta).
        expect(Math.hypot(p1.center[0], p1.center[2])).toBeCloseTo(re, 9);
        expect(Math.hypot(p2.center[0], p2.center[2])).toBeCloseTo(re, 9);
        expect(dist(p1.center, p2.center)).toBeCloseTo(2 * re * Math.sin((ang * RAD) / 2), 9);
        expect(giro(p1.normal, p2.normal)).toBeCloseTo(ang, 6);
        // Bocas del ancho y el ala del catálogo; marcos derechos (u × v = normal).
        expect([p1.ancho_mm, p1.ala_mm, p2.ancho_mm, p2.ala_mm]).toEqual([ancho, 65, ancho, 65]);
        for (const p of r.ports) {
          const [u, v, n] = [p.u_dir!, p.v_dir!, p.normal];
          const cruz = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          expect(dot(cruz, n)).toBeCloseTo(1, 9);
        }
        // La banda va del radio interior al exterior.
        const radios = r.polygon.map(([x, z]) => Math.hypot(x, z));
        expect(Math.min(...radios)).toBeCloseTo(ancho, 6);
        expect(Math.max(...radios)).toBeCloseTo(2 * ancho, 6);
        expect(r.height).toBe(65);
      });
    }
  }
});

describe('catálogo: las 40 CAS', () => {
  const cas = snap.PRODUCTOS.filter((p) => String(p.sku).startsWith('CAS-'));

  it('son 40, sólo escalera, anchos 150/300/450/600 × alas 65/90/115/150; el catálogo no declara ángulo ni radio', () => {
    expect(cas).toHaveLength(40);
    expect(new Set(cas.map((p) => p.ancho_nominal_mm))).toEqual(new Set([150, 300, 450, 600]));
    expect(new Set(cas.map((p) => (p as Record<string, unknown>).ala_nominal_mm))).toEqual(new Set([65, 90, 115, 150]));
    for (const p of cas) {
      expect(String((p as Record<string, unknown>).familia_id)).toMatch(/^SAM-STE-/);
      expect(p.tipo_pieza).toBe('curva horizontal');
      expect((p as Record<string, unknown>).angulo_grados ?? null).toBeNull();
    }
  });

  it('todas resuelven al maestro de la curva ajustable, con 90° por defecto (regla del operador); las CS siguen con los suyos', () => {
    for (const p of cas) {
      expect(findMasterForProduct(p as Record<string, unknown>)?.id, p.sku).toBe(PATRON_CURVA_AJUSTABLE);
      const d = definicionEfectiva(p);
      if (!d.ok) throw new Error(`${p.sku}: ${d.motivo}`);
      expect(d.def.patron).toBe(PATRON_CURVA_AJUSTABLE);
      expect(d.def.params.angulo_deg).toBe(90);
    }
    expect(findMasterForProduct(P('SAM_CS-300-90-065-18-Z') as Record<string, unknown>)?.id).toBe('master:escalera:curva_horizontal_90');
    expect(findMasterForProduct(P('SAM_CS-300-45-065-18-Z') as Record<string, unknown>)?.id).toBe('master:escalera:curva_horizontal_45');
  });

  it('el ángulo es de la instancia: entra en la definición y en la huella', () => {
    const a = definicionEfectiva(P(CAS), { angulo_deg: 30 });
    const b = definicionEfectiva(P(CAS), { angulo_deg: 60 });
    if (!a.ok || !b.ok) throw new Error('sin definición');
    expect([a.def.params.angulo_deg, b.def.params.angulo_deg]).toEqual([30, 60]);
    expect(a.huella).not.toBe(b.huella);
  });

  it('fuera de rango no hay definición, con el motivo y el rango', () => {
    for (const ang of [0, 91, 135]) {
      const d = definicionEfectiva(P(CAS), { angulo_deg: ang });
      expect(d.ok, `${ang}°`).toBe(false);
      if (!d.ok) expect(d.motivo).toMatch(/fuera de rango.*de 1° a 90°/);
    }
  });
});

describe('colocar: el ángulo se elige al colocar', () => {
  for (const ang of [30, 45, 75, 90]) {
    it(`el ángulo elegido al colocar (${ang}°) llega a la pieza colocada: bocas, giro y definición`, () => {
      const pl = computeRoutingPlacement({ product: P(CAS), startPort: ARRANQUE, entryPortName: 'P1', side: 'left', anguloDeg: ang });
      if (!pl.ok) throw new Error(pl.motivo);
      expect(pl.def.params.angulo_deg).toBe(ang);
      const p1 = pl.ports.find((p) => p.name === 'P1')!;
      const p2 = pl.ports.find((p) => p.name === 'P2')!;
      // La boca de entrada queda en el arranque; la salida, girada θ a radio de eje 450.
      expect(dist(p1.pos, [0, 0, 0])).toBeLessThan(1e-6);
      expect(dist(p1.pos, p2.pos)).toBeCloseTo(2 * 450 * Math.sin((ang * RAD) / 2), 6);
      expect(giro(p1.normal, p2.normal)).toBeCloseTo(ang, 6);
      // Gira en el plano horizontal: las normales no tienen componente vertical.
      expect(Math.abs(p2.normal[2])).toBeLessThan(1e-9);
    });
  }

  it('sin ángulo elegido: 90° (por defecto del operador)', () => {
    const pl = computeRoutingPlacement({ product: P(CAS), startPort: ARRANQUE, entryPortName: 'P1', side: 'left' });
    if (!pl.ok) throw new Error(pl.motivo);
    expect(pl.def.params.angulo_deg).toBe(90);
  });

  it('un ángulo fuera de rango no se coloca: motivo con el rango', () => {
    for (const ang of [0, 90.5, 100]) {
      const pl = computeRoutingPlacement({ product: P(CAS), startPort: ARRANQUE, entryPortName: 'P1', side: 'left', anguloDeg: ang });
      expect(pl.ok, `${ang}°`).toBe(false);
      if (!pl.ok) expect(pl.motivo).toMatch(/de 1° a 90°/);
    }
  });

  it('las dos manos giran a lados opuestos (izquierda / derecha)', () => {
    const izq = computeRoutingPlacement({ product: P(CAS), startPort: ARRANQUE, entryPortName: 'P1', side: 'left', anguloDeg: 90 });
    const der = computeRoutingPlacement({ product: P(CAS), startPort: ARRANQUE, entryPortName: 'P1', side: 'right', anguloDeg: 90 });
    if (!izq.ok || !der.ok) throw new Error('sin colocación');
    expect(izq.handSensitive).toBe(true);
    const y = (pl: typeof izq) => pl.ok ? pl.ports.find((p) => p.name === 'P2')!.pos[1] : 0;
    expect(Math.sign(y(izq))).toBe(-Math.sign(y(der)));
    expect(Math.abs(y(izq))).toBeCloseTo(450, 6);
  });

  it('confirmar (planAddCurve) guarda la pieza con el ángulo elegido y longitud de eje = arco', () => {
    const base = { version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {} } as unknown as TrayInput;
    const pl = computeRoutingPlacement({ product: P(CAS), startPort: ARRANQUE, entryPortName: 'P1', side: 'left', anguloDeg: 45 });
    if (!pl.ok) throw new Error(pl.motivo);
    const op = planAddCurve(base, ARRANQUE, P(CAS), { ok: true, newPiecePort: 'P1' } as never, 'left', pl);
    const pieza = (op as unknown as { newPiece: { longitud_eje_mm: number; colocacion: { definicion: { params: Record<string, number> } } } }).newPiece;
    expect(pieza.colocacion.definicion.params.angulo_deg).toBe(45);
    expect(pieza.longitud_eje_mm).toBeCloseTo(450 * 45 * RAD, 6);
  });
});

/** Trazado con una CAS colocada desde el arranque. */
function conCAS(ang: number): TrayInput {
  const d = definicionEfectiva(P(CAS), { angulo_deg: ang });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t = withDefinition({ version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {} } as unknown as TrayInput, d.huella, d.def);
  return { ...t, piezas: [{ instancia_id: 'C', producto_id: CAS, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never] };
}

describe('corregir el ángulo de una CAS colocada', () => {
  it('90° → 30°: P1 queda; P2, la definición y la longitud de eje (arco) se recalculan', () => {
    const t = conCAS(90);
    const r = cambiarAnguloAjustable(t, productos, 'C', 30);
    if (!r.ok) throw new Error(r.motivo);
    const c = r.entrada.piezas[0];
    expect(c.puertos.P1).toEqual(t.piezas[0].puertos.P1);
    expect(dist(c.puertos.P1.posicion_mm, c.puertos.P2.posicion_mm)).toBeCloseTo(2 * 450 * Math.sin(15 * RAD), 6);
    expect(c.longitud_eje_mm).toBeCloseTo(450 * 30 * RAD, 6);
    expect(r.eslabones).toBeNull();
  });

  it('fuera de rango, sobre otra pieza o sobre una pieza que no es CAS: no se cambia, con motivo', () => {
    const t = conCAS(90);
    const fuera = cambiarAnguloAjustable(t, productos, 'C', 120);
    expect(fuera.ok).toBe(false);
    if (!fuera.ok) expect(fuera.motivo).toMatch(/de 1° a 90°/);
    expect(cambiarAnguloAjustable(t, productos, 'X', 45)).toMatchObject({ ok: false });
  });

  it('longitud de eje con regla: arco de radio de eje y el ángulo de la instancia', () => {
    const d = definicionEfectiva(P(CAS), { angulo_deg: 60 });
    if (!d.ok) throw new Error(d.motivo);
    const l = longitudesDeEje(d.def);
    if (!l.ok) throw new Error(l.motivo);
    const [tramo] = Object.values(l.longitudes);
    expect(tramo.regla).toBe('arco_curva_ajustable');
    expect(tramo.mm).toBeCloseTo(450 * 60 * RAD, 9);
  });
});

describe('selector de tres pasos', () => {
  it('la CAS aparece dentro de «curva horizontal», como variante junto a las de 45° y 90°', () => {
    const candidatos = ['SAM_CS-300-45-065-18-Z', 'SAM_CS-300-90-065-18-Z', CAS].map((id) => ({ product: P(id), excepcion: false }));
    const tipos = agruparCandidatos(candidatos as never, P('SAM_TRES-300-065-18-Z'));
    const curvas = tipos.find((t) => t.anchos.some((a) => a.variantes.some((v) => v.candidatos.some((c) => c.product.producto_id === CAS))));
    expect(curvas).toBeDefined();
    const variantes = curvas!.anchos.flatMap((a) => a.variantes.map((v) => v.texto));
    expect(variantes.some((t) => /CAS .*ángulo ajustable/.test(t))).toBe(true);
    expect(variantes.some((t) => /45°/.test(t))).toBe(true);
    expect(variantes.some((t) => /90°/.test(t))).toBe(true);
  });
});
