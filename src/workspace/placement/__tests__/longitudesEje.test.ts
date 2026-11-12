/**
 * Longitudes de eje guardadas al colocar, sobre TODO el catálogo.
 *
 * Para cada familia con regla, la longitud que queda persistida en la pieza
 * (por `conLongitudesEje`, la misma función que usa la colocación real) se
 * contrasta con magnitudes del modelo medido calculadas aparte:
 *
 *   - T y X: el tronco (bocas opuestas) mide la distancia entre sus bocas; la
 *     derivación mide (distancia de la boca de entrada al pie de la
 *     perpendicular desde la boca de derivación sobre el eje del tronco) +
 *     (distancia de la boca de derivación a ese eje). Tolerancia: la de
 *     equivalencia geométrica de las fuentes — 0,01 mm × ancho/300 en posición
 *     y 0,01° en dirección, que sobre el brazo de la pieza da L·tan(0,01°) —
 *     más el desvío del centro común informado en la procedencia.
 *   - Curva vertical: la línea media empieza y termina en el centro de cada boca
 *     (0,01 mm, redondeo de la transcripción), sus tramos extremos siguen la
 *     normal de cada boca, y su longitud queda entre la cuerda y la suma de las
 *     distancias a la intersección de las tangentes.
 *
 * Familias sin regla: siguen sin longitud (null con motivo). Control negativo:
 * una pieza colocada sin aplicar la regla no tiene longitudes guardadas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../catalogPortMapping';
import { definicionEfectiva } from '../definitions';
import { TOL_GEOM_DEG, tolGeomMm } from '../geometriaEquivalente';
import { claveTramo, conLongitudesEje, longitudesDeEje, PATRONES_CURVA_VERTICAL, TOL_EXTREMO_MM } from '../longitudesEje';
import { lineaMediaPerfilCUPS } from '../../../parametric/geometry/outlines';
import { placeDefinition, puertosFromWorld, type ColocacionResuelta, type DefPort } from '../placementCore';
import { updateOutdatedPieces, withDefinition } from '../definitions';
import type { Piece, Product, TrayInput } from '../../../tray/model';

const snapshot = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[] };

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

type V = readonly number[];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V) => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Pieza colocada como en el espacio de trabajo y con la regla aplicada. */
function colocada(p: Product) {
  const d = definicionEfectiva(p, { longitud_mm: 1000 });
  if (!d.ok) return null;
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: d.def.ports[0].name, startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const pieza = conLongitudesEje({ instancia_id: 'X', producto_id: p.producto_id, puertos: {}, colocacion: pl.colocacion } as { instancia_id: string; producto_id: string; puertos: object; colocacion: typeof pl.colocacion; longitud_eje_mm?: number }, d.def);
  return { def: d.def, pieza };
}

const FAMILIAS_CON_REGLA = (tipo: string) => tipo === 'T' || tipo === 'X' || tipo.startsWith('curva vertical');

