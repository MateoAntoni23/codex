import type { DomainObject } from '../types/domain';
import { domainToViewerPosition, domainToViewerSize } from './coords';

interface Props {
  obj: DomainObject;
  isSelected: boolean;
  onSelect: () => void;
}

// Tablero eléctrico: caja sólida.
// position es el centro → no se suma height/2 aquí.
export function ElectricalPanel({ obj, isSelected, onSelect }: Props) {
  const pos = domainToViewerPosition(obj.position);
  const size = domainToViewerSize(obj.dimensions);

  return (
    <mesh
      position={pos}
      castShadow
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color="#5577aa"
        emissive={isSelected ? '#223366' : '#000000'}
        emissiveIntensity={isSelected ? 2 : 0}
      />
    </mesh>
  );
}
