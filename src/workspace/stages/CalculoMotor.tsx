/**
 * Resultados — el cálculo del motor (etapa 3, parte A, 2026-11-13).
 *
 *   - Qué circuitos viajan al motor y cuáles no, con su longitud y el motivo
 *     (maniobra e instrumentación: D-11; incompleto; desactualizado).
 *   - Lo que devuelve el motor, tal cual, con su procedencia: resumen
 *     (incumplimientos, decisiones que bloquean), ocupación y reserva por pieza,
 *     curvatura por circuito, masa por pieza, soportes (vanos) y PE. Un
 *     "pendiente de decisión" o un incumplimiento se muestra con su motivo y su
 *     identificador de decisión: nunca se traduce a un número propio.
 * La lógica de qué viaja está en `motor/paraMotor.ts`.
 */
import { useMemo } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { object } from '../../tray/model';
import { circuitosParaMotor, PE_CABLE_ID, PROCEDENCIA_SEPARADO } from '../motor/paraMotor';
import { circuitosOf } from '../recorridos/circuitosGuardados';
import { useCatalogoCables } from './CableCircuitoCampos';
import { textoCable } from '../cables/catalogoCables';
import { indexProducts, pieceLabelById } from './displayNames';
import { Empty, Section } from './shared';
import { explicacionDiscontinuosDe } from './resultPresentation';
import { incumplimientosExplicados } from './discontinuidades';
import { OcupacionSegregadaView, useOcupacionSegregada } from './BandaDivisoria';

