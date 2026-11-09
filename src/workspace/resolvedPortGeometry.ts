/**
 * resolvedPortGeometry — resolución geométrica común para el flujo:
 *   configurador → preview del workspace → pieza confirmada → payload Python.
 *
 * Única responsabilidad: tomar la receta cruda del producto (medida sobre
 * el STEP) y aplicar los overrides declarados en el Configurador, devolviendo:
 *   1. Una receta "resuelta" con ports en el marco canónico (corregido).
 *   2. Un `preTransform` (Matrix4 local) que mapea `raw polygon → canonical`
 *      para que la malla pueda componerse con el baseMatrix del `placeRecipe`.
 *
 * Mapa semántico:
 *
 *   modelFrame (ProductPortMapping.modelFrame)
 *     Traslación + rotación Euler XYZ aplicadas al MARCO del modelo. Es la
 *     calibración del ARTEFACTO (no de la instancia): si el STEP está girado
 *     90° respecto al marco canónico esperado, modelFrame lo corrige.
 *     Afecta a TODAS las bocas Y a la malla.
 *
 *   portGeometry (PortMappingEntry.geometry)
 *     Correcciones por boca individual:
 *       - centerMm, normal, uDir, vDir: override explícito del dato de la boca.
 *       - installRotationDeg: giro alrededor de la normal, afecta sólo a uDir/vDir.
 *     Se aplica DESPUÉS del modelFrame. No afecta la malla.
 *
 * Invariantes:
 *
 *   - La receta cruda nunca se mutra. Side-effect free.
 *   - Si no hay overrides declarados, devuelve `{ recipe: input, preTransform: Identity }`.
 *   - El consumidor (placeRecipe) debe componer `baseMatrix · preTransform` para
 *     obtener la transformación completa local-raw → mundo.
 *
 * No depende del store de catálogo directamente: lee los overrides a través de
 * `catalogPortMapping` (que a su vez es alimentado por el `catalogConfigStore`).
 */
import * as THREE from 'three';
import type { GeometryRecipe, PortDef } from '../parametric/geometry/outlines';
import type { Vec3 } from '../parametric/catalog';
import {
  getModelFrameOverride,
  getPortGeometryOverride,
  isIdentityModelFrame,
  isIdentityPortGeometry,
  type ModelFrameOverride,
  type PortGeometryOverride,
} from './catalogPortMapping';

export interface ResolvedRecipe {
  /** Receta con ports post-modelFrame y post-portGeometry. */
  readonly recipe: GeometryRecipe;
  /**
   * Transformación local a aplicar a la malla cruda (polygon + extrusión)
   * para llevarla al marco canónico. Equivale a la 4x4 que implementa el
   * modelFrame. Si no hay modelFrame se devuelve la identidad.
   */
  readonly preTransform: THREE.Matrix4;
  /**
   * `true` cuando no se aplicó ninguna transformación. El consumidor puede
   * usar esto para evitar composiciones innecesarias.
   */
  readonly isIdentity: boolean;
}

/**
 * Construye la 4x4 correspondiente a un ModelFrameOverride.
 *
 * Convención: traslación aplicada DESPUÉS de la rotación Euler XYZ,
 * i.e., M = T · Rz · Ry · Rx (orden ZYX al multiplicar porque THREE compone
 * de derecha a izquierda; equivale a "rotá Rx, luego Ry, luego Rz, luego trasladá").
 *
 * Esto coincide con la convención `THREE.Euler('XYZ')` cuando se construye
 * `new Matrix4().makeRotationFromEuler(euler)` — THREE aplica Rx primero.
 */
export function buildModelFrameMatrix(frame: ModelFrameOverride | null | undefined): THREE.Matrix4 {
  if (!frame || isIdentityModelFrame(frame)) return new THREE.Matrix4();
  const deg2rad = Math.PI / 180;
  const euler = new THREE.Euler(
    (frame.rx_deg ?? 0) * deg2rad,
    (frame.ry_deg ?? 0) * deg2rad,
    (frame.rz_deg ?? 0) * deg2rad,
    'XYZ',
  );
  const rot = new THREE.Matrix4().makeRotationFromEuler(euler);
  const trans = new THREE.Matrix4().makeTranslation(
    frame.tx_mm ?? 0,
    frame.ty_mm ?? 0,
    frame.tz_mm ?? 0,
  );
  return trans.multiply(rot);
}

function applyPoint(m: THREE.Matrix4, v: Vec3): Vec3 {
  const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m);
  return [p.x, p.y, p.z];
}

function applyDir(m: THREE.Matrix4, v: Vec3): Vec3 {
  // Transforma dirección: ignora traslación. Para rotaciones puras
  // `transformDirection` preserva la longitud y la ortogonalidad.
  const d = new THREE.Vector3(v[0], v[1], v[2]).transformDirection(m);
  return [d.x, d.y, d.z];
}

/**
 * Rota un vector alrededor de un eje (normal) por un ángulo (rad), usando la
 * fórmula de Rodrigues. Útil para `installRotationDeg` — rotar uDir/vDir
 * alrededor de la normal de la boca.
 */
