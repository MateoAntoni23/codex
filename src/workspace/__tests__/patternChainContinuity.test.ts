/**
 * Regresión — continuidad flush por patrón (perforada + escalera).
 *
 * Cristaliza la convención común del marco local de boca (u=(0,0,+1),
 * v=(0,+1,0) para normal=(-1,0,0), rotaciones equivalentes para otras
 * normales — expresada por el helper `portOnEdgeXZ` en outlines.ts y su
 * réplica `portOnEdge` en escaleraRecipes.ts) en términos del único observable
 * que importa al usuario: para CADA boca de CADA patrón, si colocamos un
 * recto de referencia tomando esa boca como fuente, los tres invariantes
 * físicos (posición, normal opuesta, marco transversal coincidente) se
 * cumplen en MUNDO.
 *
 * Camino canónico adoptado — `entryDir = sourcePort.outwardNormal`,
 * `sectionUp = sourcePort.vDir`. Es la semántica que `placeRecipe` espera
 * para continuaciones no-horizontales y coincide con la ruta legacy para
 * continuaciones horizontales. Elegirlo acá cementa que ningún patrón
 * requiere corrección adicional por visor.
 *
 * Alcance:
 *   - Perforada: TRPS, CPS-45, CPS-90, TPS (3 bocas), XPS (4 bocas).
 *   - Escalera : TRES, CS-45, CS-90, TS (3 bocas), XS (4 bocas), RIS
 *                (2 bocas de distinto ancho — el flush de marco aplica en
 *                ambas; la cadena recta de TRES-300 cierra sólo la boca
 *                ancha porque el lado 150 no tiene variante publicada).
 *
 * CUPS se queda en su spec dedicado `cupsChainWorldContinuity.test.ts`
 * porque la continuación por P2_vertical depende de sectionUp propagado
 * (D7), contrato acotado y verificado ahí.
 */
import { describe, expect, it } from 'vitest';
import {
  placeRecipe,
  resolveRecipe,
  resolveParametricEntry,
  type Vec3,
  type PlacedPort,
} from '../parametricBridge';
import { buildRecipeByKey } from '../../parametric/geometry/recipes';
import type { Product } from '../../tray/model';

// ─── Fixtures ────────────────────────────────────────────────────────────────

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
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const TPS_300: Product = {
  producto_id: 'SAM_TPS-300-Z',
  descripcion_original: 'TPS-300-Z',
  tipo_pieza: 'T',
  ancho_nominal_mm: 300,
  sku: 'TPS-300-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const XPS_300: Product = {
  producto_id: 'SAM_XPS-300-Z',
  descripcion_original: 'XPS-300-Z',
  tipo_pieza: 'X',
  ancho_nominal_mm: 300,
  sku: 'XPS-300-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const TRES_300: Product = {
  producto_id: 'SAM_TRES-300-065-18-Z',
  descripcion_original: 'TRES-300-065-18-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  sku: 'TRES-300-065-18-Z',
  ala_nominal_mm: 65,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STE-Z',
} as unknown as Product;

const CS_45: Product = {
  producto_id: 'SAM_CS-300-45-065-18-Z',
  descripcion_original: 'CS-300-45-065-18-Z',
  tipo_pieza: 'curva horizontal',
  ancho_nominal_mm: 300,
  sku: 'CS-300-45-065-18-Z',
  ala_nominal_mm: 65,
  angulo_grados: 45,
  familia_id: 'SAM-STE-Z',
} as unknown as Product;

const CS_90: Product = {
  producto_id: 'SAM_CS-300-90-065-18-Z',
  descripcion_original: 'CS-300-90-065-18-Z',
  tipo_pieza: 'curva horizontal',
  ancho_nominal_mm: 300,
  sku: 'CS-300-90-065-18-Z',
  ala_nominal_mm: 65,
  angulo_grados: 90,
  familia_id: 'SAM-STE-Z',
} as unknown as Product;

const TS_300: Product = {
  producto_id: 'SAM_TS-300-065-18-Z',
  descripcion_original: 'TS-300-065-18-Z',
  tipo_pieza: 'T',
  ancho_nominal_mm: 300,
  sku: 'TS-300-065-18-Z',
  ala_nominal_mm: 65,
  familia_id: 'SAM-STE-Z',
} as unknown as Product;

const XS_300: Product = {
  producto_id: 'SAM_XS-300-065-18-Z',
  descripcion_original: 'XS-300-065-18-Z',
  tipo_pieza: 'X',
  ancho_nominal_mm: 300,
  sku: 'XS-300-065-18-Z',
  ala_nominal_mm: 65,
  familia_id: 'SAM-STE-Z',
} as unknown as Product;

// RIS fixture removido: no participa en `placeRecipe` interactivo. El caso RIS
// usa `buildRecipeByKey` directamente a nivel receta.

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EPS_POS = 1e-2; // mm
const EPS_DIR = 1e-2; // norm — las normales medidas del STEP tienen residuos ~1e-3

