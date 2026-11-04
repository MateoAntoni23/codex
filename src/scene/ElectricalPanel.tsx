import type { DomainObject } from '../types/domain';

interface Props {
  obj: DomainObject;
  isSelected: boolean;
  onSelect: () => void;
}

// Tablero eléctrico: caja sólida
// Conversión mm → Three.js units (1 unidad = 1000 mm = 1 m):
//   posición Three.js = [x/1000, z/1000, y/1000]  (Z-up → Y-up)
//   tamaño Three.js   = [width/1000, height/1000, depth/1000]
export function ElectricalPanel({ obj, isSelected, onSelect }: Props) {
  const { position: p, dimensions: d } = obj;
  const px = p.x / 1000;
  const py = p.z / 1000 + d.height / 1000 / 2;
  const pz = p.y / 1000;
  const sx = d.width / 1000;
  const sy = d.height / 1000;
  const sz = d.depth / 1000;

  return (
    <mesh
      position={[px, py, pz]}
      castShadow
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <boxGeometry args={[sx, sy, sz]} />
      <meshStandardMaterial
        color="#5577aa"
        emissive={isSelected ? '#223366' : '#000000'}
        emissiveIntensity={isSelected ? 2 : 0}
      />
    </mesh>
  );
}
