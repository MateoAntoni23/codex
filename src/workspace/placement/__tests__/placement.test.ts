/**
 * Hito 2 — colocación como dato.
 *
 *  - Equivalencia: la ruta única de marco completo reproduce exactamente la
 *    colocación anterior (placeRecipe) para entradas horizontales, en todo el
 *    registro, ambas manos y cada boca de entrada admitida por la ruta vieja.
 *  - PA2 (propiedad): para cada patrón, cada boca de entrada, cada mano y una
 *    muestra de variantes de ancho y ala: colocar → guardar (JSON) → recargar →
 *    dibujar da las mismas bocas y la misma malla (< 0,01 mm y < 0,01°).
 *  - La pose es siempre una rotación (det +1).
 *  - Uniones: tolerancias D-14, giro sin módulo 180°.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadStaticCatalog, seedStaticCatalog, type StaticCatalog } from '../../../catalog/staticCatalog';
import { findMasterForProduct } from '../../../configurator/masterModels';
import { placeRecipe, resolveRecipe } from '../../parametricBridge';
import {
  clearCatalogPortIndex,
  clearPortMappingOverrides,
  clearProductCatalogIndex,
  setMasterResolver,
} from '../../catalogPortMapping';
import { buildDefinition, resolveDefinition, placedOf, withDefinition } from '../definitions';
import {
  angleDeg,
  buildDefinitionGeometry,
  m3FromQuat,
  placeDefinition,
  poseMatrix,
  puertosFromWorld,
  worldPorts,
  type Mano,
  type V3,
} from '../placementCore';
import { checkJoin, TOL_ANG_DEG, TOL_POS_MM } from '../joins';
import type { Product, TrayInput } from '../../../tray/model';

let cat: StaticCatalog;

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

/** Muestra por patrón: hasta 3 productos con modelo, priorizando anchos/alas distintos. */
function sampleByPattern(): Map<string, Product[]> {
  const by = new Map<string, Product[]>();
  for (const p of cat.productos) {
    const m = findMasterForProduct(p as Record<string, unknown>);
    if (!m || !resolveRecipe(p)) continue;
    const arr = by.get(m.id) ?? [];
    const sig = `${p.ancho_nominal_mm}|${(p as Record<string, unknown>).ala_nominal_mm}`;
    if (arr.length < 3 && !arr.some((q) => `${q.ancho_nominal_mm}|${(q as Record<string, unknown>).ala_nominal_mm}` === sig)) arr.push(p);
    by.set(m.id, arr);
  }
  return by;
}

const H_DIR: V3 = [Math.cos(0.5), Math.sin(0.5), 0];
const START: V3 = [1234.5, -678.9, 432.1];

