import { useEffect } from 'react';
import './styles/global.css';
import { Layout } from './ui/Layout';
import { initProject } from './persistence/projectManager';
import { useSceneStore } from './store/sceneStore';

export function App() {
  useEffect(() => {
    void initProject(useSceneStore);
  }, []);

  return <Layout />;
}
