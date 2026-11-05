import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PreviewSceneObjects } from './PreviewSceneObjects';
import { PreviewElementList } from './PreviewElementList';
import { PreviewInspector } from './PreviewInspector';
import { usePreviewStore } from './usePreviewStore';

export function PreviewLayout() {
  const clearSelection = usePreviewStore((s) => s.clearSelection);
  const resetElements  = usePreviewStore((s) => s.resetElements);

  return (
    <div className="preview-layout">

      {/* Banner de advertencia + botón Restablecer */}
      <div className="preview-banner" role="status">
        <span>Vista de prueba v2 — no guarda cambios · los datos son de ejemplo</span>
        <button
          type="button"
          className="btn-secondary preview-reset-btn"
          onClick={resetElements}
        >
          Restablecer vista de prueba
        </button>
      </div>

      {/* Panel izquierdo: lista de elementos */}
      <div className="panel panel-left">
        <PreviewElementList />
      </div>

      {/* Canvas 3D */}
      <div className="canvas-wrapper">
        <Canvas
          shadows
          camera={{ position: [15, 12, 15], fov: 45 }}
          onClick={clearSelection}
        >
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[10, 20, 10]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          <PreviewSceneObjects />
          <OrbitControls makeDefault />
        </Canvas>
      </div>

      {/* Panel derecho: inspector con edición */}
      <PreviewInspector />
    </div>
  );
}
