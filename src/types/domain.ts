// Convención de dominio:
//   - Todas las dimensiones y posiciones en MILÍMETROS (mm)
//   - Eje Z vertical (arriba). Three.js usa Y-up.
//   - position es siempre el CENTRO del objeto.
//   - Para apoyar un objeto en el piso (Z=0), fijar position.z = height/2.
//   - Conversión a Three.js: ver src/scene/coords.ts
//     Transformación de posición: [x/1000, z/1000, −y/1000]

export type ObjectType = 'floor' | 'building' | 'panel' | 'motor';

export interface Vec3mm {
  x: number; // mm — horizontal izquierda/derecha
  y: number; // mm — profundidad en planta (adelante/atrás)
  z: number; // mm — altura (eje vertical)
}

export interface DomainObject {
  id: string;
  name: string;
  type: ObjectType;
  /** Centro del objeto en milímetros, eje Z vertical. */
  position: Vec3mm;
  /** Dimensiones en milímetros: width=X, depth=Y (planta), height=Z (alto). */
  dimensions: { width: number; depth: number; height: number };
}