describe('ruta única de colocación', () => {
  it('reproduce la colocación anterior para entradas horizontales (todo el registro, ambas manos)', () => {
    let compared = 0;
    for (const [, products] of sampleByPattern()) {
      for (const product of products) {
        const d = resolveDefinition(product);
        if (!d.ok) continue;
        const entry = resolveRecipe(product)!;
        for (const port of d.def.ports) {
          if (Math.abs(port.normal[1]) > 1e-3) continue; // la ruta vieja no admitía estas entradas en horizontal
          for (const mano of ['nativa', 'espejo'] as Mano[]) {
            const old = placeRecipe(product, entry, START, H_DIR, mano === 'espejo' ? 'mirrored' : 'native', undefined, { entryPortName: port.name });
            const now = placeDefinition({ def: d.def, huella: d.huella, mano, entryPortName: port.name, startPos: START, entryDir: H_DIR, sectionUp: [0, 0, 1] });
            for (const o of old.ports) {
              const n = now.ports.find((x) => x.name === o.name)!;
              expect(Math.hypot(...(o.pos.map((v, i) => v - n.pos[i]) as V3)), `${product.sku} ${port.name} ${mano} ${o.name} pos`).toBeLessThan(1e-5);
              expect(angleDeg(o.outwardNormal, n.normal)).toBeLessThan(1e-5);
              expect(angleDeg(o.vDir, n.vDir)).toBeLessThan(1e-5);
            }
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(40);
  });
});

describe('PA2 — colocar, guardar, recargar y dibujar (propiedad sobre todo el registro)', () => {
  it('mismas bocas y misma malla con error < 0,01 mm y < 0,01°', () => {
    let cases = 0;
    const configs: Array<{ dir: V3; up: V3 }> = [
      { dir: H_DIR, up: [0, 0, 1] },
      { dir: [0, 0, 1], up: [1, 0, 0] }, // entrada vertical (marco completo)
    ];
    for (const [patron, products] of sampleByPattern()) {
      for (const product of products) {
        // PA2 prueba el mecanismo (colocar → guardar → recargar → dibujar) sobre
        // TODOS los patrones, así que usa la definición sin la verificación de
        // ángulo: un modelo no resuelto (CS-45 escalera) se rechaza al colocar y
        // su defecto se informa en angleCheck.test.ts, no aquí.
        const d = buildDefinition(product);
        expect(d.ok, `${patron} ${product.sku}`).toBe(true);
        if (!d.ok) continue;
        for (const port of d.def.ports) {
          for (const mano of ['nativa', 'espejo'] as Mano[]) {
            for (const cfg of configs) {
              const placed = placeDefinition({ def: d.def, huella: d.huella, mano, entryPortName: port.name, startPos: START, entryDir: cfg.dir, sectionUp: cfg.up });
              // Invariantes de la colocación: la boca de entrada queda donde se pidió.
              const e = placed.ports.find((p) => p.name === port.name)!;
              expect(Math.hypot(...(e.pos.map((v, i) => v - START[i]) as V3))).toBeLessThan(1e-6);
              expect(angleDeg(e.normal, cfg.dir.map((x) => -x))).toBeLessThan(1e-6);
              // La pose es una rotación propia.
              const R = new THREE.Matrix3().fromArray(m3FromQuat(placed.colocacion.pose.rotacion).flat()).transpose();
              expect(R.determinant()).toBeCloseTo(1, 9);

              // Guardar → recargar (JSON) → dibujar.
              let tray: TrayInput = {
                version_contrato: 'trazado/1',
                piezas: [{ instancia_id: 'X', producto_id: product.producto_id, puertos: puertosFromWorld(placed.ports), colocacion: placed.colocacion }],
                conexiones: [], circuitos: [], soportes: [],
                pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
              };
              tray = withDefinition(tray, d.huella, d.def);
              const reloaded = JSON.parse(JSON.stringify(tray)) as TrayInput;
              const got = placedOf(reloaded, reloaded.piezas[0])!;
              expect(got).not.toBeNull();
              const again = worldPorts(got.def, got.colocacion.mano, got.colocacion.pose);
              for (const a of placed.ports) {
                const b = again.find((x) => x.name === a.name)!;
                expect(Math.hypot(...(a.pos.map((v, i) => v - b.pos[i]) as V3))).toBeLessThan(0.01);
                expect(angleDeg(a.normal, b.normal)).toBeLessThan(0.01);
                expect(angleDeg(a.vDir, b.vDir)).toBeLessThan(0.01);
                // Las bocas del trazado (lo que ve el motor) son las derivadas.
                const stored = reloaded.piezas[0].puertos[a.name];
                expect(Math.hypot(...(a.pos.map((v, i) => v - stored.posicion_mm[i]) as V3))).toBeLessThan(0.01);
              }
              // Malla: la del preview (definición vigente) y la dibujada (definición guardada).
              const gPrev = buildDefinitionGeometry(d.def, mano).applyMatrix4(poseMatrix(placed.colocacion.pose));
              const gDraw = buildDefinitionGeometry(got.def, got.colocacion.mano).applyMatrix4(poseMatrix(got.colocacion.pose));
              const A = gPrev.getAttribute('position').array;
              const B = gDraw.getAttribute('position').array;
              expect(A.length).toBe(B.length);
              let maxDiff = 0;
              for (let i = 0; i < A.length; i++) maxDiff = Math.max(maxDiff, Math.abs(A[i] - B[i]));
              expect(maxDiff).toBeLessThan(0.01);
              cases++;
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(100);
  });

  it('la mano espejo es la reflexión de la nativa respecto del plano de la boca de entrada', () => {
    const tps = cat.productos.find((p) => p.producto_id === 'SAM_TPS-300-Z')!;
    const d = resolveDefinition(tps);
    if (!d.ok) throw new Error(d.motivo);
    const base = { def: d.def, huella: d.huella, entryPortName: 'tronco_P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] };
    const nat = placeDefinition({ ...base, mano: 'nativa' }).ports.find((p) => p.name === 'boca_derivacion')!;
    const esp = placeDefinition({ ...base, mano: 'espejo' }).ports.find((p) => p.name === 'boca_derivacion')!;
    expect(nat.pos[0]).toBeCloseTo(esp.pos[0], 6);
    expect(nat.pos[1]).toBeCloseTo(-esp.pos[1], 6);
    expect(nat.pos[2]).toBeCloseTo(esp.pos[2], 6);
    expect(Math.abs(nat.pos[1])).toBeGreaterThan(100);
  });
});

describe('uniones (A-7)', () => {
  const P = (pos: V3, dir: V3, up: V3) => ({ posicion_mm: pos, direccion: dir, orientacion_seccion_ws: up });
  it('tolerancias tomadas de D-14 del motor', () => {
    expect(TOL_POS_MM).toBe(1);
    expect(TOL_ANG_DEG).toBe(1);
  });
  it('válida dentro de tolerancia; hueco, ángulo y giro fuera', () => {
    expect(checkJoin(P([0, 0, 0], [1, 0, 0], [0, 0, 1]), P([0.5, 0, 0], [-1, 0, 0], [0, 0, 1])).ok).toBe(true);
    const gap = checkJoin(P([0, 0, 0], [1, 0, 0], [0, 0, 1]), P([2, 0, 0], [-1, 0, 0], [0, 0, 1]));
    expect(gap.ok).toBe(false);
    expect(gap.huecoMm).toBeCloseTo(2);
    const ang = checkJoin(P([0, 0, 0], [1, 0, 0], [0, 0, 1]), P([0, 0, 0], [-Math.cos(0.05), Math.sin(0.05), 0], [0, 0, 1]));
    expect(ang.ok).toBe(false);
    expect(ang.anguloDeg).toBeGreaterThan(2.8);
  });
  it('una sección invertida (giro 180°) NO une: sin módulo 180°', () => {
    const r = checkJoin(P([0, 0, 0], [1, 0, 0], [0, 0, 1]), P([0, 0, 0], [-1, 0, 0], [0, 0, -1]));
    expect(r.ok).toBe(false);
    expect(r.giroDeg).toBeCloseTo(180);
  });
});
