/**
 * Selector de pieza en tres pasos (A2): tipo → ancho → variante, y dentro de la
 * variante espesor y acabado. Reemplaza la lista plana de códigos del panel de
 * continuación. Lo elegido resuelve un código exacto, que se muestra antes de
 * confirmar y es el que se computa.
 *
 *   - Por defecto, espesor y acabado de la pieza desde la que se continúa.
 *   - La marca de mezcla de acabados aparece ACÁ, antes de confirmar.
 *   - Los tipos que no se ofrecen desde esta boca se listan con el motivo: nunca
 *     una lista vacía sin explicación.
 *
 * Cada <option> lleva `data-productos` (los códigos que contiene), para elegir por
 * código en las pruebas.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../../tray/model';
import { mezclaDeAcabados } from '../mezclaAcabados';
import { MarcaMezcla } from '../stages/MarcaMezcla';
import {
  acabadosDe, agruparCandidatos, espesorDe, espesoresDe, porDefecto, productoDe, tiposAusentes, acabadoCodigo,
  type Candidato, type Variante,
} from './opcionesPieza';

const ids = (cs: readonly Candidato[]) => cs.map((c) => c.product.producto_id).join(' ');
const idsSi = (cs: readonly Candidato[], f: (c: Candidato) => boolean | undefined) => ids(cs.filter((c) => f(c)));
const textoEspesor = (e: number | null) => (e === null ? 'sin dato' : `${e} mm`);

export function SelectorPieza({ origen, candidatos, catalogo, pendientes, seleccionado, onElegir }: {
  origen: Product | null | undefined;
  candidatos: readonly Candidato[];
  catalogo: readonly Product[];
  pendientes: readonly Product[];
  seleccionado: string;
  onElegir: (productoId: string) => void;
}) {
  const tipos = useMemo(() => agruparCandidatos(candidatos, origen), [candidatos, origen]);
  const ausentes = useMemo(() => tiposAusentes(tipos, origen, catalogo, pendientes), [tipos, origen, catalogo, pendientes]);

  // Estado inicial desde lo ya elegido (si se vuelve al panel con un producto puesto).
  const inicial = useMemo(() => {
    for (const t of tipos) for (const a of t.anchos) for (const v of a.variantes) {
      const c = v.candidatos.find((x) => x.product.producto_id === seleccionado);
      if (c) return { tipo: t.clave, ancho: String(a.ancho), variante: v.clave, espesor: String(espesorDe(c.product)), acabado: acabadoCodigo(c.product) };
    }
    return { tipo: '', ancho: '', variante: '', espesor: '', acabado: '' };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tipo, setTipo] = useState(inicial.tipo);
  const [ancho, setAncho] = useState(inicial.ancho);
  const [variante, setVariante] = useState(inicial.variante);
  const [espesor, setEspesor] = useState(inicial.espesor);
  const [acabado, setAcabado] = useState(inicial.acabado);

  // Cada paso con una sola opción se resuelve solo.
  const t = tipos.find((x) => x.clave === tipo) ?? (tipos.length === 1 ? tipos[0] : undefined);
  const a = t ? (t.anchos.find((x) => String(x.ancho) === ancho) ?? (t.anchos.length === 1 ? t.anchos[0] : undefined)) : undefined;
  const v: Variante | undefined = a ? (a.variantes.find((x) => x.clave === variante) ?? (a.variantes.length === 1 ? a.variantes[0] : undefined)) : undefined;
  const def = v ? porDefecto(v, origen) : null;
  const esps = v ? espesoresDe(v) : [];
  const e = v ? (esps.find((x) => String(x) === espesor) !== undefined ? esps.find((x) => String(x) === espesor)! : def!.espesor) : null;
  const acs = v ? acabadosDe(v, e) : [];
  const ac = v ? (acs.includes(acabado) ? acabado : (acs.includes(def!.acabado) ? def!.acabado : acs[0])) : '';
  const elegido = v ? productoDe(v, e, ac) : null;
  const elegidoId = elegido?.product.producto_id ?? '';
  const mezcla = elegido && origen ? mezclaDeAcabados(origen, elegido.product) : null;

  // Sólo se cambia lo elegido si el operador tocó un paso o si lo elegido se resolvió en un
  // código: una preselección de afuera (p. ej. un clic en una boca) no se borra al montar.
  const [tocado, setTocado] = useState(false);
  useEffect(() => {
    if ((tocado || elegidoId) && elegidoId !== seleccionado) onElegir(elegidoId);
  }, [elegidoId, tocado]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (paso: 'tipo' | 'ancho' | 'variante', valor: string) => {
    setTocado(true);
    if (paso === 'tipo') { setTipo(valor); setAncho(''); setVariante(''); setEspesor(''); setAcabado(''); }
    if (paso === 'ancho') { setAncho(valor); setVariante(''); setEspesor(''); setAcabado(''); }
    if (paso === 'variante') { setVariante(valor); setEspesor(''); setAcabado(''); }
  };

  if (!tipos.length) {
    return (
      <div data-testid="selector-pieza-vacio" role="status" style={{ padding: '6px 8px', borderRadius: 3, fontSize: 11 }} className="tone-warn">
        <div><strong>Ninguna pieza se puede continuar desde esta boca.</strong></div>
        {ausentes.map((x) => <div key={x.tipo} data-testid="tipo-ausente">{x.texto}: {x.motivo}.</div>)}
        {!ausentes.length && <div>El catálogo no tiene continuaciones para esta boca.</div>}
      </div>
    );
  }

  return (
    <div data-testid="selector-pieza" style={{ display: 'grid', gap: 4 }}>
      <label className="stage-field">
        1. Tipo
        <select className="inspector-input" data-codex-routing-pieza-tipo value={t?.clave ?? ''} onChange={(ev) => elegir('tipo', ev.target.value)}>
          {!t && <option value="">— Elegí el tipo —</option>}
          {tipos.map((x) => (
            <option key={x.clave} value={x.clave}
              data-productos={ids(x.anchos.flatMap((y) => y.variantes.flatMap((z) => z.candidatos)))}
              data-excepciones={idsSi(x.anchos.flatMap((y) => y.variantes.flatMap((z) => z.candidatos)), (c) => c.excepcion)}
              data-sin-modelo={idsSi(x.anchos.flatMap((y) => y.variantes.flatMap((z) => z.candidatos)), (c) => c.sinModelo)}>
              {x.texto}{x.soloOtroAcabado ? ' — sólo en otro acabado (mezcla)' : ''}
            </option>
          ))}
        </select>
      </label>
      {t && (
        <label className="stage-field">
          2. Ancho
          <select className="inspector-input" data-codex-routing-pieza-ancho value={a ? String(a.ancho) : ''} onChange={(ev) => elegir('ancho', ev.target.value)}>
            {!a && <option value="">— Elegí el ancho —</option>}
            {t.anchos.map((x) => (
              <option key={String(x.ancho)} value={String(x.ancho)} data-productos={ids(x.variantes.flatMap((z) => z.candidatos))}>
                {x.ancho === null ? 'sin ancho' : `${x.ancho} mm`}
              </option>
            ))}
          </select>
        </label>
      )}
      {a && (
        <label className="stage-field">
          3. Variante
          <select className="inspector-input" data-codex-routing-pieza-variante value={v?.clave ?? ''} onChange={(ev) => elegir('variante', ev.target.value)}>
            {!v && <option value="">— Elegí la variante —</option>}
            {a.variantes.map((x) => (
              <option key={x.clave} value={x.clave} data-productos={ids(x.candidatos)}>{x.texto}</option>
            ))}
          </select>
        </label>
      )}
      {v && (
        <div style={{ display: 'flex', gap: 6 }}>
          <label className="stage-field" style={{ flex: 1 }}>
            Espesor
            <select className="inspector-input" data-codex-routing-pieza-espesor value={String(e)} onChange={(ev) => { setTocado(true); setEspesor(ev.target.value); setAcabado(''); }}>
              {esps.map((x) => (
                <option key={String(x)} value={String(x)} data-productos={ids(v.candidatos.filter((c) => espesorDe(c.product) === x))}>{textoEspesor(x)}</option>
              ))}
            </select>
          </label>
          <label className="stage-field" style={{ flex: 1 }}>
            Acabado
            <select className="inspector-input" data-codex-routing-pieza-acabado value={ac} onChange={(ev) => { setTocado(true); setAcabado(ev.target.value); }}>
              {acs.map((x) => {
                const cand = productoDe(v, e, x);
                const mz = cand && origen ? mezclaDeAcabados(origen, cand.product) : null;
                return (
                  <option key={x} value={x} data-productos={cand ? cand.product.producto_id : ''}>
                    {x}{mz ? ' — mezcla de acabados' : ''}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      )}
      {elegido && (
        <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="selector-pieza-codigo">
          Se computa: <strong data-codex-routing-codigo>{String(elegido.product.sku ?? elegido.product.producto_id)}</strong>
          {elegido.excepcion ? ' — excepción con motivo (compatibilidad no documentada)' : ''}
          {elegido.sinModelo ? ' — sin modelo paramétrico (se dibuja esquemática)' : ''}
        </div>
      )}
      {mezcla && <MarcaMezcla mezcla={mezcla} testid="selector-pieza-mezcla" bloque />}
      {ausentes.length > 0 && (
        <details className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="tipos-ausentes">
          <summary>No se ofrecen desde esta boca ({ausentes.length})</summary>
          {ausentes.map((x) => <div key={x.tipo} data-testid="tipo-ausente">{x.texto}: {x.motivo}.</div>)}
        </details>
      )}
    </div>
  );
}
