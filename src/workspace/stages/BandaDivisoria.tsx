/**
 * Banda divisoria (etapa 3, parte B): control en la ficha del tramo (Bandejas) y
 * la ocupación por grupos de las bandejas segregadas en Resultados, como cálculo
 * de la app con la procedencia del operador. La lógica está en
 * `segregacion/bandaDivisoria.ts`.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import type { Piece, Product } from '../../tray/model';
import {
  bandaDePieza, bandasCompatibles, bandasOf, colocarBanda, computoBandas, CRITERIO_OCUPACION, CRITERIO_PE, NOTA_COMPUTO,
  ocupacionSegregada, PROCEDENCIA_CALCULO, PROCEDENCIA_REGLA, quitarBanda, TEXTO_GRUPO, type OcupacionSegregada,
} from '../segregacion/bandaDivisoria';
import { useCatalogoCables } from './CableCircuitoCampos';
import { indexProducts, pieceLabelById } from './displayNames';
import { Section } from './shared';

const mm = (x: number) => `${x.toLocaleString('es-AR', { maximumFractionDigits: 1 })} mm`;
const pct = (x: number | null) => (x === null ? '—' : `${x.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`);

function useProductos() {
  const context = useTrayStore((s) => s.context);
  return useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
}

/** Ocupación segregada de una pieza (o null si no tiene banda). */
export function useOcupacionSegregada(): (pieza: string) => OcupacionSegregada | null {
  const entrada = useTrayStore((s) => s.entrada);
  const elements = useWorkspaceStore((s) => s.elements);
  const productos = useProductos();
  const { cables } = useCatalogoCables();
  const diametros = useMemo(() => new Map(cables.map((c) => [c.cable_id, c.diametro_exterior_mm])), [cables]);
  return (pieza: string) => (entrada ? ocupacionSegregada(entrada, elements, productos, diametros, pieza) : null);
}

export function BandaDivisoriaControl({ piece }: { piece: Piece }) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const edit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const productos = useProductos();
  const compat = useMemo(() => bandasCompatibles(piece.producto_id, context?.compatibilidades ?? [], productos), [piece.producto_id, context, productos]);
  const [elegida, setElegida] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!entrada || productos.get(piece.producto_id)?.tipo_pieza !== 'recta') return null;
  const actual = bandaDePieza(entrada, piece.instancia_id);
  const sel = elegida || compat[0]?.producto_id || '';
  return (
    <div className="inspector-section-block" style={{ padding: '4px 12px 8px' }} data-testid="banda-control">
      <div className="inspector-section">Banda divisoria (segregación)</div>
      {actual ? (
        <>
          <p className="stage-note" data-testid="banda-actual">
            Con banda {String(productos.get(actual.producto_id)?.sku ?? actual.producto_id)}: potencia separada de maniobra e instrumentación. La ocupación la calcula la app.
          </p>
          <button type="button" data-testid="banda-quitar" onClick={() => { edit(quitarBanda(entrada, piece.instancia_id)); markDirty(); setMsg(null); }}>Quitar banda</button>
        </>
      ) : compat.length === 0 ? (
        <p className="stage-note" data-testid="banda-sin-compatible">El catálogo no tiene banda divisoria compatible con este tramo.</p>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="inspector-input" data-testid="banda-producto" value={sel} onChange={(e) => setElegida(e.target.value)}>
            {compat.map((b) => (
              <option key={b.producto_id} value={b.producto_id}>
                {String(b.sku)}{typeof (b as Record<string, unknown>).espesor_chapa_mm === 'number' ? ` (espesor ${String((b as Record<string, unknown>).espesor_chapa_mm)} mm)` : ' (espesor no publicado)'}
              </option>
            ))}
          </select>
          <button type="button" className="stage-primary" data-testid="banda-colocar" onClick={() => {
            const r = colocarBanda(entrada, piece.instancia_id, sel, context?.compatibilidades ?? [], productos);
            if (!r.ok) { setMsg(r.motivo); return; }
            edit(r.entrada); markDirty(); setMsg(null);
          }}>Colocar banda</button>
        </div>
      )}
      {msg && <p className="stage-note tone-warn" role="status" data-testid="banda-msg">{msg}</p>}
    </div>
  );
}

