import type { DomainObject } from '../types/domain';

interface Props {
  obj: DomainObject;
}

// Nave industrial: contorno wireframe
// Conversión mm → Three.js units (1 unidad = 1000 mm = 1 m):
//   posición Three.js = [x/1000, z/1000, y/1000]  (Z-up → Y-up)
//   tamaño Three.js   = [width/1000, height/1000, depth/1000]
export function Building({ obj }: Props) {
  const { position: p, dimensions: d } = obj;
  const px = p.x / 1000;
  const py = p.z / 1000 + d.height / 1000 / 2; // base en z=0, centrado en altura
  const pz = p.y / 1000;
  const sx = d.width / 1000;
  const sy = d.height / 1000;
  const sz = d.depth / 1000;

  return (
    <mesh position={[px, py, pz]}>
      <boxGeometry args={[sx, sy, sz]} />
      <meshBasicMaterial color="#8899aa" wireframe />
    </mesh>
  );
}
