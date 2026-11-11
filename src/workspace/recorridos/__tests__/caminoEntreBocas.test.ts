/**
 * Recorrido entre dos bocas: camino por piezas unidas y longitud persistida.
 * Las piezas se colocan por el camino real (definición efectiva → colocación),
 * como en el espacio de trabajo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../placement/definitions';
import { conLongitudesEje } from '../../placement/longitudesEje';
import { placeDefinition, puertosFromWorld, type V3, type WorldPort } from '../../placement/placementCore';
import { caminoEntreBocas } from '../caminoEntreBocas';
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

let t: TrayInput;
const bocas = new Map<string, WorldPort[]>();

function colocar(id: string, productoId: string, entrada: string, en?: [string, string], extra: Record<string, unknown> = {}) {
  const d = definicionEfectiva(productos.get(productoId)!, { longitud_mm: (extra.longitud_mm as number) ?? 1000 });
  if (!d.ok) throw new Error(`${productoId}: ${d.motivo}`);
  const boca = en ? bocas.get(en[0])!.find((p) => p.name === en[1])! : undefined;
  const pl = placeDefinition({
    def: d.def, huella: d.huella, mano: 'nativa', entryPortName: entrada,
    startPos: boca ? boca.pos : [0, 0, 0], entryDir: boca ? boca.normal : [1, 0, 0], sectionUp: (boca ? boca.vDir : [0, 0, 1]) as V3,
  });
  bocas.set(id, pl.ports);
  t = withDefinition(t, d.huella, d.def);
  t = { ...t, piezas: [...t.piezas, { instancia_id: id, producto_id: productoId, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion, ...extra } as never] };
  if (en) t = { ...t, conexiones: [...t.conexiones, { conexion_id: `${en[0]}-${id}`, a: en, b: [id, entrada] }] };
}

beforeAll(() => {
  t = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as TrayInput;
  //  R1 ─ R2 ─ T(tronco) ─ R3 ─ R5 (450: unión inválida por ancho)
  //             └ derivación ─ R4
  //  S suelta.
  colocar('R1', 'SAM_TRPS-300-22-Z', 'P1', undefined, { longitud_mm: 1000 });
  colocar('R2', 'SAM_TRPS-300-22-Z', 'P1', ['R1', 'P2'], { longitud_mm: 1500 });
  colocar('T', 'SAM_TPS-300-Z', 'tronco_P1', ['R2', 'P2']);
  colocar('R3', 'SAM_TRPS-300-22-Z', 'P1', ['T', 'tronco_P2'], { longitud_mm: 2000 });
  colocar('R4', 'SAM_TRPS-300-22-Z', 'P1', ['T', 'boca_derivacion'], { longitud_mm: 800 });
  colocar('R5', 'SAM_TRPS-450-20-Z', 'P1', ['R3', 'P2'], { longitud_mm: 600 });
  colocar('S', 'SAM_TRPS-300-22-Z', 'P1', undefined, { longitud_mm: 3000 });
});

describe('recorrido entre dos bocas', () => {
  it('rectos en línea: longitud = suma de longitud_mm guardadas, con la lista de piezas', () => {
    const r = caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'R2', boca: 'P2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cruces.map((c) => c.pieza)).toEqual(['R1', 'R2']);
    expect(r.uniones).toEqual(['R1-R2']);
    expect(r.completa).toBe(true);
    expect(r.sumaMm).toBe(2500);
  });

  it('a través del tronco de una T: la T aporta la distancia entre sus bocas en línea', () => {
    const r = caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'R3', boca: 'P2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cruces.map((c) => [c.pieza, c.entrada, c.salida])).toEqual([
      ['R1', 'P1', 'P2'], ['R2', 'P1', 'P2'], ['T', 'tronco_P1', 'tronco_P2'], ['R3', 'P1', 'P2'],
    ]);
    const tee = r.cruces[2];
    expect(tee.fuente).toBe('bocas_en_linea');
    const tp = t.piezas.find((p) => p.instancia_id === 'T')!.puertos;
    expect(tee.longitudMm).toBeCloseTo(Math.hypot(...[0, 1, 2].map((k) => tp.tronco_P2.posicion_mm[k] - tp.tronco_P1.posicion_mm[k])), 9);
    expect(r.completa).toBe(true);
    expect(r.sumaMm).toBeCloseTo(1000 + 1500 + 2000 + tee.longitudMm!, 9);
  });

  it('control negativo — T colocada SIN la regla aplicada: el desvío por la derivación queda incompleto, con motivo', () => {
    const r = caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'R4', boca: 'P2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completa).toBe(false);
    const tee = r.cruces.find((c) => c.pieza === 'T')!;
    expect(tee.longitudMm).toBeNull();
    expect(tee.motivo).toBe('desvío de tronco_P1 a boca_derivacion: la pieza no tiene guardada su longitud de eje');
    expect(r.sumaMm).toBe(1000 + 1500 + 800);
  });

  it('T colocada CON la regla (como al colocar en el espacio de trabajo): la derivación da completa, con su procedencia', () => {
    const d = definicionEfectiva(productos.get('SAM_TPS-300-Z')!);
    if (!d.ok) throw new Error(d.motivo);
    const conRegla = structuredClone(t);
    const i = conRegla.piezas.findIndex((p) => p.instancia_id === 'T');
    conRegla.piezas[i] = conLongitudesEje(conRegla.piezas[i], d.def);
    const r = caminoEntreBocas(conRegla, { pieza: 'R1', boca: 'P1' }, { pieza: 'R4', boca: 'P2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completa).toBe(true);
    const tee = r.cruces.find((c) => c.pieza === 'T')!;
    expect(tee.fuente).toBe('longitudes_eje');
    expect(tee.longitudMm).toBeCloseTo(449.44, 2);
    expect(tee.procedencia).toMatch(/^modelo medido \(patrón master:perforada:tee_simetrica\): centro = punto común a los ejes de las 3 bocas/);
    expect(r.sumaMm).toBeCloseTo(1000 + 1500 + tee.longitudMm! + 800, 9);
  });

  it('pieza de dos bocas con longitud_eje_mm guardada (curva): se usa esa longitud', () => {
    const conCurva = structuredClone(t);
    const r2 = conCurva.piezas.find((p) => p.instancia_id === 'R2')!;
    delete r2.longitud_mm;
    r2.longitud_eje_mm = 1234.5;
    const r = caminoEntreBocas(conCurva, { pieza: 'R1', boca: 'P1' }, { pieza: 'R2', boca: 'P2' });
    expect(r.ok && r.cruces[1]).toMatchObject({ longitudMm: 1234.5, fuente: 'longitud_eje_mm' });
  });

  it('una unión inválida (300 con 450, B-3) no se atraviesa: sin camino, con la unión y su motivo', () => {
    const r = caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'R5', boca: 'P2' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('no hay camino por uniones válidas: la unión R3-R5 no cumple la verificación y no se atraviesa');
    expect(r.unionesCortadas).toEqual([{ conexion_id: 'R3-R5', motivos: [expect.stringMatching(/^ancho de boca 300 mm ≠ 450 mm/)] }]);
  });

  it('sin camino: piezas no unidas, misma boca, boca inexistente — motivo, nunca cero', () => {
    const r1 = caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'S', boca: 'P2' });
    expect(r1).toEqual({ ok: false, motivo: 'no hay camino: origen y destino no están unidos por piezas del trazado', unionesCortadas: [] });
    expect(caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'R1', boca: 'P1' })).toMatchObject({ ok: false, motivo: 'origen y destino son la misma boca' });
    expect(caminoEntreBocas(t, { pieza: 'R1', boca: 'P9' }, { pieza: 'R2', boca: 'P2' })).toMatchObject({ ok: false, motivo: 'el origen no existe en el trazado (boca P9 de R1)' });
  });

  it('origen o destino en una boca unida: el camino sale/entra por esa unión sin cruzar la pieza', () => {
    // R2.P1 está unida a R1.P2: desde R2.P1 hacia R1.P1 se cruza sólo R1.
    const a = caminoEntreBocas(t, { pieza: 'R2', boca: 'P1' }, { pieza: 'R1', boca: 'P1' });
    expect(a.ok && a.cruces.map((c) => [c.pieza, c.entrada, c.salida])).toEqual([['R1', 'P2', 'P1']]);
    expect(a.ok && a.uniones).toEqual(['R1-R2']);
    expect(a.ok && a.sumaMm).toBe(1000);
    // Destino en la boca unida R2.P1: se cruza R1 y se llega por la unión.
    const b = caminoEntreBocas(t, { pieza: 'R1', boca: 'P1' }, { pieza: 'R2', boca: 'P1' });
    expect(b.ok && b.cruces.map((c) => c.pieza)).toEqual(['R1']);
    expect(b.ok && b.uniones).toEqual(['R1-R2']);
  });

  it('origen y destino en la misma pieza: la cruza de una boca a la otra', () => {
    const r = caminoEntreBocas(t, { pieza: 'S', boca: 'P1' }, { pieza: 'S', boca: 'P2' });
    expect(r.ok && r.sumaMm).toBe(3000);
  });
});
