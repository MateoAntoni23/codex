import { describe, it, expect } from 'vitest';
import { domainToViewerPosition, domainToViewerSize, mmToUnits } from '../coords';

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
    expect(result[0]).toBeCloseTo(1);    // X dominio → X Three.js
    expect(result[1]).toBeCloseTo(3);    // Z dominio → Y Three.js
    expect(result[2]).toBeCloseTo(-2);   // Y dominio → −Z Three.js
  });

  it('preserva la distancia euclídea entre dos puntos (sin escala)', () => {
    const a = { x: 0,    y: 0,    z: 0 };
    const b = { x: 3000, y: 4000, z: 0 };
    const [ax, ay, az] = domainToViewerPosition(a);
    const [bx, by, bz] = domainToViewerPosition(b);
    // Distancia en dominio (mm) convertida a metros:
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

describe('apoyo en piso — datos iniciales', () => {
  // Para apoyar en el piso, position.z = height / 2.
  // El visor coloca el centro en Y = z/1000 > 0 (encima del piso).

  const cases: Array<{ name: string; position: { x: number; y: number; z: number }; height: number }> = [
    { name: 'Nave Industrial',    position: { x: 0,     y: 0,    z: 4000 }, height: 8000 },
    { name: 'Tablero Eléctrico',  position: { x: -7000, y: 2000, z: 1000 }, height: 2000 },
    { name: 'Motor Eléctrico',    position: { x: 4000,  y: 4000, z: 400  }, height: 800  },
  ];

  cases.forEach(({ name, position, height }) => {
    it(`${name}: position.z == height / 2 (base en piso)`, () => {
      expect(position.z).toBe(height / 2);
    });

    it(`${name}: coordenada Y en visor es positiva (encima del piso)`, () => {
      const [, vy] = domainToViewerPosition(position);
      expect(vy).toBeGreaterThan(0);
    });
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
