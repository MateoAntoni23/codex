/**
 * ParametricLayout — vista experimental de catálogo paramétrico STP-Z 300.
 *
 * Carga los GLB generados por tools/step_parametric/build_all.py desde
 * /parametric/*. No modifica proyectos existentes ni el catálogo operativo.
 */

import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { ParametricSidebar } from './ParametricSidebar';
import { ParametricInspector } from './ParametricInspector';
import { ParametricScene } from './ParametricScene';
import { useParametricStore } from './useParametricStore';

export function ParametricLayout() {
  const reset = useParametricStore((s) => s.reset);
  const clearPort = useParametricStore((s) => s.selectPort);

  return (
    <div className="preview-layout pilot-layout">
      <div className="preview-banner pilot-banner" role="status">
        <span>
          Vista experimental — catálogo paramétrico STP-Z 300 · GLB generados vs STEP original · no modifica proyectos ni motor
        </span>
        <button type="button" className="btn-secondary preview-reset-btn" onClick={reset}>
          Restablecer vista
        </button>
      </div>

      <div className="panel panel-left">
        <ParametricSidebar />
      </div>

      <div className="canvas-wrapper">
        <Canvas
          camera={{ position: [2.5, 1.8, 2.5], fov: 45, near: 0.01, far: 100 }}
          onPointerMissed={() => clearPort(null)}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 2]} intensity={0.9} />
          <Grid
            args={[20, 20]}
            cellSize={0.1}
            cellThickness={0.4}
            cellColor="#333355"
            sectionSize={1}
            sectionThickness={1}
            sectionColor="#5566aa"
            fadeDistance={15}
            followCamera={false}
            infiniteGrid={false}
          />
          <ParametricScene />
          <OrbitControls makeDefault />
        </Canvas>
      </div>

      <ParametricInspector />
    </div>
  );
}
