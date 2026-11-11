/**
 * CalibracionPatronTab — calibración de bocas POR PATRÓN (B-2.5).
 *
 * Reemplaza a la pestaña "Orientación" por SKU (marco del modelo + centro y
 * normal absolutos). Cada boca guarda una corrección respecto de la boca
 * nominal del patrón, en sus propios ejes:
 *   desplazamiento lateral / vertical / axial (mm) y giro alrededor de esos
 *   ejes (°). El giro axial es el antiguo "giro de instalación".
 * La corrección vale igual para todas las variantes del patrón (no se escala).
 * En una variante distinta de la medida se muestra "calibración heredada, sin
 * verificar en este ancho". Una variante que necesita otra corrección se
 * declara como EXCEPCIÓN explícita, con motivo.
 *
 * No hay marco del modelo: con el marco completo de la fase A, girar malla y
 * bocas juntas no cambia la pieza colocada.
 */
import { useMemo, useState } from 'react';
import type { Product } from '../tray/model';
import { useCatalogConfigStore } from './catalogConfigStore';
import { findMasterForProduct } from './masterModels';
import { definicionEfectiva } from '../workspace/placement/definitions';
import { esVarianteMedida } from '../workspace/placement/calibrarReceta';
import { CORRECCION_NULA, MARCA_HEREDADA, esCorreccionNula, type CorreccionBoca } from '../workspace/calibracionPatron';

const EJES = ['lateral', 'vertical', 'axial'] as const;
type Eje = (typeof EJES)[number];
type Draft = Record<string, { d: Record<Eje, string>; g: Record<Eje, string> }>;

const fmt = (n: number) => (Math.abs(n) < 1e-9 ? '0' : String(Number(n.toFixed(6))));

function aDraft(nombres: readonly string[], bocas: Readonly<Record<string, CorreccionBoca>>): Draft {
  const out: Draft = {};
  for (const n of nombres) {
    const c = bocas[n] ?? CORRECCION_NULA;
    out[n] = {
      d: { lateral: fmt(c.desplazamiento_mm.lateral), vertical: fmt(c.desplazamiento_mm.vertical), axial: fmt(c.desplazamiento_mm.axial) },
      g: { lateral: fmt(c.giro_deg.lateral), vertical: fmt(c.giro_deg.vertical), axial: fmt(c.giro_deg.axial) },
    };
  }
  return out;
}

function deDraft(dr: Draft[string]): CorreccionBoca | null {
  const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
  const v = [...EJES.map((e) => num(dr.d[e])), ...EJES.map((e) => num(dr.g[e]))];
  if (v.some((x) => !Number.isFinite(x))) return null;
  return {
    desplazamiento_mm: { lateral: v[0], vertical: v[1], axial: v[2] },
    giro_deg: { lateral: v[3], vertical: v[4], axial: v[5] },
  };
}

