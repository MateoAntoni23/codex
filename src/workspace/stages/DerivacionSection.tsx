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
import { mezclaDeAcabados } from '../mezclaAcabados';
import { MarcaMezcla } from './MarcaMezcla';
import { indexProducts, pieceLabelById } from './displayNames';
import { Empty, Section } from './shared';
import { PuntoEnTramoCampos, troncosElegibles } from './PuntoEnTramoCampos';

export function DerivacionForm({ onClose }: { onClose: () => void }) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const piezas = entrada?.piezas ?? [];
  const troncos = troncosElegibles(piezas, productos);

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
    // Mezcla de acabados (p. ej. DCPS zincada sobre un tronco color): se permite y se marca.
    const sal = r.entrada.piezas.find((p) => p.instancia_id === r.enganche.salida[0]);
    const mezcla = sal ? mezclaDeAcabados(productos.get(r.entrada.piezas.find((p) => p.instancia_id === r.enganche.tronco)!.producto_id), productos.get(sal.producto_id)) : null;
    setMsg({ ok: true, texto: `Derivación ${r.enganche.id} creada${acc}.`, advertencias: [...(r.enganche.advertencias ?? []), ...(mezcla ? [mezcla.texto] : [])] });
  };

  return (
    <div data-testid="der-form">
      <PuntoEnTramoCampos
        prefijo="der"
        etiquetaTramo="Tramo principal (tronco)"
        valor={{ tronco, desde, distancia, lado }}
        onChange={(v) => { setTronco(v.tronco); setDesde(v.desde); setDistancia(v.distancia); setLado(v.lado); }}
      />
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
        const pTronco = piezas.find((p) => p.instancia_id === e.tronco);
        const pSalida = e.salida[0] ? piezas.find((p) => p.instancia_id === e.salida[0]) : undefined;
        const mezcla = pTronco && pSalida ? mezclaDeAcabados(productos.get(pTronco.producto_id), productos.get(pSalida.producto_id)) : null;
        const acc = e.accesorio.tipo === 'producto'
          ? `${productos.get(e.accesorio.producto_id)?.sku ?? e.accesorio.producto_id} (se computa)`
          : `sin accesorio por familia — ${e.accesorio.motivo}`;
        return (
          <div key={e.id} className="stage-card" data-testid="enganche-row" data-vigente={est.vigente ? 'true' : 'false'}>
            <div><strong>{e.id}</strong> · {etiqueta(e.tronco)} · {e.distancia_mm} mm desde {e.desde_boca} · {e.lado} · ancho {e.ramal_ancho_mm} mm</div>
            <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="enganche-accesorio">Accesorio: {acc}</div>
            {mezcla && <MarcaMezcla mezcla={mezcla} testid="enganche-aviso-mezcla" bloque />}
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
