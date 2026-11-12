/**
 * Sentido de la curva vertical (defecto: la ascendente salía hacia abajo).
 *
 * Un solo perfil medido (STEP CUPS-300-A-Z); A (interior) sube, D (exterior)
 * baja, la CUS articulada lo elige al colocar. Todo por la MISMA colocación que
 * usan la previa y la confirmación (computeRoutingPlacement).
 *
 * Control negativo: si una A sale hacia abajo o una D hacia arriba, falla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { computeRoutingPlacement } from '../routingPlacement';
import { routingPlacementFromState } from '../routingPlacementState';
import { checkJoin } from '../joins';
import type { Product, TrayInput } from '../../../tray/model';
import type { StartPort } from '../../routingRules';

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

/** Final de un tramo horizontal: avanza en +X, sección hacia +Z. */
const START: StartPort = { pieceId: 'R', portName: 'P2', pos: [3000, 0, 25], dir: [1, 0, 0], sectionUp: [0, 0, 1] };

function curva(p: Product, sentido?: 'sube' | 'baja') {
  const pl = computeRoutingPlacement({ product: p, startPort: START, entryPortName: 'P1_horizontal', side: 'right', ...(sentido ? { sentidoVertical: sentido } : {}) });
  if (!pl.ok) throw new Error(`${p.producto_id}: ${pl.motivo}`);
  return pl;
}

/** Sigue con un tramo recto desde la boca vertical: devuelve cuánto sube (z P2 − z P1). */
function siguiente(rectoId: string, desde: { pos: readonly number[]; normal: readonly number[]; vDir: readonly number[] }) {
  const pl = computeRoutingPlacement({
    product: productos.get(rectoId)!, startPort: { pieceId: 'C', portName: 'P2_vertical', pos: desde.pos as never, dir: desde.normal as never, sectionUp: desde.vDir as never },
    entryPortName: 'P1', side: 'right', lengthMm: 1000,
  });
  if (!pl.ok) throw new Error(pl.motivo);
  const [p1, p2] = ['P1', 'P2'].map((n) => pl.ports.find((q) => q.name === n)!);
  return { dz: p2.pos[2] - p1.pos[2], p1 };
}

const join = (a: { pos: readonly number[]; normal: readonly number[]; vDir: readonly number[] }, b: { pos: readonly number[]; normal: readonly number[]; vDir: readonly number[] }) =>
  checkJoin({ posicion_mm: a.pos, direccion: a.normal, orientacion_seccion_ws: a.vDir }, { posicion_mm: b.pos, direccion: b.normal, orientacion_seccion_ws: b.vDir });

describe('sentido de la curva vertical', () => {
  const cupsA = snapshot.PRODUCTOS.filter((p) => p.tipo_pieza === 'curva vertical interior' && String(p.sku).startsWith('CUPS-'));
  const cupsD = snapshot.PRODUCTOS.filter((p) => p.tipo_pieza === 'curva vertical exterior' && String(p.sku).startsWith('CUPS-'));

  it('toda CUPS-A (interior) sale hacia ARRIBA y el recto siguiente sube; la entrada horizontal une con el tramo', () => {
    expect(cupsA.length).toBe(7);
    for (const p of cupsA) {
      const pl = curva(p);
      const p1 = pl.ports.find((q) => q.name === 'P1_horizontal')!;
      const p2 = pl.ports.find((q) => q.name === 'P2_vertical')!;
      expect(p2.normal[2], `${p.sku}: la boca vertical debe mirar hacia arriba`).toBeCloseTo(1, 6);
      expect(p1.vDir[2], `${p.sku}: la sección de la entrada sigue la del tramo (+Z)`).toBeCloseTo(1, 6);
      const recto = `SAM_TRPS-${String(p.ancho_nominal_mm).padStart(3, '0')}-${p.ancho_nominal_mm! >= 450 ? '20' : '22'}-Z`;
      const s = siguiente(recto, p2);
      expect(s.dz, `${p.sku}: el recto siguiente arranca hacia arriba`).toBeCloseTo(1000, 6);
      expect(join(p2, s.p1).ok, `${p.sku}: unión curva–recto vertical`).toBe(true);
    }
  });

  it('toda CUPS-D (exterior) sale hacia ABAJO y el recto siguiente baja', () => {
    expect(cupsD.length).toBe(7);
    for (const p of cupsD) {
      const pl = curva(p);
      const p2 = pl.ports.find((q) => q.name === 'P2_vertical')!;
      expect(p2.normal[2], `${p.sku}: la boca vertical debe mirar hacia abajo`).toBeCloseTo(-1, 6);
      const recto = `SAM_TRPS-${String(p.ancho_nominal_mm).padStart(3, '0')}-${p.ancho_nominal_mm! >= 450 ? '20' : '22'}-Z`;
      expect(siguiente(recto, p2).dz, `${p.sku}: el recto siguiente arranca hacia abajo`).toBeCloseTo(-1000, 6);
    }
  });

  it('CUS articulada: sube o baja según lo elegido; mismo perfil', () => {
    const cus = productos.get('SAM_CUS-300-5-065-18-Z')!;
    const up = curva(cus, 'sube').ports.find((q) => q.name === 'P2_vertical')!;
    const down = curva(cus, 'baja').ports.find((q) => q.name === 'P2_vertical')!;
    expect(up.normal[2]).toBeCloseTo(1, 6);
    expect(down.normal[2]).toBeCloseTo(-1, 6);
    expect(siguiente('SAM_TRES-300-065-18-Z', up).dz).toBeCloseTo(1000, 6);
    expect(siguiente('SAM_TRES-300-065-18-Z', down).dz).toBeCloseTo(-1000, 6);
  });

  it('CUS sin sentido elegido: no hay colocación (ni previa ni confirmación); con sentido, sí', () => {
    const cus = productos.get('SAM_CUS-300-5-065-18-Z')!;
    const context = { productos: [cus], compatibilidades: [], componentesUnion: [] } as never;
    const entrada = { version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: {} } as unknown as TrayInput;
    const base = { startPort: START, selectedProductId: cus.producto_id, entryPortName: 'P1_horizontal', turnDirection: 'right' as const, previewLengthMm: 0, snapToAxis: false, step: 'configuringSegment' };
    expect(routingPlacementFromState(context, entrada, { ...base, sentidoVertical: null })).toBeNull();
    const pl = routingPlacementFromState(context, entrada, { ...base, sentidoVertical: 'sube' });
    expect(pl?.ok && pl.ports.find((q) => q.name === 'P2_vertical')!.normal[2]).toBeCloseTo(1, 6);
  });
});