export function CalibracionPatronTab({ product }: { product: Product }) {
  const calibracion = useCatalogConfigStore((s) => s.calibracion);
  const setCorreccionPatron = useCatalogConfigStore((s) => s.setCorreccionPatron);
  const setExcepcion = useCatalogConfigStore((s) => s.setExcepcion);
  const master = useMemo(() => findMasterForProduct(product as Record<string, unknown>), [product]);
  const def = useMemo(() => definicionEfectiva(product), [product, calibracion]); // eslint-disable-line react-hooks/exhaustive-deps

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [reason, setReason] = useState('');
  const [comoExcepcion, setComoExcepcion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!master) {
    return <div className="cfg-tab-content"><div className="cfg-tab-hint">Este producto no corresponde a ningún patrón: no hay calibración que editar.</div></div>;
  }
  const pid = product.producto_id;
  const medida = esVarianteMedida(product, master);
  const exc = calibracion.excepciones[pid];
  const delPatron = calibracion.patrones[master.id]?.bocas ?? {};
  const vigente = exc ? exc.bocas : delPatron;
  const hayPatron = Object.values(delPatron).some((c) => !esCorreccionNula(c));
  const nombres = def.ok ? def.def.ports.map((p) => p.name) : Object.keys(vigente);
  const estado = exc
    ? `Excepción de esta variante: ${exc.motivo}`
    : !hayPatron
      ? 'El patrón no tiene calibración: se usan las bocas medidas.'
      : medida
        ? 'Variante medida del patrón: la calibración del patrón está verificada en este ancho.'
        : `${MARCA_HEREDADA.charAt(0).toUpperCase()}${MARCA_HEREDADA.slice(1)}.`;

  const startEdit = () => {
    setDraft(aDraft(nombres, vigente));
    setReason(exc?.motivo ?? calibracion.patrones[master.id]?.motivo ?? '');
    setComoExcepcion(!!exc);
    setError(null);
    setEditMode(true);
  };

  const applyEdit = () => {
    if (reason.trim().length < 10) {
      setError('El motivo debe tener al menos 10 caracteres.');
      return;
    }
    const bocas: Record<string, CorreccionBoca> = {};
    for (const n of nombres) {
      const c = deDraft(draft[n]);
      if (!c) {
        setError(`Valor no numérico en la boca ${n}.`);
        return;
      }
      if (!esCorreccionNula(c)) bocas[n] = c;
    }
    if (comoExcepcion) {
      setExcepcion(pid, { productoId: pid, patron: master.id, bocas, motivo: reason.trim(), fecha: new Date().toISOString() });
    } else {
      if (exc) setExcepcion(pid, null);
      for (const n of new Set([...nombres, ...Object.keys(delPatron)])) setCorreccionPatron(master.id, n, bocas[n] ?? null, reason.trim());
    }
    setEditMode(false);
  };

  const reset = () => {
    if (exc) setExcepcion(pid, null);
    else for (const n of Object.keys(delPatron)) setCorreccionPatron(master.id, n, null);
    setEditMode(false);
  };

  return (
    <div className="cfg-tab-content" data-testid="cfg-calibracion-patron">
      <h3 className="cfg-section-title">Calibración del patrón</h3>
      <dl className="cfg-kv">
        <dt>Patrón</dt>
        <dd><code>{master.id}</code></dd>
        <dt>Esta variante</dt>
        <dd data-testid="cfg-calibracion-estado" className={!exc && hayPatron && !medida ? 'cfg-tab-note-warn' : ''}>{estado}</dd>
      </dl>
      {!def.ok && <div className="cfg-tab-note cfg-tab-note-error">Sin definición efectiva: {def.motivo}</div>}
      <div className="cfg-tab-hint">
        Corrección de cada boca respecto de su boca nominal, en sus propios ejes (lateral, vertical, axial = normal saliente).
        Vale igual para todas las variantes del patrón; no se escala con el ancho. No hay marco del modelo: girar malla y bocas
        juntas no cambia la pieza colocada.
      </div>

      {!editMode ? (
        <>
          <table className="cfg-table">
            <thead>
              <tr><th>Boca</th><th>Desplaz. lat / vert / axial (mm)</th><th>Giro lat / vert / axial (°)</th></tr>
            </thead>
            <tbody>
              {nombres.map((n) => {
                const c = vigente[n];
                return (
                  <tr key={n} className={esCorreccionNula(c) ? 'cfg-table-muted' : ''}>
                    <td><code>{n}</code></td>
                    <td>{c ? EJES.map((e) => fmt(c.desplazamiento_mm[e])).join(' / ') : '—'}</td>
                    <td>{c ? EJES.map((e) => fmt(c.giro_deg[e])).join(' / ') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="cfg-actions">
            <button type="button" className="cfg-btn" onClick={startEdit} data-testid="cfg-edit-orientacion">Editar calibración…</button>
            {(exc || hayPatron) && (
              <button type="button" className="cfg-btn cfg-btn-danger" onClick={reset} data-testid="cfg-reset-orientacion">
                {exc ? 'Quitar la excepción de esta variante' : 'Quitar la calibración del patrón'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <table className="cfg-table">
            <thead>
              <tr>
                <th>Boca</th>
                {EJES.map((e) => <th key={`d${e}`}>Desplaz. {e} (mm)</th>)}
                {EJES.map((e) => <th key={`g${e}`}>Giro {e} (°)</th>)}
              </tr>
            </thead>
            <tbody>
              {nombres.map((n) => {
                const dr = draft[n];
                if (!dr) return null;
                const campo = (tipo: 'd' | 'g', e: Eje) => (
                  <td key={`${tipo}${e}`}>
                    <input
                      type="number"
                      step={tipo === 'd' ? 0.1 : 1}
                      value={dr[tipo][e]}
                      onChange={(ev) => setDraft({ ...draft, [n]: { ...dr, [tipo]: { ...dr[tipo], [e]: ev.target.value } } })}
                      className="cfg-filter-input"
                      data-testid={tipo === 'g' && e === 'axial' ? `cfg-port-rot-${n}` : `cfg-port-${tipo === 'd' ? 'desp' : 'giro'}-${e}-${n}`}
                    />
                  </td>
                );
                return (
                  <tr key={n}>
                    <td><code>{n}</code></td>
                    {EJES.map((e) => campo('d', e))}
                    {EJES.map((e) => campo('g', e))}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <label className="cfg-field">
            <input type="checkbox" checked={comoExcepcion} onChange={(e) => setComoExcepcion(e.target.checked)} data-testid="cfg-calibracion-excepcion" />
            <span className="cfg-field-label"> Esta variante necesita otra corrección: declararla como excepción (no cambia el patrón)</span>
          </label>
          <label className="cfg-field">
            <span className="cfg-field-label">Motivo (≥ 10 caracteres, se persiste como auditoría)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="cfg-filter-input"
              placeholder="Ej.: medición en campo 2026-11, la boca P3 estaba 4 mm hacia afuera."
              data-testid="cfg-orientacion-reason"
            />
          </label>
          {error && <div className="cfg-tab-note cfg-tab-note-error">{error}</div>}
          <div className="cfg-actions">
            <button type="button" className="cfg-btn cfg-btn-primary" onClick={applyEdit} data-testid="cfg-apply-orientacion">Aplicar</button>
            <button type="button" className="cfg-btn" onClick={() => setEditMode(false)}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}
