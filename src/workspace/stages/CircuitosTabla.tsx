/**
 * Resultados — tabla de circuitos guardados: una fila por circuito con nombre,
 * equipo de origen y de destino, longitud total (mm) desglosada en bandeja y
 * bajadas, y cantidad de piezas, más su estado. Un circuito desactualizado
 * (equipo movido o borrado, enlace cambiado, pieza movida, rotada o borrada,
 * longitud cambiada, unión rota) lo dice con el motivo y conserva lo guardado:
 * recalcular es un botón, no algo que pase solo.
 *
 * Etapa 2: cada circuito muestra su cable y su cantidad. Sin cable no es un
 * error: queda "incompleto" y se dice qué le falta para poder calcular. El cable
 * se elige o se cambia acá mismo ("Elegir cable" / "Cambiar cable").
 *
 * "Copiar tabla" copia texto separado por tabulaciones (se pega directo en una
 * planilla), con coma decimal y sin separador de miles.
 */
import { Fragment, useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import {
  asignarCable, borrarCircuito, circuitosOf, estadoCircuito, faltaParaCalcular, quitarCable, recalcularCircuito, type CircuitoGuardado,
} from '../recorridos/circuitosGuardados';
import { textoCable } from '../cables/catalogoCables';
import { CableCircuitoCampos, cableDesdeValor, useCatalogoCables, valorDesdeCable, type ValorCable } from './CableCircuitoCampos';
import { indexProducts, pieceLabelById } from './displayNames';
import { Empty, Section } from './shared';

const num = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1, useGrouping: false });
const mmPantalla = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function CircuitosTabla() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayEdit = useTrayStore((s) => s.edit);
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const elements = useWorkspaceStore((s) => s.elements);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; valor: ValorCable } | null>(null);
  const { cables, motivo: sinCatalogo } = useCatalogoCables();
  const ids = sinCatalogo ? undefined : cables.map((c) => c.cable_id);
  const cableTexto = (c: CircuitoGuardado) => {
    if (!c.cable) return 'sin cable';
    const k = cables.find((x) => x.cable_id === c.cable!.cable_id);
    return k ? textoCable(k) : c.cable.cable_id;
  };
  const piezas = entrada?.piezas ?? [];
  const circuitos = circuitosOf(entrada);

  const etiquetaPieza = (id: string) => (piezas.some((p) => p.instancia_id === id) ? pieceLabelById(id, piezas, idx) : id);
  const nombreEquipo = (id: string) => elements.find((e) => e.id === id)?.name ?? `${id} (ya no existe)`;

  const filas = circuitos.map((c) => ({
    c,
    estado: entrada ? estadoCircuito(entrada, elements, c, etiquetaPieza) : { vigente: true as const },
    falta: faltaParaCalcular(c, ids),
  }));
  const parcial = (x: number, pantalla: boolean) => (pantalla ? mmPantalla(x) : num(x));

  const longitudTexto = (c: CircuitoGuardado, pantalla: boolean) =>
    c.completa ? (pantalla ? mmPantalla(c.sumaMm) : num(c.sumaMm)) : `incompleta (≥ ${pantalla ? mmPantalla(c.sumaMm) : num(c.sumaMm)})`;

  const tsv = () => [
    ['Nombre', 'Origen', 'Destino', 'Cable', 'Cantidad', 'Longitud total (mm)', 'Bandeja (mm)', 'Bajadas (mm)', 'Piezas', 'Estado'].join('\t'),
    ...filas.map(({ c, estado, falta }) => [
      c.nombre, nombreEquipo(c.origen.equipo), nombreEquipo(c.destino.equipo),
      cableTexto(c), c.cable ? String(c.cable.cantidad) : '', longitudTexto(c, false),
      parcial(c.bandejaMm, false), parcial(c.bajadasMm, false), String(c.cruces.length),
      [estado.vigente ? 'vigente' : `desactualizado: ${estado.motivos.join('; ')}`, ...(falta.length ? [`incompleto: ${falta.join('; ')}`] : [])].join('; '),
    ].join('\t')),
  ].join('\r\n'); // CRLF: lo que espera una planilla en Windows (el portapapeles de Windows lo convierte igual)

  const copiar = async () => {
    const texto = tsv();
    try {
      await navigator.clipboard.writeText(texto);
      setMsg(`Tabla copiada (${filas.length} circuito(s)). Pegala en la planilla.`);
    } catch {
      setMsg('No se pudo copiar al portapapeles: el navegador no lo permitió.');
    }
  };

  const recalcular = (id: string) => {
    if (!entrada) return;
    const r = recalcularCircuito(entrada, elements, id);
    if (!r.ok) { setMsg(`No se pudo recalcular: ${r.motivo}.`); return; }
    trayEdit(r.entrada);
    markDirty();
    setMsg('Circuito recalculado con el trazado actual.');
  };
  const guardarCable = () => {
    if (!entrada || !editando) return;
    const k = cableDesdeValor(editando.valor);
    if (!k.ok) { setMsg(`No se pudo guardar el cable: ${k.motivo}.`); return; }
    if (!k.cable) {
      trayEdit(quitarCable(entrada, editando.id));
      markDirty();
      setEditando(null);
      setMsg('Cable quitado: el circuito queda incompleto.');
      return;
    }
    const r = asignarCable(entrada, editando.id, k.cable, ids);
    if (!r.ok) { setMsg(`No se pudo guardar el cable: ${r.motivo}.`); return; }
    trayEdit(r.entrada);
    markDirty();
    setEditando(null);
    setMsg('Cable guardado.');
  };
  const borrar = (id: string) => {
    if (!entrada) return;
    trayEdit(borrarCircuito(entrada, id));
    markDirty();
  };

  return (
    <Section title={`Circuitos (${circuitos.length})`} testid="circuitos-tabla">
      {circuitos.length === 0 && <Empty>Sin circuitos guardados: armalos entre dos equipos en Conexiones.</Empty>}
      {circuitos.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="stage-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Nombre</th>
                  <th style={{ textAlign: 'left' }}>Origen</th>
                  <th style={{ textAlign: 'left' }}>Destino</th>
                  <th style={{ textAlign: 'left' }}>Cable</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Longitud total (mm)</th>
                  <th style={{ textAlign: 'right' }}>Bandeja (mm)</th>
                  <th style={{ textAlign: 'right' }}>Bajadas (mm)</th>
                  <th style={{ textAlign: 'right' }}>Piezas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ c, estado, falta }) => (
                  <Fragment key={c.id}>
                  <tr data-testid="circuito-fila" data-vigente={estado.vigente ? 'true' : 'false'} data-completo={falta.length ? 'false' : 'true'} data-cable={c.cable?.cable_id ?? ''}>
                    <td>
                      <strong data-testid="circuito-nombre">{c.nombre}</strong>
                      {!estado.vigente && (
                        <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="circuito-desactualizado">
                          Desactualizado: {estado.motivos.join('; ')}.
                        </div>
                      )}
                      {falta.length > 0 && (
                        <div className="tone-warn" style={{ whiteSpace: 'normal' }} data-testid="circuito-incompleto-calculo">
                          Incompleto: {falta.join('; ')}.
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <button type="button" data-testid="circuito-cable-editar" onClick={() => setEditando({ id: c.id, valor: valorDesdeCable(cables, c.cable) })}>
                          {c.cable ? 'Cambiar cable' : 'Elegir cable'}
                        </button>
                        {!estado.vigente && <button type="button" data-testid="circuito-recalcular" onClick={() => recalcular(c.id)}>Recalcular</button>}
                        <button type="button" data-testid="circuito-borrar" onClick={() => borrar(c.id)}>Borrar</button>
                      </div>
                    </td>
                    <td data-testid="circuito-origen-equipo">{nombreEquipo(c.origen.equipo)}</td>
                    <td data-testid="circuito-destino-equipo">{nombreEquipo(c.destino.equipo)}</td>
                    <td data-testid="circuito-cable" className={c.cable ? undefined : 'tone-warn'}>{cableTexto(c)}</td>
                    <td style={{ textAlign: 'right' }} data-testid="circuito-cantidad">{c.cable ? c.cable.cantidad : '—'}</td>
                    <td style={{ textAlign: 'right' }} className={c.completa ? undefined : 'tone-warn'} data-testid="circuito-longitud">{longitudTexto(c, true)}</td>
                    <td style={{ textAlign: 'right' }} data-testid="circuito-bandeja">{parcial(c.bandejaMm, true)}</td>
                    <td style={{ textAlign: 'right' }} data-testid="circuito-bajadas" title={`origen ${mmPantalla(c.bajadas.origen.longitud_mm)} + destino ${mmPantalla(c.bajadas.destino.longitud_mm)}`}>{parcial(c.bajadasMm, true)}</td>
                    <td style={{ textAlign: 'right' }} data-testid="circuito-piezas">{c.cruces.length}</td>
                  </tr>
                  {editando?.id === c.id && (
                    <tr data-testid="circuito-cable-editor">
                      <td colSpan={10}>
                        <CableCircuitoCampos prefijo="editar" valor={editando.valor} onChange={(v) => setEditando({ id: c.id, valor: v })} />
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <button type="button" className="stage-primary" data-testid="circuito-cable-guardar" onClick={guardarCable}>Guardar cable</button>
                          <button type="button" data-testid="circuito-cable-cancelar" onClick={() => setEditando(null)}>Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" data-testid="circuitos-copiar" onClick={() => void copiar()} style={{ marginTop: 6 }}>Copiar tabla</button>
        </>
      )}
      {msg && <p className="stage-note" role="status" data-testid="circuitos-msg">{msg}</p>}
    </Section>
  );
}
