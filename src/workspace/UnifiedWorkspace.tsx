import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useRoutingStore } from './useRoutingStore';
import { WorkspaceScene } from './WorkspaceScene';
import { WorkspaceTree } from './WorkspaceTree';
import { WorkspaceInspector } from './WorkspaceInspector';
import { exportWorkspace, importWorkspace, extractMeta } from './workspaceFile';
import { RoutingStatusBadge } from './RoutingPanel';

function StatusBar() {
  const status               = useTrayStore((s) => s.status);
  const revision             = useTrayStore((s) => s.revision);
  const error                = useTrayStore((s) => s.error);
  const dirty                = useWorkspaceStore((s) => s.dirty);
  const fileName             = useWorkspaceStore((s) => s.fileName);
  const connectionToolActive = useWorkspaceStore((s) => s.connectionToolActive);
  const connectionPortA      = useWorkspaceStore((s) => s.connectionPortA);

  return (
    <div className="workspace-status" role="status">
      <span>Motor: <strong>{status}</strong> · rev {revision}</span>
      {fileName && <span> · {fileName}</span>}
      {connectionToolActive && (
        <span style={{ color: '#00ffcc', fontWeight: 600 }}>
          {' '}● Herramienta de conexión activa — {connectionPortA ? `A: ${connectionPortA[0]}.${connectionPortA[1]} → hacé clic en puerto B` : 'Hacé clic en un puerto (esferas)'}
        </span>
      )}
      <RoutingStatusBadge />
      {dirty && <span className="workspace-dirty"> ● cambios sin guardar</span>}
      {error && <span className="workspace-error"> ⚠ {error}</span>}
    </div>
  );
}

function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const ws   = useWorkspaceStore.getState();
    const tray = useTrayStore.getState();
    if (!tray.entrada) {
      alert('No hay trazado cargado para exportar.');
      return;
    }
    const json = exportWorkspace(ws.elements, ws.evidence, ws.projectMeta, tray.entrada);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const name = `workspace-${new Date().toISOString().slice(0, 10)}.json`;
    a.href     = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    ws.markSaved(name);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Confirm before replacing current work
    if (useWorkspaceStore.getState().dirty) {
      if (!confirm(`Hay cambios sin guardar. ¿Reemplazar con "${file.name}"?`)) {
        e.target.value = '';
        return;
      }
    } else if (!confirm(`¿Importar "${file.name}"? Se reemplazará el trabajo actual.`)) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      let ws;
      try {
        ws = importWorkspace(reader.result as string);
      } catch (err) {
        alert(`Error al importar: ${String(err)}`);
        e.target.value = '';
        return;
      }
      // All validation passed — now update both stores atomically
      const { elements, evidence } = ws.projectV2;
      useWorkspaceStore.getState().loadFile(elements, evidence, extractMeta(ws.projectV2), file.name);
      // importEdit resets tray state and clears history/future so undo can't reach the previous project
      useTrayStore.getState().importEdit(ws.trayInput);
      // Cancel any active routing session since the tray was replaced
      useRoutingStore.getState().deactivate();
      e.target.value = '';
    };
    reader.onerror = () => {
      alert('Error al leer el archivo.');
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="workspace-toolbar">
      <a href="?">← Editor guardado</a>
      <span className="workspace-toolbar-title">Espacio de trabajo unificado</span>
      <button onClick={() => void useTrayStore.getState().initialize()}>Reconectar motor</button>
      <button onClick={() => void useTrayStore.getState().calculate()}>Calcular trazado</button>
      <button onClick={handleExport}>Exportar JSON</button>
      <button onClick={() => fileInputRef.current?.click()}>Importar JSON</button>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
    </div>
  );
}

export function UnifiedWorkspace() {
  const selectEquip    = useWorkspaceStore((s) => s.selectEquip);
  const selectTray     = useWorkspaceStore((s) => s.selectTray);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const markDirty      = useWorkspaceStore((s) => s.markDirty);

  // Initialize motor connection on mount
  useEffect(() => {
    void useTrayStore.getState().initialize();
    const tick = setInterval(() => void useTrayStore.getState().initialize(), 30000);
    return () => clearInterval(tick);
  }, []);

  // Track tray changes as dirty (skip initial render)
  const trayRevision = useTrayStore((s) => s.revision);
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    markDirty();
  }, [trayRevision, markDirty]);

  const connectionToolActive     = useWorkspaceStore((s) => s.connectionToolActive);
  const deactivateConnectionTool = useWorkspaceStore((s) => s.deactivateConnectionTool);
  const selectSupport            = useWorkspaceStore((s) => s.selectSupport);
  const selectedSupportId        = useWorkspaceStore((s) => s.selectedSupportId);
  const routingActive            = useRoutingStore((s) => s.active);
  const deactivateRouting        = useRoutingStore((s) => s.deactivate);

  const clearAll = () => {
    if (routingActive) { deactivateRouting(); return; }
    if (connectionToolActive) { deactivateConnectionTool(); return; }
    if (selectedEquipId) selectEquip(null);
    else if (selectedSupportId) selectSupport(null);
    else selectTray(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="unified-workspace">
      <Toolbar />
      <StatusBar />

      <div className="unified-workspace-body">
        <aside className="unified-workspace-tree">
          <WorkspaceTree />
        </aside>

        <main className="unified-workspace-canvas">
          <Canvas shadows camera={{ position: [15, 12, 15], fov: 45 }} onPointerMissed={clearAll}>
            <WorkspaceScene />
            <OrbitControls makeDefault />
          </Canvas>
        </main>

        <aside className="unified-workspace-inspector">
          <WorkspaceInspector />
        </aside>
      </div>
    </div>
  );
}
