/**
 * Derivación en un tramo — la unión (común) y el accesorio (por familia).
 * La operación coloca SÓLO la derivación (DCPS en perforada; la boca sobre el
 * flanco en escalera) y deja su boca libre; lo que sigue se continúa por el
 * camino normal (extremo libre → planAddSegment → applyOperation), como en la UI.
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
  asentarSalidasDeEnganche, crearEnganche, dcpsHuerfanas, enganchesOf, estadoEnganche, MOTIVO_DCPS_HUERFANA, MOTIVO_SIN_ACCESORIO_ESCALERA,
  origenDeBoca, validarEnganche, ENGANCHES_KEY, type Enganche,
} from '../enganche';
import { extremosLibres } from '../extremosLibres';
import { applyOperation, planAddSegment } from '../../workspaceOperation';
import { checkDirectCompatibility } from '../../routingRules';
import { buildContinuationCandidates, esDerivacionLateral } from '../../continuationCandidates';
import type { CatalogCompatibility, Product, TrayInput } from '../../../tray/model';

const snapshot = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as {
  PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[]; COMPONENTES_UNION: never[];
};
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

const PERF = { tronco: 'T', desde_boca: 'P1', distancia_mm: 1500, lado: 'izquierda' as const, ancho_mm: 100 };
const tronco0 = conTronco('SAM_TRPS-300-22-Z', 3000);
const TRES_150 = productos.get('SAM_TRES-150-065-18-Z')!;

function perforada() {
  const r = crearEnganche(tronco0, productos, PERF);
  if (!r.ok) throw new Error(r.motivo);
  return r;
}

function escalera() {
  const r = crearEnganche(conTronco('SAM_TRES-300-065-18-Z', 3000), productos, { ...PERF, ancho_mm: 150 });
  if (!r.ok) throw new Error(r.motivo);
  return r;
}

/**
 * Continuar con un recto desde un extremo libre, por el camino de la UI: extremo
 * libre → compatibilidad contra el origen → planAddSegment → applyOperation →
 * asentarSalidasDeEnganche.
 */
