import { TrayWorkspace } from './tray/TrayWorkspace';
import { UnifiedWorkspace } from './workspace/UnifiedWorkspace';
import { useEffect } from 'react';
import './styles/global.css';
import { Layout } from './ui/Layout';
import { PreviewLayout } from './preview/PreviewLayout';
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
  const ws = new URLSearchParams(window.location.search).get("workspace");
  if (ws === "bandejas") return <UnifiedWorkspace />;
  if (ws === "bandejas-legacy") return <TrayWorkspace />;
  const isPreview =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('preview') === 'v2';

  return isPreview ? <PreviewApp /> : <EditorApp />;
}
