/**
 * Circuitos guardados (de un equipo a otro, etapa 1) y longitudes de proyectos anteriores.
 * Las piezas se colocan por el camino real (definición efectiva → colocación);
 * `conRegla` aplica las longitudes como al colocar en el espacio de trabajo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../placement/definitions';
import { conLongitudesEje } from '../../placement/longitudesEje';
import { placeDefinition, puertosFromWorld, type V3, type WorldPort } from '../../placement/placementCore';
import { translatePiece } from '../../trayMovement';
import { rotarEnTrazado } from '../../trayRotation';
import {
  asignarCable, borrarCircuito, caminoEntreEquipos, circuitosOf, estadoCircuito, faltaParaCalcular, guardarCircuito, quitarCable, recalcularCircuito,
  validarCircuitosDeArchivo, type CableDeCircuito,
} from '../circuitosGuardados';
import { borrarBajada, crearBajada } from '../../equipos/bajada';
import { geometriaPuntoEnTramo } from '../../derivacion/enganche';
import type { EquipmentElement } from '../../../types/domain-v2';
import { guardarLongitudesAnteriores } from '../longitudesAnteriores';
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

/** R1 ─ R2 ─ T(tronco) ─ R3 ;  T derivación ─ R4 ─ CUPS ─ R5 */
function cadena(conRegla: boolean): TrayInput {
  let t = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput;
  const bocas = new Map<string, WorldPort[]>();
  const colocar = (id: string, productoId: string, entrada: string, en?: [string, string], extra: Record<string, unknown> = {}) => {
    const d = definicionEfectiva(productos.get(productoId)!, { longitud_mm: (extra.longitud_mm as number) ?? 1000 });
    if (!d.ok) throw new Error(`${productoId}: ${d.motivo}`);
    const boca = en ? bocas.get(en[0])!.find((p) => p.name === en[1])! : undefined;
    const pl = placeDefinition({
      def: d.def, huella: d.huella, mano: 'nativa', entryPortName: entrada,
      startPos: boca ? boca.pos : [0, 0, 0], entryDir: boca ? boca.normal : [1, 0, 0], sectionUp: (boca ? boca.vDir : [0, 0, 1]) as V3,
    });
    bocas.set(id, pl.ports);
    t = withDefinition(t, d.huella, d.def);
    let pieza = { instancia_id: id, producto_id: productoId, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion, ...extra } as never;
    if (conRegla) pieza = conLongitudesEje(pieza, d.def);
    t = { ...t, piezas: [...t.piezas, pieza] };
    if (en) t = { ...t, conexiones: [...t.conexiones, { conexion_id: `${en[0]}-${id}`, a: en, b: [id, entrada] }] };
  };
  colocar('R1', 'SAM_TRPS-300-22-Z', 'P1', undefined, { longitud_mm: 1000 });
  colocar('R2', 'SAM_TRPS-300-22-Z', 'P1', ['R1', 'P2'], { longitud_mm: 1500 });
  colocar('T', 'SAM_TPS-300-Z', 'tronco_P1', ['R2', 'P2']);
  colocar('R3', 'SAM_TRPS-300-22-Z', 'P1', ['T', 'tronco_P2'], { longitud_mm: 2000 });
  colocar('R4', 'SAM_TRPS-300-22-Z', 'P1', ['T', 'boca_derivacion'], { longitud_mm: 800 });
  colocar('C', 'SAM_CUPS-300-A-Z', 'P1_horizontal', ['R4', 'P2']);
  colocar('R5', 'SAM_TRPS-300-22-Z', 'P1', ['C', 'P2_vertical'], { longitud_mm: 600 });
  return t;
}

const O = { pieza: 'R1', boca: 'P1' };
const D = { pieza: 'R5', boca: 'P2' };

// ─── Equipos (etapa 1): los extremos del circuito ────────────────────────────

