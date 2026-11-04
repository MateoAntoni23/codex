import { Html, Line } from '@react-three/drei';
import { useSceneStore } from '../store/sceneStore';
import { domainToViewerPosition } from './coords';

// Longitud de cada eje visual en Three.js (metros).
// 1.5 m = 1 500 mm — visible a escala de la nave.
const L = 1.5;

// Ejes del dominio → Three.js (ver coords.ts):
//   X dominio → +X Three.js  (rojo)
//   Y dominio → −Z Three.js  (verde)
//   Z dominio → +Y Three.js  (azul)

export function OriginMarker() {
  const origin = useSceneStore((s) => s.projectOrigin);
  const pos = domainToViewerPosition(origin);

  return (
    <group position={pos}>
      {/* Eje X: dominio X → Three.js +X */}
      <Line points={[[0, 0, 0], [L, 0, 0]]} color="#ff4444" lineWidth={2} />
      {/* Eje Y: dominio Y → Three.js −Z */}
      <Line points={[[0, 0, 0], [0, 0, -L]]} color="#44cc66" lineWidth={2} />
      {/* Eje Z (vertical): dominio Z → Three.js +Y */}
      <Line points={[[0, 0, 0], [0, L, 0]]} color="#4488ff" lineWidth={2} />

      {/* Etiquetas */}
      <Html position={[L + 0.12, 0, 0]} style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#ff4444', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' }}>
          X
        </span>
      </Html>
      <Html position={[0, 0, -(L + 0.12)]} style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#44cc66', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' }}>
          Y
        </span>
      </Html>
      <Html position={[0, L + 0.12, 0]} style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#4488ff', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' }}>
          Z
        </span>
      </Html>

      {/* Punto central del origen */}
      <mesh>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}
