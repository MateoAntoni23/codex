/**
 * Inspector de una pieza de bandeja — «Por esta bandeja pasan» (etapa 4): circuitos y
 * tendidos que la atraviesan, con función, cable y cantidad, y la suma de diámetros por
 * grupo. «Ver circuito» lo resalta en la escena y abre su fila en Resultados › Circuitos.
 */
import { useMemo } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useCatalogoCables } from '../workspace/stages/CableCircuitoCampos';
import { useUiStore } from '../workspace/stages/uiStore';
import { textoCable } from '../workspace/cables/catalogoCables';
import { TEXTO_FUNCION } from '../workspace/recorridos/circuitosGuardados';
import { porBandeja, TEXTO_GRUPO, type Grupo } from './porBandeja';
import { useDeclarados } from '../conductores/store';
import { LINEA_DECLARADO } from '../conductores/biblioteca';

const mm = (x: number) => `${x.toLocaleString('es-AR', { maximumFractionDigits: 1 })} mm`;

export function PorEstaBandeja({ pieza }: { pieza: string }) {
  const entrada = useTrayStore((s) => s.entrada);
  const elements = useWorkspaceStore((s) => s.elements);
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const { cables } = useCatalogoCables();
  const declarados = useDeclarados();
  const resaltado = useUiStore((s) => s.circuitoResaltado);
  const r = useMemo(() => (entrada ? porBandeja(entrada, elements, catalog, cables, pieza, declarados) : null), [entrada, elements, catalog, cables, pieza, declarados]);
  if (!r) return null;

  const verCircuito = (id: string) => {
    const ui = useUiStore.getState();
    ui.resaltarCircuito(id);
    ui.verPestana('circuitos');
    requestAnimationFrame(() => document.querySelector(`[data-testid="circuito-fila"][data-circuito="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  return (
    <section style={{ padding: '4px 12px 8px' }} data-testid="por-esta-bandeja">
      <div className="inspector-title">Por esta bandeja pasan ({r.circuitos.length} circuito(s))</div>
      {r.circuitos.length === 0 && <div className="stage-row-sub">Ningún circuito guardado atraviesa esta pieza.</div>}
      {r.circuitos.map(({ circuito: c, vigente, items }) => (
        <div key={c.id} className="stage-card" data-testid="pasa-circuito" data-circuito={c.id} data-resaltado={resaltado === c.id ? 'true' : 'false'}>
          <div className="stage-card-head">
            <strong>{c.nombre}</strong>
            {!vigente && <span className="stage-badge tone-warn">desactualizado</span>}
            <button type="button" data-testid="pasa-ver-circuito" onClick={() => verCircuito(c.id)}>Ver circuito</button>
          </div>
          {items.map((k, i) => (
            <div key={k.tendidoId ?? i} className="stage-row-sub" style={{ whiteSpace: 'normal' }} data-testid="pasa-item" data-tendido={k.tendidoId ?? ''} data-grupo={k.grupo ?? ''} data-declarado={k.declarado?.cable_id ?? ''}>
              {k.tendidoId ? `${k.tendidoId} · ` : ''}{k.funcion ? TEXTO_FUNCION[k.funcion] : 'sin función'} · {k.declarado ? `${k.declarado.designacion} (${LINEA_DECLARADO.toLowerCase()})` : k.cable ? textoCable(k.cable) : 'sin cable de catálogo'}
              {k.cantidad ? ` × ${k.cantidad}` : ''}
              {k.diametroMm !== null ? ` · Ø ${mm(k.diametroMm)}${k.declarado ? ' (declarado)' : ''}` : ''}
              {k.fueraDeLaSuma && <span className="tone-warn" data-testid="pasa-fuera"> — no entra en la suma: {k.fueraDeLaSuma}</span>}
            </div>
          ))}
        </div>
      ))}
      {r.circuitos.length > 0 && (
        <div style={{ marginTop: 4 }} data-testid="pasa-sumas">
          {(['potencia', 'resto'] as Grupo[]).map((g) => (
            <div key={g} data-testid={`pasa-suma-${g}`}>
              Σ diámetros, {TEXTO_GRUPO[g]}: <strong>{mm(r.sumas[g].diametrosMm)}</strong> ({r.sumas[g].cables} cable(s))
            </div>
          ))}
          <div className="stage-row-sub" style={{ whiteSpace: 'normal' }}>
            Cálculo de la app: Σ diámetro exterior × cantidad (el del catálogo o, en un cable declarado por el operador, el declarado).{r.fueraDeLaSuma ? ` ${r.fueraDeLaSuma} ítem(s) fuera de la suma, con el motivo.` : ''} El PE del trazado no es un circuito: lo cuenta el motor.
          </div>
        </div>
      )}
    </section>
  );
}
