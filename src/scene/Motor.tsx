import type { DomainObject } from '../types/domain';
import { domainToViewerPosition, mmToUnits } from './coords';

interface Props {
  obj: DomainObject;
  isSelected: boolean;
  onSelect: () => void;
}

// Motor eléctrico: cilindro vertical.
// position es el centro → no se suma height/2 aquí.
// radio = width/2 (el motor se modela como cilindro circular).
export function Motor({ obj, isSelected, onSelect }: Props) {
  const pos = domainToViewerPosition(obj.position);
  const radius = mmToUnits(obj.dimensions.width / 2);
  const height = mmToUnits(obj.dimensions.height);

  return (
    <mesh
      position={pos}
      castShadow
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <cylinderGeometry args={[radius, radius, height, 24]} />
      <meshStandardMaterial
        color="#778866"
        emissive={isSelected ? '#224400' : '#000000'}
        emissiveIntensity={isSelected ? 2 : 0}
      />
    </mesh>
  );
}
