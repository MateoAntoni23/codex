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
  const isPreview =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('preview') === 'v2';

  return isPreview ? <PreviewApp /> : <EditorApp />;
}
