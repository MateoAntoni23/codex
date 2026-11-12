/**
 * Derivación en un tramo — la unión (común) y el accesorio (por familia).
 * Piezas colocadas por el camino real (definición efectiva → colocación).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../placement/definitions';
import { checkConnection } from '../../placement/joins';
import { placeDefinition, puertosFromWorld } from '../../placement/placementCore';
import { translatePiece } from '../../trayMovement';
import { caminoEntreBocas } from '../../recorridos/caminoEntreBocas';
import { circuitosOf, estadoCircuito, guardarCircuito } from '../../recorridos/circuitosGuardados';
import {
  crearEnganche, enganchesOf, estadoEnganche, MOTIVO_SIN_ACCESORIO_ESCALERA, validarEnganche, ENGANCHES_KEY, type Enganche,
} from '../enganche';
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

/** Trazado con un tronco recto colocado a lo largo de +X, sección hacia +Z. */
function conTronco(productoId: string, L: number): TrayInput {
  const d = definicionEfectiva(productos.get(productoId)!, { longitud_mm: L });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t = withDefinition({
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput, d.huella, d.def);
  return { ...t, piezas: [{ instancia_id: 'T', producto_id: productoId, longitud_mm: L, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never] };
}

const PERF = { tronco: 'T', desde_boca: 'P1', distancia_mm: 1500, lado: 'izquierda' as const, ramal_producto_id: 'SAM_TRPS-100-22-Z', ramal_longitud_mm: 1000 };
const tronco0 = conTronco('SAM_TRPS-300-22-Z', 3000);

function perforada() {
  const r = crearEnganche(tronco0, productos, PERF);
  if (!r.ok) throw new Error(r.motivo);
  return r;
}

const TRES_RAMAL = snapshot.PRODUCTOS.find((p) => p.producto_id === 'SAM_TRES-150-065-18-Z') ?? snapshot.PRODUCTOS.find((p) => String(p.sku).startsWith('TRES-150-'))!;

function escalera() {
  const r = crearEnganche(conTronco('SAM_TRES-300-065-18-Z', 3000), productos, { ...PERF, ramal_producto_id: TRES_RAMAL.producto_id });
  if (!r.ok) throw new Error(r.motivo);
  return r;
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('derivación en un tramo — perforada', () => {
  it('crea el enganche con la DCPS del ancho del RAMAL; el tronco no se corta ni cambia su largo', () => {
    const { entrada, enganche } = perforada();
    const t = entrada.piezas.find((p) => p.instancia_id === 'T')!;
    expect(t).toEqual(tronco0.piezas[0]); // ni puertos ni longitud cambian
    expect(enganche.familia).toBe('perforada');
    expect(enganche.accesorio).toMatchObject({ tipo: 'producto', producto_id: 'SAM_DCPS-100-Z' });
    expect(enganche.huella_mm).toBeCloseTo(279.323, 3);
    const dcps = entrada.piezas.find((p) => p.producto_id === 'SAM_DCPS-100-Z')!;
    expect(Object.keys(dcps.puertos)).toEqual(['P1']);
    // Ramal perpendicular, del lado izquierdo (+Y mirando desde P1 hacia +X con Z arriba).
    const ramal = entrada.piezas.find((p) => p.producto_id === 'SAM_TRPS-100-22-Z')!;
    expect(ramal.puertos.P1.direccion[1]).toBeCloseTo(-1, 9);
    expect(ramal.puertos.P2.posicion_mm[1] - ramal.puertos.P1.posicion_mm[1]).toBeCloseTo(1000, 6);
    // La boca de la DCPS queda a medio ancho del tronco + la profundidad medida (80,542).
    expect(dcps.puertos.P1.posicion_mm[1]).toBeCloseTo(150 + 80.542, 3);
    expect(dcps.puertos.P1.posicion_mm[0]).toBeCloseTo(1500, 6);
    expect(dist(dcps.puertos.P1.posicion_mm, ramal.puertos.P1.posicion_mm)).toBeLessThan(1e-9);
  });

  it('B-3 no se aplica entre tronco y ramal (no hay conexión entre ellos); sí entre la DCPS y su ramal, y cumple', () => {
    const { entrada } = perforada();
    expect(entrada.conexiones).toHaveLength(1);
    const c = entrada.conexiones[0];
    expect([c.a[0], c.b[0]].sort()).toEqual(['DER-1', 'RAM-1']);
    const chk = checkConnection(entrada, c)!;
    expect(chk.ok, chk.motivos.join('; ')).toBe(true);
    expect(chk.anchosMm![0]).toBeCloseTo(101.315, 3); // boca DCPS-100 medida/ley
  });

  it('el recorrido entra por una boca del tronco y sale por el ramal: longitud completa = distancia guardada + profundidad de la DCPS + ramal', () => {
    const { entrada } = perforada();
    for (const [boca, d] of [['P1', 1500], ['P2', 1500]] as const) {
      const r = caminoEntreBocas(entrada, { pieza: 'T', boca }, { pieza: 'RAM-1', boca: 'P2' });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.completa).toBe(true);
      expect(r.cruces.map((c) => [c.pieza, c.entrada, c.salida])).toEqual([[`T`, boca, 'enganche:ENG-1'], ['DER-1', 'apoyo', 'P1'], ['RAM-1', 'P1', 'P2']]);
      expect(r.enganches).toEqual(['ENG-1']);
      expect(r.sumaMm).toBeCloseTo(d + 80.542 + 1000, 3);
    }
  });

  it('la huella tiene que caber: no se pasa de los extremos y dos enganches del mismo lado no se superponen', () => {
    expect(crearEnganche(tronco0, productos, { ...PERF, distancia_mm: 50 })).toEqual({
      ok: false, motivo: 'la huella de 279.3 mm no entra en el tronco: se pasa 89.7 mm del extremo P1',
    });
    expect(crearEnganche(tronco0, productos, { ...PERF, desde_boca: 'P2', distancia_mm: 100 })).toEqual({
      ok: false, motivo: 'la huella de 279.3 mm no entra en el tronco: se pasa 39.7 mm del extremo P2',
    });
    const { entrada } = perforada();
    expect(crearEnganche(entrada, productos, { ...PERF, distancia_mm: 1700 })).toEqual({
      ok: false, motivo: 'se superpone 79.3 mm con el enganche ENG-1 del mismo lado',
    });
    // Del otro lado, en el mismo lugar, sí entra.
    expect(crearEnganche(entrada, productos, { ...PERF, lado: 'derecha' }).ok).toBe(true);
  });

  it('control negativo: perforada sin DCPS del ancho del ramal no se crea; y un enganche perforada sin DCPS resuelta falla la validación', () => {
    const sinDcps100 = new Map([...productos].filter(([id]) => id !== 'SAM_DCPS-100-Z'));
    expect(crearEnganche(tronco0, sinDcps100, PERF)).toEqual({ ok: false, motivo: 'no hay DCPS de 100 mm en el catálogo para el ramal' });
    const { entrada, enganche } = perforada();
    const roto: Enganche = { ...enganche, accesorio: { tipo: 'sin_accesorio_por_familia', familia: 'escalera', motivo: MOTIVO_SIN_ACCESORIO_ESCALERA } };
    expect(validarEnganche(entrada, productos, roto)).toEqual(['perforada sin DCPS resuelta']);
  });

  it('si el tronco se mueve, se acorta o se borra, el enganche queda desactualizado con motivo y el recorrido no lo atraviesa', () => {
    const { entrada } = perforada();
    const e = enganchesOf(entrada)[0];
    expect(estadoEnganche(entrada, productos, e)).toEqual({ vigente: true });

    const movido = translatePiece(entrada, 'T', [0, 0, 20]);
    expect(estadoEnganche(movido, productos, e)).toEqual({ vigente: false, motivos: ['el tronco se movió o rotó (boca P1: 20.00 mm, 0.00°)'] });
    // No se recalcula: el enganche guardado es el mismo.
    expect(enganchesOf(movido)[0]).toEqual(e);
    const r = caminoEntreBocas(movido, { pieza: 'T', boca: 'P1' }, { pieza: 'RAM-1', boca: 'P2' });
    expect(r).toMatchObject({ ok: false, motivo: 'no hay camino por uniones válidas: el enganche ENG-1 está desactualizado y no se atraviesa' });

    const corto = structuredClone(entrada);
    corto.piezas.find((p) => p.instancia_id === 'T')!.longitud_mm = 2400;
    expect(estadoEnganche(corto, productos, e)).toMatchObject({ vigente: false, motivos: ['el tronco cambió de largo (3000.0 → 2400.0 mm)'] });

    const sinTronco = { ...entrada, piezas: entrada.piezas.filter((p) => p.instancia_id !== 'T') };
    expect(estadoEnganche(sinTronco, productos, e)).toEqual({ vigente: false, motivos: ['el tronco T ya no existe'] });
  });

  it('un circuito que pasa por el enganche queda desactualizado si el enganche cambia o queda desactualizado', () => {
    const { entrada } = perforada();
    const g = guardarCircuito(entrada, 'Ramal 100', { pieza: 'T', boca: 'P1' }, { pieza: 'RAM-1', boca: 'P2' });
    if (!g.ok) throw new Error(g.motivo);
    const c = circuitosOf(g.entrada)[0];
    expect(c.enganches).toEqual([{ id: 'ENG-1', firma: expect.any(String) }]);
    expect(c.sumaMm).toBeCloseTo(1500 + 80.542 + 1000, 3);
    expect(estadoCircuito(g.entrada, c)).toEqual({ vigente: true });
    expect(estadoCircuito(JSON.parse(JSON.stringify(g.entrada)), c)).toEqual({ vigente: true });

    const movido = translatePiece(g.entrada, 'T', [0, 0, 20]);
    const e1 = estadoCircuito(movido, c);
    expect(e1.vigente).toBe(false);
    if (!e1.vigente) expect(e1.motivos).toContain('el enganche ENG-1 quedó desactualizado: el tronco se movió o rotó (boca P1: 20.00 mm, 0.00°)');

    const cambiado = { ...g.entrada, [ENGANCHES_KEY]: [{ ...enganchesOf(g.entrada)[0], distancia_mm: 1600 }] } as TrayInput;
    const e2 = estadoCircuito(cambiado, c);
    expect(e2.vigente).toBe(false);
    if (!e2.vigente) expect(e2.motivos).toContain('el enganche ENG-1 cambió');

    const sin = { ...g.entrada, [ENGANCHES_KEY]: [] } as TrayInput;
    const e3 = estadoCircuito(sin, c);
    expect(e3.vigente).toBe(false);
    if (!e3.vigente) expect(e3.motivos).toContain('el enganche ENG-1 ya no existe');
  });
});

describe('derivación en un tramo — escalera', () => {
  it('se crea SIN accesorio, explícito en el dato; el ramal sale del flanco; no hay pieza ni conexión extra', () => {
    const { entrada, enganche } = escalera();
    expect(enganche.familia).toBe('escalera');
    expect(enganche.accesorio).toEqual({ tipo: 'sin_accesorio_por_familia', familia: 'escalera', motivo: MOTIVO_SIN_ACCESORIO_ESCALERA });
    expect(entrada.piezas.map((p) => p.instancia_id)).toEqual(['T', 'RAM-1']);
    expect(entrada.conexiones).toEqual([]);
    expect(enganche.salida).toEqual(['RAM-1', 'P1']);
    const ramal = entrada.piezas[1];
    expect(ramal.puertos.P1.posicion_mm[1]).toBeCloseTo(150, 6); // en el flanco del tronco de 300
    expect(enganche.huella_mm).toBe(150);
  });

  it('el recorrido por el ramal da longitud completa: distancia guardada + ramal', () => {
    const { entrada } = escalera();
    const r = caminoEntreBocas(entrada, { pieza: 'T', boca: 'P2' }, { pieza: 'RAM-1', boca: 'P2' });
    expect(r.ok && r.completa).toBe(true);
    if (!r.ok) return;
    expect(r.cruces.map((c) => [c.pieza, c.entrada, c.salida])).toEqual([['T', 'P2', 'enganche:ENG-1'], ['RAM-1', 'P1', 'P2']]);
    expect(r.sumaMm).toBeCloseTo(1500 + 1000, 6);
    // Y al revés, del ramal al tronco.
    const v = caminoEntreBocas(entrada, { pieza: 'RAM-1', boca: 'P2' }, { pieza: 'T', boca: 'P1' });
    expect(v.ok && v.sumaMm).toBeCloseTo(1000 + 1500, 6);
  });

  it('control negativo: un enganche de escalera con accesorio asignado falla la validación', () => {
    const { entrada, enganche } = escalera();
    const roto: Enganche = { ...enganche, accesorio: { tipo: 'producto', producto_id: 'SAM_DCPS-150-Z', pieza: 'X', profundidad_mm: 80.542, procedencia: '' } };
    expect(validarEnganche(entrada, productos, roto)).toEqual(['escalera no lleva accesorio y tiene asignado SAM_DCPS-150-Z']);
  });

  it('el ramal tiene que ser de la familia del tronco', () => {
    const r = crearEnganche(conTronco('SAM_TRES-300-065-18-Z', 3000), productos, PERF);
    expect(r).toEqual({ ok: false, motivo: 'el ramal (perforada) no es de la familia del tronco (escalera)' });
  });
});
