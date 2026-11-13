/**
 * Cómputo de las curvas ESLABONADAS (EPS perforada, CUS escalera).
 *
 * El motor (vendorizado, no se toca) computa "D-18: 1 pieza comercial por
 * instancia": una curva eslabonada contaría 1. La regla del operador (2026-11-13):
 *   - perforada: la EPS se vende POR ESLABÓN → una curva de N eslabones son N × EPS;
 *   - escalera: cada código CUS trae 5 eslabones (el "5" del código), y los
 *     eslabones son idénticos entre curvas → se SUMAN los eslabones de todo el
 *     proyecto por combinación (ancho, ala, espesor, acabado — es decir, por
 *     código) y recién ahí se divide por 5 redondeando hacia arriba. Redondear
 *     curva por curva sobrecompra (cuatro curvas de 45° = 12 eslabones = 3
 *     códigos, no 4).
 * En Resultados se ven las dos cosas: los eslabones por curva y los códigos a comprar.
 */
import type { Product, TrayInput } from '../tray/model';
import { placedOf } from './placement/definitions';
import { PATRONES_CURVA_ESLABONADA } from './placement/longitudesEje';
import { medidasEslabonada } from '../parametric/reglaEslabones';

export interface CurvaEslabonada {
  readonly pieza: string;
  readonly producto_id: string;
  readonly sku: string;
  readonly sistema: 'perforada' | 'escalera';
  readonly anguloDeg: number;
  readonly eslabones: number;
  readonly longitudEjeMm: number;
}

export interface LineaCompraEslabones {
  readonly producto_id: string;
  readonly sku: string;
  readonly sistema: 'perforada' | 'escalera';
  /** Eslabones de todas las curvas de este código. */
  readonly eslabones: number;
  /** Eslabones que trae cada código (EPS: 1; CUS: el número del código, 5). */
  readonly eslabonesPorCodigo: number;
  /** Códigos a comprar: techo(eslabones / eslabonesPorCodigo). */
  readonly codigos: number;
  readonly curvas: readonly string[];
  readonly regla: string;
}

/** Eslabones que trae un código: EPS = 1 (se vende por eslabón); CUS-{ancho}-{n}-… = n. */
export function eslabonesPorCodigo(sku: string): number {
  if (/^EPS-/.test(sku)) return 1;
  const m = /^CUS-\d+-(\d+)-/.exec(sku);
  if (m) return Number(m[1]);
  throw new Error(`no se sabe cuántos eslabones trae ${sku}`);
}

/** Curvas eslabonadas del trazado con sus eslabones (de la definición guardada de cada instancia). */
export function curvasEslabonadas(entrada: TrayInput | null | undefined, productos: ReadonlyMap<string, Product>): CurvaEslabonada[] {
  if (!entrada) return [];
  const out: CurvaEslabonada[] = [];
  for (const p of entrada.piezas) {
    const placed = placedOf(entrada, p);
    if (!placed || !PATRONES_CURVA_ESLABONADA.has(placed.def.patron)) continue;
    const ancho = placed.def.params.ancho_mm;
    const ang = placed.def.params.angulo_deg;
    if (typeof ancho !== 'number' || typeof ang !== 'number') continue;
    const m = medidasEslabonada(ancho, ang);
    out.push({
      pieza: p.instancia_id,
      producto_id: p.producto_id,
      sku: String(productos.get(p.producto_id)?.sku ?? p.producto_id),
      sistema: placed.def.patron.startsWith('master:escalera:') ? 'escalera' : 'perforada',
      anguloDeg: ang,
      eslabones: m.eslabones,
      longitudEjeMm: m.longitudEjeMm,
    });
  }
  return out;
}

/** Códigos a comprar: se suman los eslabones por código en TODO el proyecto y recién ahí se redondea. */
export function compraEslabones(curvas: readonly CurvaEslabonada[]): LineaCompraEslabones[] {
  const grupos = new Map<string, CurvaEslabonada[]>();
  for (const c of curvas) (grupos.get(c.producto_id) ?? grupos.set(c.producto_id, []).get(c.producto_id)!).push(c);
  return [...grupos.values()].map((cs) => {
    const { producto_id, sku, sistema } = cs[0];
    const porCodigo = eslabonesPorCodigo(sku);
    const eslabones = cs.reduce((s, c) => s + c.eslabones, 0);
    return {
      producto_id, sku, sistema, eslabones, eslabonesPorCodigo: porCodigo,
      codigos: Math.ceil(eslabones / porCodigo),
      curvas: cs.map((c) => c.pieza),
      regla: porCodigo === 1
        ? `por eslabón: ${cs.map((c) => c.eslabones).join(' + ')} = ${eslabones} × ${sku}`
        : `${eslabones} eslabones en ${cs.length} curva(s) (${cs.map((c) => c.eslabones).join(' + ')}); cada código trae ${porCodigo} → techo(${eslabones}/${porCodigo}) = ${Math.ceil(eslabones / porCodigo)}`,
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku));
}
