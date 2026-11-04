// Conversión dominio → visor Three.js
//
// Dominio:  unidad = milímetros (mm), eje Z vertical (arriba)
//           X → horizontal izquierda/derecha
//           Y → profundidad en planta (adelante/atrás)
//           Z → vertical (altura)
//
// Three.js: unidad = 1 m = 1 000 mm, eje Y vertical (arriba)
//           X → horizontal izquierda/derecha  (igual al dominio)
//           Y → vertical                      (= Z dominio)
//           Z → profundidad                   (= −Y dominio)
//
// Transformación de posición: viewer = [x/1000, z/1000, −y/1000]
// El signo negativo en Y preserva la orientación (sistema dextrógiro).
//
// position en el dominio es siempre el CENTRO del objeto.
// Para que un objeto "apoye en el piso" (Z_dominio = 0), su posición
// debe tener z = height/2.

import type { Vec3mm, DomainObject } from '../types/domain';

const MM_PER_UNIT = 1000;

export function mmToUnits(mm: number): number {
  return mm / MM_PER_UNIT;
}

/** Posición de dominio (mm, Z-up) → Three.js (m, Y-up). */
export function domainToViewerPosition(p: Vec3mm): [number, number, number] {
  return [
    p.x / MM_PER_UNIT,       // X dominio → X Three.js
    p.z / MM_PER_UNIT,       // Z dominio (altura) → Y Three.js
    -(p.y / MM_PER_UNIT),    // Y dominio (profundidad) → −Z Three.js
  ];
}

/** Dimensiones de dominio (mm) → Three.js (m): [width, height, depth]. */
export function domainToViewerSize(
  d: DomainObject['dimensions'],
): [number, number, number] {
  return [
    d.width  / MM_PER_UNIT,  // ancho  → X Three.js
    d.height / MM_PER_UNIT,  // alto   → Y Three.js
    d.depth  / MM_PER_UNIT,  // profun → Z Three.js
  ];
}

/** Props de renderizado que Floor pasa a su mesh y a Grid. */
export interface FloorRenderProps {
  /** Posición Three.js: [x, y, z] en metros. */
  position: [number, number, number];
  /** Tamaño del plano Three.js: [ancho, profundidad] en metros. */
  planeArgs: [number, number];
}

/**
 * Calcula los valores concretos que Floor.tsx pasa a <mesh position> y <Grid position>.
 * Extraído para poder verificarse sin renderizar el componente React.
 */
export function floorRenderProps(obj: DomainObject): FloorRenderProps {
  const position = domainToViewerPosition(obj.position);
  const [sw, , sd] = domainToViewerSize(obj.dimensions);
  return { position, planeArgs: [sw, sd] };
}