function rotateAroundAxis(v: Vec3, axis: Vec3, rad: number): Vec3 {
  if (rad === 0) return v;
  const [vx, vy, vz] = v;
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(len > 0)) return v;
  const kx = axis[0] / len;
  const ky = axis[1] / len;
  const kz = axis[2] / len;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Rodrigues: v' = v cosθ + (k × v) sinθ + k (k·v)(1 - cosθ)
  const dot = kx * vx + ky * vy + kz * vz;
  const crossX = ky * vz - kz * vy;
  const crossY = kz * vx - kx * vz;
  const crossZ = kx * vy - ky * vx;
  return [
    vx * cos + crossX * sin + kx * dot * (1 - cos),
    vy * cos + crossY * sin + ky * dot * (1 - cos),
    vz * cos + crossZ * sin + kz * dot * (1 - cos),
  ];
}

/**
 * Aplica `preMatrix` al PortDef base y luego mezcla el override por boca
 * (centerMm, normal, uDir, vDir explícitos; installRotationDeg relativo a la
 * normal resuelta). Retorna un PortDef nuevo.
 */
function resolvePort(
  port: PortDef,
  preMatrix: THREE.Matrix4,
  override: PortGeometryOverride | null,
): PortDef {
  // Base post-modelFrame.
  let center = applyPoint(preMatrix, port.center);
  let normal = applyDir(preMatrix, port.normal);
  let u_dir = applyDir(preMatrix, port.u_dir);
  let v_dir = applyDir(preMatrix, port.v_dir);

  if (override) {
    if (override.centerMm) center = [override.centerMm[0], override.centerMm[1], override.centerMm[2]];
    if (override.normal) normal = [override.normal[0], override.normal[1], override.normal[2]];
    if (override.uDir) u_dir = [override.uDir[0], override.uDir[1], override.uDir[2]];
    if (override.vDir) v_dir = [override.vDir[0], override.vDir[1], override.vDir[2]];
    const rotDeg = override.installRotationDeg ?? 0;
    if (Math.abs(rotDeg) > 1e-9) {
      const rad = (rotDeg * Math.PI) / 180;
      u_dir = rotateAroundAxis(u_dir, normal, rad);
      v_dir = rotateAroundAxis(v_dir, normal, rad);
    }
  }

  return { ...port, center, normal, u_dir, v_dir };
}

/**
 * Entry point. Lee los overrides del store (modelFrame + portGeometry) para
 * `productId` y devuelve la receta resuelta + preTransform.
 *
 * Si no hay overrides declarados, devuelve la receta original sin copiar.
 */
export function resolveRecipeForProduct(
  recipe: GeometryRecipe,
  productId: string,
): ResolvedRecipe {
  const modelFrame = getModelFrameOverride(productId);
  const perPortOverrides = recipe.ports.map((p) =>
    getPortGeometryOverride(productId, p.name),
  );
  const hasPortOverride = perPortOverrides.some((o) => o !== null);
  const hasModelFrame = modelFrame !== null;

  if (!hasModelFrame && !hasPortOverride) {
    return {
      recipe,
      preTransform: new THREE.Matrix4(),
      isIdentity: true,
    };
  }

  const preTransform = buildModelFrameMatrix(modelFrame);
  const resolvedPorts: PortDef[] = recipe.ports.map((port, i) =>
    resolvePort(port, preTransform, perPortOverrides[i]),
  );

  return {
    recipe: { ...recipe, ports: resolvedPorts },
    preTransform,
    isIdentity: false,
  };
}

/**
 * Helper para tests / viewer: aplica `modelFrame + portGeometry` DIRECTAMENTE a
 * un override hipotético (sin consultar el store). Permite previsualizar el
 * efecto de un borrador antes de persistirlo.
 */
export function resolveRecipeWith(
  recipe: GeometryRecipe,
  modelFrame: ModelFrameOverride | null | undefined,
  portOverrides: Record<string, PortGeometryOverride | null | undefined>,
): ResolvedRecipe {
  const mfEffective = modelFrame && !isIdentityModelFrame(modelFrame) ? modelFrame : null;
  const perPortOverrides = recipe.ports.map((p) => {
    const ov = portOverrides[p.name];
    return ov && !isIdentityPortGeometry(ov) ? ov : null;
  });
  const hasPortOverride = perPortOverrides.some((o) => o !== null);
  const hasModelFrame = mfEffective !== null;

  if (!hasModelFrame && !hasPortOverride) {
    return {
      recipe,
      preTransform: new THREE.Matrix4(),
      isIdentity: true,
    };
  }

  const preTransform = buildModelFrameMatrix(mfEffective);
  const resolvedPorts: PortDef[] = recipe.ports.map((port, i) =>
    resolvePort(port, preTransform, perPortOverrides[i]),
  );

  return {
    recipe: { ...recipe, ports: resolvedPorts },
    preTransform,
    isIdentity: false,
  };
}
