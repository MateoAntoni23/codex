// @vitest-environment node
/**
 * portFidelity — regresión de la dimensión "fidelidad geométrica" del cierre.
 *
 * No alcanza con que el marco de cada boca sea ortonormal (lo que ya cubre
 * patternChainContinuity). Esta regresión verifica que CADA boca esté ubicada
 * sobre la cara física correcta del polígono medido del patrón:
 *
 *   1. el centro de la boca cae sobre una arista real del polígono;
 *   2. el largo de esa arista coincide con `port.ancho_mm`;
 *   3. la normal exterior de esa arista (calculada a partir del polígono CCW)
 *      coincide con `port.normal`;
 *   4. la coordenada del eje de extrusión del centro corresponde al medio del
 *      prisma (ala/2 para patrones horizontales, −ancho/2 para CUPS).
 *
 * Patrones cubiertos: todos los maestros con continuity ≠ 'pending'. DCPS
 * queda fuera porque no tiene STEP medido.
 */
import { describe, it, expect } from 'vitest';
import { MASTER_MODELS, type MasterModel } from '../masterModels';
import { buildRecipeByKey } from '../../parametric/geometry/recipes';
import type { GeometryRecipe, PortDef } from '../../parametric/geometry/outlines';

const EPS_POS = 1e-2; // mm
const EPS_DIR = 1e-3;
const EPS_LEN = 1e-2; // mm

interface EdgeMatch {
  readonly index: number;
  readonly midpoint: readonly [number, number];
  readonly length: number;
  readonly outwardNormalXZ: readonly [number, number];
  readonly perpDistance: number;
  readonly parametricT: number;
}

function projectCenter(port: PortDef, extrudeAlongY: boolean): readonly [number, number] {
  // El polígono vive en un plano 2D. Para extrudeAlongY=true el plano es XZ
  // (coords 0=X, 1=Z) y Y es el eje de extrusión. Para extrudeAlongY=false
  // (CUPS) el polígono vive en XY y Z es el eje de extrusión.
  return extrudeAlongY ? [port.center[0], port.center[2]] : [port.center[0], port.center[1]];
}

function projectNormal(port: PortDef, extrudeAlongY: boolean): readonly [number, number] {
  return extrudeAlongY ? [port.normal[0], port.normal[2]] : [port.normal[0], port.normal[1]];
}

/**
 * Para un polígono CCW, la normal exterior a la arista a→b es rotar (b−a) 90°
 * en el sentido horario del sistema. En XZ visto desde +Y (CCW) la regla es
 * n=(-dz, dx)/|dt|. En XY visto desde +Z (CCW convencional) sería n=(dy,-dx);
 * acá los polígonos CUPS siguen la misma convención que outlines.ts, que es
 * CCW visto desde +Y también para XY — ver `portOnEdge` en escaleraOutlines y
 * las bocas CUPS construidas a mano. Verificamos la coherencia a partir de la
 * normal declarada del puerto, no imponemos la convención: comparamos la
 * normal del puerto contra las dos candidatas (n=(-dv,du) y n=(dv,-du)) y
 * admitimos el signo que calce — si ninguno calza, la boca no está sobre esa
 * arista.
 */
function findMatchingEdge(
  polygon: readonly (readonly [number, number])[],
  centerProj: readonly [number, number],
  normalProj: readonly [number, number],
): EdgeMatch | null {
  let best: EdgeMatch | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-6) continue;
    const tu = du / len;
    const tv = dv / len;
    // perpendicular distance from center to the infinite line through a→b
    const rx = centerProj[0] - a[0];
    const ry = centerProj[1] - a[1];
    const t = rx * tu + ry * tv; // parametric length along edge
    const perp = rx * -tv + ry * tu; // signed perpendicular component
    if (t < -EPS_POS || t > len + EPS_POS) continue; // projection outside edge segment
    const perpAbs = Math.abs(perp);
    const parametricT = t / len;
    // Candidate outward normals (CCW and CW conventions):
    const nA: readonly [number, number] = [-tv, tu];
    const nB: readonly [number, number] = [tv, -tu];
    const dotA = nA[0] * normalProj[0] + nA[1] * normalProj[1];
    const dotB = nB[0] * normalProj[0] + nB[1] * normalProj[1];
    const bestDot = Math.max(dotA, dotB);
    // The port's declared normal must be aligned with one of the two
    // candidate outward normals (dot ≈ 1). If not, this edge isn't the one
    // even if the center projects onto it.
    if (bestDot < 1 - 1e-3) continue;
    const outward: readonly [number, number] = dotA >= dotB ? nA : nB;
    const match: EdgeMatch = {
      index: i,
      midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      length: len,
      outwardNormalXZ: outward,
      perpDistance: perpAbs,
      parametricT,
    };
    if (!best || match.perpDistance < best.perpDistance) best = match;
  }
  return best;
}

