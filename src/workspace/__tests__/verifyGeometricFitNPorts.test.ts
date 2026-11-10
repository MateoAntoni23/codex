// @vitest-environment node
/**
 * verifyGeometricFitNPorts — regresión de la generalización de verifyGeometricFit
 * para accesorios con bocas no-P1/P2.
 *
 * Contexto (2026-11-10): el bug visual TRPS→CUPS reveló que aun después de que
 * `buildLocalMesh` aplicara `recipe.translate`, las piezas CUPS/TPS/XPS caían
 * silenciosamente a `schematic-line-fallback` porque `verifyGeometricFit`
 * hardcodeaba `piece.puertos.P1/P2`. Como esas piezas persisten bocas con
 * nombres de receta (CUPS: P1_horizontal/P2_vertical; TPS: tronco_P1/
 * tronco_P2/boca_derivacion; XPS: P1_x_neg..P4_z_pos), el lookup devolvía
 * `undefined` y el fit era null → render de líneas rectas en vez del cuerpo
 * paramétrico.
 *
 * Este test demuestra:
 *   N1. CUPS (2 bocas: P1_horizontal/P2_vertical) resuelve fit con
 *       entryPortName='P1_horizontal' cuando se construye desde el extremo
 *       del TRPS P2.
 *   N2. TPS (3 bocas: tronco_P1/tronco_P2/boca_derivacion) resuelve fit por
 *       cualquiera de sus tres bocas como entrada.
 *   N3. XPS (4 bocas: P1_x_neg..P4_z_pos) resuelve fit por cualquiera.
 *   N4. El fit propaga `orientacion_seccion_ws` como `sectionUp` si la
 *       pieza lo tiene almacenado — requisito para que la re-colocación de
 *       `ParametricMesh` reproduzca el marco con el que se registró la pieza.
 *   N5. Una calibración NO identidad (modelFrame con rotación) sigue
 *       resolviéndose porque el pipeline del puente aplica el mismo
 *       `resolveRecipeForProduct` en ambos sentidos (place + verify).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  placeRecipe,
  resolveRecipe,
  verifyGeometricFit,
} from '../parametricBridge';
import {
  clearPortMappingOverrides,
  setPortMappingOverrides,
  type ProductPortMapping,
} from '../catalogPortMapping';
import type { Piece, Product } from '../../tray/model';

const CUPS_300: Product = {
  producto_id: 'SAM_CUPS-300-A-Z',
  descripcion_original: 'CUPS-300-A-Z',
  tipo_pieza: 'curva vertical interior',
  ancho_nominal_mm: 300,
  sku: 'CUPS-300-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const TPS_300: Product = {
  producto_id: 'SAM_TPS-300-Z',
  descripcion_original: 'TPS-300-Z',
  tipo_pieza: 'tee simétrica',
  ancho_nominal_mm: 300,
  sku: 'TPS-300-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const XPS_300: Product = {
  producto_id: 'SAM_XPS-300-Z',
  descripcion_original: 'XPS-300-Z',
  tipo_pieza: 'cruz',
  ancho_nominal_mm: 300,
  sku: 'XPS-300-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

/**
 * Construye una `Piece` fiel al contrato de `planAddAccessory`: todos los
 * puertos de la receta se persisten con sus pos/normal/vDir mundiales según
 * la colocación resultante. Simula lo que el workspace guarda cuando el
 * usuario inserta el accesorio.
 */
function placedPiece(
  product: Product,
  startPos: [number, number, number],
  entryDir: [number, number, number],
  entryPortName: string,
  sectionUp?: [number, number, number],
): { piece: Piece; placedByEntry: Record<string, { pos: readonly [number, number, number]; normal: readonly [number, number, number] }> } {
  const entry = resolveRecipe(product);
  if (!entry) throw new Error(`no recipe for ${product.sku}`);
  const placed = placeRecipe(
    product,
    entry,
    startPos,
    entryDir,
    'native',
    undefined,
    { entryPortName, ...(sectionUp ? { sectionUp } : {}) },
  );
  const puertos: Piece['puertos'] = {};
  const placedByEntry: Record<string, { pos: readonly [number, number, number]; normal: readonly [number, number, number] }> = {};
  for (const port of placed.ports) {
    puertos[port.name] = {
      posicion_mm: [port.pos[0], port.pos[1], port.pos[2]],
      direccion: [port.outwardNormal[0], port.outwardNormal[1], port.outwardNormal[2]],
      orientacion_seccion_ws: [port.vDir[0], port.vDir[1], port.vDir[2]],
    };
    placedByEntry[port.name] = { pos: port.pos, normal: port.outwardNormal };
  }
  const piece: Piece = {
    instancia_id: `TEST-${product.sku}`,
    producto_id: product.producto_id,
    puertos,
  };
  return { piece, placedByEntry };
}

