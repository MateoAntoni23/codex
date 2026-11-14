/**
 * Campos del cable de un circuito (etapa 2): selector en cascada línea → tipo →
 * formación, cantidad (entero positivo, por defecto 1), disposición en la bandeja
 * (separados / juntos, sin valor por defecto: el motor no la presume) y la
 * función, fija en potencia. Los usan el circuito entre equipos (al guardar) y la
 * tabla de Resultados (al editar).
 */
import { useMemo } from 'react';
import { useTrayStore } from '../../tray/store';
import { formacionesDe, lineaCorta, lineas, textoFormacion, tiposDe, claveTipo, type CableCatalogo } from '../cables/catalogoCables';
import { FUNCION_CIRCUITO, MOTIVO_FUNCION_FIJA, type CableDeCircuito } from '../recorridos/circuitosGuardados';

export interface ValorCable {
  readonly linea: string;
  readonly tipo: string;
  readonly cable_id: string;
  readonly cantidad: string;
  readonly separado: boolean | null;
}

export const CABLE_VACIO: ValorCable = { linea: '', tipo: '', cable_id: '', cantidad: '1', separado: null };

/** Etiquetas de `separado` en palabras del operador (D-01 / D-02 del motor). */
export const TEXTO_SEPARADO = {
  si: 'Separados: un diámetro de cable libre entre cada uno',
  no: 'Juntos: tocándose, uno al lado del otro',
  nota: 'Siempre en una sola capa (apilados no se calcula). Decide el ancho que ocupan en la bandeja.',
} as const;

/** Catálogo del contexto, o el motivo por el que no está. */
export function useCatalogoCables(): { cables: readonly CableCatalogo[]; motivo: string | null } {
  const context = useTrayStore((s) => s.context);
  return useMemo(() => {
    const r = context?.catalogoCables;
    if (!r) return { cables: [], motivo: context ? 'el servicio no mandó el catálogo de cables' : 'sin conexión con el motor: no hay catálogo de cables' };
    return r.ok ? { cables: r.cables, motivo: null } : { cables: [], motivo: r.motivo };
  }, [context]);
}

/** Valor del formulario a partir de un cable guardado. */
export function valorDesdeCable(cables: readonly CableCatalogo[], c: CableDeCircuito | undefined): ValorCable {
  if (!c) return CABLE_VACIO;
  const k = cables.find((x) => x.cable_id === c.cable_id);
  return { linea: k?.linea ?? '', tipo: k ? claveTipo(k) : '', cable_id: c.cable_id, cantidad: String(c.cantidad), separado: c.separado };
}

/** El dato a guardar, o el motivo por el que todavía no se puede. Sin cable elegido → null (circuito sin cable). */
export function cableDesdeValor(v: ValorCable): { ok: true; cable: CableDeCircuito | null } | { ok: false; motivo: string } {
  if (!v.cable_id) return { ok: true, cable: null };
  const n = Number(v.cantidad);
  if (!Number.isInteger(n) || n < 1) return { ok: false, motivo: 'la cantidad tiene que ser un entero positivo' };
  return { ok: true, cable: { cable_id: v.cable_id, cantidad: n, separado: v.separado, funcion: FUNCION_CIRCUITO } };
}

export function CableCircuitoCampos({ prefijo, valor, onChange }: { prefijo: string; valor: ValorCable; onChange: (v: ValorCable) => void }) {
  const { cables, motivo } = useCatalogoCables();
  if (motivo) return <p className="stage-note tone-warn" data-testid={`${prefijo}-cable-sin-catalogo`}>No se puede elegir el cable: {motivo}.</p>;
  const tipos = valor.linea ? tiposDe(cables, valor.linea) : [];
  const formaciones = valor.linea && valor.tipo ? formacionesDe(cables, valor.linea, valor.tipo) : [];
  const set = (x: Partial<ValorCable>) => onChange({ ...valor, ...x });
  return (
    <div data-testid={`${prefijo}-cable`}>
      <label className="stage-field">
        Línea
        <select className="inspector-input" data-testid={`${prefijo}-cable-linea`} value={valor.linea}
          onChange={(e) => set({ linea: e.target.value, tipo: '', cable_id: '' })}>
          <option value="">Elegí la línea…</option>
          {lineas(cables).map((l) => <option key={l} value={l}>{lineaCorta(l)}</option>)}
        </select>
      </label>
      <label className="stage-field">
        Tipo
        <select className="inspector-input" data-testid={`${prefijo}-cable-tipo`} value={valor.tipo} disabled={!valor.linea}
          onChange={(e) => set({ tipo: e.target.value, cable_id: '' })}>
          <option value="">{valor.linea ? 'Elegí el tipo…' : 'Elegí primero la línea'}</option>
          {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.texto}</option>)}
        </select>
      </label>
      <label className="stage-field">
        Formación
        <select className="inspector-input" data-testid={`${prefijo}-cable-formacion`} value={valor.cable_id} disabled={!valor.tipo}
          onChange={(e) => set({ cable_id: e.target.value })}>
          <option value="">{valor.tipo ? 'Elegí la formación…' : 'Elegí primero el tipo'}</option>
          {formaciones.map((c) => <option key={c.cable_id} value={c.cable_id}>{textoFormacion(c)} — Ø {c.diametro_exterior_mm} mm</option>)}
        </select>
      </label>
      <label className="stage-field">
        Cantidad de cables
        <input type="number" min={1} step={1} className="inspector-input" style={{ width: 90 }} data-testid={`${prefijo}-cable-cantidad`}
          value={valor.cantidad} onChange={(e) => set({ cantidad: e.target.value })} />
      </label>
      <fieldset className="stage-field" style={{ border: 0, padding: 0, margin: 0 }} data-testid={`${prefijo}-cable-separado`}>
        <legend>Cómo van en la bandeja</legend>
        <label className="stage-check">
          <input type="radio" name={`${prefijo}-separado`} data-testid={`${prefijo}-cable-separado-si`} checked={valor.separado === true} onChange={() => set({ separado: true })} />
          {TEXTO_SEPARADO.si}
        </label>
        <label className="stage-check">
          <input type="radio" name={`${prefijo}-separado`} data-testid={`${prefijo}-cable-separado-no`} checked={valor.separado === false} onChange={() => set({ separado: false })} />
          {TEXTO_SEPARADO.no}
        </label>
        <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>{TEXTO_SEPARADO.nota}</div>
      </fieldset>
      <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid={`${prefijo}-cable-funcion`}>
        <strong>Función:</strong> potencia. {MOTIVO_FUNCION_FIJA}
      </div>
    </div>
  );
}