function assertFlush(label: string, a: PlacedPort, b: PlacedPort): void {
  const d = Math.hypot(
    a.pos[0] - b.pos[0],
    a.pos[1] - b.pos[1],
    a.pos[2] - b.pos[2],
  );
  expect(d, `${label}: centros coinciden`).toBeLessThan(EPS_POS);
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(a.outwardNormal[i] + b.outwardNormal[i]),
      `${label}: normales opuestas (c${i})`,
    ).toBeLessThan(EPS_DIR);
    expect(
      Math.abs(a.vDir[i] - b.vDir[i]),
      `${label}: vDir coincide (c${i})`,
    ).toBeLessThan(EPS_DIR);
    expect(
      Math.abs(a.uDir[i] + b.uDir[i]),
      `${label}: uDir opuestos (c${i})`,
    ).toBeLessThan(EPS_DIR);
  }
}

function assertOrthoNormal(label: string, p: PlacedPort): void {
  const u = p.uDir;
  const v = p.vDir;
  const n = p.outwardNormal;
  const cross: Vec3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(cross[i] - n[i]),
      `${label}: u×v = n (c${i})`,
    ).toBeLessThan(EPS_DIR);
  }
  expect(Math.hypot(u[0], u[1], u[2]), `${label}: |u|=1`).toBeCloseTo(1, 3);
  expect(Math.hypot(v[0], v[1], v[2]), `${label}: |v|=1`).toBeCloseTo(1, 3);
  expect(Math.hypot(n[0], n[1], n[2]), `${label}: |n|=1`).toBeCloseTo(1, 3);
}

/**
 * Coloca un recto consumiendo el puerto fuente como marco completo.
 *   entryDir  = sourcePort.outwardNormal
 *   sectionUp = sourcePort.vDir
 */
function placeReferenceStraight(
  straightProduct: Product,
  source: PlacedPort,
): ReturnType<typeof placeRecipe> {
  const entry = resolveRecipe(straightProduct) ?? resolveParametricEntry(straightProduct)!;
  return placeRecipe(
    straightProduct,
    entry,
    source.pos,
    source.outwardNormal,
    'native',
    undefined,
    { sectionUp: source.vDir },
  );
}

/**
 * Para cada boca del patrón colocado, verifica que:
 *   - El marco es orto-normal (u×v=n).
 *   - Un recto de referencia saliendo de esa boca cierra flush.
 * El patrón se coloca por una boca de entrada arbitraria (`entryPortName`),
 * con el recto de referencia dado como "entrada" a modo de arranque, pero
 * el invariante se mide boca por boca independientemente de esa entrada.
 */
function assertAllPortsFlushRef(
  label: string,
  patternProduct: Product,
  patternEntry: ReturnType<typeof resolveRecipe> | ReturnType<typeof resolveParametricEntry>,
  entryPortName: string | undefined,
  straightProduct: Product,
  startPos: Vec3,
  entryDir: Vec3,
): PlacedPort[] {
  if (!patternEntry) throw new Error(`${label}: no hay entrada paramétrica`);
  const placed = placeRecipe(
    patternProduct,
    patternEntry,
    startPos,
    entryDir,
    'native',
    undefined,
    entryPortName ? { entryPortName } : undefined,
  );
  for (const port of placed.ports) {
    assertOrthoNormal(`${label}.${port.name}`, port);
    const ref = placeReferenceStraight(straightProduct, port);
    assertFlush(`${label}.${port.name} ↔ ${straightProduct.sku}.P1`, port, ref.p1);
  }
  return [...placed.ports];
}

// ─── Perforada ──────────────────────────────────────────────────────────────

describe('Perforada — flush por patrón', () => {
  // Origen conveniente: P1 del recto horizontal apoyado en z=ala/2, eje X.
  const START: Vec3 = [0, 0, 25];
  const EAST: Vec3 = [1, 0, 0];

  it('TRPS — ambas bocas flush con TRPS adyacente (sanity de la convención base)', () => {
    assertAllPortsFlushRef(
      'TRPS',
      TRPS_300,
      resolveRecipe(TRPS_300),
      undefined,
      TRPS_300,
      START,
      EAST,
    );
  });

  it('CPS-45 — ambas bocas flush con TRPS saliente', () => {
    assertAllPortsFlushRef(
      'CPS45',
      CPS_45,
      resolveRecipe(CPS_45),
      undefined,
      TRPS_300,
      START,
      EAST,
    );
  });

  it('CPS-90 — ambas bocas flush con TRPS saliente', () => {
    assertAllPortsFlushRef(
      'CPS90',
      CPS_90,
      resolveRecipe(CPS_90),
      undefined,
      TRPS_300,
      START,
      EAST,
    );
  });

  it('TPS — tronco_P1/tronco_P2/boca_derivacion, todas flush con TRPS', () => {
    assertAllPortsFlushRef(
      'TPS',
      TPS_300,
      resolveRecipe(TPS_300),
      'tronco_P1',
      TRPS_300,
      START,
      EAST,
    );
  });

  it('XPS — 4 brazos, todos flush con TRPS saliente', () => {
    assertAllPortsFlushRef(
      'XPS',
      XPS_300,
      resolveRecipe(XPS_300),
      'P1_x_neg',
      TRPS_300,
      START,
      EAST,
    );
  });
});

