/**
 * Bajada (enlace equipo ↔ bandeja), etapa 1. El punto de salida se elige como el
 * enganche de una derivación (misma maquinaria: `geometriaPuntoEnTramo`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../placement/definitions';
import { placeDefinition, puertosFromWorld } from '../../placement/placementCore';
import { translatePiece } from '../../trayMovement';
import { geometriaPuntoEnTramo } from '../../derivacion/enganche';
import {
  bajadaDeEquipo, bajadasOf, borrarBajada, crearBajada, estadoBajada, firmaBajada, PROCEDENCIA_BAJADA, PROCEDENCIA_PUNTO_EQUIPO, puntoDeConexionEquipo,
} from '../bajada';
import type { Product, TrayInput } from '../../../tray/model';
import type { EquipmentElement } from '../../../types/domain-v2';

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

/** Un recto de 2000 mm con P1 en el origen y eje +x. */
function tramo(): TrayInput {
  let t = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput;
  const d = definicionEfectiva(productos.get('SAM_TRPS-300-22-Z')!, { longitud_mm: 2000 });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  t = withDefinition(t, d.huella, d.def);
  return { ...t, piezas: [{ instancia_id: 'R1', producto_id: 'SAM_TRPS-300-22-Z', longitud_mm: 2000, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion }] };
}

