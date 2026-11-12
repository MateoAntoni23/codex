/**
 * B-3 — cuarta condición de unión: la sección (ancho de boca y ala).
 *
 *   PB6. Unir un recto de 300 con uno de 450: inválida por ancho. Unir un recto
 *        con una CUPS: válida con aviso de ala.
 *   - Alas distintas declaradas por el catálogo: inválida.
 *   - Sin definición: ancho/ala "no verificable" (aviso), no se inventa.
 *   - Derivación de la tolerancia de ancho recalculada sobre todo el catálogo.
 *
 * Todo pasa por el camino real: definición efectiva → colocación → trazado con
 * la tabla de definiciones → checkConnection / avisosDeModelo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../definitions';
import { avisosDeModelo, checkConnection, desvioAnchoMm, DESVIO_ANCHO_ABSOLUTO_MM, DESVIO_ANCHO_RELATIVO, tolAnchoMm } from '../joins';
import { placeDefinition, puertosFromWorld, type V3, type WorldPort } from '../placementCore';
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

function vacia(): TrayInput {
  return {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as TrayInput;
}

/** Coloca `productoId` entrando por `entrada` en la boca `en` (o en el origen) y la agrega al trazado. */
function colocar(
  t: TrayInput, id: string, productoId: string, entrada: string,
  en?: WorldPort, opts: { sinDefinicion?: boolean } = {},
): { t: TrayInput; ports: WorldPort[] } {
  const d = definicionEfectiva(productos.get(productoId)!, { longitud_mm: 1000 });
  if (!d.ok) throw new Error(`${productoId}: ${d.motivo}`);
  const pl = placeDefinition({
    def: d.def, huella: d.huella, mano: 'nativa', entryPortName: entrada,
    startPos: en ? en.pos : [0, 0, 0], entryDir: en ? en.normal : [1, 0, 0], sectionUp: (en ? en.vDir : [0, 0, 1]) as V3,
  });
  const pieza = {
    instancia_id: id, producto_id: productoId, longitud_mm: 1000,
    puertos: puertosFromWorld(pl.ports),
    ...(opts.sinDefinicion ? {} : { colocacion: pl.colocacion }),
  };
  const next = opts.sinDefinicion ? { ...t } : withDefinition(t, d.huella, d.def);
  return { t: { ...next, piezas: [...next.piezas, pieza as never] }, ports: pl.ports };
}

function unir(t: TrayInput, a: [string, string], b: [string, string]) {
  return checkConnection(t, { a, b })!;
}

function cadena(a: string, salida: string, b: string, entrada: string, opts: { sinDefinicionB?: boolean } = {}) {
  const r1 = colocar(vacia(), 'A', a, a.includes('CUPS') ? 'P2_vertical' : 'P1');
  const boca = r1.ports.find((p) => p.name === salida)!;
  const r2 = colocar(r1.t, 'B', b, entrada, boca, { sinDefinicion: opts.sinDefinicionB });
  return { t: r2.t, chk: unir(r2.t, ['A', salida], ['B', entrada]) };
}

