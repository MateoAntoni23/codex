/**
 * Bandejas — derivación en un tramo: formulario para crear el enganche (tronco,
 * boca de referencia, distancia, lado y ancho de la derivación) y lista de
 * enganches con su accesorio y su estado. La operación coloca sólo la derivación
 * (DCPS en perforada; la boca sobre el flanco en escalera) y deja su boca libre:
 * lo que sigue se continúa por el camino normal. La lógica está en
 * `derivacion/enganche.ts`.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import type { Product } from '../../tray/model';
import { anchosDeDerivacion, crearEnganche, dcpsHuerfanas, dcpsParaAncho, enganchesOf, estadoEnganche, familiaDe, type Lado } from '../derivacion/enganche';
import { placedOf } from '../placement/definitions';
import { indexProducts, pieceLabelById, portLabel } from './displayNames';
import { Empty, Section } from './shared';

export function DerivacionForm({ onClose }: { onClose: () => void }) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const piezas = entrada?.piezas ?? [];
  const troncos = piezas.filter((p) => productos.get(p.producto_id)?.tipo_pieza === 'recta' && typeof p.longitud_mm === 'number');

  const [tronco, setTronco] = useState('');
  const [desde, setDesde] = useState('P1');
  const [distancia, setDistancia] = useState('');
  const [lado, setLado] = useState<Lado>('izquierda');
  const [ancho, setAncho] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string; advertencias?: readonly string[] } | null>(null);

  const t = troncos.find((p) => p.instancia_id === tronco);
  const defTronco = entrada && t ? placedOf(entrada, t)?.def : undefined;
  const familia = defTronco ? familiaDe(defTronco) : null;
  const troncoProd = t ? productos.get(t.producto_id) : undefined;
  const anchos = troncoProd && familia ? anchosDeDerivacion(productos, troncoProd, familia) : [];
  const crear = () => {
    if (!entrada) return;
    const r = crearEnganche(entrada, productos, {
      tronco, desde_boca: desde, distancia_mm: Number(distancia), lado, ancho_mm: Number(ancho),
    });
    if (!r.ok) { setMsg({ ok: false, texto: r.motivo }); return; }
    trayEdit(r.entrada);
    markDirty();
    const acc = r.enganche.accesorio.tipo === 'producto'
      ? `: ${productos.get(r.enganche.accesorio.producto_id)?.sku} colocada, su boca queda libre para continuar`
      : ': boca libre sobre el flanco, sin accesorio (escalera), lista para continuar';
    setMsg({ ok: true, texto: `Derivación ${r.enganche.id} creada${acc}.`, advertencias: r.enganche.advertencias ?? [] });
  };

  return (
    <div data-testid="der-form">
      <label className="stage-field">
        Tramo principal (tronco)
        <select className="inspector-input" data-testid="der-tronco" value={tronco} onChange={(e) => setTronco(e.target.value)}>
          <option value="">Elegí un tramo recto…</option>
          {troncos.map((p) => <option key={p.instancia_id} value={p.instancia_id}>{pieceLabelById(p.instancia_id, piezas, idx)} · {p.longitud_mm} mm</option>)}
        </select>
      </label>
      <label className="stage-field">
        Distancia desde la boca
        <span style={{ display: 'flex', gap: 6 }}>
          <select className="inspector-input" data-testid="der-desde" value={desde} onChange={(e) => setDesde(e.target.value)}>
            {['P1', 'P2'].map((b) => <option key={b} value={b}>{t ? portLabel(t.producto_id, b, idx) : b}</option>)}
          </select>
          <input type="number" className="inspector-input" style={{ width: 90 }} data-testid="der-distancia" value={distancia} placeholder="mm" onChange={(e) => setDistancia(e.target.value)} />
        </span>
      </label>
      <label className="stage-field">
        Lado
        <select className="inspector-input" data-testid="der-lado" value={lado} onChange={(e) => setLado(e.target.value as Lado)}>
          <option value="izquierda">Izquierda (mirando desde la boca hacia el tramo)</option>
          <option value="derecha">Derecha</option>
        </select>
      </label>
      <label className="stage-field">
        Ancho de la derivación
        <select className="inspector-input" data-testid="der-ancho" value={ancho} onChange={(e) => setAncho(e.target.value)} disabled={!t}>
          <option value="">{t ? 'Elegí el ancho…' : 'Elegí primero el tronco'}</option>
          {anchos.map((w) => (
            <option key={w} value={String(w)}>
              {w} mm{familia === 'perforada' ? ` — ${dcpsParaAncho(productos, w)?.sku ?? '?'} (se computa)` : ' — boca cortada en obra (sin accesorio)'}
            </option>
          ))}
        </select>
      </label>
      <p className="stage-note" style={{ whiteSpace: 'normal' }}>
        Se coloca sólo la derivación y su boca queda libre: lo que sigue se continúa desde esa boca, como desde cualquier accesorio.
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="stage-primary" data-testid="der-crear" onClick={crear} disabled={!tronco || !ancho || distancia === ''}>Crear derivación</button>
        <button type="button" onClick={onClose}>Cerrar</button>
      </div>
      {msg && <p className={`stage-note${msg.ok ? '' : ' tone-warn'}`} role="status" data-testid="der-msg">{msg.texto}</p>}
      {msg?.advertencias?.map((a) => (
        <p key={a} className="stage-note tone-warn" style={{ whiteSpace: 'normal' }} role="alert" data-testid="der-advertencia">⚠ {a}</p>
      ))}
    </div>
  );
}

export function EnganchesSection() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const piezas = entrada?.piezas ?? [];
  const engs = enganchesOf(entrada);
  const huerfanas = dcpsHuerfanas(entrada);
  if (!engs.length && !huerfanas.length) return null;
  const etiqueta = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  return (
    <Section title={`Derivaciones en tramo (${engs.length})`} testid="enganches">
      {engs.length === 0 && <Empty>Sin derivaciones.</Empty>}
      {huerfanas.map((h) => (
        <div key={h.pieza} className="stage-card tone-warn" style={{ whiteSpace: 'normal' }} data-testid="dcps-huerfana">
          {etiqueta(h.pieza)}: {h.motivo}
        </div>
      ))}
      {engs.map((e) => {
        const est = entrada ? estadoEnganche(entrada, productos, e) : { vigente: true as const };
        const acc = e.accesorio.tipo === 'producto'
          ? `${productos.get(e.accesorio.producto_id)?.sku ?? e.accesorio.producto_id} (se computa)`
          : `sin accesorio por familia — ${e.accesorio.motivo}`;
        return (
          <div key={e.id} className="stage-card" data-testid="enganche-row" data-vigente={est.vigente ? 'true' : 'false'}>
            <div><strong>{e.id}</strong> · {etiqueta(e.tronco)} · {e.distancia_mm} mm desde {e.desde_boca} · {e.lado} · ancho {e.ramal_ancho_mm} mm</div>
            <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="enganche-accesorio">Accesorio: {acc}</div>
            {(e.advertencias ?? []).map((a) => (
              <div key={a} className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="enganche-advertencia">⚠ {a}</div>
            ))}
            {!est.vigente && (
              <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="enganche-estado">Desactualizado: {est.motivos.join('; ')}.</div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
