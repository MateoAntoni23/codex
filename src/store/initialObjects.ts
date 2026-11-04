import type { DomainObject } from '../types/domain';

// Objetos iniciales de la escena de ejemplo.
// position es el CENTRO del objeto (mm, eje Z vertical).
// Para apoyar en el piso (z_dominio = 0): position.z = height / 2.
export const INITIAL_OBJECTS: DomainObject[] = [
  {
    id: 'floor-1',
    name: 'Piso',
    type: 'floor',
    position: { x: 0, y: 0, z: 0 },
    dimensions: { width: 30000, depth: 30000, height: 0 },
  },
  {
    id: 'building-1',
    name: 'Nave Industrial',
    type: 'building',
    // height = 8 000 mm → centro en z = 4 000 mm → base en z = 0 (piso)
    position: { x: 0, y: 0, z: 4000 },
    dimensions: { width: 20000, depth: 15000, height: 8000 },
  },
  {
    id: 'panel-1',
    name: 'Tablero Eléctrico',
    type: 'panel',
    // height = 2 000 mm → centro en z = 1 000 mm → base en z = 0 (piso)
    position: { x: -7000, y: 2000, z: 1000 },
    dimensions: { width: 800, depth: 400, height: 2000 },
  },
  {
    id: 'motor-1',
    name: 'Motor Eléctrico',
    type: 'motor',
    // height = 800 mm → centro en z = 400 mm → base en z = 0 (piso)
    position: { x: 4000, y: 4000, z: 400 },
    dimensions: { width: 600, depth: 600, height: 800 },
  },
];