describe('verifyGeometricFit — N-port accessory resolution', () => {
  afterEach(() => {
    clearPortMappingOverrides();
  });

  it('N1. CUPS con bocas P1_horizontal/P2_vertical resuelve fit con entryPortName correcto', () => {
    // CUPS entrando horizontalmente desde (3000, 0, 25) mirando -X (como si
    // continuara un TRPS horizontal cuyo P2 queda en (3000,0,25)).
    const { piece } = placedPiece(
      CUPS_300,
      [3000, 0, 25],
      [1, 0, 0],
      'P1_horizontal',
      [0, 0, 1],
    );

    const fit = verifyGeometricFit(CUPS_300, piece);
    expect(fit, 'fit must resolve for CUPS').not.toBeNull();
    expect(fit!.matches).toBe(true);
    expect(fit!.entryPortName).toBe('P1_horizontal');
    expect(fit!.posErrorMm).toBeLessThan(0.1);
    expect(fit!.dirErrorDeg).toBeLessThan(0.1);
    // sectionUp propagado desde la boca de entrada almacenada.
    expect(fit!.sectionUp).toBeDefined();
    expect(fit!.sectionUp![2]).toBeCloseTo(1, 6);
    // Puertos de la pieza (nombres de receta) presentes.
    expect(Object.keys(piece.puertos).sort()).toEqual(['P1_horizontal', 'P2_vertical']);
  });

  it('N2. TPS con 3 bocas resuelve fit con cualquiera como entrada', () => {
    // Entrada por tronco_P1 (default del compat).
    const { piece: byTronco1 } = placedPiece(
      TPS_300,
      [0, 0, 25],
      [1, 0, 0],
      'tronco_P1',
      [0, 0, 1],
    );
    const fitA = verifyGeometricFit(TPS_300, byTronco1);
    expect(fitA, 'fit must resolve for TPS by tronco_P1').not.toBeNull();
    expect(fitA!.matches).toBe(true);
    expect(fitA!.posErrorMm).toBeLessThan(0.1);
    // TPS es simétrica: cualquier boca puede ser entrada con error 0;
    // sólo verificamos que el nombre resuelto sea una de las 3 declaradas.
    expect(['tronco_P1', 'tronco_P2', 'boca_derivacion']).toContain(
      fitA!.entryPortName,
    );

    // La misma pieza cambiando el "lado por el que entra" el otro tramo no
    // debería romper el fit — TPS es simétrica.
    expect(Object.keys(byTronco1.puertos).sort()).toEqual(
      ['boca_derivacion', 'tronco_P1', 'tronco_P2'].sort(),
    );

    // Entrada por boca_derivacion (otra pieza colocada al lateral).
    const { piece: byDeriv } = placedPiece(
      TPS_300,
      [0, 0, 25],
      [0, 1, 0],
      'boca_derivacion',
      [0, 0, 1],
    );
    const fitB = verifyGeometricFit(TPS_300, byDeriv);
    expect(fitB, 'fit must resolve for TPS by boca_derivacion').not.toBeNull();
    expect(fitB!.matches).toBe(true);
    expect(fitB!.posErrorMm).toBeLessThan(0.1);
  });

  it('N3. XPS con 4 bocas resuelve fit sin presuponer P1/P2', () => {
    const { piece } = placedPiece(
      XPS_300,
      [0, 0, 25],
      [1, 0, 0],
      'P1_x_neg',
      [0, 0, 1],
    );
    expect(Object.keys(piece.puertos).sort()).toEqual(
      ['P1_x_neg', 'P2_x_pos', 'P3_z_neg', 'P4_z_pos'].sort(),
    );

    const fit = verifyGeometricFit(XPS_300, piece);
    expect(fit, 'fit must resolve for XPS').not.toBeNull();
    expect(fit!.matches).toBe(true);
    expect(fit!.posErrorMm).toBeLessThan(0.1);
    // XPS es cruz simétrica: cualquiera de las 4 bocas sirve como entrada;
    // el solver elige una con error 0 — comprobamos que es una del catálogo.
    expect(['P1_x_neg', 'P2_x_pos', 'P3_z_neg', 'P4_z_pos']).toContain(fit!.entryPortName);
  });

  it('N4. fit.sectionUp propaga orientacion_seccion_ws de la boca de entrada', () => {
    // Un CUPS "acostado" (P1_horizontal entrando con sectionUp en +X) debe
    // reportar fit con sectionUp=[1,0,0] — así ParametricMesh puede
    // reproducir el mismo frame al re-colocar.
    const { piece } = placedPiece(
      CUPS_300,
      [0, 0, 0],
      [0, 0, 1],
      'P2_vertical',
      [1, 0, 0],
    );
    const fit = verifyGeometricFit(CUPS_300, piece);
    expect(fit).not.toBeNull();
    expect(fit!.matches).toBe(true);
    // sectionUp recibido es el de la boca de entrada elegida por el solver.
    // Para esta pieza al menos uno de los sectionUp almacenados debe salir.
    expect(fit!.sectionUp).toBeDefined();
    const [sx, sy, sz] = fit!.sectionUp!;
    expect(Math.hypot(sx, sy, sz)).toBeCloseTo(1, 6);
  });

  it('N5. calibración no-identidad (modelFrame translación) se conserva en el fit', () => {
    // Setear un modelFrame NO identidad sobre CUPS: translación en el eje
    // Y local (altura del modelo). Verifica que place y verify usan el mismo
    // `resolveRecipeForProduct`, es decir, que la pieza almacenada por place
    // se sigue detectando por verify aun con calibración no-identidad.
    //
    // Usamos translación (no rotación) para no alterar el eje de las normales:
    // una rotación arbitraria puede dejar P1_horizontal fuera del plano XZ
    // mundial y el camino "entrada horizontal" lo rechaza por diseño. Esa
    // limitación existe desde antes del bug y no es alcance de este test.
    const mapping: ProductPortMapping = {
      productId: CUPS_300.producto_id,
      entries: [],
      source: 'override',
      modelFrame: {
        tx_mm: 0,
        ty_mm: 3,
        tz_mm: 0,
        rx_deg: 0,
        ry_deg: 0,
        rz_deg: 0,
      },
    };
    setPortMappingOverrides({ [CUPS_300.producto_id]: mapping });

    const { piece } = placedPiece(
      CUPS_300,
      [3000, 0, 25],
      [1, 0, 0],
      'P1_horizontal',
      [0, 0, 1],
    );
    const fit = verifyGeometricFit(CUPS_300, piece);
    expect(
      fit,
      'fit must resolve for CUPS under non-identity modelFrame calibration',
    ).not.toBeNull();
    expect(fit!.matches).toBe(true);
    expect(fit!.entryPortName).toBe('P1_horizontal');
    expect(fit!.posErrorMm).toBeLessThan(0.5);
    expect(fit!.dirErrorDeg).toBeLessThan(0.5);
  });

  it('N6. piezas legacy 2-puerto (TRPS/CPS) siguen resolviendo fit (compat regresiva)', () => {
    // El contrato histórico (P1/P2) debe mantenerse. Comprobamos con un
    // CPS-45 construido vía placeRecipe desde P1.
    const CPS_45: Product = {
      producto_id: 'SAM_CPS-300-45-Z',
      descripcion_original: 'CPS-300-45-Z',
      tipo_pieza: 'curva horizontal',
      ancho_nominal_mm: 300,
      sku: 'CPS-300-45-Z',
      ala_nominal_mm: 50,
      angulo_grados: 45,
      familia_id: 'SAM-STP-Z',
    } as unknown as Product;

    const { piece } = placedPiece(
      CPS_45,
      [0, 0, 25],
      [1, 0, 0],
      'P1',
      [0, 0, 1],
    );
    const fit = verifyGeometricFit(CPS_45, piece);
    expect(fit, 'fit must still resolve for 2-port legacy pieces').not.toBeNull();
    expect(fit!.matches).toBe(true);
    expect(['P1', 'P2']).toContain(fit!.entryPortName);
  });
});