describe('B-3 — sección en las uniones', () => {
  it('PB6: recto 300 con recto 450 → inválida por ancho (posición, ángulo y giro cumplen)', () => {
    const { chk } = cadena('SAM_TRPS-300-22-Z', 'P2', 'SAM_TRPS-450-20-Z', 'P1');
    expect(chk.huecoMm).toBeLessThan(1e-6);
    expect(chk.anguloDeg).toBeLessThan(1e-6);
    expect(chk.giroDeg!).toBeLessThan(1e-6);
    expect(chk.ok).toBe(false);
    expect(chk.motivos).toEqual([expect.stringMatching(/^ancho de boca 300 mm ≠ 450 mm/)]);
  });

  it('PB6: recto con CUPS → válida, con aviso de ala del modelo; el aviso está en la ficha y en Resultados', () => {
    const { t, chk } = cadena('SAM_TRPS-300-22-Z', 'P2', 'SAM_CUPS-300-A-Z', 'P1_horizontal');
    expect(chk.ok, chk.motivos.join('; ')).toBe(true);
    expect(chk.avisos).toContain('ala (boca B): la boca del modelo mide 36.56 mm de ala y el catálogo declara 50 mm');
    // La misma fuente alimenta la ficha de la pieza y la lista de Resultados.
    const cups = t.piezas.find((p) => p.instancia_id === 'B')!;
    expect(avisosDeModelo(t, cups)).toEqual([
      'P1_horizontal: la boca del modelo mide 36.56 mm de ala y el catálogo declara 50 mm',
      'P2_vertical: la boca del modelo mide 36.56 mm de ala y el catálogo declara 50 mm',
    ]);
    expect(avisosDeModelo(t, t.piezas.find((p) => p.instancia_id === 'A')!)).toEqual([]);
  });

  it('regresión de la cadena del operador: recto 300 con CPS-45 (boca medida 301,134) es válida', () => {
    const { chk } = cadena('SAM_TRPS-300-22-Z', 'P2', 'SAM_CPS-300-45-Z', 'P1');
    expect(chk.anchosMm![1]).toBeCloseTo(301.134, 3);
    expect(chk.ok, chk.motivos.join('; ')).toBe(true);
    expect(chk.avisos).toEqual([]);
  });

  it('alas distintas declaradas por el catálogo (TRES 65 con TRES 90) → inválida', () => {
    const { chk } = cadena('SAM_TRES-300-065-18-Z', 'P2', 'SAM_TRES-300-090-18-Z', 'P1');
    expect(chk.ok).toBe(false);
    expect(chk.motivos).toEqual(['alas distintas en el catálogo: 65 mm ≠ 90 mm']);
  });

  it('pieza sin definición guardada → ancho y ala "no verificable", sin invalidar', () => {
    const { chk } = cadena('SAM_TRPS-300-22-Z', 'P2', 'SAM_TRPS-300-22-Z', 'P1', { sinDefinicionB: true });
    expect(chk.ok).toBe(true);
    expect(chk.avisos).toEqual([
      'ancho no verificable: una de las bocas no tiene definición',
      'ala no verificable: el catálogo no declara el ala de una de las piezas',
    ]);
  });

  it('derivación: ninguna boca medida se aparta del nominal más que max(0,379 %, 1,32 mm), y la tolerancia discrimina anchos vecinos', () => {
    let peorRel = 0;
    let peorAbsNoProporcional = 0;
    let con = 0;
    for (const p of snapshot.PRODUCTOS) {
      const d = definicionEfectiva(p, { longitud_mm: 1000 });
      if (!d.ok || typeof p.ancho_nominal_mm !== 'number') continue;
      con++;
      for (const q of d.def.ports) {
        const dev = Math.abs(q.ancho_mm - p.ancho_nominal_mm);
        expect(dev, `${p.producto_id} ${q.name}: ${q.ancho_mm} vs ${p.ancho_nominal_mm}`).toBeLessThanOrEqual(desvioAnchoMm(p.ancho_nominal_mm));
        peorRel = Math.max(peorRel, dev / p.ancho_nominal_mm);
        if (dev > DESVIO_ANCHO_RELATIVO * p.ancho_nominal_mm) peorAbsNoProporcional = Math.max(peorAbsNoProporcional, dev);
      }
    }
    expect(con).toBeGreaterThan(300);
    // Los desvíos reales que fijan las constantes — si cambian, revisarlas.
    expect(peorAbsNoProporcional).toBeCloseTo(1.315, 3); // boca DCPS lateral (sobreancho fijo)
    expect(peorAbsNoProporcional).toBeLessThanOrEqual(DESVIO_ANCHO_ABSOLUTO_MM);
    expect(peorRel).toBeGreaterThan(0.0037);
    const anchos = [...new Set(snapshot.PRODUCTOS.map((p) => p.ancho_nominal_mm).filter((x): x is number => typeof x === 'number'))].sort((a, b) => a - b);
    for (let i = 1; i < anchos.length; i++) {
      const [a, b] = [anchos[i - 1], anchos[i]];
      // Peor caso: la boca de a medida hacia arriba y la de b hacia abajo.
      const separacion = (b - desvioAnchoMm(b)) - (a + desvioAnchoMm(a));
      expect(separacion, `${a} → ${b}`).toBeGreaterThan(tolAnchoMm(a, b));
    }
  });
});
