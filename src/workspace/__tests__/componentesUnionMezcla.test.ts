/**
 * Componentes de unión de las mezclas de acabados, agregados por la app.
 *
 * Verificación sobre el catálogo (vale más que una regla): toda unión de escalera
 * (SAM-STE-G, SAM-STE-Z) termina con JB-CC-3/8 y toda unión de perforada
 * (SAM-STP-Z, SAM-STP-ZN) con JB-CC-M6. Falla si una línea agregada trae el juego
 * equivocado.
 * Controles negativos: una NO_COMPATIBLE que no es mezcla marcada no se completa;
 * una línea agregada sin su marca de procedencia falla.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compatibilidadDirecta } from '../compatibilidadFisica';
import { acabadoDe, grupoDe } from '../mezclaAcabados';
import {
  completarComponentesMezclas, PROCEDENCIA_COMPONENTES_MEZCLA, problemasDeAgregadas, type ComponenteUnion, type LineaAgregadaApp,
} from '../componentesUnionMezcla';
import type { CatalogCompatibility, Product, TrayInput } from '../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as {
  PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[]; COMPONENTES_UNION: ComponenteUnion[];
};
const PS = snap.PRODUCTOS;
const productos = new Map(PS.map((p) => [p.producto_id, p]));
const JUEGO: Record<string, string> = { 'perforada-smarttray': 'SAM_JB-CC-M6', 'escalera-smarttray': 'SAM_JB-CC-3_8' };

/** Trazado mínimo con una conexión A↔B y el resultado del motor que la deja sin componentes. */
function caso(a: string, b: string, estado: 'bloqueada' | 'no_documentada' = 'bloqueada') {
  const entrada = {
    piezas: [{ instancia_id: 'A', producto_id: a, puertos: {} }, { instancia_id: 'B', producto_id: b, puertos: {} }],
    conexiones: [{ conexion_id: 'K', a: ['A', 'P2'], b: ['B', 'P1'] }],
  } as unknown as TrayInput;
  const result = { computo: { lineas: [{ producto_id: null, cantidad: null, estado_cantidad: estado, origen: { conexion: 'K' } }] } };
  return completarComponentesMezclas(result, entrada, productos, snap.COMPATIBILIDADES, snap.COMPONENTES_UNION);
}

describe('verificación sobre el catálogo: el juego de cada unión mezclada', () => {
  it('toda unión mezclada que la app completa trae JB-CC-M6 (perforada) o JB-CC-3/8 (escalera), con su marca', () => {
    const enGrupo = PS.filter((p) => acabadoDe(p));
    // Una combinación por (tipo de bandeja, ancho, ala, tipos de pieza, acabados): la fila elegida depende sólo de eso.
    const vistos = new Set<string>();
    let completadas = 0;
    const malas: string[] = [];
    const sinCompletar: string[] = [];
    for (const a of enGrupo) {
      for (const b of enGrupo) {
        const k = [grupoDe(a)!.id, a.ancho_nominal_mm, (a as Record<string, unknown>).ala_nominal_mm, a.tipo_pieza, b.tipo_pieza, acabadoDe(a)!.codigo, acabadoDe(b)!.codigo].join('|');
        if (vistos.has(k)) continue;
        const r = compatibilidadDirecta(a, b, snap.COMPATIBILIDADES);
        if (!r.ok || !r.mezcla) continue;
        vistos.add(k);
        const c = caso(a.producto_id, b.producto_id);
        if (!c.agregadas.length) { sinCompletar.push(`${a.sku} ↔ ${b.sku}`); continue; }
        completadas++;
        for (const l of c.agregadas) {
          if (l.producto_id !== JUEGO[grupoDe(a)!.id]) malas.push(`${a.sku} ↔ ${b.sku}: ${l.producto_id} (${l.origen.compatibilidad})`);
        }
        expect(problemasDeAgregadas(c.agregadas, new Set(['K']))).toEqual([]);
      }
    }
    expect(completadas, `combinaciones completadas (${sinCompletar.length} sin fila del mismo acabado)`).toBeGreaterThan(0);
    expect(malas.slice(0, 5), `${malas.length} líneas con el juego equivocado`).toEqual([]);
  });

  it('perforada Z ↔ ZN: JB-CC-M6 copiado tal cual (2 juegos), marcado como agregado por la app', () => {
    const c = caso('SAM_TRPS-100-22-ZN', 'SAM_TRPS-100-22-Z');
    expect(c.completadas).toEqual(['K']);
    expect(c.sinComponentes).toEqual([]);
    expect(c.agregadas).toHaveLength(1);
    expect(c.agregadas[0]).toMatchObject({
      producto_id: 'SAM_JB-CC-M6', cantidad: 2, unidad: 'juego', agregada_por_app: true, procedencia: PROCEDENCIA_COMPONENTES_MEZCLA,
    });
    expect(PROCEDENCIA_COMPONENTES_MEZCLA).toBe('unión entre acabados distintos, componentes tomados de la unión del mismo acabado; declarado por el operador');
    // La fila de origen es una unión del MISMO acabado.
    const fila = snap.COMPATIBILIDADES.find((x) => x.compatibilidad_id === c.agregadas[0].origen.compatibilidad)!;
    expect(acabadoDe(productos.get(fila.producto_a_id))?.codigo).toBe(acabadoDe(productos.get(fila.producto_b_id!))?.codigo);
  });

  it('escalera G ↔ Z: JB-CC-3/8', () => {
    const c = caso('SAM_TRES-300-065-18-G', 'SAM_TRES-300-065-18-Z');
    expect(c.agregadas.map((l) => l.producto_id)).toEqual(['SAM_JB-CC-3_8']);
  });
});

describe('controles negativos', () => {
  it('una NO_COMPATIBLE que NO es mezcla marcada no se completa: queda sin componentes, como antes', () => {
    // Perforada ↔ escalera: distinto tipo de bandeja, no es mezcla.
    const c = caso('SAM_TRPS-300-22-Z', 'SAM_TRES-300-065-18-Z');
    expect(c.agregadas).toEqual([]);
    expect(c.sinComponentes).toEqual(['K']);
  });

  it('una línea agregada sobre una conexión que no es mezcla marcada, o sin su marca de procedencia, falla el control', () => {
    const buena = caso('SAM_TRPS-100-22-ZN', 'SAM_TRPS-100-22-Z').agregadas[0];
    expect(problemasDeAgregadas([buena], new Set(['K']))).toEqual([]);
    expect(problemasDeAgregadas([buena], new Set())).toEqual(['K: se completaron componentes de una conexión que no es mezcla marcada']);
    const sinMarca = { ...buena, procedencia: '' } as LineaAgregadaApp;
    expect(problemasDeAgregadas([sinMarca], new Set(['K']))).toEqual(['K: línea agregada sin su marca de procedencia']);
    const sinBandera = { ...buena, agregada_por_app: undefined } as unknown as LineaAgregadaApp;
    expect(problemasDeAgregadas([sinBandera], new Set(['K']))).toEqual(['K: línea agregada sin su marca de procedencia']);
  });

  it('un proyecto sin mezclas no tiene ninguna línea agregada', () => {
    const c = caso('SAM_TRPS-100-22-Z', 'SAM_TRPS-100-22-Z', 'no_documentada');
    expect(c.agregadas).toEqual([]);
    expect(completarComponentesMezclas({ computo: { lineas: [] } }, { piezas: [], conexiones: [] } as unknown as TrayInput, productos, snap.COMPATIBILIDADES, snap.COMPONENTES_UNION).agregadas).toEqual([]);
  });
});