function assertPortOnEdge(master: MasterModel, recipe: GeometryRecipe, port: PortDef) {
  const centerProj = projectCenter(port, recipe.extrudeAlongY);
  const normalProj = projectNormal(port, recipe.extrudeAlongY);

  const match = findMatchingEdge(recipe.polygon, centerProj, normalProj);
  expect(
    match,
    `${master.id} :: ${port.name}: la normal declarada no coincide con la normal exterior de ninguna arista del polígono medido.`,
  ).not.toBeNull();
  if (!match) return;

  expect(
    match.perpDistance,
    `${master.id} :: ${port.name}: el centro está a ${match.perpDistance.toFixed(4)} mm de la arista ${match.index}.`,
  ).toBeLessThan(EPS_POS);

  // Center coincides with edge midpoint — se tolera deslizamiento mínimo.
  const dMid = Math.hypot(
    centerProj[0] - match.midpoint[0],
    centerProj[1] - match.midpoint[1],
  );
  expect(
    dMid,
    `${master.id} :: ${port.name}: centro vs punto medio de la arista ${match.index}: ${dMid.toFixed(4)} mm.`,
  ).toBeLessThan(EPS_POS);

  // Edge length matches the port dimension that lies in the polygon plane.
  // Convención:
  //   - extrudeAlongY=true  (TRPS/CPS/…): polígono vive en XZ, el eje de
  //     extrusión es Y. La arista XZ mide `ancho_mm`; `ala_mm` es la altura
  //     del prisma en Y.
  //   - extrudeAlongY=false (CUPS):      polígono vive en XY, el eje de
  //     extrusión es Z. La arista XY mide `ala_mm` (p.ej. ~36.56 mm sobre la
  //     chaflán exterior); `ancho_mm` es la profundidad del canal en Z.
  // En ambos casos "la dimensión en el plano del polígono" es la que debe
  // coincidir con el largo de la arista medida.
  const inPlaneWidth = recipe.extrudeAlongY ? port.ancho_mm : port.ala_mm;
  const inPlaneField = recipe.extrudeAlongY ? 'ancho_mm' : 'ala_mm';
  expect(
    Math.abs(match.length - inPlaneWidth),
    `${master.id} :: ${port.name}: port.${inPlaneField}=${inPlaneWidth} vs arista=${match.length.toFixed(4)}.`,
  ).toBeLessThan(EPS_LEN);

  // Extrusion-axis coordinate of center == midpoint of extrusion height.
  if (recipe.extrudeAlongY) {
    // Para patrones Y-up el polígono está en XZ (Y=0 .. ala), centro en Y=ala/2.
    const expectedY = recipe.translate[1] + recipe.height / 2;
    expect(
      Math.abs(port.center[1] - expectedY),
      `${master.id} :: ${port.name}: centro Y=${port.center[1]} vs esperado ${expectedY} (ala/2).`,
    ).toBeLessThan(EPS_POS);
  } else {
    // CUPS: polígono en XY, prisma extruido en Z. Centro debe estar en Z medio
    // del prisma — para CUPS el translate es (0,0,-ancho), height=ancho, así
    // que el centro Z esperado es -ancho/2.
    const expectedZ = recipe.translate[2] + recipe.height / 2;
    expect(
      Math.abs(port.center[2] - expectedZ),
      `${master.id} :: ${port.name}: centro Z=${port.center[2]} vs esperado ${expectedZ} (−ancho/2).`,
    ).toBeLessThan(EPS_POS);
  }

  // The declared normal is a unit vector in the polygon plane.
  const nlen = Math.hypot(
    port.normal[0],
    port.normal[1],
    port.normal[2],
  );
  expect(Math.abs(nlen - 1), `${master.id} :: ${port.name}: |normal|=${nlen}`).toBeLessThan(EPS_DIR);
}

describe('portFidelity — cada boca sobre la cara física correcta del polígono', () => {
  const regressable = MASTER_MODELS.filter(
    (m) => m.closure.continuity.status !== 'pending',
  );

  for (const master of regressable) {
    it(`${master.id}: cada boca cae sobre una arista del polígono medido con la normal exterior correcta`, () => {
      const recipe = buildRecipeByKey(master.recipeKey, {
        ancho_mm: master.baseParams.ancho_mm,
        ala_mm: master.baseParams.ala_mm,
        longitud_mm: master.baseParams.longitud_mm ?? 3000,
        angulo_deg: master.baseParams.angulo_deg ?? 90,
        ...(master.baseParams.sentido_vertical !== undefined ? { sentido_vertical: master.baseParams.sentido_vertical } : {}),
      });
      expect(recipe.ports.length, `${master.id}: receta sin puertos`).toBeGreaterThan(0);
      for (const port of recipe.ports) {
        assertPortOnEdge(master, recipe, port);
      }
    });
  }

  it('cobertura: regresiona todos los maestros con STEP medido (continuity ≠ pending)', () => {
    expect(regressable.length).toBeGreaterThan(0);
    // Si se agrega un maestro nuevo con STEP medido, debe entrar automáticamente
    // a la suite. Esta verificación evita que una dimensión fidelity quede sin
    // regresión por omisión al declarar continuity=validated sobre un nuevo
    // patrón.
    const skipped = MASTER_MODELS.filter(
      (m) => m.closure.continuity.status === 'pending',
    );
    for (const m of skipped) {
      expect(
        m.closure.fidelity.status,
        `${m.id}: continuity=pending debería arrastrar fidelity=pending`,
      ).toBe('pending');
    }
  });
});
