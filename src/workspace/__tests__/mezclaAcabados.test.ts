/**
 * Mezcla de acabados — decisión del operador (2026-11-13): se permite unir acabados
 * distintos del mismo tipo de bandeja, y el sistema lo MARCA (aviso, no invalidez).
 *
 * Control negativo: una unión de acabados distintos SIN la marca hace fallar la
 * prueba (sobre todo el catálogo, en la regla física, en la unión, en la
 * derivación y en Resultados).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../catalogPortMapping';
import { compatibilidadDirecta } from '../compatibilidadFisica';
import {
  acabadoDe, conexionesConMezcla, DECISION_MEZCLA, GRUPOS_TIPO_BANDEJA, mezclaDeAcabados, mezclasDelTrazado, mezclasDePieza, PROCEDENCIA_MEZCLA,
} from '../mezclaAcabados';
import { AVISO_MEZCLA_PREFIJO, checkConnection } from '../placement/joins';
import { definicionEfectiva, withDefinition } from '../placement/definitions';
import { placeDefinition, puertosFromWorld } from '../placement/placementCore';
import { crearEnganche } from '../derivacion/enganche';
import { extremosLibres } from '../derivacion/extremosLibres';
import { applyOperation, planAddSegment } from '../workspaceOperation';
import { checkDirectCompatibility } from '../routingRules';
import { INCUMPLIMIENTO_NO_COMPATIBLES, summarizeResult } from '../stages/resultPresentation';
import type { CatalogCompatibility, Product, TrayInput } from '../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as {
  PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[];
};
const PS = snap.PRODUCTOS;
const C = snap.COMPATIBILIDADES;
const productos = new Map(PS.map((p) => [p.producto_id, p]));
const P = (id: string) => productos.get(id)!;
const fam = (p: Product) => (p as Record<string, unknown>).familia_id as string;

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

function conTronco(productoId: string, L: number): TrayInput {
  const d = definicionEfectiva(P(productoId), { longitud_mm: L });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t = withDefinition({
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput, d.huella, d.def);
  return { ...t, piezas: [{ instancia_id: 'T', producto_id: productoId, longitud_mm: L, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion } as never] };
}

/** Continuar con un recto desde la boca P2 del tronco, por el camino normal. */
function continuar(entrada: TrayInput, pieceId: string, portName: string, productoId: string): TrayInput {
  const fp = extremosLibres(entrada).find((x) => x.pieceId === pieceId && x.portName === portName)!;
  const origen = entrada.piezas.find((p) => p.instancia_id === pieceId)!;
  const compat = checkDirectCompatibility({ compatibilidades: C, componentesUnion: [] }, P(origen.producto_id), portName, P(productoId), 'P1');
  if (!compat.ok) throw new Error(compat.reason);
  return applyOperation(entrada, planAddSegment(entrada, fp, P(productoId), compat, 1000, fp.dir), 'reject');
}

describe('mezcla de acabados — la decisión y su procedencia', () => {
  it('la procedencia es textual y no se atribuye al fabricante', () => {
    expect(PROCEDENCIA_MEZCLA).toBe('declarado por el operador, contradice REV-032 (fuente del catálogo)');
    expect(DECISION_MEZCLA.procedencia).toBe(PROCEDENCIA_MEZCLA);
    expect(`${DECISION_MEZCLA.texto} ${PROCEDENCIA_MEZCLA}`).not.toMatch(/SAMET|fabricante/i);
  });

  it('los grupos declarados son del mismo tipo constructivo y existen en el catálogo', () => {
    for (const g of GRUPOS_TIPO_BANDEJA) {
      for (const f of g.familias) expect(PS.some((p) => fam(p) === f), `${g.id}: ${f}`).toBe(true);
    }
    expect(acabadoDe(P('SAM_TRPS-050-22-ZN'))?.codigo).toBe('ZN');
    expect(acabadoDe(P('SAM_TRPS-050-22-ZB'))?.codigo).toBe('ZB');
    expect(acabadoDe(P('SAM_DCPS-100-Z'))?.codigo).toBe('Z');
    expect(acabadoDe(P('SAM_TRES-150-065-18-G'))?.codigo).toBe('G');
  });
});

describe('control negativo sobre todo el catálogo: toda unión directa entre acabados distintos lleva la marca', () => {
  it('regla física: cada par compatible de acabados distintos del mismo tipo tiene `mezcla` con los dos acabados; los de igual acabado no', () => {
    const enGrupo = PS.filter((p) => acabadoDe(p) !== null);
    let mezclas = 0;
    const sinMarca: string[] = [];
    const marcaDeMas: string[] = [];
    for (const a of enGrupo) {
      for (const b of enGrupo) {
        const r = compatibilidadDirecta(a, b, C);
        if (!r.ok) continue;
        const distintos = acabadoDe(a)!.codigo !== acabadoDe(b)!.codigo;
        if (distintos) {
          mezclas++;
          if (!r.mezcla || r.mezcla.acabadoA.codigo !== acabadoDe(a)!.codigo || r.mezcla.acabadoB.codigo !== acabadoDe(b)!.codigo) sinMarca.push(`${a.sku} ↔ ${b.sku}`);
        } else if (r.mezcla) marcaDeMas.push(`${a.sku} ↔ ${b.sku}`);
      }
    }
    expect(mezclas, 'hay pares de acabados distintos que unen').toBeGreaterThan(0);
    expect(sinMarca.slice(0, 5), `${sinMarca.length} uniones de acabados distintos sin marca`).toEqual([]);
    expect(marcaDeMas.slice(0, 5)).toEqual([]);
  });

  it('distinto tipo de bandeja NO se une (perforada ↔ escalera), con o sin mezcla', () => {
    const r = compatibilidadDirecta(P('SAM_TRPS-300-22-Z'), P('SAM_TRES-300-065-18-Z'), C);
    expect(r.ok).toBe(false);
  });
});

