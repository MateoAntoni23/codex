import { TrayWorkspace } from './tray/TrayWorkspace';
import { UnifiedWorkspace } from './workspace/UnifiedWorkspace';
import { useEffect } from 'react';
import './styles/global.css';
import { Layout } from './ui/Layout';
import { PreviewLayout } from './preview/PreviewLayout';
import { PilotLayout } from './pilot/PilotLayout';
import { ParametricLayout } from './parametric/ParametricLayout';
import { initProject } from './persistence/projectManager';
import { useSceneStore } from './store/sceneStore';

// Editor normal: inicia persistencia y carga desde IndexedDB.
function EditorApp() {
  useEffect(() => {
    const { cancel } = initProject(useSceneStore);
    return cancel;
  }, []);

  return <Layout />;
}

// Vista de prueba v2: sin persistencia, sin auto-guardado, datos en memoria.
function PreviewApp() {
  return <PreviewLayout />;
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const ws = params.get('workspace');
  if (ws === 'bandejas') return <UnifiedWorkspace />;
  if (ws === 'bandejas-legacy') return <TrayWorkspace />;

  // Vista experimental de geometría piloto. Aislada: no sustituye geometría
  // de proyectos existentes ni toca el catálogo.
  if (params.get('pilot') === 'v1') return <PilotLayout />;

  // Vista experimental de catálogo paramétrico STP-Z 300 (GLB reconstruidos).
  if (params.get('pilot') === 'step') return <ParametricLayout />;

  const isPreview = params.get('preview') === 'v2';
  return isPreview ? <PreviewApp /> : <EditorApp />;
}
