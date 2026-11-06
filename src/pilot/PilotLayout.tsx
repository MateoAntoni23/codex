/**
 * PilotLayout — vista de prueba de la geometría piloto.
 *
 * - Sin persistencia. Sin impacto en proyectos existentes.
 * - Un banner deja explícita la naturaleza experimental (geometría piloto).
 * - Grilla al piso + marcador de origen para dar referencia de escala.
 */

import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { PilotSceneObjects } from './PilotSceneObjects';
import { PilotElementList } from './PilotElementList';
import { PilotInspector } from './PilotInspector';
import { usePilotStore } from './usePilotStore';

export function PilotLayout() {
  const clearSelection = usePilotStore((s) => s.clearSelection);
  const resetAll = usePilotStore((s) => s.resetAll);

  return (
    <div className="preview-layout pilot-layout">
      <div className="preview-banner pilot-banner" role="status">
        <span>
          Vista experimental — geometría piloto · datos auditados ({`V1–V6 PASS`}) · no modifica
          proyectos ni catálogo
        </span>
        <button
          type="button"
          className="btn-secondary preview-reset-btn"
          onClick={resetAll}
        >
          Restablecer vista
        </button>
      </div>

      <div className="panel panel-left">
        <PilotElementList />
      </div>

      <div className="canvas-wrapper">
        <Canvas
          shadows
          camera={{ position: [5, 4, 8], fov: 45 }}
          onPointerMissed={clearSelection}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 15, 10]} intensity={1.0} />
          <Grid
            args={[30, 30]}
            cellSize={0.5}
            cellThickness={0.4}
            cellColor="#333355"
            sectionSize={1}
            sectionThickness={1}
            sectionColor="#5566aa"
            fadeDistance={30}
            followCamera={false}
            infiniteGrid={false}
          />
          <PilotSceneObjects />
          <OrbitControls makeDefault />
        </Canvas>
      </div>

      <PilotInspector />
    </div>
  );
}
