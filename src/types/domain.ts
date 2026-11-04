// Convención de dominio:
// - Todas las dimensiones y posiciones están en MILÍMETROS
// - El eje Z es vertical (arriba). Three.js usa Y-up.
// - Conversión al visor: posición [x/1000, z/1000, y/1000] (1 unidad = 1 metro)

export type ObjectType = 'floor' | 'building' | 'panel' | 'motor';

export interface Vec3mm {
  x: number; // mm
  y: number; // mm (horizontal, profundidad en planta)
  z: number; // mm (vertical, altura)
}

export interface DomainObject {
  id: string;
  name: string;
  type: ObjectType;
  /** Centro del objeto en milímetros, eje Z vertical */
  position: Vec3mm;
  /** Dimensiones en milímetros: width=X, depth=Y, height=Z */
  dimensions: { width: number; depth: number; height: number };
}
