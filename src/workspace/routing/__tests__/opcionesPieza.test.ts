/**
 * Selector de pieza en tres pasos (A2): agrupación tipo → ancho → variante, con
 * espesor y acabado dentro; por defecto los del origen; mezcla; tipos ausentes con motivo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compatiblesDirectos } from '../../compatibilidadFisica';
import { isWalkable } from '../../pieceClassification';
import { esDerivacionLateral } from '../../continuationCandidates';
import { mezclaDeAcabados } from '../../mezclaAcabados';
import { acabadosDe, agruparCandidatos, espesoresDe, porDefecto, productoDe, tiposAusentes, type Candidato } from '../opcionesPieza';
import type { CatalogCompatibility, Product } from '../../../tray/model';

const snap = JSON.parse(readFileSync(resolve(__dirname, '../../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[] };
const P = new Map(snap.PRODUCTOS.map((p) => [p.producto_id, p]));
const candidatosDe = (origenId: string): Candidato[] => {
  const ids = compatiblesDirectos(P.get(origenId)!, snap.PRODUCTOS, snap.COMPATIBILIDADES);
  return snap.PRODUCTOS.filter((p) => ids.has(p.producto_id) && isWalkable(p) && !esDerivacionLateral(p)).map((product) => ({ product }));
};

describe('selector de pieza en tres pasos', () => {
  it('las piezas que sólo difieren en acabado son UNA variante; el código exacto sale de espesor + acabado', () => {
    const origen = P.get('SAM_TRPS-300-22-Z')!;
    const tipos = agruparCandidatos(candidatosDe(origen.producto_id), origen);
    const recto = tipos.find((t) => t.clave === 'recta')!;
    expect(recto.texto).toBe('Recto');
    const a300 = recto.anchos.find((a) => a.ancho === 300)!;
    const trps = a300.variantes.find((v) => v.texto.startsWith('TRPS'))!;
    // Z, ZN y ZB: una sola entrada.
    expect(trps.candidatos.map((c) => c.product.sku).sort()).toEqual(['TRPS-300-22-Z', 'TRPS-300-22-ZB', 'TRPS-300-22-ZN']);
    expect(espesoresDe(trps)).toEqual([0.71]);
    expect(acabadosDe(trps, 0.71)).toEqual(['Z', 'ZB', 'ZN']);
    expect(productoDe(trps, 0.71, 'ZN')!.product.sku).toBe('TRPS-300-22-ZN');
  });

  it('por defecto queda el espesor y el acabado de la pieza de origen', () => {
    for (const [origenId, acabado] of [['SAM_TRPS-300-22-Z', 'Z'], ['SAM_TRPS-300-22-ZN', 'ZN']] as const) {
      const origen = P.get(origenId)!;
      const v = agruparCandidatos(candidatosDe(origenId), origen).find((t) => t.clave === 'recta')!.anchos.find((a) => a.ancho === 300)!
        .variantes.find((x) => x.texto.startsWith('TRPS'))!;
      expect(porDefecto(v, origen)).toEqual({ espesor: 0.71, acabado });
    }
  });

  it('la mezcla de acabados se conoce antes de confirmar (en el selector)', () => {
    const origen = P.get('SAM_TRPS-300-22-Z')!;
    const v = agruparCandidatos(candidatosDe(origen.producto_id), origen).find((t) => t.clave === 'recta')!.anchos.find((a) => a.ancho === 300)!
      .variantes.find((x) => x.texto.startsWith('TRPS'))!;
    expect(mezclaDeAcabados(origen, productoDe(v, 0.71, 'Z')!.product)).toBeNull();
    expect(mezclaDeAcabados(origen, productoDe(v, 0.71, 'ZN')!.product)).not.toBeNull();
  });

  it('desde la familia color, la curva vertical se ofrece sólo en otro acabado (mezcla), marcada', () => {
    const origen = P.get('SAM_TRPS-300-22-ZN')!;
    const tipos = agruparCandidatos(candidatosDe(origen.producto_id), origen);
    const vertical = tipos.filter((t) => t.clave.startsWith('curva vertical') && t.clave !== 'curva vertical articulada');
    expect(vertical.length).toBeGreaterThan(0);
    expect(vertical.every((t) => t.soloOtroAcabado)).toBe(true);
    expect(tipos.find((t) => t.clave === 'recta')!.soloOtroAcabado).toBe(false);
  });

  it('los tipos que no se ofrecen se listan con el motivo: nunca vacío sin explicación', () => {
    const origen = P.get('SAM_TRPS-300-22-Z')!;
    const sinNada = tiposAusentes([], origen, snap.PRODUCTOS, []);
    expect(sinNada.length).toBeGreaterThan(0);
    expect(sinNada.every((x) => x.motivo.length > 0)).toBe(true);
    const tipos = agruparCandidatos(candidatosDe(origen.producto_id), origen);
    const aus = tiposAusentes(tipos, origen, snap.PRODUCTOS, []);
    // Lo que se ofrece no aparece como ausente.
    for (const t of tipos) expect(aus.some((x) => x.tipo === t.clave)).toBe(false);
    for (const x of aus) expect(x.motivo).toMatch(/no existe en|no hay de|ninguna es compatible|no tiene modelo/);
  });
});
