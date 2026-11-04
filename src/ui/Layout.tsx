import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { SceneObjects } from '../scene/SceneObjects';
import { SceneTree } from './SceneTree';
import { Inspector } from './Inspector';
import { ConductorBar } from './ConductorBar';
import { useSceneStore } from '../store/sceneStore';

export function Layout() {
  const clearSelection = useSceneStore((s) => s.clearSelection);

  return (
    <div className="app-layout">
      <SceneTree />

      <div className="canvas-wrapper">
        <Canvas
          shadows
          camera={{ position: [15, 12, 15], fov: 45 }}
          onClick={clearSelection}
        >
          {/* Iluminación */}
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[10, 20, 10]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />

          <SceneObjects />

          {/* makeDefault permite que OrbitControls sea el controlador principal */}
          <OrbitControls makeDefault />
        </Canvas>
      </div>

      <Inspector />
      <ConductorBar />
    </div>
  );
}
