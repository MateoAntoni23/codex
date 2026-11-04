import type { DomainObject } from '../types/domain';
import { domainToViewerPosition, domainToViewerSize } from './coords';

interface Props {
  obj: DomainObject;
}

// Nave industrial: contorno wireframe.
// position es el centro → no se suma height/2 aquí.
export function Building({ obj }: Props) {
  const pos = domainToViewerPosition(obj.position);
  const size = domainToViewerSize(obj.dimensions);

  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshBasicMaterial color="#8899aa" wireframe />
    </mesh>
  );
}