describe('la marca aparece en la unión, en la derivación y en Resultados', () => {
  it('unión ZN → Z por el camino normal: válida (B-3 decide) y con el aviso de mezcla nombrando los dos acabados', () => {
    const t = continuar(conTronco('SAM_TRPS-100-22-ZN', 3000), 'T', 'P2', 'SAM_TRPS-100-22-Z');
    const c = t.conexiones[0];
    const chk = checkConnection(t, c, productos)!;
    expect(chk.ok, chk.motivos.join('; ')).toBe(true);
    const aviso = chk.avisos.find((a) => a.startsWith(AVISO_MEZCLA_PREFIJO));
    expect(aviso).toBe(`mezcla de acabados: TRPS-100-22-ZN ZN (color negro) ↔ TRPS-100-22-Z Z (chapa pregalvanizada en origen) — ${PROCEDENCIA_MEZCLA}`);
    // Sin el catálogo no se puede saber el acabado: no se inventa (y la validez es la misma).
    expect(checkConnection(t, c)!.avisos.some((a) => a.startsWith(AVISO_MEZCLA_PREFIJO))).toBe(false);
    expect(mezclasDelTrazado(t, productos).map((m) => [m.tipo, m.id])).toEqual([['conexion', c.conexion_id]]);
    expect(mezclasDePieza(t, productos, 'T')).toHaveLength(1);
  });

  it('misma familia, otro color (ZN ↔ ZB) también es mezcla de acabados', () => {
    const m = mezclaDeAcabados(P('SAM_TRPS-100-22-ZN'), P('SAM_TRPS-100-22-ZB'));
    expect(m && [m.acabadoA.codigo, m.acabadoB.codigo]).toEqual(['ZN', 'ZB']);
  });

  it('derivación: la DCPS zincada sobre un tronco color se coloca (no se bloquea) y el enganche queda marcado', () => {
    const r = crearEnganche(conTronco('SAM_TRPS-300-22-ZN', 3000), productos, { tronco: 'T', desde_boca: 'P1', distancia_mm: 1500, lado: 'izquierda', ancho_mm: 100 });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.entrada.piezas.map((p) => p.producto_id)).toEqual(['SAM_TRPS-300-22-ZN', 'SAM_DCPS-100-Z']);
    const ms = mezclasDelTrazado(r.entrada, productos);
    expect(ms.map((m) => [m.tipo, m.id, m.mezcla.acabadoA.codigo, m.mezcla.acabadoB.codigo])).toEqual([['enganche', 'ENG-1', 'ZN', 'Z']]);
    expect(mezclasDePieza(r.entrada, productos, 'DER-1')).toHaveLength(1);
  });

  it('sobre un tronco zincado la DCPS zincada NO lleva marca', () => {
    const r = crearEnganche(conTronco('SAM_TRPS-300-22-Z', 3000), productos, { tronco: 'T', desde_boca: 'P1', distancia_mm: 1500, lado: 'izquierda', ancho_mm: 100 });
    if (!r.ok) throw new Error(r.motivo);
    expect(mezclasDelTrazado(r.entrada, productos)).toEqual([]);
  });

  it('Resultados: el NO_COMPATIBLE del motor por REV-032 en una mezcla marcada pasa a aviso; si no está marcada, sigue siendo incumplimiento', () => {
    const resultado = (conexiones: Record<string, unknown>) => ({
      resumen: { estado_trazado: 'CON_INCUMPLIMIENTOS', incumplimientos: [INCUMPLIMIENTO_NO_COMPATIBLES], decisiones_que_bloquean: [], verificaciones_bloqueadas: [] },
      pe: { estado_requisito: 'APROBADO' },
      conexiones,
    });
    const rev032 = { compatibilidad: { estado: 'NO_COMPATIBLE', condiciones: ['REGLA_DE_FAMILIA_REV-032'], registro: { observaciones: 'No compatible entre familias según el usuario (F-005, REV-032)' } } };
    const otra = { compatibilidad: { estado: 'NO_COMPATIBLE', condiciones: [], registro: { observaciones: 'bloqueo de catálogo' } } };

    const marcada = summarizeResult(resultado({ 'CON-1': rev032 }), new Set(['CON-1']))!;
    expect(marcada.designIssues).toEqual([]);
    expect(marcada.mezclaNotes).toEqual(['CON-1']);
    expect(marcada.headline).toBe('Preseleccion condicionada');

    // Control negativo: la misma unión SIN marca de mezcla sigue siendo incumplimiento.
    const sinMarca = summarizeResult(resultado({ 'CON-1': rev032 }), new Set())!;
    expect(sinMarca.designIssues).toEqual([INCUMPLIMIENTO_NO_COMPATIBLES]);
    expect(sinMarca.mezclaNotes).toEqual([]);
    expect(sinMarca.headline).toBe('Con incumplimientos');

    // Otra NO_COMPATIBLE que no es REV-032: el incumplimiento se mantiene.
    const mixta = summarizeResult(resultado({ 'CON-1': rev032, 'CON-2': otra }), new Set(['CON-1', 'CON-2']))!;
    expect(mixta.designIssues).toEqual([INCUMPLIMIENTO_NO_COMPATIBLES]);
  });

  it('conexionesConMezcla toma sólo uniones (no enganches) para leer el resultado del motor', () => {
    const t = continuar(conTronco('SAM_TRPS-100-22-ZN', 3000), 'T', 'P2', 'SAM_TRPS-100-22-Z');
    expect([...conexionesConMezcla(t, productos)]).toEqual([t.conexiones[0].conexion_id]);
  });
});