function equipo(id: string, name: string, pos: readonly number[], extra: Record<string, unknown> = {}): EquipmentElement {
  return {
    id, name, tag: null, aliases: [], category: 'electrical_panel', parentId: null, geometry: null,
    placementStatus: 'placed', transform: { positionMm: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    ...extra,
  } as unknown as EquipmentElement;
}

const TG = 'eq-tg';
const B3 = 'eq-b3';
/** Desplazamiento del centro de Bomba 3 respecto de su punto de salida: bajada de 500 mm. */
const OFFSET_B3 = [300, 400, 0];

/**
 * Cadena con un equipo en cada punta:
 *   Tablero General A ── bajada 1000 mm ── R1 (a 200 mm de P1, izquierda)
 *   Bomba 3 ── bajada 500 mm ── R5 (a 100 mm de P2, derecha)
 */
function proyecto(conRegla = true) {
  let t = cadena(conRegla);
  // R1: P1 en el origen, eje +x, flanco izquierdo hacia +y (medio ancho 150 mm) → salida en (200, 150, 0).
  const elements0 = [equipo(TG, 'Tablero General A', [200, 1150, 0])];
  const g5 = geometriaPuntoEnTramo(t, productos, { tronco: 'R5', desde_boca: 'P2', distancia_mm: 100, lado: 'derecha' });
  if (!g5.ok) throw new Error(g5.motivo);
  const elements = [...elements0, equipo(B3, 'Bomba 3', g5.F.map((x, i) => x + OFFSET_B3[i]))];
  const b1 = crearBajada(t, productos, elements, { equipo: TG, tronco: 'R1', desde_boca: 'P1', distancia_mm: 200, lado: 'izquierda' });
  if (!b1.ok) throw new Error(b1.motivo);
  t = b1.entrada;
  const b2 = crearBajada(t, productos, elements, { equipo: B3, tronco: 'R5', desde_boca: 'P2', distancia_mm: 100, lado: 'derecha' });
  if (!b2.ok) throw new Error(b2.motivo);
  return { t: b2.entrada, elements };
}

const EO = { equipo: TG };
const ED = { equipo: B3 };
/** Bandeja: R1 desde la salida (1000 − 200) + R2 + T (derivación) + R4 + CUPS + R5 hasta la salida (600 − 100). */
const BANDEJA = 800 + 1500 + 449.44 + 800 + 227.588 + 500;

function guardado(t: TrayInput, elements: readonly EquipmentElement[]) {
  const g = guardarCircuito(t, elements, 'Alimentación B3', EO, ED);
  if (!g.ok) throw new Error(g.motivo);
  return g;
}

describe('circuitos guardados — de un equipo a otro', () => {
  it('va de equipo a equipo: bajada → bandeja → bajada; la longitud incluye las dos bajadas y se guarda desglosada', () => {
    const { t, elements } = proyecto();
    const g = guardado(t, elements);
    expect(g.circuito).toMatchObject({ id: 'CIR-1', nombre: 'Alimentación B3', origen: EO, destino: ED, completa: true });
    expect(g.circuito.cruces.map((c) => c.pieza)).toEqual(['R1', 'R2', 'T', 'R4', 'C', 'R5']);
    expect(g.circuito.cruces[0]).toMatchObject({ entrada: 'bajada:BAJ-1', salida: 'P2', longitudMm: 800, fuente: 'bajada' });
    expect(g.circuito.cruces[5]).toMatchObject({ entrada: 'P1', salida: 'bajada:BAJ-2', longitudMm: 500, fuente: 'bajada' });
    expect(g.circuito.bajadas.origen).toMatchObject({ id: 'BAJ-1', longitud_mm: 1000 });
    expect(g.circuito.bajadas.destino.longitud_mm).toBeCloseTo(500, 9);
    expect(g.circuito.bandejaMm).toBeCloseTo(BANDEJA, 1);
    expect(g.circuito.bajadasMm).toBeCloseTo(1500, 9);
    expect(g.circuito.sumaMm).toBeCloseTo(BANDEJA + 1500, 1);
    // Control: la suma es bandeja + bajadas (no sólo bandeja).
    expect(g.circuito.sumaMm - g.circuito.bandejaMm).toBeCloseTo(1500, 9);
    // La bajada no es bandeja: no agrega piezas ni conexiones al trazado.
    expect(g.entrada.piezas.length).toBe(cadena(true).piezas.length);
    expect(g.entrada.conexiones.length).toBe(cadena(true).conexiones.length);

    const reabierto = JSON.parse(JSON.stringify(g.entrada)) as TrayInput;
    expect(() => validarCircuitosDeArchivo(reabierto)).not.toThrow();
    expect(circuitosOf(reabierto)).toEqual(JSON.parse(JSON.stringify(circuitosOf(g.entrada))));
    expect(estadoCircuito(reabierto, elements, circuitosOf(reabierto)[0])).toEqual({ vigente: true });
  });

  it('nombre obligatorio y único; sin enlace, mismo equipo o sin camino no se guarda, con el motivo', () => {
    const { t, elements } = proyecto();
    expect(guardarCircuito(t, elements, '  ', EO, ED)).toEqual({ ok: false, motivo: 'el circuito necesita un nombre' });
    const g = guardado(t, elements);
    expect(guardarCircuito(g.entrada, elements, 'alimentación b3', EO, ED)).toEqual({ ok: false, motivo: 'ya hay un circuito llamado "alimentación b3"' });
    expect(guardarCircuito(t, elements, 'X', EO, EO)).toMatchObject({ ok: false, motivo: 'origen y destino son el mismo equipo' });

    const conOtro = [...elements, equipo('eq-x', 'Motor X', [0, 0, 0])];
    expect(guardarCircuito(t, conOtro, 'X', EO, { equipo: 'eq-x' })).toMatchObject({ ok: false, motivo: 'el equipo Motor X no tiene enlace con la bandeja' });

    // Sin camino: el mismo criterio que entre bocas (un tramo suelto, sin uniones).
    const suelto = structuredClone(t);
    const r1 = suelto.piezas.find((p) => p.instancia_id === 'R1')!;
    suelto.piezas.push({ ...structuredClone(r1), instancia_id: 'RX' });
    const bx = crearBajada(suelto, productos, conOtro, { equipo: 'eq-x', tronco: 'RX', desde_boca: 'P1', distancia_mm: 10, lado: 'derecha' });
    if (!bx.ok) throw new Error(bx.motivo);
    expect(guardarCircuito(bx.entrada, conOtro, 'X', EO, { equipo: 'eq-x' })).toMatchObject({
      ok: false, motivo: 'no hay camino: origen y destino no están unidos por piezas del trazado',
    });
    // Una unión que no cumple corta el camino y se dice cuál.
    const rota = structuredClone(t);
    const r2 = rota.piezas.find((p) => p.instancia_id === 'R2')!;
    rota.piezas = rota.piezas.map((p) => (p.instancia_id === 'R2' ? translatePiece({ ...rota, piezas: [r2] } as TrayInput, 'R2', [0, 0, 50]).piezas[0] : p));
    const sinCamino = caminoEntreEquipos(rota, elements, EO, ED);
    expect(sinCamino.ok).toBe(false);
    if (!sinCamino.ok) expect(sinCamino.motivo).toBe('no hay camino por uniones válidas: la unión R1-R2 no cumple la verificación y no se atraviesa');
  });

  it('mover un equipo deja el circuito desactualizado con el motivo — sin recalcular lo guardado', () => {
    const { t, elements } = proyecto();
    const g = guardado(t, elements);
    const c0 = circuitosOf(g.entrada)[0];
    const movidos = elements.map((e) => (e.id === B3 && e.placementStatus === 'placed'
      ? { ...e, transform: { ...e.transform, positionMm: { ...e.transform.positionMm, x: e.transform.positionMm.x + 250 } } } as EquipmentElement
      : e));
    const e1 = estadoCircuito(g.entrada, movidos, c0);
    expect(e1).toEqual({ vigente: false, motivos: ['el equipo Bomba 3 se movió (250.0 mm)'] });
    expect(circuitosOf(g.entrada)[0]).toEqual(c0);
    // Y no se puede armar uno nuevo con ese enlace hasta rehacerlo.
    expect(caminoEntreEquipos(g.entrada, movidos, EO, ED)).toMatchObject({ ok: false, motivo: 'el enlace BAJ-2 del equipo Bomba 3 está desactualizado: el equipo Bomba 3 se movió (250.0 mm)' });

    const sinB3 = elements.filter((e) => e.id !== B3);
    const e2 = estadoCircuito(g.entrada, sinB3, c0);
    expect(e2).toEqual({ vigente: false, motivos: ['el equipo de destino (eq-b3) ya no existe'] });

    const sinEnlace = borrarBajada(g.entrada, 'BAJ-1');
    expect(estadoCircuito(sinEnlace, elements, c0)).toEqual({ vigente: false, motivos: ['el enlace BAJ-1 del equipo Tablero General A ya no existe'] });
  });

  it('mover, rotar o borrar una pieza del recorrido lo deja desactualizado con motivo; la pieza del punto de salida, también el enlace', () => {
    const { t, elements } = proyecto();
    const g = guardado(t, elements);
    const c0 = circuitosOf(g.entrada)[0];

    const movida = translatePiece(g.entrada, 'R4', [0, 0, 10]);
    const e1 = estadoCircuito(movida, elements, c0);
    expect(e1.vigente).toBe(false);
    if (!e1.vigente) expect(e1.motivos).toContain('la pieza R4 se movió o rotó (boca P1: 10.00 mm, 0.00°)');
    expect(circuitosOf(movida)[0]).toEqual(c0);

    // R5 es vertical (sale de la CUPS): girarla 15° sobre Z es girarla sobre su propio eje.
    const r5 = movida.piezas.find((p) => p.instancia_id === 'R5')!;
    const rotada = rotarEnTrazado(g.entrada, 'R5', [0, 0, 1], 15, r5.puertos.P1.posicion_mm);
    const e2 = estadoCircuito(rotada, elements, c0);
    expect(e2.vigente).toBe(false);
    if (!e2.vigente) {
      expect(e2.motivos).toContain('el tronco se movió o rotó (boca P1: 0.00 mm, 15.00°) (punto de salida de BAJ-2)');
      expect(e2.motivos).toContain('la pieza R5 se movió o rotó (boca P1: 0.00 mm, 15.00°)');
    }

    const sinT = { ...g.entrada, piezas: g.entrada.piezas.filter((p) => p.instancia_id !== 'T'), conexiones: g.entrada.conexiones.filter((x) => x.a[0] !== 'T' && x.b[0] !== 'T') };
    const e3 = estadoCircuito(sinT, elements, c0);
    expect(e3).toEqual({ vigente: false, motivos: ['la pieza T ya no existe', 'la unión R2-T ya no existe', 'la unión T-R4 ya no existe'] });

    const sinR1 = { ...g.entrada, piezas: g.entrada.piezas.filter((p) => p.instancia_id !== 'R1'), conexiones: g.entrada.conexiones.filter((x) => x.a[0] !== 'R1' && x.b[0] !== 'R1') };
    const e4 = estadoCircuito(sinR1, elements, c0);
    expect(e4.vigente).toBe(false);
    if (!e4.vigente) expect(e4.motivos).toEqual(['el tronco R1 ya no existe (punto de salida de BAJ-1)', 'la pieza R1 ya no existe', 'la unión R1-R2 ya no existe']);
  });

  it('cambiar el largo de un tramo lo deja desactualizado; recalcular es explícito', () => {
    const { t, elements } = proyecto();
    const g = guardado(t, elements);
    const c0 = circuitosOf(g.entrada)[0];
    const otraLongitud = structuredClone(g.entrada);
    otraLongitud.piezas.find((p) => p.instancia_id === 'R2')!.longitud_mm = 1200;
    const e = estadoCircuito(otraLongitud, elements, c0);
    expect(e).toEqual({ vigente: false, motivos: ['la longitud de la pieza R2 cambió (1500.00 mm → 1200.00 mm)'] });

    const rec = recalcularCircuito(otraLongitud, elements, 'CIR-1');
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    const c1 = circuitosOf(rec.entrada)[0];
    expect(c1.nombre).toBe('Alimentación B3');
    expect(c1.sumaMm).toBeCloseTo(c0.sumaMm - 300, 6);
    expect(c1.bajadasMm).toBeCloseTo(c0.bajadasMm, 9);
    expect(estadoCircuito(rec.entrada, elements, c1)).toEqual({ vigente: true });
    expect(circuitosOf(borrarCircuito(rec.entrada, 'CIR-1'))).toEqual([]);
  });

  it('dos equipos sobre el mismo tramo: la bandeja es el trecho entre los dos puntos de salida', () => {
    const t0 = cadena(true);
    const elements = [equipo(TG, 'Tablero General A', [200, 1150, 0]), equipo(B3, 'Bomba 3', [900, 650, 0])];
    const b1 = crearBajada(t0, productos, elements, { equipo: TG, tronco: 'R1', desde_boca: 'P1', distancia_mm: 200, lado: 'izquierda' });
    if (!b1.ok) throw new Error(b1.motivo);
    const b2 = crearBajada(b1.entrada, productos, elements, { equipo: B3, tronco: 'R1', desde_boca: 'P2', distancia_mm: 100, lado: 'derecha' });
    if (!b2.ok) throw new Error(b2.motivo);
    const r = caminoEntreEquipos(b2.entrada, elements, EO, ED);
    expect(r).toMatchObject({ ok: true, completa: true });
    if (!r.ok) return;
    expect(r.cruces).toEqual([expect.objectContaining({ pieza: 'R1', entrada: 'bajada:BAJ-1', salida: 'bajada:BAJ-2', longitudMm: 700, fuente: 'bajada' })]);
    expect(r.bajadasMm).toBeCloseTo(1000 + 500, 9);
    expect(r.sumaMm).toBeCloseTo(700 + 1500, 9);
  });

  it('un archivo con circuitos de boca a boca (formato anterior) se rechaza sin repararlo', () => {
    const viejo = { ...cadena(true), circuitos_ws: [{ id: 'CIR-1', nombre: 'Viejo', origen: O, destino: D, cruces: [], uniones: [], sumaMm: 0, completa: true, guardado_iso: '' }] };
    expect(() => validarCircuitosDeArchivo(viejo)).toThrow('el circuito "Viejo" va de una boca de bandeja a otra (formato anterior): no es compatible con esta versión, que une equipos. No se intenta repararlo.');
  });
});

describe('cable del circuito (etapa 2)', () => {
  const IDS = ['PRY-SVALIO-CU-3x50', 'PRY-SVALIO-CU-4x25-NI'];
  const TRI: CableDeCircuito = { cable_id: 'PRY-SVALIO-CU-3x50', cantidad: 2, separado: false, funcion: 'potencia' };

  it('sin cable no es un error: queda incompleto y dice que le falta el cable; no hay cable por defecto', () => {
    const { t, elements } = proyecto();
    const g = guardado(t, elements);
    expect(g.circuito.cable).toBeUndefined();
    expect(faltaParaCalcular(g.circuito, IDS)).toEqual(['le falta el cable para poder calcular']);
    expect(estadoCircuito(g.entrada, elements, g.circuito)).toEqual({ vigente: true });
  });

  it('se guarda con el circuito (al guardar o después) y sobrevive a guardar y abrir', () => {
    const { t, elements } = proyecto();
    const g = guardarCircuito(t, elements, 'Con cable', EO, ED, TRI, IDS);
    if (!g.ok) throw new Error(g.motivo);
    expect(g.circuito.cable).toEqual(TRI);
    expect(faltaParaCalcular(g.circuito, IDS)).toEqual([]);
    const reabierto = JSON.parse(JSON.stringify(g.entrada)) as TrayInput;
    expect(() => validarCircuitosDeArchivo(reabierto)).not.toThrow();
    expect(circuitosOf(reabierto)[0].cable).toEqual(TRI);

    const sin = guardado(t, elements);
    const a = asignarCable(sin.entrada, 'CIR-1', { ...TRI, cable_id: 'PRY-SVALIO-CU-4x25-NI', cantidad: 1 }, IDS);
    if (!a.ok) throw new Error(a.motivo);
    expect(circuitosOf(a.entrada)[0].cable).toMatchObject({ cable_id: 'PRY-SVALIO-CU-4x25-NI', cantidad: 1 });
    // Cambiar el cable no toca el recorrido ni su estado.
    expect(circuitosOf(a.entrada)[0].cruces).toEqual(sin.circuito.cruces);
    expect(circuitosOf(quitarCable(a.entrada, 'CIR-1'))[0].cable).toBeUndefined();
  });

  it('valida: cable del catálogo, cantidad entero positivo, función potencia/maniobra/instrumentación; "separado" ya no se elige (etapa 3)', () => {
    const { t, elements } = proyecto();
    const sin = guardado(t, elements);
    expect(asignarCable(sin.entrada, 'CIR-1', { ...TRI, cable_id: 'NO-EXISTE' }, IDS)).toEqual({ ok: false, motivo: 'el cable NO-EXISTE no está en el catálogo de cables' });
    for (const cantidad of [0, -1, 1.5, Number.NaN]) {
      expect(asignarCable(sin.entrada, 'CIR-1', { ...TRI, cantidad }, IDS)).toEqual({ ok: false, motivo: 'la cantidad tiene que ser un entero positivo' });
    }
    expect(asignarCable(sin.entrada, 'CIR-1', { ...TRI, funcion: 'mando' as 'potencia' }, IDS)).toEqual({ ok: false, motivo: 'la función tiene que ser potencia, maniobra o instrumentación' });
    for (const funcion of ['maniobra', 'instrumentacion'] as const) expect(asignarCable(sin.entrada, 'CIR-1', { ...TRI, funcion }, IDS).ok).toBe(true);
    // Un circuito de la etapa 2 con "separado" sin elegir ya no queda incompleto: viaja en false (operador, etapa 3).
    const sinDisp = asignarCable(sin.entrada, 'CIR-1', { ...TRI, separado: null }, IDS);
    if (!sinDisp.ok) throw new Error(sinDisp.motivo);
    expect(faltaParaCalcular(circuitosOf(sinDisp.entrada)[0], IDS)).toEqual([]);
    // Un cable que el catálogo ya no tiene se informa (no se borra).
    expect(faltaParaCalcular(circuitosOf(sinDisp.entrada)[0], ['OTRO'])).toContain('el cable PRY-SVALIO-CU-3x50 no está en el catálogo de cables');
  });

  it('recalcular el recorrido conserva el cable', () => {
    const { t, elements } = proyecto();
    const g = guardarCircuito(t, elements, 'Con cable', EO, ED, TRI, IDS);
    if (!g.ok) throw new Error(g.motivo);
    const otro = structuredClone(g.entrada);
    otro.piezas.find((p) => p.instancia_id === 'R2')!.longitud_mm = 1200;
    const rec = recalcularCircuito(otro, elements, 'CIR-1');
    if (!rec.ok) throw new Error(rec.motivo);
    expect(circuitosOf(rec.entrada)[0].cable).toEqual(TRI);
  });

  it('un archivo con un cable de datos inválidos se rechaza', () => {
    const { t, elements } = proyecto();
    const g = guardarCircuito(t, elements, 'Con cable', EO, ED, TRI, IDS);
    if (!g.ok) throw new Error(g.motivo);
    const malo = JSON.parse(JSON.stringify(g.entrada));
    malo.circuitos_ws[0].cable.cantidad = 0;
    expect(() => validarCircuitosDeArchivo(malo)).toThrow('el circuito "Con cable" tiene un cable con datos inválidos');
  });
});

describe('longitudes de proyectos anteriores', () => {
  it('guarda las longitudes con las reglas vigentes, dice cuántas y deja el recorrido completo', () => {
    const vieja = cadena(false);
    expect(caminoEntreBocas(vieja, O, D)).toMatchObject({ ok: true, completa: false });
    const r = guardarLongitudesAnteriores(vieja);
    expect(r.actualizadas).toEqual(['T', 'C']);
    expect(r.noPudo).toEqual([]);
    const cam = caminoEntreBocas(r.entrada, O, D);
    expect(cam.ok && cam.completa).toBe(true);
    // Rectos sin tocar; segunda vez no hay nada que hacer.
    expect(r.entrada.piezas.find((p) => p.instancia_id === 'R1')).toBe(vieja.piezas.find((p) => p.instancia_id === 'R1'));
    expect(guardarLongitudesAnteriores(r.entrada)).toMatchObject({ actualizadas: [], noPudo: [] });
  });

  it('dice cuáles no pudo y por qué (sin colocación resuelta, sin definición guardada)', () => {
    const vieja = cadena(false);
    const t = vieja.piezas.find((p) => p.instancia_id === 'T')!;
    (t as { colocacion: unknown }).colocacion = { version: 1, estado: 'sin_resolver', motivo: 'no encaja con el modelo vigente' };
    const sinDef = { ...vieja, definiciones_ws: Object.fromEntries(Object.entries(vieja.definiciones_ws as object).filter(([h]) => h !== (vieja.piezas.find((p) => p.instancia_id === 'C')!.colocacion as { definicion: { huella: string } }).definicion.huella)) } as TrayInput;
    const r = guardarLongitudesAnteriores(sinDef);
    expect(r.actualizadas).toEqual([]);
    expect(r.noPudo).toEqual([
      { pieza: 'T', motivo: 'sin colocación resuelta: no encaja con el modelo vigente' },
      { pieza: 'C', motivo: 'falta la definición guardada de la pieza' },
    ]);
  });
});