function continuarRecto(entrada: TrayInput, pieceId: string, portName: string, productoId: string, L: number): TrayInput {
  const fp = extremosLibres(entrada).find((x) => x.pieceId === pieceId && x.portName === portName);
  if (!fp) throw new Error(`${pieceId}:${portName} no es un extremo libre`);
  const origen = origenDeBoca(entrada, productos, pieceId, portName)!;
  const prod = productos.get(productoId)!;
  const compat = checkDirectCompatibility({ compatibilidades: snapshot.COMPATIBILIDADES, componentesUnion: snapshot.COMPONENTES_UNION }, origen.product, origen.portName, prod, 'P1');
  if (!compat.ok) throw new Error(compat.reason);
  const op = planAddSegment(entrada, fp, prod, compat, L, fp.dir);
  return asentarSalidasDeEnganche(applyOperation(entrada, op, 'reject'));
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const libresDe = (e: TrayInput) => extremosLibres(e).map((f) => `${f.pieceId}:${f.portName}`);

describe('derivación en un tramo — perforada', () => {
  it('coloca SÓLO la DCPS del ancho elegido, con su boca libre: ninguna bandeja nueva; el tronco no se corta ni cambia su largo', () => {
    const { entrada, enganche } = perforada();
    expect(entrada.piezas.find((p) => p.instancia_id === 'T')).toEqual(tronco0.piezas[0]);
    expect(entrada.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-Z', 'SAM_DCPS-100-Z']);
    expect(entrada.conexiones).toEqual([]);
    expect(enganche.familia).toBe('perforada');
    expect(enganche.accesorio).toMatchObject({ tipo: 'producto', producto_id: 'SAM_DCPS-100-Z' });
    expect(enganche.huella_mm).toBeCloseTo(279.323, 3);
    const dcps = entrada.piezas.find((p) => p.producto_id === 'SAM_DCPS-100-Z')!;
    expect(Object.keys(dcps.puertos)).toEqual(['P1']);
    // Boca a medio ancho del tronco + la profundidad medida (80,542), mirando hacia afuera del flanco (+Y, lado izquierdo).
    expect(dcps.puertos.P1.posicion_mm[1]).toBeCloseTo(150 + 80.542, 3);
    expect(dcps.puertos.P1.posicion_mm[0]).toBeCloseTo(1500, 6);
    expect(dcps.puertos.P1.direccion[1]).toBeCloseTo(1, 9);
    // Su boca P1 es un extremo libre; ni la boca de apoyo ni una boca de enganche lo son.
    const libres = libresDe(entrada);
    expect(libres).toContain('DER-1:P1');
    expect(libres.some((l) => l.includes('enganche:') || l.endsWith(':apoyo'))).toBe(false);
  });

  it('desde la boca libre de la DCPS se continúa con un recto de 100 por el camino normal: unión que cumple (B-3), el tronco intacto', () => {
    const next = continuarRecto(perforada().entrada, 'DER-1', 'P1', 'SAM_TRPS-100-22-Z', 1000);
    expect(next.piezas.find((p) => p.instancia_id === 'T')).toEqual(tronco0.piezas[0]);
    expect(next.conexiones).toHaveLength(1);
    const c = next.conexiones[0];
    expect(c.a).toEqual(['DER-1', 'P1']);
    const chk = checkConnection(next, c)!;
    expect(chk.ok, chk.motivos.join('; ')).toBe(true);
    expect(chk.anchosMm![0]).toBeCloseTo(101.315, 3); // boca DCPS-100 (sobreancho de la 50 medida)
    const ramal = next.piezas.find((p) => p.instancia_id === c.b[0])!;
    const dcps = next.piezas.find((p) => p.instancia_id === 'DER-1')!;
    expect(dist(ramal.puertos.P1.posicion_mm, dcps.puertos.P1.posicion_mm)).toBeLessThan(1e-6);
    expect(ramal.puertos.P2.posicion_mm[1] - ramal.puertos.P1.posicion_mm[1]).toBeCloseTo(1000, 6);
    expect(libresDe(next)).not.toContain('DER-1:P1');
  });

  it('el recorrido pasa tronco → boca de enganche → DCPS (su propia longitud) → boca libre → lo continuado', () => {
    const { entrada } = perforada();
    const solo = caminoEntreBocas(entrada, { pieza: 'T', boca: 'P1' }, { pieza: 'DER-1', boca: 'P1' });
    expect(solo.ok && solo.completa).toBe(true);
    if (solo.ok) expect(solo.sumaMm).toBeCloseTo(1500 + 80.542, 3);
    const next = continuarRecto(entrada, 'DER-1', 'P1', 'SAM_TRPS-100-22-Z', 1000);
    const ram = next.conexiones[0].b[0];
    for (const boca of ['P1', 'P2'] as const) {
      const r = caminoEntreBocas(next, { pieza: 'T', boca }, { pieza: ram, boca: 'P2' });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.completa).toBe(true);
      expect(r.cruces.map((c) => [c.pieza, c.entrada, c.salida])).toEqual([['T', boca, 'enganche:ENG-1'], ['DER-1', 'apoyo', 'P1'], [ram, 'P1', 'P2']]);
      expect(r.enganches).toEqual(['ENG-1']);
      expect(r.sumaMm).toBeCloseTo(1500 + 80.542 + 1000, 3);
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
    expect(crearEnganche(entrada, productos, { ...PERF, lado: 'derecha' }).ok).toBe(true);
  });

  it('control negativo: sin DCPS del ancho elegido no se crea; sin ancho tampoco; un enganche perforada sin DCPS resuelta falla la validación', () => {
    const sinDcps100 = new Map([...productos].filter(([id]) => id !== 'SAM_DCPS-100-Z'));
    expect(crearEnganche(tronco0, sinDcps100, PERF)).toEqual({ ok: false, motivo: 'no hay DCPS de 100 mm en el catálogo' });
    expect(crearEnganche(tronco0, productos, { ...PERF, ancho_mm: Number.NaN })).toEqual({ ok: false, motivo: 'elegí el ancho de la derivación' });
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
    expect(enganchesOf(movido)[0]).toEqual(e); // no se recalcula
    const r = caminoEntreBocas(movido, { pieza: 'T', boca: 'P1' }, { pieza: 'DER-1', boca: 'P1' });
    expect(r).toMatchObject({ ok: false, motivo: 'no hay camino por uniones válidas: el enganche ENG-1 está desactualizado y no se atraviesa' });

    const corto = structuredClone(entrada);
    corto.piezas.find((p) => p.instancia_id === 'T')!.longitud_mm = 2400;
    expect(estadoEnganche(corto, productos, e)).toMatchObject({ vigente: false, motivos: ['el tronco cambió de largo (3000.0 → 2400.0 mm)'] });

    const sinTronco = { ...entrada, piezas: entrada.piezas.filter((p) => p.instancia_id !== 'T') };
    expect(estadoEnganche(sinTronco, productos, e)).toEqual({ vigente: false, motivos: ['el tronco T ya no existe'] });
  });

  it('un circuito que pasa por el enganche queda desactualizado si el enganche cambia o queda desactualizado', () => {
    const next = continuarRecto(perforada().entrada, 'DER-1', 'P1', 'SAM_TRPS-100-22-Z', 1000);
    const ram = next.conexiones[0].b[0];
    const g = guardarCircuito(next, 'Ramal 100', { pieza: 'T', boca: 'P1' }, { pieza: ram, boca: 'P2' });
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

describe('DCPS huérfana y cota no confirmada', () => {
  it('control negativo: la continuación de un recorrido NUNCA ofrece una DCPS (aunque el catálogo documente la unión directa)', () => {
    const recto = productos.get('SAM_TRPS-100-22-Z')!;
    const dcps = productos.get('SAM_DCPS-100-Z')!;
    const cands = buildContinuationCandidates({
      existingProduct: recto, existingPortName: 'P2',
      catalogProducts: [...productos.values()],
      compatibleIds: new Set([dcps.producto_id, recto.producto_id]),
    });
    expect(cands.some((c) => c.product.producto_id === dcps.producto_id)).toBe(false);
    expect(cands.some((c) => c.product.producto_id === recto.producto_id)).toBe(true);
    expect(esDerivacionLateral(dcps)).toBe(true);
  });

  it('control negativo: una DCPS en el trazado sin enganche que la use es inválida, con motivo; la del enganche no', () => {
    const { entrada } = perforada();
    expect(dcpsHuerfanas(entrada)).toEqual([]);
    const sinEnganche = { ...entrada, [ENGANCHES_KEY]: [] } as TrayInput;
    expect(dcpsHuerfanas(sinEnganche)).toEqual([{ pieza: 'DER-1', motivo: MOTIVO_DCPS_HUERFANA }]);
  });

  it('al colocar una DCPS sin STEP propio, el enganche avisa cota de boca NO CONFIRMADA; con STEP propio, no', () => {
    const { enganche } = perforada(); // derivación de 100 → DCPS-100 sin STEP, planta de la 50
    expect(enganche.advertencias).toEqual([
      'DCPS-100-Z: cota de boca NO CONFIRMADA — no hay STEP propio de este ancho; se generó con la planta y el sobreancho (1.315 mm) de la DCPS-50 medida.',
    ]);
    const r300 = crearEnganche(conTronco('SAM_TRPS-300-22-Z', 3000), productos, { ...PERF, ancho_mm: 300 });
    expect(r300.ok && r300.enganche.advertencias).toBeUndefined();
    const r450 = crearEnganche(conTronco('SAM_TRPS-600-20-Z', 3000), productos, { ...PERF, ancho_mm: 450 });
    expect(r450.ok && r450.enganche.advertencias).toEqual([
      'DCPS-450-Z: cota de boca NO CONFIRMADA — no hay STEP propio de este ancho; se generó con la planta y el sobreancho (1.315 mm) de la DCPS-300 medida.',
    ]);
  });
});

describe('derivación en un tramo — escalera', () => {
  it('deja SÓLO la boca libre sobre el flanco: sin accesorio (explícito en el dato), ninguna pieza ni conexión', () => {
    const { entrada, enganche } = escalera();
    expect(enganche.familia).toBe('escalera');
    expect(enganche.accesorio).toEqual({ tipo: 'sin_accesorio_por_familia', familia: 'escalera', motivo: MOTIVO_SIN_ACCESORIO_ESCALERA });
    expect(entrada.piezas.map((p) => p.instancia_id)).toEqual(['T']);
    expect(entrada.conexiones).toEqual([]);
    expect(enganche.salida).toEqual(['', '']);
    expect(enganche.huella_mm).toBe(150);
    const fp = extremosLibres(entrada).find((f) => f.portName === 'enganche:ENG-1')!;
    expect(fp.pieceId).toBe('T');
    expect(fp.pos[0]).toBeCloseTo(1500, 6);
    expect(fp.pos[1]).toBeCloseTo(150, 6); // en el flanco del tronco de 300
    expect(fp.dir[1]).toBeCloseTo(1, 9); // mirando hacia afuera
    expect(estadoEnganche(entrada, productos, enganche)).toEqual({ vigente: true });
  });

  it('desde la boca se continúa con un recto de 150 por el camino normal: sin conexión (la boca no viaja al motor); la salida del enganche es el recto', () => {
    const next = continuarRecto(escalera().entrada, 'T', 'enganche:ENG-1', TRES_150.producto_id, 1000);
    expect(next.conexiones).toEqual([]);
    const ram = next.piezas.find((p) => p.producto_id === TRES_150.producto_id)!;
    expect(enganchesOf(next)[0].salida).toEqual([ram.instancia_id, 'P1']);
    expect(ram.puertos.P1.posicion_mm[1]).toBeCloseTo(150, 6);
    expect(ram.puertos.P2.posicion_mm[1] - ram.puertos.P1.posicion_mm[1]).toBeCloseTo(1000, 6);
    const libres = libresDe(next);
    expect(libres).not.toContain('T:enganche:ENG-1');
    expect(libres).not.toContain(`${ram.instancia_id}:P1`);
    expect(libres).toContain(`${ram.instancia_id}:P2`);
    // Si se borra lo continuado, la boca vuelve a quedar libre (no es un error).
    const borrado = { ...next, piezas: next.piezas.filter((p) => p.instancia_id !== ram.instancia_id) };
    expect(estadoEnganche(borrado, productos, enganchesOf(borrado)[0])).toEqual({ vigente: true });
    expect(libresDe(borrado)).toContain('T:enganche:ENG-1');
  });

  it('desde la boca de escalera se continúa con su familia y el ancho de la derivación; no con otro ancho ni con perforada', () => {
    const { entrada } = escalera();
    const origen = origenDeBoca(entrada, productos, 'T', 'enganche:ENG-1')!;
    expect([origen.product.tipo_pieza, origen.product.ancho_nominal_mm, origen.portName]).toEqual(['recta', 150, 'P2']);
    expect(() => continuarRecto(entrada, 'T', 'enganche:ENG-1', 'SAM_TRES-300-065-18-Z', 1000)).toThrow();
    expect(() => continuarRecto(entrada, 'T', 'enganche:ENG-1', 'SAM_TRPS-150-22-Z', 1000)).toThrow();
  });

  it('el recorrido por lo continuado da longitud completa: distancia guardada + recto', () => {
    const next = continuarRecto(escalera().entrada, 'T', 'enganche:ENG-1', TRES_150.producto_id, 1000);
    const ram = enganchesOf(next)[0].salida[0];
    const r = caminoEntreBocas(next, { pieza: 'T', boca: 'P2' }, { pieza: ram, boca: 'P2' });
    expect(r.ok && r.completa).toBe(true);
    if (!r.ok) return;
    expect(r.cruces.map((c) => [c.pieza, c.entrada, c.salida])).toEqual([['T', 'P2', 'enganche:ENG-1'], [ram, 'P1', 'P2']]);
    expect(r.sumaMm).toBeCloseTo(1500 + 1000, 6);
    const v = caminoEntreBocas(next, { pieza: ram, boca: 'P2' }, { pieza: 'T', boca: 'P1' });
    expect(v.ok && v.sumaMm).toBeCloseTo(1000 + 1500, 6);
  });

  it('control negativo: un enganche de escalera con accesorio asignado falla la validación', () => {
    const { entrada, enganche } = escalera();
    const roto: Enganche = { ...enganche, accesorio: { tipo: 'producto', producto_id: 'SAM_DCPS-150-Z', pieza: 'X', profundidad_mm: 80.542, procedencia: '' } };
    expect(validarEnganche(entrada, productos, roto)).toEqual(['escalera no lleva accesorio y tiene asignado SAM_DCPS-150-Z']);
  });

  it('un ancho sin recto en la familia del tronco no se puede elegir', () => {
    expect(crearEnganche(conTronco('SAM_TRES-300-065-18-Z', 3000), productos, { ...PERF, ancho_mm: 123 })).toEqual({
      ok: false, motivo: 'no hay tramo recto de 123 mm en la familia del tronco para continuar desde la boca',
    });
  });
});

describe('proyectos anteriores: enganche con ramal creado por la operación', () => {
  it('se sigue leyendo: el ramal es su salida y el recorrido lo atraviesa; si se borra el ramal, lo informa', () => {
    // Forma del dato antes del cambio: escalera con salida al ramal y sin boca guardada.
    const nuevo = continuarRecto(escalera().entrada, 'T', 'enganche:ENG-1', TRES_150.producto_id, 1000);
    const { boca: _b, ref_producto_id: _r, ...sinBoca } = enganchesOf(nuevo)[0];
    const legado = { ...nuevo, [ENGANCHES_KEY]: [sinBoca] } as TrayInput;
    expect(estadoEnganche(legado, productos, sinBoca as Enganche)).toEqual({ vigente: true });
    expect(libresDe(legado).some((l) => l.includes('enganche:'))).toBe(false);
    const r = caminoEntreBocas(legado, { pieza: 'T', boca: 'P1' }, { pieza: sinBoca.salida[0], boca: 'P2' });
    expect(r.ok && r.completa).toBe(true);
    const sinRamal = { ...legado, piezas: legado.piezas.filter((p) => p.instancia_id !== sinBoca.salida[0]) };
    expect(estadoEnganche(sinRamal, productos, sinBoca as Enganche)).toEqual({ vigente: false, motivos: ['el ramal ya no está en el trazado'] });
  });
});
