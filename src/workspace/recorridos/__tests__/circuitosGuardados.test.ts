/**
 * Circuitos guardados y longitudes de proyectos anteriores.
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
import { borrarCircuito, circuitosOf, estadoCircuito, guardarCircuito, recalcularCircuito } from '../circuitosGuardados';
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

function guardado(t: TrayInput) {
  const g = guardarCircuito(t, 'Alimentación TG-1', O, D);
  if (!g.ok) throw new Error(g.motivo);
  return g;
}

describe('circuitos guardados', () => {
  it('se guarda con nombre, origen, destino, piezas, longitud; sobrevive a guardar y abrir (JSON) y sigue vigente', () => {
    const t = cadena(true);
    const g = guardado(t);
    expect(g.circuito).toMatchObject({ id: 'CIR-1', nombre: 'Alimentación TG-1', origen: O, destino: D, completa: true });
    expect(g.circuito.cruces.map((c) => c.pieza)).toEqual(['R1', 'R2', 'T', 'R4', 'C', 'R5']);
    expect(g.circuito.sumaMm).toBeCloseTo(1000 + 1500 + 449.44 + 800 + 227.588 + 600, 1);
    const reabierto = JSON.parse(JSON.stringify(g.entrada)) as TrayInput;
    expect(circuitosOf(reabierto)).toEqual(JSON.parse(JSON.stringify(circuitosOf(g.entrada))));
    expect(estadoCircuito(reabierto, circuitosOf(reabierto)[0])).toEqual({ vigente: true });
  });

  it('nombre obligatorio y único; sin camino no se guarda', () => {
    const t = cadena(true);
    expect(guardarCircuito(t, '  ', O, D)).toEqual({ ok: false, motivo: 'el circuito necesita un nombre' });
    const g = guardado(t);
    expect(guardarCircuito(g.entrada, 'alimentación tg-1', O, D)).toEqual({ ok: false, motivo: 'ya hay un circuito llamado "alimentación tg-1"' });
    expect(guardarCircuito(t, 'X', O, O)).toMatchObject({ ok: false, motivo: 'origen y destino son la misma boca' });
  });

  it('mover, rotar o borrar una pieza del recorrido lo deja desactualizado con motivo — sin recalcular lo guardado', () => {
    const g = guardado(cadena(true));
    const c0 = circuitosOf(g.entrada)[0];

    const movida = translatePiece(g.entrada, 'R4', [0, 0, 10]);
    const e1 = estadoCircuito(movida, c0);
    expect(e1.vigente).toBe(false);
    if (!e1.vigente) expect(e1.motivos).toContain('la pieza R4 se movió o rotó (boca P1: 10.00 mm, 0.00°)');
    // Lo guardado no cambió.
    expect(circuitosOf(movida)[0]).toEqual(c0);

    // R5 es vertical (sale de la CUPS): girarla 15° sobre Z es girarla sobre su propio
    // eje — las bocas no se mueven ni cambian de dirección, sólo la sección.
    const r5 = movida.piezas.find((p) => p.instancia_id === 'R5')!;
    const rotada = rotarEnTrazado(g.entrada, 'R5', [0, 0, 1], 15, r5.puertos.P1.posicion_mm);
    const e2 = estadoCircuito(rotada, c0);
    expect(e2.vigente).toBe(false);
    if (!e2.vigente) expect(e2.motivos[0]).toBe('la pieza R5 se movió o rotó (boca P1: 0.00 mm, 15.00°)');

    const sinT = { ...g.entrada, piezas: g.entrada.piezas.filter((p) => p.instancia_id !== 'T'), conexiones: g.entrada.conexiones.filter((x) => x.a[0] !== 'T' && x.b[0] !== 'T') };
    const e3 = estadoCircuito(sinT, c0);
    expect(e3.vigente).toBe(false);
    if (!e3.vigente) expect(e3.motivos).toEqual(['la pieza T ya no existe', 'la unión R2-T ya no existe', 'la unión T-R4 ya no existe']);
  });

  it('cambiar el largo de un tramo o romper una unión también lo deja desactualizado; recalcular es explícito', () => {
    const g = guardado(cadena(true));
    const c0 = circuitosOf(g.entrada)[0];
    const otraLongitud = structuredClone(g.entrada);
    otraLongitud.piezas.find((p) => p.instancia_id === 'R2')!.longitud_mm = 1200;
    const e = estadoCircuito(otraLongitud, c0);
    expect(e.vigente).toBe(false);
    if (!e.vigente) expect(e.motivos).toEqual(['la longitud de la pieza R2 cambió (1500.00 mm → 1200.00 mm)']);

    const rec = recalcularCircuito(otraLongitud, 'CIR-1');
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;
    const c1 = circuitosOf(rec.entrada)[0];
    expect(c1.nombre).toBe('Alimentación TG-1');
    expect(c1.sumaMm).toBeCloseTo(c0.sumaMm - 300, 6);
    expect(estadoCircuito(rec.entrada, c1)).toEqual({ vigente: true });
    expect(circuitosOf(borrarCircuito(rec.entrada, 'CIR-1'))).toEqual([]);
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
