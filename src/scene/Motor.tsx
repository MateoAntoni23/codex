import type { DomainObject } from '../types/domain';

interface Props {
  obj: DomainObject;
  isSelected: boolean;
  onSelect: () => void;
}

// Motor eléctrico: cilindro
// Conversión mm → Three.js units (1 unidad = 1000 mm = 1 m):
//   posición Three.js = [x/1000, z/1000, y/1000]  (Z-up → Y-up)
//   radio Three.js    = width/2/1000
//   altura Three.js   = height/1000
export function Motor({ obj, isSelected, onSelect }: Props) {
  const { position: p, dimensions: d } = obj;
  const px = p.x / 1000;
  const py = p.z / 1000 + d.height / 1000 / 2;
  const pz = p.y / 1000;
  const radius = d.width / 2 / 1000;
  const height = d.height / 1000;

  return (
    <mesh
      position={[px, py, pz]}
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
