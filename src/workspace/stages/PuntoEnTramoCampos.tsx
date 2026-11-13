/**
 * Campos para elegir un punto sobre un tramo recto: tramo, distancia desde una
 * de sus bocas y lado. Los usan la derivación en un tramo (`DerivacionSection`)
 * y el enlace de un equipo con la bandeja (`BajadasSection`): la misma elección,
 * la misma maquinaria (`derivacion/enganche.ts` → `geometriaPuntoEnTramo`).
 *
 * Los data-testid llevan el prefijo de cada formulario (`der-tronco`,
 * `baj-tronco`, …).
 */
import { useMemo } from 'react';
import { useTrayStore } from '../../tray/store';
import type { Piece, Product } from '../../tray/model';
import type { Lado } from '../derivacion/enganche';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';

export interface ValorPuntoEnTramo {
  readonly tronco: string;
  readonly desde: string;
  readonly distancia: string;
  readonly lado: Lado;
}

/** Tramos rectos del trazado (con largo): los únicos sobre los que se elige un punto. */
export function troncosElegibles(piezas: readonly Piece[], productos: ReadonlyMap<string, Product>): Piece[] {
  return piezas.filter((p) => productos.get(p.producto_id)?.tipo_pieza === 'recta' && typeof p.longitud_mm === 'number');
}

export function PuntoEnTramoCampos({ prefijo, etiquetaTramo, valor, onChange }: {
  prefijo: string;
  etiquetaTramo: string;
  valor: ValorPuntoEnTramo;
  onChange: (v: ValorPuntoEnTramo) => void;
}) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const piezas = entrada?.piezas ?? [];
  const troncos = troncosElegibles(piezas, productos);
  const t = troncos.find((p) => p.instancia_id === valor.tronco);
  const set = (x: Partial<ValorPuntoEnTramo>) => onChange({ ...valor, ...x });
  return (
    <>
      <label className="stage-field">
        {etiquetaTramo}
        <select className="inspector-input" data-testid={`${prefijo}-tronco`} value={valor.tronco} onChange={(e) => set({ tronco: e.target.value })}>
          <option value="">Elegí un tramo recto…</option>
          {troncos.map((p) => <option key={p.instancia_id} value={p.instancia_id}>{pieceLabelById(p.instancia_id, piezas, idx)} · {p.longitud_mm} mm</option>)}
        </select>
      </label>
      <label className="stage-field">
        Distancia desde la boca
        <span style={{ display: 'flex', gap: 6 }}>
          <select className="inspector-input" data-testid={`${prefijo}-desde`} value={valor.desde} onChange={(e) => set({ desde: e.target.value })}>
            {['P1', 'P2'].map((b) => <option key={b} value={b}>{t ? portLabel(t.producto_id, b, idx) : b}</option>)}
          </select>
          <input type="number" className="inspector-input" style={{ width: 90 }} data-testid={`${prefijo}-distancia`} value={valor.distancia} placeholder="mm" onChange={(e) => set({ distancia: e.target.value })} />
        </span>
      </label>
      <label className="stage-field">
        Lado
        <select className="inspector-input" data-testid={`${prefijo}-lado`} value={valor.lado} onChange={(e) => set({ lado: e.target.value as Lado })}>
          <option value="izquierda">Izquierda (mirando desde la boca hacia el tramo)</option>
          <option value="derecha">Derecha</option>
        </select>
      </label>
    </>
  );
}
