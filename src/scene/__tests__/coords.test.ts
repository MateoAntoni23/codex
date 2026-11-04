import { describe, it, expect } from 'vitest';
import { domainToViewerPosition, domainToViewerSize, mmToUnits, floorRenderProps } from '../coords';
import { INITIAL_OBJECTS } from '../../store/initialObjects';
import type { DomainObject } from '../../types/domain';

describe('mmToUnits', () => {
  it('convierte milímetros a metros', () => {
    expect(mmToUnits(1000)).toBe(1);
    expect(mmToUnits(500)).toBe(0.5);
    expect(mmToUnits(0)).toBe(0);
  });
});

describe('domainToViewerPosition', () => {
  it('convierte el origen correctamente', () => {
    // −y/1000 con y=0 produce −0 en JS; toBeCloseTo trata −0 y 0 como iguales.
    const [x, y, z] = domainToViewerPosition({ x: 0, y: 0, z: 0 });
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });

  it('aplica [x/1000, z/1000, −y/1000]', () => {
    const result = domainToViewerPosition({ x: 1000, y: 2000, z: 3000 });
    expect(result[0]).toBeCloseTo(1);   // X dominio → X Three.js
    expect(result[1]).toBeCloseTo(3);   // Z dominio → Y Three.js
    expect(result[2]).toBeCloseTo(-2);  // Y dominio → −Z Three.js
  });

  it('preserva la distancia euclídea entre dos puntos', () => {
    const a = { x: 0,    y: 0,    z: 0 };
    const b = { x: 3000, y: 4000, z: 0 };
    const [ax, ay, az] = domainToViewerPosition(a);
    const [bx, by, bz] = domainToViewerPosition(b);
    const distDomain = Math.sqrt(3000 ** 2 + 4000 ** 2) / 1000; // 5 m
    const distViewer = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
    expect(distViewer).toBeCloseTo(distDomain, 10);
  });

  it('preserva la distancia con componente Z no nula', () => {
    const a = { x: 0, y: 0, z: 0    };
    const b = { x: 0, y: 0, z: 2000 };
    const [ax, ay, az] = domainToViewerPosition(a);
    const [bx, by, bz] = domainToViewerPosition(b);
    const distViewer = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
    expect(distViewer).toBeCloseTo(2, 10); // 2 000 mm = 2 m
  });
});

// Usa los objetos reales del store para detectar regresiones cuando
// alguien modifique position o dimensions sin actualizar el otro campo.
describe('apoyo en piso — objetos iniciales reales', () => {
  const selectables = INITIAL_OBJECTS.filter((o) => o.type !== 'floor');

  selectables.forEach((obj) => {
    it(`${obj.name}: base en piso (position.z − height/2 = 0)`, () => {
      expect(obj.position.z - obj.dimensions.height / 2).toBe(0);
    });

    it(`${obj.name}: Y en visor es positivo (encima del piso)`, () => {
      const [, vy] = domainToViewerPosition(obj.position);
      expect(vy).toBeGreaterThan(0);
    });
  });

  // Regresión para Floor.tsx: comprueba los valores que el componente
  // pasa realmente a <mesh position> y <Grid position> (via floorRenderProps).
  // Si Floor.tsx vuelve a hardcodear Y=0, esta prueba fallará.
  it('piso elevado: mesh y Grid reciben posición Y = 0.5 m (500 mm)', () => {
    const elevatedFloor: DomainObject = {
      id: 'floor-elevated',
      name: 'Piso elevado',
      type: 'floor',
      position: { x: 2000, y: -1000, z: 500 }, // z=500 mm → Y Three.js = 0.5 m
      dimensions: { width: 10000, depth: 8000, height: 0 },
    };
    const { position, planeArgs } = floorRenderProps(elevatedFloor);

    // Y Three.js refleja z=500 mm del dominio
    expect(position[1]).toBeCloseTo(0.5);
    // X Three.js refleja x=2000 mm
    expect(position[0]).toBeCloseTo(2);
    // Z Three.js refleja −y_dominio = −(−1000)/1000 = 1
    expect(position[2]).toBeCloseTo(1);

    // Plano: width=10000→10 m, depth=8000→8 m
    expect(planeArgs[0]).toBeCloseTo(10);
    expect(planeArgs[1]).toBeCloseTo(8);
  });
});

describe('domainToViewerSize', () => {
  it('convierte dimensiones de mm a metros', () => {
    const [w, h, d] = domainToViewerSize({ width: 800, depth: 400, height: 2000 });
    expect(w).toBeCloseTo(0.8);
    expect(h).toBeCloseTo(2.0);
    expect(d).toBeCloseTo(0.4);
  });

  it('mantiene ceros', () => {
    const [w, h, d] = domainToViewerSize({ width: 0, depth: 0, height: 0 });
    expect(w).toBe(0);
    expect(h).toBe(0);
    expect(d).toBe(0);
  });
});
