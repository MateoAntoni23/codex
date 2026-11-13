/**
 * Ficha de una curva ESLABONADA (EPS, CUS): ángulo de la instancia, eslabones y
 * longitud de eje. Cambiar el ángulo recalcula bocas, longitud y eslabones
 * (`cambiarAnguloEslabonada`); las uniones que dependen de la boca que se mueve
 * no se tocan: si dejan de cumplir quedan en Uniones con su motivo y se avisa acá.
 */
import { useState } from 'react';
import type { Piece, Product } from '../../tray/model';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { anguloDe, cambiarAnguloEslabonada } from '../placement/anguloEslabonada';
import { ANGULO_ESLABONADA_MAX, ANGULO_ESLABONADA_MIN, medidasEslabonada, PROCEDENCIA_ESLABONADA } from '../../parametric/reglaEslabones';

export function AnguloEslabonadaField({ piece, ancho }: { piece: Piece; ancho: number }) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const edit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const actual = anguloDe(entrada, piece);
  const [valor, setValor] = useState(String(actual ?? ''));
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  if (!entrada || actual === null) return null;
  const m = medidasEslabonada(ancho, actual);

  const aplicar = () => {
    const productos = new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p]));
    const r = cambiarAnguloEslabonada(entrada, productos, piece.instancia_id, Number(valor));
    if (!r.ok) { setMsg({ ok: false, texto: r.motivo }); return; }
    edit(r.entrada);
    markDirty();
    setMsg({
      ok: r.unionesQueNoCumplen.length === 0,
      texto: `Ángulo ${Number(valor)}°: ${r.eslabones} eslabones.` + (r.unionesQueNoCumplen.length
        ? ` ${r.unionesQueNoCumplen.length} unión(es) dejaron de cumplir (${r.unionesQueNoCumplen.join(', ')}): revisalas en Uniones.`
        : ''),
    });
  };

  return (
    <div className="inspector-field" data-testid="eslabonada-ficha" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <span className="inspector-label">Curva eslabonada</span>
      <span style={{ fontSize: 11 }} data-testid="eslabonada-resumen" data-angulo={actual} data-eslabones={m.eslabones}>
        {actual}° · {m.eslabones} eslabones · eje {m.longitudEjeMm.toFixed(1)} mm · radio {m.radioMm} mm
      </span>
      <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input
          type="number"
          className="inspector-input"
          style={{ width: 80 }}
          min={ANGULO_ESLABONADA_MIN}
          max={ANGULO_ESLABONADA_MAX}
          step={0.5}
          data-testid="eslabonada-angulo"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <button type="button" data-testid="eslabonada-aplicar" onClick={aplicar} disabled={Number(valor) === actual}>Aplicar ángulo</button>
      </span>
      {msg && <span className={`stage-note${msg.ok ? '' : ' tone-warn'}`} role="status" data-testid="eslabonada-msg">{msg.texto}</span>}
      <span className="stage-note" style={{ whiteSpace: 'normal', fontSize: 10 }}>Procedencia: {PROCEDENCIA_ESLABONADA}.</span>
    </div>
  );
}
