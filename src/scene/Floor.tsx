import { Grid } from '@react-three/drei';
import type { DomainObject } from '../types/domain';
import { domainToViewerPosition, domainToViewerSize } from './coords';

interface Props {
  obj: DomainObject;
}

// Piso plano. position.z = 0 → Y Three.js = 0 (nivel del piso).
// La grilla tiene celdas de 1 m (= 1 000 mm).
export function Floor({ obj }: Props) {
  const [px, , pz] = domainToViewerPosition(obj.position);
  const [sw, , sd] = domainToViewerSize(obj.dimensions);
  // sw = ancho en X (m), sd = profundidad en Z (m)

  return (
    <>
      <mesh position={[px, 0, pz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[sw, sd]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <Grid
        position={[px, 0, pz]}
        args={[sw, sd]}
        cellSize={1}
        cellThickness={0.4}
        cellColor="#444466"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#6666aa"
        fadeDistance={60}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />
    </>
  );
}
