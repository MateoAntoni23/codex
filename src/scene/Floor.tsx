import { Grid } from '@react-three/drei';
import type { DomainObject } from '../types/domain';
import { floorRenderProps } from './coords';

interface Props {
  obj: DomainObject;
}

// Piso plano. Delega el cálculo de posición y tamaño a floorRenderProps
// para que sea verificable sin renderizar el componente.
// La grilla tiene celdas de 1 m (= 1 000 mm).
export function Floor({ obj }: Props) {
  const { position, planeArgs } = floorRenderProps(obj);

  return (
    <>
      <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={planeArgs} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <Grid
        position={position}
        args={planeArgs}
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
