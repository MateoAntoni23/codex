/**
 * A1 (interfaz, 2026-11-14): lo que se puede hacer con la pieza seleccionada, en
 * el inspector — continuar desde cada extremo libre, derivación en este tramo,
 * mover, rotar, enlazar un equipo y medir desde acá. Las acciones que abren un
 * formulario lo abren con ESTA pieza ya elegida. Las herramientas de la barra
 * siguen existiendo.
 */
import { useMemo } from 'react';
import type { Piece, Product } from '../../tray/model';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { useRoutingStore } from '../useRoutingStore';
import { useUiStore } from './uiStore';
import { extremosLibres } from '../derivacion/extremosLibres';
import { familiaDe } from '../derivacion/enganche';
import { placedOf } from '../placement/definitions';
import { indexProducts, portLabel } from './displayNames';

export function AccionesPieza({ piece }: { piece: Piece }) {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const trayMoveMode = useWorkspaceStore((s) => s.trayMoveMode);
  const setTrayMoveMode = useWorkspaceStore((s) => s.setTrayMoveMode);
  const trayRotateMode = useWorkspaceStore((s) => s.trayRotateMode);
  const setTrayRotateMode = useWorkspaceStore((s) => s.setTrayRotateMode);
  const abrir = useUiStore((s) => s.abrirFormulario);
  const idx = useMemo(() => indexProducts(context?.productos), [context]);
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  if (!entrada) return null;

  const libres = extremosLibres(entrada).filter((f) => f.pieceId === piece.instancia_id);
  const esRecto = productos.get(piece.producto_id)?.tipo_pieza === 'recta' && typeof piece.longitud_mm === 'number';
  const def = placedOf(entrada, piece)?.def;
  const admiteDerivacion = esRecto && !!def && familiaDe(def) !== null;
  const primeraBoca = Object.keys(piece.puertos)[0];

  const continuar = (f: (typeof libres)[number]) => {
    abrir(null);
    useWorkspaceStore.getState().deactivateConnectionTool();
    const rs = useRoutingStore.getState();
    rs.activate();
    rs.selectStartPort(f);
  };

  return (
    <div className="inspector-acciones" data-testid="acciones-pieza" role="group" aria-label="Acciones con esta pieza">
      {libres.map((f) => (
        <button key={f.portName} type="button" data-testid="accion-pieza-continuar" data-boca={f.portName} onClick={() => continuar(f)}
          title="Continuar el trazado desde este extremo libre">
          ↗ Continuar desde {f.portName.startsWith('enganche:') ? 'la boca de la derivación' : portLabel(piece.producto_id, f.portName, idx)}
        </button>
      ))}
      {admiteDerivacion && (
        <button type="button" data-testid="accion-pieza-derivacion" onClick={() => abrir({ tipo: 'derivacion', tronco: piece.instancia_id })}
          title="Abrir una derivación sobre el flanco de este tramo, sin cortarlo">
          Derivación en este tramo
        </button>
      )}
      <button type="button" data-testid="tray-move-toggle" className={trayMoveMode ? 'tone-ok' : undefined} aria-pressed={trayMoveMode}
        onClick={() => setTrayMoveMode(!trayMoveMode)} title="Mostrar/ocultar el gizmo XYZ para mover la pieza completa">
        {trayMoveMode ? '✥ Mover tramo (activo — Esc)' : '✥ Mover tramo'}
      </button>
      <button type="button" data-testid="tray-rotate-toggle" className={trayRotateMode ? 'tone-ok' : undefined} aria-pressed={trayRotateMode}
        onClick={() => setTrayRotateMode(!trayRotateMode)} title="Mostrar/ocultar la rotación de la pieza">
        {trayRotateMode ? '⟳ Rotar tramo (activo — Esc)' : '⟳ Rotar tramo'}
      </button>
      {esRecto && (
        <button type="button" data-testid="accion-pieza-enlazar" onClick={() => abrir({ tipo: 'enlace', tronco: piece.instancia_id })}
          title="Enlazar un equipo con la bandeja desde este tramo">
          Enlazar un equipo
        </button>
      )}
      {primeraBoca && (
        <button type="button" data-testid="accion-pieza-medir" onClick={() => abrir({ tipo: 'medir', origen: { pieza: piece.instancia_id, boca: primeraBoca } })}
          title="Medir el recorrido desde una boca de esta pieza">
          Medir desde acá
        </button>
      )}
    </div>
  );
}
