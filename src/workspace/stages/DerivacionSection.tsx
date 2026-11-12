/**
 * Bandejas — derivación en un tramo: formulario para crear el enganche (tronco,
 * boca de referencia, distancia, lado, ramal) y lista de enganches con su
 * accesorio y su estado. La lógica está en `derivacion/enganche.ts`.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import type { Product } from '../../tray/model';
import { crearEnganche, enganchesOf, estadoEnganche, type Lado } from '../derivacion/enganche';
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
  const rectas = (context?.productos ?? []).filter((p) => p.tipo_pieza === 'recta' && typeof p.ancho_nominal_mm === 'number');

  const [tronco, setTronco] = useState('');
  const [desde, setDesde] = useState('P1');
  const [distancia, setDistancia] = useState('');
  const [lado, setLado] = useState<Lado>('izquierda');
  const [ramal, setRamal] = useState('');
  const [largo, setLargo] = useState('1000');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const t = troncos.find((p) => p.instancia_id === tronco);
  const crear = () => {
    if (!entrada) return;
    const r = crearEnganche(entrada, productos, {
      tronco, desde_boca: desde, distancia_mm: Number(distancia), lado, ramal_producto_id: ramal, ramal_longitud_mm: Number(largo),
    });
    if (!r.ok) { setMsg({ ok: false, texto: r.motivo }); return; }
    trayEdit(r.entrada);
    markDirty();
    const acc = r.enganche.accesorio.tipo === 'producto' ? `con ${productos.get(r.enganche.accesorio.producto_id)?.sku}` : 'sin accesorio (escalera)';
    setMsg({ ok: true, texto: `Derivación ${r.enganche.id} creada ${acc}.` });
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
        Ramal (tramo recto)
        <select className="inspector-input" data-testid="der-ramal" value={ramal} onChange={(e) => setRamal(e.target.value)}>
          <option value="">Elegí el tramo del ramal…</option>
          {rectas.map((p) => <option key={p.producto_id} value={p.producto_id}>{p.sku} · ancho {p.ancho_nominal_mm}</option>)}
        </select>
      </label>
      <label className="stage-field">
        Largo del ramal (mm)
        <input type="number" className="inspector-input" data-testid="der-ramal-largo" value={largo} onChange={(e) => setLargo(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="stage-primary" data-testid="der-crear" onClick={crear} disabled={!tronco || !ramal || distancia === ''}>Crear derivación</button>
        <button type="button" onClick={onClose}>Cerrar</button>
      </div>
      {msg && <p className={`stage-note${msg.ok ? '' : ' tone-warn'}`} role="status" data-testid="der-msg">{msg.texto}</p>}
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
  if (!engs.length) return null;
  const etiqueta = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  return (
    <Section title={`Derivaciones en tramo (${engs.length})`} testid="enganches">
      {engs.length === 0 && <Empty>Sin derivaciones.</Empty>}
      {engs.map((e) => {
        const est = entrada ? estadoEnganche(entrada, productos, e) : { vigente: true as const };
        const acc = e.accesorio.tipo === 'producto'
          ? `${productos.get(e.accesorio.producto_id)?.sku ?? e.accesorio.producto_id} (se computa)`
          : `sin accesorio por familia — ${e.accesorio.motivo}`;
        return (
          <div key={e.id} className="stage-card" data-testid="enganche-row" data-vigente={est.vigente ? 'true' : 'false'}>
            <div><strong>{e.id}</strong> · {etiqueta(e.tronco)} · {e.distancia_mm} mm desde {e.desde_boca} · {e.lado} · ramal {e.ramal_ancho_mm} mm</div>
            <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="enganche-accesorio">Accesorio: {acc}</div>
            {!est.vigente && (
              <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="enganche-estado">Desactualizado: {est.motivos.join('; ')}.</div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