describe('longitudes de eje guardadas al colocar — catálogo completo', () => {
  it('T y X: tronco = distancia entre bocas opuestas; derivación = semieje por el pie de la perpendicular + distancia al eje', () => {
    let piezas = 0;
    let pares = 0;
    for (const p of snapshot.PRODUCTOS.filter((x) => x.tipo_pieza === 'T' || x.tipo_pieza === 'X')) {
      const r = colocada(p);
      if (!r) continue;
      // La DCPS es tipo "T" en el catálogo pero es la derivación lateral de una sola boca:
      // su longitud la aporta el enganche (profundidad), no el centro de una T.
      if (r.def.ports.length < 3) continue;
      piezas++;
      const L = r.pieza.colocacion.longitudes_eje;
      expect(L, p.producto_id).toBeDefined();
      const desvio = Number(/desvío ([\d.]+) mm/.exec(Object.values(L!)[0].procedencia)![1]);
      // Posición (0,01 mm × ancho/300) + dirección (0,01°: la normal de una boca
      // medida puede inclinarse así, p. ej. las del tronco de la TPS, 0,0097°)
      // sobre el brazo, + el desvío del centro común.
      const brazo = Math.max(...r.def.ports.map((q) => len(q.center)));
      const tol = tolGeomMm(r.def) + brazo * Math.tan((TOL_GEOM_DEG * Math.PI) / 180) + 2 * desvio;
      const ports = r.def.ports;
      const opuestas = (a: DefPort, b: DefPort) => dot(unit(a.normal), unit(b.normal)) < -0.9999;
      for (let i = 0; i < ports.length; i++) {
        for (let j = i + 1; j < ports.length; j++) {
          const [a, b] = [ports[i], ports[j]];
          const guardada = L![claveTramo(a.name, b.name)].mm;
          let esperada: number;
          if (opuestas(a, b)) {
            esperada = len(sub(b.center, a.center));
          } else {
            // b es una derivación respecto del eje de a (recta por a según su normal).
            const n = unit(a.normal);
            const t = dot(sub(b.center, a.center), n);
            const pie = [a.center[0] + t * n[0], a.center[1] + t * n[1], a.center[2] + t * n[2]];
            esperada = Math.abs(t) + len(sub(b.center, pie));
          }
          expect(Math.abs(guardada - esperada), `${p.producto_id} ${a.name}→${b.name}: ${guardada} vs ${esperada}`).toBeLessThanOrEqual(tol);
          pares++;
        }
      }
    }
    expect(piezas).toBe(108); // TS 40 + XS 40 + TPS 21 + XPS 7 (las T/X sin modelo no se colocan; la DCPS es derivación lateral de una boca)
    expect(pares).toBeGreaterThan(400);
  });

  it('curva vertical: la línea media va de centro de boca a centro de boca, sale por las normales y queda entre la cuerda y las tangentes', () => {
    const linea = lineaMediaPerfilCUPS();
    let piezas = 0;
    for (const p of snapshot.PRODUCTOS.filter((x) => String(x.tipo_pieza).startsWith('curva vertical'))) {
      const r = colocada(p);
      if (!r) continue;
      piezas++;
      expect(PATRONES_CURVA_VERTICAL.has(r.def.patron), p.producto_id).toBe(true);
      const h = r.def.ports.find((q) => q.name === 'P1_horizontal')!;
      const v = r.def.ports.find((q) => q.name === 'P2_vertical')!;
      const guardada = r.pieza.colocacion.longitudes_eje![claveTramo(h.name, v.name)];
      expect(guardada.regla).toBe('linea_media_perfil');
      expect(r.pieza.longitud_eje_mm).toBe(guardada.mm);
      const [ini, fin] = [linea.puntos[0], linea.puntos[linea.puntos.length - 1]];
      expect(Math.hypot(h.center[0] - ini[0], h.center[1] - ini[1])).toBeLessThanOrEqual(TOL_EXTREMO_MM);
      expect(Math.hypot(v.center[0] - fin[0], v.center[1] - fin[1])).toBeLessThanOrEqual(TOL_EXTREMO_MM);
      // Tramos extremos sobre las normales (hacia adentro de la pieza).
      const s0 = unit([linea.puntos[1][0] - ini[0], linea.puntos[1][1] - ini[1], 0]);
      const sN = unit([fin[0] - linea.puntos[linea.puntos.length - 2][0], fin[1] - linea.puntos[linea.puntos.length - 2][1], 0]);
      expect(dot(s0, unit(h.normal.map((x) => -x)))).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180));
      expect(dot(sN, unit(v.normal))).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180));
      // Entre la cuerda y la suma de tangentes (intersección de los ejes de las bocas).
      const cuerda = len(sub(v.center, h.center));
      const t1 = v.center[0] - h.center[0];
      const t2 = h.center[1] - v.center[1];
      expect(guardada.mm).toBeGreaterThan(cuerda);
      expect(guardada.mm).toBeLessThan(t1 + t2);
    }
    expect(piezas).toBe(54); // CUPS-A 7 + CUPS-D 7 + CUS 40
    expect(linea.longitud_mm).toBeCloseTo(227.588, 3);
  });

  it('familias sin regla: sin longitud y con motivo (las T, X y curvas verticales sin modelo no tienen definición)', () => {
    const sinModelo = snapshot.PRODUCTOS.filter((x) => FAMILIAS_CON_REGLA(String(x.tipo_pieza)) && !definicionEfectiva(x).ok);
    expect(sinModelo.length).toBeGreaterThan(0);
    for (const p of sinModelo) expect(colocada(p), p.producto_id).toBeNull();
    // Patrones con definición pero sin regla (rectos, curvas horizontales): null con motivo;
    // su longitud se guarda por otros campos (longitud_mm, longitud_eje_mm).
    const recto = definicionEfectiva(snapshot.PRODUCTOS.find((x) => x.producto_id === 'SAM_TRPS-300-22-Z')!, { longitud_mm: 1000 });
    if (!recto.ok) throw new Error(recto.motivo);
    expect(longitudesDeEje(recto.def)).toEqual({ ok: false, motivo: 'sin regla de longitud de eje para el patrón master:perforada:tramo_recto' });
  });

  it('actualizar una pieza desactualizada recalcula sus longitudes con la definición vigente', () => {
    const p = snapshot.PRODUCTOS.find((x) => x.producto_id === 'SAM_TPS-300-Z')!;
    const d = definicionEfectiva(p);
    if (!d.ok) throw new Error(d.motivo);
    // Definición guardada "vieja": la boca de derivación 2 mm más afuera.
    const vieja = { ...d.def, ports: d.def.ports.map((q) => (q.name === 'boca_derivacion' ? { ...q, center: [q.center[0], q.center[1], q.center[2] + 2] as [number, number, number] } : q)) };
    const pl = placeDefinition({ def: vieja, huella: 'vieja', mano: 'nativa', entryPortName: 'tronco_P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    const pieza = conLongitudesEje({ instancia_id: 'T', producto_id: p.producto_id, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as Piece, vieja);
    const antes = (pieza.colocacion as ColocacionResuelta).longitudes_eje![claveTramo('boca_derivacion', 'tronco_P1')].mm;
    const entrada = withDefinition({
      version_contrato: 'trazado/1', piezas: [pieza], conexiones: [], circuitos: [], soportes: [],
      pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
    } as TrayInput, 'vieja', vieja);
    const { entrada: nueva, updated } = updateOutdatedPieces(entrada, new Map([[p.producto_id, p]]));
    expect(updated).toEqual(['T']);
    const despues = (nueva.piezas[0].colocacion as ColocacionResuelta).longitudes_eje![claveTramo('boca_derivacion', 'tronco_P1')].mm;
    const vigente = longitudesDeEje(d.def);
    expect(vigente.ok && despues).toBe(vigente.ok && vigente.longitudes[claveTramo('boca_derivacion', 'tronco_P1')].mm);
    expect(antes - despues).toBeCloseTo(2, 6);
  });

  it('control negativo: colocada sin aplicar la regla no guarda longitudes', () => {
    const p = snapshot.PRODUCTOS.find((x) => x.producto_id === 'SAM_TPS-300-Z')!;
    const d = definicionEfectiva(p);
    if (!d.ok) throw new Error(d.motivo);
    const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'tronco_P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
    expect(pl.colocacion.longitudes_eje).toBeUndefined();
  });
});
