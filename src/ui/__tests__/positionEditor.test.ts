import { describe, it, expect } from 'vitest';
import { parsePositionDraft, snapToFloorZ } from '../positionEditor';

describe('parsePositionDraft — entradas válidas', () => {
  it('parsea enteros positivos', () => {
    const result = parsePositionDraft({ x: '100', y: '200', z: '300' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ x: 100, y: 200, z: 300 });
  });

  it('parsea enteros negativos', () => {
    const result = parsePositionDraft({ x: '-7000', y: '2000', z: '1000' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ x: -7000, y: 2000, z: 1000 });
  });

  it('parsea cero', () => {
    const result = parsePositionDraft({ x: '0', y: '0', z: '0' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('parsea decimales', () => {
    const result = parsePositionDraft({ x: '1500.5', y: '-300.25', z: '0' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.x).toBeCloseTo(1500.5);
      expect(result.value.y).toBeCloseTo(-300.25);
    }
  });

  it('ignora espacios al inicio y al final', () => {
    const result = parsePositionDraft({ x: '  500  ', y: '0', z: '0' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.x).toBe(500);
  });
});

describe('parsePositionDraft — entradas inválidas', () => {
  it('rechaza campo X vacío', () => {
    const result = parsePositionDraft({ x: '', y: '0', z: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.x).toBeTruthy();
  });

  it('rechaza campo Y vacío', () => {
    const result = parsePositionDraft({ x: '0', y: '', z: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.y).toBeTruthy();
  });

  it('rechaza campo Z vacío', () => {
    const result = parsePositionDraft({ x: '0', y: '0', z: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.z).toBeTruthy();
  });

  it('rechaza texto no numérico', () => {
    const result = parsePositionDraft({ x: 'abc', y: '0', z: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.x).toBeTruthy();
  });

  it('rechaza Infinity', () => {
    const result = parsePositionDraft({ x: 'Infinity', y: '0', z: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.x).toBeTruthy();
  });

  it('rechaza -Infinity', () => {
    const result = parsePositionDraft({ x: '-Infinity', y: '0', z: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.x).toBeTruthy();
  });

  it('rechaza NaN explícito', () => {
    const result = parsePositionDraft({ x: 'NaN', y: '0', z: '0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.x).toBeTruthy();
  });

  it('acumula errores de varios campos simultáneamente', () => {
    const result = parsePositionDraft({ x: '', y: 'abc', z: 'Infinity' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.x).toBeTruthy();
      expect(result.errors.y).toBeTruthy();
      expect(result.errors.z).toBeTruthy();
    }
  });

  it('los valores inválidos no se guardan (value es descartado)', () => {
    const result = parsePositionDraft({ x: 'malo', y: '0', z: '0' });
    expect(result.ok).toBe(false);
    // No hay value accesible cuando ok=false
    expect('value' in result).toBe(false);
  });
});

describe('snapToFloorZ', () => {
  it('tablero: Z = 2000 / 2 = 1000 mm', () => {
    expect(snapToFloorZ(2000)).toBe(1000);
  });

  it('motor: Z = 800 / 2 = 400 mm', () => {
    expect(snapToFloorZ(800)).toBe(400);
  });

  it('nave: Z = 8000 / 2 = 4000 mm', () => {
    expect(snapToFloorZ(8000)).toBe(4000);
  });

  it('altura cero produce Z = 0 (objeto plano)', () => {
    expect(snapToFloorZ(0)).toBe(0);
  });
});

describe('snapToFloorZ con originZ distinto de cero', () => {
  it('originZ=500 → Z_mostrado = 1000 − 500 = 500', () => {
    expect(snapToFloorZ(2000, 500)).toBe(500);
  });

  it('Z_mostrado + originZ siempre da height/2 (invariante piso)', () => {
    const cases: [number, number][] = [
      [2000, 500],
      [800, 400],
      [8000, 1000],
      [2000, -300],
    ];
    for (const [h, oz] of cases) {
      expect(snapToFloorZ(h, oz) + oz).toBe(h / 2);
    }
  });

  it('originZ negativo eleva la Z mostrada', () => {
    // origin.z = -500 → Z_mostrado = 1000 − (−500) = 1500
    expect(snapToFloorZ(2000, -500)).toBe(1500);
  });

  it('sin segundo argumento se comporta igual que originZ=0', () => {
    expect(snapToFloorZ(2000)).toBe(snapToFloorZ(2000, 0));
  });
});
