/**
 * Tests — resolvedPortGeometry: resolución pura de modelFrame + portGeometry
 * sobre una receta cruda. Se verifica:
 *
 *   - Sin overrides declarados → identidad (misma receta, preTransform=I).
 *   - modelFrame.rz_deg=90 → ports rotados 90° alrededor del eje Z local.
 *   - portGeometry.centerMm → reemplaza center del puerto correspondiente.
 *   - portGeometry.installRotationDeg → rota uDir/vDir alrededor de la normal.
 *   - portGeometry sólo afecta puertos nombrados; otros quedan intactos.
 *   - El polígono se preserva (consumer renderiza con `buildLocalMesh`
 *     usando el polígono RAW y compone matrix · preTransform).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  resolveRecipeForProduct,
  resolveRecipeWith,
  buildModelFrameMatrix,
} from '../resolvedPortGeometry';
import {
  clearPortMappingOverrides,
  setPortMappingOverrides,
} from '../catalogPortMapping';
import { buildTRPSRecipe } from '../../parametric/geometry/outlines';

const EPS = 1e-6;

function near(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps;
}

describe('resolvedPortGeometry — identidad sin overrides', () => {
  beforeEach(() => clearPortMappingOverrides());

  it('devuelve la misma receta cuando el producto no tiene overrides', () => {
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const resolved = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    expect(resolved.isIdentity).toBe(true);
    expect(resolved.recipe).toBe(raw); // misma referencia; no copia innecesaria
    const preIsIdentity = new THREE.Matrix4().equals(resolved.preTransform);
    expect(preIsIdentity).toBe(true);
  });

  it('identidad si modelFrame declarado es cero y entries sin geometry', () => {
    setPortMappingOverrides({
      'SAM_TRPS-300-22-Z': {
        productId: 'SAM_TRPS-300-22-Z',
        source: 'override',
        entries: [
          { recipePortName: 'P1', catalogPortName: 'P1', physicalLabel: '', justification: '' },
          { recipePortName: 'P2', catalogPortName: 'P2', physicalLabel: '', justification: '' },
        ],
        modelFrame: { tx_mm: 0, ty_mm: 0, tz_mm: 0, rx_deg: 0, ry_deg: 0, rz_deg: 0 },
      },
    });
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const resolved = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    expect(resolved.isIdentity).toBe(true);
  });
});

describe('resolvedPortGeometry — modelFrame', () => {
  beforeEach(() => clearPortMappingOverrides());

  it('rz_deg=90 rota port.center y port.normal alrededor del eje Z local', () => {
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    // P1 original: center (0, 25, -150), normal (-1, 0, 0)
    // Z-rotation 90°: (x,y,z) → (-y,x,z), (nx,ny,nz) → (-ny,nx,nz)
    //   center' = (-25, 0, -150)
    //   normal' = (0, -1, 0)
    setPortMappingOverrides({
      'SAM_TRPS-300-22-Z': {
        productId: 'SAM_TRPS-300-22-Z',
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 90 },
      },
    });
    const resolved = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    expect(resolved.isIdentity).toBe(false);
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1')!;
    expect(near(p1.center[0], -25)).toBe(true);
    expect(near(p1.center[1], 0)).toBe(true);
    expect(near(p1.center[2], -150)).toBe(true);
    expect(near(p1.normal[0], 0)).toBe(true);
    expect(near(p1.normal[1], -1)).toBe(true);
    expect(near(p1.normal[2], 0)).toBe(true);
  });

  it('preserva el polígono y la altura (sólo ports se tocan)', () => {
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    setPortMappingOverrides({
      'SAM_TRPS-300-22-Z': {
        productId: 'SAM_TRPS-300-22-Z',
        source: 'override',
        entries: [],
        modelFrame: { rz_deg: 45 },
      },
    });
    const resolved = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    expect(resolved.recipe.polygon).toBe(raw.polygon);
    expect(resolved.recipe.height).toBe(raw.height);
    expect(resolved.recipe.extrudeAlongY).toBe(raw.extrudeAlongY);
  });

  it('buildModelFrameMatrix para traslación pura: punto se mueve exactamente', () => {
    const m = buildModelFrameMatrix({ tx_mm: 10, ty_mm: 20, tz_mm: 30 });
    const p = new THREE.Vector3(1, 2, 3).applyMatrix4(m);
    expect(near(p.x, 11)).toBe(true);
    expect(near(p.y, 22)).toBe(true);
    expect(near(p.z, 33)).toBe(true);
  });

  it('buildModelFrameMatrix identidad si frame es cero', () => {
    const m = buildModelFrameMatrix({});
    expect(new THREE.Matrix4().equals(m)).toBe(true);
    const n = buildModelFrameMatrix(null);
    expect(new THREE.Matrix4().equals(n)).toBe(true);
  });
});

describe('resolvedPortGeometry — portGeometry por boca', () => {
  beforeEach(() => clearPortMappingOverrides());

  it('centerMm reemplaza el center del puerto correspondiente', () => {
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    setPortMappingOverrides({
      'SAM_TRPS-300-22-Z': {
        productId: 'SAM_TRPS-300-22-Z',
        source: 'override',
        entries: [
          {
            recipePortName: 'P1',
            catalogPortName: 'P1',
            physicalLabel: '',
            justification: '',
            geometry: { centerMm: [100, 50, 25] },
          },
        ],
      },
    });
    const resolved = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1')!;
    expect(p1.center).toEqual([100, 50, 25]);
    // P2 queda intacto.
    const p2 = resolved.recipe.ports.find((p) => p.name === 'P2')!;
    const p2Raw = raw.ports.find((p) => p.name === 'P2')!;
    expect(p2.center).toEqual(p2Raw.center);
  });

  it('installRotationDeg=90 rota u_dir alrededor de la normal pero conserva center', () => {
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    // P1 raw: center=(0,25,-150), normal=(-1,0,0), u_dir=(0,0,1), v_dir=(0,1,0)
    // Rotar u,v 90° alrededor de normal (-1,0,0) con Rodrigues:
    //   normal unitario k=(-1,0,0)
    //   cos90=0, sin90=1
    //   u' = u·0 + (k×u)·1 + k(k·u)·(1-0)
    //        k×u = (-1,0,0)×(0,0,1) = (0·1 - 0·0, 0·0 - (-1)·1, (-1)·0 - 0·0) = (0, 1, 0)
    //        k·u = 0
    //   u' = (0,1,0)
    //   v' = v·0 + (k×v)·1 + k(k·v)·(1-0)
    //        k×v = (-1,0,0)×(0,1,0) = (0·0-0·1, 0·0-(-1)·0, (-1)·1-0·0) = (0,0,-1)
    //        k·v = 0
    //   v' = (0,0,-1)
    setPortMappingOverrides({
      'SAM_TRPS-300-22-Z': {
        productId: 'SAM_TRPS-300-22-Z',
        source: 'override',
        entries: [
          {
            recipePortName: 'P1',
            catalogPortName: 'P1',
            physicalLabel: '',
            justification: '',
            geometry: { installRotationDeg: 90 },
          },
        ],
      },
    });
    const resolved = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1')!;
    const p1Raw = raw.ports.find((p) => p.name === 'P1')!;
    expect(p1.center).toEqual(p1Raw.center);
    expect(p1.normal).toEqual(p1Raw.normal);
    expect(near(p1.u_dir[0], 0)).toBe(true);
    expect(near(p1.u_dir[1], 1)).toBe(true);
    expect(near(p1.u_dir[2], 0)).toBe(true);
    expect(near(p1.v_dir[0], 0)).toBe(true);
    expect(near(p1.v_dir[1], 0)).toBe(true);
    expect(near(p1.v_dir[2], -1)).toBe(true);
  });
});

describe('resolvedPortGeometry — resolveRecipeWith (helper directo sin store)', () => {
  it('permite previsualizar borradores sin tocar el store', () => {
    clearPortMappingOverrides();
    const raw = buildTRPSRecipe({ ancho_mm: 300, ala_mm: 50, longitud_mm: 3000 });
    const resolved = resolveRecipeWith(
      raw,
      { rz_deg: 90 },
      {
        P1: { centerMm: [1, 2, 3] },
      },
    );
    expect(resolved.isIdentity).toBe(false);
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1')!;
    expect(p1.center).toEqual([1, 2, 3]);
    // El store sigue limpio.
    const noOverride = resolveRecipeForProduct(raw, 'SAM_TRPS-300-22-Z');
    expect(noOverride.isIdentity).toBe(true);
  });
});
