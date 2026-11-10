/**
 * Sincroniza la etapa con la selección y limpia las herramientas al salir.
 *
 *  - Selección que pertenece a otra etapa → cambio automático de etapa (3b, ver
 *    `stageForSelection`). Vale para selecciones hechas en la escena, en una lista
 *    o desde el código (pruebas que eligen el puerto de partida vía __codex).
 *  - Salir de Bandejas desactiva "Continuar", "Unir extremos" y "Mover tramo";
 *    salir de Equipos/Planta apaga "Mover". Así ninguna herramienta de otra etapa
 *    queda activa ni visible (B1).
 */
import { useEffect } from 'react';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { useRoutingStore } from '../useRoutingStore';
import { stageForSelection, type SelectionKind } from './stageModel';
import { useUiStore } from './uiStore';

function follow(kind: SelectionKind) {
  const ui = useUiStore.getState();
  const next = stageForSelection(ui.stage, kind);
  if (next !== ui.stage) ui.setStage(next);
}

export function useStageSync(): void {
  useEffect(() => {
    const unsubWs = useWorkspaceStore.subscribe((s, prev) => {
      if (s.selectedImportedEquipoId && s.selectedImportedEquipoId !== prev.selectedImportedEquipoId) follow('imported');
      if (s.selectedEquipId && s.selectedEquipId !== prev.selectedEquipId) {
        const el = s.elements.find((e) => e.id === s.selectedEquipId);
        follow(el?.category === 'infrastructure' ? 'infrastructure' : 'equipment');
      }
      if (s.selectedTrayId && s.selectedTrayId !== prev.selectedTrayId) follow('piece');
      if (s.selectedSupportId && s.selectedSupportId !== prev.selectedSupportId) follow('support');
      if (s.connectionToolActive && !prev.connectionToolActive) follow('join-tool');
    });
    const unsubRouting = useRoutingStore.subscribe((s, prev) => {
      if ((s.active && !prev.active) || (s.startPort && s.startPort !== prev.startPort)) follow('routing');
    });
    const unsubUi = useUiStore.subscribe((s, prev) => {
      if (s.stage === prev.stage) return;
      if (prev.stage === 'bandejas') {
        if (useRoutingStore.getState().active) useRoutingStore.getState().deactivate();
        const ws = useWorkspaceStore.getState();
        if (ws.connectionToolActive) ws.deactivateConnectionTool();
        if (ws.trayMoveMode) ws.setTrayMoveMode(false);
        if (s.bandejasTool !== 'seleccionar') useUiStore.getState().setBandejasTool('seleccionar');
      }
      if ((prev.stage === 'equipos' || prev.stage === 'planta') && useWorkspaceStore.getState().moveMode) {
        useWorkspaceStore.getState().setMoveMode(false);
      }
    });
    return () => {
      unsubWs();
      unsubRouting();
      unsubUi();
    };
  }, []);
}
