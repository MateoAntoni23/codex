import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { WorkspaceScene } from './WorkspaceScene';
import { WorkspaceTree } from './WorkspaceTree';
import { WorkspaceInspector } from './WorkspaceInspector';
import { exportWorkspace, importWorkspace } from './workspaceFile';

function StatusBar() {
  const status   = useTrayStore((s) => s.status);
  const revision = useTrayStore((s) => s.revision);
  const error    = useTrayStore((s) => s.error);
  const dirty    = useWorkspaceStore((s) => s.dirty);
  const fileName = useWorkspaceStore((s) => s.fileName);

  return (
    <div className="workspace-status" role="status">
      <span>Motor: <strong>{status}</strong> · rev {revision}</span>
      {fileName && <span> · {fileName}</span>}
      {dirty && <span className="workspace-dirty"> ● cambios sin guardar</span>}
      {error && <span className="workspace-error"> ⚠ {error}</span>}
    </div>
  );
}

function Toolbar() {
  const trayState     = useTrayStore.getState;
  const workStore     = useWorkspaceStore;
  const fileInputRef  = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const ws    = workStore.getState();
    const tray  = trayState();
    if (!tray.entrada) {
      alert('No hay trazado cargado para exportar');
      return;
    }
    const json     = exportWorkspace(ws.elements, ws.evidence, tray.entrada);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const name     = `workspace-${new Date().toISOString().slice(0, 10)}.json`;
    a.href         = url;
    a.download     = name;
    a.click();
    URL.revokeObjectURL(url);
    ws.markSaved(name);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const ws = importWorkspace(reader.result as string);
        workStore.getState().loadFile(ws.equipment, ws.evidence, file.name);
        // Load tray input, discard any previous result
        useTrayStore.getState().edit(ws.trayInput);
        alert(`Importado: ${file.name}`);
      } catch (err) {
        alert(`Error al importar: ${String(err)}`);
      }
      // Reset the input so the same file can be re-imported
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleCalculate = () => {
    void useTrayStore.getState().calculate();
  };

  const handleReconnect = () => {
    void useTrayStore.getState().initialize();
  };

  return (
    <div className="workspace-toolbar">
      <a href="?">← Editor guardado</a>
      <span className="workspace-toolbar-title">Espacio de trabajo unificado</span>
      <button onClick={handleReconnect}>Reconectar motor</button>
      <button onClick={handleCalculate}>Calcular trazado</button>
      <button onClick={handleExport}>Exportar JSON</button>
      <button onClick={() => fileInputRef.current?.click()}>Importar JSON</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </div>
  );
}

export function UnifiedWorkspace() {
  const selectEquip    = useWorkspaceStore((s) => s.selectEquip);
  const selectTray     = useWorkspaceStore((s) => s.selectTray);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);

  useEffect(() => {
    void useTrayStore.getState().initialize();
    const tick = setInterval(() => void useTrayStore.getState().initialize(), 30000);
    return () => clearInterval(tick);
  }, []);

  const clearAll = () => {
    if (selectedEquipId) selectEquip(null);
    else selectTray(null);
  };

  return (
    <div className="unified-workspace">
      <Toolbar />
      <StatusBar />

      <div className="unified-workspace-body">
        {/* Left panel: tree */}
        <aside className="unified-workspace-tree">
          <WorkspaceTree />
        </aside>

        {/* Canvas */}
        <main className="unified-workspace-canvas">
          <Canvas
            shadows
            camera={{ position: [15, 12, 15], fov: 45 }}
            onPointerMissed={clearAll}
          >
            <WorkspaceScene />
            <OrbitControls makeDefault />
          </Canvas>
        </main>

        {/* Right panel: inspector */}
        <aside className="unified-workspace-inspector">
          <WorkspaceInspector />
        </aside>
      </div>
    </div>
  );
}
