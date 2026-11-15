/**
 * Ficha de una CURVA AJUSTABLE de escalera (CAS): ángulo de la instancia, radios y
 * longitud de eje (arco). Corregir el ángulo recalcula bocas y longitud desde la boca
 * de entrada, que no se mueve (`cambiarAnguloAjustable`); las uniones de la boca que se
 * mueve no se tocan: si dejan de cumplir quedan en Uniones con su motivo y se avisa
 * acá. Un ángulo fuera del rango se rechaza con el motivo y el rango.
 */
import { useState } from 'react';
import type { Piece, Product } from '../../tray/model';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { anguloDe, cambiarAnguloAjustable } from '../placement/anguloEslabonada';
import {
  ANGULO_AJUSTABLE_MAX, ANGULO_AJUSTABLE_MIN, medidasCurvaAjustable, PROCEDENCIA_CURVA_AJUSTABLE, RANGO_AJUSTABLE_TEXTO,
} from '../../parametric/reglaCurvaAjustable';

export function AnguloAjustableField({ piece, ancho }: { piece: Piece; ancho: number }) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const edit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const actual = anguloDe(entrada, piece);
  const [valor, setValor] = useState(String(actual ?? ''));
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  if (!entrada || actual === null) return null;
  const m = medidasCurvaAjustable(ancho, actual);

  const aplicar = () => {
    const productos = new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p]));
    const r = cambiarAnguloAjustable(entrada, productos, piece.instancia_id, Number(valor));
    if (!r.ok) { setMsg({ ok: false, texto: r.motivo }); return; }
    edit(r.entrada);
    markDirty();
    setMsg({
      ok: r.unionesQueNoCumplen.length === 0,
      texto: `Ángulo ${Number(valor)}°.` + (r.unionesQueNoCumplen.length
        ? ` ${r.unionesQueNoCumplen.length} unión(es) dejaron de cumplir (${r.unionesQueNoCumplen.join(', ')}): revisalas en Uniones.`
        : ''),
    });
  };

  return (
    <div className="inspector-field" data-testid="ajustable-ficha" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <span className="inspector-label">Curva ajustable</span>
      <span style={{ fontSize: 11 }} data-testid="ajustable-resumen" data-angulo={actual} data-eje={m.longitudEjeMm.toFixed(3)}>
        {actual}° · eje {m.longitudEjeMm.toFixed(1)} mm (arco) · radio interior {m.radioInteriorMm} mm, eje {m.radioEjeMm} mm
      </span>
      <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input
          type="number"
          className="inspector-input"
          style={{ width: 80 }}
          min={ANGULO_AJUSTABLE_MIN}
          max={ANGULO_AJUSTABLE_MAX}
          step={0.5}
          aria-label="Ángulo de la curva ajustable (°)"
          data-testid="ajustable-angulo"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <button type="button" data-testid="ajustable-aplicar" onClick={aplicar} disabled={Number(valor) === actual}>Aplicar ángulo</button>
      </span>
      <span className="stage-note" style={{ whiteSpace: 'normal', fontSize: 10 }}>Rango {RANGO_AJUSTABLE_TEXTO}.</span>
      {msg && <span className={`stage-note${msg.ok ? '' : ' tone-warn'}`} role="status" data-testid="ajustable-msg">{msg.texto}</span>}
      <span className="stage-note" style={{ whiteSpace: 'normal', fontSize: 10 }}>Procedencia: {PROCEDENCIA_CURVA_AJUSTABLE}.</span>
    </div>
  );
}
