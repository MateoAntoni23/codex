/**
 * Tests for parametricBridge.
 *
 * Verifica que el transform local→mundo del puente paramétrico cumple:
 *   - world(P1.center) == startPos
 *   - world(P1.outwardNormal) == −entryDir
 *   - Para CPS-45/CPS-90 (polígonos medidos del STEP), la quiralidad native
 *     corresponde a giro DERECHO y mirrored a izquierdo.
 *   - verifyGeometricFit reconoce una pieza colocada por el mismo puente.
 */
import { describe, it, expect } from 'vitest';
import {
  placeRecipe,
  chiralityForTurn,
  resolveRecipe,
  verifyGeometricFit,
  buildLocalMesh,
  buildRecipeFromProduct,
  hasParametricRecipe,
} from '../parametricBridge';
import type { Product, Piece } from '../../tray/model';

const EPS_POS = 1e-3; // mm
const EPS_DIR = 1e-6;

function near(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) < eps;
}

// Productos de prueba calcados del snapshot real del catálogo SAMET.
const TRPS_300: Product = {
  producto_id: 'SAM_TRPS-300-22-Z',
  descripcion_original: 'TRPS-300-22-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  sku: 'TRPS-300-22-Z',
  ala_nominal_mm: 50,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CPS_45: Product = {
  producto_id: 'SAM_CPS-300-45-Z',
  descripcion_original: 'CPS-300-45-Z',
  tipo_pieza: 'curva horizontal',
  ancho_nominal_mm: 300,
  sku: 'CPS-300-45-Z',
  ala_nominal_mm: 50,
  angulo_grados: 45,
  radio_mm: null,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CPS_90: Product = {
  producto_id: 'SAM_CPS-300-90-Z',
  descripcion_original: 'CPS-300-90-Z',
  tipo_pieza: 'curva horizontal',
  ancho_nominal_mm: 300,
  sku: 'CPS-300-90-Z',
  ala_nominal_mm: 50,
  angulo_grados: 90,
  radio_mm: null,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

describe('parametricBridge.resolveRecipe', () => {
  it('encuentra recetas para rectos y curvas 300 por SKU bare', () => {
    // B-2: se resuelven por su maestro (recipeKey), no por el índice por SKU de
    // src/parametric/catalog.ts (que ya no participa en el espacio de trabajo).
    expect(resolveRecipe(TRPS_300)?.recipe).toBe('tramo_recto');
    expect(resolveRecipe(CPS_45)?.recipe).toBe('curva_horizontal');
    expect(resolveRecipe(CPS_90)?.recipe).toBe('curva_horizontal');
  });

  it('devuelve null para productos sin receta o sin SKU', () => {
    expect(resolveRecipe(null)).toBeNull();
    expect(resolveRecipe({ sku: null })).toBeNull();
    expect(resolveRecipe({ sku: 'INEXISTENTE' })).toBeNull();
  });

  it('hasParametricRecipe refleja resolveRecipe', () => {
    expect(hasParametricRecipe(TRPS_300)).toBe(true);
    expect(hasParametricRecipe({ sku: 'INEXISTENTE' })).toBe(false);
  });
});

describe('parametricBridge.buildRecipeFromProduct', () => {
  it('propaga longitud comercial del catálogo al tramo recto', () => {
    const entry = resolveRecipe(TRPS_300)!;
    const recipe = buildRecipeFromProduct(TRPS_300, entry);
    // polygon: [(0,0), (L,0), (L,-ancho), (0,-ancho)]
    const L = recipe.polygon[1][0];
    expect(L).toBe(3000);
    const ancho = -recipe.polygon[2][1];
    expect(ancho).toBe(300);
  });

  it('propaga ancho y ala del catálogo (ala_mm distinto del placeholder 65)', () => {
    const entry = resolveRecipe(TRPS_300)!;
    const recipe = buildRecipeFromProduct(TRPS_300, entry);
    expect(recipe.height).toBe(50); // ala_nominal_mm real, no placeholder 65
  });

  it('propaga angulo_grados del catálogo al dispatcher de curva', () => {
    const entry45 = resolveRecipe(CPS_45)!;
    const r45 = buildRecipeFromProduct(CPS_45, entry45);
    expect(r45.polygon).toHaveLength(7); // CPS45 medido = 7 vértices

    const entry90 = resolveRecipe(CPS_90)!;
    const r90 = buildRecipeFromProduct(CPS_90, entry90);
    expect(r90.polygon).toHaveLength(8); // CPS90 medido = 8 vértices
  });
});

describe('parametricBridge.placeRecipe — invariantes de colocación', () => {
  const ala = 50;
  const startPos: [number, number, number] = [0, 0, ala / 2];
  const eastward: [number, number, number] = [1, 0, 0];

  it('tramo recto: world(P1.center)=startPos; world(P1.normal)=−entryDir; P2 a longitud, misma dirección', () => {
    const entry = resolveRecipe(TRPS_300)!;
    const placed = placeRecipe(TRPS_300, entry, startPos, eastward, 'native');

    expect(near(placed.p1.pos[0], 0, EPS_POS)).toBe(true);
    expect(near(placed.p1.pos[1], 0, EPS_POS)).toBe(true);
    expect(near(placed.p1.pos[2], ala / 2, EPS_POS)).toBe(true);

    expect(near(placed.p1.outwardNormal[0], -1, EPS_DIR)).toBe(true);
    expect(near(placed.p1.outwardNormal[1], 0, EPS_DIR)).toBe(true);
    expect(near(placed.p1.outwardNormal[2], 0, EPS_DIR)).toBe(true);

    expect(near(placed.p2.pos[0], 3000, 1)).toBe(true);
    expect(near(placed.p2.pos[1], 0, 1)).toBe(true);
    expect(near(placed.p2.pos[2], ala / 2, 1)).toBe(true);

    expect(near(placed.p2.outwardNormal[0], 1, EPS_DIR)).toBe(true);
  });

  it('CPS-45 native (derecha) desde este: P2 sale hacia (+X, −Y); mirror hacia (+X, +Y)', () => {
    const entry = resolveRecipe(CPS_45)!;
    const right = placeRecipe(CPS_45, entry, startPos, eastward, 'native');
    expect(right.p2.outwardNormal[0]).toBeGreaterThan(0);
    expect(right.p2.outwardNormal[1]).toBeLessThan(0);
    // Mismo paso + izquierda = reflexión en el eje de avance → Y invertido
    const left = placeRecipe(CPS_45, entry, startPos, eastward, 'mirrored');
    expect(left.p2.outwardNormal[0]).toBeGreaterThan(0);
    expect(left.p2.outwardNormal[1]).toBeGreaterThan(0);

    // Las magnitudes de las componentes XY deben coincidir entre native y mirror
    expect(near(Math.abs(right.p2.outwardNormal[1]), Math.abs(left.p2.outwardNormal[1]), 1e-6)).toBe(true);
    expect(near(right.p2.pos[0], left.p2.pos[0], 1e-6)).toBe(true);
    expect(near(right.p2.pos[1], -left.p2.pos[1], 1e-6)).toBe(true);
  });

  it('CPS-90 native desde este: P2 termina mirando hacia −Y (giro 90° derecho)', () => {
    const entry = resolveRecipe(CPS_90)!;
    const placed = placeRecipe(CPS_90, entry, startPos, eastward, 'native');
    // Dirección sur (±1e-3)
    expect(near(placed.p2.outwardNormal[0], 0, 1e-2)).toBe(true);
    expect(near(placed.p2.outwardNormal[1], -1, 1e-2)).toBe(true);
    expect(near(placed.p2.outwardNormal[2], 0, 1e-6)).toBe(true);
  });

  it('CPS-90 radio centerline medido ≠ 450 mm del fallback', () => {
    const entry = resolveRecipe(CPS_90)!;
    const placed = placeRecipe(CPS_90, entry, startPos, eastward, 'native');
    // Para 90° desde (0,0,·), P2 debería estar a (R, −R, ·) con R=radio centerline.
    // Si el polígono medido corresponde al STEP real, R ≠ 450 (fallback actual).
    const R = placed.p2.pos[0];
    expect(Math.abs(R - 450)).toBeGreaterThan(50);
    // La igualdad X ≈ −Y tiene tolerancia ≈ 1.5 mm porque el polígono medido
    // tiene P1.normal = (0.0019, 0, 1.0) en vez de (0, 0, 1) exacto, lo que
    // introduce una inclinación de ~0.11° (≈ 1.4 mm sobre 750 mm).
    expect(near(placed.p2.pos[0], -placed.p2.pos[1], 3)).toBe(true);
  });

  it('chiralityForTurn: right→native, left→mirrored', () => {
    expect(chiralityForTurn('right')).toBe('native');
    expect(chiralityForTurn('left')).toBe('mirrored');
  });

  it('entryDir vertical sin sectionUp elige un eje perpendicular estable (no lanza)', () => {
    // El render de piezas confirmadas (TrayObjects.ParametricMesh) llama a
    // placeRecipe sin sectionUp — no tiene contexto del puerto vecino. Para
    // secciones rectangulares la rotación alrededor de entryDir es cosmética,
    // así que el bridge debe degradar a un fallback estable en vez de fallar.
    // Caller que SÍ pasa sectionUp paralelo sigue recibiendo el throw estricto
    // (ver test siguiente).
    const entry = resolveRecipe(TRPS_300)!;
    const placed = placeRecipe(TRPS_300, entry, startPos, [0, 0, 1], 'native');
    // vDir debe ser unitario y perpendicular a entryDir.
    const v = placed.p1.vDir;
    const dot = v[0] * 0 + v[1] * 0 + v[2] * 1;
    expect(Math.abs(dot)).toBeLessThan(1e-6);
    const len = Math.hypot(v[0], v[1], v[2]);
    expect(Math.abs(len - 1)).toBeLessThan(1e-6);
    // P1 world normal = −entryDir = (0,0,−1); P2 está 3000 mm sobre P1 en Z.
    expect(near(placed.p1.outwardNormal[2], -1, EPS_DIR)).toBe(true);
    const dz = placed.p2.pos[2] - placed.p1.pos[2];
    expect(near(dz, 3000, 1)).toBe(true);
  });

  it('entryDir vertical con sectionUp ortogonal coloca el recto hacia arriba', () => {
    // Objetivo: continuar desde una salida vertical (por ejemplo, de CUPS) con
    // un tramo recto. El puerto origen en mundo aporta sectionUp = (+1,0,0).
    const entry = resolveRecipe(TRPS_300)!;
    const placed = placeRecipe(
      TRPS_300,
      entry,
      [0, 0, 0],
      [0, 0, 1],
      'native',
      undefined,
      { sectionUp: [1, 0, 0] },
    );
    // P1 world normal = −entryDir = (0,0,−1): el recto arranca hacia +Z.
    expect(near(placed.p1.outwardNormal[0], 0, EPS_DIR)).toBe(true);
    expect(near(placed.p1.outwardNormal[1], 0, EPS_DIR)).toBe(true);
    expect(near(placed.p1.outwardNormal[2], -1, EPS_DIR)).toBe(true);
    // El centro de P1 coincide con startPos.
    expect(near(placed.p1.pos[0], 0, EPS_POS)).toBe(true);
    expect(near(placed.p1.pos[1], 0, EPS_POS)).toBe(true);
    expect(near(placed.p1.pos[2], 0, EPS_POS)).toBe(true);
    // P2 está a 3000 mm sobre P1 en la dirección +Z (longitud del catálogo).
    expect(near(placed.p2.pos[0], 0, 1)).toBe(true);
    expect(near(placed.p2.pos[1], 0, 1)).toBe(true);
    expect(near(placed.p2.pos[2], 3000, 1)).toBe(true);
    // P2 mira hacia +Z (misma dirección de avance).
    expect(near(placed.p2.outwardNormal[2], 1, EPS_DIR)).toBe(true);
    // vDir de P1 en mundo coincide con sectionUp (proyectado perpendicular a entryDir ya está).
    expect(near(placed.p1.vDir[0], 1, 1e-6)).toBe(true);
    expect(near(placed.p1.vDir[1], 0, 1e-6)).toBe(true);
    expect(near(placed.p1.vDir[2], 0, 1e-6)).toBe(true);
  });

  it('entryDir vertical con sectionUp paralelo a entryDir lanza mensaje legible', () => {
    const entry = resolveRecipe(TRPS_300)!;
    expect(() =>
      placeRecipe(
        TRPS_300,
        entry,
        [0, 0, 0],
        [0, 0, 1],
        'native',
        undefined,
        { sectionUp: [0, 0, 1] },
      ),
    ).toThrow(/sectionUp.*paralelo a entryDir/);
  });
});

describe('parametricBridge.buildLocalMesh', () => {
  it('construye geometría no vacía para cada receta soportada', () => {
    for (const product of [TRPS_300, CPS_45, CPS_90]) {
      const entry = resolveRecipe(product)!;
      const recipe = buildRecipeFromProduct(product, entry);
      const geom = buildLocalMesh(recipe);
      const pos = geom.getAttribute('position');
      expect(pos.count).toBeGreaterThan(9);
    }
  });
});

describe('parametricBridge.verifyGeometricFit', () => {
  it('detecta encaje nativo cuando la pieza fue colocada con receta derecha', () => {
    const entry = resolveRecipe(CPS_45)!;
    const startPos: [number, number, number] = [1000, 2000, 25];
    const entryDir: [number, number, number] = [1, 0, 0];
    const placed = placeRecipe(CPS_45, entry, startPos, entryDir, 'native');
    const piece: Piece = {
      instancia_id: 'CRV-1',
      producto_id: CPS_45.producto_id,
      longitud_eje_mm: 100,
      puertos: {
        P1: { posicion_mm: [...placed.p1.pos], direccion: [-entryDir[0], -entryDir[1], -entryDir[2]] },
        P2: { posicion_mm: [...placed.p2.pos], direccion: [...placed.p2.outwardNormal] },
      },
    };
    const fit = verifyGeometricFit(CPS_45, piece);
    expect(fit).not.toBeNull();
    expect(fit!.matches).toBe(true);
    expect(fit!.chirality).toBe('native');
  });

  it('detecta encaje izquierdo cuando la pieza es espejo', () => {
    const entry = resolveRecipe(CPS_90)!;
    const startPos: [number, number, number] = [0, 0, 25];
    const entryDir: [number, number, number] = [0, 1, 0];
    const placed = placeRecipe(CPS_90, entry, startPos, entryDir, 'mirrored');
    const piece: Piece = {
      instancia_id: 'CRV-1',
      producto_id: CPS_90.producto_id,
      longitud_eje_mm: 100,
      puertos: {
        P1: { posicion_mm: [...placed.p1.pos], direccion: [-entryDir[0], -entryDir[1], -entryDir[2]] },
        P2: { posicion_mm: [...placed.p2.pos], direccion: [...placed.p2.outwardNormal] },
      },
    };
    const fit = verifyGeometricFit(CPS_90, piece);
    expect(fit!.matches).toBe(true);
    expect(fit!.chirality).toBe('mirrored');
  });

  it('rechaza encaje cuando la pieza no corresponde geométricamente', () => {
    const entry = resolveRecipe(CPS_45)!;
    const startPos: [number, number, number] = [0, 0, 25];
    const entryDir: [number, number, number] = [1, 0, 0];
    const placed = placeRecipe(CPS_45, entry, startPos, entryDir, 'native');
    // Construimos una pieza con P2 desplazado 50 mm.
    const piece: Piece = {
      instancia_id: 'CRV-1',
      producto_id: CPS_45.producto_id,
      longitud_eje_mm: 100,
      puertos: {
        P1: { posicion_mm: [...placed.p1.pos], direccion: [-1, 0, 0] },
        P2: {
          posicion_mm: [placed.p2.pos[0] + 50, placed.p2.pos[1], placed.p2.pos[2]],
          direccion: [...placed.p2.outwardNormal],
        },
      },
    };
    const fit = verifyGeometricFit(CPS_45, piece);
    expect(fit!.matches).toBe(false);
  });
});