// ─── Escalera ────────────────────────────────────────────────────────────────

describe('Escalera — flush por patrón', () => {
  // Origen escalera: ala=65, centro en y=32.5.
  const START: Vec3 = [0, 32.5, 0];
  const EAST: Vec3 = [1, 0, 0];

  it('TRES — ambas bocas flush con TRES adyacente', () => {
    assertAllPortsFlushRef(
      'TRES',
      TRES_300,
      resolveRecipe(TRES_300),
      undefined,
      TRES_300,
      START,
      EAST,
    );
  });

  it('CS-45 — ambas bocas flush con TRES saliente (entra por P2 x_min)', () => {
    // CS-45 tiene P1.normal=+Z y P2.normal=−X. Para arrancar con TRES
    // orientado +X elegimos entryPortName='P2' (su normal −X coincide con
    // −entryDir).
    assertAllPortsFlushRef(
      'CS45',
      CS_45,
      resolveRecipe(CS_45),
      'P2',
      TRES_300,
      START,
      EAST,
    );
  });

  it('CS-90 — ambas bocas flush con TRES saliente (entra por P2 x_min)', () => {
    // CS-90 tiene P1.normal=−Z y P2.normal=−X. Idem CS-45.
    assertAllPortsFlushRef(
      'CS90',
      CS_90,
      resolveRecipe(CS_90),
      'P2',
      TRES_300,
      START,
      EAST,
    );
  });

  it('TS — 3 bocas (P1 z_min, P2 x_max, P3 z_max), todas flush con TRES', () => {
    // TS no tiene boca con normal −X: la entrada natural desde un recto que
    // avanza +X es P2 (x_max, outward +X). El recto entra en +X y TS.P2
    // queda alineado con −entryDir ⇒ normal opuesta al avance.
    //   P2.outward_catalogo = +X ; −entryDir = −X ⇒ para flush se requiere
    //   port.outwardNormal = +X y −entryDir = −X ⇒ contrario.
    // Para entrar por una boca con outward = +X debemos usar entryDir = −X.
    assertAllPortsFlushRef(
      'TS',
      TS_300,
      resolveRecipe(TS_300),
      'P2',
      TRES_300,
      START,
      [-1, 0, 0],
    );
  });

  it('XS — 4 brazos, todos flush con TRES saliente', () => {
    assertAllPortsFlushRef(
      'XS',
      XS_300,
      resolveRecipe(XS_300),
      'P4',
      TRES_300,
      START,
      EAST,
    );
  });

  it('RIS — recipe: ambas bocas con marco orto-normal y convención común (helper portOnEdge)', () => {
    // RIS no entra en la ruta interactiva (`placeRecipe`): su `pieceKind`
    // taxonómico `reduccion_lateral` no mapea a PieceKind legacy, el viewer
    // consume la receta directamente. Verificamos el invariante a nivel receta:
    //   - u, v, n son orto-normales con u×v=n (regla right-handed).
    //   - v_dir es (0, +1, 0): ala vertical en el marco local, única convención
    //     compartida con TRES/CS/TS/XS/portOnEdge.
    //   - u_dir sigue la convención `portOnEdge`: nx=-dz/len, nz=dx/len,
    //     ux=nz, uz=-nx. Esto garantiza que si en el futuro se publica una
    //     TRES-150 y se expone RIS al pipeline interactivo, el flush con la
    //     recta adyacente cerrará por construcción.
    const recipe = buildRecipeByKey('escalera:reduccion_lateral', {
      ancho_mm: 300,
      ala_mm: 65,
    });
    expect(recipe.ports.map((p) => p.name).sort()).toEqual(['P1', 'P2']);
    for (const port of recipe.ports) {
      const placed: PlacedPort = {
        name: port.name,
        pos: [port.center[0], port.center[1], port.center[2]],
        outwardNormal: [port.normal[0], port.normal[1], port.normal[2]],
        uDir: [port.u_dir[0], port.u_dir[1], port.u_dir[2]],
        vDir: [port.v_dir[0], port.v_dir[1], port.v_dir[2]],
        ancho_mm: port.ancho_mm,
        ala_mm: port.ala_mm,
      };
      assertOrthoNormal(`RIS.${port.name}`, placed);
      expect(
        Math.abs(port.v_dir[0]),
        `RIS.${port.name}: v_dir sin componente X`,
      ).toBeLessThan(EPS_DIR);
      expect(
        port.v_dir[1],
        `RIS.${port.name}: v_dir apunta a +Y (ala vertical)`,
      ).toBeGreaterThan(0.999);
      expect(
        Math.abs(port.v_dir[2]),
        `RIS.${port.name}: v_dir sin componente Z`,
      ).toBeLessThan(EPS_DIR);
    }
  });
});