function equipo(id: string, name: string, pos: readonly number[], extra: Record<string, unknown> = {}): EquipmentElement {
  return {
    id, name, tag: null, aliases: [], category: 'pump', parentId: null, geometry: null,
    placementStatus: 'placed', transform: { positionMm: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    ...extra,
  } as unknown as EquipmentElement;
}

const P = { tronco: 'R1', desde_boca: 'P1', distancia_mm: 500, lado: 'izquierda' as const };

describe('bajada: enlace de un equipo con la bandeja', () => {
  it('el punto de salida es el del enganche (misma maquinaria); la bajada mide en recta hasta el centro del equipo', () => {
    const t = tramo();
    const g = geometriaPuntoEnTramo(t, productos, P);
    const cerca = (v: readonly number[], w: readonly number[]) => v.forEach((x, i) => expect(x).toBeCloseTo(w[i], 9));
    if (!g.ok) throw new Error(g.motivo);
    cerca(g.F, [500, 150, 0]); // a 500 mm de P1, sobre el flanco izquierdo (medio ancho 150)
    const els = [equipo('B3', 'Bomba 3', [500, 150 + 1200, -500])];
    const r = crearBajada(t, productos, els, { ...P, equipo: 'B3' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bajada).toMatchObject({
      id: 'BAJ-1', equipo: 'B3', ...P,
      punto_equipo_mm: [500, 1350, -500],
      procedencia: PROCEDENCIA_BAJADA, punto_equipo_procedencia: PROCEDENCIA_PUNTO_EQUIPO,
    });
    cerca(r.bajada.punto_salida_mm, [500, 150, 0]);
    expect(r.bajada.longitud_mm).toBeCloseTo(1300, 9); // √(1200² + 500²)
    // No es bandeja: no agrega piezas ni conexiones (no computa ninguna pieza).
    expect(r.entrada.piezas).toBe(t.piezas);
    expect(r.entrada.conexiones).toBe(t.conexiones);
    expect(bajadasOf(r.entrada)).toEqual([r.bajada]);
    expect(bajadaDeEquipo(r.entrada, 'B3')).toEqual(r.bajada);
    expect(estadoBajada(r.entrada, els, r.bajada)).toEqual({ vigente: true });
    // Persiste con el proyecto (JSON).
    expect(bajadasOf(JSON.parse(JSON.stringify(r.entrada)))).toEqual(JSON.parse(JSON.stringify([r.bajada])));
  });

  it('rechaza con motivo: sin equipo, equipo sin ubicar, ya enlazado, punto fuera del tramo, tramo que no es recto', () => {
    const t = tramo();
    const els = [equipo('B3', 'Bomba 3', [0, 1000, 0]), equipo('M1', 'Motor 1', [0, 0, 0], { placementStatus: 'unplaced', transform: null })];
    expect(crearBajada(t, productos, els, { ...P, equipo: '' })).toEqual({ ok: false, motivo: 'elegí un equipo' });
    expect(crearBajada(t, productos, els, { ...P, equipo: 'M1' })).toEqual({ ok: false, motivo: 'el equipo Motor 1 no está ubicado en la escena' });
    expect(crearBajada(t, productos, els, { ...P, equipo: 'B3', distancia_mm: 2500 })).toEqual({ ok: false, motivo: 'la distancia 2500.0 mm está fuera del tronco (0–2000.0 mm)' });
    expect(crearBajada(t, productos, els, { ...P, equipo: 'B3', tronco: 'NO' })).toEqual({ ok: false, motivo: 'el tronco NO no existe' });
    const r = crearBajada(t, productos, els, { ...P, equipo: 'B3' });
    if (!r.ok) throw new Error(r.motivo);
    expect(crearBajada(r.entrada, productos, els, { ...P, equipo: 'B3' })).toEqual({ ok: false, motivo: 'el equipo Bomba 3 ya tiene el enlace BAJ-1; borralo para crear otro' });
    expect(bajadasOf(borrarBajada(r.entrada, 'BAJ-1'))).toEqual([]);
  });

  it('equipo dentro de otro: su centro es la posición compuesta con la del padre', () => {
    const giro90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }; // 90° sobre Z
    const els = [
      equipo('TG', 'Tablero General A', [1000, 2000, 0], { transform: { positionMm: { x: 1000, y: 2000, z: 0 }, rotation: giro90 } }),
      equipo('INT', 'Interruptor', [100, 0, 50], { parentId: 'TG' }),
    ];
    const p = puntoDeConexionEquipo(els, 'INT');
    expect(p.ok).toBe(true);
    if (p.ok) p.punto.forEach((x, i) => expect(x).toBeCloseTo([1000, 2100, 50][i], 9));
    const sinPadre = [{ ...els[0], placementStatus: 'unplaced', transform: null } as unknown as EquipmentElement, els[1]];
    expect(puntoDeConexionEquipo(sinPadre, 'INT')).toEqual({ ok: false, motivo: 'el equipo Interruptor está dentro de Tablero General A, que no está ubicado' });
  });

  it('desactualizada con motivo si el equipo se mueve o se borra, o el tramo se mueve, cambia de largo o se borra — nada se recalcula', () => {
    const t = tramo();
    const els = [equipo('B3', 'Bomba 3', [500, 1150, 0])];
    const r = crearBajada(t, productos, els, { ...P, equipo: 'B3' });
    if (!r.ok) throw new Error(r.motivo);
    const b = r.bajada;
    const movido = [equipo('B3', 'Bomba 3', [500, 1150, 30])];
    expect(estadoBajada(r.entrada, movido, b)).toEqual({ vigente: false, motivos: ['el equipo Bomba 3 se movió (30.0 mm)'] });
    // Girar el equipo no mueve su centro: no cambia la bajada.
    const girado = [equipo('B3', 'Bomba 3', [500, 1150, 0], { transform: { positionMm: { x: 500, y: 1150, z: 0 }, rotation: { x: 0, y: 0, z: 1, w: 0 } } })];
    expect(estadoBajada(r.entrada, girado, b)).toEqual({ vigente: true });
    expect(estadoBajada(r.entrada, [], b)).toEqual({ vigente: false, motivos: ['el equipo B3 ya no existe'] });

    const tramoMovido = translatePiece(r.entrada, 'R1', [0, 0, 100]);
    expect(estadoBajada(tramoMovido, els, b)).toEqual({ vigente: false, motivos: ['el tronco se movió o rotó (boca P1: 100.00 mm, 0.00°) (punto de salida de BAJ-1)'] });
    const otroLargo = structuredClone(r.entrada);
    otroLargo.piezas[0].longitud_mm = 1800;
    expect(estadoBajada(otroLargo, els, b).vigente).toBe(false);
    expect(estadoBajada({ ...r.entrada, piezas: [] }, els, b)).toEqual({ vigente: false, motivos: ['el tronco R1 ya no existe (punto de salida de BAJ-1)'] });
    // Lo guardado no cambió.
    expect(bajadasOf(tramoMovido)[0]).toEqual(b);
    expect(firmaBajada(bajadasOf(tramoMovido)[0])).toBe(firmaBajada(b));
  });
});