type R = Record<string, unknown>;
const obj = (v: unknown): R => (object(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (v === null || v === undefined ? '—' : String(v));
const mm = (x: unknown) => (typeof x === 'number' ? `${x.toLocaleString('es-AR', { maximumFractionDigits: 1 })} mm` : '—');
const pct = (x: unknown) => (typeof x === 'number' ? `${x.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %` : '—');

/** Un bloqueo o un error del motor, con su identificador de decisión. */
function Bloqueo({ b }: { b: R }) {
  return (
    <span className="tone-warn" data-testid="motor-bloqueo" data-decision={str(b.decision_id)}>
      {str(b.codigo)}{b.decision_id ? ` (${String(b.decision_id)})` : ''}: {str(b.mensaje)}
    </span>
  );
}

export function CircuitosAlMotor() {
  const entrada = useTrayStore((s) => s.entrada);
  const elements = useWorkspaceStore((s) => s.elements);
  const { cables, motivo } = useCatalogoCables();
  const ids = motivo ? undefined : cables.map((c) => c.cable_id);
  const r = useMemo(() => (entrada ? circuitosParaMotor(entrada, elements, ids) : null), [entrada, elements, ids]);
  if (!entrada || circuitosOf(entrada).length === 0) return null;
  const nombre = new Map(circuitosOf(entrada).map((c) => [c.id, c.nombre]));
  const cableTexto = (id: string) => {
    const k = cables.find((c) => c.cable_id === id);
    return k ? textoCable(k) : id;
  };
  return (
    <Section title="Circuitos y el motor" testid="circuitos-motor">
      <p className="stage-note" style={{ whiteSpace: 'normal' }}>
        Viajan al motor los circuitos de potencia con cable. {PROCEDENCIA_SEPARADO} El PE viaja aparte, en su sección.
      </p>
      {r!.enviados.map((c) => (
        <div key={c.circuito_id} className="stage-card" data-testid="circuito-al-motor" data-circuito={c.circuito_id}>
          <strong>{nombre.get(c.circuito_id) ?? c.circuito_id}</strong> → motor: {cableTexto(c.cable_id)} × {c.cantidad}, {c.recorrido.length} pieza(s)
        </div>
      ))}
      {r!.noEnviados.map((c) => (
        <div key={c.id} className="stage-card" data-testid="circuito-no-motor" data-circuito={c.id}>
          <div><strong>{c.nombre}</strong> · longitud {c.completa ? mm(c.sumaMm) : `incompleta (≥ ${mm(c.sumaMm)})`} · <em>no se calcula</em></div>
          <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="circuito-no-motor-motivo">{c.motivo}</div>
        </div>
      ))}
    </Section>
  );
}

export function CalculoMotorSection() {
  const result = useTrayStore((s) => s.result);
  const status = useTrayStore((s) => s.status);
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const segregada = useOcupacionSegregada();
  if (!result) return null;
  const piezas = entrada?.piezas ?? [];
  const etiqueta = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  const nombre = new Map(circuitosOf(entrada).map((c) => [c.id, c.nombre]));
  const res = obj(result);
  const motor = obj(res.motor);
  const dec = obj(res.decisiones);
  const resumen = obj(res.resumen);
  const procedencia = `Calculado por el motor ${str(motor.nombre)} ${str(motor.version)} (contrato ${str(motor.contrato)}), decisiones ${str(dec.version)}.`;
  const circuitos = obj(res.circuitos);
  const ocupacion = obj(res.ocupacion);
  const cargas = obj(res.cargas_por_pieza);
  const pe = obj(res.pe);
  const peCable = obj(pe.cable);
  const cobertura = obj(pe.cobertura);
  const requisito = obj(pe.requisito);

  return (
    <Section title="Cálculo del motor" testid="calculo-motor">
      <p className="stage-note" data-testid="calculo-motor-procedencia">{procedencia}{status !== 'vigente' ? ' Resultado no vigente: recalcular.' : ''}</p>

      <div className="stage-card" data-testid="motor-resumen" data-estado={str(resumen.estado_trazado)}>
        <div><strong>Estado del trazado (motor):</strong> {str(resumen.estado_trazado)}</div>
        {incumplimientosExplicados(arr(resumen.incumplimientos).map(String), explicacionDiscontinuosDe(result, entrada, context?.productos)).map((x) => (
          <div key={x} className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="motor-incumplimiento">Incumplimiento: {x}</div>
        ))}
        {arr(resumen.decisiones_que_bloquean).map((x) => <div key={String(x)} className="tone-warn" data-testid="motor-decision-bloquea">Pendiente de decisión: {String(x)}</div>)}
        {arr(resumen.verificaciones_bloqueadas).map((x) => <div key={String(x)} className="tone-warn" data-testid="motor-verificacion-bloqueada">Sin verificar: {String(x)}</div>)}
        <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>{str(resumen.aviso)}</div>
      </div>

      <h4 className="stage-section-subtitle">Circuitos: recorrido y radio de curvatura</h4>
      {Object.keys(circuitos).length === 0 && <Empty>Ningún circuito viajó al motor.</Empty>}
      {Object.entries(circuitos).map(([id, c0]) => {
        const c = obj(c0);
        return (
          <div key={id} className="stage-card" data-testid="motor-circuito" data-circuito={id} data-recorrido={str(obj(c.recorrido).estado)}>
            <div><strong>{nombre.get(id) ?? id}</strong> · recorrido {str(obj(c.recorrido).estado)}</div>
            {arr(c.curvatura).map((k0, i) => {
              const k = obj(k0);
              return (
                <div key={i} className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="motor-curvatura" data-estado={str(k.estado)}>
                  {etiqueta(String(k.instancia))}: {str(k.estado)}
                  {k.radio_borde_interior_mm !== undefined ? ` · radio interior ${mm(k.radio_borde_interior_mm)}` : ''}
                  {k.detalle ? ` — ${String(k.detalle)}` : ''}
                </div>
              );
            })}
          </div>
        );
      })}

      <h4 className="stage-section-subtitle">Por pieza: ocupación, reserva y masa</h4>
      {Object.entries(ocupacion).map(([id, o0]) => {
        const secs = obj(obj(o0).secciones);
        const q = obj(cargas[id]);
        // Bandeja segregada: el motor no conoce la banda; su ocupación (sin banda) no se usa. La informa la app.
        const seg = segregada(id);
        return (
          <div key={id} className="stage-card" data-testid="motor-pieza" data-pieza={id}>
            <div><strong>{etiqueta(id)}</strong> · masa {typeof q.q_kg_m === 'number' ? `${q.q_kg_m} kg/m` : '—'} (cables {str(q.cables_potencia_kg_m)} + PE {str(q.pe_kg_m)} kg/m)</div>
            {seg && (
              <div className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="motor-ocupacion-reemplazada">
                Bandeja segregada: la ocupación de esta pieza la calcula la app; la del motor (sin la banda) no se usa.
              </div>
            )}
            {seg && <OcupacionSegregadaView o={seg} />}
            {!seg && Object.entries(secs).map(([nom, s0]) => {
              const s = obj(s0);
              const rsv = obj(s.reserva);
              const disp = obj(s.disposicion_potencia);
              return (
                <div key={nom} className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="motor-ocupacion" data-seccion={nom} data-estado={str(s.estado)}
                  data-ocupado={typeof s.ancho_ocupado_mm === 'number' ? s.ancho_ocupado_mm : ''} data-reserva-libre={typeof rsv.reserva_libre_pct === 'number' ? rsv.reserva_libre_pct : ''}>
                  {nom === 'pieza' ? '' : `${nom}: `}{str(s.estado)}
                  {s.estado === 'BLOQUEADO' ? <> — <Bloqueo b={obj(s.bloqueo)} /></> : s.estado === 'SIN_CABLES' ? '' : (
                    <> · ocupa {mm(s.ancho_ocupado_mm)} de {mm(s.ancho_referencia_mm)} ({str(s.base_ancho)})
                      · reserva libre {pct(rsv.reserva_libre_pct)} (pedida {pct(rsv.reserva_solicitada_pct)}; {rsv.cumple ? 'cumple' : 'no cumple'})
                      · {str(disp.metodo)} {arr(disp.decisiones).join(', ')}, {str(rsv.metodo)} {str(rsv.criterio)}</>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <h4 className="stage-section-subtitle">Soportes y vanos</h4>
      {arr(res.corridas).length === 0 && <Empty>Sin corridas con soportes.</Empty>}
      {arr(res.corridas).map((c0) => {
        const c = obj(c0);
        return (
          <div key={str(c.corrida_id)} className="stage-card" data-testid="motor-corrida" data-estado={str(c.estado)}>
            <div><strong>{str(c.corrida_id)}</strong> · {mm(c.longitud_mm)} · {str(c.estado)}</div>
            {arr(c.vanos).map((v0, i) => {
              const v = obj(v0);
              return (
                <div key={i} className="stage-row-sub" data-testid="motor-vano" data-estado={str(v.estado)}>
                  {arr(v.entre).join('–')}: luz {mm(v.luz_mm)}, carga {str(v.carga_kg_m)} kg/m · {str(v.estado)}
                </div>
              );
            })}
            {c.detalle ? <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>{String(c.detalle)}</div> : null}
          </div>
        );
      })}

      <h4 className="stage-section-subtitle">PE</h4>
      <div className="stage-card" data-testid="motor-pe" data-cobertura={str(cobertura.estado)}>
        <div>Requisito: {str(requisito.descripcion)} — {str(requisito.estado)} ({str(requisito.origen)})</div>
        <div>Cable: {str(peCable.cable_id ?? PE_CABLE_ID)} · sección {str(peCable.estado_seccion)} · color {str(peCable.estado_color)} · {str(peCable.estado_eleccion)}</div>
        <div>Cobertura: {str(cobertura.estado)} ({str(cobertura.piezas_requeridas)} pieza(s) requeridas)</div>
        {arr(peCable.observaciones).map((x) => <div key={String(x)} className="stage-row-sub" style={{ whiteSpace: 'normal' }}>{String(x)}</div>)}
      </div>
    </Section>
  );
}