/** Ocupación por grupos de una pieza segregada (cálculo de la app), para Resultados. */
export function OcupacionSegregadaView({ o }: { o: OcupacionSegregada }) {
  if (!o.calculada) {
    return <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="segregada-no-verificable" data-origen="app">Banda {o.banda}: {o.motivo}.</div>;
  }
  return (
    <div data-testid="segregada-ocupacion" data-origen="app" data-pieza={o.pieza}>
      <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>
        <strong>Cálculo de la app</strong> — banda {o.banda}: ancho útil {mm(o.ancho_util_mm)} ({o.base_ancho}) − espesor {mm(o.espesor_banda_mm)} = {mm(o.ancho_disponible_mm)} a repartir por cantidad de cables.
      </div>
      {o.grupos.map((g) => (
        <div key={g.grupo} className={`stage-row-sub${g.estado === 'CUMPLE' || g.estado === 'SIN_CABLES' ? '' : ' tone-warn'}`} style={{ whiteSpace: 'normal' }}
          data-testid="segregada-grupo" data-grupo={g.grupo} data-estado={g.estado} data-n={g.n_cables}
          data-asignado={g.ancho_asignado_mm} data-ocupado={g.ancho_ocupado_mm} data-reserva-libre={g.reserva_libre_pct ?? ''}>
          {TEXTO_GRUPO[g.grupo]}: {g.n_cables} cable(s) → {mm(g.ancho_asignado_mm)} asignados · ocupa {mm(g.ancho_ocupado_mm)} · reserva libre {pct(g.reserva_libre_pct)} · {g.estado}
          {g.cables.length > 0 && <span> ({g.cables.map((k) => `${k.origen}: ${k.cantidad} × Ø ${k.diametro_mm}`).join('; ')})</span>}
        </div>
      ))}
      {o.excluidos.map((x) => <div key={x.nombre} className="stage-row-sub tone-warn">No contado: {x.nombre} — {x.motivo}.</div>)}
    </div>
  );
}

export function BandejasSegregadasSection() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const productos = useProductos();
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const calc = useOcupacionSegregada();
  const bandas = bandasOf(entrada);
  if (!bandas.length) return null;
  const piezas = entrada?.piezas ?? [];
  const etiqueta = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  const computo = computoBandas(entrada, productos);
  return (
    <Section title={`Bandejas segregadas — cálculo de la app (${bandas.length})`} testid="segregadas">
      <p className="stage-note" style={{ whiteSpace: 'normal' }} data-testid="segregadas-procedencia">
        {PROCEDENCIA_REGLA} {PROCEDENCIA_CALCULO} {CRITERIO_PE} {CRITERIO_OCUPACION}
      </p>
      {bandas.map((b) => {
        const o = calc(b.pieza);
        return (
          <div key={b.pieza} className="stage-card" data-testid="segregada-row" data-pieza={b.pieza}>
            <div><strong>{etiqueta(b.pieza)}</strong></div>
            {o && <OcupacionSegregadaView o={o} />}
          </div>
        );
      })}
      <h4 className="stage-section-subtitle">Bandas divisorias en el cómputo (agregadas por la app)</h4>
      {computo.map((l) => (
        <div key={l.producto_id} className="stage-card" data-testid="computo-banda" data-producto={l.producto_id} data-piezas={l.piezas} data-longitud={l.longitud_mm}>
          <strong>[AGREGADA POR LA APP] {l.sku}</strong>: {l.piezas} banda(s) — {mm(l.longitud_mm)} a cubrir ({l.tramos.map(etiqueta).join(', ')})
        </div>
      ))}
      <p className="stage-note" style={{ whiteSpace: 'normal' }}>{NOTA_COMPUTO}</p>
    </Section>
  );
}
